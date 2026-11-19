// Played cases for a work item's address (`#/w/<world>/work/<item>`), on a Room whose feed walks a played OnlyWorlds
// server. The doors it plays, and only these: GET /changes (the first walk, from zero, the elements this key is served)
// and GET /changes?head=true. A walk can be told to fail, as an unreachable server does. Each case says how the room
// lands: its Answer open, read only, not here, or waiting for a read that is whole.
import { beforeEach, describe, expect, it } from 'vitest';
import type { OwMe, OwV2Client } from '@onlyworlds/sdk';
import { Room } from './room';
import { roomRole } from './roster';
import { ROOM_MARK, type El } from './shapes';
import { workArrival } from './address';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

/** What the played server serves this key, and whether its walk fails. */
let served: El[];
let failWalk: boolean;
let walks: number;

const keel = {
  async changesHead() { return { head: served.length, cursor: String(served.length), epoch: null }; },
  async *changesAll(since?: string) {
    walks++;
    if (failWalk) throw Object.assign(new Error('offline'), { status: 0 });
    if (since === undefined) {
      let seq = 0;
      for (const el of served) yield { op: 'upsert', id: el.id, type: el.type, element: { ...el }, updated_at: '', change_seq: ++seq };
    }
    return { cursor: String(served.length), head: served.length, epoch: null };
  },
};

type Role = 'owner' | 'contributor' | 'guest';
function room(role: Role): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: WORLD, name: 'Team ground' }, keel as unknown as OwV2Client);
  r.me = { role, scope: role === 'guest' ? 'read' : 'write', membership: role === 'owner' ? null : 'm-1', character: 'c-me' } as unknown as OwMe;
  r.role = roomRole(role);
  return r;
}
const item = (id: string, over: Partial<El> = {}): El =>
  ({ id, type: 'relation', name: `Item ${id}`, supertype: 'Work item', subtype: 'open', [ROOM_MARK]: WORLD, created_by: 'owner', change_seq: 1, created_at: '2026-11-19T08:00:00Z', ...over } as El);
/** How the room lands at `id`, as the room view asks it. */
const lands = (r: Room, id: string) => workArrival(id, r.work(), r.feed.walked, r.canWrite);

beforeEach(() => {
  served = [item('i-1'), item('i-2', { subtype: 'done' })];
  failWalk = false;
  walks = 0;
});

describe('a work item\'s address, on a played server', () => {
  it('a contributor at a served item: its Answer opens, done or open alike (the card\'s Answer shows on both)', async () => {
    const r = room('contributor');
    await r.feed.sync();
    expect(r.feed.walked).toBe(true);
    expect(lands(r, 'i-1')).toBe('answer');
    expect(lands(r, 'i-2')).toBe('answer');
  });

  it('a guest, served the item with a read key: read only, no composer', async () => {
    const r = room('guest');
    await r.feed.sync();
    expect(r.canWrite).toBe(false);
    expect(lands(r, 'i-1')).toBe('read');
  });

  it('an id the server does not serve this key (gone, a typo, another world\'s): not here, once the walk is whole', async () => {
    const r = room('contributor');
    await r.feed.sync();
    expect(lands(r, 'i-gone')).toBe('not-here');
    expect(lands(r, 'w9-item-of-another-world')).toBe('not-here');
  });

  it('a hidden item: served to the host, who lands on it; not served to a member, who reads not here', async () => {
    served = [item('i-1'), item('i-hid', { hidden: true } as Partial<El>)];
    const host = room('owner');
    await host.feed.sync();
    expect(lands(host, 'i-hid')).toBe('answer');
    served = [item('i-1')];
    const member = room('contributor');
    await member.feed.sync();
    expect(lands(member, 'i-hid')).toBe('not-here');
  });

  it('a first walk that fails says nothing yet, never not here over an unread list; the next walk that works lands', async () => {
    failWalk = true;
    const r = room('contributor');
    await r.feed.sync();
    expect(r.feed.lastError).not.toBeNull();
    expect(r.work()).toEqual([]);
    expect(r.feed.walked).toBe(false);
    expect(lands(r, 'i-1')).toBe('wait');
    expect(lands(r, 'i-gone')).toBe('wait');
    failWalk = false;
    await r.feed.sync();
    expect(walks).toBe(2);
    expect(lands(r, 'i-1')).toBe('answer');
    expect(lands(r, 'i-gone')).toBe('not-here');
  });

  it('a room not walked at all (no read run) waits too', () => {
    const r = room('owner');
    expect(lands(r, 'i-1')).toBe('wait');
  });
});
