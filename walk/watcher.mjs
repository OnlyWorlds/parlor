// A watcher's room in the app. A guest is served the room's lines (mail to everyone)
// and no sitting, and each line keeps its room mark. In a world with no Charter mark the
// room shows the newest sitting's lines by that mark and says what a watcher is not shown;
// the test world's Charter is marked, so it is a team world, whose room holds every
// sitting's lines, and whose Crew tab shows the crew as served (a guest's key reads the roster). The host
// (crew-walk-c, after seed.mjs) starts two sittings with one line each, recorded
// for teardown; crew-walk-a is lowered from its role to guest for the walk and put
// back after, read back.
//   WALK_STATE=<scratch file> PARLOR_URL=<served build> node --experimental-strip-types walk/watcher.mjs [chromium|firefox]
//   A control: PARLOR_URL at a build before the team world, where the earlier sitting's line, the room's line and the Crew tab's own row fail.
import { OwV2Client } from '@onlyworlds/sdk';
import { chromium, firefox } from 'playwright';
import { account, readState, writeState, accountCall, API } from './accounts.mjs';
import { newSitting, newLine } from '../src/parlor/shapes.ts';

const GUEST = 'crew-walk-a';
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const engine = process.argv[2] === 'firefox' ? firefox : chromium;
const s = readState();
const c = s.tokens['crew-walk-c']?.token;
if (!c || !s.hostKey || !s.worldId) throw new Error('run seed.mjs first');
s.decoys ??= [];
const host = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
let fails = 0;
const check = (ok, name) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const make = async (type, body) => {
  const el = await host.create(type, body);
  s.decoys.push({ type, id: el.id });
  writeState(s);
  return el;
};

// Two sittings, a line in each, words unique to this run.
const tag = Date.now().toString(36);
const first = await make('event', newSitting(`Watcher walk ${tag} one`, Math.floor(Date.now() / 1000), s.worldId));
const old = `Earlier sitting's line ${tag}`;
await make('narrative', newLine(old, null, null, first.id));
await new Promise(r => setTimeout(r, 1500));
const second = await make('event', newSitting(`Watcher walk ${tag} two`, Math.floor(Date.now() / 1000), s.worldId));
const now = `This sitting's line ${tag}`;
await make('narrative', newLine(now, null, null, second.id));

// The guest: its own token, its role lowered for the walk and put back after.
const g = account(GUEST);
const signed = await new OwV2Client({ baseUrl: API }).signInWithPassword({ email: g.email, password: g.password, tokenName: 'Parlor walk S450' });
s.tokens[GUEST] = { token: signed.token, id: signed.id };
writeState(s);
const probeKey = await accountCall(signed.token, 'POST', `/account/worlds/${s.worldId}/keys`, { scope: 'read', name: 'Parlor walk S450' });
s.minted.push({ kind: 'world-key', world: s.worldId, last4: probeKey.key.slice(-4) });
writeState(s);
const was = await new OwV2Client({ apiKey: probeKey.key, baseUrl: API }).me();
s.roleBack = { world: s.worldId, membership: was.membership, role: was.role };
writeState(s);
await accountCall(c, 'PATCH', `/account/worlds/${s.worldId}/members/${was.membership}`, { role: 'guest' });

const browser = await engine.launch();
try {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([token, login]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login, pin: '', keys: {} }));
  }, [signed.token, GUEST]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`${BASE}#/w/${s.worldId}`);
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await p.waitForTimeout(250); } return false; };
  const sees = await until(() => p.getByText(now).isVisible());
  check(sees, "the watcher reads this sitting's line");
  // The test world's Charter is marked, so it is a team world: its room holds every sitting's lines, a watcher's too
  // (the front door names the Charter to a guest, who may not be served the Law itself).
  const seesOld = await until(() => p.getByText(old).isVisible(), 8000);
  check(seesOld, "and the earlier sitting's, a team world's room holding every sitting");
  const says = await p.getByText('You can read this room.').isVisible().catch(() => false);
  check(says, 'the room says the watcher can read it');
  await p.getByRole('tab', { name: 'Crew' }).click().catch(() => {});
  // OnlyWorlds serves the roster to any key on the world, a guest's read key included (the API spec's GET /members),
  // so the watcher's Crew tab is the crew as served: its own row says "watcher, you", and no line says it is refused.
  const ownRow = await until(() => p.locator('[data-seat] .st', { hasText: 'watcher, you' }).first().isVisible(), 8000);
  const refused = await p.locator('[data-part="crew-refused"]').isVisible().catch(() => false);
  check(ownRow && !refused, 'the Crew tab shows the crew as served, the watcher\'s own row saying "watcher, you"');
  check(!errors.length, `no page error (${errors.join(' | ')})`);
  const sess = await p.evaluate(() => JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null')).catch(() => null);
  for (const k of [...Object.values(sess?.keys ?? {}), ...Object.values(sess?.readKeys ?? {})]) {
    if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label: GUEST, last4: k.slice(-4) });
  }
  writeState(s);
} finally {
  await browser.close();
  await accountCall(c, 'PATCH', `/account/worlds/${s.worldId}/members/${was.membership}`, { role: was.role });
  const back = await new OwV2Client({ apiKey: probeKey.key, baseUrl: API }).me();
  check(back.role === was.role, `its role is back (${back.role})`);
  if (back.role === was.role) { delete s.roleBack; writeState(s); }
}
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exitCode = fails ? 1 : 0;
