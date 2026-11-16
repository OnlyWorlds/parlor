import { describe, expect, it } from 'vitest';
import { OwApiError, parseErrorEnvelope } from '@onlyworlds/sdk';
import { isHostBlocked, isHostRefusal } from './host';
import { problemLine } from './room';
import { fileProblem } from './files';

// The web host in front of OnlyWorlds answers some writes 403 with its own HTML page, before the API
// sees them; the SDK reads that answer as an OwApiError with no code (and `isHostBlocked` for its
// page titled "Blocked").
const page = (title: string) => `<!DOCTYPE html><html><head><title>${title}</title></head><body>Sorry, you have been blocked</body></html>`;
const blocked = parseErrorEnvelope(403, page('Blocked'));
const otherPage = parseErrorEnvelope(403, page('Access denied'));
const keel403 = parseErrorEnvelope(403, { error: { type: 'permission_error', code: 'permission_denied', message: 'raw keel text' } });

describe("the web host's refusal", () => {
  it('is a 403 with no code from the API; the Blocked page is the narrow case', () => {
    expect(isHostRefusal(blocked)).toBe(true);
    expect(isHostBlocked(blocked)).toBe(true);
    expect(isHostRefusal(otherPage)).toBe(true);
    expect(isHostBlocked(otherPage)).toBe(false);
    expect(isHostRefusal(keel403)).toBe(false);
    expect(isHostRefusal(new OwApiError(401, null, 'x', null, null))).toBe(false);
  });

  it("is said as the host's, never the seat, in a line or a report", () => {
    expect(problemLine(blocked, 'sending your line')).toBe(
      'The web host in front of OnlyWorlds refused this before it reached OnlyWorlds (sending your line). A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, or in a code block that names its language. Nothing was written.',
    );
    expect(problemLine(otherPage, 'handing in your report')).toBe(
      'The web host in front of OnlyWorlds refused this before it reached OnlyWorlds (handing in your report). Nothing was written.',
    );
    // The API's own 403 keeps its reading.
    expect(problemLine(keel403, 'sending your line')).toBe('Your seat in this world cannot do that (sending your line).');
  });

  it('a file the host refuses: said as the host, Try again offered; the API 403 keeps the seat line', () => {
    expect(fileProblem(blocked, 'notes.txt')).toEqual({
      line: 'The web host in front of OnlyWorlds refused notes.txt before it reached OnlyWorlds. A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, or in a code block that names its language. Nothing was added.',
      retry: true,
    });
    expect(fileProblem(keel403, 'notes.txt')).toEqual({ line: 'notes.txt was not added: your seat cannot add a file to that line.', retry: false });
  });
});
