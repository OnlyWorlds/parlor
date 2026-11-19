// The element card's model (element-card.ts) and its fixture: every case through the parlor's own call site (the room's
// readers: seatView, readWork, readDesignParts, parlorGraph, parlorCard), and through the model alone on the raw rows,
// as a tool that hands in its own work rows does. Then the file's own promises: it imports only the SDK, it names
// itself the source, it never builds a graph; and the room's graph is built once per change, never once per draw.
import { describe, expect, it } from 'vitest';
import modelSource from './element-card.ts?raw';
import type { OwMe, OwV2Client } from '@onlyworlds/sdk';
import { worldGraph } from '@onlyworlds/sdk';
import fixture from './fixtures/element-card.fixture.json';
import { cardFlags, parlorCard, parlorGraph } from './crew';
import { cardModel, cardable, type CardWorkRead } from './element-card';
import { readDesignParts, readWork, seatView, type El } from './shapes';
import { Room } from './room';
import { roomRole } from './roster';

type Case = {
  name: string; rows: El[]; work: El[]; reader: unknown; flags: { hidden: boolean; proposed: boolean }; id: string;
  workRead: CardWorkRead; cap: number | null; roomHidden: string[]; names: unknown; want: unknown;
  /** "raw": a reader the parlor never builds (the dashboard picture's contributor), run through the model alone. */
  only?: 'raw';
};
const W = fixture.world;
const cases = fixture.cases as unknown as Case[];

describe('the element card fixture, through the parlor\'s call site', () => {
  it('runs every case but those for a reader the parlor never builds', () => {
    expect(cases.filter(c => c.only === 'raw').every(c => (c.reader as { rung: string }).rung === 'contributor')).toBe(true);
    expect(cases.filter(c => !c.only).length).toBeGreaterThanOrEqual(32);
  });
  for (const c of cases.filter(x => !x.only)) {
    it(c.name, () => {
      const all = [...c.rows, ...c.work];
      const keeper = c.flags.hidden;
      // The parlor's keeper sets both flags, anyone else neither (R3), and reads the seat as served (seatView).
      expect(cardFlags(keeper)).toEqual(c.flags);
      const view = seatView(all, keeper, c.roomHidden);
      expect(view.reader).toEqual(c.reader);
      const els = new Map(all.map(e => [e.id, e]));
      const graph = parlorGraph(view, keeper);
      const hidden = new Set(c.roomHidden);
      const got = c.workRead === 'ok' || c.workRead === 'pending'
        ? parlorCard({ els, graph, keeper, hidden, id: c.id, worldId: W, work: readWork(all, W), walked: c.workRead === 'ok', parts: readDesignParts(view), names: c.names })
        // The parlor reads every work item it is served (its feed), so it never reads a capped or failed list: those
        // cases run the model on the parlor's graph, as its call site would hand them in.
        : cardModel({ graph, rows: els, id: c.id, work: readWork(all, W).map(w => w.el), workRead: c.workRead, cap: c.cap, worldId: W, roomHidden: hidden, names: c.names, flags: cardFlags(keeper), parts: readDesignParts(view) });
      expect(got).toEqual(c.want);
    });
  }
});

describe('the element card fixture, through the model alone on the raw rows', () => {
  for (const c of cases) {
    it(c.name, () => {
      const all = [...c.rows, ...c.work];
      const graph = worldGraph({ elements: all, hidden: c.roomHidden }, c.reader as never, c.flags);
      const view = seatView(all, c.flags.hidden, c.roomHidden);
      const got = cardModel({ graph, rows: new Map(all.map(e => [e.id, e])), id: c.id, work: c.work, workRead: c.workRead, cap: c.cap, worldId: W, roomHidden: c.roomHidden,
        names: c.names, flags: c.flags, parts: readDesignParts(view) });
      expect(got).toEqual(c.want);
    });
  }
});

