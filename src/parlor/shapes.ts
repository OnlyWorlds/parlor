/**
 * The parlor's shapes (design sheet §1, draft 5): what each room thing is as an
 * element, read out of a world's elements and written back. Pure: no network,
 * no DOM, so every rule here has a unit test.
 *
 *   a line      Narrative, supertype Message: narrator the poster's Character, parent_narrative the line it answers
 *   a spec      Construct, supertype Spec: its owner's own element; subtype its kind (Tool, Modelling,
 *               Feature, World); the winner is the sitting's x_star (sheet §6 point 13, draft 7)
 *   a heart     Relation,  supertype Heart: actor the hearter, constructs the spec; one per person per target
 *   a vote      Relation,  supertype Vote: actor the voter, constructs the picks in order
 *   a sitting   Event,     supertype Sitting: subtype the phase; the switches and x_star as x_ fields
 *   a board entry Narrative, supertype Board: subtype red, orange or green; characters whom it waits on
 *   a work item Relation,  supertype Work item: actor whom it is for, the elements it is about in the
 *               Relation's typed link fields, subtype open, taken or done (schema-dist profiles/packet.md)
 *   the charter Law,       supertype Charter
 *   a member    Character, supertype Member: a person's own name in the room when their seat has no
 *               Character (an invite link gives a person none, until keel's roster names them)
 *
 * Who made a thing is `created_by` (a membership id, null for the world's owner),
 * never a name in its text.
 *
 * The room mark (schema-dist profiles/room.md): every room element the parlor
 * makes carries `x_room_of` in its first write, and the room reads only room
 * elements (the pair and the mark), so a world's own lore Messages, Votes or
 * Sittings never show as the room. The charter is no room element: the charter
 * profile's own mark (`x_charter_of`) makes it the world's charter, and a keeper
 * may write that mark, never the room's.
 */

import {
  FIELD_SCHEMA, charterOf, handsOnAsProposed, isCharterElement, isRoomElement, proposedMarkOf, ROOM_PAIRS, readReportLine, readReportLines, readingAidOf, simpleCaseFold,
  designPartsOf, isOpenWork, reportTalksOf, talksOf, workOf, workStateOf, type OwLensReader, type OwWorkState,
} from '@onlyworlds/sdk';
import { byCodePoint, earlierFirst, isAfter, newestFirst, sameMoment } from './when.ts';
import { questionTargets } from './element-card.ts';

export interface El {
  id: string;
  type: string;
  name?: string;
  description?: string | null;
  supertype?: string | null;
  subtype?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  changed_by?: string | null;
  changed_via?: string | null;
  changed_client?: string | null;
  /** keel: true on a maker's own read of what a keeper hid. */
  hidden?: boolean;
  [k: string]: unknown;
}

/** Who: a membership id, or OWNER for the world's owner (created_by null). */
export const OWNER = 'owner';
export function whoMade(el: El): string {
  return typeof el.created_by === 'string' && el.created_by ? el.created_by : OWNER;
}

export const SUPERTYPE = {
  line: 'Message',
  board: 'Board',
  workItem: 'Work item',
  spec: 'Spec',
  heart: 'Heart',
  vote: 'Vote',
  sitting: 'Sitting',
  charter: 'Charter',
  /** A person's own Character, made on first entry when their seat has none. */
  member: 'Member',
  /** One member's take on a work item (the room profile's ninth pair, schema-dist serial 66). */
  take: 'Take',
  /** What a session or a closed talk leaves behind (the room profile's tenth pair; schema-dist profiles/report.md). */
  report: 'Report',
} as const;

/** The room profile's mark: the world's id for a world's parlor, the sitting's for a workshop. */
export const ROOM_MARK = 'x_room_of';
/** The room profile's second field, on a Take only: the work item's id (no Relation field links a Relation). */
export const ROOM_ITEM = 'x_room_item';

