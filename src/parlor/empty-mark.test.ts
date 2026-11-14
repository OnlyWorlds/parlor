/**
 * A mark read by presence (schema-dist serial 126; the SDK's `isRoomElement` and `isCharterElement` since 4.163.0):
 * `x_room_of` or `x_charter_of` that is an empty list or an empty object is no mark, as a compact read leaves both out.
 * Such an element is the world's own: it is no room line, it may be picked, and it shows in Recent changes.
 */
import { describe, expect, it } from 'vitest';
import { type El, isPickable, isReport, isReportPickable, readBoard, readChanges, readLines, unmarkedCharters } from './shapes';

const W = '0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40';
const at = '2026-11-14T10:00:00Z';
const mk = (o: Partial<El> & { id: string; type: string }): El => ({ created_at: at, updated_at: at, ...o });

for (const mark of [[], {}] as unknown[]) {
  describe(`x_room_of ${JSON.stringify(mark)} is no mark`, () => {
    it('a Message, a board entry or a report with it is no room line', () => {
      expect(readLines([mk({ id: 'm', type: 'narrative', supertype: 'Message', x_room_of: mark })])).toEqual([]);
      expect(readBoard([mk({ id: 'b', type: 'narrative', supertype: 'Board', x_room_of: mark })])).toEqual([]);
      expect(isReport(mk({ id: 'r', type: 'narrative', supertype: 'Report', x_room_of: mark }))).toBe(false);
    });
    it('a Member Character with it may be picked', () => {
      const c = mk({ id: 'c', type: 'character', supertype: 'Member', x_room_of: mark });
      expect(isPickable(c)).toBe(true);
      expect(isReportPickable(c)).toBe(true);
    });
    it('it shows in Recent changes', () => {
      expect(readChanges([mk({ id: 'm', type: 'narrative', supertype: 'Message', x_room_of: mark })]).map(c => c.id)).toEqual(['m']);
    });
  });
}

describe('the controls: the world\'s id is a mark', () => {
  it('a room line, never picked, never a change', () => {
    expect(readLines([mk({ id: 'm', type: 'narrative', supertype: 'Message', x_room_of: W })]).map(l => l.id)).toEqual(['m']);
    expect(isReport(mk({ id: 'r', type: 'narrative', supertype: 'Report', x_room_of: W }))).toBe(true);
    const c = mk({ id: 'c', type: 'character', supertype: 'Member', x_room_of: W });
    expect(isPickable(c)).toBe(false);
    expect(isReportPickable(c)).toBe(false);
    expect(readChanges([mk({ id: 'm', type: 'narrative', supertype: 'Message', x_room_of: W })])).toEqual([]);
  });
});

for (const mark of [[], {}] as unknown[]) {
  describe(`x_charter_of ${JSON.stringify(mark)} is no mark`, () => {
    it('a Guide with it may be picked for a report', () => {
      expect(isReportPickable(mk({ id: 'g', type: 'construct', supertype: 'Guide', x_charter_of: mark }))).toBe(true);
    });
    it('a Charter Law with it is offered to a keeper as unmarked', () => {
      expect(unmarkedCharters([mk({ id: 'l', type: 'law', supertype: 'Charter', name: 'House rules', x_charter_of: mark })]).map(c => c.id)).toEqual(['l']);
    });
  });
}

describe('the controls: a charter mark of the world\'s id', () => {
  it('is never picked and is the charter, not an unmarked one', () => {
    expect(isReportPickable(mk({ id: 'g', type: 'construct', supertype: 'Guide', x_charter_of: W }))).toBe(false);
    expect(unmarkedCharters([mk({ id: 'l', type: 'law', supertype: 'Charter', name: 'House rules', x_charter_of: W })])).toEqual([]);
  });
});
