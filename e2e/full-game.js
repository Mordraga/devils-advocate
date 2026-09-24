// Full-game browser test: drives the real pages in real Chrome - a host, two
// contestants (separate storage, like real players), three audience phones,
// an OBS-style overlay and a watch page - through two whole rounds:
//   round 1: audience voting decides the polls
//   round 2: the host types the results by hand (the Twitch fallback)
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
let allow409 = 0; // a deliberate refusal (e.g. "no votes yet") logs a 409 in the console
let allow404 = 0; // ...and a deliberately wrong room code logs a 404
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
    if (m.type() !== 'error') return;
    if (allow409 > 0 && /status of 409/.test(m.text())) {
      allow409 -= 1;
      return;
    }
    if (allow404 > 0 && /status of 404/.test(m.text())) {
      allow404 -= 1;
      return;
    }
    errors.push(`[${label}] console: ${m.text()}`);
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
    // ================================================================ host
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
    host.on('response', async (r) => {
      if (r.url().endsWith('/sessions/launch') && r.request().method() === 'POST') launch = await r.json();
    });
    // A button that says "Working..." is disabled; wait for it like a person would.
    const clickPrimary = async () => {
      await waitFor(host, () => {
        const b = document.querySelector('#btn-primary');
        return !b.disabled && b.textContent !== 'Working…';
      });
      await host.click('#btn-primary');
    };
    const setMinutes = async (value) => {
      await host.$eval('#input-minutes', (i) => (i.value = ''));
      await host.type('#input-minutes', String(value));
    };
    const title = (t) => waitFor(host, (x) => document.querySelector('#now-title').textContent.includes(x), t);

    await host.goto(`${CLIENT}/host.html`);
    await waitFor(host, () => document.querySelector('#btn-primary')?.textContent.includes('Start a session'));
    check(!(await visible(host, '#stepper')), 'no stepper before a session exists');
    await shot(host, 'host-empty');

    await clickPrimary();
    await title('Invite your contestants');
    const code = launch.session.public_code;
    check(launch && launch.invites.length === 2, 'launch returned two invites');
    check((await host.$$('#now-invites .invite-row')).length === 2, 'two invite rows are shown as step one');
    check(await host.$eval('#btn-primary', (b) => b.disabled), 'deal is locked until both contestants join');
    check((await text(host, '#now-hint')).includes('Waiting for'), 'the hint says who we are waiting for');
    check((await text(host, '#now-step')) === 'Step 1 of 8', 'step counter reads 1 of 8');
    await shot(host, 'host-invite-step');

    // The copy button either writes to the clipboard (flashes "Copied") or,
    // if the browser refuses, falls back to a prompt holding the link.
    await host.bringToFront();
    await host.click('#now-invites .invite-row button');
    await sleep(400);
    const flashed = await host.$eval('#now-invites .invite-row button', (b) => b.textContent);
    const clip = await host.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    const link = [clip, ...prompts].find((t) => t && t.includes('/play.html?token='));
    check(flashed.includes('Copied') || Boolean(link), 'the copy button either copies the invite link or shows it for manual copy');

    // ========================================================== contestants
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
      }
    }
    const { Alice: alice, Bob: bob } = players;
    await waitFor(alice, () => document.querySelector('#banner-body').textContent.includes('Bob is here'));
    check(true, 'Alice is told Bob has arrived (live roster over the websocket)');
    await waitFor(host, () => !document.querySelector('#btn-primary').disabled);
    check((await host.$$eval('#now-invites .badge-gold', (e) => e.length)) === 2, 'host roster shows both contestants joined');

    // ============================================== audience + stream screens
    console.log('\nAUDIENCE: three phones, the landing page, and the stream overlay');
    // The Jackbox-style way in: type the room code on the landing page.
    const { page: landing } = await newPage(browser, 'landing', { width: 420, height: 800 });
    await landing.goto(`${CLIENT}/index.html`);
    await landing.type('#room-code-input', 'ZZZZZZ');
    allow404 += 1;
    await landing.click('#join-submit');
    await landing.waitForSelector('#join-error:not([hidden])', { timeout: 10000 });
    check((await text(landing, '#join-error')).includes("couldn't find"), 'a wrong room code is refused with a helpful message');
    await landing.$eval('#room-code-input', (i) => (i.value = ''));
    await landing.type('#room-code-input', code.toLowerCase());
    await Promise.all([landing.waitForNavigation({ timeout: 15000 }), landing.click('#join-submit')]);
    check(landing.url().includes(`watch.html?session=${code}`), 'the right room code (any case) lands on the watch page');
    await waitFor(landing, () => document.querySelector('#connection-pill').textContent === 'Live');

    const voters = [landing];
    for (let i = 2; i <= 3; i++) {
      const { page } = await newPage(browser, `voter${i}`, { width: 420, height: 800 });
      await page.goto(`${CLIENT}/watch.html?session=${code}`);
      await waitFor(page, () => document.querySelector('#connection-pill').textContent === 'Live');
      voters.push(page);
    }
    check((await text(voters[0], '#room-code')) === `Room ${code}`, 'the watch page shows the room code');
    check((await text(voters[0], '#overlay-roster')) === 'Alice vs Bob', 'standby shows who is playing ("Alice vs Bob")');
    check((await text(voters[0], '#overlay-join')).includes(code), 'standby says how to join, with the room code');
    check(!(await visible(voters[0], '#vote-card')), 'no vote buttons while no poll is open');

    const { page: overlay } = await newPage(browser, 'overlay', { width: 1280, height: 720 });
    await overlay.goto(`${CLIENT}/overlay.html?session=${code}`);
    await waitFor(overlay, (c) => document.querySelector('#overlay-join').textContent.includes(c), code);
    check(true, 'the stream overlay also shows the join line on standby');

    // ================================================================ ROUND 1
    console.log('\nROUND 1 - HOST: draw topic & sides');
    await clickPrimary();
    await title('Topic locked in');
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

    console.log('\nROUND 1 - HOST: reveal');
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
    await shot(alice, 'alice-revealed');

    console.log('\nROUND 1 - HOST: start preparation (2 min) and check the timers tick');
    await title('Topic revealed'); // the panel redraws a beat after the contestants' screens do
    await setMinutes(2);
    await clickPrimary();
    await waitFor(alice, () => !document.querySelector('#timer-card').hidden);
    check(/^\d\d:\d\d$/.test(await text(alice, '#timer-display')), 'the timer card never shows a blank clock');
    await sleep(600);
    const t1 = await text(alice, '#timer-display');
    await sleep(2200);
    const t2 = await text(alice, '#timer-display');
    check(/^\d\d:\d\d$/.test(t2) && t1 !== t2, `the contestant countdown ticks (${t1} -> ${t2})`);
    check((await text(alice, '#timer-label')) === 'Prep time left', 'timer is labelled for prep');
    check(/^\d\d:\d\d$/.test(await text(host, '#timer-display')), 'the host timer shows a running countdown');
    await alice.type('#private-notes', 'my prep notes');
    await host.click('#btn-timer-toggle');
    await waitFor(alice, () => !document.querySelector('#timer-note').hidden);
    check((await text(alice, '#timer-note')).includes('paused'), 'contestant is told when the host pauses the timer');
    await waitFor(host, () => document.querySelector('#btn-timer-toggle').textContent.includes('Resume'));
    await host.click('#btn-timer-toggle');
    await waitFor(alice, () => document.querySelector('#timer-note').hidden);
    check(true, 'resuming clears the paused note');

    // ---------------------------------------------------------- opening vote
    console.log('\nROUND 1 - AUDIENCE: opening vote');
    await clickPrimary();
    await title('Opening vote');
    for (const v of voters) await waitFor(v, () => !document.querySelector('#vote-card').hidden);
    check(true, 'all three audience phones get the vote buttons the moment the poll opens');
    check((await text(voters[0], '#vote-question')).includes('right now'), 'the opening question is worded for the opening poll');
    const sideAText = await text(voters[0], '#vote-a-text');
    const sideBText = await text(voters[0], '#vote-b-text');
    check(sideAText.length > 0 && sideBText.length > 0 && sideAText !== sideBText, `vote buttons carry the two sides ("${sideAText}" / "${sideBText}")`);
    check((await text(voters[0], '#vote-a-by')).startsWith('argued by'), 'each side says who argues it');
    check((await text(alice, '#banner-headline')).includes('voting'), 'contestants are told the audience is voting');
    await waitFor(overlay, () => !document.querySelector('#overlay-poll-indicator').hidden);
    check((await text(overlay, '#overlay-poll-join')).includes(code), 'the stream overlay shows where to vote, with the room code');
    check((await text(overlay, '#overlay-poll-count')).includes('Waiting'), 'and that no votes are in yet');
    await shot(voters[0], 'phone-vote-open');

    const vote = async (page, side) => {
      await page.click(`#vote-${side.toLowerCase()}`);
      await waitFor(page, (s) => document.querySelector(`#vote-${s}`).getAttribute('aria-pressed') === 'true', side.toLowerCase());
    };
    await vote(voters[0], 'B'); // changes their mind below
    await vote(voters[1], 'A');
    await vote(voters[2], 'B');
    await vote(voters[0], 'A'); // final: A, A, B
    check((await text(voters[0], '#vote-status')).includes('Your vote is in'), 'a voter is told their vote is in, and can change it');
    await waitFor(host, () => document.querySelector('#now-hint').textContent.includes('3 votes in so far'));
    check(true, 'the host sees turnout (3 votes, counted once per person even though one changed their mind)');
    await waitFor(overlay, () => document.querySelector('#overlay-poll-count').textContent.includes('3 votes'));
    check(true, 'and the stream overlay shows the same count');
    const secret = await voters[0].evaluate(() => document.body.innerText);
    check(!/\d+(\.\d+)?%/.test(secret), 'no percentages or split are visible to viewers while voting is open');

    await voters[2].reload();
    await waitFor(voters[2], () => !document.querySelector('#vote-card').hidden);
    await waitFor(voters[2], () => document.querySelector('#vote-b').getAttribute('aria-pressed') === 'true');
    check(true, "a viewer's vote is remembered across a page reload");

    await setMinutes(3);
    await shot(host, 'host-opening-vote');
    await clickPrimary();
    await title('Debate');
    for (const v of voters) await waitFor(v, () => document.querySelector('#vote-card').hidden);
    check(true, 'closing voting takes the vote buttons away');
    await waitFor(overlay, () => document.querySelector('#overlay-split-text').textContent.includes('66.7%'));
    const split = await text(overlay, '#overlay-split-text');
    check(split.includes('33.3%') && split.startsWith('Chat started'), `the overlay reveals the starting split during the debate ("${split}")`);
    check((await text(alice, '#timer-label')) === 'Debate time left', 'timer relabels for the debate');
    check((await alice.$eval('#private-notes', (t) => t.value)) === 'my prep notes', 'notes survive the phase change');
    await shot(overlay, 'overlay-debate-split');

    // ---------------------------------------------------------- closing vote
    console.log('\nROUND 1 - AUDIENCE: closing vote and results');
    await clickPrimary();
    await title('Closing vote');
    for (const v of voters) await waitFor(v, () => !document.querySelector('#vote-card').hidden);
    check((await text(voters[0], '#vote-kicker')) === 'Final vote', 'the closing poll is labelled as the final vote');
    check((await voters[0].$eval('#vote-a', (b) => b.getAttribute('aria-pressed'))) === 'false', "last poll's vote is not carried over");
    await vote(voters[0], 'B');
    await vote(voters[1], 'B');
    await vote(voters[2], 'A'); // closing: A 33.3 / B 66.7, so side B gained
    await waitFor(host, () => document.querySelector('#now-hint').textContent.includes('3 votes in so far'));
    await clickPrimary();
    await waitFor(host, () => /won|draw/.test(document.querySelector('#now-title').textContent));
    const winnerTitle = await text(host, '#now-title');
    await waitFor(alice, () => !document.querySelector('#results-card').hidden);
    await waitFor(bob, () => !document.querySelector('#results-card').hidden);
    const aliceHead = await text(alice, '#banner-headline');
    const bobHead = await text(bob, '#banner-headline');
    check([aliceHead, bobHead].sort().join('|') === ['You won!', 'Your opponent won'].sort().join('|'), `exactly one contestant sees "You won!" (${aliceHead} / ${bobHead})`);
    const sideBName = /Alice/.test(sides.find((s) => s.startsWith('Side B'))) ? 'Alice' : 'Bob';
    check(winnerTitle === `${sideBName} won`, `the side the audience swung towards (B, ${sideBName}) is the winner`);
    check((sideBName === 'Alice' ? aliceHead : bobHead) === 'You won!', 'and that contestant sees "You won!"');
    const lines = await alice.$$eval('#results-lines li', (e) => e.map((l) => l.textContent));
    check(lines.length === 2 && lines.every((l) => l.includes('→')), `results card shows both sides' swing (${lines.join(' | ')})`);
    await waitFor(voters[0], () => document.querySelector('#overlay-sway').textContent.includes('Chat swung'));
    check((await text(voters[0], '#overlay-sway')).includes('33.3 points'), `the watch page shows the audience swing ("${await text(voters[0], '#overlay-sway')}")`);
    await shot(alice, 'alice-results');
    await shot(voters[0], 'phone-results');

    // ================================================================ ROUND 2
    console.log('\nROUND 2 - HOST: next round, then the manual (Twitch) fallback');
    await clickPrimary();
    await title('Invite your contestants');
    check(!(await host.$eval('#btn-primary', (b) => b.disabled)), 'contestants are still joined, so dealing is immediately available');
    await waitFor(alice, () => document.querySelector('#banner-headline').textContent.includes('lobby'));
    check((await alice.$eval('#private-notes', (t) => t.value)) === '', 'notes start fresh for the new round');
    await waitFor(voters[0], () => !document.querySelector('#overlay-standby').hidden);
    check(true, 'the audience screens go back to standby');

    await clickPrimary();
    await title('Topic locked in');
    const sides2 = await host.$$eval('#table-sides li', (e) => e.map((l) => l.textContent));
    await clickPrimary();
    await title('Topic revealed');
    await setMinutes(1);
    await clickPrimary();
    await title('Contestants are preparing');
    await clickPrimary();
    await title('Opening vote');

    allow409 += 1;
    await clickPrimary(); // no votes were cast
    await waitFor(host, () => !document.querySelector('#now-error').hidden);
    check((await text(host, '#now-error')).includes('No votes yet'), 'closing an empty poll is refused with a clear message');
    check((await text(host, '#now-title')) === 'Opening vote', 'and the host stays on the same step');

    await host.click('#manual-poll summary');
    await host.type('#poll-a', '70');
    check((await host.$eval('#poll-b', (i) => i.value)) === '30', 'the manual fallback autofills the other side');
    await setMinutes(1);
    await clickPrimary();
    await title('Debate');
    check(true, 'a result entered by hand still starts the debate');
    await clickPrimary();
    await title('Closing vote');
    await host.click('#manual-poll summary');
    await host.type('#poll-a', '54');
    check((await host.$eval('#poll-b', (i) => i.value)) === '46', 'closing fallback autofills too');
    await clickPrimary();
    await waitFor(host, () => /won|draw/.test(document.querySelector('#now-title').textContent));
    const sideB2 = /Alice/.test(sides2.find((s) => s.startsWith('Side B'))) ? 'Alice' : 'Bob';
    check((await text(host, '#now-title')) === `${sideB2} won`, `manual results score correctly (B gained 30 to 46, so ${sideB2} wins)`);
    await shot(host, 'host-results');

    // ============================================ refresh resumes the host
    console.log('\nHOST: refresh resumes the session');
    await host.reload();
    await waitFor(host, (c) => document.querySelector('#session-line').textContent.includes(c), code);
    check(true, 'a page refresh picks the same session back up');
    check(/won|draw/.test(await text(host, '#now-title')), 'and lands on the right step');

    console.log('\nBROWSER ERRORS:', errors.length ? '' : 'none');
    for (const e of errors) console.log('  ', e);
    if (errors.length) process.exitCode = 1;
    console.log(`SESSION_CODE ${code} SESSION_ID ${launch.session.id}`);
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
          disabled: document.querySelector('#btn-primary')?.disabled,
          hint: document.querySelector('#now-hint')?.textContent,
          error: document.querySelector('#now-error')?.hidden === false ? document.querySelector('#now-error').textContent : null,
          banner: document.querySelector('#banner-headline')?.textContent,
          voteCardHidden: document.querySelector('#vote-card')?.hidden,
          voteStatus: document.querySelector('#vote-status')?.textContent,
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