// The standard's fold: trim Unicode's White_Space set (JavaScript's trim() strips a byte order mark and keeps U+0085,
// so it is not that set), then simple case folding; nothing normalized.
const fold = (s: unknown): string => (typeof s === 'string' ? simpleCaseFold(s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')) : '');
/** A name folded by the standard's rule, for an order compared code point by code point (never a locale's collation). */
export const foldName = fold;

const ID_FORM = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/**
 * An id as a writer writes it into a world (the address profile's "The same id"): one in the form, in any case,
 * lowercase; any other text exactly as it came, never re-spelled into an id it was not. A reader never calls this:
 * inside a world two ids are the same only when written the same.
 */
export function writtenId(id: string): string {
  return typeof id === 'string' && ID_FORM.test(id) ? id.toLowerCase() : id;
}

/** The line a completion writes for a work item it set done: the item named in words, then its address. */
function doneLine(item: { id: string; title: string }): string {
  return `Set the work item ${item.title.replace(/\s+/g, ' ').trim() || 'Untitled'} to done: ow://relation/${writtenId(item.id)}`;
}

/** The pair alone, folded as the profile folds it: what the charter (lore) is read by. */
function isPair(el: El, type: string, supertype: string): boolean {
  return fold(el.type) === type && fold(el.supertype) === fold(supertype);
}

/**
 * The elements one room scope marked as its own: a sitting's id in a workshop, the world's id
 * before the first sitting. Specs, hearts and votes are a sitting's, read by this.
 */
export function ofRoom(els: Iterable<El>, roomOf: string): El[] {
  const out: El[] = [];
  for (const el of els) if (el[ROOM_MARK] === roomOf) out.push(el);
  return out;
}

/** A room element of this pair: the SDK's isRoomElement (pair and mark), and this shape's own pair. */
function isA(el: El, type: string, supertype: string): boolean {
  return isRoomElement(el as Parameters<typeof isRoomElement>[0]) && isPair(el, type, supertype);
}

function links(el: El, field: string): string[] {
  const v = el[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function link(el: El, field: string): string | null {
  const v = el[field];
  return typeof v === 'string' && v ? v : null;
}

function bool(el: El, field: string): boolean {
  const v = el[field];
  return v === true || v === 'true';
}

// ---------------------------------------------------------------- lines

export interface Line {
  id: string;
  text: string;
  by: string;
  narrator: string | null;
  parent: string | null;
  /** The work item a line answers: a Narrative cannot point at a Relation by parent_narrative, so `relations`. */
  about: string | null;
  /**
   * The ids of the Objects then the Constructs the line is a talk on (the room and report profiles, serial 135, read by
   * the SDK's `talksOf` for a line and `reportTalksOf` for a report: an empty or White_Space-only entry names nothing).
   * A design part among them is a talk on it (`designsOf`).
   */
  named: string[];
  /**
   * The Characters a Message is addressed to (its `characters`): a line written in a seat's room names that seat's
   * Character. Always empty on a report, whose `characters` says what it touched, never whom it speaks to.
   */
  to: string[];
  at: string;
  /** A report (the report profile's pair and the mark): its own parts; null for a Message. `text` is its story. */
  report: ReportPart | null;
  el: El;
}

export function readLines(els: Iterable<El>): Line[] {
  return orderLines(readLinesAsGiven(els));
}

/** Lines in the room's order: by instant, a tie by id. */
export function orderLines(lines: Line[]): Line[] {
  return lines.sort((a, b) => earlierFirst(a.at, b.at) || byCodePoint(a.id, b.id));
}

/** The room's lines as the iterable gives them, unordered: a caller that keeps a few orders only those. */
export function readLinesAsGiven(els: Iterable<El>): Line[] {
  const out: Line[] = [];
  for (const el of els) {
    const report = isA(el, 'narrative', SUPERTYPE.report);
    if (!report && !isA(el, 'narrative', SUPERTYPE.line)) continue;
    out.push({
      id: el.id,
      // A line's body is its `story` (the message profile); a line written before that kept it in
      // `description`, which keel serves beside an empty `story` (read on Parlor ground, 2026-11-11: 320 lines,
      // each `story: ""`). Both empty is an empty line (a line of files); neither served at all says its name.
      text: report ? str(el.story) : lineText(el),
      by: whoMade(el),
      narrator: link(el, 'narrator'),
      parent: link(el, 'parent_narrative'),
      about: links(el, 'relations')[0] ?? null,
      named: (report ? reportTalksOf(el) : talksOf(el)).map(t => t.id),
      to: report ? [] : links(el, 'characters'),
      at: el.created_at ?? '',
      report: report ? readReportPart(el) : null,
      el,
    });
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// ---------------------------------------------------------------- reports (schema-dist profiles/report.md)

/** The report profile's one key: the work items a report answers, each also in `relations`. */
export const REPORT_ANSWERS = 'x_report_answers';
/** Step 1's word and step 2's, as the profile writes them. */
export const REPORT_HANDED_IN = 'handed in';
export const REPORT_COMPLETED = 'completed';

export interface ReportPart {
  title: string;
  /** The two words folded; any other word is `other`, shown as written (rule 7). */
  state: 'handed in' | 'completed' | 'other';
  /** The subtype as written, for `other`. */
  word: string;
  /** The keeper's short human part (step 2); may already be there on a handed-in report. */
  description: string;
  /** What changed, one entry per line as the report profile splits a text (rule 10: every CR and LF a break, each trimmed, an empty one none; rule 8: a line may have no address). */
  consequences: string[];
  /** The ids in `x_report_answers`, non-empty strings, first place; the room keeps the work items it holds (rule 5). */
  answers: string[];
  /**
   * An AI's report written under the review hold (the review profile's rule 1: an object mark is proposed): not part of
   * the world, nor are the changes it names, until a keeper accepts it; the report page promises nothing of its settling.
   */
  proposed: boolean;
}

function readReportPart(el: El): ReportPart {
  const word = str(el.subtype).trim();
  const folded = fold(el.subtype);
  // Rule 5: the ids in the key, and only those; one missing from `relations` is a lint's to report, never dropped here.
  const answers: string[] = [];
  const key = el[REPORT_ANSWERS];
  if (Array.isArray(key)) {
    for (const id of key) if (typeof id === 'string' && id.trim() && !answers.includes(id)) answers.push(id);
  }
  return {
    title: str(el.name),
    state: folded === REPORT_HANDED_IN ? 'handed in' : folded === REPORT_COMPLETED ? 'completed' : 'other',
    word,
    description: str(el.description),
    consequences: readReportLines(str(el.consequences)).map(r => r.line),
    answers,
    proposed: proposedMarkOf(el) !== null,
  };
}

/**
 * A line of `consequences` as the room shows it (the report profile's rule 10, schema-dist v0.34.1-dist.129, read by
 * the SDK's `readReportLine`): the words a reader shows, and the address of the element it names in this world,
 * written `ow://<type>/<id>`, or null. The address leaves the words only where nothing the writer wrote is lost;
 * otherwise the whole line stays, still naming its element. An address of another world, a slug or a world alone is
 * prose.
 */
export function consequenceLine(line: string, world: string): { words: string; address: string | null } {
  const { words, address } = readReportLine(line, { world });
  return { words, address };
}

/** A handed-in report's opening in the room: its first three lines, at most 280 characters; `cut` when more remain. */
export function storyStart(story: string): { text: string; cut: boolean } {
  const ls = story.split(/\r?\n/);
  let text = ls.slice(0, 3).join('\n');
  let cut = ls.length > 3;
  if (text.length > 280) { text = text.slice(0, 279).trimEnd() + '…'; cut = true; }
  return { text, cut };
}

/** Where a free report was said, by its sitting's name: a name that already opens with the word (the parlor's own
 * "Sitting, November 16") is not given it twice. */
export function saidIn(sittingName: string): string {
  return /^sitting\b/i.test(sittingName) ? `said in ${sittingName}` : `said in the sitting ${sittingName}`;
}

/** The sender's own day, as the report's name carries it. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "A short title: what the session was, and its day": the text's first line, cut, then the day. */
export function reportName(text: string, day: string): string {
  const first = text.split(/\r?\n/).find(s => s.trim()) ?? '';
  // Cut by code points, so a name never ends in half an emoji.
  // The line's own closing stop or colon would sit before the day's comma ("Checked it., 2026-11-10").
  const one = Array.from(first.replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?]+$/, ''));
  return `${one.length <= 48 ? one.join('') : one.slice(0, 47).join('').trimEnd() + '…'}, ${day}`;
}

/**
 * The Narrative's multi-link field for each type it can link, read from the SDK's schema (never a copied list).
 * A Map, Pin or Marker has none, and another Narrative only `parent_narrative`: the report profile names those by
 * address in a line instead.
 */
export const NARRATIVE_LINKS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FIELD_SCHEMA.narrative as Record<string, { type: string; target?: string }>)
    .filter(([, f]) => f.type === 'multi_link' && typeof f.target === 'string')
    .map(([field, f]) => [f.target as string, field]),
);

/** What a keeper may pick as what a report touched: the world's own elements of a type the Narrative links, never a room element, a hidden one, a stub or a reading aid. */
export function isReportPickable(el: El): boolean {
  return !!NARRATIVE_LINKS[fold(el.type)] && !isRoomElement(el as Parameters<typeof isRoomElement>[0]) && !isCharterElement(el)
    && el.hidden !== true && el.known_of !== true;
}

/** The profile's words for a keeper's report that changed nothing. */
export const NOTHING_CHANGED = 'nothing changed';

/** The keeper's part of a report born completed (the report profile, "The keeper's own session"). */
export interface KeeperPart {
  /** The short human part, as typed. */
  description: string;
  /** What changed, as typed: one change per line. */
  changes: string;
  /** What it touched, each linked in the Narrative's field for its type. */
  touched: ReadonlyArray<{ type: string; id: string }>;
  /** The work item this report sets done, by its title, when it does: said as a line of what changed. */
  done?: { id: string; title: string } | null;
}

/**
 * A work item's own state lets a keeper's report set it done: open work (the packet profile's rule 5, serial 136: open
 * or taken, read by the SDK's `isOpenWork`; a standing item and one with no state never), and not proposed, read as the
 * element card and the Work tab read it (the SDK's `handsOnAsProposed`: a review mark that cannot be read is proposed).
 */
export function maySetDone(el: El): boolean {
  return isOpenWork(el) && !handsOnAsProposed(el);
}

/**
 * How a keeper's report says a work item it answers stands, beside the item's name: only open work that is not proposed
 * is set done; a proposed item (a doubt among them, as `maySetDone` reads it) is left open.
 */
export function answeredWord(el: El): string {
  const state = workStateOf(el);
  if (state === 'done') return 'done already';
  if (maySetDone(el)) return state ?? 'open';
  if (isOpenWork(el) && handsOnAsProposed(el)) return 'proposed: left open';
  return state === 'standing' ? 'standing: left as it is' : state === null ? 'no state: left as it is' : 'left as it is';
}

/**
 * A report. Step 1, handing in: one Narrative with the pair, the mark, `handed in`, the text whole as `story` and
 * the seat's own Character as `narrator`. On a board entry it hangs by `parent_narrative`; on a work item by
 * `relations`, and answers it (`x_report_answers`) only when `answers` says so. Never an empty answers list.
 * On neither, it hangs on the sitting it was said in, by `events`, when the room has one.
 *
 * With a keeper's part it is the keeper's own report: the same body, born `completed` in one write with its
 * `description`, its `consequences` (each typed line trimmed, then the item it set done, or `nothing changed`) and
 * the elements it touched in their typed links.
 */
export function newReport(
  text: string, narrator: string, roomOf: string, day: string,
  on: { parent?: string | null; item?: string | null; answers?: boolean; sitting?: string | null; part?: Anchor | null } = {},
  keeper: KeeperPart | null = null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: reportName(text, day),
    story: text,
    supertype: SUPERTYPE.report,
    subtype: keeper ? REPORT_COMPLETED : REPORT_HANDED_IN,
    narrator,
    [ROOM_MARK]: roomOf,
  };
  if (on.parent) body.parent_narrative = on.parent;
  if (on.item) {
    body.relations = [on.item];
    if (on.answers) body[REPORT_ANSWERS] = [on.item];
  }
  // A talk on an Object or a Construct (the report profile's fourth anchor, ruled 2026-11-18): the part in its
  // own field by its type, written before the keeper's touched picks, which merge with it.
  const part = on.part && (on.part.link === 'objects' || on.part.link === 'constructs') ? on.part : null;
  if (part) body[part.link] = [part.id];
  // Free talk (the report profile's closed talk, its third anchor): no board entry, work item or part under it, so it
  // hangs on the sitting it was said in, linked in `events`. A keeper's touched Events join after it, never in place of it.
  if (on.sitting && !on.parent && !on.item && !part) body.events = [on.sitting];
  if (keeper) {
    body.description = keeper.description;
    const lines = keeper.changes.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (keeper.done) lines.push(doneLine(keeper.done));
    body.consequences = lines.length ? lines.join('\n') : NOTHING_CHANGED;
    for (const t of keeper.touched) {
      const field = NARRATIVE_LINKS[fold(t.type)];
      if (!field) continue;
      const had = (body[field] as string[] | undefined) ?? [];
      if (!had.includes(t.id)) body[field] = [...had, t.id];
    }
  }
  return body;
}

/** A line's words: its story, else its description (lines before 2026-11-11), else empty; its name only when neither is served. */
function lineText(el: El): string {
  const story = str(el.story);
  if (story) return story;
  const description = str(el.description);
  if (description) return description;
  return typeof el.story === 'string' || typeof el.description === 'string' ? '' : str(el.name);
}

/** A Narrative's name is required: the line's first words, the whole line in the story. */
export function lineName(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= 60 ? one : one.slice(0, 59).trimEnd() + '…';
}

/**
 * What a line answers, as the one link field it writes: a board entry by `parent_narrative`, a work item by
 * `relations` (a Narrative links a Relation there), a design part by `objects` or `constructs`, by the part's own
 * type. One field, one id: a line never answers in two places.
 */
export type AnchorLink = 'parent_narrative' | 'relations' | 'objects' | 'constructs';
export interface Anchor { link: AnchorLink; id: string }

/**
 * A new line's body: the text, the narrator, the room's mark and, when it answers something, its one anchor. `to`: the
 * Character a line written in a seat's room is addressed to, in `characters`; a line in the team chat names no one.
 */
export function newLineAt(text: string, narrator: string | null, anchor: Anchor | null, roomOf: string, nameIfNoText = '', to: string | null = null): Record<string, unknown> {
  const body = newLine(text, narrator, null, roomOf, null, nameIfNoText);
  if (anchor) body[anchor.link] = anchor.link === 'parent_narrative' ? anchor.id : [anchor.id];
  if (to) body.characters = [to];
  return body;
}

export function newLine(text: string, narrator: string | null, parent: string | null, roomOf: string, about: string | null = null, nameIfNoText = ''): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // A line of files with no words is named by its files (its story stays empty).
    name: lineName(text.trim() ? text : nameIfNoText),
    // The message profile: `story` is the body, verbatim (lines before 2026-11-11 kept it in `description`).
    story: text,
    supertype: SUPERTYPE.line,
    [ROOM_MARK]: roomOf,
  };
  if (narrator) body.narrator = narrator;
  if (parent) body.parent_narrative = parent;
  if (about) body.relations = [about];
  return body;
}

