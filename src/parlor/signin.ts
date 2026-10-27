/**
 * Sign in with OnlyWorlds (the twin of Lantern's and the Council's). The SDK's two calls: `signInWithOnlyWorlds` sends the browser to onlyworlds.com with
 * a PKCE challenge, `completeSignIn` trades the code on `/signin/callback`. Where the person was
 * going (an invite, a room) is the parlor's own note, kept beside the SDK's record, so a refusal
 * gives it back too.
 */

import { OwV2Client, OwSignInError, detectKeyKind } from '@onlyworlds/sdk';
import { API_BASE, joinCodeIn, session, RESUME_KEY } from './session';

/** keel's registry (`GET /api/v2/auth/clients`) lists `parlor` with exactly this address. */
export const SIGN_IN_CLIENT_ID = 'parlor';
export const SIGN_IN_REDIRECT_URI = 'https://parlor.onlyworlds.com/signin/callback';
export const SIGN_IN_CALLBACK_PATH = '/signin/callback';
const SIGN_IN_ORIGIN = new URL(SIGN_IN_REDIRECT_URI).origin;
export const SIGN_IN_EXCHANGE_LIMIT_MS = 20_000;
/** Where the callback page goes while the exchange runs. */
export const SIGNING_IN_HASH = '#/signing-in';
const CLIENT_NAME = 'parlor';

/** Offered only on the registered origin (P1): anywhere else the return would land on another origin's storage. */
export function canSignInWithOnlyWorlds(origin: string = globalThis.location?.origin ?? ''): boolean {
  return origin === SIGN_IN_ORIGIN;
}

export function isSignInCallback(pathname: string = globalThis.location?.pathname ?? ''): boolean {
  return pathname.replace(/\/$/, '') === SIGN_IN_CALLBACK_PATH;
}

type RecordStore = { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };

/** The record lives in localStorage (P10): the round trip leaves the tab through another origin. */
function recordStore(): RecordStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: k => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: k => ls.removeItem(k) };
  } catch {
    return null;
  }
}

/** Where the person was going: an invite's code, a room's address. */
export interface Resume {
  join?: string;
  hash?: string;
}

/** Only what the parlor itself would write (P5): a join code, a room's address; anything else is dropped. */
export function resumeOf(raw: unknown): Resume {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as { join?: unknown; hash?: unknown };
  const out: Resume = {};
  const join = typeof r.join === 'string' ? joinCodeIn(r.join) : null;
  if (join && join === r.join) out.join = join;
  if (typeof r.hash === 'string' && /^#\/w\/[\w-]+$/.test(r.hash)) out.hash = r.hash;
  return out;
}

/** Read the note once and forget it. */
export function takeResume(): Resume {
  const store = recordStore();
  if (!store) return {};
  const raw = store.get(RESUME_KEY);
  store.remove(RESUME_KEY);
  if (!raw) return {};
  try {
    return resumeOf(JSON.parse(raw));
  } catch {
    return {};
  }
}

export const NEEDS_CONNECTION_LINE = 'Signing in needs a connection. Check yours and try again.';
export const NO_STORAGE_LINE = 'This browser keeps no storage for the parlor, so the sign-in could not come back here. Sign in with a password instead.';

/** Send the browser to onlyworlds.com. Throws, in the parlor's words, when it cannot leave. */
export async function beginOnlyWorldsSignIn(resume: Resume, navigate?: (url: string) => void): Promise<void> {
  if (globalThis.navigator?.onLine === false) throw new Error(NEEDS_CONNECTION_LINE);
  const storage = recordStore();
  if (!storage) throw new Error(NO_STORAGE_LINE);
  const note = resumeOf(resume);
  try {
    if (note.join || note.hash) storage.set(RESUME_KEY, JSON.stringify(note));
    else storage.remove(RESUME_KEY);
  } catch {
    throw new Error(NO_STORAGE_LINE);
  }
  await new OwV2Client({ baseUrl: API_BASE, client: CLIENT_NAME }).signInWithOnlyWorlds({
    clientId: SIGN_IN_CLIENT_ID,
    redirectUri: SIGN_IN_REDIRECT_URI,
    storage,
    ...(navigate ? { navigate } : {}),
  });
}

export type SignInOutcome =
  | { ok: true; token: string; account: { id: string; username: string } }
  | { ok: false; cancelled: boolean; error: unknown };

class NoStorage extends Error {}

/**
 * On `/signin/callback`, at module load, before any other request to onlyworlds.com (P2): the SDK
 * takes `code` and `state` out of the address before its first await, and this sets the address to
 * `/#/signing-in` before returning, so the router never reads the callback's own address.
 */
export function startSignInCallback(href: string = location.href, fetchImpl?: typeof fetch): Promise<SignInOutcome> {
  const cancelled = new URL(href).searchParams.get('error') === 'access_denied';
  const storage = recordStore();
  // The limit spans the whole exchange, its answer's body too (the sign-in gate's G12).
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SIGN_IN_EXCHANGE_LIMIT_MS);
  const limited: typeof fetch = (input, init) => (fetchImpl ?? fetch)(input, { ...init, signal: ctl.signal });
  const client = new OwV2Client({ baseUrl: API_BASE, client: CLIENT_NAME, fetch: limited });
  const pending = (storage
    ? client.completeSignIn({ clientId: SIGN_IN_CLIENT_ID, url: href, storage })
    : Promise.reject(new NoStorage('no storage'))).finally(() => clearTimeout(timer));
  try {
    history.replaceState(null, '', `/${SIGNING_IN_HASH}`);
  } catch { /* the address stays; the router still runs */ }
  return pending.then(
    (r): SignInOutcome => ({ ok: true, token: r.token, account: { id: r.account.id, username: r.account.username } }),
    (error: unknown): SignInOutcome => ({ ok: false, cancelled, error }),
  );
}

