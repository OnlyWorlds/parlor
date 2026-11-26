/**
 * The team world's reads (pure, so every rule has a unit test): who is on the crew and which seat has a room, what
 * a seat's room holds, the work line on top of it, whether a workshop runs, the designs as folds, and the parlor's call
 * site of an element's card (its model is element-card.ts). Every line read here comes from the room's one line reader
 * (`readLines`); a seat's room is a filter over it and the parent chain, never a second parser.
 */

import { FIELD_SCHEMA, isOpenWork, isRoomElement, worldGraph, type OwMember, type OwWorldGraph } from '@onlyworlds/sdk';
import { OWNER, type El, type Line, type Sitting, type WorkItem, type DesignPart, type SeatView } from './shapes';
import { cardModel, type CardFlags, type CardModel } from './element-card';
import { buildTeam, keyOf, type MemberKey } from './team';
import { roomRole, type RoomRole } from './roster';
import { byCodePoint, earlierFirst } from './when';

// ---------------------------------------------------------------- the crew

/** One seat as the crew list draws it. */
export interface CrewSeat {
  key: MemberKey;
  name: string;
  ai: boolean;
  /** The Character whose room this is; null when the seat has none this reader can see (no room). */
  character: string | null;
  /** A person's role in the room's words; null for an AI. */
  role: RoomRole | null;
  you: boolean;
  /** An AI that plays its own person's Character: that person's key. It has no room of its own. */
  plays: MemberKey | null;
  /** Whether the seat's Character (served to this reader) is a Companion: an AI's room is a Companion's alone. */
  companion: boolean;
}

export interface Crew {
  /** AI seats no person answers for. */
  beasts: CrewSeat[];
  /** Each person, with the AI seats that are theirs. */
  people: Array<{ seat: CrewSeat; ais: CrewSeat[] }>;
}


/**
 * The crew from the roster, by the team rule the OnlyWorlds Dashboard uses (`buildTeam`, vendored in team.ts). After
 * it, a person whose roster row names no Character is given the Member Character they made in this world (their own
 * name in the room), so the person who writes as it has a room; a seat with neither has none. `charName` names a
 * Character this reader is served, or null: a name never comes from a Character the reader cannot see. `served` says
 * whether this reader is served a Character at all (in its feed, not hidden, not a stub): a seat whose Character is
 * not served has no room, so no room is ever keyed on, and no line ever addressed to, a Character the reader cannot see.
 */
export function crewOf(o: {
  members: readonly OwMember[];
  me: MemberKey;
  myUsername?: string;
  mySeats: readonly { id: string }[];
  charName: (character: string | null) => string | null;
  memberCharacters: ReadonlyMap<string, { id: string; name: string }>;
  served: (character: string) => boolean;
  /** Whether a served Character is a Companion (its supertype, folded); never asked of one the reader is not served. */
  companion: (character: string) => boolean;
}): Crew {
  const room = (c: string | null): string | null => (c && o.served(c) ? c : null);
  const isCompanion = (c: string | null): boolean => !!c && o.companion(c);
  const team = buildTeam({ members: o.members, me: o.me, myUsername: o.myUsername, mySeats: o.mySeats, nameOf: c => o.charName(c) ?? '', charName: o.charName });
  const roleOf = (key: MemberKey): RoomRole => {
    const row = o.members.find(m => keyOf(m.id) === key);
    return roomRole(row?.role);
  };
  const people = team.people.map(p => {
    let character = p.character;
    let name = p.name;
    if (!character) {
      const own = o.memberCharacters.get(p.key);
      if (own) {
        character = own.id;
        // Their Character's name leads, as for any person (the team rule reads a served username only after it).
        if (own.name.trim()) name = own.name.trim();
      }
    }
    const seat: CrewSeat = { key: p.key, name, ai: false, character: room(character), role: roleOf(p.key), you: p.you, plays: null, companion: false };
    const ais: CrewSeat[] = p.ais.map(a => {
      // An AI that plays its person's Character has no room of its own.
      const own = a.as === 'person' ? null : room(a.character);
      return { key: a.key, name: a.ownName, ai: true, character: own, role: null, you: false, plays: a.as === 'person' ? p.key : null, companion: isCompanion(own) };
    });
    return { seat, ais };
  });
  const beasts: CrewSeat[] = team.unattached.map(a => {
    const own = room(a.character);
    return { key: a.key, name: a.ownName, ai: true, character: own, role: null, you: false, plays: null, companion: isCompanion(own) };
  });
  return { beasts, people };
}

