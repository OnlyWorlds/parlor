/**
 * OnlyWorlds Parlor: a room on a world. Three pages: sign in, your parlors,
 * the room. An invite link (`#/join/<code>`, or keel's own `/join#ow_j_…`
 * pasted in) joins first; the code leaves the address bar before anything
 * else runs. Sign in with OnlyWorlds comes back to `/signin/callback`, whose
 * exchange starts before anything else (`parlor/signin.ts`).
 */

import './style.css';
import { session, joinCodeIn, type AccountWorld } from './parlor/session';
import { isSignInCallback, startSignInCallback, takeResume, applySignInOutcome, type SignInOutcome } from './parlor/signin';
import { Room, problemLine } from './parlor/room';
import { signInView, confirmJoinView, worldsView, previewOf } from './ui/doors';
import { roomView } from './ui/room-view';
import { h, clear, notice } from './ui/dom';

// The code is traded first, before the router or any other request (contract P2).
let signingIn: Promise<SignInOutcome> | null = isSignInCallback() ? startSignInCallback() : null;

const root = document.getElementById('app')!;
const PENDING_JOIN = 'parlor.pendingJoin';
/**
 * An invite waiting to be joined, kept for the tab so a reload of the screen that asks about it
 * keeps it (the sign-in gate's G3). A signed-in browser asks before it spends one ("Join X as Y"),
 * whichever door signed it in (the gate's G1): only the password form's own sign-in, where the
 * person typed the account, joins at once.
 */
let pendingJoin: string | null = (() => {
  try { return joinCodeIn(sessionStorage.getItem(PENDING_JOIN) ?? ''); } catch { return null; }
})();
function setPendingJoin(code: string | null): void {
  pendingJoin = code;
  try {
    if (code) sessionStorage.setItem(PENDING_JOIN, code);
    else sessionStorage.removeItem(PENDING_JOIN);
  } catch { /* the tab keeps it in memory */ }
}
let joinWithoutAsking = false;
/** A refusal from the round trip, said once on the landing (P7). */
let landingProblem: string | undefined;
/** "Use another account": the landing opens on the password form. */
let openForm = false;
/** Signed in by a return just now: the room it lands in names the account (the gate's G2). */
let justSignedIn = false;
let leaveRoom: (() => void) | null = null;

function captureJoin(): void {
  const code = /^#\/?join/.test(location.hash) || /ow_j_/.test(location.hash) ? joinCodeIn(location.hash) : null;
  if (code) {
    setPendingJoin(code);
    joinWithoutAsking = false;
    history.replaceState(history.state, '', '#/');
  }
}

function signOutHere(): void {
  session.signOut();
  location.hash = '';
  location.reload();
}

