// An element's card, played: the room's card on a built parlor with real presses and keys. Playwright serves
// https://parlor.onlyworlds.com from a build directory under its own _headers and _redirects, and plays these doors of the
// OnlyWorlds server, and only these: GET /account/worlds, GET /me, GET /changes (the walk from zero, and the head); every
// other door answers 404 (the roster, the hidden list and the world's files: the room reads without them). The page starts
// signed in with a world key, as after a reload. What it cannot see: real keel (a live walk).
//   npm run build && node walk/element-card.mjs [chromium|firefox] [phone]        DIST=<dir> for a control
import { chromium, firefox, devices } from '@playwright/test';
import { hostFor } from './host.mjs';

const DIST = process.env.DIST ?? 'dist';
// SHOTS=<dir> keeps a picture of the card at a few steps, for a person's look.
const SHOTS = process.env.SHOTS ?? null;
const PROD = 'https://parlor.onlyworlds.com';
const only = process.argv[2];
const phone = process.argv.includes('phone');
const TOKEN = 'ow_a_' + 'h'.repeat(40);
const WORLD = '0f0f0f0f-0000-4000-8000-00000000a1a1';
const ME = 'c0c0c0c0-0000-4000-8000-0000000000c1';
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADA = id('c0000000', 1), BO = id('c0000000', 2), LONG = id('c0000000', 3), STUB = id('c0000000', 4), HID = id('c0000000', 5);
const WIDE = id('c0000000', 6), GONE1 = id('c0000000', 7), GONE2 = id('c0000000', 8);
const HOME = id('a0000000', 1), PROP = id('a0000000', 2);
const Q1 = id('1a1a1a1a', 1), Q2 = id('1a1a1a1a', 2);
const LONG_NAME = 'Wilhelmina Theodora Lanternkeeper of the Northern Harbour';
// Wide letters: under the count's room of 26, wider than the picture's room as drawn.
const WIDE_NAME = 'WWWWWWWWWWWWWWWWWWWWWWWWW';
const KNOWN_OF = 'Known of: some of it is not shown to you';
const HIDDEN = 'Hidden from others';
const PROPOSED = 'Proposed, waits for review';
let failures = 0;
let firstFail = null;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) { failures++; firstFail ??= what; }
};

const { serve } = hostFor(DIST);
const at = n => `2026-11-19T08:${String(n).padStart(2, '0')}:00Z`;

/** The world as served: Ada and her neighbours, a stub, a long name and a wide one, one open work item about her, two to delete. */
function world(o = {}) {
  const els = [
    { id: ME, type: 'Character', name: 'Wren', created_by: 'm-1', created_at: at(1), updated_at: at(1) },
    { id: ADA, type: 'Character', name: 'Ada', birthplace: HOME, friends: [LONG, STUB, WIDE], description: 'Ada keeps the harbour light.\nShe came from the north, years ago, and stayed when the light needed a keeper.', created_at: at(2), updated_at: at(30) },
    { id: HOME, type: 'Location', name: 'Home', created_at: at(3), updated_at: at(20) },
    { id: BO, type: 'Character', name: 'Bo', birthplace: HOME, created_at: at(4), updated_at: at(10) },
    { id: LONG, type: 'Character', name: LONG_NAME, friends: [ADA], created_at: at(5), updated_at: at(9) },
    { id: STUB, type: 'Character', name: 'Stubby', known_of: true, description: 'Only its words are served.', created_at: at(6) },
    { id: WIDE, type: 'Character', name: WIDE_NAME, created_at: at(12), updated_at: at(12) },
    ...(o.gone1 ? [] : [{ id: GONE1, type: 'Character', name: 'Soon gone', created_at: at(13), updated_at: at(13) }]),
    ...(o.gone2 ? [] : [{ id: GONE2, type: 'Character', name: 'Gone too', created_at: at(14), updated_at: at(14) }]),
    { id: PROP, type: 'Location', name: 'Proposed place', x_review_proposed: { by: 'an agent' }, created_at: at(7), updated_at: at(25) },
    { id: Q1, type: 'Relation', name: 'Who lights the lamp on Sundays?', supertype: 'Work item', subtype: 'open', x_room_of: WORLD, characters: [ADA], created_by: 'owner', created_at: at(8) },
  ];
  if (o.keeper) els.push({ id: HID, type: 'Character', name: 'Hidden one', birthplace: HOME, hidden: true, created_at: at(11), updated_at: at(11) });
  return [...els, ...(o.extra ?? [])];
}