/** Every seat in the crew, people and their AIs and the beasts, by key. */
export function seatsByKey(crew: Crew): Map<MemberKey, CrewSeat> {
  const out = new Map<MemberKey, CrewSeat>();
  for (const b of crew.beasts) out.set(b.key, b);
  for (const p of crew.people) { out.set(p.seat.key, p.seat); for (const a of p.ais) out.set(a.key, a); }
  return out;
}

/**
 * The seat whose room `key` opens: an AI seat whose own Character, served to this reader, is a Companion (a character
 * of the product), whether or not a person answers for it. An AI whose Character is anything else (an Agent) talks
 * with its person and has no room; a person has none, nor an AI that plays its person's Character (ruled 2026-11-21).
 */
export function roomSeat(crew: Crew, key: MemberKey): CrewSeat | null {
  const s = seatsByKey(crew).get(key);
  return s && s.ai && !s.plays && s.character && s.companion ? s : null;
}

// ---------------------------------------------------------------- threads and a seat's room

/** A line in a room as drawn: under its parent (`depth` above 0) or a root. */
export interface Threaded { line: Line; depth: number }

/**
 * Lines as threads: each root by time, then the lines under it, each right after the line it answers. A line whose
 * parent is not among `lines` (a board entry, a work item, a line not shown) is a root. `lines` is in the room's order.
 */
