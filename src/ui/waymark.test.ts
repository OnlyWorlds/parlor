import { describe, expect, it } from 'vitest';
import { TOOLS, openersFor } from '@onlyworlds/sdk';
import { waymarkPlan } from './waymark';

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

describe('the menu leaves out a tool whose door cannot open the element (the tools list\'s element_skips, SDK 4.126.0)', () => {
  const base = { id: ID, type: 'character', name: 'Ada' };
  const littleLens = (el: Record<string, unknown>) => {
    const p = waymarkPlan(world, el);
    return openersFor(TOOLS, 'element', { form: 'human', world: world.id, type: p!.element!.type, id: ID }, { audience: 'member' }, { element: p!.element }).some(r => r.id === 'little-lens');
  };
  it('offers Little Lens on a plain element', () => {
    expect(littleLens(base)).toBe(true);
    expect(littleLens({ ...base, hidden: false })).toBe(true);
    expect(littleLens({ ...base, hidden: null })).toBe(true);
  });
  it('leaves it out on a map part, a hidden, a proposed and a room element: the plan hands the marks on', () => {
    for (const type of ['map', 'pin', 'marker']) expect(littleLens({ ...base, type })).toBe(false);
    expect(littleLens({ ...base, hidden: true })).toBe(false);
    expect(littleLens({ ...base, hidden: 'by the keeper' })).toBe(false);
    expect(littleLens({ ...base, x_review_proposed: { by: 'm-1', evidence: 'x', expires: '2026-12-31' } })).toBe(false);
    expect(littleLens({ id: ID, type: 'narrative', name: 'Rota', supertype: 'Board', x_room_of: world.id })).toBe(false);
  });
});

describe("Tactical Tangle is offered where its doors open (the tools list's element_types, SDK 4.132.1)", () => {
  const tangle = (el: Record<string, unknown> | null) => {
    const p = waymarkPlan(world, el);
    const form = p!.element
      ? openersFor(TOOLS, 'element', { form: 'human', world: world.id, type: p!.element.type, id: ID }, { audience: 'member' }, { element: p!.element })
      : openersFor(TOOLS, 'world', { form: 'human', world: world.id }, { audience: 'member' });
    return form.some(r => r.id === 'tangle');
  };
  it("offers it on the world's mark and on a Character's", () => {
    expect(tangle(null)).toBe(true);
    expect(tangle({ id: ID, type: 'character', name: 'Ada' })).toBe(true);
  });
  it('leaves it out on every other type', () => {
    for (const type of ['location', 'event', 'narrative', 'object']) expect(tangle({ id: ID, type, name: 'X' })).toBe(false);
  });
});
