import { describe, expect, it } from 'vitest';
import {
  OWNER, type El, readLines, lineName, newLine, readHearts, heartCounts, myHearts, readSpecs,
  readVotes, tally, readSittings, newSitting, phasePatch, linesOfSitting, linesOfUnseenSitting, readCharter, PHASES, phaseOf,
  newSpec, newHeart, newVote, newMember, readMemberCharacters, ROOM_MARK, ofRoom,
  kindOf, starPatch, STAR_FIELD, readBoard, newBoardEntry, starOf, OLD_STAR, OLD_STAR_BEFORE,
  readWork, addressOf, newWorkItem, isPickable, readChanges, readTakes, newTake, deletableTakes, ROOM_ITEM,
  newReport, reportName, localDay, REPORT_ANSWERS, storyStart, splitConsequence,
  unmarkedCharters, completionPatch, maySetDone, isReportPickable, NARRATIVE_LINKS, NOTHING_CHANGED,
} from './shapes';
// schema-dist's room profile (v0.33.0-dist.66, profiles/room.fixture.json, copied whole).
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
    expect(body.story).toBe(text); // the message profile's body
    expect('description' in body).toBe(false);
    expect((body.name as string).length).toBeLessThanOrEqual(60);
    expect(body.narrator).toBe('c1');
    expect(body.parent_narrative).toBe('p1');
    expect(lineName('  two\n words ')).toBe('two words');
  });

  it('a person without a Character sends no narrator', () => {
    expect('narrator' in newLine('hi', null, null, 'w1')).toBe(false);
  });

  it("a line's words are its story; an older line's its description; empty stays empty (keel serves both, empty as '')", () => {
    const msg = (id: string, o: Partial<El>) => el({ id, type: 'narrative', supertype: 'Message', name: 'A few words', ...o });
    const texts = readLines([
      // keel's shape: an absent field is served as ''.
      msg('a', { story: 'The whole line, by the message profile.', description: '' }),
      msg('b', { story: '', description: 'A line from before 2026-11-11.' }),
      msg('c', { story: '', description: '' }),
      msg('d', { story: 'story wins', description: 'a summary' }),
      // A body with neither field (a fake, a file): its name.
      msg('e', {}),
      msg('f', { description: 'old, no story key' }),
    ]).map(l => [l.id, l.text]);
    expect(Object.fromEntries(texts)).toEqual({
      a: 'The whole line, by the message profile.',
      b: 'A line from before 2026-11-11.',
      c: '',
      d: 'story wins',
      e: 'A few words',
      f: 'old, no story key',
    });
  });
});

