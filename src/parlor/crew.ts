/**
 * The team world's reads (pure, so every rule has a unit test): who is on the crew and which seat has a room, what
 * a seat's room holds, the work line on top of it, whether a workshop runs, the designs as folds, and what an
 * element's card shows. Every line read here comes from the room's one line reader (`readLines`); a seat's room is a
 * filter over it and the parent chain, never a second parser.
 */

import { FIELD_SCHEMA, isRoomElement, fieldLabel, type OwMember } from '@onlyworlds/sdk';
import { OWNER, type El, type Line, type Sitting, type WorkItem, type DesignPart } from './shapes';
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
}): Crew {
  const room = (c: string | null): string | null => (c && o.served(c) ? c : null);
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
    const seat: CrewSeat = { key: p.key, name, ai: false, character: room(character), role: roleOf(p.key), you: p.you, plays: null };
    const ais: CrewSeat[] = p.ais.map(a => ({
      key: a.key, name: a.ownName, ai: true,
      // An AI that plays its person's Character has no room of its own: a press opens the person's.
      character: a.as === 'person' ? null : room(a.character),
      role: null, you: false, plays: a.as === 'person' ? p.key : null,
    }));
    return { seat, ais };
  });
  const beasts: CrewSeat[] = team.unattached.map(a => ({ key: a.key, name: a.ownName, ai: true, character: room(a.character), role: null, you: false, plays: null }));
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
 * The seat whose room `key` opens: a beast (an AI no person answers for) with a Character this reader is served. A
 * person and a person's AI keep their rows in the crew, with no room of their own for now (ruled 2026-11-18).
 */
export function roomSeat(crew: Crew, key: MemberKey): CrewSeat | null {
  const b = crew.beasts.find(x => x.key === key);
  return b?.character ? b : null;
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
 * The work item a seat holds taken: a work item in state taken that the seat's own live take holds, or whose
 * `characters` holds the seat's Character and that someone else made (a seat never asks itself); the newest by when it
 * was made. Null when it holds none.
 */
export function heldWork(work: readonly WorkItem[], seat: { key: MemberKey; character: string | null }): WorkItem | null {
  let best: WorkItem | null = null;
  for (const w of work) {
    if (w.state !== 'taken') continue;
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
  /** Who made the work item the seat holds taken, never the seat itself; null when it holds none. */
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
  return { ...wl, working: false, since: null, askedBy: null };
}

/** A seat's work line, from its newest Note and the work item it holds taken. Null when it has neither. */
export function workLineOf(note: El | null, held: WorkItem | null, els: ReadonlyMap<string, El>, seat: MemberKey | null = null): WorkLine | null {
  if (!note && !held) return null;
  const on = note ? (noteText(note).split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? '') : '';
  const ids: string[] = [];
  if (note) {
    const schema = FIELD_SCHEMA.narrative as Record<string, { type: string }>;
    for (const [field, f] of Object.entries(schema)) {
      if (NOTE_SKIP.has(field) || (f.type !== 'single_link' && f.type !== 'multi_link')) continue;
      for (const id of links(note, field)) if (!ids.includes(id) && isShowable(els.get(id))) ids.push(id);
    }
  }
  const noteAt = note?.created_at ?? null;
  return {
    on,
    noteAt,
    links: ids,
    working: !!held,
    since: held ? noteAt ?? held.at : null,
    askedBy: held && held.by !== seat ? held.by : null,
  };
}

// ---------------------------------------------------------------- designs as folds

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

export interface CardLink { field: string; label: string; id: string; name: string; type: string; under: boolean }

export interface CardView {
  id: string;
  type: string;
  /** The type in words: Construct, Object. */
  kind: string;
  name: string;
  /** Its subtype, else its supertype, as written; empty when neither. */
  state: string;
  text: string;
  /** What it links to one step away, and the Objects under it, that the reader may open. */
  links: CardLink[];
  /** The work items still open on it (its open questions): the room's, not done, about it. */
  questions: Array<{ id: string; title: string }>;
}

const typeWord = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * What an element's card shows: its words, each link one step away that the reader may open (by the link field's own
 * name), the Objects whose parent it is ("Under it"), and the open work items about it. Nothing hidden from the reader
 * is named: a link to an element the reader is not served is left out.
 */
export function cardOf(el: El, els: ReadonlyMap<string, El>, work: readonly WorkItem[]): CardView {
  const type = String(el.type ?? '').toLowerCase();
  const schema = (FIELD_SCHEMA as Record<string, Record<string, { type: string }>>)[type] ?? {};
  const out: CardLink[] = [];
  const nameOf = (x: El) => (typeof x.name === 'string' && x.name.trim()) || 'Untitled';
  for (const [field, f] of Object.entries(schema)) {
    if (f.type !== 'single_link' && f.type !== 'multi_link') continue;
    for (const id of links(el, field)) {
      const to = els.get(id);
      if (id === el.id || !isShowable(to)) continue;
      out.push({ field, label: fieldLabel(field), id, name: nameOf(to), type: String(to.type).toLowerCase(), under: false });
    }
  }
  if (type === 'object') {
    for (const x of els.values()) {
      if (x.id === el.id || String(x.type).toLowerCase() !== 'object' || x.parent_object !== el.id || !isShowable(x)) continue;
      out.push({ field: 'under', label: 'Under it', id: x.id, name: nameOf(x), type: 'object', under: true });
    }
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    id: el.id,
    type,
    kind: typeWord(type),
    name: nameOf(el),
    state: str(el.subtype) || str(el.supertype),
    text: str(el.description) || str(el.story),
    links: out,
    questions: work.filter(w => w.state !== 'done' && !w.otherWorld && w.elements.some(e => e.id === el.id)).map(w => ({ id: w.id, title: w.title.trim() || 'Untitled' })),
  };
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
