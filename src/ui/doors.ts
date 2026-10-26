/**
 * The way in: sign in (the join page's own pattern, design sheet §3: Sign in to
 * join, Create an account), the PIN once, and which parlor to open.
 */

import { OwV2Client, type OwJoinPreview } from '@onlyworlds/sdk';
import { apiBase, session, signInLine, joinCodeIn, type AccountWorld } from '../parlor/session';
import { beginOnlyWorldsSignIn, canSignInWithOnlyWorlds, NEEDS_CONNECTION_LINE, NO_STORAGE_LINE, type Resume } from '../parlor/signin';
import { h, clear } from './dom';

const SITE = 'https://www.onlyworlds.com';

export async function previewOf(code: string): Promise<OwJoinPreview | null> {
  try {
    return await new OwV2Client({ baseUrl: apiBase() }).previewJoin(code);
  } catch {
    return null;
  }
}

export interface SignInOptions {
  /** Where the person was going, carried through Sign in with OnlyWorlds' round trip. */
  resume: Resume;
  /** A refusal from the round trip, said on the landing (contract P7). */
  problem?: string;
  /** Open on the password form ("Use another account"). */
  openForm?: boolean;
}

export function signInView(root: HTMLElement, preview: OwJoinPreview | null, onIn: () => void, staleLink = false, opts: SignInOptions = { resume: {} }): void {
  const withOnlyWorlds = canSignInWithOnlyWorlds();
  const login = h('input', { id: 'login', type: 'text', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: !opts.problem }, opts.problem ?? '');
  // One Entry per screen: on parlor.onlyworlds.com that is Sign in with OnlyWorlds, and the form's
  // Sign in steps down beside it.
  const submit = h('button', { class: withOnlyWorlds && !opts.openForm ? 'btn std' : 'btn entry', type: 'submit' }, 'Sign in');
  const signup = () => h('a', { class: 'btn quiet', href: `${SITE}/signup`, target: '_blank', rel: 'noopener' }, 'Create an account');
  const say = (line: string) => {
    problem.textContent = line;
    problem.hidden = false;
  };
  const openForm = () => {
    form.hidden = false;
    if (withOnlyWorlds) toForm.hidden = true;
    else entryRow.hidden = true;
    login.focus();
  };
  // Sign in with OnlyWorlds (#515): only on the registered origin (contract P1).
  const ow = h('button', { class: 'btn entry', type: 'button', 'data-action': 'signin-onlyworlds', onclick: async () => {
    ow.disabled = true;
    submit.disabled = true;
    problem.hidden = true;
    try {
      await beginOnlyWorldsSignIn(opts.resume);
    } catch (err) {
      // Only the parlor's own sentences; anything else (the SDK's, the browser's) gets a plain one (the code gate's C10).
      const own = err instanceof Error && (err.message === NEEDS_CONNECTION_LINE || err.message === NO_STORAGE_LINE);
      say(own ? (err as Error).message : 'Signing in with OnlyWorlds did not start. Try again in a moment.');
      ow.disabled = false;
      submit.disabled = false;
    }
  } }, preview ? 'Sign in to join' : 'Sign in with OnlyWorlds');
  // No password box on the landing (sheet §3): off the registered origin the Entry button opens the form.
  const entry = withOnlyWorlds ? ow : h('button', { class: 'btn entry', type: 'button', onclick: openForm }, preview ? 'Sign in to join' : 'Sign in');
  const toForm = h('button', { class: 'btn quiet', type: 'button', onclick: openForm }, 'Sign in with a password');
  const entryRow = h('div', { class: 'btns' }, entry, ...(withOnlyWorlds ? [] : [signup()]));
  const owNote = withOnlyWorlds
    ? [h('p', { class: 'sys' }, 'It uses the account signed in on onlyworlds.com in this browser.'), h('div', { class: 'btns' }, toForm, signup())]
    : [];
  const form = h('form', {
    hidden: true,
    onsubmit: async (e: Event) => {
      e.preventDefault();
      submit.disabled = true;
      ow.disabled = true;
      problem.hidden = true;
      try {
        await session.signIn(login.value, password.value);
        password.value = '';
        onIn();
      } catch (err) {
        say(signInLine(err));
        submit.disabled = false;
        ow.disabled = false;
      }
    },
  },
    h('label', { for: 'login' }, 'Email or username'), login,
    h('label', { for: 'password' }, 'Password'), password,
    h('div', { class: 'btns' }, submit, ...(withOnlyWorlds && !opts.openForm ? [] : [signup()])),
  );
  const head = preview
    ? [
      h('h1', null, `Join ${preview.world.name}`),
      h('p', null, preview.invited_by ? `${preview.invited_by} invited you to this world's parlor.` : "You are invited to this world's parlor."),
      // The world's public_read rides the preview once keel's #422 line lands (sheet §5).
      h('p', null, (preview.world as { public_read?: unknown }).public_read === true
        ? `Your lines are saved in ${preview.world.name} as messages. It is a public world: anyone can read them.`
        : `Your lines are saved in ${preview.world.name} as messages. Its members and their AIs can read them.`),
    ]
    : [
      h('h1', null, 'The parlor'),
      staleLink
        ? h('p', null, 'This invite link did not open: it may be used or out of date. If you joined with it before, sign in and your parlor is there. Otherwise ask the host for a new link.')
        : h('p', null, 'A room on a world, where people and their AI meet, talk, and build. Sign in with your OnlyWorlds account.'),
    ];
  clear(root, h('div', { class: 'center' }, h('div', { class: 'land' }, h('div', { class: 'brand' }, 'PARLOR'), ...head, problem, entryRow, ...owNote, form)));
  if (opts.openForm) {
    // "Use another account": the button would bring back the account just declined (the gate's G8).
    entryRow.hidden = true;
    for (const el of owNote) el.hidden = true;
    openForm();
  } else {
    entry.focus();
  }
}

