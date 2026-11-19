// Played cases for the standard's serials 135 and 136 (a work item's four states, who asked, the Charter for each seat),
// on a Room against a played OnlyWorlds server. The doors it plays, and only these: GET /relation/{id} (a row as the
// server holds it now, 404 when gone), PATCH /{type}/{id} with If-Match (412 with `current` when the row moved since
// the version named), and POST /{type} (the row made). Each case says what the page shows and what was sent.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
});

import { OwApiError, OwPreconditionFailedError, type OwMe, type OwV2Client } from '@onlyworlds/sdk';
import { Room, ItemMoved } from './room';
import { roomRole } from './roster';
import { cardOf, heldWork } from './crew';
import { ROOM_MARK, ROOM_ITEM, newWorkItem, workOffers, workStateLine, WORK_STATE_WORD, workStateKey, type El } from './shapes';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

type Call = { op: 'get' | 'patch' | 'create'; type: string; id: string; body?: Record<string, unknown>; ifMatch?: number };
let calls: Call[];
/** The server's rows. */
let rows: Map<string, El>;
/** A row another hand changes between this page's read and its write (applied at the PATCH's turn). */
let meanwhile: Map<string, Partial<El>>;

const keel = {
  async get(type: string, id: string) {
    calls.push({ op: 'get', type, id });
    const row = rows.get(id);
    if (!row) throw new OwApiError(404, 'not_found', 'gone', null, null);
    return { ...row };
  },
  async patch(type: string, id: string, body: Record<string, unknown>, opts?: { ifMatch?: number }) {
    calls.push({ op: 'patch', type, id, body, ifMatch: opts?.ifMatch });
    if (meanwhile.has(id)) {
      const row = rows.get(id)!;
      rows.set(id, { ...row, ...meanwhile.get(id), change_seq: (row.change_seq as number) + 1 } as El);
      meanwhile.delete(id);
    }
    const row = rows.get(id);
    if (!row) throw new OwApiError(404, 'not_found', 'gone', null, null);
    if (opts?.ifMatch !== undefined && opts.ifMatch !== row.change_seq) {
      throw new OwPreconditionFailedError(412, 'precondition_failed', 'changed', null, { current: { ...row } });
    }
    const next = { ...row, ...body, change_seq: (row.change_seq as number ?? 0) + 1 } as El;
    rows.set(id, next);
    return { ...next };
  },
  async create(type: string, body: Record<string, unknown>) {
    const id = `new-${calls.length}`;
    calls.push({ op: 'create', type, id, body });
    const row = { ...body, id, type, change_seq: 1 } as El;
    rows.set(id, row);
    return { ...row };
  },
};

type Role = 'owner' | 'co_builder' | 'contributor' | 'guest';
function room(role: Role, els: El[], character: string | null = 'c-me'): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: WORLD, name: 'Team ground' }, keel as unknown as OwV2Client);
  r.me = { role, scope: role === 'guest' ? 'read' : 'write', membership: role === 'owner' ? null : 'm-1', character } as unknown as OwMe;
  r.role = roomRole(role);
  for (const el of els) (r.els as Map<string, El>).set(el.id, { ...el });
  return r;
}
/** The same row in the page's feed and on the server. */
const both = (els: El[]) => { for (const el of els) rows.set(el.id, { ...el }); return els; };

const item = (id: string, subtype: unknown, over: Partial<El> = {}): El =>
  ({ id, type: 'relation', name: `Item ${id}`, supertype: 'Work item', subtype, [ROOM_MARK]: WORLD, created_by: 'owner', objects: ['o-1'], change_seq: 4, created_at: '2026-11-19T08:00:00Z', ...over } as El);
const take = (id: string, on: string, by: string): El =>
  ({ id, type: 'relation', name: `Take: ${on}`, supertype: 'Take', subtype: 'taken', [ROOM_MARK]: WORLD, [ROOM_ITEM]: on, created_by: by, created_at: '2026-11-19T08:10:00Z' } as El);
const thing = { id: 'o-1', type: 'object', name: 'Lantern hook' } as El;

beforeEach(() => {
  calls = [];
  rows = new Map();
  meanwhile = new Map();
});

