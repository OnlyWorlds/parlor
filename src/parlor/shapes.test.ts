import { describe, expect, it } from 'vitest';
import {
  OWNER, type El, readLines, lineName, newLine, readHearts, heartCounts, myHearts, readSpecs,
  readVotes, tally, readSittings, newSitting, phasePatch, linesOfSitting, readCharter, PHASES, phaseOf,
  newSpec, newHeart, newVote, newMember, readMemberCharacters, ROOM_MARK, ofRoom,
} from './shapes';
// schema-dist's room profile (v0.33.0-dist.65, profiles/room.fixture.json, copied whole).
import fixture from './fixtures/room.fixture.json';

/** A room element as the parlor makes it: the pair and the mark. */
const el = (o: Partial<El> & { id: string; type: string }): El => ({ created_at: '2026-10-22T10:00:00Z', [ROOM_MARK]: 'w1', ...o });
/** The same shape with no mark: a world's own lore. */
const lore = (o: Partial<El> & { id: string; type: string }): El => ({ created_at: '2026-10-22T10:00:00Z', ...o });

describe('lines', () => {
  it('reads a Message as a line, its author from created_by and never from text', () => {
    const lines = readLines([
      el({ id: 'a', type: 'narrative', supertype: 'Message', description: 'I am Skeld', created_by: 'm1', narrator: 'c1' }),
      el({ id: 'b', type: 'narrative', supertype: 'Story', description: 'not a line' }),
      el({ id: 'c', type: 'construct', supertype: 'Message', description: 'wrong type' }),
    ]);
    expect(lines.map(l => l.id)).toEqual(['a']);
    expect(lines[0].by).toBe('m1');
    expect(lines[0].narrator).toBe('c1');
  });

  it('the owner is created_by null', () => {
    const [l] = readLines([el({ id: 'a', type: 'narrative', supertype: 'message', description: 'hi', created_by: null })]);
    expect(l.by).toBe(OWNER);
  });

  it('a long line keeps its whole text and a short name', () => {
    const text = 'word '.repeat(40);
    const body = newLine(text, 'c1', 'p1', 's1');
    expect(body.description).toBe(text);
    expect((body.name as string).length).toBeLessThanOrEqual(60);
    expect(body.narrator).toBe('c1');
    expect(body.parent_narrative).toBe('p1');
    expect(lineName('  two\n words ')).toBe('two words');
  });

  it('a person without a Character sends no narrator', () => {
    expect('narrator' in newLine('hi', null, null, 'w1')).toBe(false);
  });
});