/**
 * An invite a signed-in browser meets (contract P6): a person's invite is spent by its first join,
 * and the account may be the one the browser chose, so the join is asked, naming who.
 */
export function confirmJoinView(root: HTMLElement, preview: OwJoinPreview, onJoin: () => void, onOther: () => void, onNotNow: () => void): void {
  // keel may name no username (the sign-in gate's G4): then the sentence names the door instead.
  const who = session.login;
  const world = preview.world.name;
  // One press each: the buttons go inert on the first (the code gate's C8).
  const once = (act: () => void) => () => {
    for (const b of buttons) b.disabled = true;
    act();
  };
  const join = h('button', { class: 'btn entry', type: 'button', onclick: once(onJoin) }, who ? `Join ${world} as ${who}` : `Join ${world}`);
  const buttons = [
    join,
    h('button', { class: 'btn quiet', type: 'button', onclick: once(onOther) }, 'Use another account'),
    h('button', { class: 'btn quiet', type: 'button', onclick: once(onNotNow) }, 'Not now'),
  ];
  clear(root, h('div', { class: 'center' }, h('div', { class: 'land' },
    h('div', { class: 'brand' }, 'PARLOR'),
    h('h1', null, `Join ${world}`),
    h('p', null, who
      ? `Signed in as ${who}. Joining spends this invite on that account.`
      : 'Signed in with the account on onlyworlds.com in this browser. Joining spends this invite on that account.'),
    h('div', { class: 'btns' }, ...buttons),
  )));
  join.focus();
}

export function worldsView(root: HTMLElement, onOpen: (w: AccountWorld) => void, onJoined: (worldId: string) => void): void {
  const list = h('ul', { class: 'worlds' }, h('li', { class: 'sys' }, 'Reading your worlds…'));
  const pin = h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', value: session.pin });
  const pinNote = h('p', { class: 'sys' }, session.pin ? 'Your PIN is kept in this browser.' : 'Writing in a world needs your account PIN, once.');
  const link = h('input', { id: 'invite', type: 'text', placeholder: 'https://www.onlyworlds.com/join#…' });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });

  const savePin = () => {
    session.setPin(pin.value);
    pinNote.textContent = pin.value ? 'Your PIN is kept in this browser.' : 'Writing in a world needs your account PIN, once.';
  };

  const joinForm = h('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault();
      problem.hidden = true;
      const code = joinCodeIn(link.value);
      if (!code) {
        problem.textContent = 'That does not look like an invite link. Paste the whole link the host sent.';
        problem.hidden = false;
        return;
      }
      try {
        const joined = await session.join(code);
        onJoined(joined.worldId);
      } catch {
        problem.textContent = 'That invite link did not work. It may be used up or out of date: ask the host for a new one.';
        problem.hidden = false;
      }
    },
  }, h('label', { for: 'invite' }, 'Join with an invite link'), h('div', { class: 'row' }, link, h('button', { class: 'btn std', type: 'submit' }, 'Join')));

  clear(root, h('div', { class: 'center' }, h('div', { class: 'land' },
    h('div', { class: 'brand' }, 'PARLOR'),
    h('h1', null, 'Your parlors'),
    h('p', null, `Signed in${session.login && !session.login.includes('@') ? ` as ${session.login}` : ''}. Every world you can enter has a room.`),
    list,
    joinForm,
    problem,
    h('label', { for: 'pin' }, 'Your PIN'),
    h('div', { class: 'row' }, pin, h('button', { class: 'btn std', type: 'button', onclick: savePin }, 'Keep')),
    pinNote,
    h('div', { class: 'btns' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => { session.signOut(); location.hash = ''; location.reload(); } }, 'Sign out')),
  )));

  session.worlds().then(worlds => {
    if (!worlds.length) {
      clear(list, h('li', { class: 'sys' }, 'No worlds yet. Join one with an invite link below.'));
      return;
    }
    clear(list, worlds.map(w => h('li', null, h('button', { type: 'button', onclick: () => { savePin(); onOpen(w); } },
      h('div', null, w.name),
      h('div', { class: 'm' }, w.role === 'owner' ? 'Yours: you host' : roleWords(w.member_role)),
    ))));
  }).catch(() => clear(list, h('li', { class: 'problem' }, 'Your worlds could not be read. Sign out and in again.')));
}

function roleWords(r: AccountWorld['member_role']): string {
  switch (r) {
    case 'co_builder': return 'You co-host';
    case 'contributor': return 'You are a member';
    case 'guest': return 'You can read';
    default: return 'You are a member';
  }
}
