// Work by role (x_packet_for, the packet profile's fourth key): the host's own room on production keel.
//   WALK_STATE=<scratch file> PARLOR_URL=<a built parlor> node walk/roles.mjs chromium|firefox
// Run seed.mjs first (crew-walk-c's token and key). The walk makes two Titles (one held by the host's
// Character, one by a stranger), a Character, and five work items, each recorded in the state's decoys,
// so teardown.mjs deletes them by id. It reads the Work tab: what is for you (by your Title), for others
// (another's Title, another person) and addressed to no one (nothing named, or only an id that is no Title).
// EXPECT_OLD=1: the build before the key, where every item reads as before; the walk then must fail.
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, API } from './accounts.mjs';

const engine = process.argv[2] === 'firefox' ? firefox : chromium;
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const s = readState();
if (!s.hostKey || !s.tokens['crew-walk-c']) throw new Error('run seed.mjs first');
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
s.decoys ??= [];
const RUN = `roles ${Date.now().toString(36)}`;
async function make(type, body) {
  const made = await api.create(type, body);
  s.decoys.push({ type, id: made.id });
  writeState(s);
  return made;
}

// The host's Character as the room reads it: the roster's, else the first room Member card the owner made.
async function hostCharacter() {
  const roster = await api.members().catch(() => null);
  const row = (Array.isArray(roster) ? roster : roster?.data ?? []).find(m => m.role === 'owner' && typeof m.character === 'string' && m.character);
  if (row) return row.character;
  const cards = [];
  for await (const el of api.listAll('character')) {
    // As the room reads its Member cards: room-marked ones only (an older unmarked card is no seat's).
    const marked = el.x_room_of !== undefined && el.x_room_of !== null && el.x_room_of !== '';
    if (marked && (el.supertype ?? '').trim().toLowerCase() === 'member' && (el.created_by == null || el.created_by === 'owner')) cards.push(el);
  }
  cards.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  return cards[0]?.id ?? null;
}

const timer = setTimeout(() => { console.log('WATCHDOG: the walk ran over 4 minutes; made so far:', JSON.stringify(s.decoys.slice(-8))); process.exit(2); }, 240000);
const browser = await engine.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([token, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login: 'crew-walk-c', pin, keys: {} }));
  }, [s.tokens['crew-walk-c'].token, account('crew-walk-c').pin]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}#/w/${s.worldId}`);
  check('the room opens on the host\'s seat', await until(() => page.getByText('You: host').isVisible(), 30000));
  if (await page.locator('#my-name').isVisible().catch(() => false)) {
    await page.fill('#my-name', 'Host C');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  const me = await (async () => { for (let i = 0; i < 20; i++) { const c = await hostCharacter(); if (c) return c; await new Promise(r => setTimeout(r, 1000)); } return null; })();
  check('the host has a Character in the world', !!me);

  const stranger = await make('character', { name: `Ada (${RUN})` });
  const mine = await make('title', { name: `Designer (${RUN})`, holders: [me] });
  const theirs = await make('title', { name: `Backend (${RUN})`, holders: [stranger.id] });
  const source = { server: 'https://www.onlyworlds.com', world: s.worldId };
  const packet = (name, extra) => make('relation', {
    // The room mark: the parlor lists only the room's work items (a packet without it is the world's, not the room's).
    name: `${name} (${RUN})`, supertype: 'Work item', subtype: 'open', characters: [stranger.id], x_room_of: s.worldId,
    x_packet_elements: [{ type: 'character', id: stranger.id, reason: 'the trial needs one element' }], x_packet_source: source, ...extra,
  });
  await packet('For my role', { x_packet_for: [mine.id] });
  await packet('For their role', { x_packet_for: [theirs.id] });
  await packet('For Ada', { actor: stranger.id });
  await packet('Named no one', {});
  await packet('Only a stray id', { x_packet_for: [stranger.id, ''] });

  await page.getByRole('tab', { name: 'Work' }).click().catch(() => {});
  const card = t => page.locator('.card.witem', { has: page.locator('h3', { hasText: `${t} (${RUN})` }) });
  check('the five items arrive by the feed', await until(async () => (await page.locator('.card.witem h3', { hasText: `(${RUN})` }).count()) === 5, 30000));
  // The page's order: each heading, then the titles of the cards under it, as a person reads down.
  const order = await page.evaluate(() => [...document.querySelectorAll('.wgroup, .card.witem h3')].map(n => n.classList.contains('wgroup') ? `# ${n.textContent}` : n.textContent));
  const ours = order.filter(x => x.startsWith('# ') || x.includes(`(${RUN})`)).map(x => x.replace(` (${RUN})`, ''));
  const at = x => ours.indexOf(x);
  check('three groups, in order', at('# For you') >= 0 && at('# For you') < at('# For others') && at('# For others') < at('# Not addressed to anyone'), ours.join(' | '));
  check('my role\'s item is for me', at('# For you') < at('For my role') && at('For my role') < at('# For others'));
  check('another role and another person are for others', at('# For others') < at('For their role') && at('# For others') < at('For Ada') && at('For Ada') < at('# Not addressed to anyone'));
  check('nothing named and a stray id are addressed to no one', at('# Not addressed to anyone') >= 0 && at('# Not addressed to anyone') < at('Named no one') && at('# Not addressed to anyone') < at('Only a stray id'));
  const forLine = async t => (await card(t).locator('[data-part="for"]').innerText().catch(() => '')).trim();
  check('the card names the role', (await forLine('For my role')).startsWith(`For whoever holds Designer (${RUN})`), await forLine('For my role'));
  check('a card that names no one says so', (await forLine('Named no one')).startsWith('Not addressed to anyone'), await forLine('Named no one'));
  check('a stray id is not read as a role', (await forLine('Only a stray id')).startsWith('Not addressed to anyone'), await forLine('Only a stray id'));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
  // The room mints a world key in this browser: record its last four, so teardown.mjs takes it back by name and last four.
  const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null);
  for (const k of [...Object.values(sess?.keys ?? {}), ...Object.values(sess?.readKeys ?? {})]) {
    if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label: 'crew-walk-c', last4: k.slice(-4) });
  }
} finally {
  clearTimeout(timer);
  await browser.close();
  writeState(s);
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `ALL OK (${results.length})`);
console.log(`made and recorded for teardown: ${s.decoys.length} decoys in the state`);
process.exit(process.env.EXPECT_OLD ? (failed ? 0 : 1) : (failed ? 1 : 0));
