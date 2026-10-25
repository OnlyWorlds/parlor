import { describe, expect, it } from 'vitest';
import type { OwChange } from '@onlyworlds/sdk';
import { RoomFeed, type FeedClient } from './feed';

/** A keel in miniature: a log of changes, a head, an epoch, and the 409 on demand. */
class FakeKeel implements FeedClient {
  log: OwChange[] = [];
  epoch: number | null = null;
  resyncOnce: 'view' | 'role' | null = null;
  heads = 0;
  walks: Array<string | undefined> = [];
  seq = 0;

  upsert(id: string, extra: Record<string, unknown> = {}): void {
    const seq = ++this.seq;
    this.log.push({ op: 'upsert', id, type: 'Narrative', element: { id, name: id, ...extra } as never, updated_at: '', change_seq: seq });
  }
  remove(id: string, reason?: 'deleted' | 'hidden'): void {
    const seq = ++this.seq;
    this.log.push({ op: 'delete', id, type: 'narrative', deleted_at: '', change_seq: seq, reason });
  }
  /** What a walk from zero yields: the live elements, once each (keel compacts). */
  private live(): OwChange[] {
    const last = new Map<string, OwChange>();
    for (const c of this.log) last.set(c.id, c);
    return [...last.values()].filter(c => c.op === 'upsert');
  }
  async changesHead() {
    this.heads++;
    return { head: this.seq, cursor: String(this.seq), epoch: this.epoch };
  }
  async *changesAll(since?: string) {
    this.walks.push(since);
    if (since !== undefined && this.resyncOnce) {
      const reason = this.resyncOnce;
      this.resyncOnce = null;
      throw Object.assign(new Error('resync'), { isResyncRequired: true, resyncReason: reason });
    }
    const from = since === undefined ? 0 : Number(since);
    const items = since === undefined ? this.live() : this.log.filter(c => c.change_seq > from);
    for (const c of items) yield c;
    return { cursor: String(this.seq), head: this.seq, epoch: this.epoch };
  }
}

const ids = (f: RoomFeed) => [...f.els.keys()].sort();

describe('RoomFeed', () => {
  it('walks once, then reads only the head until it moves', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    const f = new RoomFeed(k);
    await f.sync();
    expect(ids(f)).toEqual(['a']);
    expect(f.els.get('a')!.type).toBe('narrative');
    await f.sync();
    await f.sync();
    expect(k.walks).toEqual([undefined]);
    expect(k.heads).toBe(2);
    k.upsert('b');
    k.remove('a');
    await f.sync();
    expect(k.walks).toEqual([undefined, '1']);
    expect(ids(f)).toEqual(['b']);
  });

  it('walks when the epoch moves with the head still', async () => {
    const k = new FakeKeel();
    k.epoch = 1;
    k.upsert('a');
    const f = new RoomFeed(k);
    await f.sync();
    k.epoch = 2;
    await f.sync();
    expect(k.walks.length).toBe(2);
  });

  it('a head below ours walks again from zero and keeps what it no longer names', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    k.upsert('b');
    const f = new RoomFeed(k);
    await f.sync();
    k.log = k.log.slice(0, 1); // a restore: the server rewound
    k.seq = 1;
    await f.sync();
    expect(k.walks).toEqual([undefined, undefined]);
    expect(ids(f)).toEqual(['a', 'b']);
  });

  it('a 409 for the view drops what the new walk does not name', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    k.upsert('b');
    const f = new RoomFeed(k);
    await f.sync();
    k.log = k.log.filter(c => c.id !== 'b'); // b hidden from this reader
    k.upsert('c');
    k.resyncOnce = 'view';
    await f.sync();
    expect(ids(f)).toEqual(['a', 'c']);
  });

  it('a 409 for the role keeps what the new walk does not name', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    k.upsert('b');
    const f = new RoomFeed(k);
    await f.sync();
    k.log = k.log.filter(c => c.id !== 'b');
    k.upsert('c');
    k.resyncOnce = 'role';
    await f.sync();
    expect(ids(f)).toEqual(['a', 'b', 'c']);
  });

  it('a hidden line leaves the room by its delete row', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    const f = new RoomFeed(k);
    await f.sync();
    k.remove('a', 'hidden');
    await f.sync();
    expect(ids(f)).toEqual([]);
  });

  it('never runs two polls at once', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    const f = new RoomFeed(k);
    await Promise.all([f.sync(), f.sync(), f.sync()]);
    expect(k.walks).toEqual([undefined]);
  });

  it('keeps the copy and says why when a poll fails', async () => {
    const k = new FakeKeel();
    k.upsert('a');
    const f = new RoomFeed(k);
    await f.sync();
    k.changesHead = async () => { throw new Error('offline'); };
    await f.sync();
    expect(ids(f)).toEqual(['a']);
    expect((f.lastError as Error).message).toBe('offline');
  });
});
