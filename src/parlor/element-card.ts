// The element card's model. This file is the source: the OnlyWorlds Dashboard holds a copy of it, so change it here first.
/**
 * What an element's card says, for one reader: pure, and it imports only the SDK, so the OnlyWorlds Dashboard runs the
 * same bytes below the first line. Every input is a structural type, never a tool's own.
 *
 * - **One reading.** The card reads the graph the SDK's `worldGraph` answered for this reader, handed in (never built
 *   here, so a redraw never builds one): an element that is not a node has no card (a room element, a hidden one for a
 *   reader it is kept from, a proposed one, map space, a reading aid). A known-of stub is a node, so it has a card.
 * - **Links both ways.** Out first, by the element's own link fields in the schema's order, then in, by field name
 *   ("Linked from · Birthplace"); the Objects whose `parent_object` it is are "Under it". The graph's edges are typed and
 *   deduped already; a link to itself is left out, and so are the declared links of the lens and spine profiles
 *   (`x_lens_leads_to`, `x_spine_depends_on`), which are a reading's machinery, not the element's. Within a group,
 *   by name in code point order, a tie by id.
 * - **Marks.** On the element and on each link: known of (a stub, by the graph's word or the row's own `known_of`, so a
 *   reader whose graph keeps a stub as a plain node still marks it), hidden (keel's one hidden mark: the row's own, or the
 *   room's hidden list, which a keeper hands in as the world's), proposed (the review profile's mark, under the keeper's
 *   flag). Trimmed (`x_served_trimmed`: keel left some of a field out for this reader) on the element and on the group
 *   of each field it names. The view words them.
 * - **Open questions.** A work item counts on this element when it is a room work item (the room mark and the pair),
 *   not proposed (the review mark, a doubt counted with the proposed, as a reader that hands a world on reads it), open
 *   work (`isOpenWork`), served to the reader and not hidden from it (a hidden item counts only under the hidden flag,
 *   marked), and names the element in this world by `questionTargets`, the one rule a tool's list of work reads too:
 *   its `x_packet_elements` when its `x_packet_source` names this world or none (an entry counts with its type, id and
 *   reason all strings), and its typed links always (a typed link can only point inside this world). The state of the
 *   read is said as it is: pending, failed and capped never read as "none".
 * - **Words.** The kind is the world's own word (`x_names`, by the supertype, then the type), else the type's own. A
 *   nameless element is "<Kind> with no name". The text is the description, else the story, as plain text, split at its
 *   first line break into the lead and the rest, so a view can fold the rest. The state is a design part's design
 *   state, else the subtype, else the supertype, as written and trimmed.
 */

import { byCodePoint, fieldLabel, FIELD_SCHEMA, handsOnAsProposed, isOpenWork, isRoomElement, typeWord, workStateOf } from '@onlyworlds/sdk';

// ---------------------------------------------------------------- what the card takes

/** An element row as the reader was served it: `hidden`, `known_of` and `x_served_trimmed` as keel sent them. */
export interface CardRow {
  readonly id: string;
  readonly type: string;
  readonly [field: string]: unknown;
}

/** A node of `worldGraph`'s answer (only what the card reads). */
export interface CardGraphNode {
  readonly id: string;
  readonly type: string;
  readonly name: string | null;
  readonly marks?: readonly string[];
  readonly known_of?: boolean;
}

/** An edge of `worldGraph`'s answer. */
export interface CardGraphEdge {
  readonly source: string;
  readonly field: string;
  readonly target: string;
  readonly index: number;
}

/** `worldGraph`'s answer, for this reader and these flags. */
export interface CardGraph {
  readonly nodes: readonly CardGraphNode[];
  readonly edges: readonly CardGraphEdge[];
}

/** How the work items were read: all of them, not yet, not at all, or only the first `cap`. */
export type CardWorkRead = 'ok' | 'pending' | 'failed' | 'capped';

/** What the reader may see beyond the default reading: a keeper sees hidden and proposed elements, marked. */
export interface CardFlags {
  readonly hidden: boolean;
  readonly proposed: boolean;
}

