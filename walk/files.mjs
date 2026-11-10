// Files on a line, on production keel: the host (crew-walk-c) and a member (crew-walk-b, by the seed's invite).
//   WALK_STATE=<scratch file> PARLOR_URL=<a built parlor under its _headers> SHOTS=<dir> node walk/files.mjs chromium|firefox
// Run seed.mjs first. Every line the walk makes is recorded in the state's decoys, so teardown.mjs deletes it by
// id, and keel purges a deleted line's files with it. EXPECT_OLD=1: a build without files, where the walk must fail.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/files-${engineName}-${String(++step).padStart(2, '0')}-${name}.png` }); };
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 300));
  }
}
const watchdog = setTimeout(() => { console.log('FAIL watchdog 300 s'); process.exit(3); }, 300000);

// The files, made here (a real webp and png, a markdown note, a gif keel does not take, text wearing a png's name).
const dir = join(tmpdir(), `parlor-files-walk-${process.pid}`);
mkdirSync(dir, { recursive: true });
const WEBP = Buffer.from('UklGRq4AAABXRUJQVlA4IKIAAACwBQCdASowACAAPmEmj0W1oiEapAFYBgS1AE6ZQjgb2D8Zr9e4rAAAP0MEvLqRi9JLz3i39ZwA/v2kgHaXsKyP4K7/0FHpz7RkXKJ9UTszF/zxvGc/mYc75oDlvLKWinXzrbv5J9IFCGgZ3cSMLgqw63SuBw341NAFgtJpSrPp95m0atuJT8Sbxgn+/FULVzW1BFgNO3oivIStG+SBNewVAAA=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOTES = `# Report notes (${engineName})\n\nWhat the screens show: the harbour list, then the ledger.\n`.repeat(30);
const file = (name, bytes) => { const p = join(dir, name); writeFileSync(p, bytes); return p; };
const pWebp = file('harbour.webp', WEBP), LEDGER = `ledger-${engineName}-${Date.now().toString(36)}.png`, pPng = file(LEDGER, PNG), pNotes = file('notes.md', NOTES);
const pGif = file('wave.gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')), pLie = file('not-a.png', 'plain text wearing a png name\n'.repeat(10));

