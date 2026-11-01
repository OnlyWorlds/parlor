import { describe, expect, it } from 'vitest';
import { TOOLS } from '@onlyworlds/sdk';
import { littleLensOpens, waymarkPlan } from './waymark';

const world = { id: '0f0f0f0f-0000-4000-8000-00000000a1a1', name: 'Harbour Co' };
const ID = '66666666-6666-4666-8666-000000000006';

describe('waymarkPlan', () => {
  it("gives the world's own mark with no element", () => {
    expect(waymarkPlan(world, null)).toEqual({ world, element: null });
  });

  it('passes the element as served, its doors and all', () => {
    const doors = [{ client: 'atlas', at: '2026-10-31T10:00:00Z' }];
    const p = waymarkPlan(world, { id: ID, type: 'narrative', name: 'Ferry rota', supertype: 'Board', doors });
    expect(p?.element).toMatchObject({ id: ID, type: 'narrative', name: 'Ferry rota', doors });
    expect(p?.world).toEqual(world);
  });

  it('names an unnamed element as the page does', () => {
    expect(waymarkPlan(world, { id: ID, type: 'location', name: '' })?.element?.name).toBe('(no name)');
    expect(waymarkPlan(world, { id: ID, type: 'location' })?.element?.name).toBe('(no name)');
  });

  it('draws nothing without an id or a type, or without a world', () => {
    expect(waymarkPlan(world, { type: 'location', name: 'x' })).toBeNull();
    expect(waymarkPlan(world, { id: ID, name: 'x' })).toBeNull();
    expect(waymarkPlan(world, { id: 7, type: 'location', name: 'x' })).toBeNull();
    expect(waymarkPlan({ id: '', name: 'x' }, null)).toBeNull();
  });

  it('never carries more of the world than its id and name', () => {
    const p = waymarkPlan({ ...world, extra: 'secret' } as typeof world, null);
    expect(Object.keys(p!.world).sort()).toEqual(['id', 'name']);
  });
});

describe('littleLensOpens (its element page reads only what its graph keeps)', () => {
  const base = { id: ID, type: 'character', name: 'Ada' };
  it('opens a plain element', () => {
    expect(littleLensOpens(base)).toBe(true);
    expect(waymarkPlan(world, base)?.tools).toBeUndefined();
  });
  it('leaves out a map part, a hidden, a proposed and a room element', () => {
    for (const type of ['map', 'pin', 'marker', ' Pin ']) expect(littleLensOpens({ ...base, type })).toBe(false);
    expect(littleLensOpens({ ...base, hidden: true })).toBe(false);
    expect(littleLensOpens({ ...base, hidden: 'by the keeper' })).toBe(false);
    expect(littleLensOpens({ ...base, hidden: false })).toBe(true);
    expect(littleLensOpens({ ...base, hidden: null })).toBe(true);
    expect(littleLensOpens({ ...base, x_review_proposed: { by: 'm-1', evidence: 'x', expires: '2026-12-31' } })).toBe(false);
    expect(littleLensOpens({ id: ID, type: 'narrative', name: 'Rota', supertype: 'Board', x_room_of: world.id })).toBe(false);
  });
  it('a plan for one it cannot open offers every row but Little Lens', () => {
    const p = waymarkPlan(world, { id: ID, type: 'narrative', name: 'Rota', supertype: 'Board', x_room_of: world.id });
    expect(TOOLS.map(t => t.id)).toContain('little-lens');
    expect(p?.tools?.map(t => t.id)).not.toContain('little-lens');
    expect(p?.tools?.length).toBeGreaterThan(0);
  });
});
