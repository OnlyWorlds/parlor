/**
 * A report's What changed lines, their addresses found by the SDK's `findOwLinks` (the address profile's "An address
 * in prose", schema-dist v0.34.1-dist.127, Council 1540): an address glued to a word before it is none, and the line's
 * address is the last found. The fixture's 14 start cases are vendored in `fixtures/address-prose-start.fixture.json`;
 * what a line shows is the room's own rule, tabled here by hand (the fixture says where an address is, not what a line
 * shows).
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/address-prose-start.fixture.json';
import { splitConsequence } from './shapes';

const E = '01a1d4ef-0000-7000-8000-000000000084';
const O = `ow://object/${E}`;
const O85 = 'ow://object/01a1d4ef-0000-7000-8000-000000000085';
const O8A = 'ow://object/01a1d4ef-0000-7000-8000-00000000008a';
const SITE = 'https://www.onlyworlds.com/w/';

/** Each case's line as the room shows it: its words (null = the whole line) and the address kept apart. */
const LINES: Record<string, { words: string | null; address: string | null }> = {
  'prose-start-glued-letter': { words: null, address: null },
  'prose-start-glued-underscore': { words: null, address: null },
  'prose-start-glued-non-ascii-letter': { words: null, address: null },
  'prose-start-glued-combining-mark': { words: null, address: null },
  'prose-start-glued-astral-letter': { words: null, address: null },
  'prose-start-astral-letter-then-space': { words: '\u{1D49C}', address: O },
  'prose-start-after-hyphen': { words: null, address: O },
  'prose-start-after-digit': { words: null, address: O },
  'prose-start-after-opening-bracket': { words: 'Built the gate', address: O },
  'prose-start-after-quote': { words: 'Built the gate', address: O },
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
      expect(splitConsequence(c.text)).toEqual({ words: want.words ?? c.text, address: want.address });
    });
  }
});

describe('a line that starts with its address', () => {
  it('keeps the whole line as its words, the address kept apart', () => {
    expect(splitConsequence(O)).toEqual({ words: O, address: O });
    expect(splitConsequence(`${O} was built.`)).toEqual({ words: `${O} was built.`, address: O });
  });
});

describe('an address leaves the words only when it stands apart', () => {
  it('after a hyphen, a digit or another mark: the whole line, the address kept apart', () => {
    for (const line of [`x-${O}`, `Built **${O}**`, `Moved it: 3${O}`, `Set it>${O}`]) {
      expect(splitConsequence(line), line).toEqual({ words: line, address: O });
    }
  });
  it('two addresses, the later after a hyphen: the later is the line\'s, and the whole line stays', () => {
    const line = `Built: ${O} then x-${O85}`;
    expect(splitConsequence(line)).toEqual({ words: line, address: O85 });
  });
});

describe('a bracket or quote opened on the address leaves with it, and so does its closer', () => {
  it('each pair', () => {
    expect(splitConsequence(`Quoted "${O}".`)).toEqual({ words: 'Quoted', address: O });
    expect(splitConsequence(`Quoted '${O}' today`)).toEqual({ words: 'Quoted today', address: O });
    expect(splitConsequence(`Moved the gate [${O}] today`)).toEqual({ words: 'Moved the gate today', address: O });
    expect(splitConsequence(`Moved the gate (${O}) today`)).toEqual({ words: 'Moved the gate today', address: O });
    expect(splitConsequence(`Quoted “${O}”.`)).toEqual({ words: 'Quoted', address: O });
    expect(splitConsequence(`Quoted ‘${O}’, then hung it.`)).toEqual({ words: 'Quoted, then hung it.', address: O });
    expect(splitConsequence(`Quoted «${O}» today`)).toEqual({ words: 'Quoted today', address: O });
  });
  it('an opener with no closer still leaves with the address', () => {
    expect(splitConsequence(`Quoted "${O}`)).toEqual({ words: 'Quoted', address: O });
    expect(splitConsequence(`Moved the gate [${O} to the hall`)).toEqual({ words: 'Moved the gate to the hall', address: O });
  });
});

describe('the line\'s address is the last found, in either form', () => {
  it('a site address after a text address', () => {
    const site = `${SITE}hyperion/object/${E}`;
    expect(splitConsequence(`Built: ${O} and ${site}`)).toEqual({ words: `Built: ${O} and`, address: site });
  });
  it('a text address after a site address', () => {
    const site = `${SITE}0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40/object/${E}`;
    expect(splitConsequence(`Built: ${site} then ${O85}.`)).toEqual({ words: `Built: ${site} then`, address: O85 });
  });
  it('a later start that reads nothing does not hide an earlier address', () => {
    expect(splitConsequence(`Built: ${O} beside ow://dragon/1`)).toEqual({ words: 'Built beside ow://dragon/1', address: O });
  });
});
