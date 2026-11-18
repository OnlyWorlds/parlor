// A team world's writes and reads on the Room, against a fake client: a line carries the sitting's mark only while a
// workshop runs; a workshop world writes as it always has; End the workshop turns each switch that is on off; a line
// written in a seat's room names the seat's Character; the room reads every sitting's lines.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
  (globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
});

import type { OwMe, OwV2Client } from '@onlyworlds/sdk';
import { Room } from './room';
import { roomRole } from './roster';
import type { El } from './shapes';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

type Call = { op: 'patch' | 'create'; type: string; id: string; body: Record<string, unknown> };
let calls: Call[];
let current: Room | null = null;

const fake = {
  async patch(type: string, id: string, body: Record<string, unknown>) {
    calls.push({ op: 'patch', type, id, body });
    return { ...(current?.els.get(id) ?? {}), id, type, ...body };
  },
  async create(type: string, body: Record<string, unknown>) {
    const id = `new-${calls.length}`;
    calls.push({ op: 'create', type, id, body });
    return { ...body, id, type } as El;
  },
  async changesHead() { return { head: 1, cursor: 'c', epoch: null }; },
};

function room(opts: { charter?: boolean; sitting?: Partial<El> | null; role?: 'owner' | 'contributor' } = {}): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: WORLD, name: 'Team ground' }, fake as unknown as OwV2Client);
  const role = opts.role ?? 'owner';
  r.me = { role, scope: 'write', membership: role === 'owner' ? null : 'm-1', character: 'c-me' } as unknown as OwMe;
  r.role = roomRole(role);
  r.charterAtOpen = opts.charter ? 'law-1' : null;
  current = r;
  if (opts.sitting !== null) {
    r.feed.els.set('s1', { id: 's1', type: 'event', supertype: 'Sitting', name: 'Sitting', subtype: 'Arrive', x_room_of: WORLD, created_at: '2026-11-18T09:00:00Z',
      x_hearts_on: false, x_specs_shown: false, x_voting_open: false, ...(opts.sitting ?? {}) } as El);
  }
  return r;
}

const settle = () => new Promise(res => setTimeout(res, 0));

beforeEach(() => { calls = []; });

describe('the sitting mark in a team world', () => {
  it('a line carries the world\'s mark while no workshop runs', async () => {
    const r = room({ charter: true });
    await r.post('hello');
    expect(calls[0].body.x_room_of).toBe(WORLD);
    expect(calls[0].body.characters).toBeUndefined();
  });

  it('a line carries the sitting\'s mark while a switch is on', async () => {
    const r = room({ charter: true, sitting: { x_hearts_on: true } });
    await r.post('hello');
    expect(calls[0].body.x_room_of).toBe('s1');
  });

  it('a board entry and a work item written outside a workshop carry the world\'s mark', async () => {
    const r = room({ charter: true });
    await r.raise('Waits', '', 'red', null);
    await r.makeWork('Do it', '', null, []);
    expect(calls.map(c => c.body.x_room_of)).toEqual([WORLD, WORLD]);
  });

  it('a free report hangs on no sitting while no workshop runs', () => {
    const r = room({ charter: true });
    const body = r.reportBody('Did a thing', {}, null)!;
    expect(body.events).toBeUndefined();
    expect(body.x_room_of).toBe(WORLD);
  });

  it('a spec still belongs to the newest sitting', async () => {
    const r = room({ charter: true, sitting: { x_specs_shown: true } });
    await r.saveSpec('A tool', 'text', 'Tool');
    expect(calls[0].body.x_room_of).toBe('s1');
  });
});

describe('a workshop world writes as it always has', () => {
  it('a line carries the newest sitting\'s mark with every switch off', async () => {
    const r = room({ charter: false });
    await r.post('hello');
    expect(calls[0].body.x_room_of).toBe('s1');
    expect(r.teamWorld).toBe(false);
  });

  it('a free report hangs on the newest sitting', () => {
    const r = room({ charter: false });
    expect(r.reportBody('Did a thing', {}, null)!.events).toEqual(['s1']);
  });
});

describe('a seat\'s room and a reply', () => {
  it('a line written in a seat\'s room names the seat\'s Character, and a reply writes parent_narrative', async () => {
    const r = room({ charter: true });
    await r.post('to you', { link: 'parent_narrative', id: 'line-1' }, [], 'c-vonkje');
    expect(calls[0].body.characters).toEqual(['c-vonkje']);
    expect(calls[0].body.parent_narrative).toBe('line-1');
    expect(Object.keys(calls[0].body).sort()).toEqual(['characters', 'name', 'narrator', 'parent_narrative', 'story', 'supertype', 'x_room_of']);
  });
});

describe('End the workshop', () => {
  it('turns each switch that is on off, by the switch\'s own write, and leaves the phase', async () => {
    const r = room({ charter: true, sitting: { subtype: 'Vote', x_hearts_on: true, x_specs_shown: true, x_voting_open: true } });
    expect(r.workshopRuns).toBe(true);
    await r.endWorkshop();
    await settle();
    expect(calls.map(c => c.body)).toEqual([{ x_hearts_on: false }, { x_specs_shown: false }, { x_voting_open: false }]);
    expect(r.workshopRuns).toBe(false);
  });

  it('writes nothing when no switch is on', async () => {
    const r = room({ charter: true });
    await r.endWorkshop();
    expect(calls).toEqual([]);
  });
});

describe('the room\'s lines', () => {
  it('a team world reads every sitting\'s lines; a workshop world the newest sitting\'s', () => {
    for (const charter of [true, false]) {
      const r = room({ charter });
      r.feed.els.set('s2', { id: 's2', type: 'event', supertype: 'Sitting', name: 'S2', x_room_of: WORLD, created_at: '2026-11-18T11:00:00Z' } as El);
      r.feed.els.set('l1', { id: 'l1', type: 'narrative', supertype: 'Message', name: 'one', story: 'one', x_room_of: 's1', created_at: '2026-11-18T10:00:00Z' } as El);
      r.feed.els.set('l2', { id: 'l2', type: 'narrative', supertype: 'Message', name: 'two', story: 'two', x_room_of: WORLD, created_at: '2026-11-18T12:00:00Z' } as El);
      expect(r.lines().map(l => l.id)).toEqual(charter ? ['l1', 'l2'] : ['l2']);
    }
  });

  it('a marked Charter in the feed makes a team world when the front door named none', () => {
    const r = room({ charter: false });
    r.feed.els.set('law', { id: 'law', type: 'law', supertype: 'Charter', name: 'House rules', x_charter_of: WORLD } as El);
    expect(r.teamWorld).toBe(true);
  });
});
