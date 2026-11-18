// The team world's pure reads: the crew from the roster (the vendored team rule with the Member Character fill),
// a seat's room as a filter over the line reader, threads, who asked and working, the workshop's run, the design
// folds and an element's card.
import { describe, expect, it } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { readLines, readWork, readDesignParts, type El, type Sitting } from './shapes';
import { crewOf, seatRoom, thread, heldWork, workLineOf, workshopRuns, designFolds, cardOf, firstLine, seatsByKey } from './crew';
import { buildTeam, newestNote, age } from './team';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

const member = (over: Partial<OwMember>): OwMember => ({ id: null, kind: 'person', role: 'contributor', character: null, status: 'active', lenses: [], lenses_from: 'none', ...over } as OwMember);

describe('the crew', () => {
  const members: OwMember[] = [
    member({ id: null, kind: 'owner', role: 'owner', character: 'c-titus' }),
    member({ id: 'm-jas', role: 'contributor', character: 'c-jasper' }),
    member({ id: 'm-noch', role: 'contributor', character: null, name: 'noor-login' }),
    member({ id: 'm-bare', role: 'contributor', character: null }),
    member({ id: 'a-von', kind: 'agent', role: 'contributor', character: 'c-vonkje', name: 'vonkje-seat', sponsor_member: null }),
    member({ id: 'a-kael', kind: 'agent', role: 'contributor', character: 'c-kael', name: 'kael', sponsor_member: 'owner' }),
    member({ id: 'a-twin', kind: 'agent', role: 'contributor', character: 'c-jasper', name: 'jasper-ai', sponsor_member: 'm-jas' }),
    member({ id: 'p-1', kind: 'player', role: 'guest', character: null, name: 'Player' }),
    member({ id: 'm-gone', role: 'contributor', character: 'c-gone', status: 'removed' }),
  ];
  const names: Record<string, string> = { 'c-titus': 'Titus', 'c-jasper': 'Jasper', 'c-vonkje': 'Vonkje', 'c-kael': 'Kael' };
  const charName = (c: string | null) => (c ? names[c] ?? null : null);
  const memberCharacters = new Map([['m-noch', { id: 'c-own', name: 'Noor' }]]);
  const crew = crewOf({ members, me: 'm-jas', mySeats: [], charName, memberCharacters });

  it('puts an AI no one answers for among the beasts and an AI with a sponsor under its person', () => {
    expect(crew.beasts.map(b => b.name)).toEqual(['Vonkje']);
    const titus = crew.people.find(p => p.seat.key === 'owner')!;
    expect(titus.ais.map(a => a.name)).toEqual(['Kael']);
    expect(titus.seat.role).toBe('host');
  });

  it('reads the reader first, and leaves players and removed rows off', () => {
    expect(crew.people[0].seat.key).toBe('m-jas');
    expect(crew.people[0].seat.you).toBe(true);
    const keys = [...seatsByKey(crew).keys()];
    expect(keys).not.toContain('p-1');
    expect(keys).not.toContain('m-gone');
  });

  it('gives a person with no roster Character the Member Character they made, its name over a served username', () => {
    const noor = crew.people.find(p => p.seat.key === 'm-noch')!.seat;
    expect(noor.character).toBe('c-own');
    expect(noor.name).toBe('Noor');
  });

  it('leaves a person with neither without a room, named by the fallback', () => {
    const bare = crew.people.find(p => p.seat.key === 'm-bare')!.seat;
    expect(bare.character).toBeNull();
    expect(bare.name).toBe('A member');
  });

  it('gives an AI that plays its person no room of its own, only its person to open', () => {
    const twin = crew.people.find(p => p.seat.key === 'm-jas')!.ais[0];
    expect(twin.plays).toBe('m-jas');
    expect(twin.character).toBeNull();
  });

  it('never names a seat by a Character the reader is not served', () => {
    const hidden = crewOf({ members, me: 'm-jas', mySeats: [], charName: () => null, memberCharacters: new Map() });
    expect(hidden.beasts[0].name).toBe('vonkje-seat');
    expect(hidden.people.find(p => p.seat.key === 'owner')!.seat.name).toBe('The owner');
  });

  it('is the dashboard rule: buildTeam itself places by sponsor and my_seats only', () => {
    const t = buildTeam({ members, me: 'owner', mySeats: [{ id: 'a-von' }], nameOf: c => charName(c) ?? '', charName });
    expect(t.people.find(p => p.key === 'owner')!.ais.map(a => a.key).sort()).toEqual(['a-kael', 'a-von']);
    expect(t.unattached).toEqual([]);
  });
});

