// Sign in with OnlyWorlds read live:
// a crew account signed in on onlyworlds.com (its own form, in the walk's browser) presses the button
// on the parlor, takes the consent page if it shows, and must land on Your parlors signed in with
// nothing typed into the parlor. Real keel throughout. With DIST set, https://parlor.onlyworlds.com is
// served from that build (under its _headers and _redirects) so a build is read against real keel
// before it flies; without it, the live host. The token the parlor kept is revoked by its own id (only
// that one), then must answer 401; the walk's own token last. Credentials from CREW_WALK_ACCOUNTS,
// never printed.
//   CREW_WALK_ACCOUNTS=<file> [DIST=dist] node walk/live-signin-ow.mjs <out-prefix> [chromium|firefox] [crew-walk-b]
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, API } from './accounts.mjs';
import { hostFor } from './host.mjs';

const [, , out = 'live-signin-ow', engineName = 'chromium', label = 'crew-walk-b'] = process.argv;
const PARLOR = 'https://parlor.onlyworlds.com';
const { email, password } = account(label);
const b = await (engineName === 'firefox' ? firefox : chromium).launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
if (process.env.DIST) {
  const { serve } = hostFor(process.env.DIST);
  await ctx.route(`${PARLOR}/**`, r => r.fulfill(serve(new URL(r.request().url()).pathname)));
  // keel's answer back to the parlor is a 302, and Playwright does not route a redirect's next
  // request (it reached the live host on the first run): real keel answers, and its Location is
  // followed from a page, so the callback comes through the route above.
  await ctx.route('https://www.onlyworlds.com/signin/authorize**', async r => {
    const res = await r.fetch({ maxRedirects: 0 });
    const to = res.headers()['location'] ?? '';
    if (res.status() >= 300 && res.status() < 400 && to.startsWith(`${PARLOR}/`)) {
      return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: `<script>location.replace(${JSON.stringify(to)})</script>` });
    }
    return r.fulfill({ response: res });
  });
}
const p = await ctx.newPage();
const errors = [];
const violations = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push(m.text()); });
const keel = [];
p.on('request', r => { const u = r.url(); if (u.includes('/signin/') || u.includes('/auth/token')) keel.push(`${r.method()} ${u.replace(/(code|state|code_challenge)=[^&]+/g, '$1=…')}`); });
const report = { parlor: process.env.DIST ? `${PARLOR} from ${process.env.DIST}` : PARLOR, engine: engineName, steps: [] };
const step = s => report.steps.push(s);

// 0. The walk's own token, minted and recorded, to read the account's token ids before the press: the
// one revoked after is the one id that was not there before.
const walkToken = await new OwV2Client({ baseUrl: API, client: 'parlor' }).signInWithPassword({ email, password, tokenName: 'Parlor walk S474' });
const walkAuth = { Authorization: `Bearer ${walkToken.token}` };
const tokenIds = async () => ((await (await fetch(`${API}/account/tokens`, { headers: walkAuth })).json()).data ?? []);
const listed = await tokenIds();
const before = new Set(listed.map(t => t.id));
report.tokensBefore = before.size;
// Anything live a parlor walk or the parlor left before this run, by name (read, never deleted here;
// keel lists revoked rows too, marked `revoked`).
report.parlorTokensLiveBefore = listed.filter(t => /^Parlor/.test(t.name ?? '') && !t.revoked && t.id !== walkToken.id).map(t => `${t.name} …${t.last4}`);
const revokeWalk = async () => {
  const del = await fetch(`${API}/account/tokens/${walkToken.id}`, { method: 'DELETE', headers: walkAuth });
  const after = await fetch(`${API}/account`, { headers: walkAuth });
  report.walkTokenRevoked = `DELETE ${del.status}, then GET /account ${after.status}`;
};
// A throw or a timeout from here on still takes back what this run made (the code gate's C5): the
// parlor's tokens new since step 0 (ids absent from the recorded list, named as the parlor names
// them), then the walk's own token, each read back.
process.on('uncaughtException', async e => {
  report.aborted = String(e?.message ?? e).split('\n')[0];
  await b.close().catch(() => {});
  try {
    const left = (await tokenIds()).filter(t => !before.has(t.id) && !t.revoked && /^Parlor on /.test(t.name ?? ''));
    report.abortRevoked = [];
    for (const t of left) {
      const del = await fetch(`${API}/account/tokens/${t.id}`, { method: 'DELETE', headers: walkAuth });
      report.abortRevoked.push(`${t.name} …${t.last4}: DELETE ${del.status}`);
    }
    if (!report.walkTokenRevoked) await revokeWalk();
  } catch (err) {
    report.abortCleanup = `failed: ${String(err)}; check the account's tokens by hand`;
  }
  if (process.env.ROOM === '1') report.worldKeyNote = 'a world key the room minted may be live: read the test world\'s keys';
  console.log(JSON.stringify({ ...report, errors, violations }, null, 2));
  process.exit(1);
});

// 1. Signed in on onlyworlds.com, by its own form.
await p.goto('https://www.onlyworlds.com/accounts/login/');
await p.fill('input[name="login"]', email);
await p.fill('input[name="password"]', password);
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }), p.locator('form button[type="submit"]').first().click()]);
step(`site signed in: ${new URL(p.url()).pathname}`);