async function walk(engine, tag) {
  const browser = await engine.launch();
  const desc = phone ? (tag.startsWith('chromium') ? devices['Pixel 7'] : { viewport: { width: 390, height: 844 } }) : { viewport: { width: 1280, height: 860 } };
  const ctx = await browser.newContext(desc);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|status of 40\d|CORS request did not succeed/.test(m.text())) errors.push(m.text());
  });

  // The played server keeps a changes log: setting the world logs an upsert for each element new or changed and a
  // delete for each one gone, so a feed tick can delete an element.
  const keel = { me: { role: 'contributor', scope: 'write', membership: 'm-1', character: ME, kind: 'person' }, log: [], held: new Map() };
  const setWorld = els => {
    const next = new Map(els.map(e => [e.id, e]));
    for (const [i, e] of keel.held) if (!next.has(i)) keel.log.push({ op: 'delete', id: i, type: e.type, reason: 'deleted', deleted_at: '2026-11-19T09:30:00Z', deleted_by: 'owner' });
    for (const e of els) if (JSON.stringify(keel.held.get(e.id)) !== JSON.stringify(e)) keel.log.push({ op: 'upsert', id: e.id, type: e.type, element: e, updated_at: '2026-11-19T09:00:00Z' });
    keel.held = next;
  };
  setWorld(world());
  await ctx.route('https://www.onlyworlds.com/**', async r => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': PROD, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
    if (m === 'OPTIONS') return json(204, {});
    if (u.pathname === '/api/v2/account/worlds') return json(200, { data: [{ id: WORLD, name: 'The Reach', role: 'collaborator', member_role: keel.me.role }] });
    if (u.pathname === '/api/v2/me/') return json(200, keel.me);
    if (u.pathname === '/api/v2/changes/') {
      const head = keel.log.length;
      if (u.searchParams.get('head') === 'true') return json(200, { head, cursor: head, epoch: null });
      const since = Number(u.searchParams.get('since') ?? 0);
      const changes = keel.log.slice(since).map((c, i) => ({ ...c, change_seq: since + i + 1 }));
      return json(200, { changes, cursor: head, has_more: false, head, epoch: null });
    }
    return json(404, { error: { code: 'not_found' } });
  });
  await ctx.route(`${PROD}/**`, async r => r.fulfill(serve(new URL(r.request().url()).pathname)));
  await ctx.addInitScript(([token, w]) => {
    if (location.origin !== 'https://parlor.onlyworlds.com') return;
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login: 'wren', accountId: 'acc-1', keys: { [w]: 'ow_k_' + 'x'.repeat(40) } }));
  }, [TOKEN, WORLD]);

  const card = page.locator('aside[data-part="element-card"]');
  const heading = card.locator('h2');
  const cardOpen = async () => (await card.count()) === 1 && await card.isVisible();
  const headingIs = async name => (await cardOpen()) && (await heading.textContent()) === name;
  const focusKey = () => page.evaluate(() => {
    const a = document.activeElement;
    return a?.closest('[data-focus]')?.getAttribute('data-focus') ?? a?.tagName ?? null;
  });
  const roomOpen = () => page.locator('.top[data-room-role]').waitFor({ timeout: 15000 });
  const fresh = async () => { await page.goto('about:blank'); await page.goto(`${PROD}/#/w/${WORLD}`); await roomOpen(); };
  const toPanel = async () => { if (phone) await page.locator('nav.mtabs button', { hasText: 'Crew and work' }).click(); };
  const toRoom = async () => { if (phone) await page.locator('nav.mtabs button', { hasText: 'Room' }).click(); };
  const changes = async () => { await toPanel(); await page.locator('.wtabs [data-tab="changes"]').click(); await page.locator(`[data-change="${ADA}"]`).waitFor({ timeout: 8000 }); };
  // A press or a focus on what an older build may not draw (a control) fails its check, never the whole walk.
  const press = loc => loc.click({ timeout: 5000 }).catch(() => {});
  const focus = loc => loc.focus({ timeout: 5000 }).catch(() => {});
  const openFromChanges = async (el) => { await press(page.locator(`[data-change="${el}"] button.nm`)); await card.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}); };
  /** Tab from where focus is until it reaches the control keyed `key` (at most 16 presses). */
  const tabTo = async key => {
    for (let i = 0; i < 16; i++) {
      if ((await focusKey()) === key) return true;
      await page.keyboard.press('Tab');
    }
    return (await focusKey()) === key;
  };
  const settle = ms => page.waitForTimeout(ms);
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag.replace(' ', '-')}-${name}.png` }); };

  try {
    // 1. Open a card from the panel (Changes): its heading, its words folded, Show all.
    await fresh();
    await changes();
    await openFromChanges(ADA);
    check(tag, await headingIs('Ada'), 'a press on a name in Changes opens its card');
    if (phone) check(tag, await card.isVisible() && await card.evaluate(el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom <= innerHeight + 1; }), 'on a phone, the card shows over the panel');
    check(tag, (await focusKey()) === `change-name:${ADA}`, `the opener keeps the focus (${await focusKey()})`);
    const fold = card.locator('[data-focus="card:fold"]');
    check(tag, (await card.locator('[data-part="card-text"]').textContent().catch(() => '')) === 'Ada keeps the harbour light.' && (await card.locator('[data-part="card-more"]').count()) === 0
      && (await fold.textContent().catch(() => '')) === 'Show all', 'its first line shows, the rest folded under Show all');
    await press(fold);
    check(tag, (await card.locator('[data-part="card-more"]').textContent().catch(() => '')).startsWith('She came from the north') && (await fold.textContent()) === 'Show less' && (await fold.getAttribute('aria-expanded')) === 'true',
      'Show all opens the rest and says Show less');
    await shot('1-ada');

    // 2. A long name in the link picture: an ellipsis, the whole name its accessible name and its title.
    const longG = card.locator(`[data-focus="card:g:out:friends:${LONG}"]`);
    const longText = (await longG.locator('text.nb-name').textContent().catch(() => '')) ?? '';
    check(tag, longText.includes('…') && !longText.includes('Harbour'), `a long name ends in an ellipsis (${JSON.stringify(longText)})`);
    check(tag, ((await longG.getAttribute('aria-label').catch(() => '')) ?? '').includes(LONG_NAME) && ((await longG.locator('title').textContent().catch(() => '')) ?? '').includes(LONG_NAME), 'its whole name is its accessible name and its title');
    const wide = await card.locator(`[data-focus="card:g:out:friends:${WIDE}"] text.nb-name`).evaluate(t => { const b = t.getBBox(); return { t: t.textContent, r: b.x + b.width }; }).catch(() => null);
    check(tag, !!wide && wide.t.includes('…') && wide.r <= 339, `a name of wide capitals ends in an ellipsis inside the picture (${wide ? `${JSON.stringify(wide.t)}, right edge ${wide.r.toFixed(1)} of 338` : 'not drawn'})`);
    check(tag, await card.locator('svg.graph').evaluate(svg => [...svg.querySelectorAll('text')].every(t => { const b = t.getBBox(); return b.x >= -1 && b.x + b.width <= 339; })).catch(() => false), 'every name and label stays inside the picture');

    // 3. A feed tick while focus is on a neighbour: the card is rebuilt (a new question), focus and the fold stay.
    await focus(heading);
    check(tag, await tabTo(`card:g:out:birthplace:${HOME}`), 'Tab reaches the neighbour Home');
    setWorld(world({ extra: [{ id: Q2, type: 'Relation', name: 'Who mends the nets?', supertype: 'Work item', subtype: 'open', x_room_of: WORLD, characters: [ADA], created_by: 'owner', created_at: at(40) }] }));
    await page.waitForFunction(() => document.querySelectorAll('[data-part="card-questions"] a.q').length === 2, null, { timeout: 10000 }).catch(() => {});
    check(tag, (await card.locator('[data-part="card-questions"] a.q').count()) === 2, 'a feed tick brought a question to the card (it was rebuilt)');
    check(tag, (await focusKey()) === `card:g:out:birthplace:${HOME}`, `across that rebuild the neighbour keeps the focus (${await focusKey()})`);
    check(tag, (await fold.textContent().catch(() => '')) === 'Show less', 'and the words stay unfolded');

    // 4. Step to the neighbour by keyboard, and back: the heading takes the focus; a step folds the words again.
    await page.keyboard.press('Enter');
    await settle(150);
    check(tag, await headingIs('Home') && (await focusKey()) === 'card:h', `Enter on a neighbour steps the card to it, its heading focused (${await focusKey()})`);
    check(tag, (await card.locator('[data-part="card-marks"]').count()) === 0 && (await card.locator('text.edge-label').allTextContents()).some(t => t.startsWith('from Birthplace')), 'Home lists who links to it ("from Birthplace")');
    check(tag, await tabTo(`card:g:in:birthplace:${ADA}`), 'Tab reaches Ada among those linked from it');
    await page.keyboard.press('Enter');
    await settle(150);
    check(tag, await headingIs('Ada') && (await focusKey()) === 'card:h', 'Enter steps back to Ada, her heading focused');
    check(tag, (await fold.textContent().catch(() => '')) === 'Show all', 'a step folds the words again');

    // 5. Escape in the composer: the composer's, the card stays.
    await toRoom();
    await page.locator('textarea[aria-label="Write a line"]').focus();
    await page.keyboard.type('half a thought');
    await page.keyboard.press('Escape');
    await settle(150);
    check(tag, await headingIs('Ada') && (await page.locator('textarea[aria-label="Write a line"]').inputValue()) === 'half a thought', 'Escape in the composer leaves the card open and the text as typed');

    // 6. Escape on the card: it closes, and focus goes back to what opened it.
    await toPanel();
    await focus(heading);
    await page.keyboard.press('Escape');
    await settle(150);
    check(tag, !(await cardOpen()), 'Escape on the card closes it');
    check(tag, (await focusKey()) === `change-name:${ADA}`, `focus goes back to the opener (${await focusKey()})`);

    // 6b. Escape with focus still on the name that opened the card: it closes, the opener keeps the focus.
    await openFromChanges(ADA);
    check(tag, await headingIs('Ada') && (await focusKey()) === `change-name:${ADA}`, 'a press opens the card again, focus on the name pressed');
    await page.keyboard.press('Escape');
    await settle(150);
    check(tag, !(await cardOpen()) && (await focusKey()) === `change-name:${ADA}`, `Escape from the opener closes the card, the opener keeps the focus (${await focusKey()})`);

    // 7. A stub: its card, marked, with the words keel serves it.
    await openFromChanges(ADA);
    // A press on the neighbour's name (Firefox measures a <g> with its icon's own box, so its middle is not the node).
    await press(card.locator(`[data-focus="card:g:out:friends:${STUB}"] text.nb-name`));
    await settle(150);
    check(tag, await headingIs('Stubby') && (await card.locator('[data-part="card-marks"]').textContent().catch(() => '')) === KNOWN_OF && (await card.locator('[data-part="card-text"]').textContent().catch(() => '')) === 'Only its words are served.',
      'a stub has a card: marked known of, with the words it is served');
    await shot('2-stub');

    // 8. A question goes to its work item: the Work tab, the item's card marked, in view and focused, its address in the bar.
    await press(card.locator('[data-focus="card:x"]'));
    await openFromChanges(ADA);
    const q = card.locator(`[data-part="card-questions"] a.q[data-work="${Q1}"]`);
    check(tag, (await q.getAttribute('href').catch(() => '')) === `#/w/${WORLD}/work/${Q1}`, 'a question links its work item\'s address');
    await press(q);
    await settle(300);
    check(tag, (await page.locator('.wtabs [data-tab="work"]').getAttribute('aria-selected')) === 'true' && (await page.locator('[data-here]').getAttribute('data-work').catch(() => null)) === Q1,
      'a press on it opens the Work tab with that item\'s card marked');
    check(tag, await page.evaluate(() => document.activeElement?.hasAttribute('data-here') ?? false), 'the work item\'s card has the focus');
    check(tag, (await page.evaluate(() => location.hash)) === `#/w/${WORLD}/work/${Q1}`, 'its address is in the bar');
    if (phone) check(tag, !(await cardOpen()), 'on a phone the element\'s card gives way to it');

    // 9. A proposed row, for a seat that is no keeper: its name is plain text, never a press that opens nothing.
    await press(page.locator('.wtabs [data-tab="changes"]'));
    check(tag, (await page.locator(`[data-change="${PROP}"] button.nm`).count()) === 0 && (await page.locator(`[data-change="${PROP}"] .nm`).count()) === 1,
      'for a seat that is no keeper, a proposed row in Changes is no press');

    // 9b. The card's element deleted while the person types in the composer: the card closes, the composer keeps
    // the focus and the text.
    await openFromChanges(GONE1);
    await toRoom();
    const box = page.locator('textarea[aria-label="Write a line"]');
    await focus(box);
    await page.keyboard.type(' still typing');
    check(tag, await headingIs('Soon gone'), 'the card of an element about to be deleted is open');
    setWorld(world({ gone1: true }));
    await page.waitForFunction(() => document.querySelector('aside[data-part="element-card"]')?.hidden !== false, null, { timeout: 10000 }).catch(() => {});
    await settle(200);
    check(tag, !(await cardOpen()) && await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Write a line' && (await box.inputValue()).includes('half a thought') && (await box.inputValue()).includes(' still typing'),
      `deleted while the person types: the card closes, the composer keeps the focus and the text (${await focusKey()})`);

    // 9c. The card's element deleted while focus is inside the card: focus lands on the panel's tab, never the page.
    await toPanel();
    await press(page.locator('.wtabs [data-tab="changes"]'));
    await openFromChanges(GONE2);
    await focus(card.locator('[data-focus="card:x"]'));
    check(tag, await headingIs('Gone too') && (await focusKey()) === 'card:x', 'focus on the × of a card whose element is about to be deleted');
    setWorld(world({ gone1: true, gone2: true }));
    await page.waitForFunction(() => document.querySelector('aside[data-part="element-card"]')?.hidden !== false, null, { timeout: 10000 }).catch(() => {});
    await settle(200);
    const g = await page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, tab: a?.getAttribute('data-tab') ?? null, selected: a?.getAttribute('aria-selected') ?? null }; });
    check(tag, !(await cardOpen()) && g.tag !== 'BODY' && g.tab === 'changes' && g.selected === 'true',
      `deleted while focus is in its card: the card closes, focus on the panel's Changes tab (${JSON.stringify(g)})`);

    // 10. A keeper: the proposed row opens its card, marked; a hidden neighbour is listed marked, and opens marked.
    keel.me = { role: 'owner', scope: 'write', membership: null, character: ME, kind: 'person' };
    setWorld(world({ keeper: true }));
    await fresh();
    await changes();
    await openFromChanges(PROP);
    check(tag, await headingIs('Proposed place') && (await card.locator('[data-part="card-marks"]').textContent().catch(() => '')) === PROPOSED, 'a keeper opens a proposed row from Changes: its card, marked proposed');
    await press(card.locator('[data-focus="card:x"]'));
    await openFromChanges(HOME);
    const hid = card.locator(`[data-focus="card:g:in:birthplace:${HID}"]`);
    check(tag, ((await hid.getAttribute('aria-label').catch(() => '')) ?? '').includes('hidden from others'), 'a keeper reads a hidden neighbour, marked');
    await press(hid.locator('text.nb-name'));
    await settle(150);
    await shot('3-hidden');
    check(tag, await headingIs('Hidden one') && (await card.locator('[data-part="card-marks"]').textContent().catch(() => '')) === HIDDEN, 'and opens it: its card, marked hidden from others');

  } catch (e) {
    // An aborted walk leaves a picture of where it stopped (with SHOTS), and never its browser.
    await shot('abort').catch(() => {});
    await browser.close().catch(() => {});
    throw e;
  }
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

for (const [engine, tag] of [[chromium, 'chromium'], [firefox, 'firefox']]) {
  if (only && only !== 'phone' && only !== tag) continue;
  await walk(engine, phone ? `${tag} phone` : tag).catch(e => { failures++; firstFail ??= `aborted: ${e.message.split('\n')[0]}`; console.log(`[${tag}] ABORT ${e.message.split('\n')[0]}`); });
}
console.log(failures ? `\n${failures} FAILED (first: ${firstFail})` : '\nall ok');
process.exit(failures ? 1 : 0);
