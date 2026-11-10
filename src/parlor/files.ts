/**
 * Files on a line. keel keeps files on any element (its files lane, images since
 * 2026-11-10); a room line is a Narrative, so a file goes on the line itself.
 *
 * A file change never moves the line in `/changes`, so the feed cannot see one
 * arrive: the room reads the world's files (`GET /world/files`, one call) at open,
 * after an upload of its own, soon after a new line, and every 20 s while in front.
 * Uploads run one at a time on their own queue, never behind the room's writes, and
 * each keeps its ticket, so a retry after a lost answer reuses it and keel's
 * `exists` reads as done: a file that landed is never sent twice.
 */

import {
  FILE_EXTENSIONS, OwApiError, OwNetworkError, fileKindOf,
  type OwFileKind, type OwFileTicket, type OwMe, type OwV2Client, type OwWorldFileRow,
} from '@onlyworlds/sdk';
import { serialQueue } from './serial';

/** keel's 25 MB is binary: 26,214,400 bytes. */
export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_PICKS = 5;
/** An image at most this size shows as a preview; a larger one is a row only. */
export const PREVIEW_MAX = 8 * 1024 * 1024;
export const ACCEPT = Object.keys(FILE_EXTENSIONS).map(e => `.${e}`).join(',');

const IMAGE_TYPE: Partial<Record<OwFileKind, string>> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
export const isImage = (kind: string): boolean => kind in IMAGE_TYPE;

/** "12.4 MB", "340 KB", "300 bytes", by binary units as keel counts. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 100 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}

/** Why a picked file cannot go, before anything is sent; null when it can. */
export function pickRefusal(file: { name: string; size: number }): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'heic' || ext === 'heif') return `${file.name}: OnlyWorlds does not take .${ext}. Save it as a jpg and add that.`;
  if (!fileKindOf(file.name)) return `${file.name}: OnlyWorlds takes text, a pdf, a picture (png, jpg, webp, avif) or a world's own bundle (.zip). This file is none of those.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_BYTES) return `${file.name} is ${sizeWords(file.size)}; a file can be at most 25 MB.`;
  if (file.name.length > 255) return `${file.name.slice(0, 40)}…: the name is too long (at most 255 characters).`;
  return null;
}

const code = (err: unknown): string | null => (err instanceof OwApiError ? err.code ?? null : null);
const status = (err: unknown): number => (err instanceof OwApiError ? err.status : 0);

/** A refused file in the person's words, and whether Try again can help. Never keel's raw text. */
export function fileProblem(err: unknown, name: string): { line: string; retry: boolean } {
  const c = code(err);
  if (err instanceof OwNetworkError) return { line: `${name} was not added: OnlyWorlds could not be reached.`, retry: true };
  if (c === 'file_too_large' || c === 'too_large') return { line: `${name} was not added: a file can be at most 25 MB.`, retry: false };
  if (c === 'files_full') return { line: `${name} was not added: this world's files are full (250 MB). Remove a file, or ask the owner.`, retry: false };
  if (c === 'unsupported_type') return { line: `${name} was not added: its contents are not what its name says (a picture must be the kind its name says, a text file text, a .pdf a PDF, a .zip a world's own bundle).`, retry: false };
  if (c === 'quota_exceeded') return { line: `${name} was not added: this world has added as many files as it may today. Try again tomorrow.`, retry: false };
  if (c === 'ticket_expired' || c === 'ticket_invalid' || c === 'ticket_used') return { line: `${name} was not added: its sending took too long.`, retry: true };
  if (status(err) === 404) return { line: `${name} was not added: the line is gone, or hidden from you.`, retry: false };
  if (c === 'not_author' || status(err) === 403) return { line: `${name} was not added: your seat cannot add a file to that line.`, retry: false };
  if (c === 'pin_required' || status(err) === 401) return { line: `${name} was not added: your PIN did not match. Check your PIN on Your parlors.`, retry: false };
  if (status(err) === 429) return { line: `${name} was not added: too many requests for a moment. Wait a little and try again.`, retry: true };
  return { line: `${name} was not added: something went wrong. Try again in a moment.`, retry: true };
}

