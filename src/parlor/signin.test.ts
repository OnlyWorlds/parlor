import { describe, expect, it, vi } from 'vitest';
import { OwSignInError } from '@onlyworlds/sdk';
import sourcePage from '../../index.html?raw';
import viteConfig from '../../vite.config.ts?raw';

// A localStorage before the session module reads it, so the storage paths run (the S474 gate's G7).
const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
  return m;
});

import { applySignInOutcome, canSignInWithOnlyWorlds, isSignInCallback, resumeOf, signInCallbackLine, takeResume, NOT_KEPT_LINE } from './signin';
import { session, SIGN_IN_RECORD_KEY, RESUME_KEY } from './session';

const kept = () => JSON.parse(store.get('parlor.session.v1') ?? 'null');

const TOKEN = 'ow_a_' + 'h'.repeat(40);
const OTHER = 'ow_a_' + 'k'.repeat(40);
const CODE = 'ow_j_' + 'a'.repeat(24);

describe('P1, the registered origin only', () => {
  it('offers the button on parlor.onlyworlds.com and nowhere else', () => {
    expect(canSignInWithOnlyWorlds('https://parlor.onlyworlds.com')).toBe(true);
    for (const o of ['https://preview.parlor-eey.pages.dev', 'https://55708186.parlor-eey.pages.dev', 'http://localhost:30335', 'http://parlor.onlyworlds.com', 'https://parlor.onlyworlds.com.evil.example', '']) {
      expect(canSignInWithOnlyWorlds(o)).toBe(false);
    }
  });
  it('knows the callback, with or without its trailing slash', () => {
    expect(isSignInCallback('/signin/callback')).toBe(true);
    expect(isSignInCallback('/signin/callback/')).toBe(true);
    expect(isSignInCallback('/signin/callbacks')).toBe(false);
    expect(isSignInCallback('/')).toBe(false);
  });
});

describe('P3, every URL in the shell is absolute', () => {
  const relative = (html: string) => [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(\/|https?:)/.test(u));
  it('in the source page and the build config', () => {
    expect(relative(sourcePage)).toEqual([]);
    expect(viteConfig).toMatch(/base:\s*'\/'/);
  });
  // The built page, when there is one (after `npm run build`).
  const built = Object.values(import.meta.glob('/dist/index.html', { query: '?raw', import: 'default', eager: true })) as string[];
  it.runIf(built.length > 0)('in the built page', () => {
    expect(relative(built[0])).toEqual([]);
  });
});

describe('P5, only what the parlor would write comes back', () => {
  it('keeps a join code and a room address', () => {
    expect(resumeOf({ join: CODE, hash: '#/w/0f0f-aa' })).toEqual({ join: CODE, hash: '#/w/0f0f-aa' });
  });
  it('drops anything else', () => {
    expect(resumeOf(null)).toEqual({});
    expect(resumeOf('x')).toEqual({});
    expect(resumeOf({ join: `see ${CODE}`, hash: 'https://evil.example/#/w/a' })).toEqual({});
    expect(resumeOf({ hash: '#/w/a/../../x' })).toEqual({});
    expect(resumeOf({ hash: '#/join/x' })).toEqual({});
    expect(resumeOf({ join: 42 })).toEqual({});
  });
});

describe('P7, a refusal in the parlor\'s words', () => {
  it('a line for Cancel and each reason, never keel\'s text', () => {
    expect(signInCallbackLine({ cancelled: true, error: null })).toBe('Sign in with OnlyWorlds was cancelled. Nothing changed.');
    const lines = (['state_mismatch', 'invalid_grant', 'rate_limited', 'offline', 'failed'] as const)
      .map(r => signInCallbackLine({ cancelled: false, error: new OwSignInError(r, 'KEEL TEXT') }));
    expect(new Set(lines).size).toBe(5);
    for (const l of lines) expect(l).not.toContain('KEEL TEXT');
  });
});