describe('reports (schema-dist profiles/report.md)', () => {
  const rep = (o: Partial<El> & { id: string }): El => el({ type: 'narrative', supertype: 'Report', subtype: 'handed in', story: 'what I did', name: 'r', ...o });

  it('reads a marked Report as a line with its parts; its text is the story', () => {
    const [l] = readLines([rep({ id: 'r1', narrator: 'c1', created_by: 'm1' })]);
    expect(l.report).not.toBeNull();
    expect(l.text).toBe('what I did');
    expect(l.report!.state).toBe('handed in');
    expect(l.by).toBe('m1');
  });

  it('a report written under the review hold reads as proposed (the review profile rules 1 and 5); none, null or an empty object as settled', () => {
    const p = (mark: unknown) => readLines([rep({ id: 'r', subtype: 'completed', consequences: 'Dock 4 back', x_review_proposed: mark } as Partial<El> & { id: string })])[0].report!.proposed;
    expect(p({ by: 'm-ai', at: '2026-11-11T07:00:00Z' })).toBe(true);
    expect(p({ by: null })).toBe(true);
    expect(p({})).toBe(false);
    expect(p(null)).toBe(false);
    expect(p(undefined)).toBe(false);
    expect(readLines([rep({ id: 'r' })])[0].report!.proposed).toBe(false);
  });

  it('a Report without the mark is lore and never the room', () => {
    expect(readLines([lore({ id: 'r', type: 'narrative', supertype: 'Report', story: 'a scout' })])).toEqual([]);
  });

  it('a Message is never a report, and the pair folds as the room profile folds', () => {
    const ls = readLines([el({ id: 'm', type: 'narrative', supertype: 'Message', description: 'hi' }), rep({ id: 'r', supertype: ' REPORT ' }), rep({ id: 'x', supertype: 'Reports' })]);
    expect(ls.map(l => [l.id, !!l.report])).toEqual([['m', false], ['r', true]]);
  });

  it('the subtype decides the state; another word is kept as written (rule 7)', () => {
    const s = (subtype: unknown) => readLines([rep({ id: 'r', subtype: subtype as string })])[0].report!;
    expect(s(' Completed ').state).toBe('completed');
    expect(s('HANDED IN').state).toBe('handed in');
    expect(s('half done')).toMatchObject({ state: 'other', word: 'half done' });
    expect(s(null)).toMatchObject({ state: 'other', word: '' });
  });

  it('answers are the key ids, first place, blanks and non-strings out; one not in relations is kept (rule 5)', () => {
    const [l] = readLines([rep({ id: 'r', relations: ['w1', 'w2'], x_report_answers: ['w2', '', 'w9', 'w2', 7, 'w1'] })]);
    expect(l.report!.answers).toEqual(['w2', 'w9', 'w1']);
    expect(readLines([rep({ id: 'r', x_report_answers: 'w1' })])[0].report!.answers).toEqual([]);
  });

  it('consequences read one per line, as written, with or without an address (rule 8)', () => {
    const [l] = readLines([rep({ id: 'r', subtype: 'completed', consequences: 'Renamed the Steinway: ow://object/o1\r\n\n  Set 3 Objects to surveyed  ' })]);
    expect(l.report!.consequences).toEqual(['Renamed the Steinway: ow://object/o1', 'Set 3 Objects to surveyed']);
  });

  it('step 1 writes the pair, the mark, the word, the story whole and the narrator in one body', () => {
    const body = newReport('Line one\nline two', 'c1', 'w1', '2026-11-10');
    expect(body).toEqual({ name: 'Line one, 2026-11-10', story: 'Line one\nline two', supertype: 'Report', subtype: 'handed in', narrator: 'c1', [ROOM_MARK]: 'w1' });
    expect(readLines([{ ...el({ id: 'n', type: 'narrative' }), ...body }])[0].report!.state).toBe('handed in');
  });

  it("a keeper's own report is born completed in one body: its short part, what changed and its typed links", () => {
    const body = newReport('Did it\nall', 'c1', 'w1', '2026-11-11', { item: 'i1', answers: true }, {
      description: 'In short.', changes: '  Renamed Ada: ow://character/a1  \r\n\n Set 2 Objects to surveyed\n',
      touched: [{ type: 'character', id: 'a1' }, { type: 'Location', id: 'l1' }, { type: 'character', id: 'a1' }, { type: 'map', id: 'm1' }, { type: 'relation', id: 'r1' }, { type: 'law', id: 'law1' }],
      done: { id: 'i1', title: 'Check the ledger' },
    });
    expect(body).toEqual({
      name: 'Did it, 2026-11-11', story: 'Did it\nall', supertype: 'Report', subtype: 'completed', narrator: 'c1', [ROOM_MARK]: 'w1',
      relations: ['i1', 'r1'], [REPORT_ANSWERS]: ['i1'], description: 'In short.',
      consequences: 'Renamed Ada: ow://character/a1\nSet 2 Objects to surveyed\nSet the work item Check the ledger to done: ow://relation/i1',
      characters: ['a1'], locations: ['l1'], laws: ['law1'],
    });
    expect(readLines([{ ...el({ id: 'n', type: 'narrative' }), ...body }])[0].report!.state).toBe('completed');
    // Nothing typed under What changed, nothing set done: the profile's words.
    expect(newReport('t', 'c1', 'w1', 'd', {}, { description: 'x', changes: ' \n ', touched: [] }).consequences).toBe(NOTHING_CHANGED);
    for (const t of ['map', 'pin', 'marker', 'narrative']) expect(NARRATIVE_LINKS[t]).toBeUndefined();
    expect(NARRATIVE_LINKS.character).toBe('characters');
  });

  it('a keeper picks what a report touched from the world, never the room, a hidden element, a stub or a reading aid', () => {
    expect(isReportPickable(lore({ id: 'c', type: 'character' }))).toBe(true);
    expect(isReportPickable(lore({ id: 'l', type: 'law', supertype: 'Statute' }))).toBe(true);
    expect(isReportPickable(lore({ id: 'm', type: 'map' }))).toBe(false);
    expect(isReportPickable(lore({ id: 'n', type: 'narrative' }))).toBe(false);
    expect(isReportPickable(el({ id: 'w', type: 'relation', supertype: 'Work item' }))).toBe(false);
    expect(isReportPickable(lore({ id: 'h', type: 'character', hidden: true }))).toBe(false);
    expect(isReportPickable(lore({ id: 'k', type: 'character', known_of: true }))).toBe(false);
    expect(isReportPickable(lore({ id: 'g', type: 'construct', supertype: 'Guide', x_charter_of: 'w1' }))).toBe(false);
  });

  it('on a board entry it hangs by parent; on a work item by relations, answering it only when asked; never an empty key', () => {
    expect(newReport('t', 'c1', 'w1', 'd', { parent: 'b1' })).toMatchObject({ parent_narrative: 'b1' });
    const touched = newReport('t', 'c1', 'w1', 'd', { item: 'i1', answers: false });
    expect(touched.relations).toEqual(['i1']);
    expect(REPORT_ANSWERS in touched).toBe(false);
    expect(newReport('t', 'c1', 'w1', 'd', { item: 'i1', answers: true })[REPORT_ANSWERS]).toEqual(['i1']);
    expect(REPORT_ANSWERS in newReport('t', 'c1', 'w1', 'd', { answers: true })).toBe(false);
  });

  it('free talk hangs on its sitting by events; on a board entry or a work item the sitting is left out', () => {
    expect(newReport('t', 'c1', 'w1', 'd', { sitting: 's1' }).events).toEqual(['s1']);
    expect('events' in newReport('t', 'c1', 'w1', 'd', { sitting: 's1', parent: 'b1' })).toBe(false);
    expect('events' in newReport('t', 'c1', 'w1', 'd', { sitting: 's1', item: 'i1' })).toBe(false);
    expect('events' in newReport('t', 'c1', 'w1', 'd', { sitting: null })).toBe(false);
    // A keeper's touched Event joins after the sitting, never in its place.
    const kept = newReport('t', 'c1', 'w1', 'd', { sitting: 's1' }, { description: 'x', changes: '', touched: [{ type: 'event', id: 'e9' }], done: null });
    expect(kept.events).toEqual(['s1', 'e9']);
  });

  it('a change reads as its words, its address kept apart; no address, or only one, as written', () => {
    expect(splitConsequence('Renamed the Steinway: ow://object/o1')).toEqual({ words: 'Renamed the Steinway', address: 'ow://object/o1' });
    expect(splitConsequence('Linked Ada ow://w1/character/c1')).toEqual({ words: 'Linked Ada', address: 'ow://w1/character/c1' });
    expect(splitConsequence('Set the subtype of 3 Objects to surveyed')).toEqual({ words: 'Set the subtype of 3 Objects to surveyed', address: null });
    expect(splitConsequence('ow://object/o1')).toEqual({ words: 'ow://object/o1', address: null });
    expect(splitConsequence('nothing changed')).toEqual({ words: 'nothing changed', address: null });
    // A full stop or a bracket after the address is prose, never part of it.
    expect(splitConsequence('Renamed the Steinway: ow://object/o1.')).toEqual({ words: 'Renamed the Steinway', address: 'ow://object/o1' });
    expect(splitConsequence('Linked Ada (ow://w1/character/c1).')).toEqual({ words: 'Linked Ada', address: 'ow://w1/character/c1' });
  });

  it("a handed-in report opens on its story's first three lines, at most 280 characters", () => {
    expect(storyStart('a\nb\nc')).toEqual({ text: 'a\nb\nc', cut: false });
    expect(storyStart('a\nb\nc\nd')).toEqual({ text: 'a\nb\nc', cut: true });
    const long = storyStart('y'.repeat(400));
    expect(long.cut).toBe(true);
    expect(long.text.length).toBe(280);
  });

  it('the name is the first line with words, cut, then the day', () => {
    expect(reportName('\n\n  The Steinway   description \nmore', '2026-11-10')).toBe('The Steinway description, 2026-11-10');
    expect(reportName('x'.repeat(80), 'd').length).toBeLessThanOrEqual(48 + 3);
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(reportName('Checked the ledger.\nmore', '2026-11-10')).toBe('Checked the ledger, 2026-11-10');
    expect(reportName('Why?!', 'd')).toBe('Why, d');
    const emoji = reportName('a'.repeat(46) + '🔥🔥🔥', 'd');
    expect(emoji).toBe('a'.repeat(46) + '🔥…, d');
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji)).toBe(false);
  });
});

