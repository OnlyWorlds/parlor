// Takes back what the walks minted, and reads it back. Only rows the seed and
// the walk recorded (an id, or a last four the walk read from its own browsers,
// beside the parlor's own names): never another row on these accounts.
//   WALK_STATE=<scratch file> node walk/teardown.mjs
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, accountCall, API } from './accounts.mjs';

const s = readState();
const ours = name => /^Parlor (walk S450|in )/.test(name ?? '');
const c = s.tokens['crew-walk-c']?.token;
if (!c) throw new Error('no host token');

// The lore decoys the seed and the walk made, by their recorded ids only (410 or 404 is gone already).
if (s.hostKey && s.decoys?.length) {
  const host = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
  let gone = 0;
  for (const d of s.decoys) {
    try { await host.delete(d.type, d.id); gone++; } catch (e) { if (e?.status === 404 || e?.status === 410) gone++; else throw e; }
  }
  console.log(`decoys deleted: ${gone} of ${s.decoys.length}`);
  s.decoys = [];
  writeState(s);
}

// The links the seeds minted (a used one answers the same).
for (const m of s.minted.filter(x => x.kind === 'link')) {
  await accountCall(c, 'DELETE', `/account/worlds/${m.world}/links/${m.id}`).catch(() => {});
}
console.log(`links revoked: ${s.minted.filter(x => x.kind === 'link').length}`);

// Every world key on the test world that the walk or the parlor named: the owner sees them all.
const keys = (await accountCall(c, 'GET', `/account/worlds/${s.worldId}/keys`)).data;
let keyCount = 0;
// Only keys this walk recorded: the seed's (the owner key keel mints with a new world carries no
// name, so by its last four) and those the walk's browsers held, by last four and our name both.
const madeWith = new Set(s.minted.filter(m => m.kind === 'world-key').map(m => m.last4));
const browserKeys = new Set(s.minted.filter(m => m.kind === 'browser-key').map(m => m.last4));
for (const k of keys.filter(k => (madeWith.has(k.last4) || (ours(k.name) && browserKeys.has(k.last4))) && !k.revoked)) {
  await accountCall(c, 'DELETE', `/account/worlds/${s.worldId}/keys/${k.id}`);
  keyCount++;
}
// The seed's own host key, by the id it recorded (it is neither the world's first key nor a browser's).
if (s.hostKey?.id) {
  await accountCall(c, 'DELETE', `/account/worlds/${s.worldId}/keys/${s.hostKey.id}`).catch(() => {});
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
  const minted = new Set(s.minted.filter(m => m.kind === 'browser-token' && m.label === label).map(m => m.last4));
  for (const r of list.filter(r => ours(r.name) && minted.has(r.last4) && r.id !== t.id && !r.revoked)) {
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
