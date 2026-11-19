/**
 * Following the room (design sheet §1): poll `GET /changes?head=true` every 2 s
 * while the tab is visible and every 15 s hidden, compare the head with the
 * head last APPLIED (not the last poll's, so a missed tick never drops a
 * change), and walk the feed only when the head or the view's epoch moved.
 * A head below ours means the server rewound: walk again from zero. A 409
 * `resync_required` walks again from zero too; for what the old copy holds and
 * the new walk does not name, `view` drops it and `role` (or no reason) keeps
 * it (the SDK's rule; never empty a copy on our own).
 */

import { isRoomElement, type OwChange } from '@onlyworlds/sdk';
import type { El } from './shapes';

/**
 * An element removed from the world, as the feed's delete row says it (who, through which door, when), with its name
 * and whether it was a room element kept from the copy that held it at the removal; both null when this copy never
 * held it (a walk from zero names no removed element).
 */
export interface Removal {
  id: string;
  type: string;
  name: string | null;
  room: boolean | null;
  /** The membership that removed it; null for the world's owner, or for a removal from before writes recorded it. */
  by: string | null;
  via: string | null;
  client: string | null;
  at: string;
}

/** The two calls the feed makes: an OwV2Client, or a fake in the tests. */
export interface FeedClient {
  changesHead(): Promise<{ head: number; cursor: string; epoch: number | null }>;
  changesAll(since?: string): AsyncGenerator<OwChange, { cursor: string; head: number; epoch: number | null }>;
}

export const POLL_VISIBLE_MS = 2000;
export const POLL_HIDDEN_MS = 15000;

type Listener = () => void;

export class RoomFeed {
  readonly els = new Map<string, El>();
  /** The elements removed from the world (never one hidden from this reader), by id. */
  readonly removals = new Map<string, Removal>();
  private cursor: string | undefined;
  private appliedHead = -1;
  private appliedEpoch: number | null = null;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy: Promise<void> | null = null;
  /** The last poll's error, for the room to say "cannot reach OnlyWorlds"; null once a poll works. */
  lastError: unknown = null;

  constructor(private readonly client: FeedClient, private readonly isHidden: () => boolean = () => false) {}

  get head(): number {
    return this.appliedHead;
  }

  /** True once a walk has completed: the copy is the world as served, not a first read that failed or has not run. */
  get walked(): boolean {
    return this.cursor !== undefined;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private moves = 0;
  /** A count that moves with every change the room is told of: what is read from the copy once per change is keyed by it. */
  get version(): number {
    return this.moves;
  }

  private emit(): void {
    this.moves++;
    for (const fn of this.listeners) fn();
  }

  /** Something the room draws from outside the feed changed (the roster, the hidden list): redraw. */
  changed(): void {
    this.emit();
  }

  /** The first walk, then the poll. */
  async start(): Promise<void> {
    this.running = true;
    await this.sync();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Poll now (after a write of our own, or the tab coming back). */
  poke(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.sync().finally(() => this.schedule());
  }

  private schedule(): void {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync().finally(() => this.schedule());
    }, this.isHidden() ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
  }

  /** One poll: head first, a walk only when something moved. Never two at once. */
  sync(): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.syncOnce().finally(() => { this.busy = null; });
    return this.busy;
  }

  private async syncOnce(): Promise<void> {
    try {
      if (this.cursor === undefined) {
        await this.walk(undefined, 'replace');
      } else {
        const h = await this.client.changesHead();
        if (h.head < this.appliedHead) {
          await this.walk(undefined, 'keep');
        } else if (h.head !== this.appliedHead || h.epoch !== this.appliedEpoch) {
          await this.walk(this.cursor, 'apply');
        }
      }
      this.lastError = null;
    } catch (err) {
      this.lastError = err;
      this.emit();
    }
  }

  /**
   * Walk from `since` to the tail. `apply`: changes onto the copy. `replace`:
   * the first walk. `keep` / `drop`: a walk from zero whose result replaces
   * the copy, keeping or dropping what it no longer names.
   */
  private async walk(since: string | undefined, mode: 'apply' | 'replace' | 'keep' | 'drop'): Promise<void> {
    const fresh = mode === 'apply' ? this.els : new Map<string, El>();
    let end: { cursor: string; head: number; epoch: number | null };
    try {
      const it = this.client.changesAll(since);
      for (;;) {
        const step = await it.next();
        if (step.done) { end = step.value; break; }
        applyChange(fresh, step.value, this.removals, this.els);
      }
    } catch (err) {
      if (since !== undefined && isResync(err)) {
        await this.walk(undefined, resyncReason(err) === 'view' ? 'drop' : 'keep');
        return;
      }
      throw err;
    }
    if (mode !== 'apply') {
      if (mode === 'keep') {
        for (const [id, el] of this.els) if (!fresh.has(id)) fresh.set(id, el);
      }
      this.els.clear();
      for (const [id, el] of fresh) this.els.set(id, el);
    }
    this.cursor = end.cursor;
    this.appliedHead = end.head;
    this.appliedEpoch = end.epoch;
    this.emit();
  }

  /** Our own write, shown at once; the feed brings the server's copy on the next walk. */
  applyLocal(el: El): void {
    this.els.set(el.id, el);
    this.emit();
  }

  removeLocal(id: string): void {
    if (this.els.delete(id)) this.emit();
  }
}

/**
 * One change onto the copy. With `removals`, a delete row whose element is gone from the world (not one hidden from
 * this reader) is recorded, its name taken from the copy that held it (`els`, else `before`, else an earlier record).
 */
export function applyChange(els: Map<string, El>, ch: OwChange, removals?: Map<string, Removal>, before?: ReadonlyMap<string, El>): void {
  if (ch.op === 'upsert') {
    els.set(ch.id, { ...(ch.element as unknown as El), id: ch.id, type: ch.type.toLowerCase() });
    removals?.delete(ch.id);
    return;
  }
  const old = els.get(ch.id) ?? before?.get(ch.id);
  els.delete(ch.id);
  if (!removals || (ch.reason !== undefined && ch.reason !== 'deleted') || !ch.deleted_at) return;
  // An element the reader held hidden or as a stub was never named here, and its removal is not either.
  if (old && (old.hidden === true || old.known_of === true)) return;
  const prev = removals.get(ch.id);
  const name = old ? ((typeof old.name === 'string' && old.name.trim()) || 'Untitled') : prev?.name ?? null;
  removals.set(ch.id, {
    id: ch.id,
    type: ch.type.toLowerCase(),
    name,
    room: old ? isRoomElement(old as Parameters<typeof isRoomElement>[0]) : prev?.room ?? null,
    by: ch.deleted_by ?? null,
    via: ch.deleted_via ?? null,
    client: ch.deleted_client ?? null,
    at: ch.deleted_at,
  });
}

function isResync(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { isResyncRequired?: boolean }).isResyncRequired === true;
}

function resyncReason(err: unknown): string | undefined {
  return (err as { resyncReason?: string }).resyncReason;
}
