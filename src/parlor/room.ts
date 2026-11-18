/**
 * One room: a person's seat in one world, the feed that follows it, and every
 * write the room makes. Each write goes out on the person's own key; the
 * result is shown at once and the feed brings the server's copy after.
 */

import { OwApiError, OwNetworkError, OwPreconditionFailedError, type OwMe, type OwMember, type OwV2Client } from '@onlyworlds/sdk';
import { RoomFeed, type Removal } from './feed';
import { serialQueue } from './serial';
import { newestFirst } from './when';
import { session, KEPT_REMOVALS, type AccountWorld } from './session';
import {
  OWNER, type El, type Switches, type Kind, type BoardColour, readLines, readLinesAsGiven, orderLines, readHearts, readSpecs, readVotes,
  readSittings, readCharter, readMemberCharacters, linesOfSitting, linesOfUnseenSitting, myHearts, tally, newSpec, newHeart,
  newVote, newSitting, newMember, phasePatch, switchPatch, starPatch, starOf, ofRoom, readBoard, newBoardEntry,
  readWork, newWorkItem, isPickable, readChanges, newTake, deletableTakes, ROOM_MARK, addressOf, type WorkItem,
  newReport, localDay, isReportPickable, maySetDone, unmarkedCharters, CHARTER_MARK, REPORT_COMPLETED, type KeeperPart,
  isReport, isWorkItemPair, reportPartOf, completionPatch, newLineAt, readDesignParts, type Anchor, type DesignPart,
} from './shapes';
import { simpleCaseFold } from '@onlyworlds/sdk';
import { canHost, canWrite, isAiSeat, nameOf, roomRole, seats, type RoomRole } from './roster';
import { RoomFiles, filesName } from './files';
import { crewOf, workshopRuns, type Crew } from './crew';
import { hostLine, isHostRefusal } from './host';

/** A report born completed, pressed by a seat that no longer keeps the world: nothing was sent. */
export class KeeperOnly extends Error {}
/** The work item a keeper's report sets done is gone, or no longer open or taken: nothing was sent. */
export class ItemMoved extends Error {}
/** Reading or setting the work item done failed: nothing was handed in (a lost answer may still have set it done). */
export class DoneFailed extends Error {
  constructor(readonly failure: unknown) { super('done failed'); }
}
/** A report to complete is gone, completed, changed since the keeper opened it, or hidden: nothing was sent. */
export class ReportMoved extends Error {
  constructor(readonly why: 'gone' | 'completed' | 'changed' | 'hidden', readonly fresh: El | null = null) { super(`report ${why}`); }
}
/** Completing a report failed: `done` names the work items set done before the failure (the next press says them). */
export class CompletionFailed extends Error {
  /** `atPatch`: the failure was the report's own PATCH, so with a lost answer it may have landed. */
  constructor(readonly done: ReadonlyArray<{ id: string; title: string }>, readonly failure: unknown, readonly atPatch = false) { super('completion failed'); }
}
/** The work item was set done (or was done already) and the report's create then failed: `failure` is that failure. */
export class DoneNoReport extends Error {
  constructor(readonly item: { id: string; title: string }, readonly failure: unknown) { super("done, no report"); }
}

function newestOf<T extends { at: string }>(xs: T[]): T | null {
  return [...xs].sort((a, b) => newestFirst(a.at, b.at))[0] ?? null;
}

