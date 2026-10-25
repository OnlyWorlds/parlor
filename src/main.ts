/**
 * OnlyWorlds Parlor: a room on a world (OW Parlor #481, the ground; design
 * sheet Orrery/parlor/design-sheet.md). Three pages: sign in, your parlors,
 * the room. An invite link (`#/join/<code>`, or keel's own `/join#ow_j_…`
 * pasted in) joins first; the code leaves the address bar before anything
 * else runs.
 */

import './style.css';
import { session, joinCodeIn, type AccountWorld } from './parlor/session';
import { Room, problemLine } from './parlor/room';
import { signInView, worldsView, previewOf } from './ui/doors';
import { roomView } from './ui/room-view';
import { h, clear, notice } from './ui/dom';

const root = document.getElementById('app')!;
let pendingJoin: string | null = null;
let leaveRoom: (() => void) | null = null;

function captureJoin(): void {
  const code = /^#\/?join/.test(location.hash) || /ow_j_/.test(location.hash) ? joinCodeIn(location.hash) : null;
  if (code) {
    pendingJoin = code;
    history.replaceState(history.state, '', '#/');
  }
}

function worldInHash(): string | null {
  const m = /^#\/w\/([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

async function route(): Promise<void> {
  leaveRoom?.();
  leaveRoom = null;
  captureJoin();
  if (!session.signedIn) {
    const preview = pendingJoin ? await previewOf(pendingJoin) : null;
    signInView(root, preview, route, !!pendingJoin && !preview);
    return;
  }
  if (pendingJoin) {
    const code = pendingJoin;
    pendingJoin = null;
    try {
      const joined = await session.join(code);
      location.hash = `#/w/${joined.worldId}`;
      return;
    } catch {
      notice('That invite link did not open: it may be used or out of date. Your parlors are below; ask the host for a new link if this one is missing.', true);
    }
  }
  const worldId = worldInHash();
  if (worldId) {
    await openRoom(worldId);
    return;
  }
  worldsView(root, w => { location.hash = `#/w/${w.id}`; }, id => { location.hash = `#/w/${id}`; });
}

async function openRoom(worldId: string): Promise<void> {
  clear(root, h('div', { class: 'center' }, h('p', { class: 'sys' }, 'Opening the room…')));
  let world: AccountWorld | undefined;
  try {
    world = (await session.worlds()).find(w => w.id === worldId);
  } catch (err) {
    clear(root, h('div', { class: 'center' }, h('p', { class: 'problem' }, problemLine(err, 'reading your worlds'))));
    return;
  }
  if (!world) {
    notice('That world is not one of yours. Join it with an invite link first.', true);
    location.hash = '#/';
    return;
  }
  try {
    const room = await Room.open(world);
    leaveRoom = roomView(root, room, () => { location.hash = '#/'; });
  } catch (err) {
    const e = err as { status?: number };
    if (e.status === 401) session.forgetKey(worldId);
    clear(root, h('div', { class: 'center' }, h('div', { class: 'land' },
      h('p', { class: 'problem' }, problemLine(err, 'opening the room')),
      h('div', { class: 'btns' }, h('button', { class: 'btn std', type: 'button', onclick: () => { location.hash = '#/'; } }, 'Your parlors')))));
  }
}

window.addEventListener('hashchange', () => { void route(); });
void route();
