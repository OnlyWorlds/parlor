/**
 * The room page (design sheet §3, Seethe's v1 screens 3, 4, 5, 7 and 10): the
 * room on the left, the work surface beside it (Specs and the Board as tabs);
 * on a phone, one at a time. The composer, the forms and the tabs are built
 * once and never redrawn, so a feed tick never eats what someone is typing or
 * pressing; the rest redraws from the room's elements.
 */

import { PHASES, KINDS, BOARD_COLOURS, type Switches, type Kind, type BoardColour } from '../parlor/shapes';
import { problemLine, type Room } from '../parlor/room';
import { doorLine } from '../parlor/roster';
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
  let boardOpen = false;
  let workTab: 'specs' | 'board' = 'specs';
  let replyTo: { id: string; title: string } | null = null;
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
        await room.post(t, replyTo?.id ?? null);
        text.value = '';
        replyTo = null;
        drawReply();
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

  // Answering a board entry: the composer says so until the line is sent or the answer dropped.
  const replyBar = h('div', { class: 'reply', hidden: true });
  function drawReply(): void {
    replyBar.hidden = !replyTo;
    if (!replyTo) { clear(replyBar); return; }
    clear(replyBar, h('span', null, `Answering: ${replyTo.title}`),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { replyTo = null; drawReply(); } }, 'Not now'));
  }

  // -------------------------------------------------- my spec (built once)
  const specTitle = h('input', { id: 'spec-title', type: 'text', maxlength: 200 });
  const specText = h('textarea', { id: 'spec-text', class: 'field', rows: 6 });
  const kindRadios = KINDS.map(k => h('input', { type: 'radio', name: 'spec-kind', value: k, id: `kind-${k}`, required: true }));
  const kindPicked = (): Kind | null => (kindRadios.find(r => r.checked)?.value as Kind | undefined) ?? null;
  const specForm = h('form', {
    class: 'card',
    hidden: true,
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const kind = kindPicked();
      if (!specTitle.value.trim() || (!kind && !mySpec())) return;
      try {
        await room.saveSpec(specTitle.value, specText.value, kind);
        specOpen = false;
        draw();
      } catch (err) {
        notice(problemLine(err, 'saving your spec'), true);
      }
    },
  },
    h('label', { for: 'spec-title' }, 'What would you build? A tool, a feature, a modelling question or a world'), specTitle,
    h('fieldset', { class: 'picks' }, h('legend', null, 'It is'),
      KINDS.map((k, i) => h('label', { class: 'pick', for: `kind-${k}` }, kindRadios[i], k === 'Modelling' ? 'A modelling question' : `A ${k.toLowerCase()}`))),
    h('label', { for: 'spec-text' }, 'Say more'), specText,
    h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'submit' }, 'Save your spec'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { specOpen = false; draw(); } }, 'Cancel')),
  );
  const mySpec = () => room.specs().find(s => s.by === room.meBy) ?? null;

  // -------------------------------------------------- a board entry (built once)
  const COLOUR_WORD: Record<BoardColour, string> = { red: 'Red', orange: 'Orange', green: 'Green' };
  const COLOUR_HINT: Record<BoardColour, string> = { red: 'paused until they decide', orange: 'their input would help now', green: 'look whenever' };
  const boardTitle = h('input', { id: 'board-title', type: 'text', maxlength: 200 });
  const boardWho = h('select', { id: 'board-who' });
  const colourRadios = BOARD_COLOURS.map(c => h('input', { type: 'radio', name: 'board-colour', value: c, id: `colour-${c}`, required: true }));
  const boardText = h('textarea', { id: 'board-text', class: 'field', rows: 4 });
  const boardForm = h('form', {
    class: 'card',
    hidden: true,
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const colour = colourRadios.find(r => r.checked)?.value as BoardColour | undefined;
      if (!boardTitle.value.trim() || !colour) return;
      try {
        await room.raise(boardTitle.value, boardText.value, colour, boardWho.value || null);
        boardOpen = false;
        draw();
      } catch (err) {
        notice(problemLine(err, 'raising the entry'), true);
      }
    },
  },
    h('label', { for: 'board-title' }, 'What waits?'), boardTitle,
    h('label', { for: 'board-who' }, 'It waits on'), boardWho,
    h('fieldset', { class: 'picks' }, h('legend', null, 'How soon'),
      BOARD_COLOURS.map((c, i) => h('label', { class: 'pick', for: `colour-${c}` }, colourRadios[i], `${COLOUR_WORD[c]} · ${COLOUR_HINT[c]}`))),
    h('label', { for: 'board-text' }, 'What it needs to be decided'), boardText,
    h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'submit' }, 'Put it on the board'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { boardOpen = false; draw(); } }, 'Cancel')),
  );
  function openBoardForm(): void {
    boardOpen = true;
    boardTitle.value = '';
    boardText.value = '';
    for (const r of colourRadios) r.checked = false;
    clear(boardWho, h('option', { value: '' }, 'Anyone'), room.waitables().map(w => h('option', { value: w.character }, w.name)));
    draw();
    boardTitle.focus();
  }

  // -------------------------------------------------- the work tabs (built once)
  const tabSpecs = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => { workTab = 'specs'; draw(); } }, 'Specs');
  const tabBoard = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => { workTab = 'board'; draw(); } }, 'Board');
  const workTabs = h('div', { class: 'wtabs', role: 'tablist', 'aria-label': 'Work' }, tabSpecs, tabBoard);
  const board = h('div');
  // -------------------------------------------------- the layout
  const roomPane = h('section', { class: 'pane', 'aria-label': 'Room' }, roomHead, nameCard, lines, room.canWrite ? replyBar : null, room.canWrite ? send : null);
  const workPane = h('section', { class: 'pane off', 'aria-label': 'Work' }, host, workTabs, work, specForm, board, boardForm);
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
    drawBoard();
    drawTabs();
  }

  function drawTabs(): void {
    const specsLabel = `Specs ${room.specs().length}`;
    const boardLabel = `Board ${room.board().length}`;
    if (tabSpecs.textContent !== specsLabel) tabSpecs.textContent = specsLabel;
    if (tabBoard.textContent !== boardLabel) tabBoard.textContent = boardLabel;
    tabSpecs.setAttribute('aria-selected', String(workTab === 'specs'));
    tabBoard.setAttribute('aria-selected', String(workTab === 'board'));
    work.hidden = workTab !== 'specs';
    board.hidden = workTab !== 'board';
    specForm.hidden = !(specOpen && workTab === 'specs');
    boardForm.hidden = !(boardOpen && workTab === 'board');
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
    const entries = new Map(room.board().map(e => [e.id, e]));
    clear(lines, ls.length ? ls.map(l => {
      const answering = l.parent ? entries.get(l.parent) : undefined;
      const ai = room.isAi(l.by, l.el.changed_via);
      const name = room.name(l.by);
      const hidden = room.hidden.has(l.id);
      // keel tells a maker their own line is hidden (#537); a host reads it from the hidden list.
      const hiddenMine = !room.isHost && l.el.hidden === true;
      const door = doorLine(l.el);
      return h('div', { class: `line${ai ? ' ai' : ''}${hidden || hiddenMine ? ' hidden' : ''}` },
        h('span', { class: ai ? 'bdg a' : 'bdg' }, ai ? 'AI' : initial(name)),
        h('div', null,
          h('div', { class: 'meta' }, h('span', { class: 'who' }, name), ai ? h('span', { class: 'chip' }, 'AI') : null,
            h('span', { class: 't' }, hhmm(l.at)),
            door ? h('span', { class: 't' }, door) : null,
            answering ? h('span', { class: 't' }, `answering ${answering.title}`) : null,
            hidden ? h('span', { class: 't' }, 'Hidden from the room') : null,
            hiddenMine ? h('span', { class: 't' }, 'Hidden by the host: only you and the hosts see it') : null,
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

  /**
   * The host bar is rebuilt only when what it shows moved: a press that straddles a rebuild
   * lands on a node that is gone, so a feed tick from someone else's line must not cost a
   * host's click (the S472 walk lost a phase press that way).
   */
  let hostKey = '';
  function drawHost(): void {
    if (!room.isHost) { hostKey = ''; clear(host); return; }
    const s = room.sitting();
    const reading = room.browsing;
    const key = JSON.stringify([s?.id, s?.phase, s?.hearts, s?.specs, s?.voting, reading, room.seats()]);
    if (key === hostKey) return;
    hostKey = key;
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
      h('div', { class: 'ph seats-head' }, `Seats · ${room.seats().length}`),
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
    if (!live && specOpen) specOpen = false;
    if (!room.canWrite && boardOpen) boardOpen = false;
    const voting = !!s?.voting && !room.browsing;
    if (voting && !picks.length) picks = room.myVote()?.picks ?? [];

    const card = (spec: (typeof specs)[number]) => {
      const iHearted = hearts.some(x => x.by === room.meBy && x.target === spec.id);
      const pickAt = picks.indexOf(spec.id);
      return h('div', { class: spec.star ? 'card star' : 'card' },
        h('div', { class: 'ttl' }, h('h3', null, spec.title || 'Untitled', spec.star ? ' ★' : ''), spec.kind ? h('span', { class: 'chip' }, spec.kind) : null),
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
        // A kind is needed for a new spec; an old one with none (February's) may stay without.
        for (const r of kindRadios) { r.checked = r.value === mine?.kind; r.required = !mine || !!mine.kind; }
        draw();
        specTitle.focus();
      } }, mine ? 'Edit your spec' : 'Add your spec') : null,
    );
  }

  /**
   * The board is rebuilt only when what it shows moved, as the host bar is: a press on Answer
   * or Done must not land on a card a feed tick just replaced.
   */
  let boardKey = '';
  function drawBoard(): void {
    const entries = room.board();
    const view = entries.map(e => ({
      e, mine: room.canRetire(e.by), hidden: room.hidden.has(e.id) || (!room.isHost && e.el.hidden === true),
      who: e.waitsOn ? room.characterName(e.waitsOn) : 'anyone', by: room.name(e.by), answers: room.answers(e.id).length,
    }));
    const key = JSON.stringify([view.map(v => [v.e.id, v.e.title, v.e.text, v.e.colour, v.mine, v.hidden, v.who, v.by, v.answers]),
      room.canWrite, room.isHost, boardOpen]);
    if (key === boardKey) return;
    boardKey = key;
    clear(board,
      h('p', { class: 'sys' }, 'What waits on someone, one entry each.'),
      view.length ? view.map(({ e, hidden, who, by, answers }) => h('div', { class: `card bentry${hidden ? ' hidden' : ''}` },
        h('div', { class: 'ttl' }, e.colour ? h('span', { class: `chip c-${e.colour}` }, COLOUR_WORD[e.colour]) : null, h('h3', null, e.title || 'Untitled')),
        h('div', { class: 'm' }, [`Waits on ${who}`, `raised by ${by}`, e.colour ? COLOUR_HINT[e.colour] : ''].filter(Boolean).join(' · ')),
        e.text ? h('p', null, e.text) : null,
        answers || hidden ? h('div', { class: 'm' }, [answers ? `${answers} answer${answers === 1 ? '' : 's'} in the room` : '',
          hidden ? (room.isHost ? 'Hidden from the room' : 'Hidden by the host: only you and the hosts see it') : ''].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'btns' },
          room.canWrite ? h('button', { class: 'btn std', type: 'button', onclick: () => {
            replyTo = { id: e.id, title: e.title || 'Untitled' };
            drawReply();
            if (mq.matches) phoneTab('room');
            text.focus();
          } }, 'Answer') : null,
          room.canRetire(e.by) ? h('button', { class: 'btn quiet', type: 'button', onclick: async () => {
            try { await room.done(e.id); } catch (err) { notice(problemLine(err, 'taking the entry off the board'), true); }
          } }, 'Done: take it off the board') : null,
          room.isHost ? h('button', { class: 'btn quiet', type: 'button', onclick: () => hide(e.id, !hidden) }, hidden ? 'Unhide' : 'Hide') : null,
        )))
        : h('div', { class: 'empty' }, h('h3', null, 'Nothing waits'), h('p', null, 'When something waits on someone, put it here so it is not lost in the room.')),
      room.canWrite && !boardOpen ? h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'button', onclick: openBoardForm }, 'Put something on the board')) : null,
    );
  }

  const off = room.feed.subscribe(draw);
  draw();
  return () => { off(); room.close(); };
}
