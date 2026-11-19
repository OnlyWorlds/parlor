// The standard's fixtures for serials 135 and 136 (schema-dist v0.34.1-dist.136, copied whole into ./fixtures), run
// through the parlor's own readers, never the SDK's alone: a work item's state, open work and elements through
// readWork and an element card (cardOf), who asked through readWork, a line's and a report's talks through the line
// reader (Line.named), and the design parts through a Room (its designs() and charter(), for the seat each case names).
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
import { cardOf } from './crew';
import { readLinesAsGiven, readWork, ROOM_MARK, type El } from './shapes';
import packet from './fixtures/packet.fixture.json';
import roomFixture from './fixtures/room.fixture.json';
import report from './fixtures/report.fixture.json';
import charter from './fixtures/charter.fixture.json';

type Any = Record<string, unknown>;
const asSet = (xs: readonly string[]) => [...xs].sort();

// ---------------------------------------------------------------- packet rules 5, 7 and 8 (serial 136)
// The parlor reads room work items (the pair and the room mark): each case's items are given the world's mark. The
// reader holds the world's Characters and its other elements, served as rows of their own.
const W = packet.world as unknown as { id: string; characters: string[]; others: string[] };
const held: El[] = [
  ...W.characters.map(id => ({ id, type: 'character', name: `Character ${id.slice(-3)}` } as El)),
  ...W.others.map(id => ({ id, type: 'location', name: `Element ${id.slice(-3)}` } as El)),
];
const asRoom = (items: Any[]): El[] => items.map(it => ({ ...it, [ROOM_MARK]: W.id } as unknown as El));

describe('packet state_cases (rules 5 and 7): readWork and an element card', () => {
  for (const c of packet.state_cases as unknown as Array<{ name: string; items: Any[]; want: { states?: Record<string, string | null>; shown?: string[]; open_work?: Record<string, string[]>; elements?: Record<string, string[]> } }>) {
    it(c.name, () => {
      const els = [...held, ...asRoom(c.items)];
      const work = readWork(els, W.id);
      const states = Object.fromEntries(work.map(w => [w.id, w.state]));
      if (c.want.states) for (const [id, s] of Object.entries(c.want.states)) expect({ id, state: states[id] }).toEqual({ id, state: s });
      if (c.want.shown) expect(asSet(work.map(w => w.id))).toEqual(asSet(c.want.shown));
      if (c.want.open_work) {
        const map = new Map(els.map(e => [e.id, e]));
        for (const [elId, ids] of Object.entries(c.want.open_work)) {
          // The open work on an element is its card's open questions.
          const on = cardOf(map.get(elId) ?? ({ id: elId, type: 'location' } as El), map, work).questions.map(q => q.id);
          expect({ elId, open: asSet(on) }).toEqual({ elId, open: asSet(ids) });
        }
      }
      if (c.want.elements) for (const [id, list] of Object.entries(c.want.elements)) {
        expect({ id, elements: work.find(w => w.id === id)?.elements.map(e => e.id) ?? null }).toEqual({ id, elements: list });
      }
    });
  }
});

describe('packet asker_cases (rule 8): readWork names who asked', () => {
  // Lints and "what am I waiting on" have no view in the parlor yet: only each item's asker is read here.
  for (const c of packet.asker_cases as unknown as Array<{ name: string; items: Any[]; want: { askers: Record<string, string | null> } }>) {
    it(c.name, () => {
      const work = readWork([...held, ...asRoom(c.items)], W.id);
      for (const [id, asker] of Object.entries(c.want.askers)) {
        expect({ id, asker: work.find(w => w.id === id)?.askedBy }).toEqual({ id, asker });
      }
    });
  }
});

// ---------------------------------------------------------------- talks (serial 135)
// The line reader carries a talk's id; its type is the field it came from.
type Talk = { type: string; id: string };
const typed = (el: Any, ids: string[]): Talk[] => ids.map(id => ({ type: Array.isArray(el.objects) && (el.objects as unknown[]).includes(id) ? 'object' : 'construct', id }));
const talkKeys = (ts: Talk[]) => asSet(ts.map(t => `${t.type}|${t.id}`));

describe('room talk_cases: a room line\'s talks (Line.named)', () => {
  for (const c of roomFixture.talk_cases as unknown as Array<{ name: string; element: Any; talks: Talk[] }>) {
    it(c.name, () => {
      const talks = readLinesAsGiven([c.element as El]).filter(l => l.report === null).flatMap(l => typed(c.element, [...new Set(l.named)]));
      expect(talkKeys(talks)).toEqual(talkKeys(c.talks));
    });
  }
});

