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

/** The minimal shape of `Intl.Segmenter` this file uses (the parlor's TypeScript lib predates its types). */
type Segmenter = new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> };
const SEGMENTER = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;

/**
 * A text's graphemes, what a reader sees as one character: an emoji sequence joined by ZWJ, a letter and its combining
 * marks. A cut is only ever made between two of them. Where the browser has no `Intl.Segmenter`, code points.
 */
export function graphemes(text: string): string[] {
  return SEGMENTER ? Array.from(new SEGMENTER(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment) : Array.from(text);
}

/** A grapheme's width in the picture's units, by its first code point: a wide one (CJK, a full-width form, most emoji) counts two. */
function width(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd) ? 2 : 1;
}

/**
 * A name fitted to `room` units of the picture: whole when it fits, else cut between two graphemes (never inside an
 * emoji sequence or a letter's marks) and ended with an ellipsis. `cut` says it was cut, so the whole name goes to the node's accessible name
 * and its title.
 */
export function fitName(name: string, room: number): { text: string; cut: boolean } {
  const chars = graphemes(name);
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

/** The room a neighbour's name has in the picture, and a link's label, in width units: a first guess before the drawn width. */
export const NAME_ROOM = 26;
export const LABEL_ROOM = 21;
/** The same rooms in the picture's own units (its 338-wide box): a name from x 165 to 334, a label from x 126 back to 2. */
export const NAME_PX = 169;
export const LABEL_PX = 124;

/**
 * A text fitted to `room` by its drawn width (`measure`, the browser's own length of a candidate as drawn): whole when it
 * fits, else the longest start, cut between two graphemes, that fits with an ellipsis after it. Letters differ in width (a row
 * of capitals is wider than its count says), so the count is only ever a first guess.
 */
export function fitToWidth(text: string, measure: (candidate: string) => number, room: number): { text: string; cut: boolean } {
  if (measure(text) <= room) return { text, cut: false };
  const chars = graphemes(text);
  const at = (k: number): string => `${chars.slice(0, k).join('').trimEnd()}…`;
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(at(mid)) <= room) lo = mid; else hi = mid - 1;
  }
  return { text: at(lo), cut: true };
}

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
