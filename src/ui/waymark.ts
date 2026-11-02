/**
 * The OnlyWorlds mark beside a name (the SDK's Waymark): a slot of its own after the world's name in
 * the top bar, after each element in What changed, and after each element a work item is about. The
 * mark opens the fan-out: the element's page on onlyworlds.com, the tools that open it, Copy link.
 *
 * Who sees it: everyone in a parlor is signed in with their own OnlyWorlds account and is a member of
 * the world (an invite is how they came in), so every reader is a member, and keel's `/w/<world>` and
 * an element's address send a signed-in member on to their own view. Someone who signed in here with a
 * password has no session on onlyworlds.com: since 2026-11-02 keel asks them to sign in there and then
 * lands them on the same address (before, a private world answered a bare 404). The public face is
 * never drawn.
 * An element the room cannot find (Missing) or one in another world gets no mark.
 *
 * The panels rebuild when what they show moves (the feed asks every two seconds), so this file also
 * says when an open fan-out has settled: a panel holds its rebuild while a fan-out in it is open (or
 * its "Link copied" toast shows), and rebuilds once it settles, after the press that closed it has
 * landed (the same slot Lantern and the OnlyWorlds Dashboard use).
 */

import { ROOM_PAIRS, TOOLS, handsOnAsProposed, isRoomElement, simpleCaseFold, type OwTool } from '@onlyworlds/sdk';
import { mountWaymark } from '@onlyworlds/sdk/waymark';

export interface WaymarkSlot {
  readonly el: HTMLElement;
  dispose(): void;
}

export interface WaymarkPlan {
  world: { id: string; name: string };
  element: { id: string; type: string; name: string; [k: string]: unknown } | null;
  /** The tools list's rows to offer, when not the whole baked list. */
  tools?: readonly OwTool[];
}

/**
 * Whether Little Lens's element page opens this element. That page reads only what its graph keeps
 * (little-lens `src/lens/graph.ts`, `buildGraph`): no hidden, proposed or room element, and no Map, Pin or
 * Marker. This copies that rule (the OnlyWorlds Dashboard's `waymark.ts` holds the same) until the tools
 * list can say what each tool opens; anything else would offer a row that lands on "You cannot open this element".
 */
export function littleLensOpens(el: Record<string, unknown>): boolean {
  const type = typeof el.type === 'string' ? simpleCaseFold(el.type.trim()) : '';
  if (type === 'map' || type === 'pin' || type === 'marker') return false;
  if ('hidden' in el && el.hidden !== null && el.hidden !== false && el.hidden !== undefined) return false;
  if (handsOnAsProposed(el)) return false;
  if (isRoomElement(el as Parameters<typeof isRoomElement>[0])) return false;
  if (typeof el.supertype === 'string' && ROOM_PAIRS.some(p => simpleCaseFold(p.type) === type && simpleCaseFold(p.supertype) === simpleCaseFold((el.supertype as string).trim()))) {
    const ext = el.extensions;
    const mark = 'x_room_of' in el ? el.x_room_of : ext && typeof ext === 'object' ? (ext as Record<string, unknown>).x_room_of : undefined;
    if (mark !== null && mark !== undefined && (typeof mark !== 'string' || mark.trim() !== '')) return false;
  }
  return true;
}

const WITHOUT_LITTLE_LENS: readonly OwTool[] = TOOLS.filter(t => t.id !== 'little-lens');

/** The parlor's client name, the same one its reads and writes carry. */
const CLIENT_NAME = 'parlor';

/** The event a slot sends up the page once its fan-out has settled: a held rebuild may run. */
export const WAYMARK_SETTLED = 'parlor-waymark-settled';

// A visible toast holds only the rebuilds the person did not cause: a press or a key outside its slot
// releases it, while an open fan-out always holds.
const OPEN = '.ow-waymark__mark[aria-expanded="true"], .parlor-waymark:not([data-released]) .ow-waymark__toast:not([hidden])';

/** A fan-out is open, or its toast shows, somewhere under `root`: a rebuild there waits for it. */
export function waymarkOpenIn(root: ParentNode): boolean {
  return !!root.querySelector(OPEN);
}

/** The slot's key when focus is on its mark or in its fan-out, else null. */
export function waymarkFocusIn(root: ParentNode): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !root.contains(a)) return null;
  return a.closest<HTMLElement>('.parlor-waymark')?.getAttribute('data-mark') ?? null;
}

/** Focus the keyed slot's mark under `root`, when it drew one, leaving the page where it was scrolled. */
export function focusWaymark(root: ParentNode, key: string): void {
  for (const s of root.querySelectorAll<HTMLElement>('.parlor-waymark')) {
    if (s.getAttribute('data-mark') !== key) continue;
    s.querySelector<HTMLElement>('.ow-waymark__mark')?.focus({ preventScroll: true });
    return;
  }
}

/**
 * What the mark is given, or null when there is nothing to draw: an element needs its id, its type
 * and a name (an unnamed one is named as the page names it).
 */
export function waymarkPlan(world: { id: string; name: string }, el: Record<string, unknown> | null, unnamed = '(no name)'): WaymarkPlan | null {
  if (!world.id) return null;
  if (!el) return { world: { id: world.id, name: world.name }, element: null };
  const id = el.id, type = el.type;
  if (typeof id !== 'string' || !id || typeof type !== 'string' || !type) return null;
  const name = typeof el.name === 'string' && el.name ? el.name : unnamed;
  const plan: WaymarkPlan = { world: { id: world.id, name: world.name }, element: { ...el, id, type, name } };
  if (!littleLensOpens(el)) plan.tools = WITHOUT_LITTLE_LENS;
  return plan;
}

