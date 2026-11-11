import { describe, expect, it } from 'vitest';
import { OwApiError, OwNetworkError, type OwMe, type OwWorldFileRow } from '@onlyworlds/sdk';
import { MAX_BYTES, RoomFiles, adderOf, fileProblem, filesName, pickRefusal, sizeWords } from './files';
import { lineName, newLine } from './shapes';

const apiError = (status: number, code: string) => new OwApiError(status, code, 'raw keel text', null, null);
const row = (id: string, line: string, membership: string | null = 'm-ada', size = 10): OwWorldFileRow => ({
  id, name: `${id}.png`, kind: 'png', size, label: null, added_by: { name: 'ada', membership, agent: false },
  added_at: `2026-11-10T20:0${id.length % 10}:00Z`, element_type: 'narrative', element_id: line,
} as OwWorldFileRow);
const blob = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('adderOf (the owner flag on a file row)', () => {
  const by = (membership: string | null, owner?: boolean) =>
    ({ ...row('f', 'l', membership), added_by: { name: 'x', membership, agent: false, ...(owner === undefined ? {} : { owner }) } } as OwWorldFileRow);
  it("a seat's file is its membership, whatever the flag", () => {
    expect(adderOf(by('m-ada', false), 'OWN')).toBe('m-ada');
    expect(adderOf(by('m-ada'), 'OWN')).toBe('m-ada');
  });
  it('a null membership is the owner only when keel says so', () => {
    expect(adderOf(by(null, true), 'OWN')).toBe('OWN');
    expect(adderOf(by(null, false), 'OWN')).toBeNull();
  });
  it('a keel from before the flag reads a null membership as the owner, as before', () => {
    expect(adderOf(by(null), 'OWN')).toBe('OWN');
  });
});
const tick = () => new Promise(r => setTimeout(r, 0));

/** A fake keel: tickets by file id, an upload that can lose its answer after storing the bytes. */
function fakeKeel() {
  const stored = new Map<string, OwWorldFileRow>();
  let n = 0;
  const k = {
    tickets: 0, uploads: 0, loseNextAnswer: false, expireNext: false, dropNext: false,
    async worldFiles() { return { data: [...stored.values()], used_bytes: 0, cap_bytes: 0 }; },
    async createFileTicket(_t: string, id: string, req: { name: string; size: number }) {
      k.tickets++;
      return { ticket: `t${++n}`, file_id: `f${n}`, line: id, name: req.name, size: req.size } as never;
    },
    async uploadFile(_t: string, id: string, _f: Blob, opts: { ticket: { file_id: string; name: string; size: number } }) {
      k.uploads++;
      const fid = opts.ticket.file_id;
      if (k.expireNext) { k.expireNext = false; throw apiError(401, 'ticket_expired'); }
      if (k.dropNext) { k.dropNext = false; throw new OwNetworkError('cut before the bytes landed', null); }
      if (stored.has(fid)) throw apiError(409, 'exists');
      stored.set(fid, row(fid, id));
      if (k.loseNextAnswer) { k.loseNextAnswer = false; throw new OwNetworkError('lost', null); }
      return { key: '', fid, bytes: opts.ticket.size, type: 'image/png', etag: '' };
    },
    async fileDownloadLink() { throw new Error('not in this test'); },
    async removeFile() { /* gone */ },
    stored,
  };
  return k;
}