describe('report talk_cases: a report\'s talks (Line.named)', () => {
  for (const c of report.talk_cases as unknown as Array<{ name: string; report: Any; talks: Talk[] }>) {
    it(c.name, () => {
      const talks = readLinesAsGiven([c.report as El]).filter(l => l.report !== null).flatMap(l => typed(c.report, [...new Set(l.named)]));
      expect(talkKeys(talks)).toEqual(talkKeys(c.talks));
    });
  }
});

// ---------------------------------------------------------------- the design state (serial 135)
// What a seat is served, as keel serves each rung (the fixture's worlds note): the owner the whole world, a hidden row
// with hidden: true; a contributor the world less the hidden, its own hidden creation with hidden: true; a guest its
// whole ids, and known_of as stubs (the lens profile's stub fields).
type World = { elements: El[]; hidden?: string[]; readers: Record<string, { rung: string; whole?: string[]; known_of?: string[] }> };
const STUB = ['id', 'type', 'name', 'description', 'supertype', 'subtype', 'image_url', 'created_at', 'updated_at'];
function served(world: World, reader: string, makerOfHidden = false): El[] {
  const r = world.readers[reader];
  const hidden = new Set(world.hidden ?? []);
  if (r.rung === 'owner') return world.elements.map(e => (hidden.has(e.id) ? { ...e, hidden: true } : e));
  if (r.rung === 'contributor') return world.elements.flatMap(e => (hidden.has(e.id) ? (makerOfHidden ? [{ ...e, hidden: true }] : []) : [e]));
  return world.elements.flatMap(e => {
    if (hidden.has(e.id)) return [];
    if ((r.whole ?? []).includes(e.id)) return [e];
    if ((r.known_of ?? []).includes(e.id)) return [{ ...Object.fromEntries(STUB.filter(k => k in e).map(k => [k, (e as Any)[k]])), known_of: true } as unknown as El];
    return [];
  });
}
const ROLE: Record<string, string> = { owner: 'owner', contributor: 'contributor', guest: 'guest' };
/** A Room for the seat, its feed what that seat is served; keel's front door is not played (charterAtOpen null). */
function seatRoom(world: World, reader: string, els: El[]): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: 'w', name: 'Design ground' }, {} as OwV2Client);
  const role = ROLE[world.readers[reader].rung];
  r.me = { role, scope: role === 'guest' ? 'read' : 'write', membership: role === 'owner' ? null : 'm-1' } as unknown as OwMe;
  r.role = roomRole(role);
  if (role === 'owner') r.hidden = new Set(world.hidden ?? []);
  for (const el of els) (r.els as Map<string, El>).set(el.id, el);
  return r;
}
type Part = { type: string; id: string; state: string };
const partKeys = (ps: Part[]) => asSet(ps.map(p => `${p.type}|${p.id}|${p.state}`));

describe('charter design_cases: a Room\'s design parts for the seat each case names', () => {
  for (const c of charter.design_cases as unknown as Array<{ name: string; world: World; reader: string; want: Part[] }>) {
    it(c.name, () => {
      const r = seatRoom(c.world, c.reader, served(c.world, c.reader));
      expect(partKeys(r.designs().map(p => ({ type: p.type, id: p.id, state: p.state })))).toEqual(partKeys(c.want));
    });
  }

  it('the maker of a hidden Charter, a contributor, reads it: keel serves it to its maker, and the mark keeps it from no one it is served to', () => {
    const c = (charter.design_cases as unknown as Array<{ name: string; world: World; reader: string; want: Part[] }>)
      .find(x => x.name === 'a-hidden-charter-gives-a-contributor-no-design-part')!;
    const owner = (charter.design_cases as unknown as Array<{ name: string; want: Part[] }>).find(x => x.name === 'a-hidden-charter-gives-its-owner-a-design-part')!;
    const r = seatRoom(c.world, 'contributor', served(c.world, 'contributor', true));
    expect(r.charter()?.id).toBe(c.world.hidden![0]);
    expect(r.teamWorld).toBe(true);
    expect(partKeys(r.designs().map(p => ({ type: p.type, id: p.id, state: p.state })))).toEqual(partKeys(owner.want));
  });
});
