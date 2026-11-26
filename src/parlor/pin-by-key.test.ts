// The saved PIN travels only with a key that can use one: a guest's read key and an account's
// read key (no PIN yet when it was minted) never carry it, a write key does. Played on the SDK's
// own request path: the header keel would see on a room open's /me/.
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const READ = 'ow_r_' + 'r'.repeat(40);
const GUEST = 'ow_r_' + 'g'.repeat(40);
const WRITE = 'ow_w_' + 'w'.repeat(40);
vi.hoisted(() => {
  const m = new Map<string, string>();
  m.set('parlor.session.v1', JSON.stringify({
    token: 'ow_a_' + 'm'.repeat(40), login: 'ada', pin: '1234',
    keys: { wg: 'ow_r_' + 'g'.repeat(40), ww: 'ow_w_' + 'w'.repeat(40) },
    readKeys: { wr: 'ow_r_' + 'r'.repeat(40) },
  }));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
});

import { session } from './session';
import type { OwAccountWorld } from '@onlyworlds/sdk';

let sent: Array<{ key: string | null; pin: string | null }>;
beforeEach(() => {
  sent = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    sent.push({ key: h.get('API-Key'), pin: h.get('API-Pin') });
    return new Response(JSON.stringify({ world: { id: 'w' }, member: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

const world = (id: string, guest = false) => ({ id, role: 'collaborator', member_role: guest ? 'guest' : 'member' }) as unknown as OwAccountWorld;

describe('the PIN by the key it rides with', () => {
  it("a guest's read key opens without the PIN", async () => {
    await (await session.worldClient(world('wg', true))).me();
    expect(sent).toEqual([{ key: GUEST, pin: null }]);
  });
  it('a read key minted before the account had a PIN opens without it', async () => {
    // keys has no wr, so worldClient mints: answer the mint with pin_required, then it takes the kept read key.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (String(input).includes('/account/worlds/wr/keys')) return new Response(JSON.stringify({ error: { code: 'pin_required', message: 'x' } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      sent.push({ key: h.get('API-Key'), pin: h.get('API-Pin') });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    await (await session.worldClient(world('wr'))).me();
    expect(sent).toEqual([{ key: READ, pin: null }]);
  });
  it('a write key still carries it', async () => {
    await (await session.worldClient(world('ww'))).me();
    expect(sent).toEqual([{ key: WRITE, pin: '1234' }]);
  });
});
