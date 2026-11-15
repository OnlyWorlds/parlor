/**
 * A report's What changed lines, read by `consequenceLine` (the report profile's rule 10, schema-dist
 * v0.34.1-dist.129, through the SDK's `readReportLine`). Its addresses are found as the address profile finds them in
 * prose (serial 127, the SDK's `findOwLinks`): an address glued to a word before it is none. The address fixture's 14
 * start cases are vendored in `fixtures/address-prose-start.fixture.json`; what each shows as a line is rule 10's,
 * read here with the report lines fixture's own world (`fixtures/report-lines.fixture.json`), which names none of
 * these ids' worlds, so an address with no world names an element here and one with another world or a slug is prose.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/address-prose-start.fixture.json';
import lines from './fixtures/report-lines.fixture.json';
import { consequenceLine } from './shapes';

const W = lines.world;
const read = (line: string) => consequenceLine(line, W);
const E = '01a1d4ef-0000-7000-8000-000000000084';
const O = `ow://object/${E}`;
const O85 = 'ow://object/01a1d4ef-0000-7000-8000-000000000085';
const O8A = 'ow://object/01a1d4ef-0000-7000-8000-00000000008a';
const SITE = 'https://www.onlyworlds.com/w/';

/** Each case's line as the room shows it: its words (null = the whole line) and the address it names. */
const LINES: Record<string, { words: string | null; address: string | null }> = {
  'prose-start-glued-letter': { words: null, address: null },
  'prose-start-glued-underscore': { words: null, address: null },
  'prose-start-glued-non-ascii-letter': { words: null, address: null },
  'prose-start-glued-combining-mark': { words: null, address: null },
  'prose-start-glued-astral-letter': { words: null, address: null },
  'prose-start-astral-letter-then-space': { words: '\u{1D49C}', address: O },
  'prose-start-after-hyphen': { words: null, address: O },
  'prose-start-after-digit': { words: null, address: O },
  // A matched pair goes with the address; the line's closing stop stays (rule 10, part 3).
  'prose-start-after-opening-bracket': { words: 'Built the gate.', address: O },
  'prose-start-after-quote': { words: 'Built the gate.', address: O },
  'prose-start-of-text': { words: null, address: O },
  'prose-start-glued-letter-site-form': { words: null, address: null },
  'prose-back-to-back-after-digit': { words: null, address: O85 },
  'prose-back-to-back-after-hex-letter': { words: null, address: O8A },
};

describe('the address fixture\'s start cases (serial 127), each as a line of What changed', () => {
  const cases = fixture.cases.filter(c => /^prose-(start|back-to-back)-/.test(c.name));
  it('vendors the 14 cases, each tabled here', () => {
    expect(cases).toHaveLength(14);
    expect(cases.map(c => c.name).sort()).toEqual(Object.keys(LINES).sort());
  });
  for (const c of cases) {
    it(c.name, () => {
      const want = LINES[c.name];
      expect(read(c.text)).toEqual({ words: want.words ?? c.text, address: want.address });
    });
  }
});

describe('a line that starts with its address', () => {
  it('keeps the whole line as its words, still naming its element', () => {
    expect(read(O)).toEqual({ words: O, address: O });
    expect(read(`${O} was built.`)).toEqual({ words: `${O} was built.`, address: O });
  });
});

describe('an address leaves the words only when it stands apart', () => {
  it('after a hyphen, a digit or another mark: the whole line, still naming its element', () => {
    for (const line of [`x-${O}`, `Built **${O}**`, `Moved it: 3${O}`, `Set it>${O}`]) {
      expect(read(line), line).toEqual({ words: line, address: O });
    }
  });
  it('two addresses, the later after a hyphen: the later is the line\'s, and the whole line stays', () => {
    const line = `Built: ${O} then x-${O85}`;
    expect(read(line)).toEqual({ words: line, address: O85 });
  });
});

describe('a bracket or quote matched around the address leaves with it', () => {
  it('each pair; a closing stop after it stays', () => {
    expect(read(`Quoted "${O}".`)).toEqual({ words: 'Quoted.', address: O });
    expect(read(`Quoted '${O}' today`)).toEqual({ words: 'Quoted today', address: O });
    expect(read(`Moved the gate [${O}] today`)).toEqual({ words: 'Moved the gate today', address: O });
    expect(read(`Moved the gate (${O}) today`)).toEqual({ words: 'Moved the gate today', address: O });
    expect(read(`Quoted “${O}”.`)).toEqual({ words: 'Quoted.', address: O });
    expect(read(`Quoted ‘${O}’, then hung it.`)).toEqual({ words: 'Quoted, then hung it.', address: O });
    expect(read(`Quoted «${O}» today`)).toEqual({ words: 'Quoted today', address: O });
  });
  it('an opener with no closer keeps the whole line, still naming its element', () => {
    for (const line of [`Quoted "${O}`, `Moved the gate [${O} to the hall`]) {
      expect(read(line), line).toEqual({ words: line, address: O });
    }
  });
});

describe('the line\'s address is the last that names an element of this world', () => {
  it('a later site address with a slug is prose: the earlier text address is the line\'s', () => {
    const site = `${SITE}hyperion/object/${E}`;
    expect(read(`Built: ${O} and ${site}`)).toEqual({ words: `Built and ${site}`, address: O });
  });
  it('a text address after a site address of another world', () => {
    const site = `${SITE}0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40/object/${E}`;
    expect(read(`Built: ${site} then ${O85}.`)).toEqual({ words: `Built: ${site} then.`, address: O85 });
  });
  it('a later start that reads nothing does not hide an earlier address', () => {
    expect(read(`Built: ${O} beside ow://dragon/1`)).toEqual({ words: 'Built beside ow://dragon/1', address: O });
  });
});
