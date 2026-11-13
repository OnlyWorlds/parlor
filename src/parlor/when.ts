/**
 * Times in order as instants, never as text: the SDK's `instantOf` reads a served time by the message
 * profile's grammar (an offset, `Z`, or none read as UTC), and `compareInstants` orders them. Text
 * comparison put `…12.5Z` after `…12Z` and a `+02:00` time by its digits, not its moment.
 *
 * Both orders put a time that cannot be read after every readable one, and give 0 for two equal
 * instants. The parlor's lists are its feed's Map, whose order is when each element was first seen,
 * not keel's list order (a resync rebuilds it), so its sorts break a tie by id: the same on every
 * client and every render (the S598 code gate's tie finding).
 */

import { compareInstants, instantOf } from '@onlyworlds/sdk';

/** Earlier first. */
export function earlierFirst(a: unknown, b: unknown): number {
  return compareInstants(instantOf(a), instantOf(b));
}

/** `a` is a readable time later than the readable time `b`; an unreadable one is later than nothing. */
export function isAfter(a: unknown, b: unknown): boolean {
  const x = instantOf(a), y = instantOf(b);
  return x !== null && y !== null && compareInstants(x, y) > 0;
}

/** Newest first; a time that cannot be read still last. */
export function newestFirst(a: unknown, b: unknown): number {
  const x = instantOf(a), y = instantOf(b);
  return x === null || y === null ? compareInstants(x, y) : compareInstants(y, x);
}

/**
 * Two ids in code point order (serial 123 point 4): the tie every sort here breaks by id. Never
 * `localeCompare`, which folds case and reads by a locale's collation, so an id in upper case sorted
 * apart from where every other reader of the standard puts it.
 */
export function byCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n;) {
    const x = a.codePointAt(i)!, y = b.codePointAt(i)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
