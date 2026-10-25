// Sign in with OnlyWorlds, played (Keel #515; contract Forge/Notes/2026-10-25-s474-parlor-sign-in-contract.md),
// on a built parlor with real presses: Playwright serves https://parlor.onlyworlds.com from a build
// directory under its own _headers (the policy, COOP, the callback's block) and _redirects, and plays
// keel's /signin/authorize (a hop back with a code and the SDK's state, or keel's Cancel),
// /api/v2/auth/token (the verifier's S256 must equal the challenge) and the account's calls. What it
// cannot see: Pages' own rules (Boss's preview read) and real keel (the live walk).
//   npm run build && node walk/signin-oauth.mjs [chromium|firefox]        DIST=<dir> for a control
import { chromium, firefox } from '@playwright/test';
import { createHash } from 'node:crypto';
import { hostFor } from './host.mjs';

const DIST = process.env.DIST ?? 'dist';
const PROD = 'https://parlor.onlyworlds.com';
const CALLBACK = `${PROD}/signin/callback`;
const only = process.argv[2];
const TOKEN = 'ow_a_' + 'h'.repeat(40);
const CODE = 'ow_j_' + 'w'.repeat(24);
const WORLD = '0f0f0f0f-0000-4000-8000-00000000a1a1';
let failures = 0;
let firstFail = null;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) { failures++; firstFail ??= what; }
};
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const { serve } = hostFor(DIST);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  const violations = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push(m.text());
    else if (!/Failed to load resource|status of 40\d/.test(m.text())) errors.push(m.text());
  });

  const keel = { mode: 'ok', challenge: '', code: 'c0de-' + tag, calls: [], authorize: [], account: { id: 'acc-1', username: 'wren' }, joined: 0 };
  await ctx.route('https://www.onlyworlds.com/**', async r => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    keel.calls.push(`${m} ${u.pathname}`);
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': PROD, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
    if (m === 'OPTIONS') return json(204, {});
    if (u.pathname === '/signin/authorize') {
      keel.authorize.push(u);
      keel.challenge = u.searchParams.get('code_challenge');
      const state = u.searchParams.get('state');
      const back = keel.mode === 'cancel' ? `${CALLBACK}?error=access_denied&state=${state}` : `${CALLBACK}?code=${keel.code}&state=${state}`;
      // keel answers with a 302; a redirect's next request is not routed, so the fake hops back from a page.
      return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: `<script>location.replace(${JSON.stringify(back)})</script>` });
    }
    if (u.pathname === '/api/v2/auth/token') {
      const b = JSON.parse(r.request().postData());
      const ok = b.code === keel.code && b.client_id === 'parlor' && b.redirect_uri === CALLBACK
        && b64url(createHash('sha256').update(b.code_verifier).digest()) === keel.challenge;
      return ok
        ? json(200, { token: TOKEN, token_type: 'bearer', account: keel.account })
        : json(400, { error: { code: 'invalid_grant', message: 'KEEL TEXT' } });
    }
    if (u.pathname === '/api/v2/join/preview') {
      return json(200, { reader: 'person', world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: 'contributor', with_character: false, expires_at: '2030-10-19T00:00:00+00:00' });
    }
    if (u.pathname === '/api/v2/account/join') {
      keel.joined++;
      return json(200, { world_id: WORLD, world_name: 'The Reach', role: 'contributor' });
    }
    if (u.pathname === '/api/v2/account/worlds') {
      return json(200, { data: [{ id: WORLD, name: 'The Reach', role: 'collaborator', member_role: 'contributor' }] });
    }
    return json(404, { error: { code: 'not_found' } });
  });
  await ctx.route(`${PROD}/**`, async r => r.fulfill(serve(new URL(r.request().url()).pathname)));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'));
  const button = () => page.locator('[data-action="signin-onlyworlds"]');
  // A new document with empty storage (a hash-only goto would keep the page and its session).
  const fresh = async url => {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('about:blank');
    await page.goto(url);
  };
  const problem = () => page.locator('.land > p.problem');

  // P1: on the registered origin the landing's one Entry is Sign in with OnlyWorlds, whose account is said.
  await page.goto(`${PROD}/`);
  await page.waitForSelector('.land');
  check(tag, (await button().count()) === 1 && (await button().evaluate(b => b.classList.contains('entry'))), 'Sign in with OnlyWorlds is the landing\'s Entry on parlor.onlyworlds.com');
  check(tag, (await page.locator('.land .btn.entry:visible').count()) === 1, 'one Entry on the screen');
  check(tag, await page.getByText('It uses the account signed in on onlyworlds.com in this browser.').isVisible(), 'whose account it uses, said before the press');
  check(tag, await page.locator('#password').isHidden(), 'no password box until asked');
  await page.getByRole('button', { name: 'Sign in with a password' }).click();
  check(tag, await page.locator('#password').isVisible() && await page.locator('form button[type=submit]').evaluate(b => b.classList.contains('std')), 'the password form opens, its Sign in Standard');

  // P7: keel's Cancel is said on the landing, nothing kept, the address clean.
  await page.goto(`${PROD}/`);
  keel.mode = 'cancel';
  keel.calls.length = 0;
  await button().click();
  await page.waitForFunction(() => document.querySelector('.land > p.problem:not([hidden])'), null, { timeout: 15000 });
  check(tag, (await problem().textContent()) === 'Sign in with OnlyWorlds was cancelled. Nothing changed.', "keel's Cancel is said on the landing");
  check(tag, (await stored()) === null && !keel.calls.includes('POST /api/v2/auth/token'), 'nothing kept, nothing traded');
  check(tag, new URL(page.url()).pathname === '/' && !/error=|state=/.test(page.url()), `the address is clean (${page.url()})`);

  // The round trip: the code traded first, the token kept, the address clean, Your parlors naming the account.
  keel.mode = 'ok';
  keel.calls.length = 0;
  await button().click();
  await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  const a = keel.authorize.at(-1);
  check(tag, a?.searchParams.get('client_id') === 'parlor' && a.searchParams.get('redirect_uri') === CALLBACK && a.searchParams.get('code_challenge_method') === 'S256', 'authorize names parlor, the registered address, S256');
  const after = keel.calls.slice(keel.calls.indexOf('GET /signin/authorize') + 1).filter(c => !c.startsWith('OPTIONS'));
  check(tag, after[0] === 'POST /api/v2/auth/token', `the exchange is the first call on the return (${after.slice(0, 3).join(', ')})`);
  check(tag, (await stored())?.token === TOKEN && (await stored())?.accountId === 'acc-1', 'the token is kept, with its account');
  check(tag, new URL(page.url()).pathname === '/' && !/code=|state=/.test(page.url()), `the address is clean (${page.url()})`);
  check(tag, await page.getByText('Signed in as wren.', { exact: false }).isVisible(), 'Your parlors names the account');
  check(tag, (await page.evaluate(() => localStorage.getItem('ow_signin:parlor'))) === null, 'the record is gone');
  await page.goBack().catch(() => undefined);
  await page.waitForTimeout(800);
  check(tag, !(await page.getByText('Signing in…').isVisible().catch(() => false)), `Back does not stop on Signing in (${page.url()})`);

  // P8: a return this browser did not start, while signed in: silent, nothing traded.
  keel.calls.length = 0;
  await page.goto(`${CALLBACK}?code=stale&state=stale`);
  await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  check(tag, !keel.calls.includes('POST /api/v2/auth/token') && (await stored())?.token === TOKEN && !(await page.locator('.notice').isVisible().catch(() => false)), 'a return not started here, signed in: silent, nothing traded');
  await page.goto(`${CALLBACK}?error=access_denied&state=x`);
  await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  check(tag, !(await page.locator('.notice').isVisible().catch(() => false)) && (await stored())?.token === TOKEN, 'a crafted Cancel, signed in: silent');

  // P4: a session another tab kept while this one was out (planted after the landing loaded): the
  // same account keeps its keys and PIN; another account starts clean.
  const other = { token: 'ow_a_' + 'o'.repeat(40), login: 'wren', accountId: 'acc-1', pin: '1234', keys: { w: 'ow_k_x' } };
  const pressWithPlanted = async () => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${PROD}/`);
    await button().waitFor();
    await page.evaluate(r => localStorage.setItem('parlor.session.v1', JSON.stringify(r)), other);
    await button().click();
    await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  };
  await pressWithPlanted();
  const s1 = await stored();
  check(tag, s1?.token === TOKEN && s1.pin === '1234' && s1.keys?.w === 'ow_k_x', 'the same account: the new token, keys and the PIN kept');
  keel.account = { id: 'acc-2', username: 'bo' };
  await pressWithPlanted();
  await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  const s2 = await stored();
  check(tag, s2?.accountId === 'acc-2' && !s2.pin && Object.keys(s2.keys).length === 0 && await page.getByText('Signed in as bo.', { exact: false }).isVisible(), 'another account: keys and the PIN dropped, the new name said');
  keel.account = { id: 'acc-1', username: 'wren' };

  // P5: a room that was open comes back.
  await fresh(`${PROD}/#/w/${WORLD}`);
  await button().waitFor();
  keel.calls.length = 0;
  await button().click();
  await page.waitForFunction(w => location.hash === `#/w/${w}`, WORLD, { timeout: 15000 });
  for (let i = 0; i < 30 && !keel.calls.includes('GET /api/v2/account/worlds'); i++) await page.waitForTimeout(200);
  check(tag, keel.calls.includes('POST /api/v2/auth/token') && keel.calls.includes('GET /api/v2/account/worlds'), `the room's address came back and its worlds are read (${new URL(page.url()).hash}; the room itself and its Signed in line are the live walk's, ROOM=1)`);

  // P5 and P6: an invite comes back, and the join is asked, naming the account.
  await fresh(`${PROD}/#/join/${CODE}`);
  await page.getByRole('heading', { name: 'Join The Reach' }).waitFor({ timeout: 15000 });
  check(tag, (await button().textContent()) === 'Sign in to join', 'over an invite the Entry reads Sign in to join');
  keel.joined = 0;
  await button().click();
  const join = page.getByRole('button', { name: /^Join The Reach as / });
  await join.waitFor({ timeout: 15000 });
  check(tag, (await join.textContent()) === 'Join The Reach as wren' && keel.joined === 0, 'the invite came back, asked first, naming the account, nothing spent');
  // The gate's G1: the same link opened again asks again; G3: a reload keeps the question.
  await page.evaluate(c => { location.hash = `#/join/${c}`; }, CODE);
  await page.waitForTimeout(1200);
  check(tag, await join.isVisible() && keel.joined === 0, 'the invite link opened again, signed in: still asked, nothing spent');
  await page.reload();
  await join.waitFor({ timeout: 15000 });
  check(tag, keel.joined === 0, 'a reload of the question keeps the invite, nothing spent');
  await join.click();
  await page.waitForFunction(w => location.hash === `#/w/${w}`, WORLD, { timeout: 15000 });
  check(tag, keel.joined === 1, 'Join spends it once, then the room');

  // The code gate's C3: Not now lets the invite go and frees the tab, across a reload too.
  await page.evaluate(c => { location.hash = `#/join/${c}`; }, CODE);
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  await page.reload();
  await page.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 15000 });
  check(tag, keel.joined === 1 && !(await page.getByRole('button', { name: 'Not now' }).isVisible()), 'Not now: the invite let go, Your parlors, still after a reload, nothing spent');

  // P6: Use another account signs the parlor out and opens the form with the invite kept.
  await fresh(`${PROD}/#/join/${CODE}`);
  await button().waitFor({ timeout: 15000 });
  keel.joined = 0;
  await button().click();
  await page.getByRole('button', { name: 'Use another account' }).click();
  await page.locator('#password').waitFor({ state: 'visible', timeout: 15000 });
  check(tag, (await stored()) === null && keel.joined === 0 && await page.getByRole('heading', { name: 'Join The Reach' }).isVisible(), 'Use another account: signed out, the form open, the invite still shown, nothing spent');
  check(tag, (await button().isVisible()) === false && (await page.locator('.land .btn.entry:visible').count()) === 1, 'and the button that would bring back the same account is gone, the form\'s Sign in the Entry');

  // P7: a refusal keeps the invite waiting.
  await fresh(`${PROD}/#/join/${CODE}`);
  await button().waitFor({ timeout: 15000 });
  keel.mode = 'cancel';
  await button().click();
  await page.waitForFunction(() => document.querySelector('.land > p.problem:not([hidden])'), null, { timeout: 15000 });
  check(tag, await page.getByRole('heading', { name: 'Join The Reach' }).isVisible(), 'Cancel over an invite: the invite still waits');
  keel.mode = 'ok';

  check(tag, violations.length === 0, `0 policy violations${violations.length ? ': ' + violations.join(' | ') : ''}`);
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

for (const [engine, tag] of [[chromium, 'chromium'], [firefox, 'firefox']]) {
  if (only && only !== tag) continue;
  await walk(engine, tag).catch(e => { failures++; firstFail ??= `aborted: ${e.message.split('\n')[0]}`; console.log(`[${tag}] ABORT ${e.message.split('\n')[0]}`); });
}
console.log(failures ? `\n${failures} FAILED (first: ${firstFail})` : '\nall ok');
process.exit(failures ? 1 : 0);
