// A keeper completes a handed-in report (Room.complete, the report profile's step 2), against a fake client that
// plays keel's answers for each state the method leans on: a gone row 404 or 410, a moved row 412 with `current`,
// a lost answer as a network error. Every call is recorded, so each case says what was sent and in what order.
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

import { OwApiError, OwNetworkError, OwPreconditionFailedError, type OwMe, type OwV2Client } from '@onlyworlds/sdk';
import { Room, KeeperOnly, ReportMoved, CompletionFailed } from './room';
import { roomRole } from './roster';
import type { El } from './shapes';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

type Call = { op: 'get' | 'patch'; type: string; id: string; body?: Record<string, unknown>; ifMatch?: number };

let calls: Call[];
let rows: Map<string, El>;
let failPatch: Map<string, unknown>;
let failGet: Map<string, unknown>;

const gone = (status: 404 | 410) => new OwApiError(status, 'not_found', 'gone', null, null);
const lost = () => new OwNetworkError('lost', new Error('reset'));
const moved = (current: El) => new OwPreconditionFailedError(412, 'precondition_failed', 'changed', null, { current });

const fake = {
  async get(type: string, id: string) {
    calls.push({ op: 'get', type, id });
    if (failGet.has(id)) throw failGet.get(id);
    const row = rows.get(id);
    if (!row) throw gone(404);
    return { ...row };
  },
  async patch(type: string, id: string, body: Record<string, unknown>, opts?: { ifMatch?: number }) {
    calls.push({ op: 'patch', type, id, body, ifMatch: opts?.ifMatch });
    if (failPatch.has(id)) throw failPatch.get(id);
    const row = { ...rows.get(id)!, ...body, change_seq: (rows.get(id)!.change_seq as number ?? 0) + 1 } as El;
    rows.set(id, row);
    return { ...row };
  },
};

function room(role: 'owner' | 'co_builder' | 'contributor' = 'owner', scope: 'write' | 'read' = 'write'): Room {
  const R = Room as unknown as new (w: unknown, c: OwV2Client) => Room;
  const r = new R({ id: WORLD, name: 'Team ground' }, fake as unknown as OwV2Client);
  r.me = { role, scope, membership: role === 'owner' ? null : 'm-1' } as unknown as OwMe;
  r.role = roomRole(role);
  return r;
}

const report = (over: Partial<El> = {}): El => ({
  id: 'r1', type: 'narrative', name: 'Report 2026-11-11', supertype: 'Report', subtype: 'handed in',
  x_room_of: WORLD, story: 'I fixed the dock at Rua Augusta.', narrator: 'c1', change_seq: 7,
  relations: ['i-open', 'i-gone', 'i-lore', 'i-done', 'i-prop', 'i-mine'],
  x_report_answers: ['i-open', 'i-gone', 'i-lore', 'i-done', 'i-prop', 'i-mine'],
  ...over,
} as El);

const item = (id: string, over: Partial<El> = {}): El =>
  ({ id, type: 'relation', name: `Item ${id}`, supertype: 'Work item', subtype: 'open', x_room_of: WORLD, change_seq: 1, ...over } as El);

const part = { description: '  The dock works again.  ', changes: 'Dock 4 back in service\n\n  ', touched: [] };

beforeEach(() => {
  calls = [];
  failPatch = new Map();
  failGet = new Map();
  rows = new Map<string, El>([
    ['r1', report()],
    ['i-open', item('i-open')],
    ['i-lore', item('i-lore', { supertype: 'Alliance' })],
    ['i-done', item('i-done', { subtype: 'done' })],
    ['i-prop', item('i-prop', { x_review_proposed: { by: 'm-2', at: '2026-11-11T05:00:00Z' } })],
    ['i-mine', item('i-mine', { subtype: 'done' })],
  ]);
});

const patches = () => calls.filter(c => c.op === 'patch');

