// Takes back what the walks minted, and reads it back. Only what carries the
// walk's names ("Parlor walk S450", and "Parlor in <browser>", which the parlor
// names every token and key it makes): never another row on these accounts.
//   WALK_STATE=<scratch file> node walk/teardown.mjs
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, accountCall, API } from './accounts.mjs';

const s = readState();
const ours = name => /^Parlor (walk S450|in )/.test(name ?? '');
const c = s.tokens['crew-walk-c']?.token;
if (!c) throw new Error('no host token');

// The links the seeds minted (a used one answers the same).
for (const m of s.minted.filter(x => x.kind === 'link')) {
  await accountCall(c, 'DELETE', `/account/worlds/${m.world}/links/${m.id}`).catch(() => {});
}
console.log(`links revoked: ${s.minted.filter(x => x.kind === 'link').length}`);

// Every world key on the test world that the walk or the parlor named: the owner sees them all.
const keys = (await accountCall(c, 'GET', `/account/worlds/${s.worldId}/keys`)).data;
let keyCount = 0;
// The owner key keel mints with a new world carries no name: match it by the last four the seed kept.
const madeWith = new Set(s.minted.filter(m => m.kind === 'world-key').map(m => m.last4));
for (const k of keys.filter(k => (ours(k.name) || madeWith.has(k.last4)) && !k.revoked)) {
  await accountCall(c, 'DELETE', `/account/worlds/${s.worldId}/keys/${k.id}`);
  keyCount++;
}
const left = (await accountCall(c, 'GET', `/account/worlds/${s.worldId}/keys`)).data.filter(k => ours(k.name) && !k.revoked);
console.log(`world keys revoked: ${keyCount}; still live by our names: ${left.length}`);
if (s.hostKey) {
  const probe = await fetch(`${API}/me`, { headers: { 'API-Key': s.hostKey.key } });
  console.log(`the host's walk key reads back ${probe.status}`);
}

// Account tokens: the browser-made ones by name, then the walk's own last.
// crew-walk-d's were made in closed browsers, so it signs in once more to list them.
if (!s.tokens['crew-walk-d']) {
  const d = account('crew-walk-d');
  const signed = await new OwV2Client({ baseUrl: API }).signInWithPassword({ email: d.email, password: d.password, tokenName: 'Parlor walk S450' });
  s.tokens['crew-walk-d'] = { token: signed.token, id: signed.id };
  writeState(s);
}
for (const [label, t] of Object.entries(s.tokens)) {
  const rows = await accountCall(t.token, 'GET', '/account/tokens');
  const list = Array.isArray(rows) ? rows : rows.data ?? rows.tokens ?? [];
  let n = 0;
  for (const r of list.filter(r => ours(r.name) && r.id !== t.id && !r.revoked)) {
    await accountCall(t.token, 'DELETE', `/account/tokens/${r.id}`);
    n++;
  }
  await accountCall(t.token, 'DELETE', `/account/tokens/${t.id}`);
  const back = await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${t.token}` } });
  console.log(`${label}: ${n} browser tokens revoked, the walk's own revoked; it reads back ${back.status}`);
}
s.tokens = {};
delete s.hostKey;
writeState(s);
