// A work item's address, played: `#/w/<world>/work/<item>` on a built parlor with real presses. Playwright serves
// https://parlor.onlyworlds.com from a build directory under its own _headers and _redirects, and plays these doors of
// the OnlyWorlds server, and only these: GET /account/worlds, GET /me, GET /changes (the walk from zero, and the head);
// every other door answers 404 (the roster and the world's files: the room reads without them). The page starts signed
// in with a world key, as after a reload. What it cannot see: real keel (a live walk).
//   npm run build && node walk/work-address.mjs [chromium|firefox] [phone]        DIST=<dir> for a control
import { chromium, firefox, devices } from '@playwright/test';
import { hostFor } from './host.mjs';

const DIST = process.env.DIST ?? 'dist';
const PROD = 'https://parlor.onlyworlds.com';
const only = process.argv[2];
const phone = process.argv.includes('phone');
const TOKEN = 'ow_a_' + 'h'.repeat(40);
const WORLD = '0f0f0f0f-0000-4000-8000-00000000a1a1';
const ME = 'c0c0c0c0-0000-4000-8000-0000000000c1';
const item = n => `1a1a1a1a-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LAST = item(12);
const LAST_TITLE = 'Hang the lantern over the gate';
const NOT_HERE = 'This work item is not here: it may be gone or hidden, or the link may be wrong.';
const READ_ONLY = 'You can read this work item; this seat cannot answer it.';
let failures = 0;
let firstFail = null;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) { failures++; firstFail ??= what; }
};

const { serve } = hostFor(DIST);

/** The world as served: a Character for the seat and twelve open work items, the last far down the list. */
function world(extra = []) {
  const els = [{ id: ME, type: 'Character', name: 'Wren', created_by: 'm-1' }];
  for (let n = 1; n <= 12; n++) {
    els.push({ id: item(n), type: 'Relation', name: n === 12 ? LAST_TITLE : `Work number ${n}`, supertype: 'Work item', subtype: 'open',
      description: 'Something that needs doing in the world, said in a line or two so the card has some height to it.',
      x_room_of: WORLD, created_by: 'owner', created_at: `2026-11-19T08:${String(n).padStart(2, '0')}:00Z`, change_seq: n });
  }
  return [...els, ...extra];
}

async function walk(engine, tag) {
  const browser = await engine.launch();
  const desc = phone ? (tag === 'chromium' ? devices['Pixel 7'] : { viewport: { width: 390, height: 844 } }) : { viewport: { width: 1280, height: 860 } };
  const ctx = await browser.newContext(desc);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    // The walk's own aborted read (step 8) is "Failed to load resource" in Chromium and a CORS line in Firefox.
    if (m.type() === 'error' && !/Failed to load resource|status of 40\d|CORS request did not succeed/.test(m.text())) errors.push(m.text());
  });

  // The played server: who the seat is, what it is served, and whether the walk of the changes fails.
  const keel = { me: { role: 'contributor', scope: 'write', membership: 'm-1', character: ME, kind: 'person' }, els: world(), failChanges: false, calls: [] };
  await ctx.route('https://www.onlyworlds.com/**', async r => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    keel.calls.push(`${m} ${u.pathname}`);
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': PROD, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
    if (m === 'OPTIONS') return json(204, {});
    if (u.pathname === '/api/v2/account/worlds') return json(200, { data: [{ id: WORLD, name: 'The Reach', role: 'collaborator', member_role: keel.me.role }] });
    if (u.pathname === '/api/v2/me/') return json(200, keel.me);
    if (u.pathname === '/api/v2/changes/') {
      if (keel.failChanges) return r.abort('failed');
      const head = keel.els.length;
      if (u.searchParams.get('head') === 'true') return json(200, { head, cursor: head, epoch: null });
      // The feed's order is the list's: an element's change_seq is its place in it, so a walk from a cursor reads what came after.
      const since = Number(u.searchParams.get('since') ?? 0);
      const changes = keel.els.map((e, i) => ({ op: 'upsert', id: e.id, type: e.type, element: e, updated_at: '2026-11-19T09:00:00Z', change_seq: i + 1 })).slice(since);
      return json(200, { changes, cursor: head, has_more: false, head, epoch: null });
    }
    return json(404, { error: { code: 'not_found' } });
  });
  await ctx.route(`${PROD}/**`, async r => r.fulfill(serve(new URL(r.request().url()).pathname)));
  // Signed in with a world key already held: no sign-in and no mint.
  await ctx.addInitScript(([token, world]) => {
    // Only on the parlor's origin (about:blank between pages has no storage to read).
    if (location.origin !== 'https://parlor.onlyworlds.com') return;
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login: 'wren', accountId: 'acc-1', keys: { [world]: 'ow_k_' + 'x'.repeat(40) } }));
  }, [TOKEN, WORLD]);

  const hash = () => page.evaluate(() => location.hash);
  const roomOpen = () => page.locator('.top[data-room-role]').waitFor({ timeout: 15000 });
  const fresh = async url => { await page.goto('about:blank'); await page.goto(url); await roomOpen(); };
  const workTab = () => page.locator('.wtabs [data-tab="work"]');
  const here = () => page.locator('[data-here]');
  const replyBar = () => page.locator('[data-part="reply-bar"]');
  const composerFocused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Write a line');
  // In view: the card's box inside the window and inside its pane's scrolled box.
  const inView = loc => loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p && getComputedStyle(p).overflowY !== 'auto' && getComputedStyle(p).overflowY !== 'scroll') p = p.parentElement;
    const box = p ? p.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    return r.height > 0 && r.top >= Math.max(0, box.top) - 1 && r.top < Math.min(innerHeight, box.bottom);
  });
  const paneOn = name => page.locator(`section.pane[aria-label="${name}"]`).evaluate(el => !el.classList.contains('off') && getComputedStyle(el).display !== 'none');
  const settle = ms => page.waitForTimeout(ms);
  const at = n => `${PROD}/#/w/${WORLD}/work/${n}`;

  // 1. A contributor at the last item: the Work tab, its card in view, its Answer open and the composer focused.
  await fresh(at(LAST));
  await replyBar().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  check(tag, (await workTab().getAttribute('aria-selected')) === 'true', 'the room opens on the Work tab');
  check(tag, (await here().count()) === 1 && (await here().getAttribute('data-work')) === LAST, 'that work item\'s card is the one marked');
  if (!phone) check(tag, (await here().count()) === 1 && await inView(here()), 'its card is in view, though it is last in a long list');
  check(tag, await replyBar().isVisible() && (await replyBar().textContent()).includes(`Answering: ${LAST_TITLE}`), `its Answer is open: the reply bar names it (${(await replyBar().textContent().catch(() => '')) || 'none'})`);
  check(tag, await composerFocused(), 'the composer has the focus');
  if (phone) check(tag, await paneOn('Room') && !(await paneOn('Panel')), 'on a phone, the composer\'s pane shows');
  check(tag, (await hash()) === `#/w/${WORLD}/work/${LAST}`, 'the work item\'s address stays in the bar');

  // 2. A feed tick redraws the room: focus, the answer and the address hold.
  keel.els = world([{ id: item(99), type: 'Relation', name: 'Arrived meanwhile', supertype: 'Work item', subtype: 'open', x_room_of: WORLD, created_by: 'owner', created_at: '2026-11-19T09:30:00Z', change_seq: 99 }]);
  await page.locator('[data-work="' + item(99) + '"]').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  check(tag, (await page.locator(`[data-work="${item(99)}"]`).count()) === 1, 'a feed tick brought a new work item (the list was redrawn)');
  check(tag, await composerFocused() && await replyBar().isVisible() && (await hash()) === `#/w/${WORLD}/work/${LAST}`, 'across that redraw: the composer keeps the focus, the answer and the address hold');
  keel.els = world();

  // 3. A reload reopens it.
  await page.reload();
  await roomOpen();
  await replyBar().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  check(tag, (await replyBar().textContent()).includes(`Answering: ${LAST_TITLE}`) && await composerFocused() && (await here().getAttribute('data-work')) === LAST, 'a reload reopens the card and its Answer');

  // 4. Moving: another tab gives the bar back to the room's own address (replaced, so Back does not return to it).
  const lenBefore = await page.evaluate(() => history.length);
  if (phone) await page.locator('nav.mtabs button', { hasText: 'Crew and work' }).click();
  await page.locator('.wtabs [data-tab="crew"]').click();
  await settle(300);
  check(tag, (await hash()) === `#/w/${WORLD}`, `another tab: the room's own address comes back (${await hash()})`);
  check(tag, (await page.evaluate(() => history.length)) === lenBefore, 'replaced, not pushed: no new entry for Back');
  check(tag, await page.locator('.top[data-room-role]').count() === 1 && !(await replyBar().evaluate(e => e.hidden)), 'the room was not opened again: the answer is still open');
  await page.locator('.wtabs [data-tab="work"]').click();
  await settle(300);
  check(tag, (await here().count()) === 0, 'back on Work, no card is marked: the address was let go');

  // 5. Moving: Not now on the answer.
  await fresh(at(item(3)));
  await replyBar().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (phone) await page.locator('nav.mtabs button', { hasText: 'Room' }).click();
  await replyBar().getByRole('button', { name: 'Not now' }).click();
  await settle(300);
  check(tag, (await hash()) === `#/w/${WORLD}`, `Not now on the answer: the room's own address comes back (${await hash()})`);

  // 6. Moving: Answer on another card.
  await fresh(at(item(3)));
  await replyBar().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (phone) await page.locator('nav.mtabs button', { hasText: 'Crew and work' }).click();
  await page.locator(`[data-work="${item(5)}"]`).getByRole('button', { name: 'Answer' }).click();
  await settle(300);
  check(tag, (await hash()) === `#/w/${WORLD}` && (await replyBar().textContent()).includes('Answering: Work number 5'), `Answer on another card: that card is answered, the room's own address back (${await hash()})`);

  // 7. An id this seat is not served: one plain line on the Work tab, no answer opened.
  await fresh(at('5e5e5e5e-0000-4000-8000-00000000dead'));
  await page.locator('[data-part="work-not-here"]').waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  if (phone) check(tag, await paneOn('Panel'), 'on a phone, the panel shows, with the line');
  check(tag, (await page.locator('[data-part="work-not-here"]').textContent().catch(() => '')) === NOT_HERE && await page.locator('[data-part="work-not-here"]').isVisible(), 'not served: the line says the work item is not here');
  check(tag, (await workTab().getAttribute('aria-selected')) === 'true' && (await page.locator('.witem').count()) === 12 && !(await replyBar().isVisible()) && (await here().count()) === 0, 'on the Work tab, the room\'s work listed, no answer open, no card marked');

  // 8. The room's read is not whole yet: nothing is said until it is, then the arrival lands.
  keel.failChanges = true;
  await fresh(at('5e5e5e5e-0000-4000-8000-00000000dead'));
  await settle(1500);
  check(tag, (await page.locator('[data-part="work-not-here"]').count()) === 0, 'while the first read fails, no "not here" over an unread list');
  keel.failChanges = false;
  await page.locator('[data-part="work-not-here"]').waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
  check(tag, (await page.locator('[data-part="work-not-here"]').count()) === 1, 'once a read is whole, the line is said');
  keel.failChanges = true;
  await fresh(at(LAST));
  await settle(1500);
  check(tag, !(await replyBar().isVisible()), 'while the first read fails, no answer opens on an unread list');
  keel.failChanges = false;
  await replyBar().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  check(tag, await replyBar().isVisible() && await composerFocused() && (await here().getAttribute('data-work').catch(() => null)) === LAST, 'once a read is whole, the arrival lands: the answer open, the composer focused');

  // 9. A seat that may read but not answer.
  keel.me = { role: 'guest', scope: 'read', membership: 'm-1', character: ME, kind: 'person' };
  await fresh(at(LAST));
  await page.locator('[data-part="work-read-only"]').waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  check(tag, (await page.locator('[data-here] [data-part="work-read-only"]').textContent().catch(() => '')) === READ_ONLY, 'read only: the card says this seat can read it and cannot answer it');
  check(tag, (await page.locator('textarea[aria-label="Write a line"]').count()) === 0 && !(await replyBar().isVisible()), 'and no composer opens');
  check(tag, await page.evaluate(() => document.activeElement?.hasAttribute('data-here') ?? false), 'the card has the focus');
  if (phone) check(tag, await paneOn('Panel'), 'on a phone, the card\'s pane shows');
  else check(tag, await inView(here()), 'the card is in view');
  keel.els = world([{ id: item(98), type: 'Relation', name: 'Arrived while reading', supertype: 'Work item', subtype: 'open', x_room_of: WORLD, created_by: 'owner', created_at: '2026-11-19T09:31:00Z', change_seq: 98 }]);
  await page.locator(`[data-work="${item(98)}"]`).waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  check(tag, (await page.locator(`[data-work="${item(98)}"]`).count()) === 1 && await page.evaluate(() => document.activeElement?.hasAttribute('data-here') ?? false), 'a feed tick rebuilds the Work list and the card keeps the focus');
  keel.els = world();
  keel.me ={ role: 'contributor', scope: 'write', membership: 'm-1', character: ME, kind: 'person' };

  // 10. The room's own address opens the room as before: no tab changed, nothing marked.
  await fresh(`${PROD}/#/w/${WORLD}`);
  await settle(500);
  check(tag, (await page.locator('.wtabs [data-tab="crew"]').getAttribute('aria-selected')) === 'true' && (await here().count()) === 0 && !(await replyBar().isVisible()), 'the room\'s own address: the room as it always opened');

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

for (const [engine, tag] of [[chromium, 'chromium'], [firefox, 'firefox']]) {
  if (only && only !== 'phone' && only !== tag) continue;
  await walk(engine, phone ? `${tag} phone` : tag).catch(e => { failures++; firstFail ??= `aborted: ${e.message.split('\n')[0]}`; console.log(`[${tag}] ABORT ${e.message.split('\n')[0]}`); });
}
console.log(failures ? `\n${failures} FAILED (first: ${firstFail})` : '\nall ok');
process.exit(failures ? 1 : 0);
