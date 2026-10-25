/**
 * One room: a person's seat in one world, the feed that follows it, and every
 * write the room makes. Each write goes out on the person's own key; the
 * result is shown at once and the feed brings the server's copy after.
 */

import { OwApiError, OwNetworkError, type OwMe, type OwMember, type OwV2Client } from '@onlyworlds/sdk';
import { RoomFeed } from './feed';
import { serialQueue } from './serial';
import { session, type AccountWorld } from './session';
import {
  OWNER, type El, type Switches, readLines, readHearts, readSpecs, readVotes, readSittings, readCharter,
  readMemberCharacters, linesOfSitting, myHearts, tally, newLine, newSpec, newHeart, newVote, newSitting,
  newMember, phasePatch, switchPatch, ofRoom,
} from './shapes';
import { canHost, canWrite, isAiSeat, nameOf, roomRole, seats, type RoomRole } from './roster';

function newestOf<T extends { at: string }>(xs: T[]): T | null {
  return [...xs].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

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

  /** True while the room shows an earlier sitting: a record to read, nothing in it to change. */
  get browsing(): boolean {
    const all = this.sittings();
    return !!this.showSitting && this.showSitting !== all[all.length - 1]?.id;
  }

  /** Lines stay by time: a line written while a new sitting is still on its way keeps its place. */
  lines() {
    const all = this.sittings();
    return linesOfSitting(readLines(this.els.values()), all, this.sitting()?.id ?? null);
  }

  /** The shown sitting's own specs, hearts and votes, by the mark (the world's before any sitting). */
  private shown(): El[] {
    return ofRoom(this.els.values(), this.sitting()?.id ?? this.world.id);
  }

  /** The newest sitting's: what every write reads and changes, whatever the room shows. */
  private live(): El[] {
    return ofRoom(this.els.values(), this.roomOfNow());
  }

  hearts() {
    return readHearts(this.shown());
  }

  specs() {
    return readSpecs(this.shown(), this.hearts());
  }

  myVote() {
    return newestOf(readVotes(this.shown()).filter(v => v.by === this.meBy));
  }

  tally() {
    return tally(readVotes(this.shown()));
  }

  charter() {
    return readCharter(this.els.values());
  }

  // ------------------------------------------------------------ writes

  /** Every write, one at a time in the order asked; each reads the room when its turn comes. */
  private serial = serialQueue();

  /**
   * The mark for a line, spec, heart or vote: the newest sitting when the
   * write's turn comes (never the one a host is browsing), else the world.
   */
  private roomOfNow(): string {
    const all = this.sittings();
    return all[all.length - 1]?.id ?? this.world.id;
  }

  private landed(el: unknown): void {
    this.feed.applyLocal(el as El);
    this.feed.poke();
  }

  setMyName(name: string): Promise<void> {
    return this.serial(async () => {
      this.landed(await this.client.create('character', newMember(name, this.world.id)));
    });
  }

  /** A line goes to the newest sitting, so writing one brings the room back to now, where it shows. */
  post(text: string, parent: string | null = null): Promise<void> {
    this.showSitting = null;
    return this.serial(async () => {
      this.landed(await this.client.create('narrative', newLine(text, this.myCharacter(), parent, this.roomOfNow())));
    });
  }

  /** My spec in the newest sitting is edited; in a new sitting I start a new one. */
  saveSpec(title: string, text: string): Promise<void> {
    return this.serial(async () => {
      const body = newSpec(title, text, this.roomOfNow());
      const had = readSpecs(this.live(), []).find(s => s.by === this.meBy);
      this.landed(had ? await this.client.patch('construct', had.id, { name: body.name, description: body.description })
        : await this.client.create('construct', body));
    });
  }

  toggleHeart(specId: string, specTitle: string): Promise<void> {
    return this.serial(async () => {
      const mine = myHearts(readHearts(this.live()), this.meBy, specId);
      if (mine.length) {
        for (const h of mine) {
          await this.client.delete('relation', h.id);
          this.feed.removeLocal(h.id);
        }
        this.feed.poke();
        return;
      }
      this.landed(await this.client.create('relation', newHeart(specId, specTitle, this.myCharacter(), this.roomOfNow())));
    });
  }

  vote(picks: string[]): Promise<void> {
    return this.serial(async () => {
      const had = newestOf(readVotes(this.live()).filter(v => v.by === this.meBy));
      const body = newVote(picks, this.myCharacter(), this.roomOfNow());
      this.landed(had ? await this.client.patch('relation', had.id, { constructs: body.constructs })
        : await this.client.create('relation', body));
    });
  }

  // ------------------------------------------------------------ the host's hand

  startSitting(name: string): Promise<void> {
    return this.serial(async () => {
      const { head } = await this.client.changesHead();
      const made = await this.client.create('event', newSitting(name, head, this.world.id));
      this.showSitting = null;
      this.landed(made);
    });
  }

  /** The phase and switches move the newest sitting, never one a host is reading back. */
  private newestSitting() {
    const all = this.sittings();
    return all[all.length - 1] ?? null;
  }

  setPhase(phase: string): Promise<void> {
    return this.serial(async () => {
      const s = this.newestSitting();
      if (!s) return;
      this.landed(await this.client.patch('event', s.id, phasePatch(phase)));
    });
  }

  setSwitch(which: keyof Switches, on: boolean): Promise<void> {
    return this.serial(async () => {
      const s = this.newestSitting();
      if (!s) return;
      this.landed(await this.client.patch('event', s.id, switchPatch(which, on)));
    });
  }

  /** The winner: one star in the newest sitting. */
  star(specId: string): Promise<void> {
    return this.serial(async () => {
      for (const spec of readSpecs(this.live(), [])) {
        if (spec.star && spec.id !== specId) this.landed(await this.client.patch('construct', spec.id, { subtype: '' }));
      }
      this.landed(await this.client.patch('construct', specId, { subtype: 'star' }));
    });
  }

  /**
   * Hide a line from the room (keel's hidden mark: owner and co-builders; the
   * poster and the hosts still see it, so the host's room marks it). The SDK's
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

  /** What is hidden, for a host's room (GET /world/hidden is a host's read, the SDK's listHidden). */
  async loadHidden(): Promise<void> {
    if (!this.isHost) return;
    try {
      const next = new Set((await this.client.listHidden()).map(r => r.id));
      const moved = next.size !== this.hidden.size || [...next].some(id => !this.hidden.has(id));
      this.hidden = next;
      if (moved) this.feed.changed();
    } catch { /* the room still works; the marks show after the next look */ }
  }
}
