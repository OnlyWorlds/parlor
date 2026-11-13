import { describe, expect, it } from 'vitest';
import { byCodePoint, earlierFirst, isAfter, newestFirst } from './when';
import { OLD_STAR, ROOM_MARK, linesOfSitting, linesOfUnseenSitting, readLines, readMemberCharacters, readSittings, readTakes, readChanges, starOf, tally, type El, type Vote } from './shapes';
// schema-dist's message profile (v0.34.0-dist.121, profiles/message.fixture.json, copied whole).
import fixture from './fixtures/message.fixture.json';

type Msg = { id: string; created_at?: unknown; [k: string]: unknown };
const ORDER_CASES = [
  'unread-in-created-at-order',
  'same-created-at-keeps-list-order',
  'unreadable-created-at-comes-after-readable-in-list-order',
  'created-at-with-an-offset-and-a-fraction-is-read-as-an-instant',
  'created-at-with-no-offset-is-read-as-utc',
  'created-at-in-any-other-form-cannot-be-read',
  'created-at-with-a-part-out-of-its-range-cannot-be-read',
  'created-at-fraction-counts-to-its-sixth-digit',
  'created-at-at-either-end-of-the-years-is-read',
];

describe('earlierFirst: the message profile\'s order cases (serial 121)', () => {
  for (const name of ORDER_CASES) {
    it(name, () => {
      const c = fixture.cases.find(x => x.name === name) as unknown as { messages: Msg[]; unread: string[] } | undefined;
      expect(c, `the fixture holds ${name}`).toBeTruthy();
      // The unread answer is a subset of the messages in the profile's order: sorted by earlierFirst, the
      // messages hold it as a subsequence, in that order.
      const sorted = [...c!.messages].sort((a, b) => earlierFirst(a.created_at, b.created_at)).map(m => m.id);
      const kept = sorted.filter(id => c!.unread.includes(id));
      expect(kept).toEqual(c!.unread);
    });
  }
});

describe('times as instants', () => {
  it('a time with no offset is read as UTC (serial 121)', () => {
    expect(earlierFirst('2026-11-12T10:00:00', '2026-11-12T10:00:00Z')).toBe(0);
    expect(earlierFirst('2026-11-12T10:00:00', '2026-11-12T10:00:01Z')).toBeLessThan(0);
    expect(earlierFirst('2026-11-12T11:00:00+02:00', '2026-11-12T10:00:00')).toBeLessThan(0);
  });

  it('a fraction and an offset count, where text order would not', () => {
    const xs = ['2026-10-26T09:00:00.500Z', '2026-10-26T09:00:00Z', '2026-10-26T10:59:59.999+02:00'];
    expect([...xs].sort(earlierFirst)).toEqual(['2026-10-26T10:59:59.999+02:00', '2026-10-26T09:00:00Z', '2026-10-26T09:00:00.500Z']);
    expect([...xs].sort(newestFirst)).toEqual(['2026-10-26T09:00:00.500Z', '2026-10-26T09:00:00Z', '2026-10-26T10:59:59.999+02:00']);
  });

  it('a time that cannot be read comes last both ways, in the order given', () => {
    const xs = ['nope', '2026-10-26T09:00:00Z', '', '2026-10-26T08:00:00Z'];
    expect([...xs].sort(earlierFirst)).toEqual(['2026-10-26T08:00:00Z', '2026-10-26T09:00:00Z', 'nope', '']);
    expect([...xs].sort(newestFirst)).toEqual(['2026-10-26T09:00:00Z', '2026-10-26T08:00:00Z', 'nope', '']);
  });
});

/** A room element as the parlor makes it: the pair and the mark. */
const el = (o: Partial<El> & { id: string; type: string }): El => ({ [ROOM_MARK]: 'w1', ...o });
const AT = { half: '2026-10-26T09:00:00.500Z', nine: '2026-10-26T09:00:00Z', early: '2026-10-26T10:59:59.999+02:00' };

