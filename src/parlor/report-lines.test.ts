/**
 * The report profile's rule 10 (schema-dist v0.34.1-dist.129): how a text of `consequences` splits into lines, which
 * address a line names and the words a reader shows. The published fixture is vendored whole in
 * `fixtures/report-lines.fixture.json` (its bytes as released, checked by sha256 below), and every line and every text
 * runs through the room's own path: a report read by `readLines`, then each line by `consequenceLine` with the
 * fixture's world.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/report-lines.fixture.json';
import { ROOM_MARK, consequenceLine, readLines, type El } from './shapes';

const SHA256 = '2face7cd693235d806e34d3884164b6934a78a299fb77f5ac283b89374e1b47a';

/** A completed report as the room makes one, its `consequences` the text given. */
const report = (text: string): El => ({
  id: 'r', type: 'narrative', supertype: 'Report', subtype: 'completed', name: 'r', story: 'what I did',
  created_at: '2026-11-15T10:00:00Z', [ROOM_MARK]: fixture.world, consequences: text,
});

describe('the report lines fixture (rule 10, serial 129)', () => {
  it('is vendored as released', async () => {
    // Node's own modules by a specifier the type check does not resolve: the app's types carry no Node.
    const fsName = 'node:fs';
    const cryptoName = 'node:crypto';
    const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync(p: URL): Uint8Array };
    const { createHash } = (await import(/* @vite-ignore */ cryptoName)) as {
      createHash(a: string): { update(b: Uint8Array): { digest(e: string): string } };
    };
    const bytes = readFileSync(new URL('./fixtures/report-lines.fixture.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHA256);
    expect(fixture.profile).toBe('report');
    expect(fixture.table).toBe('lines');
    expect(fixture.cases).toHaveLength(101);
    expect(fixture.texts).toHaveLength(16);
  });

  describe('each line: its address and the words shown, through the report as the room reads it', () => {
    // A line the fixture gives untrimmed is read as given by the reader, but a report's text is trimmed into lines
    // first (part 1), so the room never holds it: through the report it is its trimmed self, whole.
    const untrimmed = fixture.cases.filter(c => c.line !== c.line.trim());
    it('one case only is given untrimmed, and its words are its whole line', () => {
      expect(untrimmed).toHaveLength(1);
      expect(untrimmed[0].words).toBe(untrimmed[0].line);
    });
    fixture.cases.forEach((c, i) => {
      it(`${i + 1} ${c.kind}`, () => {
        const part = readLines([report(c.line)])[0].report!;
        expect(part.consequences).toHaveLength(1);
        const line = part.consequences[0];
        const words = c.line === c.line.trim() ? c.words : line;
        expect(consequenceLine(line, fixture.world)).toEqual({ words, address: c.address });
        // The reader itself, handed the line as given.
        expect(consequenceLine(c.line, fixture.world)).toEqual({ words: c.words, address: c.address });
      });
    });
  });

  describe('each text: split as the standard splits it, each line read', () => {
    fixture.texts.forEach((t, i) => {
      it(`${i + 1} ${t.kind}`, () => {
        const part = readLines([report(t.text)])[0].report!;
        const got = part.consequences.map(line => ({ line, ...consequenceLine(line, fixture.world) }));
        expect(got).toEqual(t.lines.map(l => ({ line: l.line, words: l.words, address: l.address })));
      });
    });
  });
});
