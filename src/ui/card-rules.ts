/**
 * The element card's view rules, as the parlor draws its card (the card's model is src/parlor/element-card.ts): pure
 * decisions the room view asks, so each has a unit test. What closes the card on Escape, where focus goes after a
 * redraw and after a close, how a long name fits the link picture, and the card's words.
 */

import type { CardMarks, CardModel } from '../parlor/element-card';
import { workHash } from '../parlor/address';

// ---------------------------------------------------------------- Escape

/**
 * Whether an Escape closes the open card. The room listens on the document, so a card opened by a press closes from the
 * opener too; it leaves alone a key that is composing text (an input method's own Escape), a key typed in a field
 * outside the card (the composer, a form: Escape stays that field's), a key something else already took
 * (`defaultPrevented`: a picture's viewer, a fan-out), and an open fan-out of the card's own mark.
 */
export function escapeClosesCard(
  key: { key: string; isComposing?: boolean; keyCode?: number; defaultPrevented: boolean },
  at: { inCard: boolean; editable: boolean },
  room: { cardOpen: boolean; viewerOpen: boolean; fanOutOpen: boolean },
): boolean {
  if (key.key !== 'Escape' || key.isComposing || key.keyCode === 229 || key.defaultPrevented) return false;
  if (!room.cardOpen || room.viewerOpen || room.fanOutOpen) return false;
  return !(at.editable && !at.inCard);
}

// ---------------------------------------------------------------- focus

/**
 * Whether a close moves focus (to the opener, else the room's fallback): only when focus was in the card or on its
 * opener. A card that closes because its element left on a feed tick, while someone types in the composer, leaves
 * focus where it is.
 */
export function closeMovesFocus(inCard: boolean, onOpener: boolean): boolean {
  return inCard || onOpener;
}

/**
 * Where focus goes after the card is rebuilt: back to the control with the same key, else to the card's heading when
 * focus was in the card (a control that went), else nowhere (focus was not the card's to move).
 */
export function focusAfterRedraw(was: string | null, keys: ReadonlySet<string>, inCard: boolean): string | 'heading' | null {
  if (!inCard) return null;
  return was && keys.has(was) ? was : 'heading';
}

/** Whether the words' fold stays open: across a redraw of the same element, never across a step to another. */
export function foldStays(open: boolean, shownId: string | null, nextId: string | null): boolean {
  return open && shownId !== null && shownId === nextId;
}

// ---------------------------------------------------------------- the link picture

// Bidi isolation for a name inside SVG text, where <bdi> cannot go: FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE.
const FSI = '\u2068';
const PDI = '\u2069';

/** A stranger's name isolated, so a right-to-left name never reorders the words around it. */
export function isolated(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/** A character's width in the picture's units: a wide one (CJK, a full-width form, most emoji) counts two. */
function width(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd) ? 2 : 1;
}

/**
 * A name fitted to `room` units of the picture: whole when it fits, else cut at a character (never inside a pair of
 * surrogates) and ended with an ellipsis. `cut` says it was cut, so the whole name goes to the node's accessible name
 * and its title.
 */
export function fitName(name: string, room: number): { text: string; cut: boolean } {
  const chars = Array.from(name);
  let used = 0;
  for (const ch of chars) used += width(ch);
  if (used <= room) return { text: name, cut: false };
  let out = '';
  used = 0;
  for (const ch of chars) {
    const w = width(ch);
    if (used + w > room - 1) break;
    out += ch;
    used += w;
  }
  return { text: `${out.trimEnd()}…`, cut: true };
}

/** The room a neighbour's name has in the picture, and a link's label, in width units. */
export const NAME_ROOM = 26;
export const LABEL_ROOM = 21;

// ---------------------------------------------------------------- words

export const MARK_WORDS = {
  knownOf: 'Known of: some of it is not shown to you',
  hidden: 'Hidden from others',
  proposed: 'Proposed, waits for review',
  trimmed: 'Some links may be left out for you',
} as const;

/** The marks line: one sentence per mark the element carries, in this order. */
export function markLines(m: CardModel['marks']): string[] {
  return (['knownOf', 'hidden', 'proposed', 'trimmed'] as const).filter(k => m[k]).map(k => MARK_WORDS[k]);
}

/** A neighbour's marks in a few words, said after its name. */
export function linkNote(m: CardMarks): string {
  return [m.knownOf ? 'known of' : '', m.hidden ? 'hidden from others' : '', m.proposed ? 'proposed' : ''].filter(Boolean).join(', ');
}

/** A group whose field keel trimmed for this reader says so after its name. */
export const GROUP_TRIMMED = 'some may be left out for you';

export const SHOW_ALL = 'Show all';
export const SHOW_LESS = 'Show less';

/** How many questions the card lists before it points at the Work tab. */
export const QUESTIONS_SHOWN = 5;

/**
 * The questions' words: the count at the card's foot, and a line under the list when the read is not whole. Pending,
 * failed and capped never read as "no open questions".
 */
export function questionWords(q: CardModel['questions']): { foot: string; note: string | null } {
  const n = q.items.length;
  const count = `${n} open question${n === 1 ? '' : 's'}`;
  if (q.state === 'pending') return { foot: 'Open questions: not read yet', note: null };
  if (q.state === 'failed') return { foot: 'Could not read the questions', note: null };
  if (q.state === 'capped') return { foot: count, note: `${n} found; the world has more work items than were read.` };
  return { foot: n ? count : 'No open questions', note: null };
}

/** The line under a long list of questions, past the ones shown. */
export function moreQuestions(n: number): string | null {
  return n > QUESTIONS_SHOWN ? `And ${n - QUESTIONS_SHOWN} more under Work.` : null;
}

/** Where a question goes: its work item's own address in this world (the Work tab, its card in view). */
export function questionHref(world: string, item: string): string {
  return workHash(world, item);
}

/** A link presses only where the reader has a card for it; anywhere else its name is plain text. */
export function linkPresses(id: string, cardable: (id: string) => boolean): boolean {
  return cardable(id);
}
