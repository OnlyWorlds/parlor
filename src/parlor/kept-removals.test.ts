// The names of removed elements a browser keeps (Changes): kept per world and per reader, never shown to another
// account in the same browser, and gone on Sign out.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
});

import type { OwMe, OwV2Client } from '@onlyworlds/sdk';
import { Room } from './room';
import { session } from './session';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

function room(membership: string | null): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: WORLD, name: 'Team ground' }, {} as OwV2Client);
  r.me = { role: membership ? 'contributor' : 'owner', scope: 'write', membership } as unknown as OwMe;
  return r;
}
const keep = (r: Room) => (r as unknown as { keepRemovals(): void }).keepRemovals();
const seed = (r: Room) => (r as unknown as { seedRemovals(): void }).seedRemovals();

describe('the removed names a browser keeps', () => {
  it('are the reader\'s own: another account opening the same world in this browser is not shown them', () => {
    localStorage.clear();
    const owner = room(null);
    owner.feed.removals.set('x', { id: 'x', type: 'object', name: 'A place only the owner saw', room: false, by: null, via: 'site', client: null, at: '2026-11-18T20:00:00Z' });
    keep(owner);
    const member = room('m-2');
    seed(member);
    expect(member.feed.removals.size).toBe(0);
    const again = room(null);
    seed(again);
    expect(again.feed.removals.get('x')?.name).toBe('A place only the owner saw');
  });

  it('go on Sign out, with nothing else the browser keeps for the parlor', () => {
    localStorage.clear();
    localStorage.setItem('parlor.session.v1', JSON.stringify({ token: 'ow_a_' + 't'.repeat(40), login: 'ada', keys: {} }));
    const owner = room(null);
    owner.feed.removals.set('x', { id: 'x', type: 'object', name: 'Kept', room: false, by: null, via: 'site', client: null, at: '2026-11-18T20:00:00Z' });
    keep(owner);
    localStorage.setItem('parlor.folds.' + WORLD, '[]');
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some(k => k?.startsWith('parlor.removed.'))).toBe(true);
    session.signOut();
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k?.startsWith('parlor.removed.'))).toEqual([]);
    expect(localStorage.getItem('parlor.folds.' + WORLD)).toBe('[]');
  });
});
