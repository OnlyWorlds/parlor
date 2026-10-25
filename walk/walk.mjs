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
  await page.fill('#login', a.email);
  await page.fill('#password', a.password);
  await page.click('button[type=submit]');
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

const browser = await engine.launch();
const pages = [];
try {
  // ---------------------------------------------------------------- the host
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await withToken(hostCtx, 'crew-walk-c', account('crew-walk-c').pin);
  const host = await hostCtx.newPage();
  pages.push([host, 'crew-walk-c']);
  await host.goto(`${BASE}#/w/${s.worldId}`);
  check('host: the room opens on the host\'s own seat', await until(() => host.getByText('You: host').isVisible()));
  check('host: the charter is on the work surface', await until(() => host.getByText('House rules').isVisible()));
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
  check('host: a sitting starts in the Lobby', await until(() => host.locator('.hostbar .pp.now', { hasText: 'Lobby' }).isVisible()));
  // Lore in the room's words, made after the room's sitting began: a Sitting already in Voting, then
  // a letter (inside both sittings' time windows, so a reader by pair alone shows it whichever it
  // takes). Neither may show as the room or take its phase.
  await decoy('event', { name: 'Decoy sitting', supertype: 'Sitting', subtype: 'Voting', x_hearts_on: true, x_specs_shown: true, x_voting_open: true });
  await decoy('narrative', { name: 'Decoy letter', supertype: 'Message', description: 'DECOY: a letter in the world\'s lore, never a line in the room' });
  await host.waitForTimeout(4500);
  check('host: a lore letter is not a line in the room', !(await host.getByText('DECOY: a letter').count()));
  check('host: a newer lore Sitting does not take the room (still Lobby, after the feed)', await host.locator('.hostbar .pp.now', { hasText: 'Lobby' }).isVisible());
  await shot(host, 'host-lobby');

  // ---------------------------------------------------------------- d: the PIN-less door
  if (engineName === 'chromium') {
    const dCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
    await dCtx.close();
  }

  // ---------------------------------------------------------------- the member
  // PHONE=1: the member on a 390 px phone, one pane at a time, switching tabs as a person would.
  const phone = process.env.PHONE === '1';
  const mCtx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, ...(phone && engineName === 'chromium' ? { isMobile: true, hasTouch: true } : {}) });
  await withToken(mCtx, memberLabel, account(memberLabel).pin);
  const m = await mCtx.newPage();
  pages.push([m, memberLabel]);
  await m.goto(`${BASE}#/join/${s.invites.member.code}`);
  check('member: the join lands in the room', await until(() => m.getByText('You: member').isVisible(), 20000));
  const named = await m.locator('#my-name').isVisible().catch(() => false);
  if (named) {
    await m.fill('#my-name', `Walker ${engineName}`);
    await m.getByRole('button', { name: 'Save', exact: true }).click();
  }
  check('member: the room knows their name', await until(() => m.locator('#my-name').isHidden()), named ? 'named just now' : 'named before');
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

  // Design: specs shown, hearts on.
  await host.locator('.hostbar .pp', { hasText: 'Design' }).click();
  await tab('Work');
  check('member: the phase reaches them', await until(() => m.locator('.phases .pp.now', { hasText: 'Design' }).isVisible(), 8000));
  // Unique per run: a read-back by name must never meet an earlier run's spec (10-22's were left starred).
  const specTitle = `A ${engineName} map that draws itself, ${new Date().toISOString().slice(11, 19)}`;
  await m.getByRole('button', { name: /Add your spec|Edit your spec/ }).click();
  await m.fill('#spec-title', specTitle);
  await m.fill('#spec-text', 'A spec with "quotes" and <b>tags</b> stays text.');
  await m.getByRole('button', { name: 'Save your spec' }).click();
  check('host: the member\'s spec arrives', await until(() => host.getByRole('heading', { name: specTitle }).isVisible(), 8000));
  check('host: markup in a spec stays text', await until(() => host.getByText('<b>tags</b>', { exact: false }).isVisible()));
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

  // Voting.
  await host.locator('.hostbar .pp', { hasText: 'Voting' }).click();
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
  await m.fill('#spec-text', 'An edited spec, the same element.');
  await m.getByRole('button', { name: 'Save your spec' }).click();
  check('host: the edited spec arrives', await until(() => host.getByText('An edited spec, the same element.').isVisible(), 8000));

  // The winner, then Build and Showcase.
  await hostCard.getByRole('button', { name: 'Make it the winner' }).click();
  check('member: the winner is starred for them', await until(() => m.locator('.card.star', { hasText: specTitle }).isVisible(), 8000));
  await host.locator('.hostbar .pp', { hasText: 'Build' }).click();
  await host.locator('.hostbar .pp', { hasText: 'Showcase' }).click();
  check('member: the Showcase reaches them', await until(() => m.locator('.phases .pp.now', { hasText: 'Showcase' }).isVisible(), 8000));
  await shot(m, 'member-showcase');

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
    check('mark: the sitting is the world\'s, kept through every phase change', sitting?.x_room_of === s.worldId && sitting?.subtype === 'Showcase', `${sitting?.x_room_of} ${sitting?.subtype}`);
    check('mark: the member\'s line is the sitting\'s', !!line && line.x_room_of === sitting?.id, String(line?.x_room_of));
    check('mark: the spec is the sitting\'s, kept through the star', !!spec && spec.x_room_of === sitting?.id && spec.subtype === 'star', `${spec?.x_room_of} ${spec?.subtype}`);
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
} finally {
  for (const [p, label] of pages) await recordMinted(p, label);
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${engineName}: ${results.length - failed} of ${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
