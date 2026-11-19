// A parlor line answers a design part (2026-11-18):
// which elements are design parts, the one field a line answering one writes, and how the room reads it back.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
});

import type { OwMe, OwV2Client } from '@onlyworlds/sdk';
import { Room } from './room';
import { roomRole } from './roster';
import { designLink, newLineAt, newReport, readDesignParts, readLinesAsGiven, ROOM_MARK, seatView, type El } from './shapes';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

const obj = (id: string, name: string, subtype: string | null, over: Partial<El> = {}): El => ({ id, type: 'object', name, subtype, ...over } as El);
const con = (id: string, name: string, subtype: string | null, over: Partial<El> = {}): El => ({ id, type: 'construct', name, subtype, ...over } as El);
const charter: El = { id: 'law-1', type: 'law', name: 'How we work', supertype: 'Charter', x_charter_of: WORLD } as El;

describe('readDesignParts (the SDK\'s designPartsOf, the charter profile serial 135)', () => {
  const els = [
    obj('o-b', 'beta screen', 'in design'),
    obj('o-a', 'Alpha screen', 'in design'),
    con('c-l', 'Billing rules', 'locked'),
    obj('o-door', 'A door', ' LOCKED '),
    obj('o-sp', 'Spaced', 'in  design'),
    obj('o-none', 'No state', null),
    obj('o-other', 'Shipped', 'released'),
    obj('o-prop', 'Proposed', 'in design', { x_review_proposed: { by: 'm-2', at: '2026-11-18T10:00:00Z' } }),
    { id: 'ch-1', type: 'character', name: 'Mara', subtype: 'in design' } as El,
    charter,
  ];
  const keeper = (list: El[], hidden: string[] = []) => readDesignParts(seatView(list, true, hidden)).map(p => p.id);
  it('in design first then locked, each by its folded name; the state trimmed and folded as the room profile folds', () => {
    expect(keeper(els)).toEqual(['o-a', 'o-b', 'o-door', 'c-l']);
    expect(readDesignParts(seatView(els, true)).find(p => p.id === 'o-door')?.state).toBe('locked');
  });
  it("the state's trim is Unicode's White_Space set: a trailing U+0085 trims, a byte order mark stays", () => {
    const parts = readDesignParts(seatView([obj('o-nel', 'Nel', 'locked\u0085'), obj('o-bom', 'Bom', '\ufefflocked'), obj('o-ls', 'Long s', 'in de\u017fign'), charter], true));
    expect(parts.map(p => [p.id, p.state])).toEqual([['o-ls', 'in design'], ['o-nel', 'locked']]);
  });
  it('none where the reader finds no Charter: none at all, or only one without the mark', () => {
    expect(keeper(els.filter(e => e !== charter))).toEqual([]);
    expect(keeper([...els.filter(e => e !== charter), { ...charter, x_charter_of: undefined } as El])).toEqual([]);
  });
  it('for a keeper the state alone makes a part, whatever the supertype: a hidden part, a room Spec and a reading aid in design; never a proposed one', () => {
    const more = [...els,
      obj('o-hid', 'Hidden', 'in design', { hidden: true }),
      con('c-spec', 'A spec', 'in design', { supertype: 'Spec', [ROOM_MARK]: WORLD }),
      con('c-aid', 'Domains', 'locked', { supertype: 'Domain', x_charter_of: WORLD }),
    ];
    expect(keeper(more, ['o-b'])).toEqual(['c-spec', 'o-a', 'o-b', 'o-hid', 'o-door', 'c-l', 'c-aid']);
  });
  it('a seat that is no keeper reads exactly what it was served: its whole rows, never a stub', () => {
    const served = [obj('o-a', 'Alpha screen', 'in design'), obj('o-ko', 'Known of', 'in design', { known_of: true }), con('c-l', 'Billing rules', 'locked'), charter];
    expect(readDesignParts(seatView(served, false)).map(p => p.id)).toEqual(['o-a', 'c-l']);
    // A Charter served only as a stub (the base fields, no mark) is not this seat's: no parts at all.
    const stub = { id: 'law-1', type: 'law', name: 'How we work', supertype: 'Charter', known_of: true } as El;
    expect(readDesignParts(seatView([obj('o-a', 'Alpha screen', 'in design'), stub], false))).toEqual([]);
  });
  it('the link a line writes is the part\'s own type', () => {
    const parts = readDesignParts(seatView(els, true));
    const a = parts.find(p => p.id === 'o-a')!, c = parts.find(p => p.id === 'c-l')!;
    expect(designLink(a)).toBe('objects');
    expect(designLink(c)).toBe('constructs');
  });
});

describe('newLineAt', () => {
  it('a design answer names the part in exactly one field, by its type, and nowhere else', () => {
    const b = newLineAt('on it', 'c1', { link: 'objects', id: 'o-a' }, 's1');
    expect(b.objects).toEqual(['o-a']);
    expect('constructs' in b || 'relations' in b || 'parent_narrative' in b).toBe(false);
    const c = newLineAt('on it', 'c1', { link: 'constructs', id: 'c-l' }, 's1');
    expect(c.constructs).toEqual(['c-l']);
    expect('objects' in c).toBe(false);
  });
  it('a board entry and a work item write as before', () => {
    expect(newLineAt('x', null, { link: 'parent_narrative', id: 'b1' }, 's1').parent_narrative).toBe('b1');
    expect(newLineAt('x', null, { link: 'relations', id: 'w1' }, 's1').relations).toEqual(['w1']);
    const plain = newLineAt('x', null, null, 's1');
    expect(['objects', 'constructs', 'relations', 'parent_narrative'].some(k => k in plain)).toBe(false);
  });
});

