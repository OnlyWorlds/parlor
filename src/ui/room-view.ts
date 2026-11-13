/**
 * The room page (design sheet §3, Seethe's v1 screens 3, 4, 5, 7 and 10): the
 * room on the left, the work surface beside it (Work, Specs and the Board as tabs);
 * on a phone, one at a time. The composer, the forms and the tabs are built
 * once and never redrawn, so a feed tick never eats what someone is typing or
 * pressing; the rest redraws from the room's elements.
 */

import { PHASES, KINDS, BOARD_COLOURS, OWNER, storyStart, splitConsequence, maySetDone, readLines, isWorkItemPair, type Switches, type Kind, type BoardColour, type Line, type ReportPart, type KeeperPart } from '../parlor/shapes';
import { isAfter } from '../parlor/when';
import { CompletionFailed, DoneFailed, DoneNoReport, ItemMoved, KeeperOnly, ReportMoved, problemLine, type Room } from '../parlor/room';
import { doorLine } from '../parlor/roster';
import { h, clear, notice, hhmm, initial } from './dom';
import { WAYMARK_SETTLED, markSet, waymarkPlan, waymarkSlot } from './waymark';
import { afterPress } from './press';
import { OwNetworkError, fileKindOf, proposedMarkOf, type OwWorldFileRow } from '@onlyworlds/sdk';
import { ACCEPT as FILES_ACCEPT, MAX_PICKS, adderOf, pickRefusal, progressWords, sizeWords, type Pending } from '../parlor/files';

/** A press refused before anything was sent, in the person's words. */
class Refused extends Error {}

export interface SignedInAs {
  /** The account's name; empty when keel named none. */
  name: string;
  signOut: () => void;
}