/** What to tell the person when the round trip did not sign them in. Never keel's text (P7). */
export function signInCallbackLine(outcome: { cancelled: boolean; error: unknown }): string {
  if (outcome.cancelled) return 'Sign in with OnlyWorlds was cancelled. Nothing changed.';
  const err = outcome.error;
  if (err instanceof NoStorage) return NO_STORAGE_LINE;
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'state_mismatch': return 'The parlor could not match that sign-in to one waiting here (another tab or browser may have started or ended it). Press Sign in with OnlyWorlds again.';
      case 'invalid_grant': return 'OnlyWorlds did not take that sign-in: it may have waited too long. Press Sign in with OnlyWorlds again.';
      case 'rate_limited': return 'Too many sign-ins in a short time. Wait a moment and try again.';
      case 'offline': return 'OnlyWorlds could not be reached, so the sign-in did not finish. Check your connection and try again.';
      default: break;
    }
  }
  return 'Signing in with OnlyWorlds did not work. Try again in a moment.';
}

export const NOT_KEPT_LINE = 'That sign-in did not give the parlor an account token, so nothing was kept. Try again, or sign in with a password.';

/** Where the return lands and what it says. */
export interface Landing {
  /** `#/` or a room's address. */
  hash: string;
  /** An invite to resume; a signed-in browser asks before it joins (P6). */
  join?: string;
  /** A refusal, said on the landing (P7). */
  problem?: string;
  /** Signed in by this return: the room it lands in names the account (the sign-in gate's G2). */
  signedIn?: boolean;
}

/**
 * After the exchange: the token's kind checked and the token kept before anything else (P4); a
 * return this browser did not start, while signed in, is silent (P8); a refusal comes back to the
 * landing with its sentence and the invite that waited (P7).
 */
export function applySignInOutcome(outcome: SignInOutcome, resume: Resume): Landing {
  if (outcome.ok) {
    if (detectKeyKind(outcome.token) !== 'account') return { hash: '#/', join: resume.join, problem: NOT_KEPT_LINE };
    session.adopt(outcome.token, outcome.account);
    return { hash: resume.hash ?? '#/', join: resume.join, signedIn: true };
  }
  // Signed in, the button was never offered: a return that did not sign in is not this browser's
  // to report (P8; a crafted Cancel too, the sign-in gate's G9).
  if (session.signedIn) return { hash: '#/' };
  if (!outcome.cancelled) console.warn('[sign-in] the return did not sign in:', outcome.error);
  return { hash: '#/', join: resume.join, problem: signInCallbackLine(outcome) };
}
