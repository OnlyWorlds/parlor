// A line answers a design part (2026-11-18): the host's
// own room on production keel.
//   WALK_STATE=<scratch file> PARLOR_URL=<a built parlor> node walk/design.mjs chromium|firefox
// Run seed.mjs first (crew-walk-c's token and key; it marks the test world's charter). The walk makes an Object in
// design, a Construct locked and an Object with no state, each recorded in the state's decoys so teardown.mjs deletes
// them by id. It reads the Designs tab, answers the Object with a line and reads that line back from keel field by
// field, reads its label and the tab's count, sees a rename reach the reply bar, sees a part leave its state clear the
// reply and send nothing, and hands in a report on the design (the report profile's fourth anchor). The line and the
// report it sends are found by their exact text (a run word nothing else holds) and recorded the same way.
// EXPECT_OLD=1: the build before Designs, where the walk must fail.
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, API } from './accounts.mjs';

const engine = process.argv[2] === 'firefox' ? firefox : chromium;
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const s = readState();
if (!s.hostKey || !s.tokens['crew-walk-c']) throw new Error('run seed.mjs first');
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

const api = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
s.decoys ??= [];
const RUN = Date.now().toString(36);
async function make(type, body) {
  const made = await api.create(type, body);
  s.decoys.push({ type, id: made.id });
  writeState(s);
  return made;
}