describe('the room mark (schema-dist profiles/room.md)', () => {
  it('every room thing the parlor makes carries x_room_of in its first write', () => {
    expect(newLine('hi', null, null, 's1')[ROOM_MARK]).toBe('s1');
    expect(newSpec('A', 'text', 's1')[ROOM_MARK]).toBe('s1');
    expect(newHeart('sp', 'A', null, 's1')[ROOM_MARK]).toBe('s1');
    expect(newVote(['a'], null, 's1')[ROOM_MARK]).toBe('s1');
    expect(newSitting('S', 1, 'w1')[ROOM_MARK]).toBe('w1');
    expect(newMember('Sam', 'w1')[ROOM_MARK]).toBe('w1');
  });

  it("a world's own lore in the same words never shows as the room", () => {
    const els = [
      lore({ id: 'wire', type: 'narrative', supertype: 'Message', description: 'a letter in the lore' }),
      lore({ id: 'sp', type: 'construct', supertype: 'Spec', name: 'a lore spec' }),
      lore({ id: 'h', type: 'relation', supertype: 'Heart', constructs: ['sp'] }),
      lore({ id: 'v', type: 'relation', supertype: 'Vote', constructs: ['sp'] }),
      lore({ id: 'st', type: 'event', supertype: 'Sitting', subtype: 'Voting' }),
      lore({ id: 'm', type: 'character', supertype: 'Member', name: 'A lore member', created_by: 'm1' }),
    ];
    expect(readLines(els)).toEqual([]);
    expect(readSpecs(els, readHearts(els))).toEqual([]);
    expect(readHearts(els)).toEqual([]);
    expect(readVotes(els)).toEqual([]);
    expect(readSittings(els)).toEqual([]);
    expect(readMemberCharacters(els).size).toBe(0);
  });

  it('an empty mark is no mark, and a mark on a word outside the pairs makes nothing a room thing', () => {
    expect(readLines([lore({ id: 'a', type: 'narrative', supertype: 'Message', [ROOM_MARK]: '' })])).toEqual([]);
    expect(readLines([el({ id: 'a', type: 'narrative', supertype: 'Messages' })])).toEqual([]);
  });

  it('the type and the supertype are folded and trimmed as the profile folds them', () => {
    expect(readLines([el({ id: 'a', type: 'Narrative', supertype: ' message ' })]).map(l => l.id)).toEqual(['a']);
  });

  it("agrees with the profile's conformance fixture on every case a parlor reader can see", () => {
    const read = new Set(['narrative/message', 'construct/spec', 'relation/heart', 'relation/vote', 'event/sitting', 'character/member']);
    expect(fixture.cases.length).toBeGreaterThan(20);
    for (const c of fixture.cases) {
      const one = [{ id: 'f', created_at: '2026-10-22T10:00:00Z', constructs: ['x'], ...c.element } as unknown as El];
      const taken = readLines(one).length + readSpecs(one, []).length + readHearts(one).length + readVotes(one).length
        + readSittings(one).length + readMemberCharacters(one).size;
      const pair = `${String(c.element.type ?? '').trim().toLowerCase()}/${String(c.element.supertype ?? '').trim().toLowerCase()}`;
      expect({ case: c.name, taken: taken > 0 }).toEqual({ case: c.name, taken: c.in_room && read.has(pair) });
    }
  });

  it("a sitting's specs, hearts and votes are those it marked; before any sitting, the world's", () => {
    const els = [
      el({ id: 'a', type: 'construct', supertype: 'Spec', [ROOM_MARK]: 's1' }),
      el({ id: 'b', type: 'construct', supertype: 'Spec', [ROOM_MARK]: 's2' }),
      el({ id: 'c', type: 'construct', supertype: 'Spec', [ROOM_MARK]: 'w1' }),
    ];
    expect(readSpecs(ofRoom(els, 's2'), []).map(s => s.id)).toEqual(['b']);
    expect(readSpecs(ofRoom(els, 'w1'), []).map(s => s.id)).toEqual(['c']);
  });

  it('the charter is lore: read without the mark', () => {
    expect(readCharter([lore({ id: 'x', type: 'law', supertype: 'Charter', name: 'House rules' })])?.id).toBe('x');
  });
});

describe('hearts', () => {
  const hearts = readHearts([
    el({ id: 'h1', type: 'relation', supertype: 'Heart', constructs: ['s1'], created_by: 'm1' }),
    el({ id: 'h2', type: 'relation', supertype: 'Heart', constructs: ['s1'], created_by: 'm1' }), // a race's double
    el({ id: 'h3', type: 'relation', supertype: 'Heart', constructs: ['s1'], created_by: 'm2' }),
    el({ id: 'h4', type: 'relation', supertype: 'Heart', constructs: ['s2'], created_by: null }),
    el({ id: 'h5', type: 'relation', supertype: 'Heart', constructs: [] }),
  ]);

  it('counts one per person per target', () => {
    const c = heartCounts(hearts);
    expect(c.get('s1')).toBe(2);
    expect(c.get('s2')).toBe(1);
  });

  it('finds every heart of mine on a target, so a toggle off removes a race double too', () => {
    expect(myHearts(hearts, 'm1', 's1').map(h => h.id)).toEqual(['h1', 'h2']);
    expect(myHearts(hearts, OWNER, 's2').map(h => h.id)).toEqual(['h4']);
  });

  it('a spec carries its hearts, the star first', () => {
    const specs = readSpecs([
      el({ id: 's1', type: 'construct', supertype: 'Spec', name: 'A', created_at: '2026-10-22T10:00:01Z' }),
      el({ id: 's2', type: 'construct', supertype: 'Spec', name: 'B', subtype: 'star', created_at: '2026-10-22T10:00:02Z' }),
    ], hearts);
    expect(specs.map(s => [s.id, s.hearts, s.star])).toEqual([['s2', 1, true], ['s1', 2, false]]);
  });
});

