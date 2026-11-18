// A team world's room (a world whose Charter is marked): the crew in the panel, a seat's room, a line written there
// and a reply under it, the work line, an element's card, Run a workshop and End; then a workshop world read as it
// always was. On production keel, against PARLOR_URL.
//   WALK_STATE=<scratch file> PARLOR_URL=<a built parlor> node walk/team-world.mjs chromium|firefox [phone]
// Run seed.mjs crew-walk-b first (crew-walk-c hosts, crew-walk-b is the member). The walk makes, each recorded so
// teardown.mjs takes it back by id: two Objects in design (one under the other), a Character for a played AI seat, a
// Note by the member, a taken work item that names the member's Character, the lines the pages send, and one world
// key for the member (to write its Note), revoked by its id.
//
// One door is played, and only that one: GET /members on the host's page and the phone's. keel's roster for the test
// world holds no AI seat and no person with a roster Character, so the played answer adds two AI rows (one no one
// answers for, one the owner answers for) and gives the member's row the Member Character it already writes as (so its
// Note's sender reads verified, as for a person whose seat names a Character). Every other read and every write is
// keel's. The member's own page reads keel's roster as served.
//
// The workshop world is crew-walk-b's "Dashboard ground (crew test)" (no Charter mark), read only: the page is
// handed a key the walk minted for it (so the page mints none), and that key is revoked by its id.
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, accountCall, API } from './accounts.mjs';