/** One of my files on its way to a line (shown under the line until the world's list holds it). */
export interface Pending {
  key: number;
  lineId: string;
  file: Blob;
  name: string;
  size: number;
  loaded: number;
  state: 'sending' | 'failed' | 'landed';
  ticket: OwFileTicket | null;
  /** Every file id a ticket of this upload was given: the list holding any of them means it landed. */
  fileIds: string[];
  problem: string | null;
  retry: boolean;
}

interface Preview { state: 'loading' | 'ready' | 'failed'; url?: string; img?: HTMLImageElement }

type Client = Pick<OwV2Client, 'worldFiles' | 'createFileTicket' | 'uploadFile' | 'fileDownloadLink' | 'removeFile'>;

export class RoomFiles {
  /** Every live file the key may see, filtered to a line at draw time (a line the feed has not brought yet keeps its files). */
  rows: OwWorldFileRow[] = [];
  readonly pending: Pending[] = [];
  private closed = false;
  private reading: Promise<boolean> | null = null;
  /** Files removed here: never shown again in this room, whatever an older read answers. */
  private removed = new Set<string>();
  /** The progress text of each upload, written in place (a full redraw four times a second would move focus). */
  private progressText = new Map<number, HTMLElement>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private uploads = serialQueue();
  private nextKey = 1;
  private previews = new Map<string, Preview>();
  private fetching = 0;
  private waiting: Array<() => void> = [];
  private lastProgress = 0;
  private seen: IntersectionObserver | null = null;
  private watched = new Map<Element, OwWorldFileRow>();

  constructor(private readonly client: Client, private readonly onChange: () => void, private readonly visible: () => boolean = () => true) {}

  start(): void {
    void this.read();
    this.poll = setInterval(() => { if (this.visible()) void this.read(); }, 20000);
  }