describe('a take on an item that turned standing', () => {
  const els = () => both([thing, item('i1', 'standing'), take('t1', 'i1', 'm-2')]);

  it('reads standing, keeps no take, offers nothing to take or set done, and is open work on no element', () => {
    const r = room('owner', els());
    const [w] = r.work();
    expect(w.state).toBe('standing');
    expect(w.takes).toEqual([]);
    expect(workOffers(w)).toEqual({ take: false, markDone: false, reopen: false });
    expect(WORK_STATE_WORD[workStateKey(w.state)]).toBe('Standing');
    expect(workStateLine(w.state)).toBe('A standing list: never done.');
    expect(heldWork(r.work(), { key: 'm-2', character: null })).toBeNull();
    expect(cardOf(thing, r.els, r.work()).questions).toEqual([]);
  });

  it('Take refuses when the server holds it standing though the page still read it open: nothing made', async () => {
    const r = room('contributor', [thing, item('i1', 'open')]);
    rows.set('i1', item('i1', 'standing'));
    await expect(r.take('i1')).rejects.toBeInstanceOf(ItemMoved);
    expect(calls.map(c => c.op)).toEqual(['get']);
  });

  it('Mark done refuses on a standing item read fresh: standing is never overwritten with done', async () => {
    const r = room('owner', [thing, item('i1', 'open')]);
    rows.set('i1', item('i1', 'standing'));
    await expect(r.setWorkState('i1', 'done')).rejects.toBeInstanceOf(ItemMoved);
    expect(calls.map(c => c.op)).toEqual(['get']);
    expect(rows.get('i1')!.subtype).toBe('standing');
  });

  it('Mark done writes at the version read: set standing between the read and the write, the write is refused and standing stays', async () => {
    const r = room('owner', both([thing, item('i1', 'open')]));
    meanwhile.set('i1', { subtype: 'standing' });
    await expect(r.setWorkState('i1', 'done')).rejects.toBeInstanceOf(ItemMoved);
    expect(calls.find(c => c.op === 'patch')).toMatchObject({ body: { subtype: 'done' }, ifMatch: 4 });
    expect(rows.get('i1')!.subtype).toBe('standing');
  });

  it('a keeper\'s report that sets an item done writes at the version read too: moved meanwhile, nothing is handed in', async () => {
    const r = room('owner', both([thing, item('i1', 'open')]));
    meanwhile.set('i1', { subtype: 'standing' });
    await expect(r.handIn({ name: 'R', supertype: 'Report', subtype: 'completed', [ROOM_MARK]: WORLD }, 'k1', [], 'i1')).rejects.toBeInstanceOf(ItemMoved);
    expect(calls.find(c => c.op === 'patch')?.ifMatch).toBe(4);
    expect(calls.some(c => c.op === 'create')).toBe(false);
    expect(rows.get('i1')!.subtype).toBe('standing');
  });

  it('completing a report leaves an answered item that turned standing as it is, and says no done', async () => {
    const report = { id: 'r1', type: 'narrative', name: 'R', supertype: 'Report', subtype: 'handed in', [ROOM_MARK]: WORLD, story: 'Hooked it.', change_seq: 2,
      relations: ['i1', 'i2'], x_report_answers: ['i1', 'i2'] } as El;
    const r = room('owner', both([thing, report, item('i1', 'standing'), item('i2', 'open')]));
    meanwhile.set('i2', { subtype: 'standing' });
    await r.complete('r1', 2, { description: 'Short.', changes: '', touched: [] }, true, new Set());
    expect(rows.get('i1')!.subtype).toBe('standing');
    expect(rows.get('i2')!.subtype).toBe('standing');
    expect(calls.filter(c => c.op === 'patch' && c.type === 'relation').map(c => [c.id, c.ifMatch])).toEqual([['i2', 4]]);
    expect(rows.get('r1')!.consequences).toBe('nothing changed');
  });

  it('Reopen only on a done item: an open one read fresh is refused', async () => {
    const r = room('owner', both([thing, item('i1', 'done')]));
    rows.set('i1', item('i1', 'open'));
    await expect(r.setWorkState('i1', 'open')).rejects.toBeInstanceOf(ItemMoved);
    expect(calls.map(c => c.op)).toEqual(['get']);
  });
});

