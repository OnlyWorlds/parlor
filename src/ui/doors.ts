/**
 * The way in: sign in (the join page's own pattern, design sheet §3: Sign in to
 * join, Create an account), the PIN once, and which parlor to open.
 */

import { OwV2Client, type OwJoinPreview } from '@onlyworlds/sdk';
import { apiBase, session, signInLine, joinCodeIn, type AccountWorld } from '../parlor/session';
import { h, clear } from './dom';

const SITE = 'https://www.onlyworlds.com';

export async function previewOf(code: string): Promise<OwJoinPreview | null> {
  try {
    return await new OwV2Client({ baseUrl: apiBase() }).previewJoin(code);
  } catch {
    return null;
  }
}

export function signInView(root: HTMLElement, preview: OwJoinPreview | null, onIn: () => void, staleLink = false): void {
  const login = h('input', { id: 'login', type: 'text', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn entry', type: 'submit' }, 'Sign in');
  // No password box on the landing (sheet §3): the Entry button opens the form, until Sign in
  // with OnlyWorlds reaches the parlor's host (#490, #515).
  const entry = h('button', { class: 'btn entry', type: 'button', onclick: () => {
    form.hidden = false;
    entryRow.hidden = true;
    login.focus();
  } }, preview ? 'Sign in to join' : 'Sign in');
  const signup = () => h('a', { class: 'btn quiet', href: `${SITE}/signup`, target: '_blank', rel: 'noopener' }, 'Create an account');
  const entryRow = h('div', { class: 'btns' }, entry, signup());
  const form = h('form', {
    hidden: true,
    onsubmit: async (e: Event) => {
      e.preventDefault();
      submit.disabled = true;
      problem.hidden = true;
      try {
        await session.signIn(login.value, password.value);
        password.value = '';
        onIn();
      } catch (err) {
        problem.textContent = signInLine(err);
        problem.hidden = false;
        submit.disabled = false;
      }
    },
  },
    h('label', { for: 'login' }, 'Email or username'), login,
    h('label', { for: 'password' }, 'Password'), password,
    problem,
    h('div', { class: 'btns' }, submit, signup()),
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
  clear(root, h('div', { class: 'center' }, h('div', { class: 'land' }, h('div', { class: 'brand' }, 'PARLOR'), ...head, entryRow, form)));
  entry.focus();
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