// 2. The parlor, signed out, on a room's address (ROOM=1: the test world, so the return resumes the
// room and must name the account there, the sign-in gate's G2). The room mints this browser a world key:
// its id is the one new key ending as the browser's, revoked in step 4.
const roomMode = process.env.ROOM === '1';
let worldId = null;
let keysBefore = new Set();
const worldKeys = async id => ((await (await fetch(`${API}/account/worlds/${id}/keys`, { headers: walkAuth })).json()).data ?? []);
if (roomMode) {
  const worlds = (await (await fetch(`${API}/account/worlds`, { headers: walkAuth })).json()).data ?? [];
  worldId = worlds.find(w => w.name === 'Parlor ground (crew test)')?.id ?? null;
  if (!worldId) throw new Error(`${label} is not in Parlor ground (crew test)`);
  keysBefore = new Set((await worldKeys(worldId)).map(k => k.id));
}
await p.goto(`${PARLOR}/${worldId ? `#/w/${worldId}` : ''}`);
await p.waitForSelector('.land', { timeout: 30000 });
await p.waitForTimeout(500);
const button = p.locator('[data-action="signin-onlyworlds"]');
report.button = await button.count();
await p.screenshot({ path: `${out}-1-landing.png` });
if (!report.button) {
  await revokeWalk();
  console.log(JSON.stringify({ ...report, errors, violations }, null, 2));
  await b.close();
  process.exit(1);
}

// 3. The press, the consent page the first time, the return.
await button.click();
await p.waitForURL(u => u.hostname === 'www.onlyworlds.com' || u.hostname === 'parlor.onlyworlds.com' && u.pathname === '/', { timeout: 30000 });
const consent = p.locator('button[name="decision"][value="continue"]');
if (await consent.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
  await p.screenshot({ path: `${out}-2-consent.png` });
  step(`consent page: ${(await p.locator('h1, h2').first().textContent().catch(() => ''))?.trim()}`);
  await consent.click();
} else {
  step('no consent page (consented before)');
}
const landed = roomMode
  ? await p.locator('[data-part="signed-in-as"]').waitFor({ timeout: 30000 }).then(() => true, () => false)
  : await p.getByRole('heading', { name: 'Your parlors' }).waitFor({ timeout: 30000 }).then(() => true, () => false);
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}-3-back.png` });
const session = await p.evaluate(() => JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'));
Object.assign(report, {
  landed, url: p.url(),
  tokenKept: Boolean(session?.token?.startsWith('ow_a_')), accountKept: Boolean(session?.accountId),
  signedInAs: roomMode
    ? (await p.locator('[data-part="signed-in-as"]').textContent().catch(() => ''))?.trim()
    : (await p.locator('.land > p').first().textContent().catch(() => ''))?.trim(),
  worldsListed: roomMode ? undefined : await p.locator('ul.worlds li').count(),
  recordLeft: await p.evaluate(() => localStorage.getItem('ow_signin:parlor')),
});
await b.close();

// The world key the room minted: the one new key ending as the browser's, revoked, then read back.
if (roomMode) {
  const held = [session?.keys?.[worldId], session?.readKeys?.[worldId]].filter(Boolean);
  const newKeys = (await worldKeys(worldId)).filter(k => !keysBefore.has(k.id) && !k.revoked);
  const ours = newKeys.filter(k => held.some(v => v.endsWith(k.last4)));
  if (ours.length === 1 && newKeys.length === 1) {
    const del = await fetch(`${API}/account/worlds/${worldId}/keys/${ours[0].id}`, { method: 'DELETE', headers: walkAuth });
    const left = (await worldKeys(worldId)).find(k => k.id === ours[0].id);
    report.worldKeyRevoked = `DELETE ${del.status}, then listed revoked: ${left?.revoked ?? 'gone'}`;
  } else {
    report.worldKeyRevoked = `nothing revoked: ${newKeys.length} new key(s), ${ours.length} matching`;
  }
}

// 4. The token the parlor kept: the one id new since step 0 and ending as it does, revoked, then 401.
const fresh = (await tokenIds()).filter(t => !before.has(t.id));
report.newTokens = fresh.map(t => t.name);
const token = session?.token;
const mine = token ? fresh.filter(t => token.endsWith(t.last4)) : [];
if (token && fresh.length === 1 && mine.length === 1) {
  const del = await fetch(`${API}/account/tokens/${mine[0].id}`, { method: 'DELETE', headers: walkAuth });
  const after = await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${token}` } });
  report.revoked = `DELETE ${del.status}, then GET /account ${after.status}`;
} else {
  report.revoked = `nothing revoked: ${fresh.length} new token(s), ${mine.length} matching`;
}
await revokeWalk();
console.log(JSON.stringify({ ...report, keel, errors, violations }, null, 2));
process.exit(report.landed && report.tokenKept && !report.recordLeft && /401$/.test(report.revoked ?? '') && /401$/.test(report.walkTokenRevoked) && !errors.length && !violations.length ? 0 : 1);
