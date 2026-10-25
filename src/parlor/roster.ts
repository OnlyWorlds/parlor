/**
 * Who a seat is, for the room: a name and whether it is an AI. Pure.
 *
 * The AI mark reads the roster's `kind` for the seat that made the thing, the
 * door only as the fallback (design sheet §1; Atlas's rule since 1.68.1,
 * Temper h66 #9602): keel's MCP accepts a person's own key, and a person's
 * write through it is still a person's.
 *
 * A name comes from the seat's roster Character, else the Character the person
 * made for the room (supertype Member), else an agent row's own name.
 */

import { isAgentDoor, type OwMember, type OwWriteDoor } from '@onlyworlds/sdk';
import { OWNER, type El } from './shapes';

export type RoomRole = 'host' | 'co-host' | 'member' | 'watcher';

/** The seat's role in the room words of the sheet's table. */
export function roomRole(role: string | null | undefined): RoomRole {
  switch (role) {
    case 'owner': return 'host';
    case 'co_builder': return 'co-host';
    case 'contributor': return 'member';
    default: return 'watcher';
  }
}

export function canHost(role: RoomRole): boolean {
  return role === 'host' || role === 'co-host';
}

export function canWrite(role: RoomRole): boolean {
  return role !== 'watcher';
}

function rowFor(by: string, roster: readonly OwMember[] | null): OwMember | null {
  if (!roster) return null;
  const id = by === OWNER ? null : by;
  return roster.find(m => m.id === id) ?? null;
}

export function isAiSeat(by: string, roster: readonly OwMember[] | null, door?: string | null): boolean {
  const row = rowFor(by, roster);
  if (row) return row.kind === 'agent';
  if (by === OWNER && roster) return false;
  return isAgentDoor((door ?? null) as OwWriteDoor | null);
}

const CLIENT_NAMES: Readonly<Record<string, string>> = { atlas: 'Atlas', lantern: 'Lantern', council: 'the Council', sdk: 'a script' };

/**
 * Which door a room thing came through, when it is not the parlor's own (sheet §1: "who and which
 * door on each row"): MCP and the site by keel's `changed_via`, else the tool's own claimed name,
 * `changed_client` (keel #520; the parlor names itself 'parlor'). Null for the parlor and for none.
 */
export function doorLine(el: Pick<El, 'changed_via' | 'changed_client'>): string | null {
  if (el.changed_via === 'mcp') return 'through MCP';
  if (el.changed_via === 'site') return 'on onlyworlds.com';
  const client = typeof el.changed_client === 'string' ? el.changed_client : '';
  if (!client || client === 'parlor') return null;
  return `through ${CLIENT_NAMES[client] ?? client}`;
}

export interface Seat {
  by: string;
  name: string;
  ai: boolean;
  role: RoomRole;
  removed: boolean;
}

export function nameOf(
  by: string,
  roster: readonly OwMember[] | null,
  els: ReadonlyMap<string, El>,
  members: ReadonlyMap<string, { id: string; name: string }>,
): string {
  const row = rowFor(by, roster);
  const ch = row?.character ? els.get(row.character) : undefined;
  const fromCharacter = (ch?.name ?? '').toString().trim();
  if (fromCharacter) return fromCharacter;
  const own = members.get(by)?.name.trim();
  if (own) return own;
  const agent = typeof row?.name === 'string' ? row.name.trim() : '';
  if (agent) return agent;
  return by === OWNER ? 'The host' : 'A member';
}

/** Every seat on the roster, hosts first, the removed left out. */
export function seats(
  roster: readonly OwMember[] | null,
  els: ReadonlyMap<string, El>,
  members: ReadonlyMap<string, { id: string; name: string }>,
): Seat[] {
  const order: Record<RoomRole, number> = { host: 0, 'co-host': 1, member: 2, watcher: 3 };
  return (roster ?? [])
    .map(m => {
      const by = m.id ?? OWNER;
      return { by, name: nameOf(by, roster, els, members), ai: m.kind === 'agent', role: roomRole(m.role), removed: m.status === 'removed' };
    })
    .filter(s => !s.removed)
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}
