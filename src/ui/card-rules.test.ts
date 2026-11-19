// The element card's view rules (card-rules.ts), one block per rule of the card's spec: Escape (R5), focus after a close
// (R6) and after a redraw (S1), the fold (S6, N7), long names in the link picture and bidi (S5), the marks' words (S3,
// R3, R7), the questions' words and where a question goes (M3, R8), and a press only where there is a card (R4).
import { describe, expect, it } from 'vitest';
import { closeMovesFocus, escapeClosesCard, fitName, focusAfterRedraw, foldStays, isolated, linkNote, linkPresses, markLines, moreQuestions, questionHref, questionWords, LABEL_ROOM, NAME_ROOM } from './card-rules';
import { readAddress } from '../parlor/address';

const esc = (over: Partial<{ key: string; isComposing: boolean; keyCode: number; defaultPrevented: boolean }> = {}) => ({ key: 'Escape', isComposing: false, keyCode: 27, defaultPrevented: false, ...over });
const open = { cardOpen: true, viewerOpen: false, fanOutOpen: false };

describe('Escape (R5)', () => {
  it('closes the card from the card, and from its opener outside it', () => {
    expect(escapeClosesCard(esc(), { inCard: true, editable: false }, open)).toBe(true);
    expect(escapeClosesCard(esc(), { inCard: false, editable: false }, open)).toBe(true);
  });
  it('stays the composer\'s, or any field\'s outside the card', () => {
    expect(escapeClosesCard(esc(), { inCard: false, editable: true }, open)).toBe(false);
  });
  it('leaves a composing key alone (an input method\'s own Escape)', () => {
    expect(escapeClosesCard(esc({ isComposing: true }), { inCard: true, editable: false }, open)).toBe(false);
    expect(escapeClosesCard(esc({ keyCode: 229 }), { inCard: true, editable: false }, open)).toBe(false);
  });
  it('leaves a key something else took alone, and waits for a viewer or the mark\'s fan-out to close first', () => {
    expect(escapeClosesCard(esc({ defaultPrevented: true }), { inCard: true, editable: false }, open)).toBe(false);
    expect(escapeClosesCard(esc(), { inCard: true, editable: false }, { ...open, viewerOpen: true })).toBe(false);
    expect(escapeClosesCard(esc(), { inCard: true, editable: false }, { ...open, fanOutOpen: true })).toBe(false);
  });
  it('another key, or no card open, closes nothing', () => {
    expect(escapeClosesCard(esc({ key: 'Enter' }), { inCard: true, editable: false }, open)).toBe(false);
    expect(escapeClosesCard(esc(), { inCard: false, editable: false }, { ...open, cardOpen: false })).toBe(false);
  });
});

describe('focus after a close (R6)', () => {
  it('moves only when it was in the card or on its opener', () => {
    expect(closeMovesFocus(true, false)).toBe(true);
    expect(closeMovesFocus(false, true)).toBe(true);
  });
  it('a card that closes while someone types in the composer leaves the composer its focus', () => {
    expect(closeMovesFocus(false, false)).toBe(false);
  });
});

describe('focus after a redraw (S1)', () => {
  it('goes back to the control with the same key', () => {
    expect(focusAfterRedraw('card:g:in:birthplace:a', new Set(['card:h', 'card:g:in:birthplace:a']), true)).toBe('card:g:in:birthplace:a');
  });
  it('falls to the heading when that control went, or focus held no key, never to the page', () => {
    expect(focusAfterRedraw('card:q:gone', new Set(['card:h']), true)).toBe('heading');
    expect(focusAfterRedraw(null, new Set(['card:h']), true)).toBe('heading');
  });
  it('moves nothing when focus was not in the card', () => {
    expect(focusAfterRedraw(null, new Set(['card:h']), false)).toBeNull();
  });
});

describe('the words\' fold (S6, N7)', () => {
  it('stays open across a redraw of the same element, and folds on a step', () => {
    expect(foldStays(true, 'a', 'a')).toBe(true);
    expect(foldStays(true, 'a', 'b')).toBe(false);
    expect(foldStays(false, 'a', 'a')).toBe(false);
    expect(foldStays(true, null, 'a')).toBe(false);
  });
});