export interface CardInput {
  /** `worldGraph`'s answer for this reader, asked with these flags. */
  graph: CardGraph;
  /** Every element row the reader was served, by id. */
  rows: ReadonlyMap<string, CardRow>;
  id: string;
  /** The work item rows read (any rows: the card keeps the room's open work). */
  work: Iterable<CardRow>;
  workRead: CardWorkRead;
  /** With `capped`: how many work items were read. */
  cap?: number | null;
  /** The world the card is in: a packet from another world names nothing here. */
  worldId: string;
  /** The room's hidden list where the seat holds it (a keeper's), else empty. */
  roomHidden?: Iterable<string> | null;
  /** The World's `x_names`, or nothing. */
  names?: unknown;
  flags: CardFlags;
  /** The design parts for the same reader (the SDK's `designPartsOf`): a part's state is its design state. */
  parts?: Iterable<{ readonly id: string; readonly state: string }> | null;
}

// ---------------------------------------------------------------- what the card says

export interface CardMarks {
  /** A stub: the reader is served its base fields only. */
  knownOf: boolean;
  /** Hidden from everyone but the keepers (and its maker). */
  hidden: boolean;
  /** Written as proposed, waiting for review. */
  proposed: boolean;
}

export interface CardLink {
  id: string;
  type: string;
  /** Its name as stored, trimmed; null when it has none. */
  name: string | null;
  /** Its name, else "<Kind> with no name". */
  title: string;
  marks: CardMarks;
}

export interface CardGroup {
  /** `out:<field>` or `in:<field>`: unique on the card. */
  key: string;
  field: string;
  dir: 'out' | 'in';
  /** "Birthplace", "Linked from · Birthplace", "Under it". */
  label: string;
  /** keel left some of this field out for this reader (out groups only). */
  trimmed: boolean;
  links: CardLink[];
}

export interface CardQuestion {
  id: string;
  name: string | null;
  /** Its name, else "Work item with no name". */
  title: string;
  state: 'open' | 'taken';
  /** Hidden from the room: counted only under the hidden flag, and marked. */
  hidden: boolean;
}

export interface CardModel {
  id: string;
  type: string;
  /** The world's word for its kind, else the type's own ("Character"). */
  kind: string;
  name: string | null;
  /** Its name, else "<Kind> with no name". */
  title: string;
  /** Its design state ("In design", "Locked"), else its subtype, else its supertype; empty when none. */
  state: string;
  /** The text's first paragraph (up to its first line break), trimmed; empty when it has no text. */
  lead: string;
  /** The rest of the text, trimmed; empty when there is none to fold. */
  rest: string;
  marks: CardMarks & {
    /** keel left some links of this element out for this reader. */
    trimmed: boolean;
  };
  groups: CardGroup[];
  questions: {
    state: CardWorkRead;
    /** With `capped`: how many work items were read; else null. */
    cap: number | null;
    items: CardQuestion[];
  };
}

// ---------------------------------------------------------------- reading

/** The declared links of the lens and spine profiles: drawn by `worldGraph`, never named on a card. */
const DECLARED = new Set(['x_lens_leads_to', 'x_spine_depends_on']);

/** A work item's typed links: the Relation's link field for each type it can be about (`actor` is whom it is for). */
const ITEM_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['characters', 'character'], ['objects', 'object'], ['locations', 'location'], ['species', 'species'], ['creatures', 'creature'],
  ['institutions', 'institution'], ['traits', 'trait'], ['collectives', 'collective'], ['zones', 'zone'], ['abilities', 'ability'],
  ['phenomena', 'phenomenon'], ['languages', 'language'], ['families', 'family'], ['titles', 'title'], ['constructs', 'construct'],
  ['narratives', 'narrative'], ['events', 'event'],
];

const DESIGN_WORD: Readonly<Record<string, string>> = { 'in design': 'In design', locked: 'Locked' };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const nameOf = (v: unknown): string | null => text(v) || null;

