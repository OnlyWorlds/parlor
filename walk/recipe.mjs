// A line written by the workshop pack's recipe, read in the room. The host (crew-walk-c,
// after seed.mjs) starts a sitting; crew-walk-a, a contributor, writes one line exactly as
// the recipe says (POST /narrative: name, supertype Message, story the text, characters
// empty, x_room_of the sitting's id; narrator its Character when it plays one); the host's
// room in the app must show the line's words in that sitting. Then crew-walk-a, lowered to
// guest for the read and put back after, reads the lines as a watcher's AI is told to: the
// newest marked line's x_room_of is the sitting, and the line is in it.
//   WALK_STATE=<scratch file> PARLOR_URL=<served build> node --experimental-strip-types walk/recipe.mjs [chromium|firefox]
//   EXPECT_OLD=1 is the control on a build that reads a line's words from description: it must fail.
import { OwV2Client } from '@onlyworlds/sdk';
import { chromium, firefox } from 'playwright';
import { account, readState, writeState, accountCall, API } from './accounts.mjs';
import { newSitting } from '../src/parlor/shapes.ts';

const MEMBER = 'crew-walk-a';
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const engine = process.argv[2] === 'firefox' ? firefox : chromium;
const s = readState();
const c = s.tokens['crew-walk-c']?.token;
if (!c || !s.hostKey || !s.worldId) throw new Error('run seed.mjs first');
s.decoys ??= [];
const host = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
let fails = 0;
const check = (ok, name) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const want = !process.env.EXPECT_OLD;

const tag = Date.now().toString(36);
const sitting = await host.create('event', newSitting(`Recipe walk ${tag}`, Math.floor(Date.now() / 1000), s.worldId));
s.decoys.push({ type: 'event', id: sitting.id });
writeState(s);

// The member writes by the recipe, with its own write key.
const a = account(MEMBER);
const signed = await new OwV2Client({ baseUrl: API }).signInWithPassword({ email: a.email, password: a.password, tokenName: 'Parlor walk S450' });
s.tokens[MEMBER] = { token: signed.token, id: signed.id };
writeState(s);
const wkey = await accountCall(signed.token, 'POST', `/account/worlds/${s.worldId}/keys`, { scope: 'write', name: 'Parlor walk S450' });
s.minted.push({ kind: 'world-key', world: s.worldId, last4: wkey.key.slice(-4) });
writeState(s);
const member = new OwV2Client({ apiKey: wkey.key, apiPin: a.pin, baseUrl: API });
const me = await member.me();
const words = `The pack's line, its words in the story ${tag}`;
const name = `Pack line ${tag}`;
const body = { name, supertype: 'Message', story: words, characters: [], x_room_of: sitting.id, ...(me.character ? { narrator: me.character } : {}) };
const line = await member.create('narrative', body);
s.decoys.push({ type: 'narrative', id: line.id });
writeState(s);
// A line in the old shape beside it (its words in description, as the parlor wrote before 2026-11-11).
const oldWords = `An older line, its words in the description ${tag}`;
const oldLine = await host.create('narrative', { name: `Old line ${tag}`, description: oldWords, supertype: 'Message', x_room_of: sitting.id });
s.decoys.push({ type: 'narrative', id: oldLine.id });
writeState(s);
const back = await host.get('narrative', line.id);
check(back.story === words && back.x_room_of === sitting.id && Array.isArray(back.characters) && back.characters.length === 0,
  `the recipe's line landed as written (narrator ${me.character ? 'its Character' : 'none: it plays no Character'})`);

// The host's room in the app.
const browser = await engine.launch();
try {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([token, login, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login, pin, keys: {} }));
  }, [c, 'crew-walk-c', account('crew-walk-c').pin]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`${BASE}#/w/${s.worldId}`);
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await p.waitForTimeout(250); } return false; };
  const seesName = await until(async () => (await p.getByText(name).first().isVisible().catch(() => false)) || (await p.getByText(words).isVisible().catch(() => false)), 20000);
  const seesWords = await until(() => p.getByText(words).isVisible(), want ? 15000 : 4000);
  check(seesName, 'the room shows the line in its sitting');
  check(want ? seesWords : !seesWords, want ? "with the line's words, from its story" : 'the old build shows no words for it');
  check(await until(() => p.getByText(oldWords).isVisible(), 8000), "an older line's words, from its description, still show");
  check(!errors.length, `no page error (${errors.join(' | ')})`);
  const sess = await p.evaluate(() => JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null')).catch(() => null);
  for (const k of [...Object.values(sess?.keys ?? {}), ...Object.values(sess?.readKeys ?? {})]) {
    if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label: 'crew-walk-c', last4: k.slice(-4) });
  }
  writeState(s);
} finally {
  await browser.close();
}

// A watcher's AI, as the pack tells it: the newest marked line's mark is the current sitting.
if (want) {
  const rkey = await accountCall(signed.token, 'POST', `/account/worlds/${s.worldId}/keys`, { scope: 'read', name: 'Parlor walk S450' });
  s.minted.push({ kind: 'world-key', world: s.worldId, last4: rkey.key.slice(-4) });
  s.roleBack = { world: s.worldId, membership: me.membership, role: me.role };
  writeState(s);
  await accountCall(c, 'PATCH', `/account/worlds/${s.worldId}/members/${me.membership}`, { role: 'guest' });
  try {
    const guest = new OwV2Client({ apiKey: rkey.key, baseUrl: API });
    const marked = [];
    for await (const el of guest.listAll('narrative')) {
      if (typeof el.x_room_of === 'string' && el.x_room_of !== s.worldId && (el.supertype ?? '').trim().toLowerCase() === 'message') marked.push(el);
    }
    marked.sort((x, y) => (x.created_at ?? '').localeCompare(y.created_at ?? '') || x.id.localeCompare(y.id));
    const current = marked.at(-1)?.x_room_of;
    check(current === sitting.id && marked.some(el => el.id === line.id && el.story === words),
      "a guest's read puts the line in the current sitting, its words in the story");
  } finally {
    await accountCall(c, 'PATCH', `/account/worlds/${s.worldId}/members/${me.membership}`, { role: me.role });
    const r = await member.me();
    check(r.role === me.role, `its role is back (${r.role})`);
    if (r.role === me.role) { delete s.roleBack; writeState(s); }
  }
}
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exitCode = fails ? 1 : 0;
