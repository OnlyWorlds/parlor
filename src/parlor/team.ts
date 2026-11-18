/**
 * A world's team: its people, the AI seats each answers for, and the AI seats no one answers for; and a
 * member's newest Note. Vendored from the OnlyWorlds Dashboard (github.com/OnlyWorlds/dashboard, main at
 * 8e1d9d31f72bf31aa1150992e850f0a30a436316, `src/dash/team.ts` and the helpers it needs from `src/dash/read.ts`):
 * the same rule in both tools, so a team reads the same everywhere. Change it there first and copy it here;
 * only the comments are this file's own.
 *
 * Everything attaches by the writer's roster row (`created_by`, null for the owner), never by the Character a
 * line names: two rows can play one Character, so a Character says nothing about who wrote.
 */

import { instantOf, isRoomElement, proposedMarkOf, senderStatus, type OwElement, type OwMember, type OwSender } from '@onlyworlds/sdk';

// ---------------------------------------------------------------- the read helpers (dashboard src/dash/read.ts)

/** A room element (the room profile's pairs and its mark) is the room, never a Note. */
export function shown(el: OwElement): boolean {
  return !isRoomElement(el);
}

/** Proposed, by the review profile: `x_review_proposed` an object with something in it. */
export function isProposed(el: OwElement): boolean {
  return proposedMarkOf(el) !== null;
}

/** Hidden: `hidden` anything but absent, null or false. */
export function isHidden(el: OwElement): boolean {
  const v = (el as Record<string, unknown>).hidden;
  return v !== undefined && v !== null && v !== false;
}

/** A sign-in name shaped as an email address: never drawn as a person's name. */
export function isEmail(name: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(name.trim());
}

/** Who sent a Message, by the message profile's three answers (the SDK's `senderStatus`). */
export function senderOf(el: OwElement, members: readonly OwMember[]): OwSender {
  return senderStatus(el, members);
}

/** A served time as milliseconds since 1970 UTC, or null when it cannot be read (the SDK's `instantOf`). */
export function servedTime(v: unknown): number | null {
  const t = instantOf(v);
  return t === null ? null : t.seconds * 1000 + t.microseconds / 1000;
}

// ---------------------------------------------------------------- the team (dashboard src/dash/team.ts)

/** A roster row's key: its membership id, or `owner` for the world's owner (keel's null). */
export type MemberKey = string;
export const OWNER: MemberKey = 'owner';
export const keyOf = (membership: unknown): MemberKey => (typeof membership === 'string' && membership ? membership : OWNER);

/**
 * `ownName` is the AI's own name: its own Character's (never a person's), else its seat's, else "An AI". `seat` is the
 * seat's own name as keel serves it (null only when it serves none). `as`: `person` when it plays its own person's
 * Character and that person has a real name: it is then named by its person; else `self`.
 */
export interface TeamAi { key: MemberKey; ownName: string; character: string | null; seat: string | null; as: 'self' | 'person' }
/**
 * `name` leads with their Character's name, else the username keel serves the owner and co-builders, else "The owner"
 * or "A member"; `username` is that served name, `role` the roster's.
 */
export interface TeamPerson { key: MemberKey; character: string | null; name: string; username: string | null; /** The reader's own row, whose username this browser knows. */ ownName?: boolean; role: string; you: boolean; ais: TeamAi[] }
export interface Team { people: TeamPerson[]; unattached: TeamAi[] }

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Every active owner and person row, the reader first, then A to Z; each AI seat under the person keel says answers
 * for it: the row's own `sponsor_member` (served to every reader: a membership id, `owner`, or null), and `my_seats`
 * for the reader's own. A seat the two disagree on, or that neither names, stands unattached: never placed by
 * inference. Player seats are not on the team.
 */