describe('votes', () => {
  it("counts each voter's newest top three as 3, 2, 1", () => {
    const votes = readVotes([
      el({ id: 'v1', type: 'relation', supertype: 'Vote', constructs: ['a', 'b', 'c'], created_by: 'm1', updated_at: '2026-10-22T10:00:00Z' }),
      el({ id: 'v2', type: 'relation', supertype: 'Vote', constructs: ['c', 'a'], created_by: 'm1', updated_at: '2026-10-22T10:05:00Z' }),
      el({ id: 'v3', type: 'relation', supertype: 'Vote', constructs: ['b', 'b', 'a'], created_by: 'm2', updated_at: '2026-10-22T10:01:00Z' }),
    ]);
    const t = tally(votes);
    expect(t.get('c')).toBe(3);
    expect(t.get('a')).toBe(2 + 2);
    expect(t.get('b')).toBe(3);
  });
});

describe('sittings', () => {
  it('six phases by what a member does; February\'s names read as today\'s, never rewritten', () => {
    expect(PHASES.map(p => p.name)).toEqual(['Arrive', 'Welcome', 'Pitch', 'Vote', 'Build', 'Show']);
    expect(['Lobby', 'Parsing', 'Design', 'Voting', 'Showcase', 'Build', '', ' vote '].map(phaseOf))
      .toEqual(['Arrive', 'Pitch', 'Pitch', 'Vote', 'Show', 'Build', 'Arrive', 'Vote']);
    const [s] = readSittings([el({ id: 's', type: 'event', supertype: 'Sitting', subtype: 'Voting', x_voting_open: true })]);
    expect([s.phase, s.voting]).toEqual(['Vote', true]);
  });

  it('a new sitting starts in Arrive with its switches and its feed start', () => {
    const body = newSitting('Workshop, 22 October', 4711, 'w1');
    const [s] = readSittings([lore({ id: 's', type: 'event', ...body } as El)]);
    expect(s.phase).toBe('Arrive');
    expect([s.hearts, s.specs, s.voting]).toEqual([false, false, false]);
    expect(s.feedStart).toBe(4711);
  });

  it('a phase moves its name and all three switches together', () => {
    const voting = PHASES.find(p => p.name === 'Vote')!;
    const [s] = readSittings([el({ id: 's', type: 'event', supertype: 'Sitting', ...phasePatch('Vote') } as El)]);
    expect([s.phase, s.hearts, s.specs, s.voting]).toEqual(['Vote', voting.hearts, voting.specs, voting.voting]);
    expect(() => phasePatch('Nap')).toThrow();
  });

  it("a sitting's lines are those made between its start and the next one's", () => {
    const sittings = readSittings([
      el({ id: 's1', type: 'event', supertype: 'Sitting', created_at: '2026-10-22T09:00:00Z' }),
      el({ id: 's2', type: 'event', supertype: 'Sitting', created_at: '2026-10-22T11:00:00Z' }),
    ]);
    const lines = readLines([
      el({ id: 'l0', type: 'narrative', supertype: 'Message', created_at: '2026-10-22T08:00:00Z' }),
      el({ id: 'l1', type: 'narrative', supertype: 'Message', created_at: '2026-10-22T10:00:00Z' }),
      el({ id: 'l2', type: 'narrative', supertype: 'Message', created_at: '2026-10-22T11:00:00Z' }),
    ]);
    expect(linesOfSitting(lines, sittings, 's1').map(l => l.id)).toEqual(['l1']);
    expect(linesOfSitting(lines, sittings, 's2').map(l => l.id)).toEqual(['l2']);
    expect(linesOfSitting(lines, sittings, null).map(l => l.id)).toEqual(['l0', 'l1', 'l2']);
  });
});

describe('charter', () => {
  it('reads the Law with supertype Charter', () => {
    expect(readCharter([el({ id: 'x', type: 'law', supertype: 'Charter', name: 'House rules', description: 'Be kind' })]))
      .toEqual({ id: 'x', name: 'House rules', text: 'Be kind' });
    expect(readCharter([el({ id: 'x', type: 'law', supertype: 'Statute' })])).toBeNull();
  });
});