function worldInHash(): string | null {
  const m = /^#\/w\/([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

/** The exchange's answer: the token kept, then the address set once with no entry to come back to (P11). */
async function finishSignIn(pending: Promise<SignInOutcome>): Promise<void> {
  clear(root, h('div', { class: 'center' }, h('p', { class: 'sys' }, 'Signing in…')));
  const landing = applySignInOutcome(await pending, takeResume());
  if (landing.join) {
    setPendingJoin(landing.join);
    joinWithoutAsking = false;
  }
  landingProblem = landing.problem;
  justSignedIn = !!landing.signedIn;
  history.replaceState(null, '', `/${landing.hash}`);
}

const STALE_INVITE = 'That invite link did not open: it may be used or out of date. Your parlors are below; ask the host for a new link if this one is missing.';
/** Each route() is a generation: one that a newer route() overtook during an await draws nothing more (the code gate's C1). */
let generation = 0;

async function route(): Promise<void> {
  const mine = ++generation;
  const overtaken = () => mine !== generation;
  leaveRoom?.();
  leaveRoom = null;
  if (signingIn) {
    const pending = signingIn;
    signingIn = null;
    await finishSignIn(pending);
  }
  captureJoin();
  if (!session.signedIn) {
    const shown = pendingJoin;
    const preview = shown ? await previewOf(shown) : null;
    if (overtaken()) return;
    // A stale invite is said once and not kept: not for the tab, not through the round trip (the gate's G11, the code gate's C2).
    const stale = !!shown && !preview;
    if (stale) setPendingJoin(null);
    const problem = landingProblem;
    landingProblem = undefined;
    const form = openForm;
    openForm = false;
    const room = worldInHash();
    signInView(root, preview, () => {
      // The person typed the account: the invite they were shown joins at once, never another (C1).
      joinWithoutAsking = !!shown && pendingJoin === shown;
      void route();
    }, stale, {
      resume: { ...(preview && shown ? { join: shown } : {}), ...(room ? { hash: `#/w/${room}` } : {}) },
      problem,
      openForm: form,
    });
    return;
  }
  if (pendingJoin && !joinWithoutAsking) {
    const shown = pendingJoin;
    const preview = await previewOf(shown);
    if (overtaken()) return;
    if (!preview) {
      setPendingJoin(null);
      notice(STALE_INVITE, true);
    } else {
      confirmJoinView(root, preview, () => {
        // Join spends the invite on screen, never one that arrived since (C1).
        joinWithoutAsking = pendingJoin === shown;
        void route();
      }, () => {
        // Another account: this browser's parlor signs out, the invite waits for the password form.
        session.signOut();
        openForm = true;
        void route();
      }, () => {
        // Not now: the invite is let go, the tab is free (C3).
        setPendingJoin(null);
        void route();
      });
      return;
    }
  }
  joinWithoutAsking = false;
  if (pendingJoin) {
    const code = pendingJoin;
    setPendingJoin(null);
    try {
      const joined = await session.join(code);
      if (overtaken()) return;
      location.hash = `#/w/${joined.worldId}`;
      return;
    } catch {
      if (overtaken()) return;
      notice(STALE_INVITE, true);
    }
  }
  const worldId = worldInHash();
  if (worldId) {
    await openRoom(worldId, overtaken);
    return;
  }
  justSignedIn = false;
  worldsView(root, w => { location.hash = `#/w/${w.id}`; }, id => { location.hash = `#/w/${id}`; });
}

/** `overtaken`: a newer route() took the page during an await, so this one draws nothing more (Firefox's late room over a newer screen). */
async function openRoom(worldId: string, overtaken: () => boolean): Promise<void> {
  clear(root, h('div', { class: 'center' }, h('p', { class: 'sys' }, 'Opening the room…')));
  let world: AccountWorld | undefined;
  try {
    world = (await session.worlds()).find(w => w.id === worldId);
  } catch (err) {
    if (overtaken()) return;
    clear(root, h('div', { class: 'center' }, h('p', { class: 'problem' }, problemLine(err, 'reading your worlds'))));
    return;
  }
  if (overtaken()) return;
  if (!world) {
    notice('That world is not one of yours. Join it with an invite link first.', true);
    location.hash = '#/';
    return;
  }
  try {
    const room = await Room.open(world);
    if (overtaken()) {
      room.close();
      return;
    }
    const signedInAs = justSignedIn ? { name: session.login, signOut: signOutHere } : undefined;
    justSignedIn = false;
    leaveRoom = roomView(root, room, () => { location.hash = '#/'; }, signedInAs);
  } catch (err) {
    const e = err as { status?: number };
    if (e.status === 401) session.forgetKey(worldId);
    if (overtaken()) return;
    clear(root, h('div', { class: 'center' }, h('div', { class: 'land' },
      h('p', { class: 'problem' }, problemLine(err, 'opening the room')),
      h('div', { class: 'btns' }, h('button', { class: 'btn std', type: 'button', onclick: () => { location.hash = '#/'; } }, 'Your parlors')))));
  }
}

window.addEventListener('hashchange', () => { void route(); });
// A page brought back by Back (from onlyworlds.com, or past a sign-in) loads again: its session was
// read once, before the sign-in (the sign-in gate's G5).
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
void route();