export function thread(lines: readonly Line[]): Threaded[] {
  const ids = new Set(lines.map(l => l.id));
  const kids = new Map<string, Line[]>();
  const roots: Line[] = [];
  for (const l of lines) {
    if (l.parent && l.parent !== l.id && ids.has(l.parent)) {
      const list = kids.get(l.parent) ?? [];
      list.push(l);
      kids.set(l.parent, list);
    } else roots.push(l);
  }
  const out: Threaded[] = [];
  const done = new Set<string>();
  const walk = (l: Line, depth: number): void => {
    if (done.has(l.id)) return;
    done.add(l.id);
    out.push({ line: l, depth });
    for (const k of kids.get(l.id) ?? []) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Lines in a loop of parents (a writer can make one) have no root: each stands as a root, by time.
  for (const l of lines) walk(l, 0);
  return out;
}

/**
 * A seat's room: every room line addressed to the seat's Character (a Message whose `characters` holds it; a report
 * never, whatever it touched), and every line that answers one of them, down the parent chain, whether or not it names
 * the seat again. Threaded, so a reply shows under its parent.
 */
export function seatRoom(lines: readonly Line[], character: string): Threaded[] {
  const byId = new Map(lines.map(l => [l.id, l]));
  const memo = new Map<string, boolean>();
  const inRoom = (l: Line): boolean => {
    const known = memo.get(l.id);
    if (known !== undefined) return known;
    // A loop of parents reads as not in the room until something in it is addressed.
    memo.set(l.id, false);
    let yes = !l.report && l.to.includes(character);
    if (!yes && l.parent) { const p = byId.get(l.parent); if (p) yes = inRoom(p); }
    memo.set(l.id, yes);
    return yes;
  };
  return thread(lines.filter(inRoom));
}

// ---------------------------------------------------------------- the workshop

/** A workshop runs while any of the newest sitting's three switches is on. */
export function workshopRuns(sittings: readonly Sitting[]): boolean {
  const s = sittings[sittings.length - 1];
  return !!s && (s.hearts || s.specs || s.voting);
}

// ---------------------------------------------------------------- the work line

function links(el: El, field: string): string[] {
  const v = el[field];
  if (typeof v === 'string' && v) return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
}

/**
 * The work item a seat holds taken: open work (the SDK's `isOpenWork`) in state taken that the seat's own live take
 * holds, or whose `characters` holds the seat's Character and that someone else made (a seat never asks itself); the
 * newest by when it was made. Null when it holds none. A standing or stateless item is never held, take or no take.
 */
export function heldWork(work: readonly WorkItem[], seat: { key: MemberKey; character: string | null }): WorkItem | null {
  let best: WorkItem | null = null;
  for (const w of work) {
    if (!isOpenWork(w.el) || w.state !== 'taken') continue;
    const named = !!seat.character && links(w.el, 'characters').includes(seat.character) && w.by !== seat.key;
    const took = w.takes.some(t => t.by === seat.key);
    if (!named && !took) continue;
    if (!best || earlierFirst(best.at, w.at) < 0 || (earlierFirst(best.at, w.at) === 0 && byCodePoint(w.id, best.id) < 0)) best = w;
  }
  return best;
}

/** An element the room may name and open: the world's own (never the room's), not hidden, not a stub. */
export function isShowable(el: El | undefined): el is El {
  return !!el && !isRoomElement(el as Parameters<typeof isRoomElement>[0]) && el.hidden !== true && el.known_of !== true;
}

const NOTE_SKIP = new Set(['narrator', 'parent_narrative']);

export interface WorkLine {
  /** The Note's first line as written; empty when the seat has no Note. */
  on: string;
  /** The Note's time; null when there is no Note. */
  noteAt: string | null;
  /** The elements the Note links to that the reader may open, in the order the fields hold them. */
  links: string[];
  /** Holds a taken work item. */
  working: boolean;
  /** While working: the Note's time, else the work item's. */
  since: string | null;
  /** Who made the work item the seat holds taken, never the seat itself; null when it holds none. Never shown as who asked. */
  madeBy: string | null;
  /**
   * The Character who asked for the work item the seat holds taken (its `x_packet_from`, read by the SDK's `askerOf`):
   * null when it names none, never the maker or `actor`.
   */
  askedBy: string | null;
}

function noteText(el: El): string {
  for (const f of ['story', 'description']) { const v = el[f]; if (typeof v === 'string' && v.trim()) return v; }
  return typeof el.name === 'string' ? el.name : '';
}

/**
 * Whether the room says a seat is working (the ring, "since", "asked by"). Off: nothing in a world records a seat's
 * session yet, so no seat is shown as working. The derivation below stays whole; turning this on is the one change.
 */
export const SHOW_WORKING = false;

/**
 * A work line as the room shows it: with SHOW_WORKING off, the Note's words and elements only (the seat's own status
 * line), never working, since or asked by; and no line at all for a seat with no Note.
 */
export function shownWorkLine(wl: WorkLine | null, show: boolean = SHOW_WORKING): WorkLine | null {
  if (!wl || show) return wl;
  if (!wl.noteAt) return null;
  return { ...wl, working: false, since: null, madeBy: null, askedBy: null };
}

/**
 * A seat's work line, from its newest Note and the work item it holds taken. Null when it has neither. `opens` says which
 * elements the reader may open (the room asks its card's model; by default the room's own showable rule).
 */
export function workLineOf(note: El | null, held: WorkItem | null, els: ReadonlyMap<string, El>, seat: MemberKey | null = null,
  opens: (id: string) => boolean = id => isShowable(els.get(id))): WorkLine | null {
  if (!note && !held) return null;
  const on = note ? (noteText(note).split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? '') : '';
  const ids: string[] = [];
  if (note) {
    const schema = FIELD_SCHEMA.narrative as Record<string, { type: string }>;
    for (const [field, f] of Object.entries(schema)) {
      if (NOTE_SKIP.has(field) || (f.type !== 'single_link' && f.type !== 'multi_link')) continue;
      for (const id of links(note, field)) if (!ids.includes(id) && opens(id)) ids.push(id);
    }
  }
  const noteAt = note?.created_at ?? null;
  return {
    on,
    noteAt,
    links: ids,
    working: !!held,
    since: held ? noteAt ?? held.at : null,
    madeBy: held && held.by !== seat ? held.by : null,
    askedBy: held?.askedBy ?? null,
  };
}

// ---------------------------------------------------------------- designs as folds

/** A design part hidden from the room: in a host's hidden list, or served to its maker marked hidden. */
export function isHiddenPart(p: DesignPart, hidden: ReadonlySet<string>): boolean {
  return hidden.has(p.id) || p.el.hidden === true;
}

/**
 * What the composer says, once, when a hidden part is answered: the line goes to everyone in the room, and the part it
 * names is seen only by those it is served to. Null for a part that is not hidden.
 */
export function hiddenAnswerNote(p: DesignPart, hidden: ReadonlySet<string>, isHost: boolean): string | null {
  if (!isHiddenPart(p, hidden)) return null;
  return isHost
    ? `${p.title} is hidden from the room: everyone reads your answer, and only the hosts and whoever made the part see it.`
    : `${p.title} is hidden from the room: everyone reads your answer, and only you and the hosts see the part it names.`;
}

/** A design and the parts under it in the Object tree (`parent_object`), its size their number. */
export interface DesignFold { design: DesignPart; parts: DesignPart[] }

/**
 * The design parts as folds: a part whose parent Object is another design part sits under the topmost design part
 * above it; every other part is a design of its own. Order is the parts' own.
 */
export function designFolds(parts: readonly DesignPart[]): DesignFold[] {
  const byId = new Map(parts.map(p => [p.id, p]));
  const parentOf = (p: DesignPart): DesignPart | null => {
    const id = p.el.parent_object;
    return typeof id === 'string' && id !== p.id ? byId.get(id) ?? null : null;
  };
  // The topmost design part above p; a part whose parents run in a loop stands as a design of its own.
  const top = (p: DesignPart): DesignPart => {
    const seen = new Set<string>([p.id]);
    let at = p;
    for (;;) {
      const up = parentOf(at);
      if (!up) return at;
      if (seen.has(up.id)) return p;
      seen.add(up.id);
      at = up;
    }
  };
  const tops = new Map(parts.map(p => [p.id, top(p)]));
  const folds = new Map<string, DesignFold>();
  for (const p of parts) if (tops.get(p.id)!.id === p.id) folds.set(p.id, { design: p, parts: [] });
  for (const p of parts) {
    const t = tops.get(p.id)!;
    if (t.id !== p.id) folds.get(t.id)?.parts.push(p);
  }
  return [...folds.values()];
}

/** The folds biggest first (the most parts under a design at the top); folds of one size keep the order they came in. */
export function bySize(folds: readonly DesignFold[]): DesignFold[] {
  return folds.map((f, i) => [f, i] as const).sort(([a, i], [b, j]) => b.parts.length - a.parts.length || i - j).map(([f]) => f);
}

// ---------------------------------------------------------------- an element's card

/** The parlor's flags for the card (element-card.ts): a keeper (the owner or a co-host) sees hidden and proposed rows, marked; no one else. */
export const cardFlags = (keeper: boolean): CardFlags => ({ hidden: keeper, proposed: keeper });

/**
 * The graph an element's card reads: the SDK's `worldGraph` over what this seat was served (`seatView`: a keeper as the
 * owner with the room's hidden list, every other seat as a guest of its own rows), with the keeper's flags. `rules`
 * brings the reading aids back, for the Rules door alone: the charter is no card of the room's.
 */
export function parlorGraph(view: SeatView, keeper: boolean, rules = false): OwWorldGraph {
  return worldGraph(view.world, view.reader, { ...cardFlags(keeper), readingAids: rules });
}

/**
 * The parlor's call site of the card's model: the room's rows, its work items (the room's own reader, `readWork`), its
 * design parts, whether the feed has walked once (before that the questions are not read yet), and the keeper's hidden
 * list and flags. `graph` is `parlorGraph`'s answer for the same seat, built once per change of the feed.
 */
export function parlorCard(o: {
  els: ReadonlyMap<string, El>;
  graph: OwWorldGraph;
  keeper: boolean;
  hidden: ReadonlySet<string>;
  id: string;
  worldId: string;
  work: readonly WorkItem[];
  walked: boolean;
  parts: readonly DesignPart[];
  names?: unknown;
}): CardModel | null {
  return cardModel({
    graph: o.graph,
    rows: o.els,
    id: o.id,
    work: o.work.map(w => w.el),
    workRead: o.walked ? 'ok' : 'pending',
    worldId: o.worldId,
    roomHidden: o.keeper ? o.hidden : [],
    names: o.names,
    flags: cardFlags(o.keeper),
    parts: o.parts,
  });
}

/** The first line of an element's words, for a name's hover; empty when it has none. */
export function firstLine(el: El | undefined): string {
  if (!el) return '';
  for (const f of ['description', 'story']) {
    const v = el[f];
    if (typeof v === 'string') { const one = v.split(/\r?\n/).map(s => s.trim()).find(Boolean); if (one) return one; }
  }
  return '';
}

export { OWNER };
