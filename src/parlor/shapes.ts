/**
 * The parlor's shapes (design sheet §1, draft 5): what each room thing is as an
 * element, read out of a world's elements and written back. Pure: no network,
 * no DOM, so every rule here has a unit test.
 *
 *   a line      Narrative, supertype Message: narrator the poster's Character, parent_narrative the line it answers
 *   a spec      Construct, supertype Spec: its owner's own element; the winner has subtype star
 *   a heart     Relation,  supertype Heart: actor the hearter, constructs the spec; one per person per target
 *   a vote      Relation,  supertype Vote: actor the voter, constructs the picks in order
 *   a sitting   Event,     supertype Sitting: subtype the phase; the switches as x_ fields
 *   the charter Law,       supertype Charter
 *   a member    Character, supertype Member: a person's own name in the room when their seat has no
 *               Character (an invite link gives a person none; h66 #9720, until keel's roster names them)
 *
 * Who made a thing is `created_by` (a membership id, null for the world's owner),
 * never a name in its text.
 */

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

/** The room's supertypes: what a tool that shows a world whole leaves out (sheet §1). */
export const ROOM_SUPERTYPES: readonly string[] = Object.values(SUPERTYPE);

function isA(el: El, type: string, supertype: string): boolean {
  return el.type === type && (el.supertype ?? '').trim().toLowerCase() === supertype.toLowerCase();
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

export function newLine(text: string, narrator: string | null, parent: string | null = null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: lineName(text),
    description: text,
    supertype: SUPERTYPE.line,
  };
  if (narrator) body.narrator = narrator;
  if (parent) body.parent_narrative = parent;
  return body;
}

// ---------------------------------------------------------------- specs and hearts

export interface Spec {
  id: string;
  title: string;
  text: string;
  by: string;
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

export function readSpecs(els: Iterable<El>, hearts: readonly Heart[]): Spec[] {
  const counts = heartCounts(hearts);
  const out: Spec[] = [];
  for (const el of els) {
    if (!isA(el, 'construct', SUPERTYPE.spec)) continue;
    out.push({
      id: el.id,
      title: (el.name ?? '').toString(),
      text: (el.description ?? '').toString(),
      by: whoMade(el),
      star: (el.subtype ?? '').toLowerCase() === 'star',
      hearts: counts.get(el.id) ?? 0,
      at: el.created_at ?? '',
    });
  }
  return out.sort((a, b) => Number(b.star) - Number(a.star) || b.hearts - a.hearts || a.at.localeCompare(b.at));
}

export function newSpec(title: string, text: string): Record<string, unknown> {
  return { name: title.trim(), description: text, supertype: SUPERTYPE.spec };
}

export function newHeart(target: string, targetName: string, actor: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: `Heart for ${targetName}`.slice(0, 200),
    supertype: SUPERTYPE.heart,
    constructs: [target],
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

export function newVote(picks: readonly string[], actor: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: 'Vote',
    supertype: SUPERTYPE.vote,
    constructs: [...new Set(picks)].slice(0, 3),
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
  feedStart: number | null;
  at: string;
  by: string;
}

/** The old tool's seven, each a set of switches, never a position in a list (sheet §2). */
export const PHASES: ReadonlyArray<{ name: string } & Switches> = [
  { name: 'Lobby', hearts: false, specs: false, voting: false },
  { name: 'Welcome', hearts: false, specs: false, voting: false },
  { name: 'Parsing', hearts: true, specs: false, voting: false },
  { name: 'Design', hearts: true, specs: true, voting: false },
  { name: 'Voting', hearts: true, specs: true, voting: true },
  { name: 'Build', hearts: true, specs: true, voting: false },
  { name: 'Showcase', hearts: true, specs: true, voting: false },
];

export const SWITCH_FIELDS = { hearts: 'x_hearts_on', specs: 'x_specs_shown', voting: 'x_voting_open' } as const;
export const FEED_START_FIELD = 'x_feed_start';

/** All sittings, oldest first; the room shows the newest. */
export function readSittings(els: Iterable<El>): Sitting[] {
  const out: Sitting[] = [];
  for (const el of els) {
    if (!isA(el, 'event', SUPERTYPE.sitting)) continue;
    const start = el[FEED_START_FIELD];
    out.push({
      id: el.id,
      phase: (el.subtype ?? '').toString() || 'Lobby',
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

export function newSitting(name: string, feedStart: number): Record<string, unknown> {
  const lobby = PHASES[0];
  return {
    name,
    supertype: SUPERTYPE.sitting,
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

/** Lines of one sitting: made at or after its start and before the next one's. */
export function linesOfSitting(lines: readonly Line[], sittings: readonly Sitting[], sittingId: string | null): Line[] {
  if (!sittingId) return [...lines];
  const i = sittings.findIndex(s => s.id === sittingId);
  if (i < 0) return [...lines];
  const from = sittings[i].at;
  const to = sittings[i + 1]?.at ?? null;
  return lines.filter(l => l.at >= from && (to === null || l.at < to));
}

// ---------------------------------------------------------------- the charter

export interface Charter {
  id: string;
  name: string;
  text: string;
}

export function readCharter(els: Iterable<El>): Charter | null {
  for (const el of els) {
    if (isA(el, 'law', SUPERTYPE.charter)) {
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

export function newMember(name: string): Record<string, unknown> {
  return { name: name.trim(), supertype: SUPERTYPE.member };
}
