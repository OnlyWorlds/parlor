// The ground's live walk (OW Parlor #481): a host and a member on production keel,
// the built bundle served by `vite preview`, one engine per run.
//   WALK_STATE=<scratch file> SHOTS=<dir> node walk/walk.mjs chromium|firefox [member-label]
// The host is crew-walk-c. crew-walk-d walks the PIN-less door. The member
// (default crew-walk-b) joins by the seed's invite link, names itself, posts,
// writes a spec and votes; the host runs every phase, hearts, stars the
// winner, then hides the member's line, which must leave the member's room.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { account, readState, writeState } from './accounts.mjs';

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

const browser = await engine.launch();
try {
  // ---------------------------------------------------------------- the host
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await withToken(hostCtx, 'crew-walk-c', account('crew-walk-c').pin);
  const host = await hostCtx.newPage();
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
    await dCtx.close();
  }

  // ---------------------------------------------------------------- the member
  // PHONE=1: the member on a 390 px phone, one pane at a time, switching tabs as a person would.
  const phone = process.env.PHONE === '1';
  const mCtx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, ...(phone && engineName === 'chromium' ? { isMobile: true, hasTouch: true } : {}) });
  await withToken(mCtx, memberLabel, account(memberLabel).pin);
  const m = await mCtx.newPage();
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
  const specTitle = `A ${engineName} map that draws itself`;
  await m.getByRole('button', { name: /Add your spec|Edit your spec/ }).click();
  await m.fill('#spec-title', specTitle);
  await m.fill('#spec-text', 'A spec with "quotes" and <b>tags</b> stays text.');
  await m.getByRole('button', { name: 'Save your spec' }).click();
  check('host: the member\'s spec arrives', await until(() => host.getByRole('heading', { name: specTitle }).isVisible(), 8000));
  check('host: markup in a spec stays text', await until(() => host.getByText('<b>tags</b>', { exact: false }).isVisible()));
  const hostCard = host.locator('.card', { has: host.getByRole('heading', { name: specTitle }) });
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
  await shot(m, 'member-voting');

  // The winner, then Build and Showcase.
  await hostCard.getByRole('button', { name: 'Make it the winner' }).click();
  check('member: the winner is starred for them', await until(() => m.locator('.card.star', { hasText: specTitle }).isVisible(), 8000));
  await host.locator('.hostbar .pp', { hasText: 'Build' }).click();
  await host.locator('.hostbar .pp', { hasText: 'Showcase' }).click();
  check('member: the Showcase reaches them', await until(() => m.locator('.phases .pp.now', { hasText: 'Showcase' }).isVisible(), 8000));
  await shot(m, 'member-showcase');

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
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${engineName}: ${results.length - failed} of ${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
