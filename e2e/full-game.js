// Full-game browser test: drives the real pages in real Chrome - one host
// window, two contestant windows (separate storage, like real players) and
// a watch window - through every phase, asserting what each screen shows.
//
//   node full-game.js <client url> <admin token> <screenshot dir>
//
// Needs a draga-server running with CORS_ORIGINS/CLIENT_BASE_URL set to the
// client url, and the client served (e.g. `python -m http.server 8080` in
// client/). Set CHROME_PATH if Chrome isn't in its default Windows location.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const CLIENT = process.argv[2] || 'http://localhost:8080';
const ADMIN = process.argv[3];
const SHOTS = process.argv[4];
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const debugPages = {};
let step = 0;
const log = (msg) => console.log(`  ${msg}`);
const check = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  log(`ok  ${msg}`);
};

async function waitFor(page, fn, arg, timeout = 20000) {
  await page.waitForFunction(fn, { timeout }, arg);
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (page, sel) => page.$eval(sel, (e) => !e.hidden && e.offsetParent !== null);
const shot = async (page, name) => {
  step += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, '0')}-${name}.png`), fullPage: true });
};

function watchErrors(page, label) {
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
  });
}

async function newPage(browser, label, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  watchErrors(page, label);
  debugPages[label] = page;
  return { page, context };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    // ---- host ----------------------------------------------------------
    console.log('\nHOST: start a session');
    const { page: host, context: hostCtx } = await newPage(browser, 'host', { width: 1100, height: 900 });
    await hostCtx.overridePermissions(CLIENT, ['clipboard-read', 'clipboard-write']);
    await host.evaluateOnNewDocument((token) => localStorage.setItem('devils-advocate:admin-token', token), ADMIN);
    const prompts = [];
    host.on('dialog', async (d) => {
      prompts.push(d.defaultValue() || d.message());
      await d.accept();
    });
    let launch = null;
    // A button that says "Working..." is disabled; wait for it like a person would.
    const clickPrimary = async () => {
      await waitFor(host, () => {
        const b = document.querySelector('#btn-primary');
        return !b.disabled && b.textContent !== 'Working…';
      });
      await host.click('#btn-primary');
    };
    host.on('response', async (r) => {
      if (r.url().endsWith('/sessions/launch') && r.request().method() === 'POST') launch = await r.json();
    });

    await host.goto(`${CLIENT}/host.html`);
    await waitFor(host, () => document.querySelector('#btn-primary')?.textContent.includes('Start a session'));
    check(!(await visible(host, '#stepper')), 'no stepper before a session exists');
    await shot(host, 'host-empty');

    await clickPrimary();
    await waitFor(host, () => document.querySelector('#now-title').textContent.includes('Invite your contestants'));
    check(launch && launch.invites.length === 2, 'launch returned two invites');
    check((await host.$$('#now-invites .invite-row')).length === 2, 'two invite rows are shown as step one');
    check(await host.$eval('#btn-primary', (b) => b.disabled), 'deal is locked until both contestants join');
    check((await text(host, '#now-hint')).includes('Waiting for'), 'the hint says who we are waiting for');
    check((await text(host, '#now-step')) === 'Step 1 of 8', 'step counter reads 1 of 8');
    await shot(host, 'host-invite-step');

    // The copy button either writes to the clipboard (button flashes
    // "Copied") or, if the browser refuses, falls back to a prompt holding the link.
    await host.bringToFront();
    await host.click('#now-invites .invite-row button');
    await sleep(400);
    const flashed = await host.$eval('#now-invites .invite-row button', (b) => b.textContent);
    const clip = await host.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    const link = [clip, ...prompts].find((t) => t && t.includes('/play.html?token='));
    log('button text after click: ' + JSON.stringify(flashed) + '; clipboard ' + (clip ? 'has text' : 'unreadable/empty') + '; prompts seen: ' + prompts.length);
    check(flashed.includes('Copied') || Boolean(link), 'the copy button either copies the invite link or shows it for manual copy');

    // ---- contestants ---------------------------------------------------
    console.log('\nCONTESTANTS: join with the invite links');
    const players = {};
    for (const [seat, name] of [['one', 'Alice'], ['two', 'Bob']]) {
      const invite = launch.invites.find((i) => i.seat === seat);
      const { page } = await newPage(browser, name, { width: 420, height: 900 });
      await page.goto(`${CLIENT}/play.html?token=${invite.token}`);
      await page.waitForSelector('#join-card:not([hidden])', { timeout: 15000 });
      check(!(await visible(page, '#room')), `${name}: room is hidden until a name is chosen`);
      await page.type('#join-name', name);
      await page.click('#join-submit');
      await page.waitForSelector('#room:not([hidden])', { timeout: 15000 });
      players[name] = page;
      check((await text(page, '#banner-headline')).includes('lobby'), `${name}: sees the lobby banner`);
      if (name === 'Alice') {
        check((await text(page, '#banner-body')).includes('Waiting for your opponent'), 'Alice is told her opponent has not joined yet');
        await shot(page, 'alice-lobby-alone');
      }
    }
    const alice = players.Alice;
    const bob = players.Bob;
    await waitFor(alice, () => document.querySelector('#banner-body').textContent.includes('Bob is here'));
    check(true, 'Alice is told Bob has arrived (live roster over the websocket)');

    await waitFor(host, () => !document.querySelector('#btn-primary').disabled);
    check((await host.$$eval('#now-invites .badge-gold', (e) => e.length)) === 2, 'host roster shows both contestants joined');
    check((await text(host, '#now-invites')).includes('Alice') && (await text(host, '#now-invites')).includes('Bob'), 'host sees the names contestants chose');
    await shot(host, 'host-both-joined');

    // ---- deal + lock ---------------------------------------------------
    console.log('\nHOST: draw topic & sides');
    await clickPrimary();
    await waitFor(host, () => document.querySelector('#now-title').textContent.includes('Topic locked in'));
    check(await visible(host, '#table-card'), 'host can see the topic before the reveal');
    const prompt = await text(host, '#table-prompt');
    const explainer = await text(host, '#table-explainer');
    check(prompt.length > 5 && explainer.length > 10, `host sees the question and its explainer ("${prompt}")`);
    check((await text(host, '#table-visibility')).includes('Only you'), 'host is told the audience cannot see it yet');
    const sides = await host.$$eval('#table-sides li', (e) => e.map((l) => l.textContent));
    check(sides.length === 2 && sides.every((s) => /Alice|Bob/.test(s)), 'host sees who argues which side');
    await waitFor(alice, () => document.querySelector('#banner-headline').textContent.includes('Topic locked in'));
    check(!(await visible(alice, '#topic-card')) && !(await visible(alice, '#side-grid')), 'contestants cannot see the topic or sides yet');
    await shot(host, 'host-locked');

    // ---- reveal --------------------------------------------------------
    console.log('\nHOST: reveal');
    await clickPrimary();
    for (const p of [alice, bob]) {
      await waitFor(p, () => !document.querySelector('#topic-card').hidden);
      await waitFor(p, () => !document.querySelector('#side-grid').hidden);
    }
    check((await text(alice, '#topic-prompt')) === prompt, 'contestants see the same question the host drew');
    check((await text(alice, '#topic-explainer')) === explainer, 'contestants see the explainer line under the question');
    const aliceSide = await text(alice, '#my-position');
    const bobSide = await text(bob, '#my-position');
    check(aliceSide && bobSide && aliceSide !== bobSide, `the two contestants argue opposite sides ("${aliceSide}" vs "${bobSide}")`);
    check((await text(alice, '#their-position')) === bobSide, "Alice's 'your opponent argues' is Bob's side");
    check((await text(alice, '#banner-headline')).includes('revealed'), 'banner explains the reveal');
    await shot(alice, 'alice-revealed');
    await shot(host, 'host-revealed');

    // ---- prep + timer --------------------------------------------------
    console.log('\nHOST: start preparation (2 min) and check the timers tick');
    await host.$eval('#input-minutes', (i) => (i.value = ''));
    await host.type('#input-minutes', '2');
    await clickPrimary();
    await waitFor(alice, () => !document.querySelector('#timer-card').hidden);
    // the clock must already be running the moment the timer card appears
    check(/^\d\d:\d\d$/.test(await text(alice, '#timer-display')), 'the timer card never shows a blank clock');
    await sleep(600);
    const t1 = await text(alice, '#timer-display');
    await sleep(2200);
    const t2 = await text(alice, '#timer-display');
    check(/^\d\d:\d\d$/.test(t1) && /^\d\d:\d\d$/.test(t2) && t1 !== t2, `the contestant countdown ticks (${t1} -> ${t2})`);
    check((await text(alice, '#timer-label')) === 'Prep time left', 'timer is labelled for prep');
    const hostClock = await text(host, '#timer-display');
    check(/^\d\d:\d\d$/.test(hostClock), `the host timer shows a running countdown (${hostClock})`);
    check((await text(alice, '#banner-body')).includes('notes'), 'prep banner points at the notes box');

    await alice.type('#private-notes', 'my prep notes');
    await sleep(200);

    await host.click('#btn-timer-toggle');
    await waitFor(alice, () => !document.querySelector('#timer-note').hidden);
    check((await text(alice, '#timer-note')).includes('paused'), 'contestant is told when the host pauses the timer');
    await waitFor(host, () => document.querySelector('#btn-timer-toggle').textContent.includes('Resume'));
    check(true, 'host button flips to Resume');
    await host.click('#btn-timer-toggle');
    await waitFor(alice, () => document.querySelector('#timer-note').hidden);
    check(true, 'resuming clears the paused note');
    await shot(alice, 'alice-prep');

    // ---- opening poll --------------------------------------------------
    console.log('\nHOST: opening poll');
    await clickPrimary();
    await waitFor(host, () => document.querySelector('#now-title').textContent === 'Opening poll');
    await waitFor(alice, () => document.querySelector('#banner-headline').textContent.includes('Chat is voting'));
    check(true, 'contestants are told chat is voting');
    const pollLabel = await host.$eval('#poll-a-label', (e) => e.textContent);
    check(/^(Alice|Bob): .+ \(%\)$/.test(pollLabel), `poll fields are labelled with who argues what ("${pollLabel}")`);
    await host.type('#poll-a', '70');
    check((await host.$eval('#poll-b', (i) => i.value)) === '30', 'typing side A fills in side B');
    await host.$eval('#input-minutes', (i) => (i.value = ''));
    await host.type('#input-minutes', '3');
    await shot(host, 'host-opening-poll');
    await clickPrimary();
    await waitFor(host, () => document.querySelector('#now-title').textContent === 'Debate');
    await waitFor(alice, () => document.querySelector('#banner-headline').textContent.includes('Debate'));
    check((await text(alice, '#timer-label')) === 'Debate time left', 'timer relabels for the debate');
    check((await alice.$eval('#private-notes', (t) => t.value)) === 'my prep notes', 'notes survive the phase change');

    // ---- closing poll + results ---------------------------------------
    console.log('\nHOST: closing poll and results');
    await clickPrimary();
    await waitFor(host, () => document.querySelector('#now-title').textContent === 'Closing poll');
    await host.type('#poll-a', '54');
    check((await host.$eval('#poll-b', (i) => i.value)) === '46', 'closing poll autofills too');
    await clickPrimary();
    await waitFor(host, () => /won|draw/.test(document.querySelector('#now-title').textContent));
    const winnerTitle = await text(host, '#now-title');
    log(`host headline: ${winnerTitle}`);
    await waitFor(alice, () => !document.querySelector('#results-card').hidden);
    await waitFor(bob, () => !document.querySelector('#results-card').hidden);
    const aliceHead = await text(alice, '#banner-headline');
    const bobHead = await text(bob, '#banner-headline');
    check([aliceHead, bobHead].sort().join('|') === ['You won!', 'Your opponent won'].sort().join('|'), `exactly one contestant sees "You won!" (${aliceHead} / ${bobHead})`);
    const sideBLine = sides.find((s) => s.startsWith('Side B'));
    const sideBName = /Alice/.test(sideBLine) ? 'Alice' : 'Bob';
    check(winnerTitle === `${sideBName} won`, `the side that gained ground (B, ${sideBName}) is the winner`);
    check(((sideBName === 'Alice' ? aliceHead : bobHead)) === 'You won!', 'and that contestant sees "You won!"');
    const lines = await alice.$$eval('#results-lines li', (e) => e.map((l) => l.textContent));
    check(lines.length === 2 && lines.every((l) => l.includes('→')), `results card shows both sides' swing (${lines.join(' | ')})`);
    await shot(alice, 'alice-results');
    await shot(bob, 'bob-results');
    await shot(host, 'host-results');

    // ---- watch page ----------------------------------------------------
    console.log('\nWATCH: audience view');
    const { page: watch } = await newPage(browser, 'watch', { width: 1100, height: 800 });
    await watch.goto(`${CLIENT}/watch.html?session=${launch.session.public_code}`);
    await waitFor(watch, () => !document.querySelector('#overlay-results').hidden);
    check((await text(watch, '#overlay-sway')).includes('Chat swung 16 points'), `watch shows the swing ("${await text(watch, '#overlay-sway')}")`);
    await shot(watch, 'watch-results');

    // ---- next round ----------------------------------------------------
    console.log('\nHOST: next round');
    await clickPrimary();
    await waitFor(host, () => document.querySelector('#now-title').textContent.includes('Invite your contestants'));
    check(!(await host.$eval('#btn-primary', (b) => b.disabled)), 'contestants are still joined, so dealing is immediately available');
    await waitFor(alice, () => document.querySelector('#banner-headline').textContent.includes('lobby'));
    check(true, 'contestants go back to the lobby banner');
    check((await alice.$eval('#private-notes', (t) => t.value)) === '', 'notes start fresh for the new round');
    await shot(host, 'host-next-round');

    // ---- refresh resumes the host session -----------------------------
    console.log('\nHOST: refresh resumes the session');
    await host.reload();
    await waitFor(host, (code) => document.querySelector('#session-line').textContent.includes(code), launch.session.public_code);
    check(true, 'a page refresh picks the same session back up');
    check((await text(host, '#now-title')).includes('Invite your contestants'), 'and lands on the right step');

    console.log('\nBROWSER ERRORS:', errors.length ? '' : 'none');
    for (const e of errors) console.log('  ', e);
    if (errors.length) process.exitCode = 1;
    console.log(`SESSION_CODE ${launch.session.public_code} SESSION_ID ${launch.session.id}`);
    console.log('\nBROWSER E2E OK');
  } catch (err) {
    console.error('\nFAILED:', err.message);
    for (const e of errors) console.error('  browser:', e);
    for (const [label, page] of Object.entries(debugPages)) {
      try {
        await page.screenshot({ path: path.join(SHOTS, `FAIL-${label}.png`), fullPage: true });
        const info = await page.evaluate(() => ({
          title: document.querySelector('#now-title')?.textContent,
          primary: document.querySelector('#btn-primary')?.textContent,
          action: document.querySelector('#btn-primary')?.dataset.action,
          disabled: document.querySelector('#btn-primary')?.disabled,
          error: document.querySelector('#now-error')?.hidden === false ? document.querySelector('#now-error').textContent : null,
          banner: document.querySelector('#banner-headline')?.textContent,
          topicHidden: document.querySelector('#topic-card')?.hidden,
          log: [...document.querySelectorAll('#event-log li')].slice(0, 6).map((l) => l.textContent),
        }));
        console.error(`  [${label}]`, JSON.stringify(info));
      } catch (e) {
        console.error(`  [${label}] could not inspect:`, e.message);
      }
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
