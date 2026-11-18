/** The worlds page's order: the worlds you own, then those shared with you, each by name. */

import { byCodePoint } from './when';
import { foldName } from './shapes';

interface Named { id: string; name?: string | null; role?: string | null }

/** By the name folded (the standard's fold) and compared code point by code point, ties by id. */
export function sortWorlds<T extends Named>(worlds: readonly T[]): T[] {
  return [...worlds].sort((a, b) => byCodePoint(foldName(a.name ?? ''), foldName(b.name ?? '')) || byCodePoint(a.id, b.id));
}

/** The two sections of the page, each in name order. */
export function splitWorlds<T extends Named>(worlds: readonly T[]): { own: T[]; shared: T[] } {
  const sorted = sortWorlds(worlds);
  return { own: sorted.filter(w => w.role === 'owner'), shared: sorted.filter(w => w.role !== 'owner') };
}
