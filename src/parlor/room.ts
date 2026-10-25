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
  OWNER, type El, type Switches, type Kind, type BoardColour, readLines, readHearts, readSpecs, readVotes,
  readSittings, readCharter, readMemberCharacters, linesOfSitting, myHearts, tally, newLine, newSpec, newHeart,
  newVote, newSitting, newMember, phasePatch, switchPatch, starPatch, starOf, ofRoom, readBoard, newBoardEntry,
  readWork, newWorkItem, isPickable, readChanges,
} from './shapes';
import { simpleCaseFold } from '@onlyworlds/sdk';
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

  /** The shown sitting's specs; its star is that sitting's x_star (an old sitting's subtype star when it names none). */
  specs() {
    return readSpecs(this.shown(), this.hearts(), starOf(this.sitting()));
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

  /** Every room board entry, whatever sitting raised it: an entry waits across sittings. */
  board() {
    return readBoard(this.els.values());
  }

  /** Whom a board entry can wait on: each seat on the roster with a Character, by its name. */
  waitables(): { character: string; name: string }[] {
    const members = this.members();
    const out: { character: string; name: string }[] = [];
    for (const seat of this.seats()) {
      const row = this.roster?.find(m => (m.id ?? OWNER) === seat.by);
      const character = row?.character ?? members.get(seat.by)?.id ?? null;
      if (character) out.push({ character, name: seat.name });
    }
    return out;
  }

  /** A Character's name for the board: the seat's name, else the element's (said as gone when its seat left), else 'someone'. */
  characterName(id: string): string {
    const seat = this.waitables().find(x => x.character === id);
    if (seat) return seat.name;
    const name = (this.els.get(id)?.name ?? '').toString().trim() || 'someone';
    const members = this.members();
    const left = (this.roster ?? []).some(m => m.status === 'removed' && (m.character === id || members.get(m.id ?? OWNER)?.id === id));
    return left ? `${name} (left)` : name;
  }

  /** The room's lines answering one thing (a board entry by parent, a work item by relations), across every sitting. */
  answers(id: string) {
    return readLines(this.els.values()).filter(l => l.parent === id || l.about === id);
  }

  /** The world's own recent changes (a world's parlor's work surface). */
  changes() {
    return readChanges(this.els.values());
  }

  /** Every room work item in the world, whatever sitting made it. */
  work() {
    return readWork(this.els.values(), this.world.id);
  }

  /** Whom a work item can be for: a seat that can write, with a Character (a guest never reads a Relation by actor). */
  writers(): { character: string; name: string }[] {
    const can = new Set(this.seats().filter(s => s.role !== 'watcher').map(s => s.name));
    return this.waitables().filter(w => can.has(w.name));
  }

  /** The world's own elements a person may pick as what a work item is about, by name, at most `max`. */
  pickable(query: string, skip: ReadonlySet<string>, max = 8): { type: string; id: string; name: string }[] {
    const q = simpleCaseFold(query.trim());
    if (!q) return [];
    const out: { type: string; id: string; name: string }[] = [];
    for (const el of this.els.values()) {
      if (skip.has(el.id) || !isPickable(el)) continue;
      const name = (el.name ?? '').toString();
      if (!simpleCaseFold(name).includes(q)) continue;
      out.push({ type: simpleCaseFold(el.type), id: el.id, name });
      if (out.length >= max) break;
    }
    return out;
  }

  /** An element's name for a work item's chip, or null when this world does not hold it. */
  elementName(id: string): string | null {
    const el = this.els.get(id);
    return el ? (el.name ?? '').toString().trim() || 'Untitled' : null;
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
  post(text: string, parent: string | null = null, about: string | null = null): Promise<void> {
    this.showSitting = null;
    return this.serial(async () => {
      this.landed(await this.client.create('narrative', newLine(text, this.myCharacter(), parent, this.roomOfNow(), about)));
    });
  }

  /** A work item, marked like a line; its picks go in the Relation's typed link fields. */
  makeWork(title: string, text: string, forWho: string | null, picks: ReadonlyArray<{ type: string; id: string }>): Promise<void> {
    return this.serial(async () => {
      this.landed(await this.client.create('relation', newWorkItem(title, text, forWho, picks, this.roomOfNow())));
    });
  }

  /** Close (done) or reopen a work item: its maker, the host or a co-host. The one write keel's draught reads. */
  setWorkState(id: string, state: 'done' | 'open'): Promise<void> {
    return this.serial(async () => {
      const item = this.work().find(w => w.id === id);
      if (!item || !this.canRetire(item.by)) return;
      this.landed(await this.client.patch('relation', item.id, { subtype: state }));
    });
  }

  /** Delete one work item, by its id: its maker, the host or a co-host. */
  deleteWork(id: string): Promise<void> {
    return this.serial(async () => {
      const item = this.work().find(w => w.id === id);
      if (!item || !this.canRetire(item.by)) return;
      await this.client.delete('relation', item.id);
      this.feed.removeLocal(item.id);
      this.feed.poke();
    });
  }

  /**
   * My spec in the newest sitting is edited (its title and text, and its kind when one is picked:
   * an old spec's subtype, February's star, is never overwritten by an edit that picks none); in a
   * new sitting I start a new one, which needs a kind.
   */
  saveSpec(title: string, text: string, kind: Kind | null): Promise<void> {
    return this.serial(async () => {
      const had = readSpecs(this.live(), []).find(s => s.by === this.meBy);
      if (had) {
        const patch: Record<string, unknown> = { name: title.trim(), description: text };
        if (kind) patch.subtype = kind;
        this.landed(await this.client.patch('construct', had.id, patch));
      } else if (kind) {
        this.landed(await this.client.create('construct', newSpec(title, text, kind, this.roomOfNow())));
      }
    });
  }

  /** A board entry, marked like a line: the newest sitting's, else the world's. */
  raise(title: string, text: string, colour: BoardColour, waitsOn: string | null): Promise<void> {
    return this.serial(async () => {
      this.landed(await this.client.create('narrative', newBoardEntry(title, text, colour, waitsOn, this.myCharacter(), this.roomOfNow())));
    });
  }

  /** Who may take an entry off the board: its maker, the host and co-hosts (keel lets an owner and a co-builder delete). */
  canRetire(by: string): boolean {
    return this.canWrite && (by === this.meBy || this.isHost);
  }

  /** Done: one entry off the board, by its one id. */
  done(entryId: string): Promise<void> {
    return this.serial(async () => {
      const entry = this.board().find(e => e.id === entryId);
      if (!entry || !this.canRetire(entry.by)) return;
      await this.client.delete('narrative', entry.id);
      this.feed.removeLocal(entry.id);
      this.feed.poke();
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

  /** The winner is a fact about the newest sitting (its x_star): one patch on it, no spec written. */
  star(specId: string): Promise<void> {
    return this.serial(async () => {
      const s = this.newestSitting();
      if (!s || !readSpecs(this.live(), []).some(x => x.id === specId)) return;
      this.landed(await this.client.patch('event', s.id, starPatch(specId)));
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