  close(): void {
    this.closed = true;
    if (this.poll) clearInterval(this.poll);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const p of this.previews.values()) if (p.url) URL.revokeObjectURL(p.url);
    this.previews.clear();
    this.unwatchAll();
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.closed) fn(); }, ms);
    this.timers.add(t);
  }

  /** A new line arrived: someone's upload follows their line, so read soon, then once more. */
  soon(): void {
    this.later(1000, () => void this.read());
    this.later(6000, () => void this.read());
  }

  /**
   * One read of the world's files; never two at once; a failure keeps the last list and says nothing
   * (true when the read worked). A file removed here stays out, whatever a read begun before the
   * remove still answers (the code gate's S1).
   */
  read(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.reading) return this.reading;
    this.reading = (async () => {
      try {
        const got = await this.client.worldFiles();
        if (this.closed) return false;
        const fresh = got.data.filter(r => !this.removed.has(r.id));
        const sig = (rs: OwWorldFileRow[]) => rs.map(r => `${r.id}:${r.size}:${r.element_id}`).join('|');
        const moved = sig(fresh) !== sig(this.rows);
        this.rows = fresh;
        // A file of mine the list now holds is no longer pending, whichever of its tickets landed it.
        const held = new Set(this.rows.map(r => r.id));
        const before = this.pending.length;
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const p = this.pending[i];
          if (p.state !== 'sending' && p.fileIds.some(id => held.has(id))) this.pending.splice(i, 1);
        }
        const gone = new Set([...this.previews.keys()].filter(id => !held.has(id)));
        for (const id of gone) this.dropPreview(id);
        if (moved || this.pending.length !== before) this.changed();
        return true;
      } catch { return false; /* the room still works; the next read tries again */ } finally {
        this.reading = null;
      }
    })();
    return this.reading;
  }

  /** Tell the room; a listener's throw never reaches an upload or a read. */
  private changed(): void {
    if (this.closed) return;
    try { this.onChange(); } catch { /* the next draw shows it */ }
  }

  /** The files on one line, oldest first, as the list holds them. */
  onLine(lineId: string): OwWorldFileRow[] {
    return this.rows.filter(r => r.element_id === lineId && r.element_type === 'narrative')
      .sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id));
  }

  /** My files still on their way to a line (or landed and not listed yet). */
  pendingOn(lineId: string): Pending[] {
    const listed = new Set(this.onLine(lineId).map(r => r.id));
    return this.pending.filter(p => p.lineId === lineId && !p.fileIds.some(id => listed.has(id)));
  }

  /** Send each file to the line, one at a time (I2: the line is already made, once). */
  attach(lineId: string, files: ReadonlyArray<File>): void {
    for (const file of files) {
      const p: Pending = { key: this.nextKey++, lineId, file, name: file.name, size: file.size, loaded: 0, state: 'sending', ticket: null, fileIds: [], problem: null, retry: false };
      this.pending.push(p);
      void this.uploads(() => this.send(p));
    }
    this.changed();
  }

  /** Is anything of mine still on its way? (Leaving the page then loses it: the view asks first.) */
  get sending(): boolean {
    return this.pending.some(p => p.state === 'sending');
  }

  /** The node a pending row writes its progress into, in place. */
  progressInto(key: number, el: HTMLElement): void {
    this.progressText.set(key, el);
  }

  /** Try again: to the line the failure belonged to (I3), with its ticket when it still has one. */
  again(key: number): void {
    const p = this.pending.find(x => x.key === key);
    if (!p || p.state !== 'failed' || !p.retry) return;
    p.state = 'sending';
    p.problem = null;
    p.loaded = 0;
    this.changed();
    void this.uploads(() => this.send(p));
  }

  drop(key: number): void {
    const i = this.pending.findIndex(x => x.key === key);
    if (i >= 0 && this.pending[i].state !== 'sending') this.pending.splice(i, 1);
    this.changed();
  }

  private async send(p: Pending): Promise<void> {
    if (this.closed) return;
    try {
      if (!p.ticket) {
        p.ticket = await this.client.createFileTicket('narrative', p.lineId, { name: p.name, size: p.size });
        p.fileIds.push(p.ticket.file_id);
      }
      if (this.closed) return;
      await this.client.uploadFile('narrative', p.lineId, p.file, {
        ticket: p.ticket,
        onProgress: (loaded) => {
          p.loaded = loaded;
          const now = Date.now();
          if (now - this.lastProgress < 100 || this.closed) return;
          this.lastProgress = now;
          const el = this.progressText.get(p.key);
          if (el?.isConnected) el.textContent = progressWords(p);
        },
      });
      this.landed(p);
    } catch (err) {
      if (this.closed) return;
      // The bytes are already stored under this ticket: an earlier send landed (the host's 409).
      if (code(err) === 'exists') { this.landed(p); return; }
      const c = code(err);
      if (p.ticket && (c === 'ticket_expired' || c === 'ticket_used' || c === 'ticket_invalid')) {
        // Ask the list before a new ticket: a lost answer may have landed the file. Only a list that was
        // read and does not hold it frees a new ticket; a failed read keeps this one (the gate's S6).
        const read = await this.read();
        if (this.closed) return;
        if (this.rows.some(r => p.fileIds.includes(r.id))) { this.landed(p); return; }
        if (read) p.ticket = null;
      }
      const said = fileProblem(err, p.name);
      p.state = 'failed';
      p.problem = said.line;
      p.retry = said.retry;
      this.changed();
    }
  }

  private landed(p: Pending): void {
    if (this.closed) return;
    p.state = 'landed';
    p.loaded = p.size;
    this.changed();
    // The upload host reports to keel a moment after the bytes land.
    void this.read();
    this.later(3000, () => void this.read());
    this.later(8000, () => void this.read());
  }

  /** Remove shows only where keel would allow it: a writing key, and the owner or the file's uploader (I5). */
  mayRemove(row: OwWorldFileRow, me: OwMe, canWrite: boolean): boolean {
    if (!canWrite) return false;
    if (me.role === 'owner') return true;
    return !!me.membership && row.added_by.membership === me.membership;
  }

  async remove(row: OwWorldFileRow): Promise<void> {
    try {
      await this.client.removeFile('narrative', row.element_id, row.id);
    } catch (err) {
      if (status(err) !== 404) throw err; // already gone
    }
    this.removed.add(row.id);
    this.rows = this.rows.filter(r => r.id !== row.id);
    this.dropPreview(row.id);
    this.changed();
  }

  /** The bytes, fetched now on a short-lived link (keel's: five minutes) and handed to the browser to save. */
  async download(row: OwWorldFileRow): Promise<void> {
    const link = await this.client.fileDownloadLink('narrative', row.element_id, row.id);
    const res = await fetch(link.url);
    if (!res.ok) throw new Error(`the download host answered ${res.status}`);
    const blob = new Blob([await res.arrayBuffer()], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = row.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** An image's preview node once it has loaded, kept per file so a redraw re-appends the same node (I7). */
  preview(row: OwWorldFileRow): HTMLImageElement | null {
    const have = this.previews.get(row.id);
    return have?.state === 'ready' ? have.img ?? null : null;
  }

  /** A picture that shows as a preview: its box is drawn at once, so the lines never move when it loads. */
  wantsPreview(row: OwWorldFileRow): boolean {
    return isImage(row.kind) && row.size <= PREVIEW_MAX && this.previews.get(row.id)?.state !== 'failed';
  }

  /**
   * Load a preview only when its box comes into view: a room full of screens downloads only what is seen.
   * The view hands over each box it draws; a redraw first lets go of the boxes it is about to replace.
   */
  watch(box: Element, row: OwWorldFileRow): void {
    if (this.closed || this.previews.has(row.id)) return;
    if (typeof IntersectionObserver === 'undefined') { this.load(row); return; }
    this.seen ??= new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const r = this.watched.get(e.target);
        this.seen?.unobserve(e.target);
        this.watched.delete(e.target);
        if (r) this.load(r);
      }
    }, { rootMargin: '200px' });
    this.watched.set(box, row);
    this.seen.observe(box);
  }

  /** Before a redraw replaces the boxes. */
  unwatchAll(): void {
    this.seen?.disconnect();
    this.watched.clear();
  }

  /**
   * Fetch a picture once (I7): the bytes come only from keel's download link, and the Blob's type comes from
   * the file's kind, never the response (I6).
   */
  private load(row: OwWorldFileRow): void {
    if (this.closed || this.previews.has(row.id) || !isImage(row.kind) || row.size > PREVIEW_MAX) return;
    const p: Preview = { state: 'loading' };
    this.previews.set(row.id, p);
    void this.slot(async () => {
      try {
        const link = await this.client.fileDownloadLink('narrative', row.element_id, row.id);
        const res = await fetch(link.url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = new Blob([await res.arrayBuffer()], { type: IMAGE_TYPE[row.kind as OwFileKind] });
        if (this.closed || this.previews.get(row.id) !== p) return;
        p.url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.className = 'file-preview';
        img.alt = row.name;
        img.decoding = 'async';
        img.src = p.url;
        img.addEventListener('error', () => { p.state = 'failed'; img.remove(); this.changed(); });
        p.img = img;
        p.state = 'ready';
        this.changed();
      } catch {
        p.state = 'failed';
        this.changed();
      }
    });
  }


  /** The full picture's address for the in-page view, once its preview is ready. */
  previewUrl(fileId: string): string | null {
    const p = this.previews.get(fileId);
    return p?.state === 'ready' ? p.url ?? null : null;
  }

  private dropPreview(id: string): void {
    const p = this.previews.get(id);
    if (p?.url) URL.revokeObjectURL(p.url);
    this.previews.delete(id);
  }

  /** At most two preview fetches at once. */
  private async slot(job: () => Promise<void>): Promise<void> {
    if (this.fetching >= 2) await new Promise<void>(res => this.waiting.push(res));
    if (this.closed) { this.waiting.shift()?.(); return; }
    this.fetching++;
    try { await job(); } finally {
      this.fetching--;
      this.waiting.shift()?.();
    }
  }
}

/** A pending row's state in words: sending with its share, or added. */
export function progressWords(p: Pick<Pending, 'state' | 'loaded' | 'size'>): string {
  if (p.state === 'landed') return ' · added';
  return ` · sending ${p.size ? Math.round((p.loaded / p.size) * 100) : 0}%`;
}

/** A line with files and no words is named by its files, within a Narrative name's 60 characters. */
export function filesName(files: ReadonlyArray<{ name: string }>): string {
  return files.map(f => f.name).join(', ');
}