describe('P4, the token kept; keys and the PIN only for the same account', () => {
  const plantKeys = () => {
    const s = kept();
    store.set('parlor.session.v1', JSON.stringify({ ...s, keys: { w: 'ow_k_x' }, readKeys: { r: 'ow_k_r' } }));
  };
  it('a sign-in as the same account keeps the keys and the PIN; another or an unknown one starts clean, in storage', async () => {
    session.signOut();
    session.adopt(TOKEN, { id: 'acc-1', username: 'wren' });
    session.setPin('1234');
    plantKeys();
    // The session reads storage once per page: a fresh module is the next page.
    vi.resetModules();
    const { session: next } = await import('./session');
    next.adopt(OTHER, { id: 'acc-1', username: 'wren' });
    expect(kept()).toMatchObject({ token: OTHER, accountId: 'acc-1', pin: '1234', keys: { w: 'ow_k_x' }, readKeys: { r: 'ow_k_r' } });
    next.adopt(TOKEN, { id: 'acc-2', username: 'bo' });
    expect(kept()).toEqual({ token: TOKEN, login: 'bo', accountId: 'acc-2', keys: {} });
    next.setPin('5678');
    next.adopt(TOKEN, { username: 'bo' });
    expect(kept()).toEqual({ token: TOKEN, login: 'bo', keys: {} });
    next.signOut();
    expect(store.has('parlor.session.v1')).toBe(false);
  });
  it('every sign-in and the sign-out spend the round trip\'s record and note', () => {
    for (const act of [() => session.adopt(TOKEN, { id: 'a', username: 'w' }), () => session.signOut()]) {
      store.set(SIGN_IN_RECORD_KEY, '{}');
      store.set(RESUME_KEY, JSON.stringify({ join: CODE }));
      act();
      expect(store.has(SIGN_IN_RECORD_KEY) || store.has(RESUME_KEY)).toBe(false);
    }
  });
  it('the note is read once, filtered', () => {
    store.set(RESUME_KEY, JSON.stringify({ join: CODE, hash: 'javascript:x' }));
    expect(takeResume()).toEqual({ join: CODE });
    expect(takeResume()).toEqual({});
  });
  it('a return that signed in lands where the person was going, named as signed in', () => {
    session.signOut();
    const l = applySignInOutcome({ ok: true, token: TOKEN, account: { id: 'acc-1', username: 'wren' } }, { join: CODE, hash: '#/w/abc' });
    expect(l).toEqual({ hash: '#/w/abc', join: CODE, signedIn: true });
    expect(session.signedIn).toBe(true);
    expect(session.login).toBe('wren');
    expect(kept()?.token).toBe(TOKEN);
    session.signOut();
  });
  it('a token of another kind is not kept', () => {
    session.signOut();
    const l = applySignInOutcome({ ok: true, token: 'ow_k_' + 'x'.repeat(40), account: { id: 'a', username: 'w' } }, { join: CODE });
    expect(l.problem).toBe(NOT_KEPT_LINE);
    expect(l.join).toBe(CODE);
    expect(session.signedIn).toBe(false);
  });
});

describe('P7 and P8, refusals', () => {
  it('signed out, a refusal is said and the invite waits', () => {
    session.signOut();
    const l = applySignInOutcome({ ok: false, cancelled: true, error: new OwSignInError('failed', 'x') }, { join: CODE });
    expect(l).toEqual({ hash: '#/', join: CODE, problem: 'Sign in with OnlyWorlds was cancelled. Nothing changed.' });
  });
  it('signed in, a return that did not sign in is silent, a crafted Cancel too', () => {
    session.adopt(TOKEN, { id: 'acc-1', username: 'wren' });
    for (const o of [{ cancelled: false, error: new OwSignInError('state_mismatch', 'x') }, { cancelled: true, error: new OwSignInError('state_mismatch', 'x') }]) {
      expect(applySignInOutcome({ ok: false, ...o }, { join: CODE })).toEqual({ hash: '#/' });
    }
    expect(session.signedIn).toBe(true);
    session.signOut();
  });
});