const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = engineName === 'firefox' ? firefox : chromium;
const phone = process.argv[3] === 'phone';
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const SHOTS = process.env.SHOTS;
const s = readState();
if (!s.hostKey || !s.tokens['crew-walk-c'] || !s.tokens['crew-walk-b']) throw new Error('run seed.mjs crew-walk-b first');
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
let step = 0;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engineName}${phone ? '-phone' : ''}-${String(++step).padStart(2, '0')}-${name}.png` }); };

const RUN = `${engineName.slice(0, 2)}${phone ? 'p' : ''}${Date.now().toString(36).slice(-5)}`;
const host = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
s.decoys ??= [];
async function make(api, type, body) {
  const made = await api.create(type, body);
  s.decoys.push({ type, id: made.id });
  writeState(s);
  return made;
}
async function findLine(text) {
  for await (const el of host.listAll('narrative')) if (el.story === text) return el;
  return null;
}
/** A line the pages sent, found by its exact text and recorded for teardown. */
async function sent(text) {
  let el = null;
  await until(async () => (el = await findLine(text)) !== null, 20000);
  if (el && !s.decoys.some(d => d.id === el.id)) { s.decoys.push({ type: 'narrative', id: el.id }); writeState(s); }
  return el;
}
/** The keys and token a page's parlor holds, recorded by their last four for teardown (never the secrets). */
async function recordMinted(page, label) {
  const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null);
  if (!sess) return;
  for (const [world, k] of [...Object.entries(sess.keys ?? {}), ...Object.entries(sess.readKeys ?? {})]) {
    if (typeof k === 'string' && world === s.worldId) s.minted.push({ kind: 'browser-key', label, last4: k.slice(-4) });
  }
  if (typeof sess.token === 'string' && sess.token !== s.tokens[label]?.token) s.minted.push({ kind: 'browser-token', label, last4: sess.token.slice(-4) });
  writeState(s);
}
async function mintKey(label, world) {
  const k = await accountCall(s.tokens[label].token, 'POST', `/account/worlds/${world}/keys`, { name: 'Parlor walk S450' });
  s.minted.push({ kind: 'walk-key', label, world, id: k.id });
  writeState(s);
  return k.key;
}
const signedIn = (ctx, label, keys = {}) => ctx.addInitScript(([token, login, pin, keys]) => {
  if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login, pin, keys }));
}, [s.tokens[label].token, label, account(label).pin, keys]);

const timer = setTimeout(() => { console.log('WATCHDOG: over 7 minutes; made so far:', JSON.stringify(s.decoys.slice(-8))); process.exit(2); }, 420000);
const browser = await engine.launch();
const pages = [];
try {
  // ---------------------------------------------------------------- what the walk stands on, by API
  const bKey = await mintKey('crew-walk-b', s.worldId);
  const member = new OwV2Client({ apiKey: bKey, apiPin: account('crew-walk-b').pin, baseUrl: API });
  const bMe = await member.me();
  const bWho = bMe.membership;
  let bChar = null;
  for await (const el of host.listAll('character')) {
    if ((el.supertype ?? '').toLowerCase() === 'member' && el.x_room_of && el.created_by === bWho && (!bChar || el.created_at < bChar.created_at)) bChar = el;
  }
  if (!bChar) throw new Error('the member has no Member Character on the test world: run walk.mjs once first');
  const bName = bChar.name.trim();
  const trainer = await make(host, 'object', { name: `Walk trainer ${RUN}`, subtype: 'in design', description: 'A trainer the walk drew.\nIts second line.' });
  const screen = await make(host, 'object', { name: `Walk screen ${RUN}`, subtype: 'in design', parent_object: trainer.id, description: 'What a student sees first.' });
  const beastChar = await make(host, 'character', { name: `Walk beast ${RUN}` });
  const noteText = `Building the walk screen ${RUN}\nThe rest of the Note.`;
  const note = await make(member, 'narrative', { name: `Note ${RUN}`, supertype: 'Note', narrator: bChar.id, story: noteText, objects: [trainer.id, screen.id] });
  const item = await make(host, 'relation', { name: `Take the walk screen ${RUN}`, supertype: 'Work item', subtype: 'taken', characters: [bChar.id], x_room_of: s.worldId });
  console.log(`stands on: member ${bName}, note ${note.id.slice(0, 8)}, item ${item.id.slice(0, 8)}`);

  // keel's roster, with the played rows added (the one played door).
  const roster = await host.members();
  const played = rows => [
    ...rows.map(r => (r.id === bWho ? { ...r, character: bChar.id } : r)),
    { id: `a1a1a1a1-0000-4000-8000-${RUN.padStart(12, '0').slice(-12)}`, kind: 'agent', role: 'contributor', character: beastChar.id, status: 'active', name: 'beast-seat', sponsor_member: null, lenses: [], lenses_from: 'none' },
    { id: `a2a2a2a2-0000-4000-8000-${RUN.padStart(12, '0').slice(-12)}`, kind: 'agent', role: 'contributor', character: null, status: 'active', name: `Host's helper ${RUN}`, sponsor_member: 'owner', lenses: [], lenses_from: 'none' },
  ];
  const playMembers = async ctx => ctx.route(/\/api\/v2\/members\/?(\?|$)/, async route => {
    const res = await route.fetch();
    const body = await res.json();
    const rows = Array.isArray(body) ? body : body.data ?? body.results ?? [];
    const out = played(rows);
    await route.fulfill({ response: res, json: Array.isArray(body) ? out : { ...body, [body.data ? 'data' : 'results']: out } });
  });

  // ---------------------------------------------------------------- the host
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(hostCtx, 'crew-walk-c');
  await playMembers(hostCtx);
  const h = await hostCtx.newPage();
  pages.push([h, 'crew-walk-c']);
  const errors = [];
  h.on('pageerror', e => errors.push(String(e)));
  await h.goto(`${BASE}#/w/${s.worldId}`);
  check('host: the room opens', await until(() => h.locator('.top[data-room-role="host"]').isVisible(), 30000));
  if (await h.locator('#my-name').isVisible().catch(() => false)) {
    await h.fill('#my-name', 'Host C');
    await h.getByRole('button', { name: 'Save', exact: true }).click();
  }
  check('top bar: the mark, PARLOR, the world\'s name, Your worlds; no host chip, no seat orbs', await h.locator('.top img.mark').isVisible()
    && await h.locator('.top .wname', { hasText: 'Parlor ground (crew test)' }).isVisible()
    && await h.getByRole('button', { name: 'Your worlds' }).isVisible()
    && (await h.getByText('You: host').count()) === 0 && (await h.locator('.top .seats, .top .bdg').count()) === 0);
  // A workshop left running by an earlier walk is ended first, so this walk starts outside one.
  const run = h.locator('[data-part="run-workshop"]');
  check('host: Run a workshop or End the workshop shows for a host in a team world', await until(() => run.isVisible(), 10000));
  if ((await run.innerText({ timeout: 4000 }).catch(() => '')) === 'End the workshop') {
    await run.click();
    check('host: an earlier walk\'s workshop is ended first', await until(async () => (await run.innerText({ timeout: 4000 }).catch(() => '')) === 'Run a workshop', 15000));
  }
  check('host: the panel opens on Crew, with no Specs tab while no workshop runs', await until(async () =>
    (await h.getByRole('tab', { name: 'Crew' }).getAttribute('aria-selected')) === 'true' && (await h.getByRole('tab', { name: 'Specs' }).count()) === 0, 10000));
  check('host: no host panel in the page while no workshop runs', await h.locator('[data-part="host-panel"]').isHidden());
  check('host: the room\'s head says Team chat', await h.locator('.head .room-title', { hasText: 'Team chat' }).isVisible());
  const crew = h.locator('[data-part="crew"]');
  check('crew: Team chat leads, then Beasts and People and their AIs', await until(async () =>
    await crew.locator('[data-seat="team"]').isVisible() && await crew.getByRole('button', { name: /^Beasts/ }).isVisible() && await crew.getByRole('button', { name: /^People and their AIs/ }).isVisible(), 20000));
  const beastRow = crew.locator('.row', { hasText: `Walk beast ${RUN}` });
  check('crew: an AI no one answers for is a beast, named by its Character', await until(() => beastRow.isVisible(), 20000));
  const helper = crew.locator('.kid .row', { hasText: `Host's helper ${RUN}` });
  check('crew: an AI the owner answers for sits under the owner, folded by "1 AI"', await until(() => helper.isVisible(), 10000)
    && await crew.locator('.wrap', { has: h.locator('.fold') }).first().locator('.fold').innerText({ timeout: 4000 }).catch(() => '').then(t => /1 AI/.test(t)));
  check('crew: an AI with no Character has no room you can see, and is not pressable', /no room you can see/.test(await helper.innerText({ timeout: 4000 }).catch(() => '')) && (await crew.locator(`.kid div.row.none`, { hasText: `Host's helper ${RUN}` }).count()) === 1);
  const bRow = crew.locator(`button.row[data-seat="${bWho}"]`);
  check('crew: the member\'s row reads its Note\'s first line and wears the working ring', await until(async () =>
    (await bRow.innerText({ timeout: 4000 }).catch(() => '')).includes(`Building the walk screen ${RUN}`) && (await bRow.locator('.ring').count()) === 1, 20000), await bRow.innerText({ timeout: 4000 }).catch(() => ''));
  check('crew: the member\'s row says since when, and carries its Note\'s two elements', /since /.test(await bRow.innerText({ timeout: 4000 }).catch(() => '')) && (await bRow.locator('.dots .body').count()) === 2);
  // The fold is kept: fold the owner's AIs, a feed tick later still folded.
  await crew.locator('.fold').first().click();
  check('crew: a person\'s AIs fold', await until(() => helper.isHidden(), 5000));
  await h.waitForTimeout(4000);
  check('crew: the fold holds through the feed', await helper.isHidden());
  await crew.locator('.fold').first().click();
  await shot(h, 'crew');

  // ---------------------------------------------------------------- the member's room
  await bRow.click();
  check('room: a press opens the member\'s room, named in the head', await until(() => h.locator('.head .room-title', { hasText: `${bName}’s room` }).isVisible(), 5000));
  check('room: the work line is the Note\'s first line as written', (await h.locator('[data-part="work-line"]').innerText({ timeout: 4000 }).catch(() => '')) === `Building the walk screen ${RUN}`);
  const meta = await h.locator('[data-part="work-meta"]').innerText({ timeout: 4000 }).catch(() => '');
  check('room: since, its Note\'s time and asked by the work item\'s maker', /since /.test(meta) && /its Note at /.test(meta) && /asked by Host C/.test(meta), meta);
  check('room: the Note\'s elements as chips', (await h.locator('[data-part="work-elements"] .chip').count()) === 2);
  check('room: the write box says whom it writes to', (await h.locator('.send textarea').getAttribute('placeholder')) === `Write to ${bName} (everyone can read it)`);

  // An element opens in place over the room; a neighbour steps; it holds through a tick; × closes.
  await h.locator('[data-part="work-elements"] .chip', { hasText: `Walk trainer ${RUN}` }).click();
  const card = h.locator('[data-part="element-card"]');
  check('card: the element opens over the room with its name, kind and state', await until(async () =>
    await card.isVisible() && (await card.locator('h2').innerText({ timeout: 4000 }).catch(() => '')) === `Walk trainer ${RUN}` && /Object · in design/.test(await card.locator('.kind').innerText({ timeout: 4000 }).catch(() => '')), 5000), `${await card.locator('h2').innerText().catch(() => '')} | ${await card.locator('.kind').innerText().catch(() => '')}`);
  check('card: its words and the part under it, by the link\'s name', /A trainer the walk drew/.test(await card.innerText({ timeout: 4000 }).catch(() => '')) && await card.locator('.graph .edge-label', { hasText: 'Under it' }).isVisible());
  await h.waitForTimeout(4000);
  check('card: the card holds through the feed', await card.isVisible());
  await card.locator('.graph .nb', { hasText: `Walk screen ${RUN}` }).click();
  check('card: a neighbour steps the card to it', await until(async () => (await card.locator('h2').innerText({ timeout: 4000 }).catch(() => '')) === `Walk screen ${RUN}`, 5000)
    && await card.locator('.graph .edge-label', { hasText: 'Parent object' }).isVisible());
  await shot(h, 'card');
  await card.getByRole('button', { name: 'Close' }).click();
  check('card: × closes it', await until(() => card.isHidden(), 3000));

  // A line written in the member's room names the member's Character, and carries the world's mark (no workshop runs).
  const toB = `To you in your room ${RUN}`;
  const box = h.locator('.send textarea');
  await box.fill(toB);
  await box.press('Enter');
  check('room: the line shows in the member\'s room', await until(() => h.locator('.lines .line', { hasText: toB }).isVisible(), 8000));
  const lineB = await sent(toB);
  check('wire: the line names the member\'s Character, the world\'s mark, nothing else new', !!lineB && JSON.stringify(lineB.characters) === JSON.stringify([bChar.id])
    && lineB.x_room_of === s.worldId && lineB.supertype === 'Message' && !lineB.parent_narrative, JSON.stringify({ c: lineB?.characters, m: lineB?.x_room_of }));
  // Typing survives the feed: a half-written line stays through a tick.
  await box.fill(`Half a line ${RUN}`);
  await h.waitForTimeout(4500);
  check('room: a feed tick never eats typing', (await box.inputValue()) === `Half a line ${RUN}` && await box.evaluate(el => el === document.activeElement));
  await box.fill('');

  // ---------------------------------------------------------------- Team chat: the "to", and a reply under the line
  await crew.locator('[data-seat="team"]').click();
  const inChat = h.locator('.lines .line', { hasText: toB });
  check('chat: the line to the member shows in Team chat, saying whom it is to', await until(async () => (await inChat.locator('[data-part="line-to"]').innerText({ timeout: 4000 }).catch(() => '')) === `to ${bName}`, 8000));
  await inChat.hover();
  await inChat.getByRole('button', { name: /^Reply to/ }).click();
  check('chat: Reply says what the composer answers', await until(() => h.locator('.reply', { hasText: 'Replying to' }).isVisible(), 3000));
  const reply = `A reply under it ${RUN}`;
  await box.fill(reply);
  await box.press('Enter');
  const replyEl = await sent(reply);
  check('wire: the reply writes parent_narrative and no address', !!replyEl && replyEl.parent_narrative === lineB?.id && !(replyEl.characters ?? []).length, JSON.stringify({ p: replyEl?.parent_narrative, c: replyEl?.characters }));
  check('chat: the reply sits under its line', await until(async () => {
    const order = await h.locator('.lines .line').evaluateAll(els => els.map(e => [e.textContent ?? '', e.classList.contains('reply-line')]));
    const i = order.findIndex(([t]) => t.includes(toB)), j = order.findIndex(([t]) => t.includes(reply));
    return i >= 0 && j === i + 1 && order[j][1] === true;
  }, 8000));
  await bRow.click();
  check('room: the reply shows under the line in the member\'s room, though it names no one', await until(async () =>
    await h.locator('.lines .line.reply-line', { hasText: reply }).isVisible(), 8000));
  check('room: a line to no one is not in the member\'s room', !(await h.locator('.lines .line', { hasText: 'Hello from the' }).count()));
  await shot(h, 'seat-room');
  // Report moves the composer to Team chat, saying so.
  await h.locator('[data-part="report"]').click();
  check('room: Report moves the composer to Team chat', await until(() => h.locator('.head .room-title', { hasText: 'Team chat' }).isVisible(), 3000));
  await h.locator('[data-part="report"]').click();

  // ---------------------------------------------------------------- the member's page: keel's own roster
  const mCtx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, ...(engineName === 'chromium' ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}) }
    : { viewport: { width: 1280, height: 800 } });
  await signedIn(mCtx, 'crew-walk-b');
  const m = await mCtx.newPage();
  pages.push([m, 'crew-walk-b']);
  m.on('pageerror', e => errors.push(String(e)));
  await m.goto(`${BASE}#/w/${s.worldId}`);
  check('member: the room opens', await until(() => m.locator('.top[data-room-role="member"]').isVisible(), 30000));
  check('member: no Run a workshop for a member', (await m.locator('[data-part="run-workshop"]:visible').count()) === 0);
  check('member: the line to them shows in Team chat with its "to"', await until(() => m.locator('.lines .line', { hasText: toB }).locator('[data-part="line-to"]').isVisible(), 15000));
  if (phone) {
    const panes = () => m.locator('section.pane').evaluateAll(els => els.map(e => getComputedStyle(e).display !== 'none'));
    check('phone: one pane at a time, the room first', JSON.stringify(await panes()) === '[true,false]');
    check('phone: no sideways scroll', !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    await m.locator('.mtabs').getByRole('button', { name: 'Crew and work' }).click();
    const myRow = m.locator(`[data-part="crew"] button.row[data-seat="${bWho}"]`);
    check('phone: the crew list shows, the member\'s own row in it', await until(() => myRow.isVisible(), 10000));
    await myRow.click();
    check('phone: a row opens its room on the room\'s pane', await until(async () => JSON.stringify(await panes()) === '[true,false]' && await m.locator('.head .room-title', { hasText: `${bName}’s room` }).isVisible(), 5000));
    check('phone: no sideways scroll in a seat\'s room', !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    await shot(m, 'phone-room');
    await m.locator('.mtabs').getByRole('button', { name: 'Crew and work' }).click();
    await m.locator('[data-part="crew"] [data-seat="team"]').click();
  }

  // ---------------------------------------------------------------- Run a workshop, and End it
  await run.click();
  check('host: Run a workshop shows the host panel, writing nothing', await until(() => h.locator('[data-part="host-panel"]').isVisible(), 3000));
  check('host: the host sees Specs while the panel is open', await h.getByRole('tab', { name: 'Specs' }).isVisible());
  await h.waitForTimeout(3000);
  check('member: no Specs while no switch is on', (await m.getByRole('tab', { name: 'Specs' }).count()) === 0 || await m.getByRole('tab', { name: 'Specs' }).isHidden());
  const startBtn = h.getByRole('button', { name: /Start (the first|a new) sitting/ });
  await startBtn.click();
  check('host: a sitting starts in Arrive', await until(() => h.locator('.hostbar .pp.now', { hasText: 'Arrive' }).isVisible(), 10000));
  await h.locator('.hostbar .pp', { hasText: 'Pitch' }).click();
  check('member: Specs shows once a switch is on', await until(async () => {
    if (phone) await m.locator('.mtabs').getByRole('button', { name: 'Crew and work' }).click().catch(() => {});
    return m.getByRole('tab', { name: 'Specs' }).isVisible();
  }, 15000));
  // A line said while the workshop runs carries the sitting's mark.
  await crew.locator('[data-seat="team"]').click();
  const during = `Said during the workshop ${RUN}`;
  await box.fill(during);
  await box.press('Enter');
  const duringEl = await sent(during);
  let sittingId = null;
  for await (const e of host.listAll('event')) if ((e.supertype ?? '').toLowerCase() === 'sitting' && e.x_room_of && (!sittingId || e.created_at > sittingId.at)) sittingId = { id: e.id, at: e.created_at };
  check('wire: a line said while a workshop runs carries the sitting\'s mark', duringEl?.x_room_of === sittingId?.id, String(duringEl?.x_room_of));
  await shot(h, 'workshop');
  await run.click();
  check('host: End the workshop folds the panel', await until(() => h.locator('[data-part="host-panel"]').isHidden(), 5000));
  let ended = null;
  await until(async () => { ended = await host.get('event', sittingId.id); return !ended.x_hearts_on && !ended.x_specs_shown && !ended.x_voting_open; }, 10000);
  check('wire: End turned every switch off, the phase kept', !!ended && !ended.x_hearts_on && !ended.x_specs_shown && !ended.x_voting_open && ended.subtype === 'Pitch', JSON.stringify({ h: ended?.x_hearts_on, s: ended?.x_specs_shown, v: ended?.x_voting_open, p: ended?.subtype }));
  check('member: Specs goes once the workshop ends', await until(async () => (await m.getByRole('tab', { name: 'Specs' }).count()) === 0 || await m.getByRole('tab', { name: 'Specs' }).isHidden(), 15000));
  const after = `Said after the workshop ${RUN}`;
  await box.fill(after);
  await box.press('Enter');
  const afterEl = await sent(after);
  check('wire: a line said after it ends carries the world\'s mark', afterEl?.x_room_of === s.worldId, String(afterEl?.x_room_of));
  check('chat: Team chat still holds the line said during the workshop', await h.locator('.lines .line', { hasText: during }).isVisible());

  // ---------------------------------------------------------------- house rules from the top bar
  await h.locator('[data-part="rules"]').click();
  check('rules: Rules opens the house rules in the same card, whole', await until(async () => await card.isVisible() && /House rules/.test(await card.locator('h2').innerText({ timeout: 4000 }).catch(() => '')) && await card.locator('.card-text.whole').isVisible(), 5000));
  await h.keyboard.press('Escape');
  check('rules: Escape closes it', await until(() => card.isHidden(), 3000));

  // ---------------------------------------------------------------- Designs: a fold with its part, a name's card
  await h.getByRole('tab', { name: 'Designs' }).click();
  const fold = h.locator(`[data-fold="${trainer.id}"]`);
  check('designs: the design shows with its size, folded', await until(async () => /1 part/.test(await fold.innerText({ timeout: 4000 }).catch(() => '')) && (await fold.locator(`[data-design="${screen.id}"]`).count()) === 0, 10000));
  await fold.getByRole('button', { name: `Unfold Walk trainer ${RUN}` }).click();
  check('designs: unfolded, its part shows under it', await until(() => fold.locator(`[data-design="${screen.id}"]`).isVisible(), 5000));
  await fold.locator(`[data-design="${screen.id}"] [data-el="${screen.id}"]`).click();
  check('designs: a part\'s name opens its card', await until(async () => (await card.locator('h2').innerText({ timeout: 4000 }).catch(() => '')) === `Walk screen ${RUN}`, 5000));
  await card.getByRole('button', { name: 'Close' }).click();
  await shot(h, 'designs');

  check('no page error', errors.length === 0, errors.slice(0, 2).join(' | '));
  for (const [p, label] of pages) await recordMinted(p, label);
  await mCtx.close();
  await hostCtx.close();

  // ---------------------------------------------------------------- a workshop world, read only
  if (!phone) {
    const worlds = (await accountCall(s.tokens['crew-walk-b'].token, 'GET', '/account/worlds')).data;
    const ground = worlds.find(w => w.name === 'Dashboard ground (crew test)' && w.role === 'owner');
    if (!ground) check('workshop world: crew-walk-b owns Dashboard ground', false);
    else {
      const key = await mintKey('crew-walk-b', ground.id);
      const wCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await signedIn(wCtx, 'crew-walk-b', { [ground.id]: key });
      const w = await wCtx.newPage();
      const wErrors = [];
      w.on('pageerror', e => wErrors.push(String(e)));
      // Read only: a write from this page would be a failure of the walk, so every write is refused before it leaves.
      let writes = 0;
      await w.route(/\/api\/v2\//, route => {
        const method = route.request().method();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
        writes++;
        return route.abort();
      });
      await w.goto(`${BASE}#/w/${ground.id}`);
      check('workshop world: the room opens for its owner', await until(() => w.locator('.top[data-room-role="host"]').isVisible(), 30000));
      check('workshop world: no Run a workshop, the host panel shown as before', await until(async () =>
        (await w.locator('[data-part="run-workshop"]:visible').count()) === 0 && await w.locator('[data-part="host-panel"]').isVisible() && await w.locator('.hostbar h3', { hasText: 'Host' }).isVisible(), 15000));
      check('workshop world: Specs is a tab', await w.getByRole('tab', { name: 'Specs' }).isVisible());
      check('workshop world: the top bar and the tabs are the new ones', await w.getByRole('button', { name: 'Your worlds' }).isVisible() && await w.getByRole('tab', { name: 'Crew' }).isVisible());
      await w.getByRole('tab', { name: 'Specs' }).click();
      check('workshop world: Specs holds its sitting state as before', await until(() => w.locator('section.pane.side').getByText(/No sitting yet|Specs ·/).first().isVisible(), 8000));
      await shot(w, 'workshop-world');
      check('workshop world: the page wrote nothing', writes === 0, String(writes));
      check('workshop world: no page error', wErrors.length === 0, wErrors.slice(0, 2).join(' | '));
      await wCtx.close();
    }
  }
} finally {
  clearTimeout(timer);
  for (const [p, label] of pages) await recordMinted(p, label).catch(() => {});
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${engineName}${phone ? ' phone' : ''}: ${results.length - failed} of ${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
