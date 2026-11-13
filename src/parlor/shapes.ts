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

import { FIELD_SCHEMA, charterOf, handsOnAsProposed, isCharterElement, isRoomElement, proposedMarkOf, readingAidOf, simpleCaseFold } from '@onlyworlds/sdk';
import { earlierFirst, isAfter, newestFirst } from './when';

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

const fold = (s: unknown): string => (typeof s === 'string' ? simpleCaseFold(s.trim()) : '');

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
  return lines.sort((a, b) => earlierFirst(a.at, b.at) || a.id.localeCompare(b.id));
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
  /** What changed, one entry per non-empty line, as written (rule 8: a line may have no address). */
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
    consequences: str(el.consequences).split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    answers,
    proposed: proposedMarkOf(el) !== null,
  };
}

/**
 * A line of `consequences` as a person reads it: its words, and the address that follows them (the report
 * profile: "the element named in words before its address"), kept apart so the room shows the words and
 * keeps the address beside them. A line with no address is all words (rule 8); one with only an address keeps it.
 */
export function splitConsequence(line: string): { words: string; address: string | null } {
  const m = /^(.*?)[\s:]*(ow:\/\/\S+)\s*$/.exec(line);
  if (!m) return { words: line, address: null };
  const words = m[1].trim();
  return words ? { words, address: m[2] } : { words: m[2], address: null };
}