// ---------------------------------------------------------------- specs and hearts

export interface Spec {
  id: string;
  title: string;
  text: string;
  by: string;
  /** Tool, Modelling, Feature or World; null for none (February's specs). */
  kind: Kind | null;
  star: boolean;
  hearts: number;
  at: string;
}

export interface Heart {
  id: string;
  by: string;
  target: string;
}

export function readHearts(els: Iterable<El>): Heart[] {
  const out: Heart[] = [];
  for (const el of els) {
    if (!isA(el, 'relation', SUPERTYPE.heart)) continue;
    const target = links(el, 'constructs')[0];
    if (target) out.push({ id: el.id, by: whoMade(el), target });
  }
  return out;
}

/** Hearts per target, one per person per target however many rows a race left. */
export function heartCounts(hearts: readonly Heart[]): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const h of hearts) {
    const key = `${h.by}\u0000${h.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(h.target, (counts.get(h.target) ?? 0) + 1);
  }
  return counts;
}

/** My hearts on a target (more than one only after a race: a toggle off removes them all). */
export function myHearts(hearts: readonly Heart[], me: string, target: string): Heart[] {
  return hearts.filter(h => h.by === me && h.target === target);
}

/** What a spec is (sheet §6 point 13): its subtype, which never changes with the vote. */
export const KINDS = ['Tool', 'Modelling', 'Feature', 'World'] as const;
export type Kind = (typeof KINDS)[number];

export function kindOf(subtype: unknown): Kind | null {
  const word = fold(subtype);
  return KINDS.find(k => fold(k) === word) ?? null;
}

/**
 * Builds up to 2026-10-25 marked the winner as the spec's subtype star. A sitting made before
 * 2026-10-26 (this constant) that names no `x_star` reads that old mark; a later one never does, so a member
 * cannot crown their own spec by setting its subtype. Only the team's test worlds
 * ever ran those builds.
 */
export const OLD_STAR_BEFORE = '2026-10-26T00:00:00Z';

/** What a sitting says its winner is, for readSpecs: its x_star, else 'subtype' for an old sitting, else none. */
export function starOf(sitting: { star: string | null; at: string } | null): string | null {
  if (!sitting) return null;
  if (sitting.star) return sitting.star;
  return isAfter(OLD_STAR_BEFORE, sitting.at) ? OLD_STAR : null;
}
export const OLD_STAR = 'subtype';

/**
 * The sitting's specs. The star is the sitting's `x_star` (pass starOf(sitting)); OLD_STAR reads
 * the old subtype star, never rewritten; null means no winner yet.
 */
export function readSpecs(els: Iterable<El>, hearts: readonly Heart[], star: string | null = null): Spec[] {
  const counts = heartCounts(hearts);
  const out: Spec[] = [];
  for (const el of els) {
    if (!isA(el, 'construct', SUPERTYPE.spec)) continue;
    out.push({
      id: el.id,
      title: (el.name ?? '').toString(),
      text: (el.description ?? '').toString(),
      by: whoMade(el),
      kind: kindOf(el.subtype),
      star: star === OLD_STAR ? fold(el.subtype) === 'star' : !!star && el.id === star,
      hearts: counts.get(el.id) ?? 0,
      at: el.created_at ?? '',
    });
  }
  return out.sort((a, b) => Number(b.star) - Number(a.star) || b.hearts - a.hearts || earlierFirst(a.at, b.at));
}

export function newSpec(title: string, text: string, kind: Kind, roomOf: string): Record<string, unknown> {
  return { name: title.trim(), description: text, supertype: SUPERTYPE.spec, subtype: kind, [ROOM_MARK]: roomOf };
}

export function newHeart(target: string, targetName: string, actor: string | null, roomOf: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: `Heart for ${targetName}`.slice(0, 200),
    supertype: SUPERTYPE.heart,
    constructs: [target],
    [ROOM_MARK]: roomOf,
  };
  if (actor) body.actor = actor;
  return body;
}

// ---------------------------------------------------------------- votes

export interface Vote {
  id: string;
  by: string;
  picks: string[];
  at: string;
}

export function readVotes(els: Iterable<El>): Vote[] {
  const out: Vote[] = [];
  for (const el of els) {
    if (!isA(el, 'relation', SUPERTYPE.vote)) continue;
    out.push({ id: el.id, by: whoMade(el), picks: links(el, 'constructs').slice(0, 3), at: el.updated_at ?? el.created_at ?? '' });
  }
  return out;
}

/** Each voter's newest vote counts; a top three scores 3, 2, 1 (sheet §6 point 2, the lean). */
export function tally(votes: readonly Vote[]): Map<string, number> {
  const newest = new Map<string, Vote>();
  for (const v of votes) {
    const had = newest.get(v.by);
    if (!had || newestFirst(v.at, had.at) < 0) newest.set(v.by, v);
  }
  const score = new Map<string, number>();
  for (const v of newest.values()) {
    const picks = [...new Set(v.picks)];
    picks.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + (3 - i)));
  }
  return score;
}

export function newVote(picks: readonly string[], actor: string | null, roomOf: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: 'Vote',
    supertype: SUPERTYPE.vote,
    constructs: [...new Set(picks)].slice(0, 3),
    [ROOM_MARK]: roomOf,
  };
  if (actor) body.actor = actor;
  return body;
}

// ---------------------------------------------------------------- the sitting and its phases

export interface Switches {
  hearts: boolean;
  specs: boolean;
  voting: boolean;
}

export interface Sitting extends Switches {
  id: string;
  phase: string;
  /** The winning spec's id (x_star), or null before the host picks one. */
  star: string | null;
  feedStart: number | null;
  at: string;
  by: string;
}

/**
 * The six, named by what a member does there, each a set of switches, never a position in a
 * list (sheet §2 and §6 point 10: Titus folded February's Parsing into Pitch, and the names were
 * set, on 2026-10-22).
 */
export const PHASES: ReadonlyArray<{ name: string } & Switches> = [
  { name: 'Arrive', hearts: false, specs: false, voting: false },
  { name: 'Welcome', hearts: false, specs: false, voting: false },
  { name: 'Pitch', hearts: true, specs: true, voting: false },
  { name: 'Vote', hearts: true, specs: true, voting: true },
  { name: 'Build', hearts: true, specs: true, voting: false },
  { name: 'Show', hearts: true, specs: true, voting: false },
];

/** February's names, read as today's: a sitting is never rewritten for it. */
const OLD_PHASES: Readonly<Record<string, string>> = {
  lobby: 'Arrive', parsing: 'Pitch', design: 'Pitch', voting: 'Vote', showcase: 'Show',
};

/** A sitting's phase by its subtype: today's name, February's read as today's, none as Arrive. */
export function phaseOf(subtype: unknown): string {
  const word = typeof subtype === 'string' ? subtype.trim() : '';
  if (!word) return PHASES[0].name;
  return PHASES.find(p => p.name.toLowerCase() === word.toLowerCase())?.name ?? OLD_PHASES[word.toLowerCase()] ?? word;
}

export const SWITCH_FIELDS = { hearts: 'x_hearts_on', specs: 'x_specs_shown', voting: 'x_voting_open' } as const;
export const FEED_START_FIELD = 'x_feed_start';
export const STAR_FIELD = 'x_star';

/** All sittings, oldest first; the room shows the newest. */
export function readSittings(els: Iterable<El>): Sitting[] {
  const out: Sitting[] = [];
  for (const el of els) {
    if (!isA(el, 'event', SUPERTYPE.sitting)) continue;
    const start = el[FEED_START_FIELD];
    out.push({
      id: el.id,
      phase: phaseOf(el.subtype),
      star: link(el, STAR_FIELD),
      hearts: bool(el, SWITCH_FIELDS.hearts),
      specs: bool(el, SWITCH_FIELDS.specs),
      voting: bool(el, SWITCH_FIELDS.voting),
      feedStart: typeof start === 'number' ? start : Number.isFinite(Number(start)) && start !== null && start !== '' ? Number(start) : null,
      at: el.created_at ?? '',
      by: whoMade(el),
    });
  }
  return out.sort((a, b) => earlierFirst(a.at, b.at) || byCodePoint(a.id, b.id));
}

/** A sitting belongs to the workshop's world: its mark is the world's id. */
export function newSitting(name: string, feedStart: number, worldId: string): Record<string, unknown> {
  const lobby = PHASES[0];
  return {
    name,
    supertype: SUPERTYPE.sitting,
    [ROOM_MARK]: worldId,
    subtype: lobby.name,
    [SWITCH_FIELDS.hearts]: lobby.hearts,
    [SWITCH_FIELDS.specs]: lobby.specs,
    [SWITCH_FIELDS.voting]: lobby.voting,
    [FEED_START_FIELD]: feedStart,
  };
}

/** The patch that moves a sitting to a phase: its name and its switches together. */
export function phasePatch(phase: string): Record<string, unknown> {
  const p = PHASES.find(x => x.name === phase);
  if (!p) throw new Error(`unknown phase ${phase}`);
  return {
    subtype: p.name,
    [SWITCH_FIELDS.hearts]: p.hearts,
    [SWITCH_FIELDS.specs]: p.specs,
    [SWITCH_FIELDS.voting]: p.voting,
  };
}

export function switchPatch(which: keyof Switches, on: boolean): Record<string, unknown> {
  return { [SWITCH_FIELDS[which]]: on };
}

/** The winner is a fact about the sitting: one patch on it, never a write to a spec. */
export function starPatch(specId: string): Record<string, unknown> {
  return { [STAR_FIELD]: specId };
}

/**
 * A watcher's lines: keel serves a guest the room's lines (mail to everyone) but no sitting, while each
 * line still carries its room mark. So the lines are grouped by the mark, and the group holding the
 * newest line is the current sitting's. Where no line names a mark other than the world's (a room with
 * no sittings), every line.
 */
export function linesOfUnseenSitting(lines: readonly Line[], worldId: string): Line[] {
  const markOf = (l: Line): string | null => {
    const m = l.el[ROOM_MARK];
    return typeof m === 'string' && m !== worldId ? m : null;
  };
  let newest: Line | null = null;
  for (const l of lines) {
    if (markOf(l) === null) continue;
    if (!newest || (newestFirst(l.at, newest.at) || byCodePoint(newest.id, l.id)) < 0) newest = l;
  }
  if (!newest) return [...lines];
  const mark = markOf(newest);
  return lines.filter(l => markOf(l) === mark);
}

/** Lines of one sitting: made at or after its start and before the next one's. */
export function linesOfSitting(lines: readonly Line[], sittings: readonly Sitting[], sittingId: string | null): Line[] {
  if (!sittingId) return [...lines];
  const i = sittings.findIndex(s => s.id === sittingId);
  if (i < 0) return [...lines];
  const from = sittings[i].at;
  const to = sittings[i + 1]?.at ?? null;
  // The mark decides where a line was said (the room profile): a line marked with one of
  // these sittings is that sitting's, whatever its time. Time places only a line with no sitting's mark (an older
  // writer's world mark, or a sitting this room does not hold).
  const ids = new Set(sittings.map(s => s.id));
  return lines.filter(l => {
    const mark = l.el[ROOM_MARK];
    if (typeof mark === 'string' && ids.has(mark)) return mark === sittingId;
    // An unreadable time comes after every readable one (the message profile): such a line is in the last sitting.
    return earlierFirst(l.at, from) >= 0 && (to === null || earlierFirst(l.at, to) < 0);
  });
}

// ---------------------------------------------------------------- the board

/** The sheet's three, in the order the board shows them. */
export const BOARD_COLOURS = ['red', 'orange', 'green'] as const;
export type BoardColour = (typeof BOARD_COLOURS)[number];

export interface BoardEntry {
  id: string;
  title: string;
  text: string;
  colour: BoardColour | null;
  /** The Character it waits on; null for anyone. */
  waitsOn: string | null;
  by: string;
  at: string;
  el: El;
}

/** Every room board entry in the world, whatever sitting it was raised in: red, orange, green, newest first. */
export function readBoard(els: Iterable<El>): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const el of els) {
    if (!isA(el, 'narrative', SUPERTYPE.board)) continue;
    const word = fold(el.subtype);
    out.push({
      id: el.id,
      title: (el.name ?? '').toString(),
      text: (el.description ?? '').toString(),
      colour: BOARD_COLOURS.find(c => c === word) ?? null,
      waitsOn: links(el, 'characters')[0] ?? null,
      by: whoMade(el),
      at: el.created_at ?? '',
      el,
    });
  }
  const rank = (c: BoardColour | null) => (c ? BOARD_COLOURS.indexOf(c) : BOARD_COLOURS.length);
  return out.sort((a, b) => rank(a.colour) - rank(b.colour) || newestFirst(a.at, b.at) || byCodePoint(a.id, b.id));
}

export function newBoardEntry(
  title: string, text: string, colour: BoardColour, waitsOn: string | null, narrator: string | null, roomOf: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: title.trim().slice(0, 200),
    description: text,
    supertype: SUPERTYPE.board,
    subtype: colour,
    characters: waitsOn ? [waitsOn] : [],
    [ROOM_MARK]: roomOf,
  };
  if (narrator) body.narrator = narrator;
  return body;
}

// ---------------------------------------------------------------- work items

/**
 * The Relation's link field for each type it can point at (keel schema/relation.yaml). Law, Map,
 * Pin, Marker and Relation have none, so a work item made here cannot be about them.
 */
export const LINK_FIELDS: Readonly<Record<string, string>> = {
  character: 'characters', object: 'objects', location: 'locations', species: 'species', creature: 'creatures',
  institution: 'institutions', trait: 'traits', collective: 'collectives', zone: 'zones', ability: 'abilities',
  phenomenon: 'phenomena', language: 'languages', family: 'families', title: 'titles', construct: 'constructs',
  narrative: 'narratives', event: 'events',
};

/**
 * A work item's state (the packet profile's rule 5, serial 136), read by the SDK's `workStateOf`: open, taken, done or
 * standing, or null for no state (any other word, an empty or absent subtype included).
 */
export type WorkState = OwWorkState | null;

export interface WorkElement {
  type: string;
  id: string;
  /** A packet's one sentence on why (x_packet_elements); null for a typed link. */
  reason: string | null;
  /** In this world: false for a packet's entry when the packet is about another world (read there, never here). */
  here: boolean;
}

export interface WorkItem {
  id: string;
  title: string;
  text: string;
  state: WorkState;
  /** The Character it is for; null when it names no one. */
  forWho: string | null;
  /** The Titles it is for (`x_packet_for`): whoever holds one. Only ids that are Titles of this world, in their
   *  first place; an empty list reads as absent. Neither this nor `forWho`: addressed to no one. */
  forTitles: string[];
  by: string;
  at: string;
  /** What it is about, by the element card's one rule (`questionTargets`): the packet's entries, then its other typed links. */
  elements: WorkElement[];
  /**
   * An agent's write waiting for review (schema-dist profiles/review.md: x_review_proposed set), read as the element
   * card reads it (the SDK's `handsOnAsProposed`): a mark that cannot be read (a doubt) counts as proposed too.
   */
  proposed: boolean;
  /** The proposed mark is there and cannot be read (a doubt): said beside its Proposed chip. */
  doubt: boolean;
  /** The live takes on it, first taken first (who by `created_by`, never `actor`); always empty when it is no open work. */
  takes: Take[];
  /**
   * The Character who asked for it (`x_packet_from`, the packet profile's rule 8, read by the SDK's `workOf`, as `askerOf` reads it): a
   * Character this reader is served, written exactly so; null when it names none. Never the maker, never `actor`.
   */
  askedBy: string | null;
  el: El;
}

export interface Take {
  id: string;
  by: string;
  at: string;
}

/**
 * The room's takes by the item they are on: room Takes only (pair and mark), each naming its item by
 * `x_room_item`, and only those whose maker `live` counts (a removed seat's take is no take).
 */
export function readTakes(els: Iterable<El>, live: (by: string) => boolean = () => true): Map<string, Take[]> {
  const out = new Map<string, Take[]>();
  for (const el of els) {
    if (!isA(el, 'relation', SUPERTYPE.take)) continue;
    const item = link(el, ROOM_ITEM);
    const by = whoMade(el);
    if (!item || !live(by)) continue;
    const list = out.get(item) ?? [];
    list.push({ id: el.id, by, at: el.created_at ?? '' });
    out.set(item, list);
  }
  for (const list of out.values()) list.sort((a, b) => earlierFirst(a.at, b.at) || byCodePoint(a.id, b.id));
  return out;
}

/**
 * The takes on an item a person may delete, by id: their own (Release, contract T5), or every one
 * for a host deleting the item (T6). Read roster-blind, so a double take is found whole.
 */
export function deletableTakes(els: Iterable<El>, itemId: string, me: string, isHost = false): string[] {
  return (readTakes(els).get(itemId) ?? []).filter(t => isHost || t.by === me).map(t => t.id);
}

/**
 * My take on a work item: the taker's own Relation, in the item's own scope; the item is never edited by it.
 * The scope is the item's mark copied as a writer writes an id (`writtenId`): a mark in the form in another case
 * is not carried on into the Take.
 */
export function newTake(item: { id: string; title: string; roomOf: string }, character: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: `Take: ${item.title}`.slice(0, 200),
    supertype: SUPERTYPE.take,
    subtype: 'taken',
    [ROOM_MARK]: writtenId(item.roomOf),
    [ROOM_ITEM]: item.id,
  };
  if (character) body.actor = character;
  return body;
}

/**
 * The Titles a work item is for (the packet profile's `x_packet_for`, ruled 2026-11-10): ids of Titles in the world the
 * item sits in, never the packet's source world. An id that is no Title here, a non-string or an empty string is left
 * out (a lint's to report, never guessed at); a repeat keeps its first place. Not a link: nothing follows it.
 */
export function forTitlesOf(el: El, titles: ReadonlySet<string>): string[] {
  const v = el.x_packet_for;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const id of v) if (typeof id === 'string' && id && titles.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Whom a work item is for, as a seat sees it (the packet profile's reading): `mine` when `actor` is my Character or a Title
 * in `x_packet_for` names my Character among its `holders` (the reading keel uses for a Title's default lenses);
 * `others` when it names someone and not me; `none` when it names no one, shown apart, never as for every role.
 */
export function addressOf(w: Pick<WorkItem, 'forWho' | 'forTitles'>, me: string | null, els: ReadonlyMap<string, El>): 'mine' | 'others' | 'none' {
  if (!w.forWho && !w.forTitles.length) return 'none';
  if (me && w.forWho === me) return 'mine';
  if (me && w.forTitles.some(t => { const title = els.get(t); return !!title && links(title, 'holders').includes(me); })) return 'mine';
  return 'others';
}

/**
 * The world a work item's asker is read in (the packet profile's rule 8, the SDK's `workOf` and `askerOf`): the ids of
 * the Characters this reader is served, and of every other element it is served, each as written; and the ids of its
 * Titles (for `x_packet_for`). One pass, each type folded once.
 */
function workWorld(all: readonly El[]): { characters: string[]; others: string[]; titles: Set<string> } {
  const characters: string[] = [];
  const others: string[] = [];
  const titles = new Set<string>();
  for (const el of all) {
    const type = fold(el.type);
    if (type === 'character') characters.push(el.id);
    else {
      others.push(el.id);
      if (type === 'title') titles.add(el.id);
    }
  }
  return { characters, others, titles };
}

/** A key of one of workOf's maps, its own property (never one inherited from Object). */
const has = (map: object, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

/** The Work tab's order by state: open work first, then standing, then no state, then done. */
const STATE_RANK = (s: WorkState): number => (s === 'open' || s === 'taken' ? 0 : s === 'standing' ? 1 : s === null ? 2 : 3);

/**
 * Every room work item in the world, whatever sitting made it, whatever its state (the packet profile's rule 5: every
 * work item is shown): open work first, then standing, then no state, then done, newest first within.
 *
 * The state is the SDK's `workStateOf`. A live take is the room's own overlay, and only on open work (contract K2):
 * an open item with a take reads taken; a take on a standing, done or stateless item changes nothing and is not kept.
 * The elements are the element card's rule (`questionTargets`): the packet's entries in `x_packet_elements`' order with
 * each reason (another world's, when its source names one, marked so), then the Relation's typed links it does not name.
 */
export function readWork(els: Iterable<El>, worldId: string, live: (by: string) => boolean = () => true): WorkItem[] {
  const all = [...els];
  const takes = readTakes(all, live);
  const items = all.filter(el => isA(el, 'relation', SUPERTYPE.workItem));
  const { characters, others, titles } = workWorld(all);
  const packets = workOf(items, { characters, others });
  const out: WorkItem[] = [];
  for (const el of items) {
    const own = workStateOf(el);
    const taken = isOpenWork(el) ? takes.get(el.id) ?? [] : [];
    // The element card's rule, so a card's questions and this list say one thing about what an item is about.
    const elements: WorkElement[] = questionTargets(el, worldId).map(e => ({ type: fold(e.type), id: e.id, reason: e.reason, here: e.here }));
    const proposed = handsOnAsProposed(el);
    out.push({
      id: el.id,
      title: (el.name ?? '').toString(),
      text: (el.description ?? '').toString(),
      state: own === 'open' && taken.length ? 'taken' : own,
      forWho: link(el, 'actor'),
      forTitles: forTitlesOf(el, titles),
      by: whoMade(el),
      at: el.created_at ?? '',
      elements,
      // The review profile's marks (rules 1 and 4): an object mark is proposed; an empty mark is settled; any other
      // value is a doubt, read as proposed here as the element card and the SDK's graph read it, and said as a doubt.
      proposed,
      doubt: proposed && proposedMarkOf(el) === null,
      takes: taken,
      // workOf's own asker per item (askerOf's reading, read once for every item: askerOf alone builds the world's set
      // of Characters on each call, which made this read cost items times Characters).
      askedBy: has(packets.askers, el.id) ? packets.askers[el.id] : null,
      el,
    });
  }
  return out.sort((a, b) => STATE_RANK(a.state) - STATE_RANK(b.state) || newestFirst(a.at, b.at) || byCodePoint(a.id, b.id));
}

/** A work item's chip, by its state: each of the four words, and no state its own. Its class is `s-<key>`. */
export const WORK_STATE_WORD = { open: 'Open', taken: 'Taken', done: 'Done', standing: 'Standing', none: 'No state' } as const;
export function workStateKey(s: WorkState): keyof typeof WORK_STATE_WORD {
  return s ?? 'none';
}

/** The line a work item that is no open work and not done says under its title (contract K5 and R13); null for the rest. */
export function workStateLine(s: WorkState): string | null {
  if (s === 'standing') return 'A standing list: never done.';
  if (s === null) return 'No state set, so this is not open work.';
  return null;
}

/**
 * What the Work tab offers on an item by its state (the packet profile's rule 5; contract K4 and R7): Take or Release
 * and Mark done only on open work, Reopen only on a done item; a standing or stateless item carries none of them.
 * Who may press each (a writer, the maker or a host) is the room's to add.
 */
export function workOffers(w: Pick<WorkItem, 'state' | 'el'>): { take: boolean; markDone: boolean; reopen: boolean } {
  const open = isOpenWork(w.el);
  return { take: open, markDone: open, reopen: w.state === 'done' };
}

/**
 * A new work item: the picked elements in their typed link fields (a type with no field is left out), subtype open,
 * and who asked (`x_packet_from`, the packet profile's rule 8): the filer's own Character when it plays one; with none,
 * the key is left out, never an empty string.
 */
export function newWorkItem(
  title: string, text: string, forWho: string | null, picks: ReadonlyArray<{ type: string; id: string }>, roomOf: string,
  askedBy: string | null = null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: title.trim().slice(0, 200),
    description: text,
    supertype: SUPERTYPE.workItem,
    subtype: 'open',
    [ROOM_MARK]: roomOf,
  };
  if (forWho) body.actor = forWho;
  if (typeof askedBy === 'string' && fold(askedBy) !== '') body.x_packet_from = askedBy;
  for (const p of picks) {
    const field = LINK_FIELDS[p.type];
    if (!field) continue;
    const had = (body[field] as string[] | undefined) ?? [];
    if (!had.includes(p.id)) body[field] = [...had, p.id];
  }
  return body;
}

// ---------------------------------------------------------------- design parts

/** A part's design state, as the charter pack writes it in `subtype`, compared trimmed and folded as the room profile folds a pair (ruled 2026-11-18). */
export const DESIGN_STATES = ['in design', 'locked'] as const;
export type DesignState = (typeof DESIGN_STATES)[number];

export interface DesignPart {
  id: string;
  type: 'object' | 'construct';
  title: string;
  state: DesignState;
  el: El;
}

/**
 * What one seat is served, as the lens profile's rungs read it (the charter profile's rule 5, serial 135: a Charter
 * the hidden mark keeps from a reader is not that reader's). A keeper (the owner or a co-builder) is served the whole
 * world, the hidden among it, so it reads as the owner, with the room's hidden list as the world's. Every other seat
 * reads exactly what it was served: its full rows whole (its own hidden creations among them, which keel serves only to
 * their maker and the keepers) and its known-of rows as stubs, so a stub is never a design part.
 */
export interface SeatView {
  /** The SDK's charter world (`OwCharterWorld`): the elements as served, and for a keeper the room's hidden list. */
  world: { elements: readonly El[]; hidden?: readonly string[] };
  reader: OwLensReader;
}

export function seatView(els: Iterable<El>, keeper: boolean, hidden: Iterable<string> = []): SeatView {
  const elements = [...els];
  if (keeper) return { world: { elements, hidden: [...hidden] }, reader: { rung: 'owner' } };
  const whole: string[] = [];
  const knownOf: string[] = [];
  for (const el of elements) (el.known_of === true ? knownOf : whole).push(el.id);
  return { world: { elements }, reader: { rung: 'guest', whole, known_of: knownOf } };
}

/**
 * The design parts this seat reads (the charter profile's design state, serial 135), as the SDK's `designPartsOf` reads
 * them over what the seat was served: only where it finds a Charter for this seat, each Object or Construct served whole
 * whose subtype is a design state, whatever its supertype (a room's Spec or a reading aid in design is a part too).
 * For a keeper a hidden part is among them, shown marked. In design first, then locked, each by its folded name in
 * code point order, a tie by id.
 */
export function readDesignParts(view: SeatView): DesignPart[] {
  const by = new Map(view.world.elements.map(el => [el.id, el]));
  const out: DesignPart[] = [];
  for (const p of designPartsOf(view.world, view.reader)) {
    const el = by.get(p.id);
    if (!el) continue;
    out.push({ id: p.id, type: p.type, title: typeof el.name === 'string' && el.name.trim() ? el.name : 'Untitled', state: p.state, el });
  }
  const rank = (s: DesignState) => (s === 'in design' ? 0 : 1);
  return out.sort((a, b) => rank(a.state) - rank(b.state) || byCodePoint(fold(a.title), fold(b.title)) || byCodePoint(a.id, b.id));
}

/** The link a line answering this part writes: by the part's own type. */
export function designLink(part: Pick<DesignPart, 'type'>): AnchorLink {
  return part.type === 'object' ? 'objects' : 'constructs';
}

/** What a person may pick as what a work item is about: the world's own elements, never the room's or a hidden one. */
export function isPickable(el: El): boolean {
  return !!LINK_FIELDS[fold(el.type)] && !isRoomElement(el as Parameters<typeof isRoomElement>[0]) && el.hidden !== true && el.known_of !== true;
}

// ---------------------------------------------------------------- recent changes

export interface Change {
  id: string;
  type: string;
  /** Its name; for a removed element, the name kept at the removal, null when none was kept. */
  name: string | null;
  /** Who last changed it: changed_by, else (an element no v2 write touched) who made it. Who removed it, for a removal; empty when no one is recorded. */
  by: string;
  at: string;
  /** Never changed since it was made. */
  made: boolean;
  /** Removed from the world: it has no card. */
  removed: boolean;
  /** Who made it and when (created_by, created_at); null for a removal. */
  madeBy: string | null;
  madeAt: string | null;
  /** The element, or for a removal its door as an element carries one (changed_via, changed_client). */
  el: El;
}

/** What a removal is, as the feed recorded it (feed.ts `Removal`). */
export interface RemovalRow { id: string; type: string; name: string | null; room: boolean | null; by: string | null; via: string | null; client: string | null; at: string }

/** The types a room element can be: a removal whose copy was never held may have been the room's, so it is left out. */
const ROOM_TYPES = new Set(ROOM_PAIRS.map(p => fold(p.type)));

/**
 * The world's own elements, newest change first (sheet §2: a world's parlor's work surface), one row each with its
 * last change, removed elements among them. Room elements are the room, not changes to the world, so they are left
 * out, and so is a removal that may have been one (its copy never held, its type a room type).
 */
export function readChanges(els: Iterable<El>, max = 40, removals: Iterable<RemovalRow> = []): Change[] {
  const out: Change[] = [];
  for (const el of els) {
    if (isRoomElement(el as Parameters<typeof isRoomElement>[0])) continue;
    // What the reader is served hidden or as a stub is named nowhere in the room, here neither.
    if (el.hidden === true || el.known_of === true) continue;
    const at = el.updated_at ?? el.created_at ?? '';
    if (!at) continue;
    const by = 'changed_by' in el ? (typeof el.changed_by === 'string' && el.changed_by ? el.changed_by : OWNER) : whoMade(el);
    out.push({ id: el.id, type: fold(el.type), name: (el.name ?? '').toString().trim() || 'Untitled', by, at, made: sameMoment(el.created_at, el.updated_at ?? el.created_at),
      removed: false, madeBy: whoMade(el), madeAt: typeof el.created_at === 'string' && el.created_at ? el.created_at : null, el });
  }
  for (const r of removals) {
    if (r.room === true || (r.room === null && ROOM_TYPES.has(fold(r.type)))) continue;
    // keel names no one for the world's owner, and for a removal the server made itself (its door says so).
    const by = r.by ?? (r.via === 'server' ? '' : OWNER);
    out.push({ id: r.id, type: fold(r.type), name: r.name, by, at: r.at, made: false, removed: true, madeBy: null, madeAt: null,
      el: { id: r.id, type: fold(r.type), changed_via: r.via, changed_client: r.client } as El });
  }
  return out.sort((a, b) => newestFirst(a.at, b.at) || byCodePoint(a.id, b.id)).slice(0, max);
}

// ---------------------------------------------------------------- the charter

export interface Charter {
  id: string;
  name: string;
  text: string;
}

/**
 * The room's house rules: the world's charter as the charter profile reads it, by the SDK's own `charterOf` (the
 * newest marked Charter, a proposed one out), for this seat as it was served (`seatView`; without one, as a keeper
 * reads the copy). A Law with supertype Charter and no mark is lore, and is not the room's charter.
 */
export function readCharter(els: Iterable<El>, view: SeatView = seatView(els, true)): Charter | null {
  const id = charterOf(view.world, view.reader).charter?.id ?? null;
  const el = id ? view.world.elements.find(e => e.id === id) : undefined;
  return el ? { id: el.id, name: (el.name ?? '').toString(), text: (el.description ?? '').toString() } : null;
}

/**
 * The Laws a keeper could mark as the charter, when the world has no charter the room shows: every Law with supertype
 * Charter that carries no mark, is not proposed or a doubt, and is not hidden, by name. The keeper names one (the
 * charter profile: a tool never picks; "the keeper names"), so all of them are offered, none by default.
 */
export function unmarkedCharters(els: Iterable<El>, view?: SeatView): Charter[] {
  const all = [...els];
  if (readCharter(all, view ?? seatView(all, true))) return [];
  return all.filter(el => readingAidOf(el) === 'charter' && !isCharterElement(el) && !handsOnAsProposed(el) && el.hidden !== true && el.known_of !== true)
    .map(el => ({ id: el.id, name: (el.name ?? '').toString(), text: (el.description ?? '').toString() }))
    // By folded name compared by code point (never a locale's collation), ties by id.
    .sort((a, b) => byCodePoint(fold(a.name), fold(b.name)) || byCodePoint(a.id, b.id));
}

// ---------------------------------------------------------------- completing a report (the report profile's step 2)

/** A room report (the pair and the mark), as the room reads one. */
export function isReport(el: El): boolean {
  return isA(el, 'narrative', SUPERTYPE.report);
}

/** A work item by its pair alone, as a reader of reports reads one, with or without the room mark (the report profile). */
export function isWorkItemPair(el: El): boolean {
  return isPair(el, 'relation', SUPERTYPE.workItem);
}

/** A report's own parts, as the room reads them. */
export function reportPartOf(el: El): ReportPart {
  return readReportPart(el);
}

/**
 * Step 2's write on a handed-in report, read fresh: `completed`, the keeper's `description` (trimmed), `consequences`
 * (each typed line trimmed, then one line per work item this completion set done; `nothing changed` when none), and
 * each typed link field the picks touch as the union of what the report holds and the picks, so the reporter's links
 * stay. Never `story`, `narrator`, the mark or `x_report_answers`.
 */
export function completionPatch(
  report: El, part: { description: string; changes: string; touched: ReadonlyArray<{ type: string; id: string }> },
  done: ReadonlyArray<{ id: string; title: string }>,
): Record<string, unknown> {
  const lines = part.changes.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const d of done) lines.push(doneLine(d));
  const body: Record<string, unknown> = {
    subtype: REPORT_COMPLETED,
    description: part.description.trim(),
    consequences: lines.length ? lines.join('\n') : NOTHING_CHANGED,
  };
  for (const t of part.touched) {
    const field = NARRATIVE_LINKS[fold(t.type)];
    if (!field) continue;
    const had = (body[field] as string[] | undefined) ?? links(report, field);
    if (!had.includes(t.id)) body[field] = [...had, t.id];
  }
  return body;
}

/** The charter profile's mark, as a keeper writes it on the world's charter: the world's id. */
export const CHARTER_MARK = 'x_charter_of';

// ---------------------------------------------------------------- members' own Characters

/** Each seat's own Member Character (the oldest, if a race made two), by who made it. */
export function readMemberCharacters(els: Iterable<El>): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string; at: string }>();
  for (const el of els) {
    if (!isA(el, 'character', SUPERTYPE.member)) continue;
    const by = whoMade(el);
    const at = el.created_at ?? '';
    const had = out.get(by);
    if (!had || earlierFirst(at, had.at) < 0) out.set(by, { id: el.id, name: (el.name ?? '').toString(), at });
  }
  return new Map([...out].map(([k, v]) => [k, { id: v.id, name: v.name }]));
}

/** A member's card spans sittings: its mark is the world's id. */
export function newMember(name: string, worldId: string): Record<string, unknown> {
  return { name: name.trim(), supertype: SUPERTYPE.member, [ROOM_MARK]: worldId };
}
