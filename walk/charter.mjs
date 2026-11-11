// The room's charter by the charter profile's mark, on production keel: the host (crew-walk-c) and a member (crew-walk-b).
//   WALK_STATE=<scratch file> PARLOR_URL=<a built parlor under its _headers> node walk/charter.mjs chromium|firefox
// Run seed.mjs first (it marks the test world's House rules). The walk takes that mark off by API, reads that neither
// page shows the Law as house rules and that only the host is offered "Mark it as this world's charter", presses it,
// and reads both pages and keel. Whatever happens, `finally` puts the mark back on that Law (by the id it read) and
// reads it back. EXPECT_OLD=1: a build that shows an unmarked Charter, where it must fail.
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, API } from './accounts.mjs';

const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = engineName === 'firefox' ? firefox : chromium;
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const s = readState();
if (!s.hostKey || !s.tokens['crew-walk-c'] || !s.tokens['crew-walk-b']) throw new Error('run seed.mjs first');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 300));
  }
}
const api = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
let law = null;
/** Put the mark back on the Law this walk took it from, and read it back (an error says what failed). */
const restore = () => law
  ? api.patch('law', law.id, { x_charter_of: s.worldId }).then(() => api.get('law', law.id)).catch(e => ({ error: String(e?.message ?? e) }))
  : Promise.resolve({ error: 'no Law read' });
// A walk that hangs still gives the mark back before it exits.
const watchdog = setTimeout(async () => {
  console.log('FAIL watchdog 240 s');
  const back = await restore();
  console.log(back.x_charter_of === s.worldId ? 'mark restored' : `FAIL mark not restored: ${JSON.stringify(back.error ?? back.x_charter_of)}`);
  process.exit(3);
}, 240000);

async function withToken(ctx, label) {
  await ctx.addInitScript(([token, login, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login, pin, keys: {} }));
  }, [s.tokens[label].token, label, account(label).pin]);
}
async function recordMinted(page, label) {
  const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null);
  if (!sess) return;
  for (const k of Object.values(sess.keys ?? {})) if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label, last4: k.slice(-4) });
  if (typeof sess.token === 'string' && sess.token !== s.tokens[label]?.token) s.minted.push({ kind: 'browser-token', label, last4: sess.token.slice(-4) });
  writeState(s);
}

// The seed's own House rules, marked: the one Law this walk touches.
for await (const l of api.listAll('law')) if (l.name === 'House rules' && l.x_charter_of === s.worldId) law = l;
if (!law) throw new Error('no marked House rules: run seed.mjs first');
const browser = await engine.launch();
const pages = [];
try {
  await api.patch('law', law.id, { x_charter_of: null });
  check('keel: the mark is off for the walk', !(await api.get('law', law.id)).x_charter_of);

  const open = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await withToken(ctx, label);
    const page = await ctx.newPage();
    pages.push([page, label]);
    await page.goto(`${BASE}#/w/${s.worldId}`);
    return page;
  };
  const host = await open('crew-walk-c');
  check('host: the room opens', await until(() => host.getByText('You: host').isVisible(), 30000));
  const m = await open('crew-walk-b');
  check('member: the room opens', await until(() => m.getByText('You: member').isVisible(), 30000));
  for (const p of [host, m]) await p.getByRole('tab', { name: /^Specs/ }).click().catch(() => {});
  const rules = p => p.locator('details.card summary', { hasText: 'House rules' });
  const offer = host.locator('[data-part="charter-offer"]');
  check('host: offered to mark the Law, naming it', await until(() => offer.isVisible(), 15000) && /House rules/.test(await offer.innerText()));
  if (process.env.EXPECT_OLD === '1' && !(await offer.count())) throw new Error('no charter offer on this build (the control)');
  check('host: an unmarked Charter is not shown as house rules', await rules(host).count() === 0);
  check('member: no house rules and no offer', await rules(m).count() === 0 && await m.locator('[data-part="charter-offer"]').count() === 0);

  await offer.getByRole('button', { name: "Mark House rules as this world's charter" }).click();
  check('keel: the Law carries the world\'s id as its mark', await until(async () => (await api.get('law', law.id)).x_charter_of === s.worldId, 15000));
  check('host: house rules shown, the offer gone', await until(() => rules(host).isVisible(), 15000) && await offer.count() === 0);
  check('member: house rules shown once the feed brings the mark', await until(() => rules(m).isVisible(), 30000));
} catch (err) {
  check('the walk ran to its end', false, String(err?.message ?? err).slice(0, 300));
} finally {
  // The mark back first, on the one Law the walk took it from, read back; nothing before it can throw past it.
  const back = await restore();
  check('keel: the mark is back on House rules', back.x_charter_of === s.worldId, JSON.stringify(back.error ?? back.x_charter_of));
  for (const [p, label] of pages) await recordMinted(p, label).catch(() => {});
  await browser.close().catch(() => {});
  clearTimeout(watchdog);
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