describe('a stateless item', () => {
  it('is shown as itself, after open work and standing and before done, with nothing to take or set done', () => {
    const r = room('owner', both([thing,
      item('done', 'done', { created_at: '2026-11-19T09:00:00Z' }),
      item('none', 'blocked', { created_at: '2026-11-19T09:01:00Z' }),
      item('absent', undefined, { created_at: '2026-11-19T07:00:00Z' }),
      item('std', 'Standing ', { created_at: '2026-11-19T06:00:00Z' }),
      item('open', 'OPEN', { created_at: '2026-11-19T05:00:00Z' }),
    ]));
    const work = r.work();
    expect(work.map(w => [w.id, w.state])).toEqual([['open', 'open'], ['std', 'standing'], ['none', null], ['absent', null], ['done', 'done']]);
    const none = work.find(w => w.id === 'none')!;
    expect(WORK_STATE_WORD[workStateKey(none.state)]).toBe('No state');
    expect(workStateLine(none.state)).toBe('No state set, so this is not open work.');
    expect(workOffers(none)).toEqual({ take: false, markDone: false, reopen: false });
    expect(cardOf(thing, r.els, work).questions.map(q => q.id)).toEqual(['open']);
  });

  it('a keeper\'s report never sets it done: nothing is sent', async () => {
    const r = room('owner', both([thing, item('i1', '')]));
    await expect(r.handIn({ name: 'R', supertype: 'Report', subtype: 'completed', [ROOM_MARK]: WORLD }, 'k1', [], 'i1')).rejects.toBeInstanceOf(ItemMoved);
    expect(calls.map(c => c.op)).toEqual(['get']);
  });
});

describe('an asked item', () => {
  const mara = { id: 'c-mara', type: 'character', name: 'Mara' } as El;

  it('the parlor writes who asked: the filer\'s own Character, and with none the key is left out', async () => {
    await room('contributor', [thing], 'c-me').makeWork('Hang the lantern', '', 'c-mara', [{ type: 'object', id: 'o-1' }]);
    await room('contributor', [thing], null).makeWork('Hang the lantern', '', null, []);
    const made = calls.filter(c => c.op === 'create').map(c => c.body!);
    expect(made[0].x_packet_from).toBe('c-me');
    expect(made[0].actor).toBe('c-mara');
    expect('x_packet_from' in made[1]).toBe(false);
    expect('x_packet_from' in newWorkItem('t', '', null, [], WORLD, '  ')).toBe(false);
  });

  it('reads who asked from x_packet_from alone: a Character this seat is served; never the maker or actor', () => {
    const r = room('owner', [thing, mara, { id: 'c-ada', type: 'character', name: 'Ada' } as El,
      item('asked', 'open', { x_packet_from: 'c-mara', actor: 'c-ada', created_by: 'm-9' }),
      item('unasked', 'open', { actor: 'c-ada', created_by: 'm-9' }),
      item('place', 'open', { x_packet_from: 'o-1' }),
      item('unseen', 'open', { x_packet_from: 'c-gone' }),
    ]);
    const by = Object.fromEntries(r.work().map(w => [w.id, w.askedBy]));
    expect(by).toEqual({ asked: 'c-mara', unasked: null, place: null, unseen: null });
  });
});

describe('the Charter for each seat (the charter profile, serial 135; keel serves a hidden row to its owner, the co-builders and its maker)', () => {
  const law = (over: Partial<El> = {}): El => ({ id: 'law-1', type: 'law', name: 'How we work', supertype: 'Charter', x_charter_of: WORLD, ...over } as El);
  const part = { id: 'o-part', type: 'object', name: 'The hook', subtype: 'in design' } as El;

  it('a co-host reads a Charter the owner hid: a team world, house rules and designs', () => {
    const r = room('co_builder', [law({ hidden: true }), part]);
    r.hidden = new Set(['law-1']);
    expect(r.teamWorld).toBe(true);
    expect(r.charter()?.id).toBe('law-1');
    expect(r.designs().map(p => p.id)).toEqual(['o-part']);
  });

  it('the maker of a hidden Charter, a member, reads it as served', () => {
    const r = room('contributor', [law({ hidden: true, created_by: 'm-1' }), part]);
    expect(r.teamWorld).toBe(true);
    expect(r.charter()?.id).toBe('law-1');
    expect(r.designs().map(p => p.id)).toEqual(['o-part']);
  });

  it('a guest served the Charter whole reads it; a part it holds only as a stub is no design part', () => {
    const r = room('guest', [law(), part, { id: 'o-stub', type: 'object', name: 'Known of', subtype: 'locked', known_of: true } as El]);
    expect(r.charter()?.id).toBe('law-1');
    expect(r.teamWorld).toBe(true);
    expect(r.designs().map(p => p.id)).toEqual(['o-part']);
  });

  it('a keeper marking a Charter mid-visit turns the team world on at once', async () => {
    const r = room('owner', both([law({ x_charter_of: undefined }), part]));
    expect(r.teamWorld).toBe(false);
    expect(r.designs()).toEqual([]);
    await r.markCharter('law-1');
    expect(calls.find(c => c.op === 'patch')).toMatchObject({ type: 'law', id: 'law-1', body: { x_charter_of: WORLD } });
    expect(r.teamWorld).toBe(true);
    expect(r.charter()?.id).toBe('law-1');
    expect(r.designs().map(p => p.id)).toEqual(['o-part']);
  });
});