describe('a long name in the link picture (S5) and bidi', () => {
  it('a name that fits is whole', () => {
    expect(fitName('Ada', NAME_ROOM)).toEqual({ text: 'Ada', cut: false });
  });
  it('a longer one ends in an ellipsis inside its room', () => {
    const long = 'The very long name of a harbour town on the northern shore';
    const f = fitName(long, NAME_ROOM);
    expect(f.cut).toBe(true);
    expect(f.text.endsWith('…')).toBe(true);
    expect(Array.from(f.text).length).toBeLessThanOrEqual(NAME_ROOM);
    expect(long.startsWith(f.text.slice(0, -1))).toBe(true);
  });
  it('a wide character counts two, and a pair of surrogates is never split', () => {
    const wide = '港'.repeat(20);
    const f = fitName(wide, NAME_ROOM);
    expect(Array.from(f.text.slice(0, -1)).length).toBeLessThanOrEqual(Math.floor(NAME_ROOM / 2));
    const emoji = '🌊'.repeat(30);
    const e = fitName(emoji, LABEL_ROOM).text.slice(0, -1);
    expect(Array.from(e).every(ch => ch === '🌊')).toBe(true);
  });
  it('isolates a name for bidi inside SVG text (FIRST STRONG ISOLATE, POP DIRECTIONAL ISOLATE)', () => {
    expect(isolated('שלום')).toBe('\u2068שלום\u2069');
  });
});

describe('the marks\' words (S3, R3, R7)', () => {
  it('one line per mark, in order', () => {
    expect(markLines({ knownOf: true, hidden: true, proposed: true, trimmed: true })).toEqual([
      'Known of: some of it is not shown to you',
      'Hidden from others',
      'Proposed, waits for review',
      'Some links may be left out for you',
    ]);
    expect(markLines({ knownOf: false, hidden: false, proposed: false, trimmed: false })).toEqual([]);
  });
  it('a neighbour\'s marks in a few words', () => {
    expect(linkNote({ knownOf: true, hidden: false, proposed: true })).toBe('known of, proposed');
    expect(linkNote({ knownOf: false, hidden: true, proposed: false })).toBe('hidden from others');
  });
});

describe('the questions (M3, N7, R8)', () => {
  const q = (state: 'ok' | 'pending' | 'failed' | 'capped', n: number, cap: number | null = null) => ({ state, cap, items: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: null, title: 'Q', state: 'open' as const, hidden: false })) });
  it('pending, failed and capped never read as none', () => {
    for (const s of ['pending', 'failed', 'capped'] as const) expect(questionWords(q(s, 0, 1000)).foot).not.toBe('No open questions');
    expect(questionWords(q('pending', 0)).foot).toBe('Open questions: not read yet');
    expect(questionWords(q('failed', 0)).foot).toBe('Could not read the questions');
    expect(questionWords(q('capped', 2, 1000))).toEqual({ foot: '2 open questions', note: '2 found; the world has more work items than were read.' });
  });
  it('a whole read says the count, or none', () => {
    expect(questionWords(q('ok', 0)).foot).toBe('No open questions');
    expect(questionWords(q('ok', 1)).foot).toBe('1 open question');
  });
  it('past five, the rest are under Work', () => {
    expect(moreQuestions(5)).toBeNull();
    expect(moreQuestions(7)).toBe('And 2 more under Work.');
  });
  it('a question goes to its work item\'s own address in this world', () => {
    const at = questionHref('0f0f0f0f-0000-4000-8000-00000000a1a1', '1a1a1a1a-0000-4000-8000-000000000003');
    expect(at).toBe('#/w/0f0f0f0f-0000-4000-8000-00000000a1a1/work/1a1a1a1a-0000-4000-8000-000000000003');
    expect(readAddress(at)).toEqual({ world: '0f0f0f0f-0000-4000-8000-00000000a1a1', work: '1a1a1a1a-0000-4000-8000-000000000003' });
  });
});

describe('a press only where there is a card (R4)', () => {
  it('asks the reader\'s graph', () => {
    const has = new Set(['a']);
    expect(linkPresses('a', id => has.has(id))).toBe(true);
    expect(linkPresses('b', id => has.has(id))).toBe(false);
  });
});
