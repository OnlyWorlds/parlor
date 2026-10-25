/**
 * Who is here, on their own credential (design sheet §4): no shared key and no
 * server in between. A person signs in with their OnlyWorlds email and
 * password through the SDK (until keel's "Sign in with OnlyWorlds" handoff,
 * #515, replaces the fields); that mints this browser an account token, and
 * the token mints a world key per parlor world, bound to the person's own
 * seat. The password is never kept; the token, the keys and the PIN are, in
 * this browser only, as Atlas keeps them.
 */

import { OwV2Client, OwSignInError, OwApiError, type OwAccountWorld } from '@onlyworlds/sdk';

export const API_BASE = 'https://www.onlyworlds.com/api/v2';

/**
 * A dev run may point at staging: `?api=<base>` once, kept for the tab. Never in
 * a production build: there a crafted link would send a person's password to
 * whatever host it named.
 */
export function apiBase(): string {
  if (!import.meta.env.DEV) return API_BASE;
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q && /^https:\/\/[\w.-]+(:\d+)?\/api\/v2\/?$/.test(q)) sessionStorage.setItem('parlor.api', q.replace(/\/$/, ''));
    return sessionStorage.getItem('parlor.api') ?? API_BASE;
  } catch {
    return API_BASE;
  }
}

/** One world on the account, as GET /account/worlds lists it (SDK 4.45's listAccountWorlds, Kael h66 #9737). */
export type AccountWorld = OwAccountWorld;

interface Stored {
  token: string;
  login: string;
  pin?: string;
  /** A write key per world (a guest's is a read key). */
  keys: Record<string, string>;
  /** A read key per world for an account with no PIN yet: it reads until a write key can be had. */
  readKeys?: Record<string, string>;
}

const STORE = 'parlor.session.v1';

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return typeof s.token === 'string' && s.token ? { ...s, keys: s.keys ?? {} } : null;
  } catch {
    return null;
  }
}

function save(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch { /* a private window: the session lasts the tab */ }
}

export function tokenName(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'a browser';
  return `Parlor in ${browser}`;
}

/** What to tell the person for each refusal. Never keel's raw text. */
export function signInLine(err: unknown): string {
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'invalid_credentials': return 'That email or username and password did not match an OnlyWorlds account.';
      case 'email_unverified': return 'Confirm your email first: the link is in the mail onlyworlds.com sent you.';
      case 'rate_limited': return 'Too many attempts. Wait a moment and try again.';
      case 'offline': return 'OnlyWorlds could not be reached. Check your connection and try again.';
      default: return 'Signing in did not work. Try again in a moment.';
    }
  }
  return 'Signing in did not work. Try again in a moment.';
}

/** keel's join code (`ow_j_` + urlsafe characters), found in a pasted link or code. */
export function joinCodeIn(text: string): string | null {
  const m = /ow_j_[\w-]{16,128}/.exec(text);
  return m ? m[0] : null;
}

class Session {
  private s: Stored | null = load();

  get signedIn(): boolean {
    return !!this.s;
  }

  get login(): string {
    return this.s?.login ?? '';
  }

  get pin(): string {
    return this.s?.pin ?? '';
  }

  async signIn(login: string, password: string): Promise<void> {
    const id = login.trim();
    const client = new OwV2Client({ baseUrl: apiBase() });
    const signed = await client.signInWithPassword({
      ...(id.includes('@') ? { email: id } : { username: id }),
      password,
      tokenName: tokenName(),
    });
    this.s = { token: signed.token, login: id, keys: {} };
    save(this.s);
  }

  setPin(pin: string): void {
    if (!this.s) return;
    this.s.pin = pin.trim();
    save(this.s);
  }

  signOut(): void {
    this.s = null;
    save(null);
  }

  private account(): OwV2Client {
    if (!this.s) throw new Error('not signed in');
    return new OwV2Client({ apiKey: this.s.token, baseUrl: apiBase() });
  }

  /** An account call; a token keel no longer knows signs this browser out. */
  private async withAccount<T>(call: (c: OwV2Client) => Promise<T>): Promise<T> {
    try {
      return await call(this.account());
    } catch (err) {
      if (err instanceof OwApiError && err.status === 401) this.signOut();
      throw err;
    }
  }

  /** Every world on the account: owned first, then the ones joined. */
  async worlds(): Promise<AccountWorld[]> {
    return this.withAccount(c => c.listAccountWorlds());
  }

  /** Accept an invite link's code as this account: the person's own seat in that world. */
  async join(code: string): Promise<{ worldId: string; worldName: string }> {
    try {
      const m = await this.account().acceptJoin(code);
      return { worldId: m.world_id, worldName: m.world_name };
    } catch (err) {
      if (err instanceof OwApiError && err.isAlreadyMember) {
        const preview = await new OwV2Client({ baseUrl: apiBase() }).previewJoin(code).catch(() => null);
        const name = preview?.world.name;
        const row = name ? (await this.worlds()).find(w => w.name === name) : undefined;
        if (row) return { worldId: row.id, worldName: row.name };
      }
      throw err;
    }
  }

  /**
   * A client on this person's own seat in a world: a key minted once for this
   * browser and kept. A guest gets a read key; everyone else a write key, which
   * writes with the account's PIN.
   */
  async worldClient(world: AccountWorld): Promise<OwV2Client> {
    if (!this.s) throw new Error('not signed in');
    let key = this.s.keys[world.id];
    if (!key) {
      const guest = world.role === 'collaborator' && world.member_role === 'guest';
      try {
        key = await this.mint(world.id, guest ? 'read' : 'write');
        this.s.keys[world.id] = key;
        delete this.s.readKeys?.[world.id];
      } catch (err) {
        // An account with no PIN cannot hold a write key (409 pin_required): it
        // reads with a read key, and the next open asks for a write key again.
        if (!(err instanceof OwApiError && err.isPinRequired)) throw err;
        this.s.readKeys ??= {};
        key = this.s.readKeys[world.id] ?? await this.mint(world.id, 'read');
        this.s.readKeys[world.id] = key;
      }
      save(this.s);
    }
    // 'parlor' on every write (keel #520's changed_client), so another tool can say where a line came from.
    return new OwV2Client({ apiKey: key, apiPin: this.s.pin || undefined, baseUrl: apiBase(), client: 'parlor' });
  }

  private async mint(worldId: string, scope: 'read' | 'write'): Promise<string> {
    const minted = await this.withAccount(c => c.mintWorldKey(worldId, { scope, name: tokenName() }));
    if (!minted?.key) throw new Error('no key in the answer');
    return minted.key;
  }

  /** A key that stopped working (revoked, or the seat removed): forget it so the next open mints anew. */
  forgetKey(worldId: string): void {
    if (!this.s) return;
    delete this.s.keys[worldId];
    delete this.s.readKeys?.[worldId];
    save(this.s);
  }
}

export const session = new Session();