describe('Room.complete', () => {
  it('a seat that does not keep the world sends nothing', async () => {
    await expect(room('contributor').complete('r1', 7, part, true, new Set())).rejects.toBeInstanceOf(KeeperOnly);
    await expect(room('owner', 'read').complete('r1', 7, part, true, new Set())).rejects.toBeInstanceOf(KeeperOnly);
    expect(calls).toEqual([]);
  });

  it('a report the host has hidden is refused before any read', async () => {
    const r = room();
    r.hidden.add('r1');
    await expect(r.complete('r1', 7, part, false, new Set())).rejects.toMatchObject({ why: 'hidden' });
    expect(calls).toEqual([]);
  });

  it('a report gone (404 or 410) or no longer a report is gone, and nothing is written', async () => {
    rows.delete('r1');
    await expect(room().complete('r1', 7, part, true, new Set())).rejects.toMatchObject({ why: 'gone' });
    failGet.set('r1', gone(410));
    await expect(room().complete('r1', 7, part, true, new Set())).rejects.toMatchObject({ why: 'gone' });
    failGet.clear();
    rows.set('r1', report({ supertype: 'Message' }));
    await expect(room().complete('r1', 7, part, true, new Set())).rejects.toMatchObject({ why: 'gone' });
    rows.set('r1', report({ x_room_of: undefined }));
    await expect(room().complete('r1', 7, part, true, new Set())).rejects.toMatchObject({ why: 'gone' });
    expect(patches()).toEqual([]);
  });

  it('a read that fails otherwise is a CompletionFailed with nothing set done', async () => {
    failGet.set('r1', lost());
    const err = await room().complete('r1', 7, part, true, new Set()).catch(e => e);
    expect(err).toBeInstanceOf(CompletionFailed);
    expect(err.done).toEqual([]);
    expect(patches()).toEqual([]);
  });

  it('a report completed by another hand is refused; this card\'s own landed answer is success', async () => {
    rows.set('r1', report({ subtype: 'completed', description: 'Someone else wrote this.' }));
    await expect(room().complete('r1', 7, part, false, new Set(), true)).rejects.toMatchObject({ why: 'completed' });
    rows.set('r1', report({ subtype: 'Completed', description: 'The dock works again.' }));
    await expect(room().complete('r1', 7, part, false, new Set(), false)).rejects.toMatchObject({ why: 'completed' });
    await expect(room().complete('r1', 7, part, false, new Set(), true)).resolves.toBeUndefined();
    expect(patches()).toEqual([]);
  });

  it('a report hidden on the server is refused', async () => {
    rows.set('r1', report({ hidden: true }));
    await expect(room().complete('r1', 7, part, false, new Set())).rejects.toMatchObject({ why: 'hidden' });
    expect(patches()).toEqual([]);
  });

  it('a member\'s edit since the keeper opened it refuses, carrying the fresh copy, and sets nothing done', async () => {
    rows.set('r1', report({ change_seq: 8, story: 'I fixed the dock. And the bench.' }));
    const err = await room().complete('r1', 7, part, true, new Set()).catch(e => e);
    expect(err).toBeInstanceOf(ReportMoved);
    expect(err.why).toBe('changed');
    expect(err.fresh?.story).toBe('I fixed the dock. And the bench.');
    expect(patches()).toEqual([]);
  });

  it('with the box ticked: only an open or taken work item, not proposed, is set done, before the report', async () => {
    await room().complete('r1', 7, part, true, new Set());
    const p = patches();
    expect(p.map(c => `${c.type}:${c.id}`)).toEqual(['relation:i-open', 'narrative:r1']);
    expect(p[0].body).toEqual({ subtype: 'done' });
    const body = p[1].body!;
    expect(p[1].ifMatch).toBe(7);
    expect(body.subtype).toBe('completed');
    expect(body.description).toBe('The dock works again.');
    expect(body.consequences).toBe('Dock 4 back in service\nSet the work item Item i-open to done: ow://relation/i-open');
    // Step 2 never rewrites the member's part.
    for (const k of ['story', 'narrator', 'x_room_of', 'x_report_answers', 'supertype', 'name']) expect(body).not.toHaveProperty(k);
  });

  it('a done item counts only when this card set it on an earlier press, and is said whatever the box says now', async () => {
    await room().complete('r1', 7, part, false, new Set(['i-mine']));
    const p = patches();
    expect(p.map(c => `${c.type}:${c.id}`)).toEqual(['narrative:r1']);
    expect(p[0].body!.consequences).toBe('Dock 4 back in service\nSet the work item Item i-mine to done: ow://relation/i-mine');
    // With the box clear, no item is read that this card did not set.
    expect(calls.filter(c => c.op === 'get').map(c => c.id)).toEqual(['r1', 'i-mine']);
  });

  it('nothing typed and nothing set done says nothing changed', async () => {
    await room().complete('r1', 7, { description: 'Done.', changes: '  \n', touched: [] }, false, new Set());
    expect(patches()[0].body!.consequences).toBe('nothing changed');
  });

  it('a touched element joins its typed link, the reporter\'s links kept', async () => {
    rows.set('r1', report({ locations: ['l-1'] }));
    await room().complete('r1', 7, { ...part, touched: [{ type: 'location', id: 'l-2' }, { type: 'location', id: 'l-1' }] }, false, new Set());
    expect(patches()[0].body!.locations).toEqual(['l-1', 'l-2']);
  });

  it('a lost answer on an item\'s done counts the item, so the next press says it; a refusal does not', async () => {
    failPatch.set('i-open', lost());
    let err = await room().complete('r1', 7, part, true, new Set()).catch(e => e);
    expect(err).toBeInstanceOf(CompletionFailed);
    expect(err.done).toEqual([{ id: 'i-open', title: 'Item i-open' }]);
    expect(err.atPatch).toBe(false);
    failPatch.set('i-open', new OwApiError(403, 'forbidden', 'no', null, null));
    err = await room().complete('r1', 7, part, true, new Set()).catch(e => e);
    expect(err.done).toEqual([]);
    expect(patches().some(c => c.id === 'r1')).toBe(false);
  });

  it('a 412 on the report with nothing set done hands back keel\'s current copy', async () => {
    const current = report({ change_seq: 9, story: 'Edited between the read and the write.' });
    failPatch.set('r1', moved(current));
    const err = await room().complete('r1', 7, part, false, new Set()).catch(e => e);
    expect(err).toBeInstanceOf(ReportMoved);
    expect(err.why).toBe('changed');
    expect(err.fresh?.change_seq).toBe(9);
  });

  it('a failed report write after a done names what was set done, at the patch', async () => {
    failPatch.set('r1', moved(report({ change_seq: 9 })));
    const err = await room().complete('r1', 7, part, true, new Set()).catch(e => e);
    expect(err).toBeInstanceOf(CompletionFailed);
    expect(err.done).toEqual([{ id: 'i-open', title: 'Item i-open' }]);
    expect(err.atPatch).toBe(true);
    expect(rows.get('i-open')!.subtype).toBe('done');
  });

  it('a report read with no change_seq is patched with no ifMatch', async () => {
    rows.set('r1', report({ change_seq: undefined }));
    await room().complete('r1', null, part, false, new Set());
    expect(patches()[0].ifMatch).toBeUndefined();
  });
});
