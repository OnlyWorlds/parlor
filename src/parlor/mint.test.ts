// A world key's mint whose answer is lost, against keel's rules for world keys (since 2026-11-08): the
// row keeps a hash of the Idempotency-Key, GET .../keys/made?key= names the first row made under it (a
// revoked one too, `revoked` true) or one 404, a keel before it answers that GET 405, DELETE revokes by id.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'ow_a_' + 'm'.repeat(40);
vi.hoisted(() => {
  const m = new Map<string, string>();
  m.set('parlor.session.v1', JSON.stringify({ token: 'ow_a_' + 'm'.repeat(40), login: 'ada', keys: {} }));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
});

import { session } from './session';

const mint = (scope: 'read' | 'write' = 'write') => (session as unknown as { mint(w: string, s: string): Promise<string> }).mint('w9', scope);

let calls: string[];
let rows: Array<{ id: string; idem: string | null; live: boolean }>;

function keel(opts: { lose?: 'network' | 502 | 'no-key'; refuse?: boolean; made?: 'revoked' | 405 } = {}) {
  calls = [];
  rows = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const path = u.pathname.replace(/^\/api\/v2/, '');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (new Headers(init?.headers).get('Authorization') !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'invalid_credentials', message: 'x' } });
    if (method === 'POST' && path === '/account/worlds/w9/keys') {
      if (opts.refuse) return json(409, { error: { code: 'pin_required', message: 'x' } });
      const row = { id: `k${rows.length + 1}`, idem: new Headers(init?.headers).get('Idempotency-Key'), live: true };
      rows.push(row);
      if (opts.lose === 'network') throw new TypeError('network');
      if (opts.lose === 502) return json(502, { error: { code: 'bad_gateway', message: 'x' } });
      if (opts.lose === 'no-key') return json(201, { id: row.id, name: 'parlor', last4: 'zzzz', scope: 'write', revoked: false });
      return json(201, { id: row.id, name: 'parlor', last4: 'zzzz', scope: 'write', revoked: false, key: 'ow_w_' + 'z'.repeat(40) });
    }
    if (method === 'GET' && path === '/account/worlds/w9/keys/made') {
      if (opts.made === 405) return json(405, { detail: 'Method not allowed' });
      const row = rows.find(r => r.idem === u.searchParams.get('key'));
      if (!row) return json(404, { error: { code: 'not_found', message: 'x' } });
      return json(200, { id: row.id, name: 'parlor', last4: 'zzzz', scope: 'write', last_used_at: null, revoked: opts.made === 'revoked' || !row.live, kept: false });
    }
    const del = path.match(/^\/account\/worlds\/w9\/keys\/([^/]+)$/);
    if (method === 'DELETE' && del) {
      const row = rows.find(r => r.id === del[1]);
      if (!row) return json(404, { error: { code: 'not_found', message: 'x' } });
      row.live = false;
      return new Response(null, { status: 204 });
    }
    return json(500, { error: { code: 'server_error', message: 'x' } });
  }) as typeof fetch;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => keel());

describe('a world key mint', () => {
  it('goes under an Idempotency-Key and asks nothing more when its answer is in', async () => {
    expect(await mint()).toMatch(/^ow_w_/);
    expect(rows[0].idem).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toEqual(['POST /account/worlds/w9/keys']);
  });

  for (const lose of ['network', 502, 'no-key'] as const) {
    it(`whose answer is lost (${lose}) takes back the key it made, by the id keel names`, async () => {
      keel({ lose });
      await expect(mint()).rejects.toBeTruthy();
      expect(calls).toEqual(['POST /account/worlds/w9/keys', 'GET /account/worlds/w9/keys/made', 'DELETE /account/worlds/w9/keys/k1']);
      expect(rows.filter(r => r.live)).toEqual([]);
    });
  }

  it('refused (4xx) made nothing and asks nothing', async () => {
    keel({ refuse: true });
    await expect(mint()).rejects.toBeTruthy();
    expect(calls).toEqual(['POST /account/worlds/w9/keys']);
  });

  it('leaves a key keel shows revoked, and on a keel before the lookup (405) is no worse than before', async () => {
    keel({ lose: 502, made: 'revoked' });
    await expect(mint()).rejects.toBeTruthy();
    expect(calls).toEqual(['POST /account/worlds/w9/keys', 'GET /account/worlds/w9/keys/made']);
    keel({ lose: 502, made: 405 });
    await expect(mint()).rejects.toMatchObject({ status: 502 });
    expect(calls).toEqual(['POST /account/worlds/w9/keys', 'GET /account/worlds/w9/keys/made']);
    expect(rows.filter(r => r.live)).toHaveLength(1);
  });
});
