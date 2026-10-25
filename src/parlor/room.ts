/**
 * One room: a person's seat in one world, the feed that follows it, and every
 * write the room makes. Each write goes out on the person's own key; the
 * result is shown at once and the feed brings the server's copy after.
 */

import { OwApiError, OwNetworkError, type OwMe, type OwMember, type OwV2Client } from '@onlyworlds/sdk';
import { RoomFeed } from './feed';
import { serialQueue } from './serial';
import { apiBase, session, type AccountWorld } from './session';
import {
  OWNER, type El, type Switches, readLines, readHearts, readSpecs, readVotes, readSittings, readCharter,
  readMemberCharacters, linesOfSitting, myHearts, tally, newLine, newSpec, newHeart, newVote, newSitting,
  newMember, phasePatch, switchPatch,
} from './shapes';
import { canHost, canWrite, isAiSeat, nameOf, roomRole, seats, type RoomRole } from './roster';

/** A refusal in the person's words. Never keel's raw text. */
export function problemLine(err: unknown, doing: string): string {
  if (err instanceof OwNetworkError) return `OnlyWorlds could not be reached while ${doing}. Check your connection; nothing was lost.`;
  if (err instanceof OwApiError || (err && typeof err === 'object' && 'status' in err)) {
    const e = err as { status: number; code?: string | null };
    if (e.status === 401) return `Your PIN did not match while ${doing}. Check it under Your seat.`;
    if (e.code === 'not_author') return 'Only the person who made it can change that.';
    if (e.status === 403) return `Your seat in this world cannot do that (${doing}).`;
    if (e.status === 429) return 'Too many requests for a moment. Wait a little and try again.';
    if (e.code === 'pin_required') return 'Your account needs a PIN before it can write. Set one on onlyworlds.com, under Account settings.';
  }
  return `Something went wrong while ${doing}. Try again in a moment.`;
}

export class Room {
  readonly feed: RoomFeed;
  me!: OwMe;
  roster: OwMember[] | null = null;
  role: RoomRole = 'watcher';
  /** What a host has hidden (the host still sees it, marked). */
  hidden = new Set<string>();
  /** The sitting the room shows; null = the newest. */
  showSitting: string | null = null;

  private constructor(readonly world: AccountWorld, readonly client: OwV2Client) {
    this.feed = new RoomFeed(client, () => document.visibilityState === 'hidden');
  }

  static async open(world: AccountWorld): Promise<Room> {
    const client = await session.worldClient(world);
    const room = new Room(world, client);
    room.me = await client.me();
    room.role = roomRole(room.me.role);
    await room.refreshRoster();
    await room.loadHidden();
    room.feed.subscribe(room.rosterWatch);
    await room.feed.start();
    room.rosterTimer = setInterval(() => { if (document.visibilityState === 'visible') void room.refreshRoster(); }, 30000);
    document.addEventListener('visibilitychange', room.onVisible);
    return room;
  }

  close(): void {
    this.feed.stop();
    if (this.rosterTimer) clearInterval(this.rosterTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      this.feed.poke();
      void this.refreshRoster();
      void this.loadHidden();
    }
  };

  async refreshRoster(): Promise<void> {
    this.rosterAt = Date.now();
    try {
      const before = JSON.stringify(this.roster);
      this.roster = await this.client.members();
      if (JSON.stringify(this.roster) !== before) this.feed.changed();
    } catch {
      // A guest may not read the roster: names fall back to Member Characters.
    }
  }

  private rosterAt = 0;
  private rosterTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * A join moves no element, so the feed cannot say someone arrived: read the
   * roster every 30 s, and at once (at most every 3 s) when an element names a
   * seat the roster does not know.
   */
  private rosterWatch = (): void => {
    const known = new Set((this.roster ?? []).map(m => m.id ?? OWNER));
    const stranger = [...this.els.values()].some(el => !known.has(el.created_by ?? OWNER));
    if (stranger && Date.now() - this.rosterAt > 3000) void this.refreshRoster();
  };

  // ------------------------------------------------------------ reads

  get els(): ReadonlyMap<string, El> {
    return this.feed.els;
  }

  get meBy(): string {
    return this.me.membership ?? OWNER;
  }

  get isHost(): boolean {
    return canHost(this.role);
  }

  get canWrite(): boolean {
    return canWrite(this.role) && this.me.scope === 'write';
  }

  members(): Map<string, { id: string; name: string }> {
    return readMemberCharacters(this.els.values());
  }

  /** My Character for `narrator` and `actor`: the roster's, else the one I made here, else none. */
  myCharacter(): string | null {
    return this.me.character ?? this.members().get(this.meBy)?.id ?? null;
  }

  /** True when the room cannot name me yet: a person (the host too) with no Character of any kind. */
  needsName(): boolean {
    return this.canWrite && this.me.kind !== 'agent' && !this.myCharacter();
  }

  name(by: string): string {
    return nameOf(by, this.roster, this.els, this.members());
  }

  isAi(by: string, door?: string | null): boolean {
    return isAiSeat(by, this.roster, door);
  }

  seats() {
    return seats(this.roster, this.els, this.members());
  }