describe('the room reads a talk on a design', () => {
  const line = (id: string, over: Partial<El>): El => ({ id, type: 'narrative', name: id, supertype: 'Message', story: id, [ROOM_MARK]: WORLD, created_at: `2026-11-18T10:0${id.length}:00Z`, ...over } as El);
  function room(els: El[]): Room {
    const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
    const r = new R({ id: WORLD, name: 'Team ground' }, {} as OwV2Client);
    r.me = { role: 'owner', scope: 'write', membership: null } as unknown as OwMe;
    r.role = roomRole('owner');
    for (const el of els) (r.els as Map<string, El>).set(el.id, el);
    return r;
  }
  const parts = [obj('o-a', 'Alpha screen', 'in design'), con('c-l', 'Billing rules', 'locked'), obj('o-door', 'A door', null)];

  it('no designs where the Charter is not marked, whatever the subtypes say', () => {
    expect(room(parts).designs()).toEqual([]);
    expect(room([...parts, { ...charter, x_charter_of: undefined } as El]).designs()).toEqual([]);
    expect(room([...parts, charter]).designs().map(p => p.id)).toEqual(['o-a', 'c-l']);
  });

  it('a line naming a design part is a talk on it; one naming an Object that is no design is not', () => {
    const r = room([...parts, charter,
      line('l1', { objects: ['o-a'] }), line('l22', { constructs: ['c-l'], objects: ['o-a'] }),
      line('l333', { objects: ['o-door'] }), line('l4444', {})]);
    const ls = readLinesAsGiven(r.els.values());
    const of = (id: string) => r.designsOf(ls.find(l => l.id === id)!).map(p => p.id);
    expect(of('l1')).toEqual(['o-a']);
    expect(of('l22')).toEqual(['o-a', 'c-l']);
    expect(of('l333')).toEqual([]);
    expect(of('l4444')).toEqual([]);
    expect(r.answers('o-a').map(l => l.id)).toEqual(['l1', 'l22']);
    expect(r.answers('c-l').map(l => l.id)).toEqual(['l22']);
  });

  it('a part hidden by the room\'s own list is still a design for a keeper (the SDK decides; the tab marks it), and its line is labelled', () => {
    const r = room([...parts, charter, line('l1', { objects: ['o-a'] })]);
    r.hidden.add('o-a');
    expect(r.designs().map(p => p.id)).toEqual(['o-a', 'c-l']);
    expect(r.designsOf(readLinesAsGiven(r.els.values()).find(l => l.id === 'l1')!).map(p => p.id)).toEqual(['o-a']);
  });

  it('a member served a part only as a stub reads no design there, and no line is labelled for it', () => {
    const r = room([obj('o-a', 'Alpha screen', 'in design', { known_of: true }), con('c-l', 'Billing rules', 'locked'), charter, line('l1', { objects: ['o-a'] })]);
    r.me = { role: 'contributor', scope: 'write', membership: 'm-1' } as unknown as OwMe;
    r.role = roomRole('contributor');
    expect(r.designs().map(p => p.id)).toEqual(['c-l']);
    expect(r.designsOf(readLinesAsGiven(r.els.values()).find(l => l.id === 'l1')!)).toEqual([]);
  });
});

describe('a report on a design part (the report profile fourth anchor, ruled 2026-11-18)', () => {
  it('names the part in its own field and hangs on no sitting', () => {
    const b = newReport('The screen is drawn.', 'c1', 's1', '2026-11-18', { part: { link: 'objects', id: 'o-a' }, sitting: 'sit-1' });
    expect(b.objects).toEqual(['o-a']);
    expect('events' in b || 'relations' in b || 'parent_narrative' in b).toBe(false);
  });
  it('free talk still hangs on its sitting', () => {
    expect(newReport('Said.', 'c1', 's1', '2026-11-18', { sitting: 'sit-1' }).events).toEqual(['sit-1']);
  });
  it('a keeper touching the same part writes it once, and another beside it', () => {
    const b = newReport('Done.', 'c1', 's1', '2026-11-18', { part: { link: 'constructs', id: 'c-l' }, sitting: 'sit-1' },
      { description: 'Short.', changes: '', touched: [{ type: 'construct', id: 'c-l' }, { type: 'construct', id: 'c-x' }], done: null });
    expect(b.constructs).toEqual(['c-l', 'c-x']);
    expect('events' in b).toBe(false);
  });
});

describe('answerCounts', () => {
  it('counts each line once per id, as answers() does', () => {
    const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
    const r = new R({ id: WORLD, name: 'Team ground' }, {} as OwV2Client);
    const ln = (id: string, over: Partial<El>): El => ({ id, type: 'narrative', name: id, supertype: 'Message', story: id, [ROOM_MARK]: WORLD, ...over } as El);
    for (const el of [ln('a', { objects: ['o-a', 'o-a'] }), ln('b', { relations: ['w1'], constructs: ['c-l'] }), ln('c', { parent_narrative: 'b1' }), ln('d', {})])
      (r.els as Map<string, El>).set(el.id, el);
    const n = r.answerCounts(['o-a', 'c-l', 'w1', 'b1', 'none']);
    expect(Object.fromEntries(n)).toEqual({ 'o-a': 1, 'c-l': 1, w1: 1, b1: 1, none: 0 });
    for (const id of n.keys()) expect(n.get(id)).toBe(r.answers(id).length);
  });
});
