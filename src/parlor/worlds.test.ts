// The worlds page's order: the worlds you own, then those shared with you, each by name folded and compared code point
// by code point, ties by id.
import { describe, expect, it } from 'vitest';
import { sortWorlds, splitWorlds } from './worlds';

const w = (id: string, name: string, role = 'owner') => ({ id, name, role });

describe('the worlds in order', () => {
  it('reads A to Z by the folded name, whatever the case', () => {
    expect(sortWorlds([w('1', 'moppetopia'), w('2', 'Atlas ground'), w('3', 'BrainBoost')]).map(x => x.name))
      .toEqual(['Atlas ground', 'BrainBoost', 'moppetopia']);
  });
  it('compares code point by code point, never by a locale: an accented letter sorts after z', () => {
    expect(sortWorlds([w('1', 'Élan'), w('2', 'zebra'), w('3', 'apple')]).map(x => x.name)).toEqual(['apple', 'zebra', 'Élan']);
  });
  it('trims the name by the standard rule before comparing, and breaks a tie by id', () => {
    expect(sortWorlds([w('b', ' Same'), w('a', 'same'), w('c', 'Other')]).map(x => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('a world with no name sorts first and keeps its place by id', () => {
    expect(sortWorlds([w('2', 'Named'), { id: '1', name: null, role: 'owner' }]).map(x => x.id)).toEqual(['1', '2']);
  });
  it('splits the worlds you own from those shared with you, each in order', () => {
    const { own, shared } = splitWorlds([w('1', 'Zed', 'member'), w('2', 'Bee'), w('3', 'Ant', 'member'), w('4', 'Cat')]);
    expect(own.map(x => x.name)).toEqual(['Bee', 'Cat']);
    expect(shared.map(x => x.name)).toEqual(['Ant', 'Zed']);
  });
});
