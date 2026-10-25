import { describe, expect, it } from 'vitest';
import { serialQueue } from './serial';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('serialQueue', () => {
  it('a slow first write still lands before a quick second one', async () => {
    const landed: string[] = [];
    const serial = serialQueue();
    await Promise.all([
      serial(async () => { await wait(40); landed.push('Build'); }),
      serial(async () => { await wait(1); landed.push('Showcase'); }),
    ]);
    expect(landed).toEqual(['Build', 'Showcase']);
  });

  it('a failed write does not stop the next', async () => {
    const serial = serialQueue();
    const first = serial(async () => { throw new Error('refused'); });
    const second = serial(async () => 'ok');
    await expect(first).rejects.toThrow('refused');
    await expect(second).resolves.toBe('ok');
  });
});
