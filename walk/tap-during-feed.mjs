// A press while the room's feed lands: the tap must do what it was pressed on.
//   WALK_STATE=<scratch file> PARLOR_URL=http://127.0.0.1:30338/ node walk/tap-during-feed.mjs chromium|firefox
// The host (crew-walk-c, the seed's token) opens the room, starts a sitting in Pitch and adds a spec.
// Then, twice (Heart on the spec, Show earlier in the room's head): the feed's next read is held, a
// lore decoy is made in the world (recorded by id), the press goes down, the read is let go and
// lands (a redraw on the old build replaces what is pressed), and only then the press comes up.
// The tap must land; the redraw it held must run after it. A control: PARLOR_URL at the older build.
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';
import { account, readState, writeState, API } from './accounts.mjs';

const engine = process.argv[2] === 'firefox' ? firefox : chromium;
const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const BASE = process.env.PARLOR_URL ?? 'http://127.0.0.1:30338/';
const s = readState();
const results = [];
const watchdog = setTimeout(() => { console.log('FAIL watchdog: the walk ran past four minutes (decoys are in WALK_STATE)'); process.exit(2); }, 240000);

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
async function until(fn, ms = 12000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 200));
  }
}
const withLimit = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${ms} ms`)), ms))]);

const api = new OwV2Client({ apiKey: s.hostKey.key, apiPin: account('crew-walk-c').pin, baseUrl: API });
s.decoys ??= [];
async function decoy(name) {
  const made = await withLimit(api.create('narrative', { name, description: 'DECOY: lore made by the tap walk, never a line in the room' }), 20000, 'the decoy');
  s.decoys.push({ type: 'narrative', id: made.id });
  writeState(s);
}

const browser = await engine.launch();
let page;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const t = s.tokens['crew-walk-c'];
  if (!t) throw new Error('no seeded token for crew-walk-c: run seed.mjs');
  await ctx.addInitScript(([token, pin]) => {
    if (!localStorage.getItem('parlor.session.v1')) localStorage.setItem('parlor.session.v1', JSON.stringify({ token, login: 'crew-walk-c', pin, keys: {} }));
  }, [t.token, account('crew-walk-c').pin]);
  // The press's own events, kept for a red's detail (the last 40).
  await ctx.addInitScript(() => {
    window.__ev = [];
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'dragstart', 'lostpointercapture']) {
      window.addEventListener(t, e => { window.__ev.push(`${t}@${e.target?.tagName ?? '?'}`); if (window.__ev.length > 40) window.__ev.shift(); }, true);
    }
  });
  page = await ctx.newPage();

  // The feed's reads, held on demand. A read held is answered only when let go.
  let holding = false;
  const held = [];
  let feedDone = 0;
  await page.route(/\/api\/v2\/changes\//, route => { if (holding) held.push(route); else route.continue(); });
  page.on('requestfinished', r => { if (/\/api\/v2\/changes\//.test(r.url()) && !r.url().includes('head=true')) feedDone++; });

  await page.goto(`${BASE}#/w/${s.worldId}`);
  check('the room opens on the host\'s seat', await until(() => page.getByText('You: host').isVisible(), 30000));
  if (await page.locator('#my-name').isVisible().catch(() => false)) {
    await page.fill('#my-name', 'Host C');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await page.getByRole('button', { name: /Start (the first|a new) sitting/ }).click();
  check('a sitting starts in Arrive', await until(() => page.locator('.hostbar .pp.now', { hasText: 'Arrive' }).isVisible()));
  await page.locator('.hostbar .pp', { hasText: 'Pitch' }).click();
  check('Pitch: hearts on', await until(() => page.getByRole('button', { name: 'Hearts: on' }).isVisible()));
  const title = `A tap walk spec, ${engineName}, ${new Date().toISOString().slice(11, 19)}`;
  await page.getByRole('button', { name: /Add your spec|Edit your spec/ }).click();
  await page.fill('#spec-title', title);
  await page.getByRole('radio', { name: 'A feature' }).check();
  await page.getByRole('button', { name: 'Save your spec' }).click();
  const card = page.locator('.card', { has: page.getByRole('heading', { name: title }) });
  check('the spec shows', await until(() => card.isVisible()));
  await page.waitForTimeout(2500); // the feed has caught up with the walk's own writes

  /** Press `target`, let a held feed read land under it, then lift. Returns whether the pressed node was replaced under the press. */
  async function pressThroughFeed(target, decoyName) {
    holding = true;
    await decoy(decoyName);
    const caught = await until(() => held.length > 0, 8000);
    const box = await target.boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    // The node under the press, read once it is down (a redraw before the press is not this check's).
    await page.evaluate(([x, y]) => { window.__pressed = document.elementFromPoint(x, y)?.closest('button') ?? null; }, [x, y]);
    const before = feedDone;
    holding = false;
    for (const r of held.splice(0)) await r.continue();
    const landed = await until(() => feedDone > before, 8000);
    await page.waitForTimeout(600); // the feed's emit and any redraw it runs
    const replaced = await page.evaluate(() => !window.__pressed?.isConnected);
    await page.mouse.up();
    return { caught, landed, replaced };
  }
  const changesHold = name => page.evaluate(n => [...document.querySelectorAll('ul.changes .nm')].some(e => e.textContent === n), name);

  // ---------------------------------------------------------------- Heart, while the feed lands
  {
    const name = `Decoy tap heart ${engineName} ${Date.now() % 100000}`;
    const r = await pressThroughFeed(card.getByRole('button', { name: '♡ Heart' }), name);
    check('heart: the feed read was held and then landed under the press', r.caught && r.landed, `caught ${r.caught}, landed ${r.landed}`);
    check('heart: the pressed button was not replaced under the press', !r.replaced);
    check('heart: the tap lands (♥ Hearted)', await until(() => card.getByRole('button', { name: '♥ Hearted' }).isVisible(), 6000));
    check('heart: the held redraw runs after the tap (the decoy in Changes)', await until(() => changesHold(name), 8000));
    // Back as it was.
    if (await card.getByRole('button', { name: '♥ Hearted' }).isVisible().catch(() => false)) {
      await card.getByRole('button', { name: '♥ Hearted' }).click();
      await until(() => card.getByRole('button', { name: '♡ Heart' }).isVisible(), 6000);
    }
  }

  // ---------------------------------------------------------------- Show earlier, while the feed lands
  {
    const earlier = page.getByRole('button', { name: 'Show earlier' });
    if (await until(() => earlier.isVisible(), 4000)) {
      const name = `Decoy tap earlier ${engineName} ${Date.now() % 100000}`;
      const r = await pressThroughFeed(earlier, name);
      check('earlier: the feed read was held and then landed under the press', r.caught && r.landed, `caught ${r.caught}, landed ${r.landed}`);
      check('earlier: the pressed button was not replaced under the press', !r.replaced);
      check('earlier: the tap lands (an earlier sitting shows)', await until(() => page.getByText('An earlier sitting.').isVisible(), 6000));
      if (await page.getByRole('button', { name: 'Back to now' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Back to now' }).click();
    } else {
      check('earlier: the room offers Show earlier (an earlier sitting on the ground)', false);
    }
  }

  // ---------------------------------------------------------------- a press that never becomes a click
  // Pressed on Heart, dragged off and lifted: no click and no handler of its own redraws, so only the
  // held redraw can bring the decoy into Changes (the gate's S1: the two taps above redraw by themselves).
  // Lifted inside the window (Firefox sends a page nothing for a lift outside it: the cap's case, below).
  for (const where of ['inside', 'outside']) {
    const name = `Decoy tap off ${where} ${engineName} ${Date.now() % 100000}`;
    const target = card.getByRole('button', { name: /Heart/ });
    holding = true;
    await decoy(name);
    const caught = await until(() => held.length > 0, 8000);
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const before = feedDone;
    holding = false;
    for (const r of held.splice(0)) await r.continue();
    const landed = await until(() => feedDone > before, 8000);
    await page.waitForTimeout(600);
    const shownUnder = await changesHold(name);
    const vh = page.viewportSize().height;
    await page.mouse.move(box.x + box.width / 2, where === 'inside' ? Math.min(box.y + 200, vh - 10) : vh + 200, { steps: 4 });
    await page.mouse.up();
    const t0 = Date.now();
    check(`off ${where}: the feed read was held and then landed under the press`, caught && landed, `caught ${caught}, landed ${landed}`);
    check(`off ${where}: nothing redraws while the press is down (the decoy not yet in Changes)`, !shownUnder);
    // Inside: the lift frees it (300 ms after a pointerup, or a click on the common ancestor). Outside: at worst the 5 s cap from the pointerdown.
    const ranAfter = await until(() => changesHold(name), where === 'inside' ? 2500 : 6000);
    check(`off ${where}: the held redraw runs once the press ends with no click`, ranAfter, `${Date.now() - t0} ms after the lift${ranAfter ? '' : `; events: ${await page.evaluate(() => (window.__ev ?? []).slice(-6).join(' ')).catch(() => '?')}`}`);
    check(`off ${where}: no heart was left by the press dragged off`, await card.getByRole('button', { name: '♡ Heart' }).isVisible());
  }

  // The keys this page's parlor holds, by their last four, for teardown (never the secrets).
  const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('parlor.session.v1') ?? 'null'); } catch { return null; } }).catch(() => null);
  for (const k of [...Object.values(sess?.keys ?? {}), ...Object.values(sess?.readKeys ?? {})]) {
    if (typeof k === 'string') s.minted.push({ kind: 'browser-key', label: 'crew-walk-c', last4: k.slice(-4) });
  }
  writeState(s);
} catch (err) {
  check('the walk ran to its end', false, String(err?.message ?? err).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
  clearTimeout(watchdog);
}
const failed = results.filter(r => !r.ok).length;
console.log(`${engineName}: ${failed ? `FAIL ${failed} of ${results.length}` : `all ok (${results.length})`} on ${BASE}`);
process.exit(failed ? 1 : 0);