/** A refusal in the person's words. Never keel's raw text. */
export function problemLine(err: unknown, doing: string): string {
  if (err instanceof OwNetworkError) return `OnlyWorlds could not be reached while ${doing}. Check your connection; nothing was lost.`;
  if (err instanceof OwApiError || (err && typeof err === 'object' && 'status' in err)) {
    const e = err as { status: number; code?: string | null };
    if (e.status === 401) return `Your PIN did not match while ${doing}. Check your PIN on Your worlds.`;
    if (e.code === 'not_author') return 'Only the person who made it can change that.';
    // The web host's refusal, before the API saw it: not the seat (its own words, nothing was written).
    if (isHostRefusal(err)) return hostLine(err, 'this', 'Nothing was written.', doing);
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
  /** The Charter the front door named when the room opened, or null. */
  charterAtOpen: string | null = null;

  /** The files on the room's lines (keel's files lane; the feed never sees a file arrive). */
  readonly files: RoomFiles;

  private constructor(readonly world: AccountWorld, readonly client: OwV2Client) {
    this.feed = new RoomFeed(client, () => document.visibilityState === 'hidden');
    this.files = new RoomFiles(client, () => this.feed.changed(), () => document.visibilityState === 'visible');
  }

  /** The lines the room has held: a new one may bring files after it (its writer's upload follows the line). */
  private linesSeen: Set<string> | null = null;
  private filesWatch = (): void => {
    const ids = readLines(this.els.values()).map(l => l.id);
    if (this.linesSeen && ids.some(id => !this.linesSeen!.has(id))) this.files.soon();
    this.linesSeen = new Set(ids);
  };

  static async open(world: AccountWorld): Promise<Room> {
    const client = await session.worldClient(world);
    const room = new Room(world, client);
    room.me = await client.me();
    room.role = roomRole(room.me.role);
    // The world's Charter as the front door names it, read once here; the feed's read stands in where it names none.
    const door = (room.me as { front_door?: { charter?: unknown } }).front_door;
    room.charterAtOpen = typeof door?.charter === 'string' && door.charter ? door.charter : null;
    await room.refreshRoster();
    await room.loadHidden();
    room.feed.subscribe(room.rosterWatch);
    room.feed.subscribe(room.filesWatch);
    room.seedRemovals();
    room.feed.subscribe(room.keepRemovals);
    await room.feed.start();
    room.files.start();
    room.rosterTimer = setInterval(() => { if (document.visibilityState === 'visible') void room.refreshRoster(); }, 30000);
    document.addEventListener('visibilitychange', room.onVisible);
    return room;
  }

  close(): void {
    this.feed.stop();
    this.files.close();
    if (this.rosterTimer) clearInterval(this.rosterTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      this.feed.poke();
      void this.refreshRoster();
      void this.loadHidden();
      void this.files.read();
    }
  };

  async refreshRoster(): Promise<void> {
    this.rosterAt = Date.now();
    try {
      const before = JSON.stringify(this.roster);
      this.roster = await this.client.members();
      // My own row is the server's word on my role now: a keeper who is made a member (or the reverse) reads so
      // within the roster's round, not only when the room opens.
      const row = this.roster.find(m => (m.id ?? OWNER) === this.meBy);
      const role = row ? (row.status === 'active' ? roomRole(row.role) : 'watcher') : this.role;
      const moved = role !== this.role;
      this.role = role;
      if (moved || JSON.stringify(this.roster) !== before) this.feed.changed();
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

  /**
   * A team world: its Charter is marked (the front door's word at open, else the feed's). Its room is the team chat and
   * each seat's room, every line across every sitting; a workshop runs in it only while a switch is on. A world with no
   * Charter mark is a workshop world, and its room works as it always has.
   */
  get teamWorld(): boolean {
    return !!this.charterAtOpen || !!this.charter();
  }

  /** A workshop runs while any switch of the newest sitting is on. */
  get workshopRuns(): boolean {
    return workshopRuns(this.sittings());
  }

  /** Where the sitting counts for what is written: a workshop world, or a team world while a workshop runs. */
  get sittingCounts(): boolean {
    return !this.teamWorld || this.workshopRuns;
  }

  /** Lines stay by time: a line written while a new sitting is still on its way keeps its place. */
  lines() {
    // A team world's room holds every line, whatever sitting it was said in.
    if (this.teamWorld) return readLines(this.els.values());
    const all = this.sittings();
    // A watcher is served the room's lines but no sitting: the newest sitting's lines by their mark.
    if (!all.length && this.role === 'watcher') return linesOfUnseenSitting(readLines(this.els.values()), this.world.id);
    return linesOfSitting(readLines(this.els.values()), all, this.sitting()?.id ?? null);
  }

  /** A watcher in a room with sittings it cannot see: a line names a mark other than the world's. */
  get sittingUnseen(): boolean {
    if (this.role !== 'watcher' || this.sittings().length) return false;
    return readLines(this.els.values()).some(l => typeof l.el[ROOM_MARK] === 'string' && l.el[ROOM_MARK] !== this.world.id);
  }

  /** The shown sitting's own specs, hearts and votes, by the mark (the world's before any sitting). */
  private shown(): El[] {
    return ofRoom(this.els.values(), this.sitting()?.id ?? this.world.id);
  }

  /** The newest sitting's: what every write reads and changes, whatever the room shows. */
  private live(): El[] {
    return ofRoom(this.els.values(), this.sittingOfNow());
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
    // Only the few that answer are ordered: a sort of every line per board entry and work item cost each render (the S598 code gate).
    return orderLines(readLinesAsGiven(this.els.values()).filter(l => l.parent === id || l.about === id || !!l.report?.answers.includes(id) || l.named.includes(id)));
  }

  /**
   * The design parts this reader sees, only where the world's Charter is marked: a world without one has no
   * designs here, whatever its subtypes say (a locked Object is a door in a fantasy world).
   */
  designs(): DesignPart[] {
    return this.teamWorld ? readDesignParts(this.els.values(), this.hidden) : [];
  }

  /**
   * The crew: each person with the AI seats that are theirs, and the AI seats no one answers for, by the team rule
   * the OnlyWorlds Dashboard uses. Empty when the roster cannot be read (a guest is refused it).
   */
  crew(): Crew {
    if (!this.roster) return { beasts: [], people: [] };
    const seatsOf = (this.me as { front_door?: { my_seats?: unknown } }).front_door?.my_seats;
    const mySeats = Array.isArray(seatsOf) ? seatsOf.filter((x): x is { id: string } => !!x && typeof (x as { id?: unknown }).id === 'string') : [];
    return crewOf({
      members: this.roster,
      me: this.meBy,
      mySeats,
      charName: c => this.characterShown(c),
      memberCharacters: this.members(),
      served: c => this.characterServed(c),
    });
  }

  /** Whether this reader is served a Character: in its feed, a Character, neither hidden nor a stub. */
  characterServed(id: string | null): boolean {
    if (!id) return false;
    const el = this.els.get(id);
    return !!el && String(el.type).toLowerCase() === 'character' && el.hidden !== true && el.known_of !== true;
  }

  /** A Character's name when this reader is served it, else null (never a name the reader cannot see). */
  characterShown(id: string | null): string | null {
    if (!id || !this.characterServed(id)) return null;
    return (this.els.get(id)!.name ?? '').toString().trim() || null;
  }

  /**
   * The design parts a line is a talk on: the ones it names that are design parts the reader sees now. `by` is the
   * parts by id, built once per draw by the caller (the code gate's S4: never a map per line).
   */
  designsOf(line: { named: readonly string[] }, by: ReadonlyMap<string, DesignPart> = new Map(this.designs().map(p => [p.id, p]))): DesignPart[] {
    if (!line.named.length) return [];
    return [...new Set(line.named)].map(id => by.get(id)).filter((p): p is DesignPart => !!p);
  }

  /** How many lines answer each of these ids, in one pass over the room's lines (as `answers` counts them; the gate's S1). */
  answerCounts(ids: Iterable<string>): Map<string, number> {
    const n = new Map<string, number>();
    for (const id of ids) n.set(id, 0);
    if (!n.size) return n;
    for (const l of readLinesAsGiven(this.els.values())) {
      const hit = new Set<string>([...(l.parent ? [l.parent] : []), ...(l.about ? [l.about] : []), ...(l.report?.answers ?? []), ...l.named]);
      for (const id of hit) { const c = n.get(id); if (c !== undefined) n.set(id, c + 1); }
    }
    return n;
  }

  /** The world's own recent changes (a world's parlor's work surface). */
  changes() {
    return readChanges(this.els.values(), 40, this.feed.removals.values());
  }

  /**
   * The names of removed elements, kept per world and per reader in this browser (a convenience: a walk from zero
   * names no removed element, so a removal seen here keeps its name on the next visit; nothing breaks without it).
   * Per reader, since what one seat was served another may not be; Sign out forgets them all (session.ts).
   */
  private removedKey = (): string => `${KEPT_REMOVALS}${this.world.id}.${this.meBy}`;
  private seedRemovals(): void {
    try {
      const kept = JSON.parse(localStorage.getItem(this.removedKey()) ?? '[]') as unknown;
      if (!Array.isArray(kept)) return;
      for (const r of kept as Removal[]) {
        if (r && typeof r.id === 'string' && typeof r.at === 'string' && typeof r.type === 'string') this.feed.removals.set(r.id, r);
      }
    } catch { /* none kept */ }
  }
  private keptRemovals = '';
  private keepRemovals = (): void => {
    const named = [...this.feed.removals.values()].filter(r => r.name !== null).sort((a, b) => newestFirst(a.at, b.at)).slice(0, 60);
    const json = JSON.stringify(named);
    if (json === this.keptRemovals) return;
    this.keptRemovals = json;
    try { localStorage.setItem(this.removedKey(), json); } catch { /* private window */ }
  };

  /** Every room work item in the world, whatever sitting made it. */
  work() {
    return readWork(this.els.values(), this.world.id, by => this.liveTaker(by));
  }

  /** Whom a work item is for, as this seat sees it: mine (me, or a Title I hold), others', or no one's. */
  addressOf(w: Pick<WorkItem, 'forWho' | 'forTitles'>): 'mine' | 'others' | 'none' {
    return addressOf(w, this.myCharacter(), this.els);
  }

  /** A take counts while its maker holds a seat that can write (contract T2); with no roster to read, every take counts. */
  private liveTaker(by: string): boolean {
    if (!this.roster) return true;
    const seat = this.seats().find(s => s.by === by);
    return !!seat && seat.role !== 'watcher';
  }

  /** Takes on this item made by me, whatever the roster says (Release finds them all, a double take too). */
  private myTakes(itemId: string): string[] {
    return deletableTakes(this.els.values(), itemId, this.meBy);
  }

  hasTaken(itemId: string): boolean {
    return this.myTakes(itemId).length > 0;
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
   * The mark for a line, a board entry or a work item: the newest sitting when the write's turn comes (never the one
   * a host is browsing) where the sitting counts, else the world. In a team world a line written while no workshop
   * runs carries the world's mark, so the room and the board keep it whatever sitting comes next.
   */
  private roomOfNow(): string {
    if (!this.sittingCounts) return this.world.id;
    return this.sittingOfNow();
  }

  /** A spec, heart or vote's mark: the newest sitting, else the world (a workshop's own things are its sitting's). */
  private sittingOfNow(): string {
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

  /**
   * A line goes to the newest sitting, so writing one brings the room back to now, where it shows. Its files
   * go after it, on their own queue (never behind the room's writes), to the line this call made: its id is
   * captured here, whatever the room shows when they land. Text may be empty when files come with it.
   */
  post(text: string, anchor: Anchor | null = null, files: ReadonlyArray<File> = [], to: string | null = null): Promise<void> {
    this.showSitting = null;
    return this.serial(async () => {
      const made = await this.client.create('narrative', newLineAt(text, this.myCharacter(), anchor, this.roomOfNow(), filesName(files), to));
      // Once the line exists its files go to it, and nothing after can turn this Send into a failure the
      // composer would answer by giving the files back (a second Send would make the line twice).
      if (files.length) this.files.attach((made as { id: string }).id, files);
      try { this.landed(made); } catch { /* the feed brings the line */ }
    });
  }

  /** A keeper of this world (the charter profile's role: the owner or a co-builder) whose key can write. */
  get isKeeper(): boolean {
    return this.isHost && this.canWrite;
  }

  /** Ask the server who I am in this world now (a press that writes by role reads it fresh). */
  async readRole(): Promise<void> {
    const me = await this.client.me();
    this.me = me;
    const role = roomRole(me.role);
    if (role !== this.role) { this.role = role; this.feed.changed(); }
  }

  /**
   * A report's body, built once at the press so a retry sends the same body (its day and its name too). A keeper's
   * part makes it the keeper's own report, born completed; null hands it in. Null when the seat has no Character.
   */
  reportBody(text: string, on: { parent?: string | null; item?: string | null; answers?: boolean; part?: Anchor | null }, keeper: KeeperPart | null): Record<string, unknown> | null {
    const narrator = this.myCharacter();
    if (!narrator || !text.trim()) return null;
    // Said now, so in the newest sitting (where a report shows once sent, as a line does), never one being browsed; in
    // a team world only while a workshop runs.
    const all = this.sittings();
    const sitting = this.sittingCounts ? all[all.length - 1]?.id ?? null : null;
    return newReport(text, narrator, this.world.id, localDay(new Date()), { ...on, sitting }, keeper);
  }

  /** What a keeper may pick as what a report touched, by name, at most `max`. */
  reportPickable(query: string, skip: ReadonlySet<string>, max = 8): { type: string; id: string; name: string }[] {
    const q = simpleCaseFold(query.trim());
    if (!q) return [];
    const out: { type: string; id: string; name: string }[] = [];
    for (const el of this.els.values()) {
      if (skip.has(el.id) || !isReportPickable(el)) continue;
      const name = (el.name ?? '').toString();
      if (!simpleCaseFold(name).includes(q)) continue;
      out.push({ type: simpleCaseFold(el.type), id: el.id, name });
      if (out.length >= max) break;
    }
    return out;
  }

  /**
   * Hand in a report: one Narrative, made once, in the newest sitting like a line; its files follow it as a line's
   * do. `body` is the press's own (reportBody), sent as it is on every retry of the same draft under the same key,
   * so a lost answer's retry replays keel's first answer instead of making it twice.
   *
   * `setsDone` is the keeper's own report answering a work item: the item is set done FIRST, read at this write's
   * turn and only while its own word is open or taken, so a report that says it set the item done is never made
   * with the item left open (a lost answer or a failed done leaves no report, and the same press tries again;
   * ItemMoved when the item is gone or moved, DoneNoReport when the done stands and the create failed).
   */
  handIn(body: Record<string, unknown>, idempotencyKey: string, files: ReadonlyArray<File> = [], setsDone: string | null = null, doneMine = false): Promise<void> {
    this.showSitting = null;
    return this.serial(async () => {
      // A body born completed is a keeper's alone: a role that moved since the press sends nothing.
      if (body.subtype === REPORT_COMPLETED && !this.isKeeper) throw new KeeperOnly();
      let doneHere: { id: string; title: string } | null = null;
      if (setsDone) {
        // The body says this press set the item done: it is made only when that is true at this turn, read from the
        // server (never a feed that may be behind): set now, or done already by this composer's earlier try
        // (`doneMine`). Gone, moved, or done by another hand: nothing is sent, and the next press says only what is true.
        const fresh = await this.client.get('relation', setsDone).catch(err => {
          if (err instanceof OwApiError && (err.status === 404 || err.status === 410)) throw new ItemMoved();
          throw new DoneFailed(err);
        }) as El;
        const done = simpleCaseFold(String(fresh.subtype ?? '').trim()) === 'done';
        if (done ? !doneMine : !maySetDone(fresh)) throw new ItemMoved();
        if (!done) {
          try { this.landed(await this.client.patch('relation', setsDone, { subtype: 'done' })); } catch (err) { throw new DoneFailed(err); }
        }
        doneHere = { id: setsDone, title: (fresh.name ?? '').toString() };
      }
      let made: unknown;
      try {
        made = await this.client.create('narrative', body, { idempotencyKey });
      } catch (err) {
        // The item is done and the report is not made: the caller says so, and the same press finishes it.
        throw doneHere ? new DoneNoReport(doneHere, err) : err;
      }
      if (files.length) this.files.attach((made as { id: string }).id, files);
      try { this.landed(made); } catch { /* the feed brings it */ }
    });
  }

  /** A keeper marks the Law they named as the world's charter (the charter profile's mark, the world's id). */
  markCharter(id: string): Promise<void> {
    return this.serial(async () => {
      if (!this.isKeeper || !unmarkedCharters(this.els.values()).some(c => c.id === id)) return;
      this.landed(await this.client.patch('law', id, { [CHARTER_MARK]: this.world.id }));
    });
  }

  unmarkedCharters() {
    return unmarkedCharters(this.els.values());
  }

  /**
   * A keeper completes a handed-in report (the report profile's step 2), one job on the queue:
   * 1. The report read fresh: it must still be a handed-in room report, not hidden, at the `change_seq` the keeper
   *    opened it at (a member's edit since then refuses: the keeper completes only what they read). A completed one
   *    whose description is this completion's is a lost answer that landed: success.
   * 2. With `setDone`, each id in its `x_report_answers` read fresh: a gone one, or one that is no work item by its pair, is
   *    skipped (rule 5); an open or taken one, not proposed, is set done; a done one counts only when this composer
   *    set it (`doneBefore`).
   * 3. The report patched with `ifMatch` at that `change_seq`: completionPatch's fields, never the story.
   * A failure after a done is CompletionFailed naming what was set done, so the next press says it.
   */
  complete(reportId: string, seq: number | null, part: { description: string; changes: string; touched: ReadonlyArray<{ type: string; id: string }> },
    setDone: boolean, doneBefore: ReadonlySet<string>, mayHaveLanded = false): Promise<void> {
    return this.serial(async () => {
      if (!this.isKeeper) throw new KeeperOnly();
      if (this.hidden.has(reportId)) throw new ReportMoved('hidden');
      const gone = (err: unknown) => err instanceof OwApiError && (err.status === 404 || err.status === 410);
      let fresh: El;
      try { fresh = await this.client.get('narrative', reportId) as El; } catch (err) { if (gone(err)) throw new ReportMoved('gone'); throw new CompletionFailed([], err); }
      if (!isReport(fresh)) throw new ReportMoved('gone');
      const state = reportPartOf(fresh).state;
      // This card's own earlier press may have landed with its answer lost: that completion is this one.
      if (state === 'completed' && mayHaveLanded && (fresh.description ?? '') === part.description.trim()) return;
      if (state !== 'handed in') throw new ReportMoved('completed');
      if (fresh.hidden === true) throw new ReportMoved('hidden');
      const at = typeof fresh.change_seq === 'number' ? fresh.change_seq : null;
      if (seq !== null && at !== null && at !== seq) throw new ReportMoved('changed', fresh);
      // `done` holds each answer as written (what this card's next press matches); `said` the same items by the id
      // keel served for them, which is what `consequences` names (the address profile's "The same id": a writer
      // writes the element's own id, never an answer's other spelling). An answer keel did not return says nothing.
      const done: { id: string; title: string }[] = [];
      const said: { id: string; title: string }[] = [];
      // Items this card set done on an earlier press are always said, whatever the box says now; new dones only with it.
      if (setDone || doneBefore.size) {
        for (const id of reportPartOf(fresh).answers) {
          if (!setDone && !doneBefore.has(id)) continue;
          let item: El;
          try { item = await this.client.get('relation', id) as El; } catch (err) { if (gone(err)) continue; throw new CompletionFailed(done, err); }
          // A work item by its pair: the profile's reader reads one with or without the room mark.
          if (!isWorkItemPair(item)) continue;
          // The id keel served; a body with none falls back to the answer itself, never `undefined`.
          const servedId = typeof item.id === 'string' && item.id ? item.id : id;
          const title = (item.name ?? '').toString();
          if (simpleCaseFold(String(item.subtype ?? '').trim()) === 'done') {
            if (doneBefore.has(id)) { done.push({ id, title }); said.push({ id: servedId, title }); }
            continue;
          }
          if (!setDone || !maySetDone(item)) continue;
          try { this.landed(await this.client.patch('relation', id, { subtype: 'done' })); } catch (err) {
            // A lost answer may have set it: counted, so the next press says so (the item reads done then).
            throw new CompletionFailed(err instanceof OwNetworkError ? [...done, { id, title }] : done, err);
          }
          done.push({ id, title });
          said.push({ id: servedId, title });
        }
      }
      const body = completionPatch(fresh, part, said);
      try {
        this.landed(await this.client.patch('narrative', reportId, body, at !== null ? { ifMatch: at } : undefined));
      } catch (err) {
        if (!done.length && err instanceof OwPreconditionFailedError) throw new ReportMoved('changed', (err as OwPreconditionFailedError).current as El ?? null);
        throw new CompletionFailed(done, err, true);
      }
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

  /** Take a work item that is not done, once (contract T4: the queue reads the room when its turn comes). */
  take(id: string): Promise<void> {
    return this.serial(async () => {
      const item = this.work().find(w => w.id === id);
      if (!item || item.state === 'done' || !this.canWrite || this.hasTaken(id)) return;
      const roomOf = typeof item.el[ROOM_MARK] === 'string' ? item.el[ROOM_MARK] as string : this.world.id;
      this.landed(await this.client.create('relation', newTake({ id: item.id, title: item.title, roomOf }, this.myCharacter())));
    });
  }

  /** Release: my own takes on the item, each by its id (T5). */
  release(id: string): Promise<void> {
    return this.serial(async () => {
      for (const takeId of this.myTakes(id)) {
        await this.client.delete('relation', takeId);
        this.feed.removeLocal(takeId);
      }
      this.feed.poke();
    });
  }

  /**
   * Delete one work item, by its id: its maker, the host or a co-host. The item goes first; then its
   * takes, where the deleter may delete them (a host: all; anyone else: their own), each on its own,
   * since a take left behind is an orphan no reader counts (T6; the Take gate's T6-G1).
   */
  deleteWork(id: string): Promise<void> {
    return this.serial(async () => {
      const item = this.work().find(w => w.id === id);
      if (!item || !this.canRetire(item.by)) return;
      const takes = deletableTakes(this.els.values(), item.id, this.meBy, this.isHost);
      await this.client.delete('relation', item.id);
      this.feed.removeLocal(item.id);
      for (const takeId of takes) {
        try {
          await this.client.delete('relation', takeId);
          this.feed.removeLocal(takeId);
        } catch { /* an orphan take: read by no one */ }
      }
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
        this.landed(await this.client.create('construct', newSpec(title, text, kind, this.sittingOfNow())));
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

  /**
   * A heart on (`on`) or off, as the button said: a second press on "Heart" landing after the first
   * one's write leaves one heart, never takes it away (the press guard's gate, S2).
   */
  setHeart(specId: string, specTitle: string, on: boolean): Promise<void> {
    return this.serial(async () => {
      const mine = myHearts(readHearts(this.live()), this.meBy, specId);
      if (on === (mine.length > 0)) return;
      if (mine.length) {
        for (const h of mine) {
          await this.client.delete('relation', h.id);
          this.feed.removeLocal(h.id);
        }
        this.feed.poke();
        return;
      }
      this.landed(await this.client.create('relation', newHeart(specId, specTitle, this.myCharacter(), this.sittingOfNow())));
    });
  }

  /** False when voting has closed by the vote's turn: a press held on an older view sends nothing. */
  vote(picks: string[]): Promise<boolean> {
    return this.serial(async () => {
      if (!this.newestSitting()?.voting) return false;
      const had = newestOf(readVotes(this.live()).filter(v => v.by === this.meBy));
      const body = newVote(picks, this.myCharacter(), this.sittingOfNow());
      this.landed(had ? await this.client.patch('relation', had.id, { constructs: body.constructs })
        : await this.client.create('relation', body));
      return true;
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

  /** End the workshop: each switch of the newest sitting that is on, turned off (the same write as a switch press). */
  endWorkshop(): Promise<void> {
    return this.serial(async () => {
      const s = this.newestSitting();
      if (!s) return;
      for (const which of ['hearts', 'specs', 'voting'] as const) {
        const now = this.newestSitting();
        if (now?.id === s.id && now[which]) this.landed(await this.client.patch('event', s.id, switchPatch(which, false)));
      }
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
   * hide and unhide (Kael, 2026-10-22).
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