describe('a member\'s newest Note', () => {
  const roster: OwMember[] = [member({ id: 'a-von', kind: 'agent', character: 'c-v' })];
  const note = (id: string, at: string, over: Record<string, unknown> = {}) =>
    ({ id, type: 'narrative', supertype: 'Note', name: id, narrator: 'c-v', created_by: 'a-von', created_at: at, ...over });
  it('takes the newest verified Note by its own hand, never a hidden one or an edit by another hand', () => {
    const notes = [
      note('n1', '2026-11-18T10:00:00Z'),
      note('n2', '2026-11-18T12:00:00Z'),
      note('n3', '2026-11-18T13:00:00Z', { changed_by: 'm-other' }),
      note('n4', '2026-11-18T14:00:00Z', { hidden: true }),
      note('n5', '2026-11-18T15:00:00Z', { narrator: 'c-someone-else' }),
    ];
    expect(newestNote(notes as never[], 'a-von', roster)?.id).toBe('n2');
  });
  it('says an age in short words', () => {
    expect(age('2026-11-18T10:00:00Z', Date.parse('2026-11-18T12:30:00Z'))?.text).toBe('2h');
  });
});

const line = (id: string, at: string, over: Record<string, unknown> = {}): El =>
  ({ id, type: 'narrative', supertype: 'Message', name: id, story: id, x_room_of: WORLD, created_at: at, ...over } as El);

describe('threads and a seat\'s room', () => {
  const els = [
    line('a', '2026-11-18T10:00:00Z'),
    line('b', '2026-11-18T10:01:00Z', { characters: ['c-v'] }),
    line('c', '2026-11-18T10:02:00Z', { parent_narrative: 'b' }),
    line('d', '2026-11-18T10:03:00Z', { parent_narrative: 'c' }),
    line('e', '2026-11-18T10:04:00Z', { parent_narrative: 'a' }),
    line('f', '2026-11-18T10:05:00Z', { characters: ['c-other'] }),
    // A report that touched the seat's Character is never a line in its room.
    { id: 'r', type: 'narrative', supertype: 'Report', subtype: 'handed in', name: 'r', story: 'r', characters: ['c-v'], x_room_of: WORLD, created_at: '2026-11-18T10:06:00Z' } as El,
    // A board entry waiting on the seat is no line at all.
    { id: 'board', type: 'narrative', supertype: 'Board', subtype: 'red', name: 'board', characters: ['c-v'], x_room_of: WORLD, created_at: '2026-11-18T10:07:00Z' } as El,
    // Mail: a Message without the room mark.
    { id: 'mail', type: 'narrative', supertype: 'Message', name: 'mail', characters: ['c-v'], created_at: '2026-11-18T10:08:00Z' } as El,
    // A line in a loop of parents.
    line('x', '2026-11-18T10:09:00Z', { parent_narrative: 'y' }),
    line('y', '2026-11-18T10:10:00Z', { parent_narrative: 'x' }),
    // A reply to a board entry stays a root.
    line('g', '2026-11-18T10:11:00Z', { parent_narrative: 'board' }),
  ];
  const lines = readLines(els);

  it('puts each reply under its parent, a reply to a reply under it, and a reply to a board entry as a root', () => {
    expect(thread(lines).map(t => `${t.line.id}${t.depth}`)).toEqual(['a0', 'e1', 'b0', 'c1', 'd2', 'f0', 'r0', 'g0', 'x0', 'y1']);
  });

  it('holds the lines addressed to the seat and every reply under them, nothing else', () => {
    expect(seatRoom(lines, 'c-v').map(t => `${t.line.id}${t.depth}`)).toEqual(['b0', 'c1', 'd2']);
  });

  it('reads the address only on a Message: a report\'s characters is no address', () => {
    expect(lines.find(l => l.id === 'r')!.to).toEqual([]);
    expect(lines.find(l => l.id === 'b')!.to).toEqual(['c-v']);
  });

  it('keeps a loop of parents out of a room nothing in it is addressed to', () => {
    expect(seatRoom(lines, 'c-other').map(t => t.line.id)).toEqual(['f']);
  });
});

const workItem = (id: string, at: string, over: Record<string, unknown> = {}): El =>
  ({ id, type: 'relation', supertype: 'Work item', name: `Item ${id}`, subtype: 'open', x_room_of: WORLD, created_at: at, created_by: 'm-titus', ...over } as El);
const take = (id: string, item: string, by: string): El =>
  ({ id, type: 'relation', supertype: 'Take', name: 'Take', subtype: 'taken', x_room_of: WORLD, x_room_item: item, created_by: by, created_at: '2026-11-18T09:00:00Z' } as El);