/** `signedInAs`: the room was reached by a sign-in just now, so it names the account (the sign-in gate's G2). */
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
  let picksFor: string | null = null;
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
  // The reports whose story a person unfolded: kept across redraws, forgotten with the room.
  const openReports = new Set<string>();

  // -------------------------------------------------- the composer (built once)
  const text = h('textarea', { rows: 1, 'aria-label': 'Write a line', placeholder: 'Write a line' });
  const sendBtn = h('button', { class: 'btn std', type: 'submit' }, 'Send');
  // Files picked for the next line: shown as chips until Send, then they go with the line.
  let picked: File[] = [];
  const fileInput = h('input', { type: 'file', multiple: true, accept: FILES_ACCEPT, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  const attachBtn = h('button', { class: 'btn quiet', type: 'button', 'data-part': 'attach', onclick: () => fileInput.click() }, 'Attach');
  const chips = h('div', { class: 'send-files', hidden: true });
  // Handing in a report (schema-dist profiles/report.md, step 1): the same composer, its Send a Hand in.
  let reporting = false;
  const reportBtn = h('button', { class: 'btn quiet', type: 'button', 'data-part': 'report', 'aria-pressed': 'false', onclick: () => {
    reporting = !reporting;
    drawReportMode();
    drawReply();
    text.focus();
  } }, 'Report');
  const MEMBER_NOTE = 'Handing in a report: your text is kept whole as you wrote it, and a host completes it. Enter starts a new line; press Hand in to send.';
  const KEEPER_NOTE = 'You keep this world, so your report is completed as you hand it in: write In short and What changed here, and what you did in the box below. Enter starts a new line; press Hand in to send.';
  const reportNote = h('p', { class: 'sys', 'data-part': 'report-note', hidden: true }, MEMBER_NOTE);
  // On a work item: whether the report answers it (the profile's x_report_answers), or only touches it.
  const finishBox = h('input', { type: 'checkbox', id: 'report-finishes', 'data-part': 'report-finishes' });
  finishBox.checked = false;
  const finishLabel = h('label', { class: 'finishes', for: 'report-finishes' }, finishBox, ' This report is the work the item asked for');
  // The keeper's part (the report profile, "The keeper's own session"): built once, outside the form, so neither a
  // redraw nor an Enter in it (a phone's Go) sends anything. Shown only to a keeper with Report on.
  const kShort = h('textarea', { id: 'report-short', class: 'field', rows: 2, 'data-part': 'report-short' });
  const kChanges = h('textarea', { id: 'report-changes-in', class: 'field', rows: 3, 'data-part': 'report-changes-in',
    placeholder: 'One line per change. Leave it empty when nothing changed.' });
  const kFind = h('input', { id: 'report-touch', type: 'search', autocomplete: 'off', placeholder: 'Type a name from the world' });
  const kFound = h('ul', { class: 'found' });
  const kPicked = h('div', { class: 'picked' });
  let kPicks: { type: string; id: string; name: string }[] = [];
  const kTypeWord = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  function drawKPicked(): void {
    clear(kPicked, kPicks.map(p => h('span', { class: 'chip el' }, `${p.name} · ${kTypeWord(p.type)} `,
      h('button', { class: 'act', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => { kPicks = kPicks.filter(x => x.id !== p.id); drawKPicked(); } }, '×'))));
  }
  function drawKFound(): void {
    const hits = room.reportPickable(kFind.value, new Set(kPicks.map(p => p.id)));
    clear(kFound, hits.map(x => h('li', null, h('button', { type: 'button', onclick: () => {
      kPicks = [...kPicks, x];
      kFind.value = '';
      drawKFound();
      drawKPicked();
      kFind.focus();
    } }, `${x.name} · ${kTypeWord(x.type)}`))));
  }
  kFind.addEventListener('input', drawKFound);
  for (const field of [kShort, kChanges, kFind]) {
    field.addEventListener('keydown', (ev: Event) => {
      const e = ev as KeyboardEvent;
      // Ctrl or Cmd with Enter hands it in, as in the story's box; a bare Enter in the search box picks nothing and sends nothing.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.requestSubmit(); }
      else if (e.key === 'Enter' && field === kFind) e.preventDefault();
    });
  }
  const keeperPart = h('div', { class: 'keeper-part', 'data-part': 'keeper-part', hidden: true },
    h('label', { for: 'report-short' }, 'In short'), kShort,
    h('label', { for: 'report-changes-in' }, 'What changed'), kChanges,
    h('label', { for: 'report-touch' }, 'What it touched (optional)'), kFind, kFound, kPicked,
    h('p', { class: 'sys' }, 'A map, a pin, a marker or a story has no link here: name it by its address in What changed, or in In short when you only read it.'));
  const keeperTyped = (): boolean => !!(kShort.value.trim() || kChanges.value.trim() || kPicks.length);
  // The work items this composer set done whose report is not made yet (a create that failed after the done): a
  // changed draft still says it set them done, since it did.
  const doneByMe = new Set<string>();
  /** Whether a keeper's report on this work item sets it done: open or taken and not proposed, or done by this composer. */
  function setsDoneOn(id: string | null): { id: string; title: string; el: unknown } | null {
    const item = id ? room.work().find(w => w.id === id) ?? null : null;
    return item && (maySetDone(item.el) || (doneByMe.has(item.id) && item.state === 'done')) ? item : null;
  }
  function drawFinishLabel(): void {
    const sets = room.isKeeper && replyTo?.kind === 'work' && !!setsDoneOn(replyTo.id);
    const box = sets ? ' This report is the work the item asked for: the item is set done' : ' This report is the work the item asked for';
    if (finishLabel.lastChild?.textContent !== box) finishLabel.replaceChildren(finishBox, box);
  }
  function drawReportMode(): void {
    const mine = !!room.myCharacter();
    // A Character gone mid-draft turns the whole composer back, the reply bar's Report on and its box with it.
    if (!mine && reporting) { reporting = false; drawReply(); }
    reportBtn.disabled = !mine;
    reportBtn.title = mine ? '' : 'Save your name first: a report is handed in as your own Character.';
    reportBtn.setAttribute('aria-pressed', String(reporting));
    reportNote.hidden = !reporting;
    const keeper = room.isKeeper;
    const note = keeper ? KEEPER_NOTE : MEMBER_NOTE;
    if (reportNote.textContent !== note) reportNote.textContent = note;
    keeperPart.hidden = !(reporting && keeper);
    drawFinishLabel();
    const label = reporting ? 'Hand in' : 'Send';
    if (sendBtn.textContent !== label) sendBtn.textContent = label;
    const hint = reporting ? 'Write your report' : 'Write a line';
    if (text.placeholder !== hint) { text.placeholder = hint; text.setAttribute('aria-label', hint); }
    const rows = reporting ? 4 : 1;
    if (text.rows !== rows) { text.rows = rows; text.style.height = 'auto'; }
  }
  function pick(files: Iterable<File>): void {
    const refused: string[] = [];
    for (const f of files) {
      const why = pickRefusal(f);
      if (why) { refused.push(why); continue; }
      if (picked.length >= MAX_PICKS) { refused.push(`At most ${MAX_PICKS} files on one line.`); break; }
      picked.push(f);
    }
    if (refused.length) notice(refused.join(' '), true);
    drawChips();
  }
  function drawChips(): void {
    chips.hidden = picked.length === 0;
    clear(chips, picked.map((f, i) => h('span', { class: 'chip file-chip' }, `${f.name} · ${sizeWords(f.size)} `,
      h('button', { class: 'act', type: 'button', 'aria-label': `Drop ${f.name}`, onclick: () => { picked.splice(i, 1); drawChips(); } }, '×'))),
      picked.some(f => fileKindOf(f.name) === 'jpg')
        ? h('p', { class: 'sys' }, 'A photo from a phone can carry where it was taken: everyone in this room gets the file as it is.')
        : null);
  }
  fileInput.addEventListener('change', () => { pick(Array.from(fileInput.files ?? [])); fileInput.value = ''; });
  // A pasted picture (a screenshot) is picked like an attached one.
  text.addEventListener('paste', e => {
    if (e.clipboardData?.types.includes('text/plain')) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const at = new Date();
    const stamp = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}-${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}${String(at.getSeconds()).padStart(2, '0')}`;
    pick(files.map((f, i) => {
      const ext = f.type === 'image/jpeg' ? 'jpg' : f.type.slice(6);
      return new File([f], `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${ext}`, { type: f.type });
    }));
  });
  // A picture full size, in the page (no new tab: a popup blocker, a phone's browser and the page's own
  // policy all let an in-page view through). Escape or a click closes it.
  const viewerImg = h('img', { class: 'viewer-img', alt: '' });
  const viewer = h('dialog', { class: 'viewer', 'aria-label': 'Picture' }, viewerImg,
    h('button', { class: 'btn quiet', type: 'button', onclick: () => viewer.close() }, 'Close'));
  viewer.addEventListener('click', e => { if (e.target === viewer || e.target === viewerImg) viewer.close(); });
  viewer.addEventListener('close', () => { viewerImg.removeAttribute('src'); });

  // A file still on its way is lost if the page goes: the browser asks first.
  const onLeavePage = (e: BeforeUnloadEvent): void => { if (room.files.sending) e.preventDefault(); };
  window.addEventListener('beforeunload', onLeavePage);

  // One Send at a time: Enter twice (requestSubmit ignores a disabled button) makes one line, never two (I2).
  let sending = false;
  // One body and one key per draft (everything the press read: its text, what it answers, the box, whether it is a
  // keeper's and the keeper's part): a retry of the same draft sends the same body under the same key, its day and
  // name included, so keel replays its first answer and a report is never handed in twice. A changed draft is a new
  // report, a new body and a new key.
  let draft: { sig: string; key: string; body: Record<string, unknown>; setsDone: string | null } | null = null;
  // Set once a seat that no longer keeps the world was told its keeper part would not go: the next press sends without it.
  let dropKeeperPart = false;
  const send = h('form', {
    class: 'send',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (sending) return;
      const typed = text.value;
      const t = typed.trim();
      const files = picked;
      // What this press sends is read now: a toggle, a box or a reply changed during the send changes nothing it sends.
      const asReport = reporting;
      const answers = finishBox.checked;
      const kTyped = { short: kShort.value, changes: kChanges.value, picks: kPicks };
      if (asReport && !t) { notice('A report needs your text. Files alone go on a line.', true); return; }
      if (!t && !files.length) return;
      const answering = replyTo;
      sending = true;
      sendBtn.disabled = true;
      // The chips go at once: what they held now belongs to this line, and the next line starts empty.
      picked = [];
      drawChips();
      // Where a failure came from: before anything was sent (the role's read, a refusal), or the write itself.
      let sent = false;
      try {
        if (asReport) {
          // Who I am here decides what the report is: read from the server at the press.
          await room.readRole();
          const keeper = room.isKeeper;
          if (keeper) dropKeeperPart = false;
          drawReportMode();
          if (!keeper && keeperTyped() && !dropKeeperPart) { dropKeeperPart = true; throw new Refused('You no longer keep this world, so a report from you goes in as handed in: your short part and what changed would not be sent. Hand in again to send it that way.'); }
          if (keeper && !kTyped.short.trim()) throw new Refused('A report you complete needs its short part: write it under In short.');
          const item = keeper && answers && answering?.kind === 'work' ? setsDoneOn(answering.id) : null;
          const setsDone = item?.id ?? null;
          const on = { parent: answering?.kind === 'board' ? answering.id : null, item: answering?.kind === 'work' ? answering.id : null, answers };
          // Not the item's state: once a first press set it done, the retry must still send that press's body and key.
          const sig = JSON.stringify([t, on, keeper, keeper ? [kTyped.short, kTyped.changes, kTyped.picks.map(p => p.id)] : null]);
          if (!draft || draft.sig !== sig) {
            const keeperPart: KeeperPart | null = keeper
              ? { description: kTyped.short.trim(), changes: kTyped.changes, touched: kTyped.picks, done: item ? { id: item.id, title: item.title } : null }
              : null;
            const body = room.reportBody(t, on, keeperPart);
            if (!body) throw new Refused('Save your name first: a report is handed in as your own Character.');
            draft = { sig, key: crypto.randomUUID(), body, setsDone };
          }
          sent = true;
          await room.handIn(draft.body, draft.key, files, draft.setsDone, !!draft.setsDone && doneByMe.has(draft.setsDone));
        } else {
          sent = true;
          await room.post(t, answering?.kind === 'board' ? answering.id : null, answering?.kind === 'work' ? answering.id : null, files);
        }
        if (text.value === typed) { text.value = ''; text.style.height = 'auto'; }
        if (replyTo === answering) { replyTo = null; drawReply(); }
        if (asReport) {
          if (draft?.setsDone) doneByMe.delete(draft.setsDone);
          draft = null;
          dropKeeperPart = false;
          if (kShort.value === kTyped.short) kShort.value = '';
          if (kChanges.value === kTyped.changes) kChanges.value = '';
          if (kPicks === kTyped.picks) { kPicks = []; drawKPicked(); }
          kFind.value = '';
          clear(kFound);
        }
        if (asReport && reporting) { reporting = false; finishBox.checked = false; drawReportMode(); drawReply(); }
        stickToEnd = true;
      } catch (err) {
        // Nothing was made: the files come back to the composer, and the toggle and the box stay as they were.
        picked = [...files, ...picked].slice(0, MAX_PICKS);
        drawChips();
        // A body built for a state that moved is built again on the next press.
        if (err instanceof KeeperOnly) { dropKeeperPart = true; draft = null; }
        if (err instanceof ItemMoved) draft = null;
        if (err instanceof DoneNoReport) doneByMe.add(err.item.id);
        // A lost answer to the done may still have set it: the next press may say this composer set it.
        if (err instanceof DoneFailed && err.failure instanceof OwNetworkError && draft?.setsDone) doneByMe.add(draft.setsDone);
        const failure = err instanceof DoneNoReport ? err.failure : err;
        // A lost answer may still have made the report: the same draft, pressed again, sends the same body under the
        // same key, so keel answers with the report it made and never makes a second one.
        const lost = asReport && sent && failure instanceof OwNetworkError
          ? 'OnlyWorlds could not be reached while handing in your report. It may already be in: press Hand in again with nothing changed, and it is never made twice.'
          : problemLine(failure, asReport ? 'handing in your report' : 'sending your line');
        notice(err instanceof Refused ? err.message
          : err instanceof KeeperOnly ? 'You no longer keep this world, so this report was not sent. Hand in again to send it as handed in.'
          : err instanceof ItemMoved ? 'The work item changed meanwhile: it is gone, or no longer open or taken. Nothing was handed in; hand in again, and the report says only what is true now.'
          : err instanceof DoneNoReport ? `The work item ${err.item.title.trim() || 'Untitled'} is set done, and your report is not in yet. ${lost}`
          : err instanceof DoneFailed ? `The work item could not be set done, so nothing was handed in. ${problemLine(err.failure, 'setting the work item done')} To hand the report in without setting the item done, untick the box.`
          : lost, true);
      } finally {
        sending = false;
        sendBtn.disabled = false;
        text.focus();
      }
    },
  }, text, attachBtn, reportBtn, sendBtn, fileInput);
  text.addEventListener('keydown', e => {
    // A report is long text: Enter starts a new line there, and Ctrl or Cmd with Enter hands it in.
    if (e.key === 'Enter' && !e.shiftKey && (!reporting || e.ctrlKey || e.metaKey)) { e.preventDefault(); send.requestSubmit(); }
  });
  text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`; });
  lines.addEventListener('scroll', () => { stickToEnd = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 24; });

  // Answering a board entry: the composer says so until the line is sent or the answer dropped.
  const replyBar = h('div', { class: 'reply', hidden: true });
  // The box answers one work item: answering another (or none) starts it unticked again.
  let finishFor: string | null = null;
  function drawReply(): void {
    const answeringId = replyTo?.id ?? null;
    if (answeringId !== finishFor) { finishBox.checked = false; finishFor = answeringId; }
    replyBar.hidden = !replyTo;
    if (!replyTo) { clear(replyBar); return; }
    drawFinishLabel();
    clear(replyBar, h('span', null, `${reporting ? 'Report on' : 'Answering'}: ${replyTo.title}`),
      reporting && replyTo.kind === 'work' ? finishLabel : null,
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { replyTo = null; drawReply(); } }, 'Not now'));
  }

  // -------------------------------------------------- completing a report (the report profile's step 2; built once)
  // Its own card, fields and button, apart from the composer: nothing typed here is the composer's, and Enter here
  // sends nothing. The change_seq of the report as the keeper opened it is kept, so a member's edit since refuses.
  let completing: { id: string; title: string; seq: number | null } | null = null;
  // The report the fields were last filled for: Not now, then Complete on the same report, keeps what was typed.
  let lastOpened: string | null = null;
  // Whether the card shows the set-done box: a box not shown sets nothing.
  let cSetShown = false;
  // Reports whose last press may have landed with its answer lost; and the one already said to be completed.
  const mayHaveLanded = new Set<string>();
  let saidCompleted: string | null = null;
  let completeBusy = false;
  // Per report: the work items this card set done whose completion did not land yet (the next press says them).
  const completeDone = new Map<string, Set<string>>();
  const cTitle = h('h3');
  const cStory = h('div', { class: 'txt complete-story', 'data-part': 'complete-story' });
  const cShort = h('textarea', { id: 'complete-short', class: 'field', rows: 2, 'data-part': 'complete-short' });
  const cChanges = h('textarea', { id: 'complete-changes', class: 'field', rows: 3, 'data-part': 'complete-changes',
    placeholder: 'One line per change. Leave it empty when nothing changed.' });
  const cFind = h('input', { id: 'complete-touch', type: 'search', autocomplete: 'off', placeholder: 'Type a name from the world' });
  const cFound = h('ul', { class: 'found' });
  const cPicked = h('div', { class: 'picked' });
  let cPicks: { type: string; id: string; name: string }[] = [];
  const cItems = h('div', { class: 'm', 'data-part': 'complete-items' });
  const cSetDone = h('input', { type: 'checkbox', id: 'complete-setdone', 'data-part': 'complete-setdone' });
  const cSetDoneLabel = h('label', { class: 'finishes', for: 'complete-setdone' }, cSetDone, ' The work is there: set them done');
  const cBtn = h('button', { class: 'btn entry', type: 'button', 'data-part': 'complete-go' }, 'Complete');
  function drawCPicked(): void {
    clear(cPicked, cPicks.map(p => h('span', { class: 'chip el' }, `${p.name} · ${kTypeWord(p.type)} `,
      h('button', { class: 'act', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => { cPicks = cPicks.filter(x => x.id !== p.id); drawCPicked(); } }, '×'))));
  }
  cFind.addEventListener('input', () => {
    const hits = room.reportPickable(cFind.value, new Set(cPicks.map(p => p.id)));
    clear(cFound, hits.map(x => h('li', null, h('button', { type: 'button', onclick: () => {
      cPicks = [...cPicks, x];
      cFind.value = '';
      clear(cFound);
      drawCPicked();
      cFind.focus();
    } }, `${x.name} · ${kTypeWord(x.type)}`))));
  });
  for (const field of [cShort, cChanges, cFind]) {
    field.addEventListener('keydown', (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void completeNow(); }
      else if (e.key === 'Enter' && field === cFind) e.preventDefault();
    });
  }
  const completeCard = h('div', { class: 'card complete', 'data-part': 'complete', hidden: true },
    cTitle,
    h('p', { class: 'sys' }, 'Completing a report: make the changes it calls for first, then write In short and What changed. The reporter\'s text stays as handed in.'),
    h('details', null, h('summary', null, 'The report as handed in'), cStory),
    h('label', { for: 'complete-short' }, 'In short'), cShort,
    h('label', { for: 'complete-changes' }, 'What changed'), cChanges,
    h('label', { for: 'complete-touch' }, 'What it touched (optional)'), cFind, cFound, cPicked,
    cItems,
    h('div', { class: 'btns' }, cBtn, h('button', { class: 'btn quiet', type: 'button', onclick: () => closeComplete() }, 'Not now')));
  cBtn.addEventListener('click', () => { void completeNow(); });
  function closeComplete(): void {
    completing = null;
    completeCard.hidden = true;
  }
  /** Open the card on a handed-in report; a report already open keeps what was typed for it. */
  function openComplete(l: Line, r: ReportPart): void {
    // A press under way keeps the card on its report: what it typed stays until the press settles.
    if (completeBusy) return;
    if (lastOpened !== l.id) {
      lastOpened = l.id;
      cShort.value = r.description;
      cChanges.value = r.consequences.join('\n');
      cPicks = [];
      drawCPicked();
      cFind.value = '';
      clear(cFound);
      cSetDone.checked = true;
    }
    completing = { id: l.id, title: r.title || 'Untitled', seq: typeof l.el.change_seq === 'number' ? l.el.change_seq : null };
    cTitle.textContent = `Completing: ${completing.title}`;
    cStory.textContent = l.text;
    completeCard.hidden = false;
    drawComplete();
    completeCard.scrollIntoView({ block: 'nearest' });
    cShort.focus();
  }
  /** On each draw: the work items the report answers, and the card closed when the report is no longer handed in. */
  function drawComplete(): void {
    if (!completing) return;
    const id = completing.id;
    const l = readLines(room.els.values()).find(x => x.id === id);
    if (!room.isKeeper || !l?.report || l.report.state !== 'handed in' || l.report.proposed) {
      if (!completeBusy) {
        closeComplete();
        if (l?.report?.state === 'completed' && saidCompleted !== id) { saidCompleted = id; notice('That report is completed now.'); }
      }
      return;
    }
    // Every work item it answers, by its pair, room mark or not (the profile's reader reads one either way).
    const items = l.report.answers.map(x => room.els.get(x)).filter((el): el is NonNullable<typeof el> => !!el && isWorkItemPair(el));
    const wordOf = (el: (typeof items)[number]) => String(el.subtype ?? '').trim().toLowerCase();
    const settable = items.filter(el => maySetDone(el));
    const words = items.map(el => `${(el.name ?? '').toString().trim() || 'Untitled'} (${wordOf(el) === 'done' ? 'done already' : maySetDone(el) ? (wordOf(el) || 'open') : proposedMarkOf(el) ? 'proposed: left open' : 'left as it is'})`);
    cSetShown = settable.length > 0;
    const setWords = settable.length === 1 ? ' The work is there: set it done' : ' The work is there: set them done';
    if (cSetDoneLabel.lastChild?.textContent !== setWords) cSetDoneLabel.replaceChildren(cSetDone, setWords);
    clear(cItems, items.length ? [h('span', null, `It answers: ${words.join(', ')}.`), cSetShown ? cSetDoneLabel : null] : []);
  }
  async function completeNow(): Promise<void> {
    if (!completing || completeBusy) return;
    const target = completing;
    const typed = { short: cShort.value, changes: cChanges.value, picks: cPicks };
    completeBusy = true;
    cBtn.disabled = true;
    try {
      await room.readRole();
      if (!room.isKeeper) throw new Refused('You no longer keep this world, so you cannot complete a report.');
      if (!typed.short.trim()) throw new Refused('A completed report needs its short part: write it under In short.');
      const mine = completeDone.get(target.id) ?? new Set<string>();
      await room.complete(target.id, target.seq, { description: typed.short, changes: typed.changes, touched: typed.picks }, cSetShown && cSetDone.checked, mine, mayHaveLanded.has(target.id));
      completeDone.delete(target.id);
      mayHaveLanded.delete(target.id);
      saidCompleted = target.id;
      if (completing?.id === target.id) {
        if (cShort.value === typed.short) cShort.value = '';
        if (cChanges.value === typed.changes) cChanges.value = '';
        if (cPicks === typed.picks) { cPicks = []; drawCPicked(); }
        closeComplete();
      }
    } catch (err) {
      // Only the report's own PATCH with its answer lost may have landed; only a moved report forgets that.
      if (err instanceof CompletionFailed && err.atPatch && err.failure instanceof OwNetworkError) mayHaveLanded.add(target.id);
      else if (err instanceof ReportMoved && (err.why === 'changed' || err.why === 'gone')) mayHaveLanded.delete(target.id);
      if (err instanceof CompletionFailed && err.done.length) {
        const set = completeDone.get(target.id) ?? new Set<string>();
        for (const d of err.done) set.add(d.id);
        completeDone.set(target.id, set);
      }
      const failure = err instanceof CompletionFailed ? err.failure : err;
      const doneWords = err instanceof CompletionFailed && err.done.length
        ? `Set done: ${err.done.map(d => d.title.trim() || 'Untitled').join(', ')}. The report is not completed yet: press Complete again. ` : '';
      notice(err instanceof Refused ? err.message
        : err instanceof KeeperOnly ? 'You no longer keep this world, so you cannot complete a report.'
        : err instanceof ReportMoved ? {
          gone: 'That report is gone.',
          completed: 'That report is completed now.',
          changed: 'The report changed since you opened it. Read it again, then complete it: what you typed is kept.',
          hidden: 'That report is hidden. Unhide it first to complete it.',
        }[err.why]
        : `${doneWords}${problemLine(failure, 'completing the report')}`, true);
      if (err instanceof ReportMoved && err.why === 'changed' && completing?.id === target.id) {
        // Read again: the card takes the report as the server holds it now (the feed may be behind), keeping what
        // was typed; the next press completes that version.
        const f = err.fresh;
        if (f) { completing = { ...target, seq: typeof f.change_seq === 'number' ? f.change_seq : null }; cStory.textContent = typeof f.story === 'string' ? f.story : ''; }
      }
    } finally {
      completeBusy = false;
      cBtn.disabled = false;
      drawComplete();
    }
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
        redraw();
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
        redraw();
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
        redraw();
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
  const workMarks = markSet(workList);
  const changeMarks = markSet(changeList);
  // -------------------------------------------------- the layout
  const roomPane = h('section', { class: 'pane', 'aria-label': 'Room' }, whoLine, roomHead, nameCard, lines, room.canWrite ? completeCard : null, room.canWrite ? replyBar : null, room.canWrite ? reportNote : null, room.canWrite ? keeperPart : null, room.canWrite ? chips : null, room.canWrite ? send : null, viewer);
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
  // A redraw that is not a press's own (the feed's, a write's late answer, a fan-out settling) waits
  // while a press is in flight: a rebuild under a finger loses the tap (src/ui/press.ts).
  let gone = false;
  function redraw(): void { afterPress(heldDraw); }
  function heldDraw(): void { if (!gone) draw(); }
  function draw(): void {
    drawTop();
    drawReportMode();
    drawComplete();
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

  // The world's name and its mark are built once: the bar's other parts are redrawn on every draw, and
  // the mark is never moved, so an open fan-out and the focus on the mark stay where they are.
  const worldMark = waymarkSlot(waymarkPlan({ id: room.world.id, name: room.world.name }, null), 'world');
  const topSub = h('div', { class: 'wsub' });
  const topRest = h('div', { class: 'top-rest' });
  top.append(h('div', { class: 'brand' }, 'PARLOR'), h('div', null, h('div', { class: 'wname' }, room.world.name, worldMark.el), topSub), topRest);
  function drawTop(): void {
    const s = room.sitting();
    const seats = room.seats();
    const hostName = seats.find(x => x.role === 'host')?.name;
    topSub.textContent = [s ? s.phase : 'No sitting yet', hostName ? `host ${hostName}` : ''].filter(Boolean).join(' · ');
    clear(topRest,
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
      roomHead.append(h('p', { class: 'sys' }, room.sittingUnseen
        ? 'You can read the talk in this room: the lines of the latest sitting someone has written in. A watcher is not shown the sitting itself, its specs, its votes or its board.'
        : room.role !== 'watcher' && room.me.scope === 'read'
          ? 'You can read this room. To write in it, your account needs a PIN: set one on onlyworlds.com under Account settings, then open the room again.'
          : 'You can read this room.'));
    }
    nameCard.hidden = !room.needsName();
    const ls = room.lines();
    const entries = new Map<string, { title: string }>(room.board().map(e => [e.id, e]));
    const workItems = new Map<string, { title: string }>();
    for (const w of room.work()) { entries.set(w.id, w); workItems.set(w.id, w); }
    const sittingIds = new Set(room.sittings().map(s => s.id));
    room.files.unwatchAll();
    clear(lines, ls.length ? ls.map(l => {
      if (l.report) return reportLine(l, l.report, entries, workItems, sittingIds);
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
          l.text ? h('div', { class: 'txt' }, l.text) : null,
          fileBlock(l.id, l.by)));
    }) : h('div', { class: 'sys' }, room.canWrite ? 'No lines yet. Say hello.' : 'No lines yet.'));
    if (stickToEnd) lines.scrollTop = lines.scrollHeight;
    if (room.feed.lastError) roomHead.append(h('p', { class: 'problem' }, problemLine(room.feed.lastError, 'following the room')));
  }

  /**
   * A report in the room (the report profile's rule 3): handed in, its story's first lines and that the keeper
   * has not completed it; completed, the keeper's description open, What changed beside it, the story folded.
   * Everything it shows is text. A fold's open state is the room's, so a redraw keeps it.
   */
  function reportLine(l: Line, r: ReportPart, entries: Map<string, { title: string }>, workItems: Map<string, { title: string }>, sittingIds: ReadonlySet<string>): HTMLElement {
    const ai = room.isAi(l.by, l.el.changed_via);
    const name = room.name(l.by);
    const hidden = room.hidden.has(l.id);
    const hiddenMine = !room.isHost && l.el.hidden === true;
    const answered = r.answers.filter(id => workItems.has(id));
    // The anchor a report hangs on: its board entry, or the first of its relations the room holds (step 2 may add others first).
    const rel = Array.isArray(l.el.relations) ? (l.el.relations as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const anchorId = l.parent ?? rel.find(id => entries.has(id)) ?? null;
    const anchor = anchorId && !answered.includes(anchorId) ? entries.get(anchorId) : undefined;
    // Free talk's anchor (the report profile's third): the room's sitting it links in `events`, by that sitting's name.
    // Only a board entry or a work item the room holds stands in its place; a parent that is a report (a thread) does not.
    const evs = Array.isArray(l.el.events) ? (l.el.events as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const sitId = anchorId && entries.has(anchorId) ? null : evs.find(id => sittingIds.has(id)) ?? null;
    const sitName = sitId ? String(room.els.get(sitId)?.name ?? '').replace(/\s+/g, ' ').trim() || 'Untitled' : null;
    // Keyed by the state too: Show all on a handed-in report is not the completed one's fold of what was handed in.
    const foldKey = `${l.id}:${r.state}`;
    const open = openReports.has(foldKey);
    const fold = (label: string) => h('button', { class: 'act', type: 'button', 'data-act': 'report-fold', 'aria-expanded': String(open), onclick: () => {
      if (openReports.has(foldKey)) openReports.delete(foldKey); else openReports.add(foldKey);
      draw();
    } }, open ? 'Fold' : label);
    const start = storyStart(l.text);
    const story = r.state === 'completed'
      ? [h('div', null, fold('The report as written')), open ? h('div', { class: 'txt', 'data-part': 'report-story' }, l.text) : null]
      : [h('div', { class: 'txt', 'data-part': 'report-story' }, open || !start.cut ? l.text : start.text), start.cut ? h('div', null, fold('Show all')) : null];
    return h('div', { class: `line report${ai ? ' ai' : ''}${hidden || hiddenMine ? ' hidden' : ''}`, 'data-report': r.state },
      h('span', { class: ai ? 'bdg a' : 'bdg' }, ai ? 'AI' : initial(name)),
      h('div', null,
        h('div', { class: 'meta' }, h('span', { class: 'who' }, name), ai ? h('span', { class: 'chip' }, 'AI') : null,
          h('span', { class: 't' }, hhmm(l.at)),
          h('span', { class: 'chip report-chip' }, r.state === 'other' ? (r.word ? `Report · ${r.word}` : 'Report') : `Report · ${r.state}`),
          r.proposed ? h('span', { class: 'chip prop', 'data-part': 'report-proposed' }, 'Proposed') : null,
          ...answered.map(id => h('span', { class: 't' }, `answers ${workItems.get(id)!.title || 'Untitled'}`)),
          anchor ? h('span', { class: 't' }, `on ${anchor.title || 'Untitled'}`) : null,
          sitName ? h('span', { class: 't', 'data-part': 'report-sitting' }, `said in the sitting ${sitName}`) : null,
          hidden ? h('span', { class: 't' }, 'Hidden from the room') : null,
          hiddenMine ? h('span', { class: 't' }, 'Hidden by the host: only you and the hosts see it') : null,
          room.isHost ? h('button', { class: 'act', type: 'button', onclick: () => hide(l.id, !hidden) }, hidden ? 'Unhide' : 'Hide this report') : null,
          // Step 2 in the room: a keeper completes a handed-in report in its own card.
          // Not on a proposed report: a keeper's step 2 over a proposal would read as settling it, and nothing rules that.
          room.isKeeper && r.state === 'handed in' && !hidden && !r.proposed ? h('button', { class: 'act', type: 'button', 'data-act': 'complete', onclick: () => openComplete(l, r) }, 'Complete this report') : null),
        r.title ? h('div', { class: 'report-title' }, r.title) : null,
        r.description.trim() ? h('div', { class: 'txt', 'data-part': 'report-description' }, r.description) : null,
        r.proposed ? h('p', { class: 'sys', 'data-part': 'report-proposed-line' }, 'Proposed and not yet reviewed: this report, and any change it names, is not part of the world until a keeper accepts it.') : null,
        r.state === 'handed in' && !r.proposed ? h('p', { class: 'sys' }, 'Not completed yet: a host reads it next.') : null,
        r.state === 'completed'
          ? h('div', { class: 'report-changes', 'data-part': 'report-changes' }, h('div', { class: 'ph' }, 'What changed'),
            r.consequences.length ? h('ul', null, r.consequences.map(c => { const { words, address } = splitConsequence(c); return h('li', address ? { title: address, 'data-address': address } : null, words); })) : h('p', { class: 'sys' }, 'No changes written.'))
          : null,
        ...story,
        fileBlock(l.id, l.by)));
  }

  /** A line's files under its text: what the world's list holds, then mine still on their way. */
  function fileBlock(lineId: string, lineBy: string): HTMLElement | null {
    const rows = room.files.onLine(lineId);
    const pend = room.files.pendingOn(lineId);
    if (!rows.length && !pend.length) return null;
    return h('div', { class: 'files' }, rows.map(r => fileRow(r, lineBy)), pend.map(pendingRow));
  }

  function fileRow(r: OwWorldFileRow, lineBy: string): HTMLElement {
    const by = adderOf(r, OWNER); // null: a former member, never the owner
    const img = room.files.preview(r);
    const pic = img
      ? h('button', { class: 'file-pic', type: 'button', 'aria-label': `Show ${r.name} full size`, onclick: () => {
        const url = room.files.previewUrl(r.id);
        if (!url) return;
        viewerImg.src = url;
        viewerImg.alt = r.name;
        viewer.showModal();
      } }, img)
      : room.files.wantsPreview(r) ? waitingBox(r) : null;
    return h('div', { class: 'file', 'data-file': r.id }, pic,
      h('div', { class: 'file-line' },
        h('span', { class: 'file-name' }, r.name),
        h('span', { class: 't' }, ` ${r.kind} · ${sizeWords(r.size)}${by !== lineBy ? ` · added by ${by === null ? 'a former member' : room.name(by)}` : ''}`),
        h('button', { class: 'act', type: 'button', 'data-act': 'download-file', onclick: async () => {
          try { await room.files.download(r); } catch (err) { notice(problemLine(err, 'downloading the file'), true); }
        } }, 'Download'),
        room.files.mayRemove(r, room.me, room.canWrite)
          ? h('button', { class: 'act', type: 'button', 'data-act': 'remove-file', onclick: async () => {
            if (!window.confirm(`Remove ${r.name} from this line? It is deleted from OnlyWorlds for everyone.`)) return;
            try { await room.files.remove(r); } catch (err) { notice(problemLine(err, 'removing the file'), true); }
          } }, 'Remove')
          : null));
  }

  /** A picture's box, drawn before it loads; it loads once it comes into view. */
  function waitingBox(r: OwWorldFileRow): HTMLElement {
    const box = h('div', { class: 'file-pic', 'aria-hidden': 'true' });
    room.files.watch(box, r);
    return box;
  }

  function pendingRow(p: Pending): HTMLElement {
    if (p.state === 'failed') {
      return h('div', { class: 'file failed', 'data-pending': String(p.key) },
        h('div', { class: 'file-line' }, h('span', { class: 'problem' }, p.problem ?? `${p.name} was not added.`),
          p.retry ? h('button', { class: 'act', type: 'button', onclick: () => room.files.again(p.key) }, 'Try again') : null,
          h('button', { class: 'act', type: 'button', onclick: () => room.files.drop(p.key) }, 'Drop')));
    }
    const state = h('span', { class: 't' }, progressWords(p));
    room.files.progressInto(p.key, state);
    return h('div', { class: 'file sending', 'data-pending': String(p.key) },
      h('div', { class: 'file-line' }, h('span', { class: 'file-name' }, p.name), state));
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
      redraw();
    } catch (err) {
      notice(problemLine(err, on ? 'hiding the line' : 'unhiding the line'), true);
    }
  }

  /**
   * The host bar is rebuilt only when what it shows moved: a press that straddles a rebuild
   * lands on a node that is gone, so a feed tick from someone else's line must not cost a
   * host's click (a walk lost a phase press that way).
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
    const loose = charter ? [] : room.unmarkedCharters();
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
    // Picks belong to one sitting: a new sitting starts with none of the last one's.
    if (s?.id !== picksFor) { picks = []; picksFor = s?.id ?? null; }
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
            try { await room.setHeart(spec.id, spec.title, !iHearted); } catch (err) { notice(problemLine(err, 'leaving a heart'), true); }
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
      // The views file's charter row leads with description, drawn open: the house rules are read, never folded.
      charter ? h('section', { class: 'card', 'data-part': 'house-rules' }, h('h3', null, charter.name || 'House rules'), h('p', null, charter.text)) : null,
      // A Law with supertype Charter and no mark is lore (the charter profile): the keeper names one to mark, in one
      // write; the parlor never picks, so each such Law gets its own button, named.
      !charter && loose.length && room.isKeeper ? h('div', { class: 'card', 'data-part': 'charter-offer' },
        h('p', { class: 'sys' }, loose.length === 1
          ? `This world has a Law with supertype Charter that is not marked as its charter, so the room does not show it as house rules.`
          : `This world has ${loose.length} Laws with supertype Charter, none marked as its charter, so the room shows no house rules. Mark the one that holds this world's rules.`),
        h('div', { class: 'btns' }, loose.map(c => h('button', { class: 'btn quiet', type: 'button', onclick: async () => {
          try { await room.markCharter(c.id); } catch (err) { notice(problemLine(err, 'marking the charter'), true); }
        } }, `Mark ${c.name.trim() || 'Untitled'}${loose.filter(o => o.name.trim() === c.name.trim()).length > 1 ? ` (${c.text.replace(/\s+/g, ' ').trim().slice(0, 40) || c.id.slice(0, 8)})` : ''} as this world's charter`)))) : null,
      !s ? h('div', { class: 'empty' }, h('h3', null, 'No sitting yet'), h('p', null, room.isHost ? 'Start the first sitting when people are here.' : 'The host has not started a sitting. The room is open: say hello.')) : null,
      s && !room.isHost ? h('div', { class: 'phases', 'aria-label': 'Phase' }, PHASES.map(p => h('span', { class: p.name === s.phase ? 'pp now' : 'pp' }, p.name))) : null,
      s && !room.isHost ? h('div', { class: 'sw' },
        h('span', { class: s.hearts ? 'chip on' : 'chip' }, `Hearts: ${s.hearts ? 'on' : 'off'}`),
        h('span', { class: s.specs ? 'chip on' : 'chip' }, `Specs shown: ${s.specs ? 'on' : 'off'}`),
        h('span', { class: s.voting ? 'chip on' : 'chip' }, `Voting: ${s.voting ? 'open' : 'closed'}`)) : null,
      voting && live ? h('div', { class: 'hostbar' },
        h('div', null, picks.length ? `Your picks: ${picks.map((id, i) => `${i + 1}. ${specs.find(x => x.id === id)?.title ?? '?'}`).join('  ')}` : 'Pick up to three, in order.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn entry', type: 'button', disabled: !picks.length, onclick: async () => {
          try {
            const sent = await room.vote(picks);
            notice(sent ? 'Your vote is in. You can change it while voting is open.' : 'Voting has closed, so your vote was not sent.', !sent);
          } catch (err) { notice(problemLine(err, 'sending your vote'), true); }
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
    // Whom it is for: its person and the Titles whose holders it is for (x_packet_for); neither is no one, never everyone.
    const whoOf = (w: { forWho: string | null; forTitles: string[] }) => [
      ...(w.forWho ? [room.characterName(w.forWho)] : []),
      ...w.forTitles.map(t => `whoever holds ${room.elementName(t) ?? 'a Title'}`),
    ].join(' or ');
    const view = room.work().map(w => ({
      w, can: room.canRetire(w.by), hidden: room.hidden.has(w.id) || (!room.isHost && w.el.hidden === true),
      who: whoOf(w), addr: room.addressOf(w), by: room.name(w.by), answers: room.answers(w.id).length,
      els: w.elements.map(x => ({ ...x, name: w.otherWorld ? null : room.elementName(x.id) })),
      // One name per taker: a double take from two tabs is one person (the Take gate's T2-G1).
      takers: [...new Set(w.takes.map(t => t.by))].map(by => room.name(by)), mine: room.hasTaken(w.id),
      // For a keeper: a completed report answers an item still open (a lost answer, a closed tab, another tool's report).
      reported: room.isKeeper && w.state !== 'done' && room.answers(w.id).some(l => l.report?.state === 'completed' && !l.report.proposed && l.report.answers.includes(w.id)),
    }));
    // For you first, then for others, then addressed to no one; a heading only when there is more than one group.
    const GROUP = { mine: 'For you', others: 'For others', none: 'Not addressed to anyone' } as const;
    const grouped = <T extends { addr: keyof typeof GROUP }>(rows: T[], card: (r: T) => HTMLElement): HTMLElement[] => {
      const order = (['mine', 'others', 'none'] as const).filter(g => rows.some(r => r.addr === g));
      return order.flatMap(g => [...(order.length > 1 ? [h('h3', { class: 'wgroup' }, GROUP[g])] : []), ...rows.filter(r => r.addr === g).map(card)]);
    };
    const key = JSON.stringify([view.map(v => [v.w.id, v.w.title, v.w.text, v.w.state, v.w.proposed, v.w.otherWorld, v.can, v.hidden, v.who, v.addr, v.by, v.answers, v.els, v.takers, v.mine, v.reported]),
      room.canWrite, room.isHost, room.needsName(), workOpen, deleting]);
    if (key === workKey) return;
    // An open fan-out (or its toast) holds the rebuild; the key stays old, so it runs once the fan-out settles.
    if (workMarks.held()) return;
    workKey = key;
    const focused = workMarks.before();
    const world = { id: room.world.id, name: room.world.name };
    clear(workList,
      h('p', { class: 'sys' }, 'Work on this world: each item says what it is about, and opens in the room when you answer it.'),
      view.length ? grouped(view, ({ w, can, hidden, who, by, answers, els, takers, mine, reported }) => h('div', { class: `card witem${w.state === 'done' ? ' done' : ''}${hidden ? ' hidden' : ''}` },
        h('div', { class: 'ttl' }, h('span', { class: `chip s-${w.state}` }, STATE_WORD[w.state]), w.proposed ? h('span', { class: 'chip prop' }, 'Proposed') : null,
          h('h3', null, w.title || 'Untitled')),
        h('div', { class: 'm', 'data-part': 'for' }, `${who ? `For ${who}` : 'Not addressed to anyone'} · made by ${by}`),
        // Who took it, by the takes' makers (contract T2); Done wins over a take.
        takers.length && w.state !== 'done' ? h('div', { class: 'm', 'data-part': 'taken-by' }, `Taken by ${takers.join(', ')}`) : null,
        w.text ? h('p', null, w.text) : null,
        els.length ? h('ul', { class: 'about' }, els.map(x => h('li', null,
          h('span', { class: 'chip el' }, w.otherWorld ? `In another world · ${typeWord(x.type)}` : x.name === null ? `Missing · ${typeWord(x.type)}` : `${x.name} · ${typeWord(x.type)}`),
          // A Missing element or one in another world has no page here to open. The mark takes the element
          // the room holds, its own type and body, never the type a packet claims for it.
          !w.otherWorld && x.name !== null && room.els.get(x.id)
            ? workMarks.mark(waymarkPlan(world, room.els.get(x.id) as unknown as Record<string, unknown>, 'Untitled'), `work:${w.id}:${x.id}`) : null,
          x.reason ? h('span', { class: 'why' }, x.reason) : null))) : null,
        answers || hidden ? h('div', { class: 'm' }, [answers ? `${answers} answer${answers === 1 ? '' : 's'} in the room` : '',
          hidden ? (room.isHost ? 'Hidden from the room' : 'Hidden by the host: only you and the hosts see it') : ''].filter(Boolean).join(' · ')) : null,
        reported ? h('div', { class: 'm', 'data-part': 'reported' }, 'A completed report answers this item: Mark done once the work is there.') : null,
        deleting === w.id
          ? h('div', { class: 'btns' }, h('span', { class: 'sys' }, 'Delete this work item for everyone?'),
            h('button', { class: 'btn std', type: 'button', onclick: async () => {
              deleting = null;
              try { await room.deleteWork(w.id); } catch (err) { notice(problemLine(err, 'deleting the work item'), true); }
              redraw();
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
              redraw();
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
    workMarks.after(focused);
  }

  /** The world's recent changes: who, which door, an AI's rows marked (sheet §2). Drawn only when the list moved. */
  let changesKey = '';
  function drawChanges(): void {
    const rows = room.changes().map(c => ({ c, who: room.name(c.by), ai: room.isAi(c.by, c.el.changed_via), door: doorLine(c.el), fresh: isAfter(c.at, seenBefore) }));
    const key = JSON.stringify(rows.map(r => [r.c.id, r.c.name, r.c.at, r.who, r.ai, r.door, r.fresh]));
    if (key === changesKey) return;
    // An open fan-out (or its toast) holds the rebuild; the key stays old, so it runs once the fan-out settles.
    if (changeMarks.held()) return;
    changesKey = key;
    const focused = changeMarks.before();
    const world = { id: room.world.id, name: room.world.name };
    clear(changeList,
      h('p', { class: 'sys' }, seenBefore ? 'What changed in the world, newest first; new since you last opened the room are marked.' : 'What changed in the world, newest first.'),
      rows.length ? h('ul', { class: 'changes' }, rows.map(({ c, who, ai, door, fresh }) => h('li', { class: ai ? 'ai' : '' },
        h('span', { class: ai ? 'bdg a' : 'bdg' }, ai ? 'AI' : initial(who)),
        h('div', null,
          h('div', null, h('span', { class: 'nm' }, c.name), changeMarks.mark(waymarkPlan(world, { ...c.el, id: c.id, type: c.type, name: c.name }), `change:${c.id}`), ' ', h('span', { class: 't' }, c.type.charAt(0).toUpperCase() + c.type.slice(1)), fresh ? h('span', { class: 'chip on' }, 'New') : null),
          h('div', { class: 't' }, [`${c.made ? 'made' : 'changed'} by ${who}`, ai ? 'an AI' : '', door ?? '', hhmm(c.at)].filter(Boolean).join(' · '))))))
        : h('div', { class: 'empty' }, h('h3', null, 'Nothing yet'), h('p', null, 'When someone adds to the world or changes it, it shows here.')),
    );
    changeMarks.after(focused);
  }

  // A fan-out that settled lets its panel's held rebuild run.
  const onSettled = (): void => redraw();
  root.addEventListener(WAYMARK_SETTLED, onSettled);
  const off = room.feed.subscribe(redraw);
  draw();
  return () => {
    gone = true;
    window.removeEventListener('beforeunload', onLeavePage);
    off();
    root.removeEventListener(WAYMARK_SETTLED, onSettled);
    workMarks.dispose();
    changeMarks.dispose();
    worldMark.dispose();
    mq.removeEventListener('change', onWidth);
    room.close();
  };
}