  sittings() {
    return readSittings(this.els.values());
  }

  sitting() {
    const all = this.sittings();
    return (this.showSitting ? all.find(s => s.id === this.showSitting) : undefined) ?? all[all.length - 1] ?? null;
  }

  lines() {
    const all = this.sittings();
    return linesOfSitting(readLines(this.els.values()), all, this.sitting()?.id ?? null);
  }

  hearts() {
    return readHearts(this.els.values());
  }

  specs() {
    return readSpecs(this.els.values(), this.hearts());
  }

  myVote() {
    const mine = readVotes(this.els.values()).filter(v => v.by === this.meBy);
    return mine.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  }

  tally() {
    return tally(readVotes(this.els.values()));
  }

  charter() {
    return readCharter(this.els.values());
  }

  // ------------------------------------------------------------ writes

  /** Every write, one at a time in the order asked; each reads the room when its turn comes. */
  private serial = serialQueue();

  private landed(el: unknown): void {
    this.feed.applyLocal(el as El);
    this.feed.poke();
  }

  setMyName(name: string): Promise<void> {
    return this.serial(async () => {
      this.landed(await this.client.create('character', newMember(name)));
    });
  }

  post(text: string, parent: string | null = null): Promise<void> {
    return this.serial(async () => {
      this.landed(await this.client.create('narrative', newLine(text, this.myCharacter(), parent)));
    });
  }

  saveSpec(title: string, text: string, id?: string): Promise<void> {
    return this.serial(async () => {
      const body = newSpec(title, text);
      this.landed(id ? await this.client.patch('construct', id, { name: body.name, description: body.description })
        : await this.client.create('construct', body));
    });
  }

  toggleHeart(specId: string, specTitle: string): Promise<void> {
    return this.serial(async () => {
      const mine = myHearts(this.hearts(), this.meBy, specId);
      if (mine.length) {
        for (const h of mine) {
          await this.client.delete('relation', h.id);
          this.feed.removeLocal(h.id);
        }
        this.feed.poke();
        return;
      }
      this.landed(await this.client.create('relation', newHeart(specId, specTitle, this.myCharacter())));
    });
  }

  vote(picks: string[]): Promise<void> {
    return this.serial(async () => {
      const had = this.myVote();
      const body = newVote(picks, this.myCharacter());
      this.landed(had ? await this.client.patch('relation', had.id, { constructs: body.constructs })
        : await this.client.create('relation', body));
    });
  }

  // ------------------------------------------------------------ the host's hand

  startSitting(name: string): Promise<void> {
    return this.serial(async () => {
      const { head } = await this.client.changesHead();
      const made = await this.client.create('event', newSitting(name, head));
      this.showSitting = null;
      this.landed(made);
    });
  }

  setPhase(phase: string): Promise<void> {
    return this.serial(async () => {
      const s = this.sitting();
      if (!s) return;
      this.landed(await this.client.patch('event', s.id, phasePatch(phase)));
    });
  }

  setSwitch(which: keyof Switches, on: boolean): Promise<void> {
    return this.serial(async () => {
      const s = this.sitting();
      if (!s) return;
      this.landed(await this.client.patch('event', s.id, switchPatch(which, on)));
    });
  }

  /** The winner: one star in the room. */
  star(specId: string): Promise<void> {
    return this.serial(async () => {
      for (const spec of this.specs()) {
        if (spec.star && spec.id !== specId) this.landed(await this.client.patch('construct', spec.id, { subtype: '' }));
      }
      this.landed(await this.client.patch('construct', specId, { subtype: 'star' }));
    });
  }

  /**
   * Hide a line from the room (keel's hidden mark: owner and co-builders; the
   * poster and the hosts still see it, so the host's room marks it). SDK 4.45's
   * hide and unhide (Kael h66 #9737).
   */
  hide(type: string, id: string, hidden = true): Promise<void> {
    return this.serial(async () => {
      if (hidden) await this.client.hide(type, id);
      else await this.client.unhide(type, id);
      if (hidden) this.hidden.add(id);
      else this.hidden.delete(id);
      this.feed.poke();
    });
  }

  /** What is hidden, for a host's room (GET /world/hidden is a host's read). */
  async loadHidden(): Promise<void> {
    if (!this.isHost) return;
    try {
      const raw = await this.hiddenList() as { data?: Array<{ id: string }> };
      const next = new Set((raw?.data ?? []).map(r => r.id));
      const moved = next.size !== this.hidden.size || [...next].some(id => !this.hidden.has(id));
      this.hidden = next;
      if (moved) this.feed.changed();
    } catch { /* the room still works; the marks show after the next look */ }
  }

  /** GET /world/hidden, the one route the SDK does not carry yet: a read, so no PIN. */
  private async hiddenList(): Promise<unknown> {
    const cred = session.credentials(this.world.id);
    if (!cred) throw new Error('no key');
    const res = await fetch(`${apiBase()}/world/hidden`, { headers: { 'API-Key': cred.key } });
    if (!res.ok) throw Object.assign(new Error(`hidden list ${res.status}`), { status: res.status });
    return res.json();
  }
}
