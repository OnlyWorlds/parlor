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

type Call = { op: 'get' | 'patch' | 'create'; type: string; id: string; body?: Record<string, unknown>; ifMatch?: number };

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
  async create(type: string, body: Record<string, unknown>) {
    const id = `new-${calls.length}`;
    calls.push({ op: 'create', type, id, body });
    return { ...body, id, type } as El;
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

  // The address profile's "The same id" (serial 122): keel reads an id sent in upper case at its own door and serves the
  // item lowercase; the request goes as written, and the address the completion writes is lowercase in the form.
  it('an answer held in upper case is fetched and set done as written, and its address is written lowercase', async () => {
    const U = '019A2C7E-41B0-7A12-8C3D-6E5F4A3B2C22';
    rows.set('r1', report({ relations: [U.toLowerCase()], x_report_answers: [U] }));
    rows.set(U, item(U.toLowerCase()));
    await room().complete('r1', 7, part, true, new Set());
    const p = patches();
    expect(p.map(c => `${c.type}:${c.id}`)).toEqual([`relation:${U}`, 'narrative:r1']);
    expect(p[1].body!.consequences).toBe(`Dock 4 back in service\nSet the work item Item ${U.toLowerCase()} to done: ow://relation/${U.toLowerCase()}`);
  });

  it('an answer with no hyphens is sent as written, and consequences names the id keel served for it', async () => {
    const served = '019a2c7e-41b0-7a12-8c3d-6e5f4a3b2c22';
    const NO_HYPHENS = served.replace(/-/g, '').toUpperCase();
    rows.set('r1', report({ relations: [served], x_report_answers: [NO_HYPHENS, 'i-gone'] }));
    rows.set(NO_HYPHENS, item(served));
    await room().complete('r1', 7, part, true, new Set());
    const p = patches();
    expect(p.map(c => `${c.type}:${c.id}`)).toEqual([`relation:${NO_HYPHENS}`, 'narrative:r1']);
    // The gone answer (keel returned nothing for it) writes no line.
    expect(p[1].body!.consequences).toBe(`Dock 4 back in service\nSet the work item Item ${served} to done: ow://relation/${served}`);
  });

  it('a served body with no id falls back to the answer itself, never an undefined address', async () => {
    const noId = item('i-open') as Partial<El>;
    delete noId.id;
    rows.set('i-open', noId as El);
    rows.set('r1', report({ x_report_answers: ['i-open'] }));
    await room().complete('r1', 7, part, true, new Set());
    expect(patches()[1].body!.consequences).toBe('Dock 4 back in service\nSet the work item Item i-open to done: ow://relation/i-open');
  });
});

// Pins (nothing moves): the report fixture's two cases of the address profile's "The same id" (serial 122), as the
// room reads a report's parent. Inside a world two ids are the same only when written the same.
describe('a report\'s parent and its id, as written', () => {
  const report2 = (id: string, parent: string | null, at: string): El =>
    ({ id, type: 'narrative', supertype: 'Report', x_room_of: WORLD, parent_narrative: parent, relations: [], created_at: at } as El);
  const roomOf = (els: El[]) => { const r = room(); for (const e of els) r.feed.els.set(e.id, e); return r; };

  it('I1: a parent that is a held report\'s id in upper case names no report', () => {
    const A = '019a7120-0000-7000-8000-000000002801';
    const r = roomOf([report2(A, null, '2026-11-12T09:00:00Z'), report2('019a7120-0000-7000-8000-000000002802', A.toUpperCase(), '2026-11-12T09:10:00Z')]);
    expect(r.answers(A)).toEqual([]);
    expect(r.lines().find(l => l.id.endsWith('2802'))!.parent).toBe(A.toUpperCase());
  });

  it('I2: one id held twice, the second copy in upper case, is two reports; a parent in lowercase names the first alone', () => {
    const A = '019a7120-0000-7000-8000-000000002901';
    const C = '019a7120-0000-7000-8000-000000002902';
    const r = roomOf([report2(A, null, '2026-11-12T09:00:00Z'), report2(A.toUpperCase(), null, '2026-11-12T09:05:00Z'), report2(C, A, '2026-11-12T09:10:00Z')]);
    expect(r.lines().map(l => l.id)).toEqual([A, A.toUpperCase(), C]);
    expect(r.answers(A).map(l => l.id)).toEqual([C]);
    expect(r.answers(A.toUpperCase())).toEqual([]);
  });
});

describe('Room.take', () => {
  const take = async (mark: unknown) => {
    const r = room();
    r.feed.els.set('i1', item('i1', { x_room_of: mark }));
    await r.take('i1');
    return calls.filter(c => c.op === 'create');
  };

  it("copies the item's mark lowercase when it is an id in the form in another case", async () => {
    const U = '019A2C7E-41B0-7A12-8C3D-6E5F4A3B2C22';
    const made = await take(U);
    expect(made).toHaveLength(1);
    expect(made[0].body!.x_room_of).toBe(U.toLowerCase());
    expect(made[0].body!.x_room_item).toBe('i1');
  });

  it('copies any other mark exactly as written (no hyphens is no id in the form)', async () => {
    const odd = '019A2C7E41B07A128C3D6E5F4A3B2C22';
    expect((await take(odd))[0].body!.x_room_of).toBe(odd);
  });
});
