// The ground's live walk (OW Parlor #481): a host and a member on production keel,
// the built bundle served by `vite preview`, one engine per run.
//   WALK_STATE=<scratch file> SHOTS=<dir> node walk/walk.mjs chromium|firefox [member-label]
// The host is crew-walk-c. crew-walk-d walks the PIN-less door. The member
// (default crew-walk-b) joins by the seed's invite link, names itself, posts,
// writes a spec and votes; the host runs every phase, hearts, stars the
// winner, then hides the member's line, which must leave the member's room.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, API } from './accounts.mjs';

const engine = process.argv[2] === 'firefox' ? firefox : chromium;
const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const memberLabel = process.argv[3] ?? 'crew-walk-b';
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30336/';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const s = readState();
const results = [];
let step = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engineName}-${String(++step).padStart(2, '0')}-${name}.png` });
}
async function until(fn, ms = 12000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 300));
  }
}

/** Sign in through the page's own form (the door), counting toward keel's sign-in budget. */
async function signInByForm(page, label) {
  const a = account(label);
  // No password box on the landing: the Entry button opens the form.
  check(`${label}: the landing shows no password box before the Entry button`, await page.locator('#password').isHidden());
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await page.fill('#login', a.email);
  await page.fill('#password', a.password);
  await page.locator('form button[type=submit]').click();
}

/** Reuse a token the seed minted: the page starts signed in, as after a reload. */
async function withToken(ctx, label, pin) {
  const t = s.tokens[label];
  if (!t) throw new Error(`no seeded token for ${label}: run seed.mjs ${label}`);
  await ctx.addInitScript(([token, login, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) {
      localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login, pin, keys: {} }));
    }
  }, [t.token, label, pin]);
}

/** The keys and token a page's parlor holds, recorded by their last four for teardown (never the secrets). */
async function recordMinted(page, label) {
  const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null);
  if (!sess) return;
  for (const k of [...Object.values(sess.keys ?? {}), ...Object.values(sess.readKeys ?? {})]) {
    if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label, last4: k.slice(-4) });
  }
  if (typeof sess.token === 'string' && sess.token !== s.tokens[label]?.token) s.minted.push({ kind: 'browser-token', label, last4: sess.token.slice(-4) });
  writeState(s);
}

const api = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
s.decoys ??= [];
/** A lore decoy made by the host's own key, in the room's words, without the mark; recorded by id. */
async function decoy(type, body) {
  const made = await api.create(type, body);
  s.decoys.push({ type, id: made.id });
  writeState(s);
  return made;
}

/** Every policy violation a page meets, kept on the page: on a host serving public/_headers, the walk counts them. */
const watchPolicy = ctx => ctx.addInitScript(() => {
  window.__policy = [];
  document.addEventListener('securitypolicyviolation', e => window.__policy.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const policyOf = page => page.evaluate(() => window.__policy ?? []).catch(() => []);
const violations = [];

const browser = await engine.launch();
const pages = [];
try {
  // ---------------------------------------------------------------- the host
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await watchPolicy(hostCtx);
  await withToken(hostCtx, 'crew-walk-c', account('crew-walk-c').pin);
  const host = await hostCtx.newPage();
  pages.push([host, 'crew-walk-c']);
  await host.goto(`${BASE}#/w/${s.worldId}`);
  check('host: the room opens on the host\'s own seat', await until(() => host.getByText('You: host').isVisible()));
  check('host: the charter is on the work surface', await until(() => host.locator('details.card summary', { hasText: 'House rules' }).isVisible()));
  if (await host.locator('#my-name').isVisible().catch(() => false)) {
    await host.fill('#my-name', 'Host C');
    await host.getByRole('button', { name: 'Save', exact: true }).click();
  }
  check('host: the room names the host', await until(() => host.locator('.seatlist li', { hasText: 'Host C' }).isVisible()));
  if (await host.getByRole('button', { name: 'Start the first sitting' }).isVisible().catch(() => false)) {
    await host.getByRole('button', { name: 'Start the first sitting' }).click();
  } else {
    await host.getByRole('button', { name: 'Start a new sitting' }).click();
  }
  check('host: a sitting starts in Arrive', await until(() => host.locator('.hostbar .pp.now', { hasText: 'Arrive' }).isVisible()));
  // Lore in the room's words, made after the room's sitting began: a Sitting already in Voting, then
  // a letter (inside both sittings' time windows, so a reader by pair alone shows it whichever it
  // takes). Neither may show as the room or take its phase.
  await decoy('event', { name: 'Decoy sitting', supertype: 'Sitting', subtype: 'Voting', x_hearts_on: true, x_specs_shown: true, x_voting_open: true });
  await decoy('narrative', { name: 'Decoy letter', supertype: 'Message', description: 'DECOY: a letter in the world\'s lore, never a line in the room' });
  await host.waitForTimeout(4500);
  check('host: a lore letter is not a line in the room', !(await host.locator('.lines').getByText('DECOY: a letter').count()));
  check('host: a newer lore Sitting does not take the room (still Arrive, after the feed)', await host.locator('.hostbar .pp.now', { hasText: 'Arrive' }).isVisible());
  await shot(host, 'host-lobby');

  // ---------------------------------------------------------------- d: the PIN-less door
  if (engineName === 'chromium') {
    const dCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await watchPolicy(dCtx);
    const d = await dCtx.newPage();
    await d.goto(`${BASE}#/join/${s.invites['crew-walk-d'].code}`);
    check('d: the landing names the world it invites to', await until(() => d.getByRole('heading', { name: 'Join Parlor ground (crew test)' }).isVisible()));
    check('d: the code left the address bar', !d.url().includes('ow_j_'), d.url());
    await shot(d, 'd-landing');
    await signInByForm(d, 'crew-walk-d');
    check('d: a PIN-less member reads the room', await until(() => d.getByText('You: member').isVisible(), 20000));
    check('d: and is told how to write', await until(() => d.getByText('your account needs a PIN').isVisible()));
    check('d: no composer for a reader', await d.locator('textarea[aria-label="Write a line"]').count() === 0);
    await shot(d, 'd-pin-required');
    check('host: the new seat shows without a reload', await until(() => host.locator('.seatlist li').count().then(n => n >= 2), 40000));
    s.dJoined = true;
    writeState(s);
    await recordMinted(d, 'crew-walk-d');
    violations.push(...await policyOf(d));
    await dCtx.close();
  }

  // ---------------------------------------------------------------- the member
  // PHONE=1: the member on a 390 px phone, one pane at a time, switching tabs as a person would.
  const phone = process.env.PHONE === '1';
  const mCtx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, ...(phone && engineName === 'chromium' ? { isMobile: true, hasTouch: true } : {}) });
  await watchPolicy(mCtx);
  await withToken(mCtx, memberLabel, account(memberLabel).pin);
  const m = await mCtx.newPage();
  pages.push([m, memberLabel]);
  await m.goto(`${BASE}#/join/${s.invites.member.code}`);
  // Signed in already: the invite is asked first, naming the account (S474, the sign-in gate's G1).
  const ask = m.getByRole('button', { name: `Join Parlor ground (crew test) as ${memberLabel}` });
  check('member: a signed-in invite asks first, naming the account', await until(() => ask.isVisible(), 20000));
  await ask.click();
  check('member: the join lands in the room', await until(() => m.getByText('You: member').isVisible(), 20000));
  const named = await m.locator('#my-name').isVisible().catch(() => false);
  if (named) {
    await m.fill('#my-name', `Walker ${engineName}`);
    await m.getByRole('button', { name: 'Save', exact: true }).click();
  }
  check('member: the room knows their name', await until(() => m.locator('#my-name').isHidden()), named ? 'named just now' : 'named before');
  // One Entry per screen (Seethe h66 #12914): Send and the name's Save are Standard.
  {
    const entries = await m.locator('.btn.entry').evaluateAll(els => els.filter(e => e.offsetParent !== null).map(e => e.textContent));
    check('member: at most one Entry button on the screen', entries.length <= 1, entries.join(', '));
  }
  const tab = async name => { if (phone) await m.locator('.mtabs').getByRole('button', { name }).click(); };
  if (phone) {
    const panes = async () => m.locator('section.pane').evaluateAll(els => els.map(e => getComputedStyle(e).display !== 'none'));
    check('phone: one pane at a time, the room first', JSON.stringify(await panes()) === '[true,false]');
    const wide = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('phone: no sideways scroll', !wide);
  }
  check('host: the member\'s seat shows by name without a reload', await until(() => host.locator('.seatlist li', { hasText: 'Walker' }).isVisible(), 40000));
  const lineText = `Hello from the ${engineName} walk, ${new Date().toISOString().slice(11, 19)}`;
  await m.fill('textarea[aria-label="Write a line"]', lineText);
  await m.keyboard.press('Enter');
  check('member: their line shows at once', await until(() => m.getByText(lineText).isVisible(), 5000));
  check('host: the member\'s line arrives by the feed', await until(() => host.getByText(lineText).isVisible(), 8000));
  const hostLine = host.locator('.line', { hasText: lineText });
  check('host: the line carries the member\'s name, not an AI mark', await until(async () => (await hostLine.locator('.who').innerText()).startsWith('Walker') && !(await hostLine.getAttribute('class')).includes('ai')));
  await shot(m, 'member-line');

  // Which door: the parlor names itself on writes (keel #520), and a room line written by a plain
  // script (the SDK's default client, the pair and the mark) shows in the room, saying so.
  {
    let mine = null;
    for await (const e of api.listAll('narrative')) if (e.description === lineText) mine = e;
    check('door: the member\'s line reads back changed_client parlor', mine?.changed_client === 'parlor', String(mine?.changed_client));
    let sittingId = null;
    for await (const e of api.listAll('event')) if ((e.supertype ?? '').toLowerCase() === 'sitting' && e.x_room_of && (!sittingId || e.created_at > sittingId.at)) sittingId = { id: e.id, at: e.created_at };
    const scriptText = `A line from a script, ${engineName}, ${new Date().toISOString().slice(11, 19)}`;
    await decoy('narrative', { name: 'Script line', supertype: 'Message', description: scriptText, x_room_of: sittingId?.id });
    check('door: a script\'s marked line shows in the member\'s room, said as a script\'s', await until(async () =>
      (await m.locator('.line', { hasText: scriptText }).locator('.meta').innerText()).includes('through a script'), 10000));
  }

  // Pitch: specs shown, hearts on.
  await host.locator('.hostbar .pp', { hasText: 'Pitch' }).click();
  await tab('Work');
  check('member: the phase reaches them', await until(() => m.locator('.phases .pp.now', { hasText: 'Pitch' }).isVisible(), 8000));
  // Unique per run: a read-back by name must never meet an earlier run's spec (10-22's were left starred).
  const specTitle = `A ${engineName} map that draws itself, ${new Date().toISOString().slice(11, 19)}`;
  await m.getByRole('button', { name: /Add your spec|Edit your spec/ }).click();
  await m.fill('#spec-title', specTitle);
  await m.fill('#spec-text', 'A spec with "quotes" and <b>tags</b> stays text.');
  await m.getByRole('radio', { name: 'A feature' }).check();
  await m.getByRole('button', { name: 'Save your spec' }).click();
  check('host: the member\'s spec arrives', await until(() => host.getByRole('heading', { name: specTitle }).isVisible(), 8000));
  check('host: markup in a spec stays text', await until(() => host.getByText('<b>tags</b>', { exact: false }).isVisible()));
  check('host: the spec says its kind', await until(() => host.locator('.card', { has: host.getByRole('heading', { name: specTitle }) }).locator('.chip', { hasText: 'Feature' }).isVisible()));
  // A lore Heart by the host's own key on the member's spec: never counted, never the host's to toggle.
  const specRow = await until(async () => { for await (const e of api.listAll('construct')) if (e.name === specTitle) { s.specId = e.id; return true; } return false; }, 8000);
  if (specRow) await decoy('relation', { name: 'Decoy heart', supertype: 'Heart', constructs: [s.specId] });
  await host.waitForTimeout(4500);
  const hostCard = host.locator('.card', { has: host.getByRole('heading', { name: specTitle }) });
  check('host: a lore Heart is not counted on the spec (♡ 0 before anyone hearts)', specRow && (await hostCard.locator('.m').innerText()).includes('♡ 0'), await hostCard.locator('.m').innerText().catch(() => ''));
  await hostCard.getByRole('button', { name: '♡ Heart' }).click();
  const memberCard = m.locator('.card', { has: m.getByRole('heading', { name: specTitle }) });
  check('member: the host\'s heart reaches them', await until(async () => (await memberCard.locator('.m').innerText()).includes('♡ 1'), 8000));
  await shot(host, 'host-design');

  // Vote.
  await host.locator('.hostbar .pp', { hasText: 'Vote' }).click();
  check('member: voting opens for them', await until(() => m.getByText('Pick up to three, in order.').isVisible(), 8000));
  await memberCard.getByRole('button', { name: 'Pick' }).click();
  await m.getByRole('button', { name: /Send my vote|Change my vote/ }).click();
  check('host: the vote counts', await until(async () => (await hostCard.locator('.m').innerText()).includes('points'), 8000));
  // Change my vote patches this sitting's vote (one row, the mark kept), never a new one.
  await m.getByRole('button', { name: 'Change my vote' }).click();
  await m.waitForTimeout(2000);
  await shot(m, 'member-voting');

  // Edit your spec patches this sitting's spec.
  await m.getByRole('button', { name: 'Edit your spec' }).click();
  check('member: the edit form keeps the kind picked', await m.getByRole('radio', { name: 'A feature' }).isChecked());
  await m.fill('#spec-text', 'An edited spec, the same element.');
  await m.getByRole('button', { name: 'Save your spec' }).click();
  check('host: the edited spec arrives', await until(() => host.getByText('An edited spec, the same element.').isVisible(), 8000));

  // The winner, then Build and Show.
  await hostCard.getByRole('button', { name: 'Make it the winner' }).click();
  check('member: the winner is starred for them', await until(() => m.locator('.card.star', { hasText: specTitle }).isVisible(), 8000));
  await host.locator('.hostbar .pp', { hasText: 'Build' }).click();
  // At a person's pace: the host sees Build lit before pressing Show (a press inside the bar's
  // own redraw, a few milliseconds after the last, is a robot's).
  check('host: Build is lit', await until(() => host.locator('.hostbar .pp.now', { hasText: 'Build' }).isVisible(), 8000));
  await host.locator('.hostbar .pp', { hasText: 'Show' }).click();
  check('member: Show reaches them', await until(() => m.locator('.phases .pp.now', { hasText: 'Show' }).isVisible(), 8000));
  await shot(m, 'member-showcase');

  // The board (sheet §1, screen 07): the member raises an entry waiting on the host, the host
  // answers it in the room, the member takes it off. A lore Board narrative never shows.
  const entryTitle = `Who decides the ${engineName} map's scale? ${new Date().toISOString().slice(11, 19)}`;
  await decoy('narrative', { name: `DECOY board ${engineName}`, supertype: 'Board', subtype: 'red', description: 'lore, never an entry' });
  await m.getByRole('tab', { name: /^Board/ }).click();
  await host.getByRole('tab', { name: /^Board/ }).click();
  await m.getByRole('button', { name: 'Put something on the board' }).click();
  await m.fill('#board-title', entryTitle);
  await m.locator('#board-who').selectOption({ label: 'Host C' });
  await m.getByRole('radio', { name: /^Orange/ }).check();
  await m.fill('#board-text', 'Two scales <i>disagree</i>.');
  await m.getByRole('button', { name: 'Put it on the board' }).click();
  const hostEntry = host.locator('.bentry', { hasText: entryTitle });
  check('host: the entry arrives on the board, waiting on the host', await until(async () =>
    (await hostEntry.locator('.m').first().innerText()).startsWith('Waits on Host C · raised by Walker'), 10000));
  check('host: the colour word comes first', await hostEntry.locator('.chip.c-orange', { hasText: 'Orange' }).isVisible());
  await host.waitForTimeout(2500);
  check('host: a lore Board narrative is not on the board', !(await host.locator('.bentry', { hasText: `DECOY board ${engineName}` }).count()));
  check('host: markup in an entry stays text', await hostEntry.getByText('<i>disagree</i>', { exact: false }).isVisible());
  await hostEntry.getByRole('button', { name: 'Answer' }).click();
  check('host: the composer says what it answers', await host.locator('.reply', { hasText: `Answering: ${entryTitle}` }).isVisible());
  const answerText = `The host answers from ${engineName}: 1 to 1000.`;
  await host.fill('textarea[aria-label="Write a line"]', answerText);
  await host.keyboard.press('Enter');
  check('host: the answer is a line saying what it answers', await until(async () =>
    (await host.locator('.line', { hasText: answerText }).locator('.meta').innerText()).includes(`answering ${entryTitle}`), 8000));
  check('host: the composer lets go of the entry once sent', await until(() => host.locator('.reply').isHidden(), 3000));
  const memberEntry = m.locator('.bentry', { hasText: entryTitle });
  check('member: the entry counts the answer', await until(() => memberEntry.getByText('1 answer in the room').isVisible(), 10000));
  await shot(host, 'host-board-entry');
  {
    let entry = null, answer = null, sitting = null;
    for await (const e of api.listAll('narrative')) {
      if (e.name === entryTitle) entry = e;
      if (e.description === answerText) answer = e;
    }
    for await (const e of api.listAll('event')) if ((e.supertype ?? '').toLowerCase() === 'sitting' && e.x_room_of && (!sitting || e.created_at > sitting.created_at)) sitting = e;
    const roster = await api.members();
    const hostChar = roster.find(r => r.id === null)?.character ?? null;
    let hostCard = null;
    for await (const e of api.listAll('character')) if ((e.supertype ?? '').toLowerCase() === 'member' && e.x_room_of && !e.created_by && (!hostCard || e.created_at < hostCard.created_at)) hostCard = e;
    const hostWho = hostChar ?? hostCard?.id ?? null;
    check('board: the entry reads back Board, orange, the sitting\'s mark', entry?.supertype === 'Board' && entry?.subtype === 'orange' && entry?.x_room_of === sitting?.id, `${entry?.supertype} ${entry?.subtype} ${entry?.x_room_of}`);
    check('board: it waits on one Character, the host\'s own', (entry?.characters ?? []).length === 1 && entry.characters[0] === hostWho, `${JSON.stringify(entry?.characters)} ${hostWho}`);
    check('board: the answer is a Message answering the entry, marked', answer?.supertype === 'Message' && answer?.parent_narrative === entry?.id && answer?.x_room_of === sitting?.id);
  }
  await memberEntry.getByRole('button', { name: 'Done: take it off the board' }).click();
  check('host: Done takes the entry off the host\'s board', await until(() => hostEntry.isHidden(), 10000));
  check('host: the answer stays in the room', await host.getByText(answerText).isVisible());
  await shot(host, 'host-board');

  // Work items (sheet §1, profiles/packet.md): the member makes one about a lore Character, for the
  // host; the host answers it and marks it done; the member deletes it. A lore Work item never shows.
  const stamp = new Date().toISOString().slice(11, 19);
  const loreName = `Walk lore ${engineName} ${stamp}`;
  const lore = await decoy('character', { name: loreName });
  await decoy('relation', { name: `DECOY work ${engineName}`, supertype: 'Work item', subtype: 'open' });
  const workTitle = `Tie ${loreName} into the world`;
  await m.getByRole('tab', { name: /^Work/ }).click();
  await host.getByRole('tab', { name: /^Work/ }).click();
  await m.getByRole('button', { name: 'Add a work item' }).click();
  await m.fill('#work-title', workTitle);
  await m.locator('#work-for').selectOption({ label: 'Host C' });
  await m.fill('#work-text', 'It has no <b>links</b> yet.');
  check('member: the lore Character is found by name', await until(async () => {
    await m.fill('#work-find', `lore ${engineName} ${stamp}`);
    return m.locator('.found button', { hasText: loreName }).isVisible();
  }, 10000));
  {
    // The host's marked card is a room element and never offered; an unmarked one (10-22's ground
    // made them before the mark) is lore by the room profile, and is. Offered = unmarked, and a marked one exists.
    let marked = 0, unmarked = 0;
    for await (const e of api.listAll('character')) if ((e.name ?? '') === 'Host C') e.x_room_of ? marked++ : unmarked++;
    await m.fill('#work-find', 'Host C');
    await m.waitForTimeout(300);
    const offered = await m.locator('.found button', { hasText: 'Host C' }).count();
    check('member: the host\'s marked card is never offered, an unmarked one is lore', marked > 0 && offered === unmarked, `marked ${marked}, unmarked ${unmarked}, offered ${offered}`);
  }
  await m.fill('#work-find', `lore ${engineName} ${stamp}`);
  await m.locator('.found button', { hasText: loreName }).click();
  check('member: the pick is a chip', await m.locator('.picked .chip', { hasText: `${loreName} · Character` }).isVisible());
  await m.getByRole('button', { name: 'Add the work item' }).click();
  const hostItem = host.locator('.witem', { hasText: workTitle });
  check('host: the work item arrives, for the host, open', await until(async () =>
    (await hostItem.locator('.m').first().innerText()).startsWith('For Host C · made by Walker') && await hostItem.locator('.chip.s-open').isVisible(), 10000));
  check('host: it names what it is about', await hostItem.locator('.about .chip', { hasText: `${loreName} · Character` }).isVisible());
  check('host: markup in a work item stays text', await hostItem.getByText('<b>links</b>', { exact: false }).isVisible());
  await host.waitForTimeout(2500);
  check('host: a lore Work item is not work', !(await host.locator('.witem', { hasText: `DECOY work ${engineName}` }).count()));
  await hostItem.getByRole('button', { name: 'Answer' }).click();
  const workAnswer = `The host takes the ${engineName} item: linking it now.`;
  await host.fill('textarea[aria-label="Write a line"]', workAnswer);
  await host.keyboard.press('Enter');
  check('host: the answer says what it answers', await until(async () =>
    (await host.locator('.line', { hasText: workAnswer }).locator('.meta').innerText()).includes(`answering ${workTitle}`), 8000));
  const memberItem = m.locator('.witem', { hasText: workTitle });
  check('member: the item counts the answer', await until(() => memberItem.getByText('1 answer in the room').isVisible(), 10000));

  // Take (profiles/room.md serial 66; contract Forge/Notes/2026-10-25-s474-parlor-take-contract.md).
  // A lore Take on this very item (the pair and x_room_item, no mark) never counts.
  let itemId = null;
  for await (const e of api.listAll('relation')) if (e.name === workTitle) itemId = e.id;
  await decoy('relation', { name: `DECOY take ${engineName}`, supertype: 'Take', subtype: 'taken', x_room_item: itemId });
  await host.waitForTimeout(2500);
  check('member: a lore Take on the item does not take it', await memberItem.locator('.chip.s-open').isVisible() && !(await memberItem.locator('[data-part="taken-by"]').count()));
  await hostItem.getByRole('button', { name: 'Take', exact: true }).click();
  check('member: the host\'s take reaches them, named by its maker', await until(async () =>
    (await memberItem.locator('[data-part="taken-by"]').innerText().catch(() => '')) === 'Taken by Host C' && await memberItem.locator('.chip.s-taken').isVisible(), 10000));
  check('host: the host sees Release on their own take', await until(() => hostItem.getByRole('button', { name: 'Release' }).isVisible()));
  await hostItem.getByRole('button', { name: 'Release' }).click();
  check('member: Release reaches them, the item open again', await until(async () => !(await memberItem.locator('[data-part="taken-by"]').count()) && await memberItem.locator('.chip.s-open').isVisible(), 10000));
  await memberItem.getByRole('button', { name: 'Take', exact: true }).click();
  check('host: the member\'s take reaches the host', await until(async () => (await hostItem.locator('[data-part="taken-by"]').innerText().catch(() => '')).startsWith('Taken by Walker'), 10000));
  let takeEl = null;
  for await (const e of api.listAll('relation')) if ((e.supertype ?? '') === 'Take' && e.x_room_item === itemId && e.x_room_of) takeEl = e;
  {
    let item = null;
    for await (const e of api.listAll('relation')) if (e.id === itemId) item = e;
    check('take: reads back Take, taken, x_room_item the item, the item\'s mark, made by the member, the item untouched',
      takeEl?.subtype === 'taken' && takeEl?.x_room_of === item?.x_room_of && !!takeEl?.created_by && item?.subtype === 'open',
      `${takeEl?.supertype} ${takeEl?.subtype} ${takeEl?.x_room_of === item?.x_room_of} item ${item?.subtype}`);
  }
  await shot(host, 'host-taken');
  await hostItem.getByRole('button', { name: 'Mark done' }).click();
  check('member: done wins over the take', await until(async () => await memberItem.locator('.chip.s-done').isVisible() && !(await memberItem.locator('[data-part="taken-by"]').count()), 10000));
  check('member: Done reaches them', await until(() => memberItem.locator('.chip.s-done').isVisible(), 10000));
  await shot(host, 'host-work-item');
  {
    let item = null, answer = null, sitting = null, hostCard = null;
    for await (const e of api.listAll('relation')) if (e.name === workTitle) item = e;
    for await (const e of api.listAll('narrative')) if (e.description === workAnswer) answer = e;
    for await (const e of api.listAll('event')) if ((e.supertype ?? '').toLowerCase() === 'sitting' && e.x_room_of && (!sitting || e.created_at > sitting.created_at)) sitting = e;
    for await (const e of api.listAll('character')) if ((e.supertype ?? '').toLowerCase() === 'member' && e.x_room_of && !e.created_by && (!hostCard || e.created_at < hostCard.created_at)) hostCard = e;
    const hostWho = (await api.members()).find(r => r.id === null)?.character ?? hostCard?.id ?? null;
    check('work: the item reads back Work item, done, the sitting\'s mark', item?.supertype === 'Work item' && item?.subtype === 'done' && item?.x_room_of === sitting?.id, `${item?.supertype} ${item?.subtype}`);
    check('work: it links the lore Character and is for the host', JSON.stringify(item?.characters) === JSON.stringify([lore.id]) && item?.actor === hostWho, `${JSON.stringify(item?.characters)} ${item?.actor}`);
    check('work: no packet keys written', !!item && !Object.keys(item).some(k => k.startsWith('x_packet_')));
    check('work: the answer is a Message pointing at the item by relations', answer?.supertype === 'Message' && JSON.stringify(answer?.relations) === JSON.stringify([item?.id]) && !answer?.parent_narrative);
  }
  // Reopen: the take still stands, so the item reads taken again.
  await hostItem.getByRole('button', { name: 'Reopen' }).click();
  check('host: reopened, the take stands again', await until(() => hostItem.locator('.chip.s-taken').isVisible(), 10000));
  await hostItem.getByRole('button', { name: 'Delete', exact: true }).click();
  await hostItem.getByRole('button', { name: 'Delete it' }).click();
  check('member: the host\'s Delete takes the item away', await until(() => memberItem.isHidden(), 10000));
  {
    // The host deletes an item the member made and took: the host may delete another's take, so it goes too (T6).
    const gone = takeEl ? await fetch(`${API}/relation/${takeEl.id}`, { headers: { 'API-Key': s.hostKey.key, 'API-Pin': account('crew-walk-c').pin } }).then(r => r.status) : 'no take';
    check('take: the item\'s delete took the member\'s take with it (keel answers 404 or 410)', gone === 404 || gone === 410, String(gone));
  }
  await shot(host, 'host-work');

  // Changes (sheet §2): the lore Character the walk made shows, who and which door; the room's own
  // elements (the work item, the lines) are the room, never a change to the world.
  await host.getByRole('tab', { name: /^Changes/ }).click();
  const loreRow = host.locator('.changes li', { hasText: loreName });
  check('host: the world\'s change shows, said as a script\'s', await until(async () => (await loreRow.innerText()).includes('through a script'), 8000));
  check('host: a room line is not a change to the world', !(await host.locator('.changes').getByText(workAnswer).count()) && !(await host.locator('.changes').getByText(lineText).count()));
  await shot(host, 'host-changes');
  await m.getByRole('tab', { name: /^Specs/ }).click();
  await host.getByRole('tab', { name: /^Specs/ }).click();

  // The room mark (schema-dist profiles/room.md), read back from keel: every room thing this
  // run made carries x_room_of from its first write, and kept it through the phase patches
  // and the star; the charter (lore) carries none.
  {
    const all = async type => { const out = []; for await (const el of api.listAll(type)) out.push(el); return out; };
    const sup = (el, w) => (el.supertype ?? '').trim().toLowerCase() === w;
    const sittings = (await all('event')).filter(e => sup(e, 'sitting') && e.x_room_of).sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    const sitting = sittings[sittings.length - 1];
    const line = (await all('narrative')).find(e => e.description === lineText);
    const spec = (await all('construct')).find(e => e.name === specTitle);
    const rels = await all('relation');
    const heart = rels.find(e => sup(e, 'heart') && e.x_room_of && (e.constructs ?? []).includes(spec?.id));
    const votes = rels.filter(e => sup(e, 'vote') && (e.constructs ?? []).includes(spec?.id));
    const vote = votes[0];
    check('mark: Change my vote patched the one vote (one row for the spec)', votes.length === 1, String(votes.length));
    check('mark: Edit your spec patched the one spec, its mark kept', spec?.description === 'An edited spec, the same element.' && spec?.x_room_of === sitting?.id);
    check('the lore heart still stands (the host\'s toggle never took it)', rels.some(e => e.name === 'Decoy heart'));
    const charter = (await all('law')).find(e => sup(e, 'charter'));
    check('mark: the sitting is the world\'s, kept through every phase change', sitting?.x_room_of === s.worldId && sitting?.subtype === 'Show', `${sitting?.x_room_of} ${sitting?.subtype}`);
    check('mark: the member\'s line is the sitting\'s', !!line && line.x_room_of === sitting?.id, String(line?.x_room_of));
    check('mark: the spec is the sitting\'s, its kind its subtype, kept through the star', !!spec && spec.x_room_of === sitting?.id && spec.subtype === 'Feature', `${spec?.x_room_of} ${spec?.subtype}`);
    check('star: the winner is the sitting\'s x_star, no spec written', !!spec && sitting?.x_star === spec.id, String(sitting?.x_star));
    check('mark: the heart is the sitting\'s', !!heart && heart.x_room_of === sitting?.id, String(heart?.x_room_of));
    check('mark: the vote is the sitting\'s', !!vote && vote.x_room_of === sitting?.id, String(vote?.x_room_of));
    check('mark: the charter is lore, unmarked', !!charter && !('x_room_of' in charter), String(charter?.x_room_of));
    // Made this run, or in an earlier run of a marked build (an unmarked card from before asks again).
    // The member's seat is the line's maker: its marked card, by whatever name an earlier run gave it.
    const card = (await all('character')).find(e => sup(e, 'member') && e.x_room_of && e.created_by === line?.created_by);
    check(`mark: the member's card is the world's (${named ? 'made this run' : 'made before'})`, !!card && card.x_room_of === s.worldId, String(card?.x_room_of));
  }

  // Hide: present before, gone after, in the member's room... except the poster sees their own.
  // So the hidden line is the HOST's own line, read from the member's room.
  const hostLineText = `The host says hi from ${engineName}, ${new Date().toISOString().slice(11, 19)}`;
  await host.fill('textarea[aria-label="Write a line"]', hostLineText);
  await host.keyboard.press('Enter');
  await tab('Room');
  check('member: the host\'s line is in their room (the control)', await until(() => m.getByText(hostLineText).isVisible(), 8000));
  await host.locator('.line', { hasText: hostLineText }).getByRole('button', { name: 'Hide this line' }).click();
  check('host: the hidden line stays, marked, in the host\'s room', await until(() => host.locator('.line.hidden', { hasText: hostLineText }).isVisible(), 5000));
  check('member: the hidden line leaves their room', await until(() => m.getByText(hostLineText).isHidden(), 10000));
  await shot(m, 'member-after-hide');
  await shot(host, 'host-after-hide');

  // The member's own hidden line: the poster still sees it (keel's rule), the host marks it.
  await host.locator('.line', { hasText: lineText }).getByRole('button', { name: 'Hide this line' }).click();
  check('host: the member\'s line is marked hidden', await until(() => host.locator('.line.hidden', { hasText: lineText }).isVisible(), 5000));
  await host.waitForTimeout(4000);
  check('member: the poster still sees their own hidden line (keel: a creator sees what it made)', await m.getByText(lineText).isVisible());
  // keel #682 (PR 243, live 2026-10-25 09:23): a hide gives the member who made the element an upsert
  // row with hidden: true, so the poster is told.
  check('member: told the host hid their own line (keel #682)', await until(() => m.locator('.line', { hasText: lineText }).getByText('Hidden by the host').isVisible(), 20000));

  // An earlier sitting is a record: the host reads it back with nothing in it to change, then returns.
  await host.getByRole('button', { name: 'Show earlier' }).click();
  check('host: an earlier sitting offers no phase, switch or winner to change', await until(async () =>
    await host.getByText('An earlier sitting.').isVisible()
    && await host.locator('.hostbar [role="group"][aria-label="Phase"]').count() === 0
    && await host.getByRole('button', { name: /^Hearts:|^Voting:/ }).count() === 0
    && await host.getByRole('button', { name: 'Make it the winner' }).count() === 0, 5000));
  await shot(host, 'host-earlier');
  // A line written while reading back goes to the newest sitting, and the room comes back to show it.
  const backLine = `Written from an earlier sitting, ${engineName}, ${new Date().toISOString().slice(11, 19)}`;
  await host.fill('textarea[aria-label="Write a line"]', backLine);
  await host.keyboard.press('Enter');
  check('host: a line written while reading back shows, the room back to now', await until(async () =>
    await host.getByText(backLine).isVisible() && !(await host.getByText('An earlier sitting.').count()), 6000));
  check('host: back to now, the phases are the host\'s again', await until(() => host.locator('.hostbar [role="group"][aria-label="Phase"]').isVisible(), 5000));
  // A window narrowed to a phone after load keeps one pane at a time (Seethe h66 #12914), and both come back when wide.
  {
    const panes = () => host.locator('section.pane').evaluateAll(els => els.map(e => getComputedStyle(e).display !== 'none'));
    await host.setViewportSize({ width: 390, height: 844 });
    check('host: narrowed to a phone after load, one pane, the room', await until(async () => JSON.stringify(await panes()) === '[true,false]', 3000));
    await host.setViewportSize({ width: 1440, height: 900 });
    check('host: wide again, both panes', await until(async () => JSON.stringify(await panes()) === '[true,true]', 3000));
  }
} finally {
  for (const [p, label] of pages) { await recordMinted(p, label); violations.push(...await policyOf(p)); }
  check('no page met a policy violation', violations.length === 0, violations.slice(0, 3).join('; '));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${engineName}: ${results.length - failed} of ${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