/** The graph's nodes and edges by id, built once per graph (the graph is handed in whole and never changed). */
interface Index {
  nodes: Map<string, CardGraphNode>;
  out: Map<string, CardGraphEdge[]>;
  in: Map<string, CardGraphEdge[]>;
}
const indexes = new WeakMap<CardGraph, Index>();
function indexOf(graph: CardGraph): Index {
  let ix = indexes.get(graph);
  if (ix) return ix;
  ix = { nodes: new Map(graph.nodes.map(n => [n.id, n])), out: new Map(), in: new Map() };
  for (const e of graph.edges) {
    if (e.source === e.target || DECLARED.has(e.field)) continue;
    const o = ix.out.get(e.source);
    if (o) o.push(e); else ix.out.set(e.source, [e]);
    const i = ix.in.get(e.target);
    if (i) i.push(e); else ix.in.set(e.target, [e]);
  }
  indexes.set(graph, ix);
  return ix;
}

/** Whether this reader has a card for `id`: the one test every opener asks before it draws a press. */
export function cardable(graph: CardGraph, id: string): boolean {
  return indexOf(graph).nodes.has(id);
}

/** The world's word for a type (by the element's supertype first), else the type's own, capitalised. */
export function kindWord(names: unknown, type: string, supertype?: unknown): string {
  const own = names ? typeWord({ x_names: names }, type, { supertype: typeof supertype === 'string' ? supertype : null }) : null;
  return own || (type.charAt(0).toUpperCase() + type.slice(1));
}

/** The marks a node carries; a stub by the graph's own word or by the row keel served (a reader whose graph says none). */
function marksOf(node: CardGraphNode, row: CardRow | undefined): CardMarks {
  const m = node.marks ?? [];
  return { knownOf: node.known_of === true || row?.known_of === true, hidden: m.includes('hidden'), proposed: m.includes('proposed') };
}

