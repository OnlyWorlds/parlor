/**
 * The room page (design sheet §3, Seethe's v1 screens 3, 4, 5, 7 and 10): the
 * room on the left, the work surface beside it (Work, Specs and the Board as tabs);
 * on a phone, one at a time. The composer, the forms and the tabs are built
 * once and never redrawn, so a feed tick never eats what someone is typing or
 * pressing; the rest redraws from the room's elements.
 */

import { PHASES, KINDS, BOARD_COLOURS, type Switches, type Kind, type BoardColour } from '../parlor/shapes';
import { problemLine, type Room } from '../parlor/room';
import { doorLine } from '../parlor/roster';
import { h, clear, notice, hhmm, initial } from './dom';

export interface SignedInAs {
  /** The account's name; empty when keel named none. */
  name: string;
  signOut: () => void;
}

/** `signedInAs`: the room was reached by a sign-in just now, so it names the account (the S474 gate's G2). */
export function roomView(root: HTMLElement, room: Room, onLeave: () => void, signedInAs?: SignedInAs): () => void {
  const top = h('header', { class: 'top' });
  const whoLine = signedInAs
    ? h('p', { class: 'sys', 'data-part': 'signed-in-as' },
      signedInAs.name ? `Signed in as ${signedInAs.name}. ` : 'Signed in with the account on onlyworlds.com in this browser. ',
      h('button', { class: 'btn quiet', type: 'button', onclick: signedInAs.signOut }, 'Not you? Sign out'))
    : null;
  const lines = h('div', { class: 'lines', 'aria-live': 'polite' });
  const roomHead = h('div');
  const nameCard = nameForm();
  const host = h('div');
  const work = h('div');
  let picks: string[] = [];
  let specOpen = false;
  let boardOpen = false;
  // A workshop opens on its specs; a world's parlor (no sitting yet) on its work.
  let workTab: 'work' | 'changes' | 'specs' | 'board' = room.sittings().length ? 'specs' : 'work';
  // What changed since this browser last opened the room (a per-viewer convenience; nothing breaks without it).
  const seenKey = `parlor.seen.${room.world.id}`;
  let seenBefore = '';
  try { seenBefore = localStorage.getItem(seenKey) ?? ''; localStorage.setItem(seenKey, new Date().toISOString()); } catch { /* private window */ }
  let workOpen = false;
  let replyTo: { id: string; title: string; kind: 'board' | 'work' } | null = null;
  let stickToEnd = true;

  // -------------------------------------------------- the composer (built once)
  const text = h('textarea', { rows: 1, 'aria-label': 'Write a line', placeholder: 'Write a line' });
  const sendBtn = h('button', { class: 'btn std', type: 'submit' }, 'Send');
  const send = h('form', {
    class: 'send',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const t = text.value.trim();
      if (!t) return;
      sendBtn.disabled = true;
      try {
        await room.post(t, replyTo?.kind === 'board' ? replyTo.id : null, replyTo?.kind === 'work' ? replyTo.id : null);
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

  // -------------------------------------------------- a work item (built once)
  const workTitle = h('input', { id: 'work-title', type: 'text', maxlength: 200 });
  const workFor = h('select', { id: 'work-for' });
  const workText = h('textarea', { id: 'work-text', class: 'field', rows: 3 });
  const workFind = h('input', { id: 'work-find', type: 'search', autocomplete: 'off', placeholder: 'Type a name from the world' });
  const workFound = h('ul', { class: 'found' });
  const workPicked = h('div', { class: 'picked' });
  let picksAbout: { type: string; id: string; name: string }[] = [];
  const typeWord = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  function drawPicked(): void {
    clear(workPicked, picksAbout.map(p => h('span', { class: 'chip el' }, `${p.name} · ${typeWord(p.type)} `,
      h('button', { class: 'act', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => {
        picksAbout = picksAbout.filter(x => x.id !== p.id);
        drawPicked();
      } }, '×'))));
  }
  function drawFound(): void {
    const hits = room.pickable(workFind.value, new Set(picksAbout.map(p => p.id)));
    clear(workFound, hits.map(x => h('li', null, h('button', { type: 'button', onclick: () => {
      picksAbout = [...picksAbout, x];
      workFind.value = '';
      drawFound();
      drawPicked();
      workFind.focus();
    } }, `${x.name} · ${typeWord(x.type)}`))));
  }
  workFind.addEventListener('input', drawFound);
  const workForm = h('form', {
    class: 'card',
    hidden: true,
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (!workTitle.value.trim()) return;
      try {
        await room.makeWork(workTitle.value, workText.value, workFor.value || null, picksAbout);
        workOpen = false;
        draw();
      } catch (err) {
        // A picked element deleted meanwhile is refused by keel: the form keeps what was typed.
        notice(problemLine(err, 'adding the work item'), true);
      }
    },
  },
    h('label', { for: 'work-title' }, 'What needs doing?'), workTitle,
    h('label', { for: 'work-for' }, 'For'), workFor,
    h('label', { for: 'work-text' }, 'Why'), workText,
    h('label', { for: 'work-find' }, 'What it is about'), workFind, workFound, workPicked,
    h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'submit' }, 'Add the work item'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { workOpen = false; draw(); } }, 'Cancel')),
  );
  function openWorkForm(): void {
    workOpen = true;
    workTitle.value = '';
    workText.value = '';
    workFind.value = '';
    picksAbout = [];
    drawFound();
    drawPicked();
    clear(workFor, h('option', { value: '' }, 'Anyone'), room.writers().map(w => h('option', { value: w.character }, w.name)));
    draw();
    workTitle.focus();
  }

  // -------------------------------------------------- the work tabs (built once)
  const tabWorkItems = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => { workTab = 'work'; draw(); } }, 'Work');
  const tabChanges = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => { workTab = 'changes'; draw(); } }, 'Changes');
  const tabSpecs = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => { workTab = 'specs'; draw(); } }, 'Specs');
  const tabBoard = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => { workTab = 'board'; draw(); } }, 'Board');
  const workTabs = h('div', { class: 'wtabs', role: 'tablist', 'aria-label': 'Work' }, tabWorkItems, tabChanges, tabSpecs, tabBoard);
  const board = h('div');
  const workList = h('div');
  const changeList = h('div');
  // -------------------------------------------------- the layout
  const roomPane = h('section', { class: 'pane', 'aria-label': 'Room' }, whoLine, roomHead, nameCard, lines, room.canWrite ? replyBar : null, room.canWrite ? send : null);
  const workPane = h('section', { class: 'pane off', 'aria-label': 'Work' }, host, workTabs, workList, workForm, changeList, work, specForm, board, boardForm);
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
  const onWidth = (): void => {
    if (mq.matches) phoneTab('room');
    else { roomPane.classList.remove('off'); workPane.classList.remove('off'); }
  };
  mq.addEventListener('change', onWidth);
  clear(root, h('div', { class: 'app' }, top, h('nav', { class: 'mtabs' }, tabRoom, tabWork), h('main', { class: 'main' }, roomPane, workPane)));

  // -------------------------------------------------- what redraws
  function draw(): void {
    drawTop();
    drawRoom();
    drawHost();
    drawWork();
    drawBoard();
    drawWorkItems();
    drawChanges();
    drawTabs();
  }

  function drawTabs(): void {
    const workLabel = `Work ${room.work().filter(w => w.state !== 'done').length}`;
    const specsLabel = `Specs ${room.specs().length}`;
    const boardLabel = `Board ${room.board().length}`;
    if (tabWorkItems.textContent !== workLabel) tabWorkItems.textContent = workLabel;
    if (tabSpecs.textContent !== specsLabel) tabSpecs.textContent = specsLabel;
    if (tabBoard.textContent !== boardLabel) tabBoard.textContent = boardLabel;
    tabWorkItems.setAttribute('aria-selected', String(workTab === 'work'));
    tabChanges.setAttribute('aria-selected', String(workTab === 'changes'));
    changeList.hidden = workTab !== 'changes';
    tabSpecs.setAttribute('aria-selected', String(workTab === 'specs'));
    tabBoard.setAttribute('aria-selected', String(workTab === 'board'));
    workList.hidden = workTab !== 'work';
    work.hidden = workTab !== 'specs';
    board.hidden = workTab !== 'board';
    workForm.hidden = !(workOpen && workTab === 'work');
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
    const entries = new Map<string, { title: string }>(room.board().map(e => [e.id, e]));
    for (const w of room.work()) entries.set(w.id, w);
    clear(lines, ls.length ? ls.map(l => {
      const answering = (l.parent ? entries.get(l.parent) : undefined) ?? (l.about ? entries.get(l.about) : undefined);
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
      h('div', { class: 'row' }, input, h('button', { class: 'btn std', type: 'submit' }, 'Save')));
  }

  async function hide(id: string, on: boolean, type = 'narrative') {
    try {
      await room.hide(type, id, on);
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
    if (!room.canWrite && workOpen) workOpen = false;
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
      // While voting, the vote is the screen's one Entry.
      live && !specOpen ? h('button', { class: voting ? 'btn std' : 'btn entry', type: 'button', onclick: () => {
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
            replyTo = { id: e.id, title: e.title || 'Untitled', kind: 'board' };
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

  /** The work list, rebuilt only when what it shows moved (as the board). */
  let workKey = '';
  let deleting: string | null = null;
  const STATE_WORD = { open: 'Open', taken: 'Taken', done: 'Done' } as const;
  function drawWorkItems(): void {
    const view = room.work().map(w => ({
      w, can: room.canRetire(w.by), hidden: room.hidden.has(w.id) || (!room.isHost && w.el.hidden === true),
      who: w.forWho ? room.characterName(w.forWho) : 'anyone', by: room.name(w.by), answers: room.answers(w.id).length,
      els: w.elements.map(x => ({ ...x, name: w.otherWorld ? null : room.elementName(x.id) })),
      // One name per taker: a double take from two tabs is one person (the Take gate's T2-G1).
      takers: [...new Set(w.takes.map(t => t.by))].map(by => room.name(by)), mine: room.hasTaken(w.id),
    }));
    const key = JSON.stringify([view.map(v => [v.w.id, v.w.title, v.w.text, v.w.state, v.w.proposed, v.w.otherWorld, v.can, v.hidden, v.who, v.by, v.answers, v.els, v.takers, v.mine]),
      room.canWrite, room.isHost, room.needsName(), workOpen, deleting]);
    if (key === workKey) return;
    workKey = key;
    clear(workList,
      h('p', { class: 'sys' }, 'Work on this world: each item says what it is about, and opens in the room when you answer it.'),
      view.length ? view.map(({ w, can, hidden, who, by, answers, els, takers, mine }) => h('div', { class: `card witem${w.state === 'done' ? ' done' : ''}${hidden ? ' hidden' : ''}` },
        h('div', { class: 'ttl' }, h('span', { class: `chip s-${w.state}` }, STATE_WORD[w.state]), w.proposed ? h('span', { class: 'chip prop' }, 'Proposed') : null,
          h('h3', null, w.title || 'Untitled')),
        h('div', { class: 'm' }, `For ${who} · made by ${by}`),
        // Who took it, by the takes' makers (contract T2); Done wins over a take.
        takers.length && w.state !== 'done' ? h('div', { class: 'm', 'data-part': 'taken-by' }, `Taken by ${takers.join(', ')}`) : null,
        w.text ? h('p', null, w.text) : null,
        els.length ? h('ul', { class: 'about' }, els.map(x => h('li', null,
          h('span', { class: 'chip el' }, w.otherWorld ? `In another world · ${typeWord(x.type)}` : x.name === null ? `Missing · ${typeWord(x.type)}` : `${x.name} · ${typeWord(x.type)}`),
          x.reason ? h('span', { class: 'why' }, x.reason) : null))) : null,
        answers || hidden ? h('div', { class: 'm' }, [answers ? `${answers} answer${answers === 1 ? '' : 's'} in the room` : '',
          hidden ? (room.isHost ? 'Hidden from the room' : 'Hidden by the host: only you and the hosts see it') : ''].filter(Boolean).join(' · ')) : null,
        deleting === w.id
          ? h('div', { class: 'btns' }, h('span', { class: 'sys' }, 'Delete this work item for everyone?'),
            h('button', { class: 'btn std', type: 'button', onclick: async () => {
              deleting = null;
              try { await room.deleteWork(w.id); } catch (err) { notice(problemLine(err, 'deleting the work item'), true); }
              draw();
            } }, 'Delete it'),
            h('button', { class: 'btn quiet', type: 'button', onclick: () => { deleting = null; draw(); } }, 'Keep it'))
          : h('div', { class: 'btns' },
            room.canWrite ? h('button', { class: 'btn std', type: 'button', onclick: () => {
              replyTo = { id: w.id, title: w.title || 'Untitled', kind: 'work' };
              drawReply();
              if (mq.matches) phoneTab('room');
              text.focus();
            } }, 'Answer') : null,
            room.canWrite && w.state !== 'done' && !room.needsName() ? h('button', { class: 'btn std', type: 'button', onclick: async (e: Event) => {
              (e.currentTarget as HTMLButtonElement).disabled = true;
              try { await (mine ? room.release(w.id) : room.take(w.id)); } catch (err) { notice(problemLine(err, mine ? 'releasing the work item' : 'taking the work item'), true); }
              // Rebuilt even when nothing moved, so a failed press gives its button back (the Take gate's T4-G1).
              workKey = '';
              draw();
            } }, mine ? 'Release' : 'Take') : null,
            can ? h('button', { class: 'btn quiet', type: 'button', onclick: async () => {
              try { await room.setWorkState(w.id, w.state === 'done' ? 'open' : 'done'); } catch (err) { notice(problemLine(err, 'changing the work item'), true); }
            } }, w.state === 'done' ? 'Reopen' : 'Mark done') : null,
            can ? h('button', { class: 'btn quiet', type: 'button', onclick: () => { deleting = w.id; draw(); } }, 'Delete') : null,
            room.isHost ? h('button', { class: 'btn quiet', type: 'button', onclick: () => hide(w.id, !hidden, 'relation') }, hidden ? 'Unhide' : 'Hide') : null,
          )))
        : h('div', { class: 'empty' }, h('h3', null, 'No work yet'), h('p', null, 'A work item names what needs doing and the elements it is about, so anyone in the room can pick it up.')),
      room.canWrite && !workOpen ? h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'button', onclick: openWorkForm }, 'Add a work item')) : null,
    );
  }

  /** The world's recent changes: who, which door, an AI's rows marked (sheet §2). Drawn only when the list moved. */
  let changesKey = '';
  function drawChanges(): void {
    const rows = room.changes().map(c => ({ c, who: room.name(c.by), ai: room.isAi(c.by, c.el.changed_via), door: doorLine(c.el), fresh: !!seenBefore && c.at > seenBefore }));
    const key = JSON.stringify(rows.map(r => [r.c.id, r.c.name, r.c.at, r.who, r.ai, r.door, r.fresh]));
    if (key === changesKey) return;
    changesKey = key;
    clear(changeList,
      h('p', { class: 'sys' }, seenBefore ? 'What changed in the world, newest first; new since you last opened the room are marked.' : 'What changed in the world, newest first.'),
      rows.length ? h('ul', { class: 'changes' }, rows.map(({ c, who, ai, door, fresh }) => h('li', { class: ai ? 'ai' : '' },
        h('span', { class: ai ? 'bdg a' : 'bdg' }, ai ? 'AI' : initial(who)),
        h('div', null,
          h('div', null, h('span', { class: 'nm' }, c.name), ' ', h('span', { class: 't' }, c.type.charAt(0).toUpperCase() + c.type.slice(1)), fresh ? h('span', { class: 'chip on' }, 'New') : null),
          h('div', { class: 't' }, [`${c.made ? 'made' : 'changed'} by ${who}`, ai ? 'an AI' : '', door ?? '', hhmm(c.at)].filter(Boolean).join(' · '))))))
        : h('div', { class: 'empty' }, h('h3', null, 'Nothing yet'), h('p', null, 'When someone adds to the world or changes it, it shows here.')),
    );
  }

  const off = room.feed.subscribe(draw);
  draw();
  return () => { off(); mq.removeEventListener('change', onWidth); room.close(); };
}
