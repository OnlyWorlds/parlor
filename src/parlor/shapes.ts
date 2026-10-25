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
 *               Character (an invite link gives a person none; h66 #9720, until keel's roster names them)
 *
 * Who made a thing is `created_by` (a membership id, null for the world's owner),
 * never a name in its text.
 *
 * The room mark (schema-dist profiles/room.md): every room element the parlor
 * makes carries `x_room_of` in its first write, and the room reads only room
 * elements (the pair and the mark), so a world's own lore Messages, Votes or
 * Sittings never show as the room. The charter is lore: read without the mark,
 * never written with one.
 */

import { isRoomElement, simpleCaseFold } from '@onlyworlds/sdk';

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
  /** keel #537: true on a maker's own read of what a keeper hid. */
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
  /** A person's own Character, made on first entry when their seat has none (h66 #9720). */
  member: 'Member',
} as const;

/** The room profile's mark: the world's id for a world's parlor, the sitting's for a workshop. */
export const ROOM_MARK = 'x_room_of';

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
  el: El;
}

export function readLines(els: Iterable<El>): Line[] {
  const out: Line[] = [];
  for (const el of els) {
    if (!isA(el, 'narrative', SUPERTYPE.line)) continue;
    out.push({
      id: el.id,
      text: (el.description ?? el.name ?? '').toString(),
      by: whoMade(el),
      narrator: link(el, 'narrator'),
      parent: link(el, 'parent_narrative'),
      about: links(el, 'relations')[0] ?? null,
      at: el.created_at ?? '',
      el,
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** A Narrative's name is required: the line's first words, the whole line in the description. */
export function lineName(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= 60 ? one : one.slice(0, 59).trimEnd() + '…';
}

export function newLine(text: string, narrator: string | null, parent: string | null, roomOf: string, about: string | null = null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: lineName(text),
    description: text,
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
 * Builds before 2026-10-25 marked the winner as the spec's subtype star. A sitting made before
 * this moment that names no `x_star` reads that old mark; a later one never does, so a member
 * cannot crown their own spec by setting its subtype (the S473 gate's G2). Only crew test worlds
 * ever ran those builds.
 */
export const OLD_STAR_BEFORE = '2026-10-26T00:00:00Z';

/** What a sitting says its winner is, for readSpecs: its x_star, else 'subtype' for an old sitting, else none. */
export function starOf(sitting: { star: string | null; at: string } | null): string | null {
  if (!sitting) return null;
  if (sitting.star) return sitting.star;
  return sitting.at && sitting.at < OLD_STAR_BEFORE ? OLD_STAR : null;
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
  return out.sort((a, b) => Number(b.star) - Number(a.star) || b.hearts - a.hearts || a.at.localeCompare(b.at));
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
    if (!had || v.at > had.at) newest.set(v.by, v);
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
 * list (sheet §2 and §6 point 10: the Captain folded February's Parsing into Pitch, h28 #10285;
 * the names h66 #10317).
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
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
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

/** Lines of one sitting: made at or after its start and before the next one's. */
export function linesOfSitting(lines: readonly Line[], sittings: readonly Sitting[], sittingId: string | null): Line[] {
  if (!sittingId) return [...lines];
  const i = sittings.findIndex(s => s.id === sittingId);
  if (i < 0) return [...lines];
  const from = sittings[i].at;
  const to = sittings[i + 1]?.at ?? null;
  return lines.filter(l => l.at >= from && (to === null || l.at < to));
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
  return out.sort((a, b) => rank(a.colour) - rank(b.colour) || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
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
  /** The Character it is for; null for anyone. */
  forWho: string | null;
  by: string;
  at: string;
  elements: WorkElement[];
  /** The packet's ids belong to another world (x_packet_source): read there, never here. */
  otherWorld: boolean;
  /** An agent's write waiting for review (schema-dist profiles/review.md: x_review_proposed set). */
  proposed: boolean;
  el: El;
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

/** Every room work item in the world, whatever sitting made it: open and taken first, done last, newest first within. */
export function readWork(els: Iterable<El>, worldId: string): WorkItem[] {
  const out: WorkItem[] = [];
  for (const el of els) {
    if (!isA(el, 'relation', SUPERTYPE.workItem)) continue;
    const word = fold(el.subtype);
    const packet = packetElements(el);
    const source = el.x_packet_source as { world?: unknown } | null | undefined;
    const elements = packet ?? Object.entries(LINK_FIELDS).flatMap(([type, field]) => links(el, field).map(id => ({ type, id, reason: null })));
    out.push({
      id: el.id,
      title: (el.name ?? '').toString(),
      text: (el.description ?? '').toString(),
      state: word === 'done' ? 'done' : word === 'taken' ? 'taken' : 'open',
      forWho: link(el, 'actor'),
      by: whoMade(el),
      at: el.created_at ?? '',
      elements,
      otherWorld: !!packet && !!source && typeof source.world === 'string' && source.world !== worldId,
      proposed: el.x_review_proposed !== undefined && el.x_review_proposed !== null,
      el,
    });
  }
  const rank = (s: WorkState) => (s === 'done' ? 1 : 0);
  return out.sort((a, b) => rank(a.state) - rank(b.state) || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
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
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, max);
}

// ---------------------------------------------------------------- the charter

export interface Charter {
  id: string;
  name: string;
  text: string;
}

export function readCharter(els: Iterable<El>): Charter | null {
  for (const el of els) {
    if (isPair(el, 'law', SUPERTYPE.charter)) {
      return { id: el.id, name: (el.name ?? '').toString(), text: (el.description ?? '').toString() };
    }
  }
  return null;
}

// ---------------------------------------------------------------- members' own Characters

/** Each seat's own Member Character (the oldest, if a race made two), by who made it. */
export function readMemberCharacters(els: Iterable<El>): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string; at: string }>();
  for (const el of els) {
    if (!isA(el, 'character', SUPERTYPE.member)) continue;
    const by = whoMade(el);
    const at = el.created_at ?? '';
    const had = out.get(by);
    if (!had || at < had.at) out.set(by, { id: el.id, name: (el.name ?? '').toString(), at });
  }
  return new Map([...out].map(([k, v]) => [k, { id: v.id, name: v.name }]));
}

/** A member's card spans sittings: its mark is the world's id. */
export function newMember(name: string, worldId: string): Record<string, unknown> {
  return { name: name.trim(), supertype: SUPERTYPE.member, [ROOM_MARK]: worldId };
}
