import { describe, expect, it } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { isAiSeat, nameOf, roomRole, seats } from './roster';
import { OWNER, readMemberCharacters, type El } from './shapes';

const roster: OwMember[] = [
  { id: null, kind: 'owner', role: 'owner', character: 'c-owner', status: 'active' },
  { id: 'm-person', kind: 'person', role: 'contributor', character: null, status: 'active' },
  { id: 'm-agent', kind: 'agent', role: 'contributor', character: null, status: 'active', name: 'Skeld' },
  { id: 'm-gone', kind: 'person', role: 'contributor', character: null, status: 'removed' },
];

const els = new Map<string, El>([
  ['c-owner', { id: 'c-owner', type: 'character', name: 'Titus' }],
  ['c-own', { id: 'c-own', type: 'character', supertype: 'Member', name: 'Samantha', created_by: 'm-person', created_at: '2026-10-22T10:00:00Z', x_room_of: 'w1' }],
  ['c-own2', { id: 'c-own2', type: 'character', supertype: 'Member', name: 'Sam (double)', created_by: 'm-person', created_at: '2026-10-22T10:00:01Z', x_room_of: 'w1' }],
]);
const members = readMemberCharacters(els.values());

describe('the AI mark', () => {
  it("reads the roster's kind, so a person through MCP is a person", () => {
    expect(isAiSeat('m-person', roster, 'mcp')).toBe(false);
    expect(isAiSeat('m-agent', roster, 'api')).toBe(true);
    expect(isAiSeat(OWNER, roster, 'mcp')).toBe(false);
  });

  it('falls back to the door only when the roster cannot say', () => {
    expect(isAiSeat('m-unknown', roster, 'seat')).toBe(true);
    expect(isAiSeat('m-unknown', roster, 'api')).toBe(false);
    expect(isAiSeat('m-person', null, 'mcp')).toBe(true);
  });
});

describe('names', () => {
  it('roster Character, else the Member Character the person made (the oldest), else the agent row', () => {
    expect(nameOf(OWNER, roster, els, members)).toBe('Titus');
    expect(nameOf('m-person', roster, els, members)).toBe('Samantha');
    expect(nameOf('m-agent', roster, els, members)).toBe('Skeld');
    expect(nameOf('m-gone', roster, els, members)).toBe('A member');
  });

  it('seats: hosts first, the removed left out', () => {
    expect(seats(roster, els, members).map(s => [s.name, s.role, s.ai])).toEqual([
      ['Titus', 'host', false], ['Samantha', 'member', false], ['Skeld', 'member', true],
    ]);
  });

  it("keel's roles in the room's words", () => {
    expect(['owner', 'co_builder', 'contributor', 'guest', undefined].map(roomRole))
      .toEqual(['host', 'co-host', 'member', 'watcher', 'watcher']);
  });
});