const timer = setTimeout(() => { console.log('WATCHDOG: the walk ran over 4 minutes; made so far:', JSON.stringify(s.decoys.slice(-6))); process.exit(2); }, 240000);
const browser = await engine.launch();
let page = null;
try {
  const screen = await make('object', { name: `Signup screen ${RUN}`, subtype: 'in design' });
  const rules = await make('construct', { name: `Billing rules ${RUN}`, subtype: 'locked' });
  const door = await make('object', { name: `Plain door ${RUN}`, subtype: null });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([token, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login: 'crew-walk-c', pin, keys: {} }));
  }, [s.tokens['crew-walk-c'].token, account('crew-walk-c').pin]);
  page = await ctx.newPage();
  await page.goto(`${BASE}#/w/${s.worldId}`);
  check('the room opens on the host\'s seat', await until(() => page.locator('.top[data-room-role="host"]').isVisible(), 30000));
  if (await page.locator('#my-name').isVisible().catch(() => false)) {
    await page.fill('#my-name', 'Host C');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  const tab = page.getByRole('tab', { name: 'Designs' });
  check('a world with its charter marked and a design part shows Designs', await until(() => tab.isVisible(), 30000));
  await tab.click();
  const card = id => page.locator(`[data-design="${id}"]`);
  check('the Object in design and the Construct locked are listed; the Object with no state is not',
    await until(async () => (await card(screen.id).isVisible()) && (await card(rules.id).isVisible())) && (await card(door.id).count()) === 0);
  check('each says its state in words', /In design/.test(await card(screen.id).innerText()) && /Locked/.test(await card(rules.id).innerText()));

  // Answer the Object, send a line, and read it back from keel.
  await card(screen.id).getByRole('button', { name: 'Answer' }).click();
  const bar = page.locator('.reply');
  check('the reply bar says what it answers', /Answering: Signup screen/.test(await bar.innerText()));
  const said = `On the signup screen ${RUN}`;
  await page.getByLabel('Write a line').fill(said);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  let line = null;
  await until(async () => {
    // Every narrative read, matched by its exact text: keel's name filter did not find it (2026-11-18).
    for await (const el of api.listAll('narrative')) if (el.story === said) { line = el; return true; }
    return false;
  }, 30000);
  if (line) { s.decoys.push({ type: 'narrative', id: line.id }); writeState(s); }
  const arr = v => (Array.isArray(v) ? v.map(x => (typeof x === 'object' && x ? x.id : x)) : []);
  check('the line names the Object in objects, and only there', !!line && JSON.stringify(arr(line.objects)) === JSON.stringify([screen.id])
    && arr(line.constructs).length === 0 && arr(line.relations).length === 0 && !line.parent_narrative,
  line ? JSON.stringify({ objects: arr(line.objects), constructs: arr(line.constructs), relations: arr(line.relations), parent: line.parent_narrative ?? null }) : 'not found');
  // The room mark is the newest sitting's id, or the world's where there is no sitting yet.
  check('the line carries the room mark', !!line && typeof line.x_room_of === 'string' && line.x_room_of.length > 0, line?.x_room_of);
  // The part it answers is named as the part itself: a chip that opens its card.
  check('the line is labelled with the part it answers', await until(async () => {
    const on = page.locator('.line', { hasText: said }).locator('[data-part="line-on"]');
    return /answering/.test(await on.innerText()) && await on.locator(`[data-el="${screen.id}"]`, { hasText: `Signup screen ${RUN}` }).isVisible();
  }));
  check('the part counts the line', await until(async () => /1 answer\b/.test(await card(screen.id).innerText())));
  check('the reply clears once the line has landed', await bar.isHidden());

  // A rename reaches the reply bar; a part that leaves its state clears the reply and sends nothing.
  await card(rules.id).getByRole('button', { name: 'Answer' }).click();
  await api.patch('construct', rules.id, { name: `Pricing rules ${RUN}` });
  check('a rename reaches the reply bar', await until(async () => /Answering: Pricing rules/.test(await bar.innerText()), 30000));
  await api.patch('construct', rules.id, { subtype: 'released' });
  check('a part that leaves its state clears the reply and says so', await until(async () => (await bar.isHidden()) && /no longer open here/.test(await page.locator('.notice').innerText().catch(() => '')), 30000));
  check('and leaves the Designs list', await until(async () => (await card(rules.id).count()) === 0));

  // A report on the design (the report profile's fourth anchor): the host keeps the world, so it is completed as handed in.
  await tab.click();
  await card(screen.id).getByRole('button', { name: 'Answer' }).click();
  await page.locator('[data-part="report"]').click();
  check('Report keeps the design reply', /Report on: Signup screen/.test(await bar.innerText()));
  const story = `The signup screen is drawn ${RUN}`;
  // In report mode the box is named for the report: found by its form, not its label.
  await page.locator('form.send textarea').fill(story);
  await page.locator('#report-short').fill(`Signup drawn ${RUN}`);
  await page.getByRole('button', { name: 'Hand in', exact: true }).click();
  let rep = null;
  await until(async () => {
    for await (const el of api.listAll('narrative')) if (el.story === story) { rep = el; return true; }
    return false;
  }, 30000);
  if (rep) { s.decoys.push({ type: 'narrative', id: rep.id }); writeState(s); }
  check('the report names the Object in objects and hangs on no sitting', !!rep && (rep.supertype ?? '').toLowerCase() === 'report'
    && JSON.stringify(arr(rep.objects)) === JSON.stringify([screen.id]) && arr(rep.events).length === 0 && arr(rep.relations).length === 0 && !rep.parent_narrative,
  rep ? JSON.stringify({ supertype: rep.supertype, subtype: rep.subtype, objects: arr(rep.objects), events: arr(rep.events) }) : 'not found');
  check('the report says what it is on', await until(() => page.locator('.line.report', { hasText: `Signup drawn ${RUN}` }).locator('[data-part="report-design"]').getByText(`on Signup screen ${RUN}`).isVisible()));
  check('the part counts the line and the report', await until(async () => /2 answers\b/.test(await card(screen.id).innerText())));
} catch (e) {
  check('the walk ran to its end', false, String(e?.message ?? e).slice(0, 200));
} finally {
  clearTimeout(timer);
  // The room mints a world key in this browser: record its last four, so teardown.mjs takes it back by name and last four.
  const sess = page ? await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null) : null;
  for (const k of [...Object.values(sess?.keys ?? {}), ...Object.values(sess?.readKeys ?? {})]) {
    if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label: 'crew-walk-c', last4: k.slice(-4) });
  }
  writeState(s);
  await browser.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} FAILED (teardown.mjs deletes what this run made)` : 'all PASS (teardown.mjs deletes what this run made)');
process.exit(process.env.EXPECT_OLD === '1' ? (failed ? 0 : 1) : failed ? 1 : 0);