describe('the pick', () => {
  it('refuses what keel would, before anything is sent', () => {
    expect(pickRefusal(blob('screen.webp'))).toBeNull();
    expect(pickRefusal(blob('notes.md'))).toBeNull();
    expect(pickRefusal(blob('a.gif'))).toMatch(/none of those/);
    expect(pickRefusal(blob('IMG_1.HEIC'))).toMatch(/Save it as a jpg/);
    expect(pickRefusal(blob('empty.png', 0))).toMatch(/is empty/);
    expect(pickRefusal({ name: 'big.zip', size: MAX_BYTES + 1 })).toMatch(/at most 25 MB/);
    expect(pickRefusal({ name: 'big.zip', size: MAX_BYTES })).toBeNull();
    expect(pickRefusal({ name: `${'a'.repeat(252)}.png`, size: 1 })).toMatch(/too long/);
  });
  it('says sizes in keel\'s binary units', () => {
    expect(sizeWords(294)).toBe('294 bytes');
    expect(sizeWords(2048)).toBe('2 KB');
    expect(sizeWords(MAX_BYTES)).toBe('25 MB');
    expect(sizeWords(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('a refused file in the person\'s words', () => {
  it('names the file codes before the generic statuses, never keel\'s text', () => {
    expect(fileProblem(apiError(401, 'ticket_expired'), 'a.png')).toEqual({ line: 'a.png was not added: its sending took too long.', retry: true });
    expect(fileProblem(apiError(429, 'quota_exceeded'), 'a.png').retry).toBe(false);
    expect(fileProblem(apiError(415, 'unsupported_type'), 'a.png').line).toMatch(/not what its name says/);
    expect(fileProblem(apiError(403, 'files_full'), 'a.png').line).toMatch(/files are full/);
    expect(fileProblem(apiError(404, 'not_found'), 'a.png').line).toMatch(/gone, or hidden/);
    expect(fileProblem(new OwNetworkError('x', null), 'a.png').retry).toBe(true);
    for (const e of [apiError(500, 'write_failed'), apiError(403, 'permission_error'), apiError(401, 'invalid_key')]) {
      expect(fileProblem(e, 'a.png').line).not.toMatch(/raw keel text/);
    }
  });
});

describe('a line of files', () => {
  it('a line with no words is named by its files and keeps an empty description', () => {
    const body = newLine('', null, null, 'w1', null, filesName([{ name: 'ember.webp' }, { name: 'notes.md' }]));
    expect(body.name).toBe('ember.webp, notes.md');
    expect(body.description).toBe('');
    expect(lineName('x'.repeat(80))).toHaveLength(60);
    expect(newLine('hello', null, null, 'w1', null, 'ignored.png').name).toBe('hello');
  });
});

describe('sending files', () => {
  it('sends each file once to the line it was given, and lists it when keel does', async () => {
    const k = fakeKeel();
    const files = new RoomFiles(k as never, () => {});
    files.attach('line-1', [blob('a.png'), blob('b.png')]);
    for (let i = 0; i < 10; i++) await tick();
    expect(k.uploads).toBe(2);
    expect(files.onLine('line-1').map(r => r.id).sort()).toEqual(['f1', 'f2']);
    expect(files.pendingOn('line-1')).toEqual([]);
    files.close();
  });
  it('a lost answer is retried on the same ticket, and the host\'s exists reads as done: one file, never two (I2)', async () => {
    const k = fakeKeel();
    k.loseNextAnswer = true;
    const files = new RoomFiles(k as never, () => {});
    files.attach('line-1', [blob('a.png')]);
    for (let i = 0; i < 10; i++) await tick();
    const [p] = files.pending;
    expect(p.state).toBe('failed');
    expect(p.retry).toBe(true);
    files.again(p.key);
    for (let i = 0; i < 10; i++) await tick();
    expect(k.tickets).toBe(1);
    expect(k.stored.size).toBe(1);
    expect(files.onLine('line-1')).toHaveLength(1);
    files.close();
  });
  it('an expired ticket asks the list first: a file that landed is not sent again', async () => {
    const k = fakeKeel();
    // The bytes stored, the answer lost; by Try again the ticket has expired (the host refuses it before looking).
    k.loseNextAnswer = true;
    const files = new RoomFiles(k as never, () => {});
    files.attach('line-1', [blob('a.png')]);
    for (let i = 0; i < 10; i++) await tick();
    const [p] = files.pending;
    expect(p.state).toBe('failed');
    expect(p.ticket?.file_id).toBe('f1');
    k.expireNext = true;
    files.again(p.key);
    for (let i = 0; i < 10; i++) await tick();
    expect(k.tickets).toBe(1);
    expect(k.stored.size).toBe(1);
    expect(files.onLine('line-1').map(r => r.id)).toEqual(['f1']);
    expect(files.pendingOn('line-1')).toEqual([]);
    files.close();
  });
  it('Try again goes to the line of the failure, whatever came after (I3)', async () => {
    const k = fakeKeel();
    k.dropNext = true;
    const files = new RoomFiles(k as never, () => {});
    files.attach('line-1', [blob('a.png')]);
    for (let i = 0; i < 10; i++) await tick();
    files.attach('line-2', [blob('b.png')]);
    for (let i = 0; i < 10; i++) await tick();
    files.again(files.pending.find(x => x.lineId === 'line-1')!.key);
    for (let i = 0; i < 10; i++) await tick();
    expect(files.onLine('line-1').map(r => r.id)).toEqual(['f1']);
    expect(files.onLine('line-2').map(r => r.id)).toEqual(['f2']);
    files.close();
  });
  it('nothing more is sent once the room has closed (I8)', async () => {
    const k = fakeKeel();
    const files = new RoomFiles(k as never, () => {});
    files.close();
    files.attach('line-1', [blob('a.png')]);
    for (let i = 0; i < 10; i++) await tick();
    expect(k.tickets).toBe(0);
  });
});

describe('who may remove a file (I5)', () => {
  const files = new RoomFiles(fakeKeel() as never, () => {});
  const me = (role: string, membership: string | null) => ({ role, membership } as OwMe);
  it('the owner and the uploader, on a writing key; nobody on a reading one', () => {
    expect(files.mayRemove(row('f', 'l', 'm-ada'), me('owner', null), true)).toBe(true);
    expect(files.mayRemove(row('f', 'l', 'm-ada'), me('member', 'm-ada'), true)).toBe(true);
    expect(files.mayRemove(row('f', 'l', 'm-ada'), me('co-builder', 'm-bo'), true)).toBe(false);
    expect(files.mayRemove(row('f', 'l', null), me('member', null), true)).toBe(false);
    expect(files.mayRemove(row('f', 'l', 'm-ada'), me('owner', null), false)).toBe(false);
    expect(files.mayRemove(row('f', 'l', 'm-ada'), me('member', 'm-ada'), false)).toBe(false);
  });
});

describe('the code gate\'s races', () => {
  it('a file removed here stays gone, whatever a read begun before the remove answers (S1)', async () => {
    const k = fakeKeel();
    k.stored.set('f9', row('f9', 'line-1'));
    let release: () => void = () => {};
    const slow = { ...k, worldFiles: async () => { const data = [...k.stored.values()]; await new Promise<void>(r => { release = r; }); return { data, used_bytes: 0, cap_bytes: 0 }; } };
    const files = new RoomFiles(slow as never, () => {});
    files.rows = [row('f9', 'line-1')];
    const reading = files.read(); // begun while f9 is still stored
    await files.remove(files.rows[0]);
    release();
    await reading;
    expect(files.onLine('line-1')).toEqual([]);
    files.close();
  });
  it('an expired ticket whose list cannot be read keeps its ticket, so Try again cannot send a second copy (S6)', async () => {
    const k = fakeKeel();
    k.loseNextAnswer = true;
    let listFails = false;
    const flaky = { ...k, worldFiles: async () => { if (listFails) throw new OwNetworkError('down', null); return k.worldFiles(); } };
    const files = new RoomFiles(flaky as never, () => {});
    files.attach('line-1', [blob('a.png')]);
    for (let i = 0; i < 10; i++) await tick();
    const [p] = files.pending;
    listFails = true;
    k.expireNext = true;
    files.again(p.key);
    for (let i = 0; i < 10; i++) await tick();
    expect(p.state).toBe('failed');
    expect(p.ticket?.file_id).toBe('f1');
    listFails = false;
    files.again(p.key);
    for (let i = 0; i < 10; i++) await tick();
    expect(k.tickets).toBe(1);
    expect(k.stored.size).toBe(1);
    files.close();
  });
  it('an upload that lands after the room closed tells no one (I8)', async () => {
    const k = fakeKeel();
    let calls = 0;
    let land: () => void = () => {};
    const late = { ...k, uploadFile: async (...a: Parameters<typeof k.uploadFile>) => { await new Promise<void>(r => { land = r; }); return k.uploadFile(...a); } };
    const files = new RoomFiles(late as never, () => { calls++; });
    files.attach('line-1', [blob('a.png')]);
    for (let i = 0; i < 5; i++) await tick();
    const before = calls;
    files.close();
    land();
    for (let i = 0; i < 10; i++) await tick();
    expect(calls).toBe(before);
  });
});