describe('the model file', () => {
  const src = modelSource;
  it('says on its first line that it is the source, and that the dashboard\'s copy changes here first', () => {
    const first = src.split('\n')[0];
    expect(first).toMatch(/^\/\/ .*This file is the source/);
    expect(first).toContain('OnlyWorlds Dashboard holds a copy');
    expect(first).toContain('change it here first');
  });
  it('imports only the SDK: no relative import, so the copy runs unchanged in another layout', () => {
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
    expect(imports).toEqual(['@onlyworlds/sdk']);
    expect(src).not.toMatch(/from '\.\.?\//);
  });
  it('takes the graph as given and never builds one (one per read, not one per redraw)', () => {
    expect(src).not.toMatch(/worldGraph\(/);
    expect(src).not.toMatch(/designPartsOf\(/);
  });
  it('has no em-dash', () => {
    expect(src.includes('\u2014')).toBe(false);
  });
});

describe('cardable: the one test an opener asks', () => {
  const rows = [
    { id: 'a', type: 'character', name: 'Ada' },
    { id: 'p', type: 'location', name: 'Proposed', x_review_proposed: { by: 'agent' } },
    { id: 'l', type: 'narrative', name: 'A line', supertype: 'Message', x_room_of: 'w' },
  ];
  it('is true for a node of the reader\'s graph, false for anything else', () => {
    const g = worldGraph({ elements: rows }, { rung: 'owner' });
    expect(['a', 'p', 'l', 'none'].map(id => cardable(g, id))).toEqual([true, false, false, false]);
    const k = worldGraph({ elements: rows }, { rung: 'owner' }, { proposed: true });
    expect(cardable(k, 'p')).toBe(true);
  });
});

// ---------------------------------------------------------------- the room's call site

const WORLD = '0f0f0f0f-0000-4000-8000-00000000a1a1';
function room(role: 'owner' | 'contributor', els: El[]): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: WORLD, name: 'Ground' }, {} as unknown as OwV2Client);
  r.me = { role, scope: 'write', membership: role === 'owner' ? null : 'm-1', character: null } as unknown as OwMe;
  r.role = roomRole(role);
  for (const el of els) (r.els as Map<string, El>).set(el.id, { ...el });
  return r;
}
const ada = { id: 'a', type: 'character', name: 'Ada', birthplace: 'h' } as El;
const home = { id: 'h', type: 'location', name: 'Home' } as El;
const charter = { id: 'law', type: 'law', name: 'House rules', supertype: 'Charter', x_charter_of: WORLD, description: 'Be kind.\nWrite plainly.' } as El;

describe('the room builds the card\'s graph once per change', () => {
  it('the same graph while nothing moved; a new one after the feed moved, the hidden list moved or the seat\'s keeping moved', () => {
    const r = room('owner', [ada, home]);
    const g1 = r.cardGraph();
    r.card('a');
    r.cardable('h');
    expect(r.cardGraph()).toBe(g1);
    r.feed.changed();
    const g2 = r.cardGraph();
    expect(g2).not.toBe(g1);
    r.hidden.add('a');
    expect(r.cardGraph()).not.toBe(g2);
    expect(r.card('a')!.marks.hidden).toBe(true);
  });
  it('a seat that is no keeper reads a graph with no flags', () => {
    const r = room('contributor', [ada, home, { id: 'p', type: 'location', name: 'P', x_review_proposed: { by: 'x' } } as El]);
    expect(r.cardable('p')).toBe(false);
    const k = room('owner', [ada, home, { id: 'p', type: 'location', name: 'P', x_review_proposed: { by: 'x' } } as El]);
    expect(k.cardable('p')).toBe(true);
  });
});

describe('the Rules door is its own', () => {
  it('the charter has no card of the room\'s, and its own behind Rules, its words whole', () => {
    const r = room('contributor', [ada, home, charter]);
    expect(r.cardable('law')).toBe(false);
    expect(r.card('law')).toBeNull();
    const rules = r.card('law', { rules: true })!;
    expect(rules.title).toBe('House rules');
    expect([rules.lead, rules.rest]).toEqual(['Be kind.', 'Write plainly.']);
  });
  it('before the feed has walked, the questions are not read yet', () => {
    const r = room('contributor', [ada, home]);
    expect(r.card('a')!.questions.state).toBe('pending');
  });
});