function trimmedFields(row: CardRow | undefined): Set<string> {
  const v = row?.x_served_trimmed;
  return new Set(Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string' && !!f) : []);
}

/** One element a work item is about. */
export interface QuestionTarget {
  /** The type as the packet writes it, or the type its typed link field holds. */
  type: string;
  id: string;
  /** The packet's one sentence on why; null for a typed link. */
  reason: string | null;
  /** In this world: a packet's entry when the packet is about this world (or names none), a typed link always. */
  here: boolean;
}

/**
 * The elements a work item is about, the one rule for a card's questions and a tool's list of work: first its packet's
 * entries (`x_packet_elements`, each with its type, id and reason all strings and the id not blank), in their order,
 * in this world unless `x_packet_source` names another; then its typed links (each a Relation link field, an id each
 * once) that the packet does not name, always in this world (keel checks a typed link against it).
 */
export function questionTargets(item: CardRow, worldId: string): QuestionTarget[] {
  const out: QuestionTarget[] = [];
  const src = item.x_packet_source as { world?: unknown } | null | undefined;
  const here = !(!!src && typeof src === 'object' && typeof src.world === 'string' && src.world !== worldId);
  const packet = item.x_packet_elements;
  const named = new Set<string>();
  if (Array.isArray(packet)) {
    for (const e of packet) {
      const r = e && typeof e === 'object' ? e as Record<string, unknown> : null;
      if (!r || typeof r.type !== 'string' || typeof r.id !== 'string' || typeof r.reason !== 'string' || r.id.trim() === '') continue;
      out.push({ type: r.type, id: r.id, reason: r.reason, here });
      named.add(r.id);
    }
  }
  for (const [field, type] of ITEM_LINKS) {
    const v = item[field];
    if (!Array.isArray(v)) continue;
    for (const id of v) {
      if (typeof id !== 'string' || id === '' || named.has(id)) continue;
      named.add(id);
      out.push({ type, id, reason: null, here: true });
    }
  }
  return out;
}

const time = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/** The card for `id`, or null when this reader has none (the id is not a node of its graph). */
export function cardModel(input: CardInput): CardModel | null {
  const ix = indexOf(input.graph);
  const node = ix.nodes.get(input.id);
  if (!node) return null;
  const row = input.rows.get(input.id);
  const type = node.type;
  const kind = kindWord(input.names, type, row?.supertype);
  const titleOf = (name: string | null, t: string, sup: unknown): string => name ?? `${kindWord(input.names, t, sup)} with no name`;
  const name = nameOf(node.name);
  const linkOf = (id: string): CardLink => {
    const n = ix.nodes.get(id)!;
    const nm = nameOf(n.name);
    const r = input.rows.get(id);
    return { id, type: n.type, name: nm, title: titleOf(nm, n.type, r?.supertype), marks: marksOf(n, r) };
  };
  const order = (a: CardLink, b: CardLink): number => byCodePoint(a.name ?? '', b.name ?? '') || byCodePoint(a.id, b.id);

  // Out: the element's own fields, in the schema's order for its type; a field the schema does not know after, by name.
  const trimmed = trimmedFields(row);
  const fieldOrder = Object.keys((FIELD_SCHEMA as Record<string, Record<string, unknown>>)[type] ?? {});
  const rank = (f: string): number => { const i = fieldOrder.indexOf(f); return i < 0 ? fieldOrder.length : i; };
  const outBy = new Map<string, string[]>();
  for (const e of ix.out.get(input.id) ?? []) { const l = outBy.get(e.field); if (l) { if (!l.includes(e.target)) l.push(e.target); } else outBy.set(e.field, [e.target]); }
  const outGroups: CardGroup[] = [...outBy].sort(([a], [b]) => rank(a) - rank(b) || byCodePoint(a, b)).map(([field, ids]) => ({
    key: `out:${field}`, field, dir: 'out', label: fieldLabel(field), trimmed: trimmed.has(field), links: ids.map(linkOf).sort(order),
  }));
  // In: by field name; the Objects under it are the incoming parent_object group.
  const inBy = new Map<string, string[]>();
  for (const e of ix.in.get(input.id) ?? []) { const l = inBy.get(e.field); if (l) { if (!l.includes(e.source)) l.push(e.source); } else inBy.set(e.field, [e.source]); }
  const inGroups: CardGroup[] = [...inBy].sort(([a], [b]) => byCodePoint(a, b)).map(([field, ids]) => ({
    key: `in:${field}`, field, dir: 'in', label: field === 'parent_object' ? 'Under it' : `Linked from · ${fieldLabel(field)}`, trimmed: false, links: ids.map(linkOf).sort(order),
  }));

  // The open questions on it.
  const hiddenList = new Set(input.roomHidden ?? []);
  const items: Array<CardQuestion & { at: number }> = [];
  const seen = new Set<string>();
  for (const w of input.work) {
    if (!w || typeof w.id !== 'string' || seen.has(w.id)) continue;
    seen.add(w.id);
    if (!isRoomElement(w as Parameters<typeof isRoomElement>[0]) || !isOpenWork(w) || handsOnAsProposed(w)) continue;
    const hidden = w.hidden === true || hiddenList.has(w.id);
    if (hidden && !input.flags.hidden) continue;
    if (!questionTargets(w, input.worldId).some(t => t.here && t.id === input.id)) continue;
    const nm = nameOf(w.name);
    items.push({ id: w.id, name: nm, title: nm ?? 'Work item with no name', state: workStateOf(w) === 'taken' ? 'taken' : 'open', hidden, at: time(w.created_at) });
  }
  // Newest first, a tie by id.
  items.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0) || byCodePoint(a.id, b.id));

  let design: string | null = null;
  for (const p of input.parts ?? []) if (p.id === input.id) { design = DESIGN_WORD[p.state] ?? p.state; break; }
  const words = text(row?.description) || text(row?.story);
  const cut = words.search(/\r?\n/);
  return {
    id: input.id,
    type,
    kind,
    name,
    title: titleOf(name, type, row?.supertype),
    state: design ?? (text(row?.subtype) || text(row?.supertype)),
    lead: cut < 0 ? words : words.slice(0, cut).trim(),
    rest: cut < 0 ? '' : words.slice(cut).trim(),
    marks: { ...marksOf(node, row), trimmed: trimmed.size > 0 },
    groups: [...outGroups, ...inGroups],
    questions: {
      state: input.workRead,
      cap: input.workRead === 'capped' && typeof input.cap === 'number' ? input.cap : null,
      items: items.map(({ at: _at, ...q }) => q),
    },
  };
}