describe('who asked, and working', () => {
  const els = [
    workItem('w-open', '2026-11-18T08:00:00Z', { characters: ['c-v'] }),
    workItem('w-taken', '2026-11-18T08:30:00Z', { subtype: 'taken', characters: ['c-v'], created_by: 'm-titus' }),
    workItem('w-taken-newer', '2026-11-18T09:30:00Z', { subtype: 'taken', characters: ['c-v'], created_by: 'm-bb' }),
    workItem('w-done', '2026-11-18T10:00:00Z', { subtype: 'done', characters: ['c-v'] }),
    workItem('w-took', '2026-11-18T07:00:00Z', { created_by: 'owner' }),
    take('t1', 'w-took', 'm-jas'),
  ];
  const work = readWork(els, WORLD);

  it('reads the newest taken work item whose characters holds the seat, never an open or done one', () => {
    expect(heldWork(work, { key: 'a-von', character: 'c-v' })?.id).toBe('w-taken-newer');
  });

  it('reads a work item the seat\'s own live take holds', () => {
    expect(heldWork(work, { key: 'm-jas', character: 'c-j' })?.id).toBe('w-took');
  });

  it('holds none for a seat that holds nothing taken', () => {
    expect(heldWork(work, { key: 'm-x', character: 'c-x' })).toBeNull();
  });

  it('says asked by from the work item and since from the Note, else the item', () => {
    const elsMap = new Map<string, El>([['o1', { id: 'o1', type: 'object', name: 'Exam trainer' } as El], ['room', { id: 'room', type: 'object', name: 'r', supertype: 'Message', x_room_of: WORLD } as El]]);
    const held = heldWork(work, { key: 'a-von', character: 'c-v' });
    const note = { id: 'n', type: 'narrative', supertype: 'Note', story: '\n  Building the first screen  \nmore', objects: ['o1', 'missing'], narrator: 'c-v', created_at: '2026-11-18T11:00:00Z' } as El;
    const wl = workLineOf(note, held, elsMap)!;
    expect(wl).toEqual({ on: 'Building the first screen', noteAt: '2026-11-18T11:00:00Z', links: ['o1'], working: true, since: '2026-11-18T11:00:00Z', askedBy: 'm-bb' });
    const noNote = workLineOf(null, held, elsMap)!;
    expect(noNote.since).toBe('2026-11-18T09:30:00Z');
    expect(noNote.on).toBe('');
  });

  it('is not working with a Note and nothing taken, and draws no line with neither', () => {
    const note = { id: 'n', type: 'narrative', supertype: 'Note', story: 'Reading', created_at: '2026-11-18T11:00:00Z' } as El;
    expect(workLineOf(note, null, new Map())).toMatchObject({ working: false, since: null, askedBy: null, on: 'Reading' });
    expect(workLineOf(null, null, new Map())).toBeNull();
  });
});

describe('a workshop runs', () => {
  const s = (over: Partial<Sitting>): Sitting => ({ id: 's', phase: 'Arrive', star: null, hearts: false, specs: false, voting: false, feedStart: null, at: '', by: 'owner', ...over });
  it('while any switch of the newest sitting is on', () => {
    expect(workshopRuns([])).toBe(false);
    expect(workshopRuns([s({})])).toBe(false);
    expect(workshopRuns([s({ hearts: true }), s({ id: 't' })])).toBe(false);
    expect(workshopRuns([s({}), s({ id: 't', voting: true })])).toBe(true);
    expect(workshopRuns([s({ specs: true })])).toBe(true);
  });
});

describe('the design folds', () => {
  const obj = (id: string, parent?: string, subtype = 'in design'): El => ({ id, type: 'object', name: id, subtype, ...(parent ? { parent_object: parent } : {}) } as El);
  it('puts each part under its topmost design and keeps a loop standing on its own', () => {
    const parts = readDesignParts([obj('trainer'), obj('screen', 'trainer'), obj('deep', 'screen'), obj('plain', 'lore'), obj('loop1', 'loop2'), obj('loop2', 'loop1'),
      { id: 'lore', type: 'object', name: 'lore' } as El]);
    const folds = designFolds(parts);
    const view = Object.fromEntries(folds.map(f => [f.design.id, f.parts.map(p => p.id)]));
    expect(view).toEqual({ trainer: ['deep', 'screen'], plain: [], loop1: [], loop2: [] });
  });
});

describe('an element\'s card', () => {
  const els = new Map<string, El>([
    ['trainer', { id: 'trainer', type: 'construct', name: 'Exam trainer', subtype: 'in design', description: 'Buddy walks a student.\nMore.', abilities: [] } as El],
    ['screen', { id: 'screen', type: 'object', name: 'First screen', subtype: 'in design', parent_object: 'big', materials: ['trainer', 'secret'], description: '' } as El],
    ['big', { id: 'big', type: 'object', name: 'Big', subtype: 'in design' } as El],
    ['kid', { id: 'kid', type: 'object', name: 'Kid', parent_object: 'screen' } as El],
    ['hid', { id: 'hid', type: 'object', name: 'Hid', parent_object: 'screen', hidden: true } as El],
  ]);
  const work = readWork([workItem('q1', '2026-11-18T08:00:00Z', { objects: ['screen'] }), workItem('q2', '2026-11-18T08:00:00Z', { objects: ['screen'], subtype: 'done' })], WORLD);
  it('names each link by its field, the parts under it, and its open questions; never one the reader is not served', () => {
    const c = cardOf(els.get('screen')!, els, work);
    expect(c.kind).toBe('Object');
    expect(c.state).toBe('in design');
    expect(c.links.map(l => `${l.label}:${l.name}`)).toEqual(['Parent object:Big', 'Materials:Exam trainer', 'Under it:Kid']);
    expect(c.questions.map(q => q.id)).toEqual(['q1']);
  });
  it('reads a first line for a hover', () => {
    expect(firstLine(els.get('trainer'))).toBe('Buddy walks a student.');
    expect(firstLine(els.get('screen'))).toBe('');
  });
});
