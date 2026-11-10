// A report as a line, on production keel: the host (crew-walk-c) and a member (crew-walk-b, by the seed's invite).
//   WALK_STATE=<scratch file> PARLOR_URL=<a built parlor under its _headers> SHOTS=<dir> node walk/report.mjs chromium|firefox
// Run seed.mjs first. The work item and every report the walk makes are recorded in the state's decoys, so
// teardown.mjs deletes them by id (keel purges a deleted report's files with it). The host completes one report by
// API, as a keeper's AI would (the parlor never writes step 2). EXPECT_OLD=1: a build without reports, where it must fail.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, API } from './accounts.mjs';

const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = engineName === 'firefox' ? firefox : chromium;
const BASE = process.env.PARLOR_URL ?? 'http://localhost:30338/';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const s = readState();
if (!s.hostKey || !s.tokens['crew-walk-c'] || !s.invites?.member) throw new Error('run seed.mjs first');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
let step = 0;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/report-${engineName}-${String(++step).padStart(2, '0')}-${name}.png` }); };
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 300));
  }
}
const watchdog = setTimeout(() => { console.log('FAIL watchdog 300 s'); process.exit(3); }, 300000);

const RUN = `${engineName} ${Date.now().toString(36)}`;
const p2 = n => String(n).padStart(2, '0');
const now = new Date();
const DAY = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
const dir = join(tmpdir(), `parlor-report-walk-${process.pid}`);
mkdirSync(dir, { recursive: true });
const NOTES = `# What the session found (${RUN})\n\nThe harbour list and the ledger disagree on two ships.\n`;
const pNotes = join(dir, 'findings.md');
writeFileSync(pNotes, NOTES);

const api = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
s.decoys ??= [];
const record = (type, id) => { if (!s.decoys.some(d => d.id === id)) { s.decoys.push({ type, id }); writeState(s); } };
const reportsWith = async (marker) => { const out = []; for await (const e of api.listAll('narrative')) if (typeof e.story === 'string' && e.story.includes(marker)) out.push(e); return out; };

