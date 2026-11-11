// What a guest is served of a room, read on the live server (no app in between):
// the host (crew-walk-c, after seed.mjs) makes a sitting with a line, a spec, a
// vote and a board entry, each recorded for teardown; crew-walk-a, as a guest,
// reads each one by id and by list with its own read
// key, the parlor's own way in for a guest. The host reads the same ids first,
// so an absence is the server's answer, not the probe's. crew-walk-a is a member
// already: the host lowers it to a guest for the read and puts its role back.
//   WALK_STATE=<scratch file> node --experimental-strip-types walk/guest.mjs
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, accountCall, API } from './accounts.mjs';
import { newSitting, newLine, newSpec, newVote, newBoardEntry } from '../src/parlor/shapes.ts';

const GUEST = 'crew-walk-a';
const s = readState();
const c = s.tokens['crew-walk-c']?.token;
if (!c || !s.hostKey || !s.worldId) throw new Error('run seed.mjs first');
s.decoys ??= [];
const host = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
const results = [];
const say = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); };


// 1. The room, as the parlor writes it: a sitting, then its line, spec, vote and board entry.
const made = {};
const make = async (key, type, body) => {
  const el = await host.create(type, body);
  s.decoys.push({ type, id: el.id });
  writeState(s);
  made[key] = { type, id: el.id };
  return el;
};
const sitting = await make('sitting', 'event', newSitting('Guest probe sitting', Math.floor(Date.now() / 1000), s.worldId));
const spec = await make('spec', 'construct', newSpec('Guest probe spec', 'A spec to read.', 'Tool', sitting.id));
await make('line', 'narrative', newLine('A line a guest might read.', null, null, sitting.id));
await make('vote', 'relation', newVote([spec.id], null, sitting.id));
await make('board', 'narrative', newBoardEntry('Guest probe board', 'A board entry.', 'green', null, null, sitting.id));
for (const [k, v] of Object.entries(made)) {
  const back = await host.get(v.type, v.id).then(() => true, () => false);
  say(`host reads its ${k}`, back, `${v.type} ${v.id.slice(0, 8)}`);
}

// 2. crew-walk-a is a member of the test world: the host lowers it to a guest for the read
// (the owner's own route, PATCH .../members/{id}), and puts its role back after, read back.
// Its read key is the parlor's own way in for a guest.
const g = account(GUEST);
const signed = await new OwV2Client({ baseUrl: API }).signInWithPassword({ email: g.email, password: g.password, tokenName: 'Parlor walk S450' });
s.tokens[GUEST] = { token: signed.token, id: signed.id };
writeState(s);
const key = await accountCall(signed.token, 'POST', `/account/worlds/${s.worldId}/keys`, { scope: 'read', name: 'Parlor walk S450' });
s.minted.push({ kind: 'world-key', world: s.worldId, last4: key.key.slice(-4) });
writeState(s);
const guest = new OwV2Client({ apiKey: key.key, baseUrl: API });
const was = await guest.me();
if (!was.membership) throw new Error('no membership for the guest account');
s.roleBack = { world: s.worldId, membership: was.membership, role: was.role };
writeState(s);
await accountCall(c, 'PATCH', `/account/worlds/${s.worldId}/members/${was.membership}`, { role: 'guest' });
const me = await guest.me();
say('the account reads as a guest', me.role === 'guest', `was ${was.role} · character ${me.character ?? 'none'}`);

// 3. What the guest is served, by id and in its lists.
for (const [k, v] of Object.entries(made)) {
  let body = null;
  const r = await guest.get(v.type, v.id).then(el => { body = el; return 200; }, e => e?.status ?? 'error');
  // A served element's room mark: does it still name the sitting the guest cannot see?
  const mark = body ? (body.x_room_of === sitting.id ? 'the sitting' : body.x_room_of === undefined ? 'absent' : JSON.stringify(body.x_room_of)) : '';
  console.log(`     guest GET ${k} (${v.type}) answers ${r}${body ? ` · x_room_of: ${mark}` : ''}`);
  results.push({ name: `guest by id: ${k}`, served: r === 200 });
}
for (const type of ['event', 'narrative', 'construct', 'relation', 'character', 'law']) {
  const ids = [];
  for await (const el of guest.listAll(type)) ids.push(el.id);
  const ours = Object.values(made).filter(v => v.type === type && ids.includes(v.id)).length;
  console.log(`     guest lists ${ids.length} ${type}${ids.length === 1 ? '' : 's'}; of this probe's: ${ours}`);
}

// 4. Its role back, read back.
await accountCall(c, 'PATCH', `/account/worlds/${s.worldId}/members/${was.membership}`, { role: was.role });
const back = await guest.me();
say('its role is back', back.role === was.role, back.role);
if (back.role === was.role) { delete s.roleBack; writeState(s); }

const fails = results.filter(r => r.ok === false).length;
console.log(fails ? `${fails} FAIL` : 'probe ok');
process.exitCode = fails ? 1 : 0;