export function buildTeam(o: {
  members: readonly OwMember[];
  me: MemberKey;
  /** The signed-in account's own username: the reader knows their own name even where keel serves no names. */
  myUsername?: string;
  mySeats: readonly { id: string }[];
  nameOf: (character: string | null) => string;
  /** A Character's name when it is known, with no fallback: an AI's row leads with it. */
  charName?: (character: string | null) => string | null;
}): Team {
  const active = o.members.filter(m => m.status !== 'removed');
  const charOf = o.charName ?? ((c: string | null) => (c ? o.nameOf(c) : null));
  // The people named by a real name (a Character, a served username, the reader's own): never by a fallback.
  const named = new Set<MemberKey>();
  const people: TeamPerson[] = active
    .filter(m => m.kind === 'owner' || m.kind === 'person')
    .map(m => {
      // keel names a person row only to the owner's keys and co-builders; an owner row never.
      const you = keyOf(m.id) === o.me;
      // A sign-in name that is an email address names no one on the page: "A member" until a Character.
      const served = (m.kind === 'person' && typeof m.name === 'string' && m.name.trim()) || null;
      const username = served && !isEmail(served) ? served : null;
      // The reader's own username names only their own row, and only where nothing else does.
      const own = you && o.myUsername?.trim() && !isEmail(o.myUsername.trim()) ? o.myUsername.trim() : null;
      const real = charOf(m.character ?? null) || username || own;
      if (real) named.add(keyOf(m.id));
      const name = real || (m.kind === 'owner' ? 'The owner' : 'A member');
      return { key: keyOf(m.id), character: m.character ?? null, name, username, ownName: !!own, role: typeof m.role === 'string' ? m.role : '', you, ais: [] };
    });
  people.sort((a, b) => Number(b.you) - Number(a.you) || collator.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byKey = new Map(people.map(p => [p.key, p]));
  const personChars = new Set(people.map(p => p.character).filter((c): c is string => !!c));
  const mine = new Set(o.mySeats.map(s => s.id));
  const unattached: TeamAi[] = [];
  for (const m of active) {
    if (m.kind !== 'agent' || typeof m.id !== 'string') continue;
    const seatName = (typeof m.name === 'string' && m.name.trim()) || null;
    // A Character a person plays is that person's name (keel lets an AI play it too): the seat's name leads then.
    const charName = m.character && !personChars.has(m.character) ? o.charName?.(m.character) || null : null;
    // Never a person's name, never 'A member': an AI with no name of its own and none to borrow is 'An AI'.
    const ownName = charName || seatName || 'An AI';
    const ai: TeamAi = { key: m.id, ownName, character: m.character ?? null, seat: seatName, as: 'self' };
    // keel's `owner` is the owner's row (OWNER); null or absent names no one.
    const sponsor = typeof m.sponsor_member === 'string' && m.sponsor_member ? keyOf(m.sponsor_member) : undefined;
    let owner: MemberKey | undefined;
    if (mine.has(m.id)) owner = sponsor === undefined || sponsor === o.me ? o.me : undefined;
    else owner = sponsor;
    const person = owner !== undefined ? byKey.get(owner) : undefined;
    if (person) {
      // It plays its own person's Character, and that person has a real name: it is named by its person.
      if (ai.character !== null && ai.character === person.character && named.has(person.key)) ai.as = 'person';
      person.ais.push(ai);
    } else unattached.push(ai);
  }
  const byOwn = (a: TeamAi, b: TeamAi) => collator.compare(a.ownName, b.ownName) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const p of people) p.ais.sort(byOwn);
  unattached.sort(byOwn);
  return { people, unattached };
}

/** Written and last changed by the same hand: a co-builder's edit never speaks for the writer. */
export function ownHand(el: OwElement): boolean {
  return !('changed_by' in el) || el.changed_by === undefined || keyOf(el.changed_by) === keyOf(el.created_by);
}

function stamp(el: OwElement, field: 'updated_at' | 'created_at' = 'updated_at'): number {
  return servedTime(el[field]) ?? -Infinity;
}

/**
 * A member's newest Note: a Narrative with supertype `Note` that they wrote, by their own hand, its sender verified,
 * neither hidden, proposed, a room element nor a stub; newest by `created_at` (a new Note, never a fresh edit, is news).
 * `notes` may hold anyone's, in any order.
 */
export function newestNote(notes: readonly OwElement[], writer: MemberKey, members: readonly OwMember[]): OwElement | null {
  let best: OwElement | null = null;
  for (const el of notes) {
    if (el.type !== 'narrative' || el.supertype !== 'Note' || el.known_of === true) continue;
    if (keyOf(el.created_by) !== writer || !ownHand(el)) continue;
    if (!shown(el) || isHidden(el) || isProposed(el)) continue;
    if (senderOf(el, members).status !== 'verified') continue;
    if (!best || stamp(el, 'created_at') > stamp(best, 'created_at')) best = el;
  }
  return best;
}

/** "4h", "2d", "3w" for a Note's age; `stale` past seven days. */
export function age(iso: unknown, now = Date.now()): { text: string; stale: boolean } | null {
  const t = servedTime(iso);
  if (t === null) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  const text = mins < 60 ? `${Math.max(1, mins)}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : mins < 14 * 1440 ? `${Math.floor(mins / 1440)}d` : `${Math.floor(mins / 10080)}w`;
  return { text, stale: mins > 7 * 1440 };
}