describe('the room mark (schema-dist profiles/room.md)', () => {
  it('every room thing the parlor makes carries x_room_of in its first write', () => {
    expect(newLine('hi', null, null, 's1')[ROOM_MARK]).toBe('s1');
    expect(newSpec('A', 'text', 'Tool', 's1')[ROOM_MARK]).toBe('s1');
    expect(newBoardEntry('A', '', 'red', null, null, 's1')[ROOM_MARK]).toBe('s1');
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

  it("the charter is read by the charter profile's mark, never the room's", () => {
    expect(readCharter([lore({ id: 'x', type: 'law', supertype: 'Charter', name: 'House rules', x_charter_of: 'w1' })])?.id).toBe('x');
    expect(readCharter([lore({ id: 'x', type: 'law', supertype: 'Charter', name: 'House rules' })])).toBeNull();
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
    ], hearts, OLD_STAR);
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

  it("a watcher sees no sitting: its lines are the newest line's room mark, the world's alone when none names another", () => {
    const line = (id: string, at: string, mark?: string) =>
      el({ id, type: 'narrative', supertype: 'Message', created_at: at, x_room_of: mark });
    const lines = readLines([
      line('l0', '2026-10-22T08:00:00Z', 'w1'),
      line('l1', '2026-10-22T10:00:00Z', 's1'),
      line('l2', '2026-10-22T11:00:00Z', 's2'),
      line('l3', '2026-10-22T12:00:00Z', 's2'),
      line('l4', '2026-10-22T12:30:00Z'),
    ]);
    expect(linesOfUnseenSitting(lines, 'w1').map(l => l.id)).toEqual(['l2', 'l3']);
    // A room with no sittings: every line, as before.
    const team = readLines([line('t0', '2026-10-22T08:00:00Z', 'w1'), line('t1', '2026-10-22T09:00:00Z', 'w1')]);
    expect(linesOfUnseenSitting(team, 'w1').map(l => l.id)).toEqual(['t0', 't1']);
  });
});

describe('charter', () => {
  const law = (o: Partial<El> & { id: string }): El => lore({ type: 'law', supertype: 'Charter', x_charter_of: 'w1', ...o });
  it('reads the newest marked Law with supertype Charter', () => {
    expect(readCharter([law({ id: 'x', name: 'House rules', description: 'Be kind' })])).toEqual({ id: 'x', name: 'House rules', text: 'Be kind' });
    expect(readCharter([law({ id: 'x', supertype: 'Statute' })])).toBeNull();
    expect(readCharter([law({ id: 'a', created_at: '2026-10-01T00:00:00Z' }), law({ id: 'b', created_at: '2026-11-01T00:00:00Z' }), law({ id: 'c', created_at: '2026-09-01T00:00:00Z' })])?.id).toBe('b');
  });

  it("a proposed charter is not the room's, and an empty mark is settled (review rule 1)", () => {
    const older = law({ id: 'old', created_at: '2026-10-01T00:00:00Z' });
    expect(readCharter([older, law({ id: 'new', x_review_proposed: { by: 'm1' } })])?.id).toBe('old');
    for (const v of ['', '  ', [], {}, null]) expect(readCharter([older, law({ id: 'new', x_review_proposed: v })])?.id).toBe('new');
  });

  it('every unmarked Charter is offered to mark, by name, only when the room shows none; none is picked', () => {
    const loose = lore({ id: 'u', type: 'law', supertype: ' charter ', name: 'Our rules' });
    expect(unmarkedCharters([loose])).toEqual([{ id: 'u', name: 'Our rules', text: '' }]);
    expect(unmarkedCharters([loose, law({ id: 'm' })])).toEqual([]);
    expect(unmarkedCharters([lore({ id: 'p', type: 'law', supertype: 'Charter', x_review_proposed: { by: 'm1' } })])).toEqual([]);
    expect(unmarkedCharters([lore({ id: 's', type: 'law', supertype: 'Statute' })])).toEqual([]);
    expect(unmarkedCharters([lore({ id: 'd', type: 'law', supertype: 'Charter', x_review_proposed: 'agent' })])).toEqual([]);
    expect(unmarkedCharters([lore({ id: 'h', type: 'law', supertype: 'Charter', hidden: true })])).toEqual([]);
    expect(unmarkedCharters([lore({ id: 'a', type: 'law', supertype: 'Charter', name: 'the Kingdom' }), lore({ id: 'b', type: 'law', supertype: 'Charter', name: 'How we work' })]).map(c => c.id)).toEqual(['b', 'a']);
  });

  it("completing a report writes step 2's fields only, keeps the reporter's links, and says each item it set done", () => {
    const report = el({ id: 'r', type: 'narrative', supertype: 'Report', subtype: 'handed in', story: 'S', narrator: 'c0', relations: ['i1'], characters: ['a0'], [REPORT_ANSWERS]: ['i1'] });
    const body = completionPatch(report, { description: '  Short.  ', changes: ' One\r\n\n Two ', touched: [{ type: 'character', id: 'a1' }, { type: 'character', id: 'a0' }, { type: 'relation', id: 'r9' }, { type: 'map', id: 'm1' }] },
      [{ id: 'i1', title: 'Fix\nthe  ledger' }]);
    expect(body).toEqual({
      subtype: 'completed', description: 'Short.',
      consequences: 'One\nTwo\nSet the work item Fix the ledger to done: ow://relation/i1',
      characters: ['a0', 'a1'], relations: ['i1', 'r9'],
    });
    for (const k of ['story', 'narrator', ROOM_MARK, REPORT_ANSWERS, 'name']) expect(k in body).toBe(false);
    expect(completionPatch(report, { description: 'x', changes: '', touched: [] }, []).consequences).toBe(NOTHING_CHANGED);
  });

  // The address profile's "The same id" (serial 122): a writer writes an id lowercase in the form, and an address is
  // written in the address page's own form. An answer held in upper case is still that item's address once written.
  it('a done item answered in upper case is written into consequences as its address, lowercase in the form', () => {
    const U = '019A2C7E-41B0-7A12-8C3D-6E5F4A3B2C22';
    const report = el({ id: 'r', type: 'narrative', supertype: 'Report', subtype: 'handed in', story: 'S', [REPORT_ANSWERS]: [U] });
    expect(completionPatch(report, { description: 'x', changes: '', touched: [] }, [{ id: U, title: 'Fix the ledger' }]).consequences)
      .toBe(`Set the work item Fix the ledger to done: ow://relation/${U.toLowerCase()}`);
    // A keeper's own report, born completed, writes the same line.
    const kept = newReport('t', 'c1', 'w1', 'd', { item: U, answers: true }, { description: 'x', changes: '', touched: [], done: { id: U, title: 'Fix the ledger' } });
    expect(kept.consequences).toBe(`Set the work item Fix the ledger to done: ow://relation/${U.toLowerCase()}`);
    // Text that is no id in the form is written exactly as it came: never re-spelled into one.
    const NO_HYPHENS = U.replace(/-/g, '');
    expect(completionPatch(report, { description: 'x', changes: '', touched: [] }, [{ id: NO_HYPHENS, title: 'T' }]).consequences)
      .toBe(`Set the work item T to done: ow://relation/${NO_HYPHENS}`);
  });
});

describe("a spec's kind and the sitting's star (sheet §6 point 13, draft 7)", () => {
  const spec = (o: Partial<El> & { id: string }) => el({ type: 'construct', supertype: 'Spec', name: o.id, ...o });

  it('the kind is the subtype, folded; anything else is none', () => {
    expect(kindOf('modelling')).toBe('Modelling');
    expect(kindOf(' World ')).toBe('World');
    expect(kindOf('star')).toBeNull();
    expect(kindOf('')).toBeNull();
    expect(newSpec('A', '', 'Feature', 's1').subtype).toBe('Feature');
    expect(readSpecs([spec({ id: 'a', subtype: 'Tool' })], [])[0].kind).toBe('Tool');
  });

  it("the star is the sitting's x_star, never a subtype, once the sitting names one", () => {
    const els = [spec({ id: 'old', subtype: 'star' }), spec({ id: 'new', subtype: 'Tool' })];
    expect(readSpecs(els, [], 'new').filter(s => s.star).map(s => s.id)).toEqual(['new']);
    expect(readSpecs(els, [], 'gone').filter(s => s.star)).toEqual([]);
  });

  it('an old sitting that names no star reads the old subtype star (February, the 10-22 ground)', () => {
    const els = [spec({ id: 'old', subtype: 'star' }), spec({ id: 'b' })];
    expect(readSpecs(els, [], OLD_STAR).filter(s => s.star).map(s => s.id)).toEqual(['old']);
    expect(starOf({ star: null, at: '2026-10-22T10:00:00Z' })).toBe(OLD_STAR);
  });

  it('a new sitting with no x_star has no winner, whatever a spec calls itself', () => {
    const els = [spec({ id: 'self', subtype: 'star' }), spec({ id: 'b' })];
    const now = starOf({ star: null, at: OLD_STAR_BEFORE });
    expect(now).toBeNull();
    expect(readSpecs(els, [], now).filter(s => s.star)).toEqual([]);
    expect(readSpecs(els, [], now).map(s => s.id)).toEqual(['self', 'b']);
    expect(starOf({ star: 'b', at: '2026-10-22T10:00:00Z' })).toBe('b');
    expect(starOf(null)).toBeNull();
  });

  it('the star sorts first by the sitting, not by a subtype', () => {
    const els = [spec({ id: 'self', subtype: 'star', created_at: '2026-10-25T10:00:00Z' }), spec({ id: 'win', created_at: '2026-10-25T10:00:01Z' })];
    expect(readSpecs(els, [], 'win').map(s => s.id)).toEqual(['win', 'self']);
  });

  it('the winner is one patch on the sitting, and the sitting reads it back', () => {
    expect(starPatch('sp')).toEqual({ [STAR_FIELD]: 'sp' });
    const [s] = readSittings([el({ id: 's', type: 'event', supertype: 'Sitting', ...starPatch('sp') } as El)]);
    expect(s.star).toBe('sp');
    expect(readSittings([el({ id: 's', type: 'event', supertype: 'Sitting' })])[0].star).toBeNull();
  });
});

describe('the board (sheet §1, screen 07)', () => {
  const entry = (o: Partial<El> & { id: string }) => el({ type: 'narrative', supertype: 'Board', name: o.id, ...o });

  it('reads room Board entries red, orange, green, newest first, whatever sitting marked them', () => {
    const b = readBoard([
      entry({ id: 'g', subtype: 'green', created_at: '2026-10-25T09:00:00Z', [ROOM_MARK]: 's1' }),
      entry({ id: 'r1', subtype: 'Red', created_at: '2026-10-25T08:00:00Z', [ROOM_MARK]: 's1' }),
      entry({ id: 'r2', subtype: 'red', created_at: '2026-10-25T09:30:00Z', [ROOM_MARK]: 's2' }),
      entry({ id: 'o', subtype: 'orange', characters: ['c1'], [ROOM_MARK]: 'w1' }),
      entry({ id: 'x', subtype: 'purple' }),
    ]);
    expect(b.map(e => e.id)).toEqual(['r2', 'r1', 'o', 'g', 'x']);
    expect(b.find(e => e.id === 'o')?.waitsOn).toBe('c1');
    expect(b.find(e => e.id === 'g')?.waitsOn).toBeNull();
    expect(b.find(e => e.id === 'x')?.colour).toBeNull();
  });

  it("a world's own Board narrative and a line are never entries; an entry is never a line", () => {
    const els = [
      lore({ id: 'lore', type: 'narrative', supertype: 'Board', name: 'the guild board' }),
      el({ id: 'line', type: 'narrative', supertype: 'Message', description: 'hi' }),
      entry({ id: 'e', subtype: 'red' }),
    ];
    expect(readBoard(els).map(e => e.id)).toEqual(['e']);
    expect(readLines(els).map(l => l.id)).toEqual(['line']);
  });

  it('a new entry: whom it waits on, or nobody named; the maker as narrator', () => {
    const one = newBoardEntry('  Who runs the harbour? ', 'more', 'orange', 'c1', 'c9', 's1');
    expect(one).toMatchObject({ name: 'Who runs the harbour?', supertype: 'Board', subtype: 'orange', characters: ['c1'], narrator: 'c9' });
    const anyone = newBoardEntry('A', '', 'green', null, null, 'w1');
    expect(anyone.characters).toEqual([]);
    expect('narrator' in anyone).toBe(false);
  });
});

describe('work items (sheet §1, profiles/packet.md)', () => {
  const item = (o: Partial<El> & { id: string }) => el({ type: 'relation', supertype: 'Work item', name: o.id, ...o });

  it('a new item: subtype open, whom it is for, each pick in its typed link field, no packet keys', () => {
    const body = newWorkItem(' Tie the guild in ', 'why', 'c1', [
      { type: 'character', id: 'a' }, { type: 'location', id: 'b' }, { type: 'character', id: 'a' }, { type: 'law', id: 'x' },
    ], 's1');
    expect(body).toMatchObject({ name: 'Tie the guild in', supertype: 'Work item', subtype: 'open', actor: 'c1', characters: ['a'], locations: ['b'], [ROOM_MARK]: 's1' });
    expect(Object.keys(body).some(k => k.startsWith('x_packet_'))).toBe(false);
    expect('laws' in body).toBe(false);
    expect('actor' in newWorkItem('A', '', null, [], 'w1')).toBe(false);
  });

  describe('Take (profiles/room.md serial 66)', () => {
    const take = (o: Partial<El> & { id: string }) => el({ type: 'relation', supertype: 'Take', subtype: 'taken', ...o });
    it('a take: the pair, the item by x_room_item, the item\'s own scope, the taker as actor; the item untouched', () => {
      const body = newTake({ id: 'i1', title: 'Tie the guild in', roomOf: 's1' }, 'c1');
      expect(body).toEqual({ name: 'Take: Tie the guild in', supertype: 'Take', subtype: 'taken', [ROOM_MARK]: 's1', [ROOM_ITEM]: 'i1', actor: 'c1' });
      expect('actor' in newTake({ id: 'i1', title: 't', roomOf: 's1' }, null)).toBe(false);
    });
    it("a take copies its item's mark lowercase when it is an id in the form, any other mark exactly as written", () => {
      const U = '019A2C7E-41B0-7A12-8C3D-6E5F4A3B2C22';
      expect(newTake({ id: 'i1', title: 't', roomOf: U }, null)[ROOM_MARK]).toBe(U.toLowerCase());
      expect(newTake({ id: 'i1', title: 't', roomOf: U.toLowerCase() }, null)[ROOM_MARK]).toBe(U.toLowerCase());
      // Not an id in the form: never re-spelled into one (no hyphens, braces, a padded id, a word).
      for (const odd of [U.replace(/-/g, ''), `{${U}}`, ` ${U}`, 'S1']) expect(newTake({ id: 'i1', title: 't', roomOf: odd }, null)[ROOM_MARK]).toBe(odd);
    });
    it('taken by a live take, by its maker; done wins; lore, unmarked, removed and orphan takes never count', () => {
      const els = [
        item({ id: 'a', subtype: 'open' }),
        item({ id: 'b', subtype: 'done' }),
        item({ id: 'c', subtype: 'open' }),
        take({ id: 't1', [ROOM_ITEM]: 'a', created_by: 'm2', actor: 'c-someone-else', created_at: '2026-10-25T10:00:00Z' }),
        take({ id: 't0', [ROOM_ITEM]: 'a', created_by: 'm1', created_at: '2026-10-25T09:00:00Z' }),
        take({ id: 't2', [ROOM_ITEM]: 'b', created_by: 'm1' }),
        take({ id: 't3', [ROOM_ITEM]: 'c', created_by: 'gone' }),
        take({ id: 't4', [ROOM_ITEM]: 'c', created_by: 'm1', [ROOM_MARK]: undefined }),
        el({ id: 't5', type: 'relation', supertype: 'Heart', [ROOM_ITEM]: 'c', created_by: 'm1' }),
        take({ id: 't6', [ROOM_ITEM]: 'deleted-item', created_by: 'm1' }),
      ];
      const live = (by: string) => by !== 'gone';
      const w = new Map(readWork(els, 'w1', live).map(x => [x.id, x]));
      expect(w.get('a')!.state).toBe('taken');
      expect(w.get('a')!.takes.map(t => t.by)).toEqual(['m1', 'm2']);
      expect(w.get('b')!.state).toBe('done');
      expect(w.get('c')!.state).toBe('open');
      expect(w.get('c')!.takes).toEqual([]);
      expect([...readTakes(els, live).keys()].sort()).toEqual(['a', 'b', 'deleted-item']);
    });
    it('Release finds only my takes, a double take whole; a host deleting the item finds every one (T5, T6)', () => {
      const els = [
        item({ id: 'a', subtype: 'open' }),
        take({ id: 'm1-x', [ROOM_ITEM]: 'a', created_by: 'm1' }),
        take({ id: 'm1-y', [ROOM_ITEM]: 'a', created_by: 'm1' }),
        take({ id: 'm2-x', [ROOM_ITEM]: 'a', created_by: 'm2' }),
        lore({ id: 'lore', type: 'relation', supertype: 'Take', [ROOM_ITEM]: 'a', created_by: 'm1' }),
      ];
      expect(deletableTakes(els, 'a', 'm1').sort()).toEqual(['m1-x', 'm1-y']);
      expect(deletableTakes(els, 'a', 'm3')).toEqual([]);
      expect(deletableTakes(els, 'a', 'm3', true).sort()).toEqual(['m1-x', 'm1-y', 'm2-x']);
    });
  });

  it('x_packet_for: only Titles of this world, first place kept; whom it is for as a seat sees it (the packet profile)', () => {
    const t1 = lore({ id: 't1', type: 'title', holders: ['me', 'ada'] });
    const t2 = lore({ id: 't2', type: 'title', holders: ['ada'] });
    const els = [t1, t2, lore({ id: 'c', type: 'character' }),
      item({ id: 'role', x_packet_for: ['t1', 'c', '', 7, 'gone', 't1'] }),
      item({ id: 'other', x_packet_for: ['t2'] }),
      item({ id: 'person', actor: 'me' }),
      item({ id: 'both', actor: 'ada', x_packet_for: ['t2'] }),
      item({ id: 'none', x_packet_for: [] }),
      item({ id: 'junk', x_packet_for: 't1' }),
    ];
    const w = new Map(readWork(els, 'w1').map(x => [x.id, x]));
    // A Character id, an empty string, a number, an unknown id and a repeat are all left out (rule 4).
    expect(w.get('role')!.forTitles).toEqual(['t1']);
    expect(w.get('none')!.forTitles).toEqual([]);
    expect(w.get('junk')!.forTitles).toEqual([]);
    const byId = new Map(els.map(e => [e.id, e]));
    const addr = (id: string, me: string | null) => addressOf(w.get(id)!, me, byId);
    expect(['role', 'other', 'person', 'both', 'none', 'junk'].map(id => addr(id, 'me'))).toEqual(['mine', 'others', 'mine', 'others', 'none', 'none']);
    expect(['role', 'other', 'both'].map(id => addr(id, 'ada'))).toEqual(['mine', 'mine', 'mine']);
    // A seat with no Character holds no Title and is no actor: everything addressed is someone else's.
    expect(['role', 'person', 'none'].map(id => addr(id, null))).toEqual(['others', 'others', 'none']);
  });

  it('reads the state by the folded subtype, done last, and the typed links as its elements', () => {
    const w = readWork([
      item({ id: 'd', subtype: 'Done', created_at: '2026-10-25T10:00:00Z' }),
      item({ id: 'o', subtype: 'open', characters: ['a'], locations: ['b'], created_at: '2026-10-25T09:00:00Z' }),
      item({ id: 't', subtype: ' taken ', created_at: '2026-10-25T08:00:00Z' }),
      item({ id: 'q', subtype: 'whatever', created_at: '2026-10-25T07:00:00Z' }),
    ], 'w1');
    expect(w.map(x => [x.id, x.state])).toEqual([['o', 'open'], ['t', 'taken'], ['q', 'open'], ['d', 'done']]);
    expect(w[0].elements).toEqual([{ type: 'character', id: 'a', reason: null }, { type: 'location', id: 'b', reason: null }]);
  });

  it("a landed packet's entries win, with their reasons; entries missing a key are ignored; another world's say so", () => {
    const [w] = readWork([item({
      id: 'p', characters: ['a'],
      x_packet_elements: [{ type: 'Character', id: 'a', reason: 'No links.' }, { type: 'location', id: 'b' }],
      x_packet_source: { server: 'https://www.onlyworlds.com', world: 'w2' },
    })], 'w1');
    expect(w.elements).toEqual([{ type: 'character', id: 'a', reason: 'No links.' }]);
    expect(w.otherWorld).toBe(true);
    expect(readWork([item({ id: 'p', x_packet_elements: [{ type: 'character', id: 'a', reason: 'r' }], x_packet_source: { world: 'w1' } })], 'w1')[0].otherWorld).toBe(false);
  });

  it("an agent's proposed item says so; a lore Work item never shows", () => {
    const w = readWork([item({ id: 'p', x_review_proposed: { by: 'm1', expires: '2099-01-01' } }), lore({ id: 'l', type: 'relation', supertype: 'Work item' })], 'w1');
    expect(w.map(x => [x.id, x.proposed])).toEqual([['p', true]]);
  });

  it('an empty mark is settled, and a doubt shows settled on a page people read (review rules 1 and 4)', () => {
    for (const v of ['', '   ', [], {}, null, undefined, 'agent', 0, false, ['m1']]) {
      expect(readWork([item({ id: 'p', x_review_proposed: v })], 'w1')[0].proposed).toBe(false);
    }
  });

  it('a keeper may set done only an open or taken item, never a proposed one or a third word', () => {
    for (const w of ['open', ' Taken ', '', undefined]) expect(maySetDone(item({ id: 'p', subtype: w }))).toBe(true);
    for (const w of ['done', 'blocked']) expect(maySetDone(item({ id: 'p', subtype: w }))).toBe(false);
    expect(maySetDone(item({ id: 'p', subtype: 'open', x_review_proposed: { by: 'm1' } }))).toBe(false);
    expect(maySetDone(item({ id: 'p', subtype: 'open', x_review_proposed: '' }))).toBe(true);
  });

  it("only the world's own elements of a linkable type can be picked", () => {
    expect(isPickable(lore({ id: 'c', type: 'character', name: 'Ana' }))).toBe(true);
    expect(isPickable(lore({ id: 'l', type: 'law', name: 'A law' }))).toBe(false);
    expect(isPickable(el({ id: 'm', type: 'character', supertype: 'Member', name: 'a card' }))).toBe(false);
    expect(isPickable(lore({ id: 'h', type: 'location', hidden: true }))).toBe(false);
    expect(isPickable(lore({ id: 'k', type: 'location', known_of: true }))).toBe(false);
  });

  it('a line answering a work item points at it by relations', () => {
    const body = newLine('on it', null, null, 's1', 'wi');
    expect(body.relations).toEqual(['wi']);
    expect('parent_narrative' in body).toBe(false);
    expect(readLines([el({ id: 'l', type: 'narrative', supertype: 'Message', relations: ['wi'] })])[0].about).toBe('wi');
  });
});

describe('recent changes (sheet §2)', () => {
  it("the world's own elements, newest change first; room elements are not changes; who from changed_by, else the maker", () => {
    const c = readChanges([
      lore({ id: 'a', type: 'Character', name: 'Ana', created_at: '2026-10-25T08:00:00Z', updated_at: '2026-10-25T09:00:00Z', changed_by: 'm2', created_by: 'm1' }),
      lore({ id: 'b', type: 'location', name: '', created_at: '2026-10-25T08:30:00Z', updated_at: '2026-10-25T08:30:00Z', created_by: 'm1' }),
      lore({ id: 'o', type: 'object', created_at: '2026-10-25T07:00:00Z', updated_at: '2026-10-25T07:00:00Z', changed_by: null }),
      el({ id: 'line', type: 'narrative', supertype: 'Message', updated_at: '2026-10-25T10:00:00Z' }),
    ]);
    expect(c.map(x => [x.id, x.type, x.by, x.made])).toEqual([['a', 'character', 'm2', false], ['b', 'location', 'm1', true], ['o', 'object', OWNER, true]]);
    expect(c[1].name).toBe('Untitled');
  });

  it('a report a room left behind (narrative/Report with the mark) is no change and no pick; the same report without the mark is lore (SDK 4.146.0)', () => {
    const marked = el({ id: 'r', type: 'narrative', supertype: 'Report', name: 'Sitting report', updated_at: '2026-10-25T10:00:00Z' });
    const unmarked = lore({ id: 'u', type: 'narrative', supertype: 'Report', name: 'A lore report', updated_at: '2026-10-25T09:00:00Z' });
    expect(readChanges([marked, unmarked]).map(x => x.id)).toEqual(['u']);
    expect(isPickable(marked)).toBe(false);
    expect(isPickable(unmarked)).toBe(true);
  });
});
