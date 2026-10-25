/**
 * The one way the parlor makes DOM. Text goes in through text nodes only, so a
 * quote or a tag in a line or a spec stays text, and no markup is ever built
 * from strings.
 */

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'style') {
      // The host's policy allows no inline style (public/_headers, style-src 'self'): a class does it.
      throw new Error(`h(${tag}): no style attribute, use a class`);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value' || k === 'disabled' || k === 'checked' || k === 'hidden') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: Element, ...children: Array<Child | Child[]>): void {
  el.replaceChildren();
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** One short sentence at the bottom of the page for a few seconds. */
export function notice(text: string, bad = false): void {
  document.querySelector('.notice')?.remove();
  if (noticeTimer) clearTimeout(noticeTimer);
  const n = h('div', { class: bad ? 'notice bad' : 'notice', role: bad ? 'alert' : 'status' }, text);
  document.body.append(n);
  noticeTimer = setTimeout(() => n.remove(), bad ? 7000 : 3500);
}

export function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
