// Browser checks for the ritual layer (motion + generated sound). Needs no
// server: the pages are served statically and the shared state is driven
// directly, so it runs anywhere Chrome is installed.
//
//   (cd client && python -m http.server 8080)
//   node ritual-check.js [client url] [screenshot dir]
//
// Part 1 renders every sound effect offline and checks it is audible, never
// clips, is finite and dies away. Part 2 drives the overlay through a round
// and checks the right class, sound and settled frame at each step. Part 3
// checks reduced motion and the sound toggle on the watch page.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const CLIENT = process.argv[2] || 'http://localhost:8080';
const SHOTS = process.argv[3];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
};
const shot = (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

// Counts every oscillator the page creates, which is how we see sound being made.
const COUNT_OSCILLATORS = () => {
  window.__osc = 0;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Ctor = window[name];
    if (!Ctor) continue;
    const original = Ctor.prototype.createOscillator;
    Ctor.prototype.createOscillator = function () {
      window.__osc += 1;
      return original.call(this);
    };
  }
};

async function part1(browser) {
  console.log('Part 1: every effect, rendered offline');
  const page = await browser.newPage();
  await page.goto(`${CLIENT}/index.html`);
  const report = await page.evaluate(async () => {
    const sound = await import('/js/sound.js');
    const out = {};
    for (const name of sound.SOUND_NAMES) {
      const samples = await sound.renderOffline(name, { seconds: 4 });
      let peak = 0;
      let sumSquares = 0;
      let finite = true;
      for (const v of samples) {
        if (!Number.isFinite(v)) finite = false;
        peak = Math.max(peak, Math.abs(v));
        sumSquares += v * v;
      }
      let tail = 0;
      for (let i = samples.length - 4410; i < samples.length; i++) tail = Math.max(tail, Math.abs(samples[i]));
      out[name] = { peak, rms: Math.sqrt(sumSquares / samples.length), tail, finite };
    }
    return out;
  });
  for (const [name, r] of Object.entries(report)) {
    check(r.finite, `${name}: no NaN/Infinity`);
    check(r.peak > 0.03, `${name}: audible (peak ${r.peak.toFixed(2)})`);
    check(r.peak <= 1, `${name}: does not clip (peak ${r.peak.toFixed(2)})`);
    check(r.tail < 0.005, `${name}: has died away by 4s (tail ${r.tail.toFixed(4)})`);
  }
  await page.close();
}