const api = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
s.decoys ??= [];
const record = (id) => { if (!s.decoys.some(d => d.id === id)) { s.decoys.push({ type: 'narrative', id }); writeState(s); } };
const lineId = async (text) => { for await (const e of api.listAll('narrative')) if (e.description === text) return e.id; return null; };
const filesOn = async (id) => (await api.worldFiles()).data.filter(r => r.element_id === id);

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
  // ------------------------------------------------------------ the host attaches
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
  const attach = host.locator('form.send [data-part="attach"]');
  check('host: the composer has Attach', await until(() => attach.isVisible(), 8000));
  if (process.env.EXPECT_OLD === '1' && !(await attach.count())) throw new Error('no Attach on this build (the control)');
  const input = host.locator('form.send input[type="file"]');
  await input.setInputFiles([pWebp, pNotes]);
  await input.setInputFiles([pGif]);
  check('host: a .gif is refused at the pick, two chips stay', await until(async () => (await host.locator('.send-files .file-chip').count()) === 2)
    && /none of those/.test(await host.locator('body').innerText()), await notices(host));
  // A paste: a picture alone is picked; text with a picture beside it (Excel, Word) stays text (the code gate's M1).
  const paste = (withText) => host.locator('textarea[aria-label="Write a line"]').evaluate((ta, withText) => {
    const dt = new DataTransfer();
    if (withText) dt.setData('text/plain', 'A1\tB1');
    const c = document.createElement('canvas');
    c.width = 2; c.height = 2;
    return new Promise(res => c.toBlob(b => {
      dt.items.add(new File([b], 'image.png', { type: 'image/png' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      ta.dispatchEvent(ev);
      res(ev.defaultPrevented);
    }, 'image/png'));
  }, withText);
  // Chromium only: Firefox's synthetic ClipboardEvent arrives with no types and no files (probed),
  // so there it cannot stand in for a real paste.
  if (engineName === 'chromium') {
    const textPasteTaken = await paste(true);
    check('host: a paste carrying text stays text, no picture picked', !textPasteTaken && await host.locator('.send-files .file-chip').count() === 2);
    const picPasteTaken = await paste(false);
    check('host: a pasted picture alone is picked as a file', picPasteTaken && await until(async () => (await host.locator('.send-files .file-chip', { hasText: 'pasted-' }).count()) === 1, 3000));
    await host.locator('.send-files .file-chip', { hasText: 'pasted-' }).getByRole('button').click();
    check('host: × drops it again', await until(async () => (await host.locator('.send-files .file-chip').count()) === 2, 3000));
  }
  const text = `Screens for the report, ${engineName} ${new Date().toISOString().slice(11, 19)}`;
  await host.fill('textarea[aria-label="Write a line"]', text);
  await host.keyboard.press('Enter');
  await host.keyboard.press('Enter'); // a second Enter while the first is sending makes no second line
  check('host: the chips go at Send', await until(() => host.locator('.send-files').isHidden(), 5000));
  const line = host.locator('.line', { hasText: text });
  check('host: the line shows with both files listed', await until(async () => (await line.locator('.file[data-file]').count()) === 2, 30000));
  const id1 = await lineId(text);
  if (id1) record(id1);
  let lines = 0;
  for await (const e of api.listAll('narrative')) if (e.description === text) lines++;
  check('host: one line for one Send, Enter twice', lines === 1, `${lines} lines`);
  const k1 = id1 ? await filesOn(id1) : [];
  check('keel: the line holds harbour.webp and notes.md at their sizes', k1.length === 2
    && k1.some(r => r.name === 'harbour.webp' && r.kind === 'webp' && r.size === WEBP.length)
    && k1.some(r => r.name === 'notes.md' && r.size === Buffer.byteLength(NOTES)), JSON.stringify(k1.map(r => [r.name, r.kind, r.size])));
  const pic = line.locator('.file-pic img');
  check('host: the picture shows as a preview', await until(() => pic.evaluate(i => i.complete && i.naturalWidth > 0), 15000));
  await pic.click();
  check('host: a click opens it full size in the page', await until(() => host.locator('dialog.viewer[open] img').evaluate(i => i.naturalWidth > 0)));
  await shot(host, 'viewer');
  await host.keyboard.press('Escape');
  check('host: Escape closes it', await until(() => host.locator('dialog.viewer[open]').count().then(n => n === 0)));
  const dl = host.waitForEvent('download', { timeout: 20000 });
  await line.locator('.file', { hasText: 'notes.md' }).locator('[data-act="download-file"]').click();
  const got = await dl;
  const saved = join(dir, `got-${engineName}.md`);
  await got.saveAs(saved);
  check('host: Download saves the same bytes, by its name', readFileSync(saved, 'utf8') === NOTES && got.suggestedFilename() === 'notes.md', got.suggestedFilename());
  await shot(host, 'line-with-files');

  // A file whose contents lie: the line goes, the file is refused in words, with no Try again.
  const lieText = `A lie, ${engineName}`;
  await input.setInputFiles([pLie]);
  await host.fill('textarea[aria-label="Write a line"]', lieText);
  await host.keyboard.press('Enter');
  const lieLine = host.locator('.line', { hasText: lieText });
  check('host: text named .png is refused by keel, said in words, no Try again', await until(async () =>
    /not what its name says/.test(await lieLine.locator('.file.failed').innerText()) && (await lieLine.getByRole('button', { name: 'Try again' }).count()) === 0, 30000));
  const id2 = await lineId(lieText);
  if (id2) record(id2);
  check('keel: nothing on the lie\'s line', id2 ? (await filesOn(id2)).length === 0 : false);
  await lieLine.getByRole('button', { name: 'Drop' }).click();
  check('host: Drop clears the refusal', await until(() => lieLine.locator('.file.failed').count().then(n => n === 0)));

  // A line of files with no words: named by its file.
  await input.setInputFiles([pPng]);
  await host.locator('textarea[aria-label="Write a line"]').fill('');
  await host.locator('form.send button[type="submit"]').click();
  let id3 = null;
  await until(async () => { for await (const e of api.listAll('narrative')) if (e.name === LEDGER && e.x_room_of) id3 = e.id; return !!id3; }, 15000);
  if (id3) record(id3);
  const bare = host.locator(`.file[data-file]`, { hasText: LEDGER });
  check('host: a file with no words is a line of its own', await until(() => bare.isVisible(), 30000));
  const bareLine = host.locator('.line', { has: bare });
  check('host: that line shows no text, only its file', await bareLine.locator('.txt').count() === 0, await bareLine.innerText().catch(() => ''));
  violations.push(...await host.evaluate(() => window.__policy ?? []));

  // ------------------------------------------------------------ the member reads
  const mCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await watchPolicy(mCtx);
  await withToken(mCtx, 'crew-walk-b');
  const m = await mCtx.newPage();
  pages.push([m, 'crew-walk-b']);
  await m.goto(`${BASE}#/join/${s.invites.member.code}`);
  const ask = m.getByRole('button', { name: /^Join Parlor ground \(crew test\) as/ });
  if (await until(() => ask.isVisible(), 12000)) await ask.click();
  else await m.goto(`${BASE}#/w/${s.worldId}`);
  check('member: in the room', await until(() => m.getByText('You: member').isVisible(), 30000));
  const mLine = m.locator('.line', { hasText: text });
  check('member: the host\'s line shows its two files', await until(async () => (await mLine.locator('.file[data-file]').count()) === 2, 30000));
  check('member: and the preview', await until(() => mLine.locator('.file-pic img').evaluate(i => i.complete && i.naturalWidth > 0), 15000));
  check('member: no Remove on the host\'s files (keel would refuse it)', await mLine.locator('[data-act="remove-file"]').count() === 0);
  check('member: Download on each', await mLine.locator('[data-act="download-file"]').count() === 2);
  violations.push(...await m.evaluate(() => window.__policy ?? []));
  await shot(m, 'member');

  // ------------------------------------------------------------ the host removes one
  host.once('dialog', d => void d.dismiss());
  await line.locator('.file', { hasText: 'notes.md' }).locator('[data-act="remove-file"]').click();
  await host.waitForTimeout(1500);
  check('host: a dismissed confirm removes nothing', id1 ? (await filesOn(id1)).length === 2 : false);
  host.once('dialog', d => void d.accept());
  await line.locator('.file', { hasText: 'notes.md' }).locator('[data-act="remove-file"]').click();
  check('host: Remove takes the row away', await until(async () => (await line.locator('.file[data-file]').count()) === 1, 10000));
  check('keel: only harbour.webp left on the line', id1 ? (await filesOn(id1)).map(r => r.name).join() === 'harbour.webp' : false);
  check('member: the removed file leaves the member\'s room within a read', await until(async () => (await mLine.locator('.file[data-file]').count()) === 1, 30000));
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
