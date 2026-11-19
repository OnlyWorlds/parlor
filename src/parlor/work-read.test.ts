// How readWork reads who asked: the SDK's workOf once over every work item, never askerOf per item (askerOf builds the
// world's set of Characters on each call, so per item a read cost items times Characters: a big world's every tick).
// The SDK is wrapped only to count its calls; each call goes through to the SDK's own reader.
import { describe, expect, it, vi } from 'vitest';

const counts = vi.hoisted(() => ({ workOf: 0, askerOf: 0 }));
vi.mock('@onlyworlds/sdk', async importOriginal => {
  const sdk = await importOriginal<typeof import('@onlyworlds/sdk')>();
  return {
    ...sdk,
    workOf: (...a: Parameters<typeof sdk.workOf>) => { counts.workOf++; return sdk.workOf(...a); },
    askerOf: (...a: Parameters<typeof sdk.askerOf>) => { counts.askerOf++; return sdk.askerOf(...a); },
  };
});

import { readWork, ROOM_MARK, type El } from './shapes';

const WORLD = 'w0000000-0000-0000-0000-000000000001';

describe('readWork reads who asked once per read', () => {
  it('workOf once over every item, askerOf never; each item still names its asker', () => {
    const els: El[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `c-${i}`, type: 'character', name: `C${i}` } as El)),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `w-${i}`, type: 'relation', supertype: 'Work item', subtype: 'open', name: `W${i}`, [ROOM_MARK]: WORLD, x_packet_from: `c-${i}` } as El)),
    ];
    counts.workOf = 0;
    counts.askerOf = 0;
    const work = readWork(els, WORLD);
    expect(counts).toEqual({ workOf: 1, askerOf: 0 });
    expect(work.map(w => w.askedBy).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `c-${i}`).sort());
  });
});