describe('the room\'s readers order by instants, a tie by id', () => {
  it('lines', () => {
    const els = [
      el({ id: 'z', type: 'narrative', supertype: 'Message', description: 'a', created_at: AT.half }),
      el({ id: 'y', type: 'narrative', supertype: 'Message', description: 'b', created_at: AT.nine }),
      el({ id: 'x', type: 'narrative', supertype: 'Message', description: 'c', created_at: AT.early }),
      el({ id: 'b', type: 'narrative', supertype: 'Message', description: 'd', created_at: AT.half }),
    ];
    // 'b' before 'z': the feed's Map order is when each was first seen, so a tie goes by id, the same on every client.
    expect(readLines(els).map(l => l.id)).toEqual(['x', 'y', 'b', 'z']);
    expect(readLines([...els].reverse()).map(l => l.id)).toEqual(['x', 'y', 'b', 'z']);
  });

  it('a line belongs to the sitting its instant falls in', () => {
    const lines = readLines([
      el({ id: 'l1', type: 'narrative', supertype: 'Message', description: 'a', created_at: AT.early }),
      el({ id: 'l2', type: 'narrative', supertype: 'Message', description: 'b', created_at: AT.half }),
      el({ id: 'l3', type: 'narrative', supertype: 'Message', description: 'c', created_at: 'no time' }),
    ]);
    const sittings = readSittings([
      el({ id: 's1', type: 'event', supertype: 'Sitting', created_at: '2026-10-26T08:00:00Z' }),
      el({ id: 's2', type: 'event', supertype: 'Sitting', created_at: AT.nine }),
    ]);
    // 10:59:59.999+02:00 is before 09:00Z: the first sitting's, though its text sorts after.
    expect(linesOfSitting(lines, sittings, 's1').map(l => l.id)).toEqual(['l1']);
    // A time that cannot be read comes after every readable one: the last sitting's.
    expect(linesOfSitting(lines, sittings, 's2').map(l => l.id)).toEqual(['l2', 'l3']);
  });

  it("each voter's newest vote, the oldest Member Character, an old sitting's star", () => {
    const t = tally([
      { id: 'v1', by: 'm1', picks: ['a'], at: AT.early },
      { id: 'v2', by: 'm1', picks: ['b'], at: AT.nine },
    ] as Vote[]);
    expect(t.get('b')).toBe(3);
    expect(t.has('a')).toBe(false);
    const chars = readMemberCharacters([
      el({ id: 'c2', type: 'character', supertype: 'Member', created_by: 'm1', name: 'Later', created_at: AT.nine }),
      el({ id: 'c1', type: 'character', supertype: 'Member', created_by: 'm1', name: 'First', created_at: AT.early }),
    ]);
    expect(chars.get('m1')?.id).toBe('c1');
    expect(starOf({ star: null, at: '2026-10-26T01:59:59+02:00' })).toBe(OLD_STAR);
    expect(starOf({ star: null, at: '2026-10-26T00:00:00+00:00' })).toBeNull();
    expect(starOf({ star: null, at: '' })).toBeNull();
  });

  it('a readable time beats one that cannot be read, whichever comes first', () => {
    const t = tally([{ id: 'v1', by: 'm1', picks: ['a'], at: '' }, { id: 'v2', by: 'm1', picks: ['b'], at: AT.nine }] as Vote[]);
    expect(t.get('b')).toBe(3);
    const chars = readMemberCharacters([
      el({ id: 'c0', type: 'character', supertype: 'Member', created_by: 'm1', name: 'No time' }),
      el({ id: 'c1', type: 'character', supertype: 'Member', created_by: 'm1', name: 'First', created_at: AT.nine }),
    ]);
    expect(chars.get('m1')?.id).toBe('c1');
  });

  it("a watcher's sitting is the newest line's by instant", () => {
    const lines = readLines([
      el({ id: 'l1', type: 'narrative', supertype: 'Message', description: 'a', created_at: AT.early, [ROOM_MARK]: 'r1' }),
      el({ id: 'l2', type: 'narrative', supertype: 'Message', description: 'b', created_at: AT.nine, [ROOM_MARK]: 'r2' }),
    ]);
    expect(linesOfUnseenSitting(lines, 'w0').map(l => l.id)).toEqual(['l2']);
  });

  it('isAfter: two readable times, the first later', () => {
    expect(isAfter(AT.half, AT.nine)).toBe(true);
    expect(isAfter(AT.early, AT.nine)).toBe(false);
    expect(isAfter('no time', AT.nine)).toBe(false);
    expect(isAfter(AT.nine, '')).toBe(false);
  });

  it('sittings', () => {
    const ids = readSittings([
      el({ id: 'z', type: 'event', supertype: 'Sitting', created_at: AT.half }),
      el({ id: 'y', type: 'event', supertype: 'Sitting', created_at: AT.early }),
    ]).map(s => s.id);
    expect(ids).toEqual(['y', 'z']);
  });

  it('takes', () => {
    const takes = readTakes([
      el({ id: 'z', type: 'relation', supertype: 'Take', x_room_item: 'i1', created_by: 'm1', created_at: AT.half }),
      el({ id: 'y', type: 'relation', supertype: 'Take', x_room_item: 'i1', created_by: 'm1', created_at: AT.early }),
    ]);
    expect(takes.get('i1')?.map(t => t.id)).toEqual(['y', 'z']);
  });

  it('changes, newest first', () => {
    const ids = readChanges([
      { id: 'a', type: 'character', name: 'A', updated_at: AT.early, created_at: AT.early },
      { id: 'b', type: 'character', name: 'B', updated_at: AT.half, created_at: AT.half },
    ] as El[]).map(c => c.id);
    expect(ids[0]).toBe('b');
  });
});

describe('byCodePoint: an id tie in code point order (serial 123 point 4)', () => {
  it('upper case before lower, never folded', () => {
    expect(['a-1', 'B-1', 'A-1', 'b-1'].sort(byCodePoint)).toEqual(['A-1', 'B-1', 'a-1', 'b-1']);
    expect(byCodePoint('a', 'a')).toBe(0);
    expect(byCodePoint('a', 'ab')).toBe(-1);
    // Past the basic plane: by code point, not by UTF-16 unit (U+1F600 after U+FFFD).
    expect(byCodePoint('\u{1F600}', '\uFFFD')).toBe(1);
  });

  it("a line's tie at one instant goes by code point: an upper-case id first", () => {
    const els = [
      el({ id: 'a-line', type: 'narrative', supertype: 'Message', description: 'a', created_at: AT.half }),
      el({ id: 'B-line', type: 'narrative', supertype: 'Message', description: 'b', created_at: AT.half }),
    ];
    expect(readLines(els).map(l => l.id)).toEqual(['B-line', 'a-line']);
    expect(readLines([...els].reverse()).map(l => l.id)).toEqual(['B-line', 'a-line']);
  });
});
