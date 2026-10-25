/**
 * The room page (design sheet §3, Seethe's v1 screens 3, 4, 5 and 10): the room
 * on the left, the work surface beside it; on a phone, one at a time. The
 * composer and the spec form are built once and never redrawn, so a feed
 * tick never eats what someone is typing; everything else redraws from the
 * room's elements on every tick.
 */

import { PHASES, type Switches } from '../parlor/shapes';
import { problemLine, type Room } from '../parlor/room';
import { h, clear, notice, hhmm, initial } from './dom';

export function roomView(root: HTMLElement, room: Room, onLeave: () => void): () => void {
  const top = h('header', { class: 'top' });
  const lines = h('div', { class: 'lines', 'aria-live': 'polite' });
  const roomHead = h('div');
  const nameCard = nameForm();
  const host = h('div');
  const work = h('div');
  let picks: string[] = [];
  let specOpen = false;
  let stickToEnd = true;

  // -------------------------------------------------- the composer (built once)
  const text = h('textarea', { rows: 1, 'aria-label': 'Write a line', placeholder: 'Write a line' });
  const sendBtn = h('button', { class: 'btn entry', type: 'submit' }, 'Send');
  const send = h('form', {
    class: 'send',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const t = text.value.trim();
      if (!t) return;
      sendBtn.disabled = true;
      try {
        await room.post(t);
        text.value = '';
        stickToEnd = true;
      } catch (err) {
        notice(problemLine(err, 'sending your line'), true);
      } finally {
        sendBtn.disabled = false;
        text.focus();
      }
    },
  }, text, sendBtn);
  text.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.requestSubmit(); }
  });
  text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`; });
  lines.addEventListener('scroll', () => { stickToEnd = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 24; });

  // -------------------------------------------------- my spec (built once)
  const specTitle = h('input', { id: 'spec-title', type: 'text', maxlength: 200 });
  const specText = h('textarea', { id: 'spec-text', class: 'field', rows: 6 });
  const specForm = h('form', {
    class: 'card',
    hidden: true,
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (!specTitle.value.trim()) return;
      try {
        await room.saveSpec(specTitle.value, specText.value);
        specOpen = false;
        specForm.hidden = true;
        draw();
      } catch (err) {
        notice(problemLine(err, 'saving your spec'), true);
      }
    },
  },
    h('label', { for: 'spec-title' }, 'What would you build? A tool, a feature, a modelling question or a world'), specTitle,
    h('label', { for: 'spec-text' }, 'Say more'), specText,
    h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'submit' }, 'Save your spec'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { specOpen = false; specForm.hidden = true; draw(); } }, 'Cancel')),
  );
  const mySpec = () => room.specs().find(s => s.by === room.meBy) ?? null;

  // -------------------------------------------------- the layout
  const roomPane = h('section', { class: 'pane', 'aria-label': 'Room' }, roomHead, nameCard, lines, room.canWrite ? send : null);
  const workPane = h('section', { class: 'pane off', 'aria-label': 'Work' }, host, work, specForm);
  const tabRoom = h('button', { type: 'button', 'aria-selected': 'true', onclick: () => phoneTab('room') }, 'Room');
  const tabWork = h('button', { type: 'button', 'aria-selected': 'false', onclick: () => phoneTab('work') }, 'Work');
  function phoneTab(which: 'room' | 'work') {
    roomPane.classList.toggle('off', which !== 'room');
    workPane.classList.toggle('off', which !== 'work');
    tabRoom.setAttribute('aria-selected', String(which === 'room'));
    tabWork.setAttribute('aria-selected', String(which === 'work'));
  }
  workPane.classList.remove('off');
  const mq = window.matchMedia('(max-width: 820px)');
  if (mq.matches) phoneTab('room');
  clear(root, h('div', { class: 'app' }, top, h('nav', { class: 'mtabs' }, tabRoom, tabWork), h('main', { class: 'main' }, roomPane, workPane)));

  // -------------------------------------------------- what redraws
  function draw(): void {
    drawTop();
    drawRoom();
    drawHost();
    drawWork();
  }

  function drawTop(): void {
    const s = room.sitting();
    const seats = room.seats();
    const hostName = seats.find(x => x.role === 'host')?.name;
    clear(top,
      h('div', { class: 'brand' }, 'PARLOR'),
      h('div', null, h('div', { class: 'wname' }, room.world.name),
        h('div', { class: 'wsub' }, [s ? s.phase : 'No sitting yet', hostName ? `host ${hostName}` : ''].filter(Boolean).join(' · '))),
      h('span', { class: 'chip' }, `You: ${room.role}`),
      h('div', { class: 'seats', 'aria-label': `${seats.length} seats` },
        seats.slice(0, 12).map(x => h('span', { class: x.ai ? 'bdg a' : 'bdg', title: `${x.name}, ${x.ai ? 'AI ' : ''}${x.role}` }, x.ai ? 'AI' : initial(x.name))),
        h('button', { class: 'btn quiet', type: 'button', onclick: onLeave }, 'Your parlors')),
    );
  }

  function drawRoom(): void {
    const all = room.sittings();
    const s = room.sitting();
    const earlier = s ? all.findIndex(x => x.id === s.id) : -1;
    clear(roomHead,
      h('div', { class: 'ph' }, s ? `Room · this sitting, from ${hhmm(s.at)}` : 'Room'),
      earlier > 0 || room.showSitting
        ? h('div', { class: 'sys' }, room.showSitting ? 'An earlier sitting. ' : `${earlier} earlier sitting${earlier === 1 ? '' : 's'}. `,
          h('button', { class: 'btn quiet', type: 'button', onclick: () => {
            room.showSitting = room.showSitting ? null : all[Math.max(0, earlier - 1)].id;
            stickToEnd = true;
            draw();
          } }, room.showSitting ? 'Back to now' : 'Show earlier'))
        : null,
    );
    if (!room.canWrite) {
      roomHead.append(h('p', { class: 'sys' }, room.role !== 'watcher' && room.me.scope === 'read'
        ? 'You can read this room. To write in it, your account needs a PIN: set one on onlyworlds.com under Account settings, then open the room again.'
        : 'You can read this room.'));
    }
    nameCard.hidden = !room.needsName();
    const ls = room.lines();
    clear(lines, ls.length ? ls.map(l => {
      const ai = room.isAi(l.by, l.el.changed_via);
      const name = room.name(l.by);
      const hidden = room.hidden.has(l.id);
      return h('div', { class: `line${ai ? ' ai' : ''}${hidden ? ' hidden' : ''}` },
        h('span', { class: ai ? 'bdg a' : 'bdg' }, ai ? 'AI' : initial(name)),
        h('div', null,
          h('div', { class: 'meta' }, h('span', { class: 'who' }, name), ai ? h('span', { class: 'chip' }, 'AI') : null,
            h('span', { class: 't' }, hhmm(l.at)),
            hidden ? h('span', { class: 't' }, 'Hidden from the room') : null,
            room.isHost ? h('button', { class: 'act', type: 'button', onclick: () => hide(l.id, !hidden) }, hidden ? 'Unhide' : 'Hide this line') : null),
          h('div', { class: 'txt' }, l.text)));
    }) : h('div', { class: 'sys' }, room.canWrite ? 'No lines yet. Say hello.' : 'No lines yet.'));
    if (stickToEnd) lines.scrollTop = lines.scrollHeight;
    if (room.feed.lastError) roomHead.append(h('p', { class: 'problem' }, problemLine(room.feed.lastError, 'following the room')));
  }

  function nameForm(): HTMLElement {
    const input = h('input', { id: 'my-name', type: 'text', maxlength: 80 });
    return h('form', {
      class: 'card',
      hidden: true,
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        try {
          await room.setMyName(input.value);
        } catch (err) {
          notice(problemLine(err, 'saving your name'), true);
        }
      },
    }, h('label', { for: 'my-name' }, 'What should the room call you? You choose it once; it is saved in this world as your own Character.'),
      h('div', { class: 'row' }, input, h('button', { class: 'btn entry', type: 'submit' }, 'Save')));
  }

  async function hide(id: string, on: boolean) {
    try {
      await room.hide('narrative', id, on);
      draw();
    } catch (err) {
      notice(problemLine(err, on ? 'hiding the line' : 'unhiding the line'), true);
    }
  }

  function drawHost(): void {
    if (!room.isHost) { clear(host); return; }
    const s = room.sitting();
    const reading = room.browsing;
    const start = h('button', { class: 'btn std', type: 'button', onclick: async () => {
      const when = new Date().toLocaleDateString([], { day: 'numeric', month: 'long' });
      try { await room.startSitting(`Sitting, ${when}`); } catch (err) { notice(problemLine(err, 'starting the sitting'), true); }
    } }, s ? 'Start a new sitting' : 'Start the first sitting');
    const sw = (which: keyof Switches, label: string) => s && h('button', {
      class: 'btn std', type: 'button', 'aria-pressed': String(s[which]),
      onclick: async () => { try { await room.setSwitch(which, !s[which]); } catch (err) { notice(problemLine(err, 'changing a switch'), true); } },
    }, `${label}: ${s[which] ? 'on' : 'off'}`);
    clear(host, h('div', { class: 'hostbar' },
      h('h3', null, 'Host'),
      s && reading ? h('div', { class: 'phases', 'aria-label': 'Phase' }, PHASES.map(p => h('span', { class: p.name === s.phase ? 'pp now' : 'pp' }, p.name))) : null,
      s && !reading ? h('div', { class: 'phases', role: 'group', 'aria-label': 'Phase' }, PHASES.map(p => h('button', {
        class: p.name === s.phase ? 'pp now' : 'pp', type: 'button', 'aria-pressed': String(p.name === s.phase),
        onclick: async () => { try { await room.setPhase(p.name); } catch (err) { notice(problemLine(err, 'moving the phase'), true); } },
      }, p.name))) : null,
      s && !reading ? h('div', { class: 'sw' }, sw('hearts', 'Hearts'), sw('specs', 'Specs shown'), sw('voting', 'Voting')) : null,
      h('div', { class: 'btns' }, start),
      h('div', { class: 'ph', style: 'margin-top:12px' }, `Seats · ${room.seats().length}`),
      h('ul', { class: 'seatlist' }, room.seats().map(x => h('li', null,
        h('span', { class: x.ai ? 'bdg a' : 'bdg' }, x.ai ? 'AI' : initial(x.name)), x.name, h('span', { class: 'r' }, x.ai ? `AI ${x.role}` : x.role)))),
    ));
  }

  function drawWork(): void {
    const s = room.sitting();
    const charter = room.charter();
    const specs = room.specs();
    const shown = s?.specs || room.isHost ? specs : specs.filter(x => x.by === room.meBy);
    const mine = mySpec();
    const hearts = room.hearts();
    const score = room.tally();
    // An earlier sitting is a record: read it, change nothing in it.
    const live = room.canWrite && !room.browsing;
    if (!live && specOpen) { specOpen = false; specForm.hidden = true; }
    const voting = !!s?.voting && !room.browsing;
    if (voting && !picks.length) picks = room.myVote()?.picks ?? [];

    const card = (spec: (typeof specs)[number]) => {
      const iHearted = hearts.some(x => x.by === room.meBy && x.target === spec.id);
      const pickAt = picks.indexOf(spec.id);
      return h('div', { class: spec.star ? 'card star' : 'card' },
        h('h3', null, spec.title || 'Untitled', spec.star ? ' ★' : ''),
        h('div', { class: 'm' }, `${room.name(spec.by)} · ♡ ${spec.hearts}${room.isHost && score.has(spec.id) ? ` · ${score.get(spec.id)} points` : ''}`),
        spec.text ? h('p', null, spec.text) : null,
        h('div', { class: 'btns' },
          live && s?.hearts ? h('button', { class: 'btn std', type: 'button', 'aria-pressed': String(iHearted), onclick: async () => {
            try { await room.toggleHeart(spec.id, spec.title); } catch (err) { notice(problemLine(err, 'leaving a heart'), true); }
          } }, iHearted ? '♥ Hearted' : '♡ Heart') : null,
          live && voting ? h('button', { class: 'btn std', type: 'button', 'aria-pressed': String(pickAt >= 0), onclick: () => {
            picks = pickAt >= 0 ? picks.filter(id => id !== spec.id) : [...picks, spec.id].slice(0, 3);
            draw();
          } }, pickAt >= 0 ? `Pick ${pickAt + 1}` : 'Pick') : null,
          room.isHost && !room.browsing ? h('button', { class: 'btn quiet', type: 'button', onclick: async () => {
            try { await room.star(spec.id); } catch (err) { notice(problemLine(err, 'choosing the winner'), true); }
          } }, spec.star ? 'The winner' : 'Make it the winner') : null,
        ));
    };

    clear(work,
      charter ? h('details', { class: 'card' }, h('summary', null, charter.name || 'House rules'), h('p', null, charter.text)) : null,
      !s ? h('div', { class: 'empty' }, h('h3', null, 'No sitting yet'), h('p', null, room.isHost ? 'Start the first sitting when people are here.' : 'The host has not started a sitting. The room is open: say hello.')) : null,
      s && !room.isHost ? h('div', { class: 'phases', 'aria-label': 'Phase' }, PHASES.map(p => h('span', { class: p.name === s.phase ? 'pp now' : 'pp' }, p.name))) : null,
      s && !room.isHost ? h('div', { class: 'sw' },
        h('span', { class: s.hearts ? 'chip on' : 'chip' }, `Hearts: ${s.hearts ? 'on' : 'off'}`),
        h('span', { class: s.specs ? 'chip on' : 'chip' }, `Specs shown: ${s.specs ? 'on' : 'off'}`),
        h('span', { class: s.voting ? 'chip on' : 'chip' }, `Voting: ${s.voting ? 'open' : 'closed'}`)) : null,
      voting && live ? h('div', { class: 'hostbar' },
        h('div', null, picks.length ? `Your picks: ${picks.map((id, i) => `${i + 1}. ${specs.find(x => x.id === id)?.title ?? '?'}`).join('  ')}` : 'Pick up to three, in order.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'button', disabled: !picks.length, onclick: async () => {
          try { await room.vote(picks); notice('Your vote is in. You can change it while voting is open.'); } catch (err) { notice(problemLine(err, 'sending your vote'), true); }
        } }, room.myVote() ? 'Change my vote' : 'Send my vote'))) : null,
      h('div', { class: 'ph' }, `Specs · ${shown.length}${!s?.specs && !room.isHost && specs.length > shown.length ? ' shown (the others show when the host turns specs on)' : ''}`),
      shown.map(card),
      live && !specOpen ? h('button', { class: 'btn entry', type: 'button', onclick: () => {
        specOpen = true;
        specTitle.value = mine?.title ?? '';
        specText.value = mine?.text ?? '';
        specForm.hidden = false;
        draw();
        specTitle.focus();
      } }, mine ? 'Edit your spec' : 'Add your spec') : null,
    );
  }

  const off = room.feed.subscribe(draw);
  draw();
  return () => { off(); room.close(); };
}