/** The marks one panel drew: disposed together when the panel rebuilds, focus carried to the new one. */
export interface MarkSet {
  /** A fan-out in the panel is open or its toast shows: the rebuild waits. */
  held(): boolean;
  /** Before a rebuild: the old marks go; returns the key focus was on, for `after`. */
  before(): string | null;
  mark(plan: WaymarkPlan | null, key: string): HTMLElement | null;
  after(focused: string | null): void;
  dispose(): void;
}

export function markSet(host: HTMLElement): MarkSet {
  let marks: WaymarkSlot[] = [];
  const drop = (): void => { for (const m of marks) m.dispose(); marks = []; };
  return {
    held: () => waymarkOpenIn(host),
    before() { const f = waymarkFocusIn(host); drop(); return f; },
    mark(plan, key) {
      if (!plan) return null;
      const slot = waymarkSlot(plan, key);
      marks.push(slot);
      return slot.el;
    },
    after(focused) { if (focused) focusWaymark(host, focused); },
    dispose: drop,
  };
}

const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Once per world and element per session: a mount the component refused is said in the console, not on the page. */
const refusedSaid = new Set<string>();

/** A slot for the world's mark or an element's, keyed for the focus carried across a rebuild; empty when `plan` is null. */
export function waymarkSlot(plan: WaymarkPlan | null, key: string): WaymarkSlot {
  const slot = document.createElement('span');
  slot.className = 'parlor-waymark';
  slot.setAttribute('data-mark', key);
  let unmount: (() => void) | null = null;
  let gone = false;

  if (plan) {
    try {
      unmount = mountWaymark(slot, {
        world: plan.world,
        element: plan.element,
        reader: 'member',
        tool: CLIENT_NAME,
        // Signed in to the parlor says nothing about Atlas or Lantern: no row claims either way.
        signedIn: null,
        phone: coarse(),
        ground: 'dark',
        entry: 'mark',
        ...(plan.tools ? { tools: plan.tools } : {}),
      });
    } catch (err) {
      const k = `${plan.world.id}/${plan.element?.id ?? ''}`;
      if (!refusedSaid.has(k)) {
        refusedSaid.add(k);
        console.warn('[parlor:waymark] no mark beside this name', err);
      }
    }
  }

  const tell = (): void => {
    if (!gone) slot.dispatchEvent(new CustomEvent(WAYMARK_SETTLED, { bubbles: true }));
  };

  // A press that closes the fan-out from outside it: its click must land before the panel rebuilds
  // under it. (A press on a row inside has already landed when it closes: its click clears the press.)
  let pressing = false;
  let pointerIsDown = false;
  const onDown = (): void => { pressing = true; pointerIsDown = true; };
  const onUp = (): void => { pointerIsDown = false; };
  const onClick = (): void => { pressing = false; };
  // A touch that becomes a scroll ends in pointercancel, with no pointerup and no click.
  const onCancel = (): void => { pressing = false; pointerIsDown = false; };
  let waiting: (() => void) | null = null;
  let scheduled = false;

  const run = (): void => {
    scheduled = false;
    waiting = null;
    tell();
  };

  const settle = (): void => {
    if (gone || waiting || scheduled || waymarkOpenIn(slot)) return;
    if (!pressing) { scheduled = true; setTimeout(run, 0); return; }
    pressing = false;
    let done = false;
    let guard = 0;
    const once = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('click', once, true);
      window.removeEventListener('pointercancel', once, true);
      clearTimeout(guard);
      scheduled = true;
      waiting = null;
      setTimeout(run, 0);
    };
    window.addEventListener('click', once, true);
    window.addEventListener('pointercancel', once, true);
    // A press that never becomes a click (a drag off, a lost pointer): run once the pointer is up
    // and a moment has passed, however long the press is held.
    const check = (): void => { if (pointerIsDown) guard = window.setTimeout(check, 250); else once(); };
    guard = window.setTimeout(check, 1000);
    waiting = once;
  };

  // While the toast shows, a press or a key outside the slot releases its hold: the person has moved on,
  // so the panel answers them at once (their press's click still lands first).
  let releasing = false;
  const onRelease = (e: Event): void => {
    if (gone || (e.target instanceof Node && slot.contains(e.target))) return;
    slot.setAttribute('data-released', '');
    stopRelease();
    if (e.type === 'pointerdown') { pressing = true; pointerIsDown = true; }
    settle();
  };
  const startRelease = (): void => {
    if (releasing) return;
    releasing = true;
    slot.removeAttribute('data-released');
    window.addEventListener('pointerdown', onRelease, true);
    window.addEventListener('keydown', onRelease, true);
  };
  const stopRelease = (): void => {
    if (!releasing) return;
    releasing = false;
    window.removeEventListener('pointerdown', onRelease, true);
    window.removeEventListener('keydown', onRelease, true);
  };

  // The fan-out's state is the mark's aria-expanded and the toast's hidden: watch both.
  const watch = new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target as HTMLElement;
      if (t.classList.contains('ow-waymark__mark') && r.attributeName === 'aria-expanded') {
        if (t.getAttribute('aria-expanded') === 'true') {
          pressing = false;
          window.addEventListener('pointerdown', onDown, true);
          window.addEventListener('pointerup', onUp, true);
          window.addEventListener('click', onClick, true);
          window.addEventListener('pointercancel', onCancel, true);
        } else settle();
      } else if (t.classList.contains('ow-waymark__toast') && r.attributeName === 'hidden') {
        if (!t.hidden) startRelease();
        else { stopRelease(); settle(); }
      }
    }
  });
  watch.observe(slot, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });

  return {
    el: slot,
    dispose(): void {
      if (gone) return;
      gone = true;
      watch.disconnect();
      stopRelease();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointercancel', onCancel, true);
      waiting?.();
      unmount?.();
      unmount = null;
    },
  };
}
