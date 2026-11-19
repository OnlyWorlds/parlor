/**
 * The parlor's addresses: a room, `#/w/<world>`, and a work item in it, `#/w/<world>/work/<item>`. The room is read by
 * prefix (an address with any other tail still opens the room, as it always has); the work item only from the exact
 * form. What a sign-in carries is one of these two exact forms, nothing broader.
 */

const ROOM = /^#\/w\/([\w-]+)/;
const WORK = /^#\/w\/([\w-]+)\/work\/([\w-]+)$/;
const EXACT = /^#\/w\/[\w-]+(?:\/work\/[\w-]+)?$/;

export interface RoomAddress {
  world: string;
  /** The work item the address names, or null for the room alone. */
  work: string | null;
}

export function readAddress(hash: string): RoomAddress | null {
  const m = ROOM.exec(hash);
  if (!m) return null;
  const w = WORK.exec(hash);
  return { world: m[1], work: w ? w[2] : null };
}

export const roomHash = (world: string): string => `#/w/${world}`;
export const workHash = (world: string, item: string): string => `#/w/${world}/work/${item}`;

/** A room's address or a work item's, exactly as the parlor writes them: what a sign-in may carry and give back. */
export const isRoomHash = (hash: string): boolean => EXACT.test(hash);

/** What a sign-in started here carries: the work item's address when the bar names one, else the room's, else nothing. */
export function resumeHashOf(hash: string): string | null {
  const a = readAddress(hash);
  return a ? (a.work ? workHash(a.world, a.work) : roomHash(a.world)) : null;
}

/**
 * How a room opened at a work item's address lands, once its read is whole:
 * - `wait`: the room's first read has not completed (it failed, or has not run), so nothing is said yet;
 * - `answer`: the item is served and this seat may answer it: its Answer opens;
 * - `read`: the item is served, and this seat may read it but not answer it;
 * - `not-here`: the read is whole and the item is not among the work items served (gone, hidden, another world's, a typo).
 */
export type WorkArrival = 'wait' | 'answer' | 'read' | 'not-here';

export function workArrival(item: string, served: ReadonlyArray<{ id: string }>, readWhole: boolean, canAnswer: boolean): WorkArrival {
  if (!readWhole) return 'wait';
  if (!served.some(w => w.id === item)) return 'not-here';
  return canAnswer ? 'answer' : 'read';
}

/**
 * Whether the composer's answer moves the person off the address's item: an answer to anything else (another work item,
 * a line, a design), or the answer the address opened, let go or sent.
 */
export function releasesAddress(addressed: string | null, reply: { id: string; link: string } | null, answeredHere: boolean): boolean {
  if (!addressed) return false;
  return reply ? !(reply.link === 'relations' && reply.id === addressed) : answeredHere;
}

/**
 * The bar a room writes when it lets its address go: the room's own address, only while the bar still names the item
 * this room was opened at. A room that is gone writes nothing, and neither does a room whose bar has since moved on (a
 * newer arrival in the same tab, whose address is its own).
 */
export function releasedHash(hash: string, world: string, was: string, roomGone: boolean): string | null {
  if (roomGone) return null;
  const at = readAddress(hash);
  return at && at.world === world && at.work === was ? roomHash(world) : null;
}

export const WORK_NOT_HERE = 'This work item is not here: it may be gone or hidden, or the link may be wrong.';
export const WORK_READ_ONLY = 'You can read this work item; this seat cannot answer it.';