/** A handed-in report's opening in the room: its first three lines, at most 280 characters; `cut` when more remain. */
export function storyStart(story: string): { text: string; cut: boolean } {
  const ls = story.split(/\r?\n/);
  let text = ls.slice(0, 3).join('\n');
  let cut = ls.length > 3;
  if (text.length > 280) { text = text.slice(0, 279).trimEnd() + '…'; cut = true; }
  return { text, cut };
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

/** A work item's own word lets a keeper's report set it done: open or taken (or none, read as open), and not proposed. */
export function maySetDone(el: El): boolean {
  const word = fold(el.subtype);
  return (word === '' || word === 'open' || word === 'taken') && proposedMarkOf(el) === null;
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
  on: { parent?: string | null; item?: string | null; answers?: boolean; sitting?: string | null } = {},
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
  // Free talk (the report profile's closed talk, its third anchor): no board entry and no work item under it, so it
  // hangs on the sitting it was said in, linked in `events`. A keeper's touched Events join after it, never in place of it.
  if (on.sitting && !on.parent && !on.item) body.events = [on.sitting];
  if (keeper) {
    body.description = keeper.description;
    const lines = keeper.changes.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (keeper.done) lines.push(`Set the work item ${keeper.done.title.replace(/\s+/g, ' ').trim() || 'Untitled'} to done: ow://relation/${keeper.done.id}`);
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
  return out.sort((a, b) => earlierFirst(a.at, b.at) || a.id.localeCompare(b.id));
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
    if (!newest || (newestFirst(l.at, newest.at) || newest.id.localeCompare(l.id)) < 0) newest = l;
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
  // An unreadable time comes after every readable one (the message profile): such a line is in the last sitting.
  return lines.filter(l => earlierFirst(l.at, from) >= 0 && (to === null || earlierFirst(l.at, to) < 0));
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
  return out.sort((a, b) => rank(a.colour) - rank(b.colour) || newestFirst(a.at, b.at) || a.id.localeCompare(b.id));
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

export type WorkState = 'open' | 'taken' | 'done';

export interface WorkElement {
  type: string;
  id: string;
  /** A packet's one sentence on why (x_packet_elements); null for a typed link. */
  reason: string | null;
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
  elements: WorkElement[];
  /** The packet's ids belong to another world (x_packet_source): read there, never here. */
  otherWorld: boolean;
  /** An agent's write waiting for review (schema-dist profiles/review.md: x_review_proposed set). */
  proposed: boolean;
  /** The live takes on it, first taken first (who by `created_by`, never `actor`). */
  takes: Take[];
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
  for (const list of out.values()) list.sort((a, b) => earlierFirst(a.at, b.at) || a.id.localeCompare(b.id));
  return out;
}

/**
 * The takes on an item a person may delete, by id: their own (Release, contract T5), or every one
 * for a host deleting the item (T6). Read roster-blind, so a double take is found whole.
 */
export function deletableTakes(els: Iterable<El>, itemId: string, me: string, isHost = false): string[] {
  return (readTakes(els).get(itemId) ?? []).filter(t => isHost || t.by === me).map(t => t.id);
}

/** My take on a work item: the taker's own Relation, in the item's own scope; the item is never edited by it. */
export function newTake(item: { id: string; title: string; roomOf: string }, character: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: `Take: ${item.title}`.slice(0, 200),
    supertype: SUPERTYPE.take,
    subtype: 'taken',
    [ROOM_MARK]: item.roomOf,
    [ROOM_ITEM]: item.id,
  };
  if (character) body.actor = character;
  return body;
}

/** The packet's valid entries (each of type, id and reason a string), or null when it has none. */
function packetElements(el: El): WorkElement[] | null {
  const v = el.x_packet_elements;
  if (!Array.isArray(v)) return null;
  const out: WorkElement[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const { type, id, reason } = e as Record<string, unknown>;
    if (typeof type === 'string' && typeof id === 'string' && typeof reason === 'string') out.push({ type: fold(type), id, reason });
  }
  return out.length ? out : null;
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

/** Every room work item in the world, whatever sitting made it: open and taken first, done last, newest first within. */
export function readWork(els: Iterable<El>, worldId: string, live: (by: string) => boolean = () => true): WorkItem[] {
  const all = [...els];
  const takes = readTakes(all, live);
  const titles = new Set(all.filter(el => fold(el.type) === 'title').map(el => el.id));
  const out: WorkItem[] = [];
  for (const el of all) {
    if (!isA(el, 'relation', SUPERTYPE.workItem)) continue;
    const word = fold(el.subtype);
    const taken = takes.get(el.id) ?? [];
    const packet = packetElements(el);
    const source = el.x_packet_source as { world?: unknown } | null | undefined;
    const elements = packet ?? Object.entries(LINK_FIELDS).flatMap(([type, field]) => links(el, field).map(id => ({ type, id, reason: null })));
    out.push({
      id: el.id,
      title: (el.name ?? '').toString(),
      text: (el.description ?? '').toString(),
      // Done wins; then taken, by a live take or the item's own word (a packet's reader may set it).
      state: word === 'done' ? 'done' : word === 'taken' || taken.length ? 'taken' : 'open',
      forWho: link(el, 'actor'),
      forTitles: forTitlesOf(el, titles),
      by: whoMade(el),
      at: el.created_at ?? '',
      elements,
      otherWorld: !!packet && !!source && typeof source.world === 'string' && source.world !== worldId,
      // The review profile's reading for a page people read (rule 1 and 4): an object mark is proposed; an empty
      // mark is settled, and any other value a doubt, shown settled (a lint's to report).
      proposed: proposedMarkOf(el) !== null,
      takes: taken,
      el,
    });
  }
  const rank = (s: WorkState) => (s === 'done' ? 1 : 0);
  return out.sort((a, b) => rank(a.state) - rank(b.state) || newestFirst(a.at, b.at) || a.id.localeCompare(b.id));
}

/** A new work item: the picked elements in their typed link fields (a type with no field is left out), subtype open. */
export function newWorkItem(
  title: string, text: string, forWho: string | null, picks: ReadonlyArray<{ type: string; id: string }>, roomOf: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: title.trim().slice(0, 200),
    description: text,
    supertype: SUPERTYPE.workItem,
    subtype: 'open',
    [ROOM_MARK]: roomOf,
  };
  if (forWho) body.actor = forWho;
  for (const p of picks) {
    const field = LINK_FIELDS[p.type];
    if (!field) continue;
    const had = (body[field] as string[] | undefined) ?? [];
    if (!had.includes(p.id)) body[field] = [...had, p.id];
  }
  return body;
}

/** What a person may pick as what a work item is about: the world's own elements, never the room's or a hidden one. */
export function isPickable(el: El): boolean {
  return !!LINK_FIELDS[fold(el.type)] && !isRoomElement(el as Parameters<typeof isRoomElement>[0]) && el.hidden !== true && el.known_of !== true;
}

// ---------------------------------------------------------------- recent changes

export interface Change {
  id: string;
  type: string;
  name: string;
  /** Who last changed it: changed_by, else (an element no v2 write touched) who made it. */
  by: string;
  at: string;
  /** Never changed since it was made. */
  made: boolean;
  el: El;
}

/**
 * The world's own elements, newest change first (sheet §2: a world's parlor's work surface). Room
 * elements are the room, not changes to the world, so they are left out.
 */
export function readChanges(els: Iterable<El>, max = 40): Change[] {
  const out: Change[] = [];
  for (const el of els) {
    if (isRoomElement(el as Parameters<typeof isRoomElement>[0])) continue;
    const at = el.updated_at ?? el.created_at ?? '';
    if (!at) continue;
    const by = 'changed_by' in el ? (typeof el.changed_by === 'string' && el.changed_by ? el.changed_by : OWNER) : whoMade(el);
    out.push({ id: el.id, type: fold(el.type), name: (el.name ?? '').toString().trim() || 'Untitled', by, at, made: !!el.created_at && el.created_at === el.updated_at, el });
  }
  return out.sort((a, b) => newestFirst(a.at, b.at) || a.id.localeCompare(b.id)).slice(0, max);
}

// ---------------------------------------------------------------- the charter

export interface Charter {
  id: string;
  name: string;
  text: string;
}

/**
 * The room's house rules: the world's charter as the charter profile reads it, by the SDK's own `charterOf` (the
 * newest marked Charter, a proposed one out), over what this seat was served (Lantern's reading: the copy already is
 * what the seat sees). A Law with supertype Charter and no mark is lore, and is not the room's charter.
 */
export function readCharter(els: Iterable<El>): Charter | null {
  const all = [...els];
  const id = charterOf({ elements: all }, { rung: 'owner' }).charter?.id ?? null;
  const el = id ? all.find(e => e.id === id) : undefined;
  return el ? { id: el.id, name: (el.name ?? '').toString(), text: (el.description ?? '').toString() } : null;
}

/**
 * The Laws a keeper could mark as the charter, when the world has no charter the room shows: every Law with supertype
 * Charter that carries no mark, is not proposed or a doubt, and is not hidden, by name. The keeper names one (the
 * charter profile: a tool never picks; "the keeper names"), so all of them are offered, none by default.
 */
export function unmarkedCharters(els: Iterable<El>): Charter[] {
  const all = [...els];
  if (readCharter(all)) return [];
  return all.filter(el => readingAidOf(el) === 'charter' && !isCharterElement(el) && !handsOnAsProposed(el) && el.hidden !== true && el.known_of !== true)
    .map(el => ({ id: el.id, name: (el.name ?? '').toString(), text: (el.description ?? '').toString() }))
    .sort((a, b) => simpleCaseFold(a.name).localeCompare(simpleCaseFold(b.name)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  for (const d of done) lines.push(`Set the work item ${d.title.replace(/\s+/g, ' ').trim() || 'Untitled'} to done: ow://relation/${d.id}`);
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