async function part2(browser) {
  console.log('Part 2: the overlay through a round');
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(COUNT_OSCILLATORS);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${CLIENT}/overlay.html`, { waitUntil: 'networkidle0' });

  const patch = (p) => page.evaluate(async (patch) => (await import('/js/state.js')).applyPatch(patch), p);
  const oscillators = () => page.evaluate(() => window.__osc);
  const bodyClass = () => page.evaluate(() => document.body.className);
  const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop);
  const topic = { prompt: 'Is a hot dog a sandwich?', explainer: 'Meat inside bread.', sideA: 'Yes', sideB: 'No', category: 'food_court', tags: [] };
  const contestants = { A: { id: 'a', displayName: 'Alice' }, B: { id: 'b', displayName: 'Bob' } };

  check(await page.$eval('.cauldron', (e) => e.getBoundingClientRect().width > 100), 'standby shows the cauldron');
  await shot(page, '01-standby');

  // The overlay makes sound by itself once the browser allows it.
  await page.waitForFunction(() => window.__osc !== undefined);
  const audioRunning = await page.evaluate(async () => (await import('/js/sound.js')).isEnabled());
  check(audioRunning, 'overlay switched its sound on without a click');

  // First snapshot after connecting: catching up, so silent and un-animated.
  await patch({ connectionStatus: 'online', phase: 'DEBATE', topic, contestants });
  await sleep(300);
  check((await oscillators()) === 0, 'joining mid-debate plays nothing');
  check(!/ritual-/.test(await bodyClass()), 'joining mid-debate starts no animation');
  await patch({ phase: 'LOBBY', topic: null });
  await patch({ connectionStatus: 'stale' });
  await patch({ connectionStatus: 'online' }); // reconnect: baseline again

  // Drawing the topic.
  await patch({ phase: 'TOPIC_LOCKED', topic });
  await sleep(250);
  check(/ritual-lock/.test(await bodyClass()), 'TOPIC_LOCKED starts the draw ritual');
  const afterDraw = await oscillators();
  // The draw (rumble + bubbles) and the seal (thunk + ring) are both queued at once; the seal starts 0.9s later.
  check(afterDraw >= 15, `the draw and the seal are both queued (${afterDraw} voices)`);
  check((await style('.seal', 'opacity')) === '0', 'the seal has not landed yet');
  await sleep(1500);
  check((await style('.seal', 'opacity')) === '1', 'the seal is stamped');
  await shot(page, '02-sealed');
  await sleep(3000);
  check(!/ritual-/.test(await bodyClass()), 'the ritual class clears itself');
  check((await style('#overlay-topic h1', 'opacity')) === '1' && (await style('#overlay-topic h1', 'filter')) === 'none', 'the topic settles into a sharp, readable frame');

  // Reveal.
  let before = await oscillators();
  await patch({ phase: 'REVEAL' });
  await sleep(300);
  check(/ritual-reveal/.test(await bodyClass()), 'REVEAL starts the reveal ritual');
  check((await oscillators()) > before, 'the reveal makes sound');
  await sleep(1200);
  await shot(page, '03-reveal');
  await sleep(2600);
  const cards = await page.$$eval('#overlay-sides .stance-card', (els) => els.map((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform]));
  check(cards.length === 2 && cards.every(([o, t]) => o === '1' && (t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)')), 'both side cards settle in place');

  // Prep and the opening vote begin together: the prep bell, then the voting chime.
  before = await oscillators();
  await patch({
    phase: 'PREPARATION',
    poll: { kind: 'opening', open: true, total: 0 },
    timer: { startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 16000).toISOString(), pausedAt: null, remainingMs: null },
    serverOffsetMs: 0,
  });
  await sleep(300);
  check(/ritual-prep/.test(await bodyClass()), 'starting prep starts the prep ritual');
  await sleep(1500); // the voting chime follows the bell by about a second
  check((await oscillators()) - before >= 10, 'the prep bell and the voting chime both sound');
  before = await oscillators();
  await patch({ poll: { kind: 'opening', open: true, total: 1 } });
  await sleep(150);
  check((await oscillators()) > before, 'a new vote pops on the overlay');
  check(await page.$eval('#overlay-poll-indicator', (e) => !e.hidden) && (await page.$eval('#overlay-timer', (e) => !e.hidden)), 'the overlay shows the vote count and the prep clock together');

  // The countdown (still running from the start of prep).
  check(!/timer-low/.test(await bodyClass()), 'no warning with plenty of time left');
  before = await oscillators();
  await sleep(6000);
  check(/timer-low/.test(await bodyClass()), 'the last ten seconds turn the clock red');
  check((await oscillators()) - before >= 2, 'the last seconds tick');
  await shot(page, '04-timer-low');
  before = await oscillators();
  await sleep(9500);
  check((await oscillators()) - before >= 6, 'time up sounds a gong');
  check(!/timer-low/.test(await bodyClass()), 'the warning clears at zero');

  // Winner.
  before = await oscillators();
  await patch({ phase: 'RESULTS', winner: 'A', results: { openingA: 40, openingB: 60, closingA: 62, closingB: 38, swayA: 22, swayB: -22 }, timer: { startedAt: null, endsAt: null, pausedAt: null, remainingMs: null } });
  await sleep(700);
  check(/ritual-winner/.test(await bodyClass()), 'RESULTS starts the winner flourish');
  check((await oscillators()) - before >= 8, 'the winner bell rings');
  check((await page.$$('.sparkles i')).length > 5, 'sparks fly');
  await shot(page, '05-winner');
  await sleep(3800);
  check((await page.$$('.sparkles')).length === 0, 'the sparks clear away');
  check((await style('#overlay-winner', 'opacity')) === '1', 'the winner name is fully visible');

  // Emergency hide is silent.
  before = await oscillators();
  await patch({ hidden: true, phase: 'ARCHIVED' });
  await sleep(300);
  check((await oscillators()) === before, 'a hidden overlay stays silent');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.close();
}

async function part3(browser) {
  console.log('Part 3: reduced motion, and the sound toggle on the watch page');
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const overlay = await browser.newPage();
  await overlay.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await overlay.goto(`${CLIENT}/overlay.html`, { waitUntil: 'networkidle0' });
  check((await overlay.$eval('.cauldron .bubbles circle', (e) => getComputedStyle(e).animationName)) !== 'none', 'the OBS overlay animates even when the PC asks for reduced motion');
  await overlay.close();
  await page.goto(`${CLIENT}/watch.html?session=ABC123`, { waitUntil: 'networkidle0' });
  const bubble = await page.$eval('.cauldron .bubbles circle', (e) => getComputedStyle(e).animationName);
  check(bubble === 'none', 'on the watch page, reduced motion stills the cauldron');
  await page.evaluate(async () => {
    const { applyPatch } = await import('/js/state.js');
    applyPatch({ connectionStatus: 'online', phase: 'LOBBY' });
    applyPatch({ phase: 'REVEAL', topic: { prompt: 'x', sideA: 'a', sideB: 'b', tags: [] }, contestants: { A: { id: 'a', displayName: 'A' }, B: { id: 'b', displayName: 'B' } } });
  });
  await sleep(200);
  const still = await page.$eval('#overlay-sides .stance-card', (e) => [getComputedStyle(e).animationName, getComputedStyle(e).opacity]);
  check(still[0] === 'none' && still[1] === '1', 'reduced motion shows the reveal already finished');
  await page.close();

  const watch = await browser.newPage();
  await watch.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await watch.goto(`${CLIENT}/watch.html?session=ABC123`);
  const button = () => watch.$eval('#sound-toggle', (e) => [e.textContent.trim(), e.getAttribute('aria-pressed')]);
  const stored = () => watch.evaluate(() => localStorage.getItem('devils-advocate:sound'));
  check((await button())[0] === 'Enable sound', 'watch page starts with sound off');
  await watch.click('#sound-toggle');
  await sleep(300);
  check((await button())[0] === 'Sound on' && (await stored()) === 'on', 'tapping turns sound on and remembers it');
  await watch.click('#sound-toggle');
  await sleep(200);
  check((await button())[0] === 'Enable sound' && (await stored()) === 'off', 'tapping again turns it off');
  await watch.click('#sound-toggle');
  await sleep(300);
  await watch.reload();
  check((await button())[0] === 'Enable sound', 'after a reload it waits for a tap (browsers require one)');
  await watch.mouse.click(20, 400);
  await sleep(400);
  check((await button())[0] === 'Sound on', 'a remembered "on" wakes up on the first tap anywhere');
  await watch.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    await part1(browser);
    await part2(browser);
    await part3(browser);
    console.log('\nAll ritual checks passed.');
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