async function withToken(ctx, label) {
  await ctx.addInitScript(([token, login, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login, pin, keys: {} }));
  }, [s.tokens[label].token, label, account(label).pin]);
}
async function recordMinted(page, label) {
  const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null);
  if (!sess) return;
  for (const k of Object.values(sess.keys ?? {})) if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label, last4: k.slice(-4) });
  if (typeof sess.token === 'string' && sess.token !== s.tokens[label]?.token) s.minted.push({ kind: 'browser-token', label, last4: sess.token.slice(-4) });
  writeState(s);
}
const watchPolicy = ctx => ctx.addInitScript(() => {
  window.__policy = [];
  document.addEventListener('securitypolicyviolation', e => window.__policy.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const notices = page => page.evaluate(() => [...document.querySelectorAll('.notice, [role=status], [role=alert]')].map(n => n.textContent ?? '').join(' | ')).catch(() => '');

const browser = await engine.launch();
const pages = [];
const violations = [];
try {
  // ------------------------------------------------------------ the host, and a work item for the room
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await watchPolicy(hostCtx);
  await withToken(hostCtx, 'crew-walk-c');
  const host = await hostCtx.newPage();
  pages.push([host, 'crew-walk-c']);
  await host.goto(`${BASE}#/w/${s.worldId}`);
  check('host: the room opens', await until(() => host.getByText('You: host').isVisible(), 30000));
  if (await host.locator('#my-name').isVisible().catch(() => false)) {
    await host.fill('#my-name', 'Host C');
    await host.getByRole('button', { name: 'Save', exact: true }).click();
  }
  const ITEM = `Check the ledger (${RUN})`;
  const item = await api.create('relation', { name: ITEM, supertype: 'Work item', subtype: 'open', x_room_of: s.worldId });
  record('relation', item.id);

  // ------------------------------------------------------------ the member hands in a free report
  const mCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await watchPolicy(mCtx);
  await withToken(mCtx, 'crew-walk-b');
  const m = await mCtx.newPage();
  pages.push([m, 'crew-walk-b']);
  await m.goto(`${BASE}#/join/${s.invites.member.code}`);
  const ask = m.getByRole('button', { name: /^Join Parlor ground \(crew test\) as/ });
  if (await until(() => ask.isVisible(), 12000)) await ask.click();
  else await m.goto(`${BASE}#/w/${s.worldId}`);
  check('member: in the room', await until(() => m.getByText('You: member').isVisible(), 30000));
  if (await m.locator('#my-name').isVisible().catch(() => false)) {
    await m.fill('#my-name', 'Member B');
    await m.getByRole('button', { name: 'Save', exact: true }).click();
  }
  const toggle = m.locator('form.send [data-part="report"]');
  check('member: the composer has Report', await until(() => toggle.isVisible(), 8000));
  if (process.env.EXPECT_OLD === '1' && !(await toggle.count())) throw new Error('no Report on this build (the control)');
  check('member: Report is pressable once the member has a Character', await until(() => toggle.isEnabled(), 20000));
  await toggle.click();
  const box = m.locator('form.send textarea');
  check('member: on, it says so and Send says Hand in', await toggle.getAttribute('aria-pressed') === 'true'
    && await m.locator('[data-part="report-note"]').isVisible()
    && (await m.locator('form.send button[type="submit"]').innerText()).trim() === 'Hand in');

  // Files alone are not a report.
  await m.locator('form.send input[type="file"]').setInputFiles([pNotes]);
  await m.locator('form.send button[type="submit"]').click();
  check('member: files with no words are refused as a report, and stay picked', await until(async () => /A report needs your text/.test(await notices(m)), 5000)
    && await m.locator('.send-files .file-chip').count() === 1, await notices(m));

  // Five lines typed with Enter between them: Enter starts a new line and hands in nothing.
  const MARK1 = `free-${RUN}`;
  const STORY = [`What I did this session (${MARK1})`, 'Read the harbour list.', 'Read the ledger.', 'Two ships disagree.', 'Nothing changed in the world.'];
  await box.click();
  for (let i = 0; i < STORY.length; i++) { await box.type(STORY[i]); if (i < STORY.length - 1) await m.keyboard.press('Enter'); }
  await m.waitForTimeout(1500);
  check('member: Enter made new lines, not a report', (await box.inputValue()) === STORY.join('\n') && (await reportsWith(MARK1)).length === 0);
  await m.locator('form.send button[type="submit"]').click();
  await m.locator('form.send button[type="submit"]').click().catch(() => {}); // a second press while the first sends
  const r1 = m.locator('.line.report', { hasText: MARK1 });
  check('member: the report shows as handed in', await until(() => r1.getAttribute('data-report').then(v => v === 'handed in'), 30000));
  check('member: the toggle is off again, the composer empty', await toggle.getAttribute('aria-pressed') === 'false' && (await box.inputValue()) === '');
  const made1 = await reportsWith(MARK1);
  for (const e of made1) record('narrative', e.id);
  check('keel: one report for one Hand in, pressed twice', made1.length === 1, `${made1.length}`);
  const e1 = made1[0] ?? {};
  check('keel: step 1 exactly as the profile writes it', e1.supertype === 'Report' && e1.subtype === 'handed in' && e1.x_room_of === s.worldId
    && e1.story === STORY.join('\n') && e1.name === `${STORY[0].length <= 48 ? STORY[0] : STORY[0].slice(0, 47).trimEnd() + '…'}, ${DAY}`
    && typeof e1.narrator === 'string' && !!e1.narrator && !e1.description && !e1.consequences && !('x_report_answers' in e1 && e1.x_report_answers)
    && !e1.parent_narrative && !(e1.relations ?? []).length,
    JSON.stringify({ name: e1.name, subtype: e1.subtype, mark: e1.x_room_of === s.worldId, narrator: !!e1.narrator, description: e1.description, relations: e1.relations }));
  const narrator = e1.narrator ? await api.get('character', e1.narrator).catch(() => null) : null;
  check('keel: its narrator is a Character in the world', !!narrator?.id);
  check('member: its title carries the day', (await r1.locator('.report-title').innerText()).endsWith(`, ${DAY}`));
  check('member: the first three lines show, and that a host reads it next', (await r1.locator('[data-part="report-story"]').innerText()).trim() === STORY.slice(0, 3).join('\n')
    && /Not completed yet: a host reads it next\./.test(await r1.innerText()));
  check('member: its file is on it', await until(async () => (await r1.locator('.file[data-file]', { hasText: 'findings.md' }).count()) === 1, 30000));
  await r1.locator('[data-act="report-fold"]').click();
  check('member: Show all unfolds the whole story', (await r1.locator('[data-part="report-story"]').innerText()).trim() === STORY.join('\n'));
  // A line from the host redraws the member's room: the fold stays open.
  await host.locator('form.send textarea').fill(`A line between (${RUN})`);
  await host.keyboard.press('Enter');
  check('member: the host\'s line arrives', await until(() => m.getByText(`A line between (${RUN})`).isVisible(), 30000));
  check('member: the fold stays open across the redraw', (await r1.locator('[data-part="report-story"]').innerText()).trim() === STORY.join('\n'));
  await shot(m, 'handed-in');

  // ------------------------------------------------------------ a report on the work item, answering it
  await m.getByRole('tab', { name: /^Work/ }).click().catch(() => {});
  const card = m.locator('.card', { has: m.locator('h3', { hasText: ITEM }) });
  check('member: the work item shows', await until(() => card.isVisible(), 30000));
  await card.getByRole('button', { name: 'Answer' }).click();
  await toggle.click();
  const finishes = m.locator('[data-part="report-finishes"]');
  check('member: on a work item the reply bar says Report on, the box off', /Report on: /.test(await m.locator('.reply').innerText()) && await finishes.isVisible() && !(await finishes.isChecked()));
  await finishes.check();
  // A tick belongs to one answer: Not now, then Answer again, starts unticked (the code gate's S1).
  await m.locator('.reply').getByRole('button', { name: 'Not now' }).click();
  await card.getByRole('button', { name: 'Answer' }).click();
  check('member: a tick does not carry to the next answer', await finishes.isVisible() && !(await finishes.isChecked()));
  await finishes.check();
  const MARK2 = `item-${RUN}`;
  await box.fill(`Checked the ledger (${MARK2}).`);
  await m.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  const r2 = m.locator('.line.report', { hasText: MARK2 });
  check('member: Ctrl+Enter hands it in, and it answers the item', await until(async () => /answers Check the ledger/.test(await r2.innerText()), 30000));
  const made2 = await reportsWith(MARK2);
  for (const e of made2) record('narrative', e.id);
  const e2 = made2[0] ?? {};
  check('keel: it hangs on the item and answers it', made2.length === 1 && JSON.stringify(e2.relations) === JSON.stringify([item.id])
    && JSON.stringify(e2.x_report_answers) === JSON.stringify([item.id]) && e2.subtype === 'handed in', JSON.stringify({ relations: e2.relations, answers: e2.x_report_answers }));
  check('keel: the item\'s own state is left alone', (await api.get('relation', item.id)).subtype === 'open');

  // ------------------------------------------------------------ the keeper completes the first (step 2, by API)
  const CHANGES = `Renamed the second ship: ow://object/${item.id}\nSet the subtype of 2 Objects to surveyed (a search for every Object finds them)`;
  await api.patch('narrative', e1.id, { description: `Two ships disagreed (${RUN}); the ledger is now right.`, consequences: CHANGES, subtype: 'completed' });
  for (const [page, who] of [[m, 'member'], [host, 'host']]) {
    const r = page.locator('.line.report', { hasText: `Two ships disagreed (${RUN})` });
    check(`${who}: the completed report shows its description open`, await until(() => r.getAttribute('data-report').then(v => v === 'completed'), 40000));
    check(`${who}: What changed, one row per line, its words shown and its address kept apart`, await r.locator('[data-part="report-changes"] li').count() === 2
      && (await r.locator('[data-part="report-changes"] li').first().innerText()).trim() === 'Renamed the second ship'
      && await r.locator('[data-part="report-changes"] li').first().getAttribute('data-address') === `ow://object/${item.id}`
      && await r.locator('[data-part="report-changes"] li').nth(1).getAttribute('data-address') === null
      && await r.locator('[data-part="report-changes"] a').count() === 0);
    check(`${who}: the story is folded under The report as handed in`, await r.locator('[data-part="report-story"]').count() === 0
      && /The report as handed in/.test(await r.innerText()));
  }
  check('keel: the parlor never wrote the story again', (await api.get('narrative', e1.id)).story === STORY.join('\n'));
  await shot(m, 'completed');

  // A phone: the text keeps its own row with Report on (the code gate's M1: 18 px at 320 before the fix).
  await m.setViewportSize({ width: 360, height: 760 });
  await m.locator('.mtabs').getByRole('button', { name: 'Room' }).click().catch(() => {});
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  const wide = await box.evaluate(t => t.getBoundingClientRect().width);
  check('member: on a 360 px phone the report text is a full row', wide >= 280, `${Math.round(wide)} px`);
  await shot(m, 'phone');
  await toggle.click();
  violations.push(...await host.evaluate(() => window.__policy ?? []), ...await m.evaluate(() => window.__policy ?? []));
  check('no policy violation on any page', violations.length === 0, violations.join('; '));
} catch (err) {
  check('the walk ran to its end', false, String(err?.message ?? err).slice(0, 300));
} finally {
  for (const [p, label] of pages) await recordMinted(p, label).catch(() => {});
  await browser.close();
  clearTimeout(watchdog);
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
