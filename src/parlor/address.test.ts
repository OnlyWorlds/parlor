// A work item's address: `#/w/<world>/work/<item>` opens that world's room at the item; what a sign-in carries.
import { describe, expect, it } from 'vitest';
import { isRoomHash, readAddress, resumeHashOf, roomHash, workArrival, workHash } from './address';

const W = '0f0f0f0f-0000-4000-8000-00000000a1a1';
const I = '1a1a1a1a-0000-4000-8000-00000000b2b2';

describe('reading an address', () => {
  it('a work item\'s address names the world and the item', () => {
    expect(readAddress(`#/w/${W}/work/${I}`)).toEqual({ world: W, work: I });
  });
  it('a room\'s address names the world alone', () => {
    expect(readAddress(`#/w/${W}`)).toEqual({ world: W, work: null });
  });
  it('any other tail still opens the room, by prefix, and names no item', () => {
    for (const tail of ['/', '/work', '/work/', `/work/${I}/x`, `/work/${I}/`, '/other/x', '/work/a.b']) {
      expect(readAddress(`#/w/${W}${tail}`)).toEqual({ world: W, work: null });
    }
  });
  it('no room, no address', () => {
    for (const hash of ['', '#/', '#/join/x', `#/x/${W}/work/${I}`, `/w/${W}`]) expect(readAddress(hash)).toBeNull();
  });
  it('writes the two forms it reads', () => {
    expect(readAddress(workHash(W, I))).toEqual({ world: W, work: I });
    expect(readAddress(roomHash(W))).toEqual({ world: W, work: null });
  });
});

describe('what a sign-in carries', () => {
  it('the work item\'s address whole, when the bar names one', () => {
    expect(resumeHashOf(`#/w/${W}/work/${I}`)).toBe(`#/w/${W}/work/${I}`);
  });
  it('the room\'s address alone otherwise, the tail dropped', () => {
    expect(resumeHashOf(`#/w/${W}`)).toBe(`#/w/${W}`);
    expect(resumeHashOf(`#/w/${W}/work/${I}/x`)).toBe(`#/w/${W}`);
  });
  it('nothing for an address that names no room', () => {
    expect(resumeHashOf('#/')).toBeNull();
    expect(resumeHashOf('')).toBeNull();
  });
  it('exactly the two forms pass the check, nothing broader', () => {
    expect(isRoomHash(`#/w/${W}`)).toBe(true);
    expect(isRoomHash(`#/w/${W}/work/${I}`)).toBe(true);
    for (const hash of [`#/w/${W}/`, `#/w/${W}/work/`, `#/w/${W}/work/${I}/x`, `#/w/${W}/work/../x`, `#/w/${W}/x/${I}`, `x#/w/${W}`]) {
      expect(isRoomHash(hash)).toBe(false);
    }
  });
});

describe('how a room opened at a work item lands', () => {
  const served = [{ id: 'i-1' }, { id: 'i-2' }];
  it('the item served, a seat that may answer: its Answer opens', () => {
    expect(workArrival('i-1', served, true, true)).toBe('answer');
  });
  it('the item served, a seat that may only read: read, no composer', () => {
    expect(workArrival('i-2', served, true, false)).toBe('read');
  });
  it('an id not served (gone, hidden, a typo): not here', () => {
    expect(workArrival('i-9', served, true, true)).toBe('not-here');
    expect(workArrival('i-9', [], true, false)).toBe('not-here');
  });
  it('another world\'s item is never among this room\'s: not here', () => {
    expect(workArrival(I, served, true, true)).toBe('not-here');
  });
  it('before the room\'s read is whole, nothing is said: it waits, whatever the list holds', () => {
    expect(workArrival('i-9', [], false, true)).toBe('wait');
    expect(workArrival('i-1', served, false, true)).toBe('wait');
  });
});
