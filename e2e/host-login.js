// Browser test for the host sign-in gate and the Twitch login round trip, run
// against the real auth code with a fake Twitch behind it (no database, no
// Twitch account needed).
//
//   (cd draga-server   && python tests/fake_login_server.py)   # :8000
//   (cd devils-advocate/client && python -m http.server 8080)  # :8080
//   node host-login.js
//
// The browser is pointed at the fake Twitch by intercepting the redirect to
// id.twitch.tv and bouncing straight back to our callback, exactly as Twitch
// would after the host clicks "Authorize".
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const CLIENT = 'http://localhost:8080';
const API = 'http://localhost:8000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
};

async function newPage(browser, errors) {
  const context = await browser.createBrowserContext(); // its own cookies and storage
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.host === 'id.twitch.tv' && url.pathname === '/oauth2/authorize') {
      // Twitch approves and sends the browser back with a code and our state.
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'fake-code');
      back.searchParams.set('state', url.searchParams.get('state'));
      req.respond({ status: 302, headers: { location: back.toString() } });
    } else {
      req.continue();
    }
  });
  return page;
}

const gateVisible = (page) => page.$eval('.auth-gate', (e) => e.offsetParent !== null).catch(() => false);
const label = (page) => page.$eval('.account-label', (e) => e.textContent.trim()).catch(() => null);
const setTwitchAccount = (page, name) => page.evaluate((u) => fetch(u), `${API}/__login?name=${name}`);

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    console.log('Signed out: the page is locked behind a sign-in card');
    let page = await newPage(browser, errors);
    await page.goto(`${CLIENT}/topics.html`, { waitUntil: 'networkidle0' });
    check(await gateVisible(page), 'a sign-in card appears');
    check(await page.$eval('.auth-gate a.btn', (e) => /Twitch/.test(e.textContent)), 'it offers Log in with Twitch');
    check(await page.$eval('#topic-list', (e) => e.offsetParent === null), 'the topics page underneath is hidden');
    check(await page.$eval('.gate-token', (e) => !e.open), 'the admin token option is tucked away');

    console.log('Admin token fallback');
    await page.click('.gate-token summary');
    await page.type('#gate-token', 'wrong-token');
    await page.click('.gate-token-form button');
    await page.waitForFunction(() => document.querySelector('.auth-gate .now-error')?.textContent.includes("wasn't accepted"));
    check(true, 'a wrong token is refused with a message');
    await page.$eval('#gate-token', (e) => (e.value = ''));
    await page.type('#gate-token', 'shared-secret');
    await page.click('.gate-token-form button');
    await page.waitForFunction(() => !document.querySelector('.auth-gate'));
    check((await label(page)) === 'Using the admin token', 'the right token unlocks the page');
    check(await page.$eval('#topic-list', (e) => e.offsetParent !== null || e.children.length === 0), 'the topics page loads');
    await page.reload({ waitUntil: 'networkidle0' });
    check(!(await gateVisible(page)) && (await label(page)) === 'Using the admin token', 'the token is remembered across a reload');
    await page.click('.account-bar .link-btn');
    await page.waitForFunction(() => document.querySelector('.auth-gate'));
    check(await gateVisible(page), 'signing out shows the sign-in card again');
    await page.close();

    console.log('Twitch login: an allowed account');
    page = await newPage(browser, errors);
    await setTwitchAccount(page, 'mordraga0').catch(() => {});
    await page.goto(`${CLIENT}/topics.html`, { waitUntil: 'networkidle0' });
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.auth-gate a.btn')]);
    check(page.url().startsWith(`${CLIENT}/topics.html`) && !page.url().includes('auth='), 'Twitch sends the browser back to the page it started on');
    check(!(await gateVisible(page)), 'no sign-in card any more');
    check((await label(page)) === 'Signed in as Mordraga0', 'the header says who is signed in');
    check(!(await page.evaluate(() => document.cookie)).includes('da_host'), 'the session cookie is HttpOnly - page scripts cannot read it');
    check(!(await page.evaluate(() => localStorage.getItem('devils-advocate:admin-token'))), 'no admin token was stored');
    await page.reload({ waitUntil: 'networkidle0' });
    check(!(await gateVisible(page)) && (await label(page)) === 'Signed in as Mordraga0', 'the login survives a reload');
    const cookies = await page.cookies(API);
    const host = cookies.find((c) => c.name === 'da_host');
    check(host && host.httpOnly && host.sameSite === 'Lax', 'the cookie is HttpOnly and SameSite=Lax');

    console.log('Sign out clears the cookie');
    await page.click('.account-bar .link-btn');
    await page.waitForFunction(() => document.querySelector('.auth-gate'));
    check(!(await page.cookies(API)).some((c) => c.name === 'da_host'), 'the session cookie is gone');
    await page.close();

    console.log('Twitch login: an account that is not on the list');
    page = await newPage(browser, errors);
    await setTwitchAccount(page, 'somebodyelse').catch(() => {});
    await page.goto(`${CLIENT}/host.html`, { waitUntil: 'networkidle0' });
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.auth-gate a.btn')]);
    check(await gateVisible(page), 'they land back on the sign-in card');
    check(await page.$eval('.auth-gate .now-error', (e) => /host list/.test(e.textContent) && !e.hidden), 'it says the account is not on the host list');
    check(!page.url().includes('auth='), 'the address is tidied so a refresh does not repeat the message');
    check(!(await page.cookies(API)).some((c) => c.name === 'da_host'), 'no session was created');
    await page.close();

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log('\nAll host-login checks passed.');
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
