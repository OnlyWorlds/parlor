/**
 * The shapes the room draws for who and what: a seat as a grey shape (a person round, an AI a rounded square, the
 * seat's letter inside, a whole ring while it is working), and an element as a dark disc with a rim in its kind's
 * colour and its kind's icon inside. Colour lives only in an element's body. Built as SVG nodes, never markup from
 * text, and with no style attribute (the host's policy allows none).
 */

import { elementColor, groupOf, type ElementType } from '@onlyworlds/sdk';
import { TYPE_ICON_PATHS } from './type-icons';

const NS = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

/** A type's colour on a dark surface, and a lighter one for its icon; grey for a type the SDK does not know. */
export function kindColours(type: string): { rim: string; lift: string } {
  let rim = '#667181';
  try { rim = elementColor(type as ElementType, 'dark'); } catch { /* a type the SDK does not know */ }
  const v = [1, 3, 5].map(i => parseInt(rim.slice(i, i + 2), 16));
  const lift = '#' + v.map(c => Math.round(c + (255 - c) * 0.35).toString(16).padStart(2, '0')).join('');
  return { rim, lift };
}

/** A seat's body: `d` pixels wide. */
export function seatBody(name: string, ai: boolean, working: boolean, d: number): SVGSVGElement {
  const r = d / 2;
  const pad = working ? Math.max(3, d * 0.11) : 0;
  const inner = d - pad * 2;
  const svg = s('svg', { class: 'body', width: d, height: d, viewBox: `0 0 ${d} ${d}`, 'aria-hidden': 'true', focusable: 'false' });
  // A working seat wears a whole ring: it says working, never how far along.
  if (working) svg.append(s('circle', { class: 'ring', cx: r, cy: r, r: r - 1.25, fill: 'none', 'stroke-width': 2 }));
  svg.append(s('rect', { class: 'shape', x: pad, y: pad, width: inner, height: inner, rx: ai ? inner * 0.28 : inner / 2 }));
  const letter = s('text', { class: 'letter', x: r, y: r, dy: '.35em', 'text-anchor': 'middle', 'font-size': (inner * 0.46).toFixed(1), 'font-weight': 700 });
  letter.textContent = (Array.from(name.trim())[0] ?? '?').toUpperCase();
  svg.append(letter);
  return svg;
}

/** An element's body: `d` pixels wide, `x`/`y` when it sits inside another drawing. */
export function kindBody(type: string, d: number, at?: { x: number; y: number }): SVGSVGElement {
  const { rim, lift } = kindColours(type);
  const w = d * 0.62, o = (d - w) / 2;
  const svg = s('svg', { class: 'body el-body', width: d, height: d, viewBox: `0 0 ${d} ${d}`, 'aria-hidden': 'true', focusable: 'false', ...(at ? { x: at.x, y: at.y } : {}) });
  svg.append(s('circle', { class: 'disc', cx: d / 2, cy: d / 2, r: d / 2 - 0.75, stroke: rim, 'stroke-width': 1.5 }));
  const path = TYPE_ICON_PATHS[type];
  if (path) svg.append(s('svg', { x: o, y: o, width: w, height: w, viewBox: '0 -960 960 960' }, s('path', { d: path, fill: lift })));
  return svg;
}

/** The team chat's own mark: lines in a rounded square. */
export function chatBody(d: number): SVGSVGElement {
  return s('svg', { class: 'body chat', width: d, height: d, viewBox: '0 0 38 38', 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { class: 'chat-bg', x: 4, y: 4, width: 30, height: 30, rx: 9 }),
    s('path', { class: 'chat-lines', d: 'M13 15.5h12M13 19.5h12M13 23.5h7', fill: 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
}

/** A small icon for a tab, drawn on a 16-pixel grid. */
const TAB_ICONS: Record<string, string[]> = {
  crew: ['M6 3.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8Z', 'M1.8 13c.5-2.3 2.2-3.4 4.2-3.4s3.7 1.1 4.2 3.4', 'M11.5 2.6h1.6a1.2 1.2 0 0 1 1.2 1.2v1.6a1.2 1.2 0 0 1-1.2 1.2h-1.6a1.2 1.2 0 0 1-1.2-1.2v-1.6a1.2 1.2 0 0 1 1.2-1.2Z'],
  work: ['M5 2.5h6a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-6a2.5 2.5 0 0 1-2.5-2.5v-6a2.5 2.5 0 0 1 2.5-2.5Z', 'M5.3 8.2l1.9 1.9 3.6-4'],
  designs: ['M8 2l5.5 3L8 8 2.5 5z', 'M2.5 8.2L8 11.2l5.5-3M2.5 11L8 14l5.5-3'],
  changes: ['M13 5.5A5.3 5.3 0 0 0 3.4 5M3 10.5a5.3 5.3 0 0 0 9.6.5', 'M13.2 2.6v3h-3M2.8 13.4v-3h3'],
  board: ['M4 14V2.5', 'M4 3h8l-1.8 2.8L12 8.6H4'],
  specs: ['M8 1.8l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.1l-3.7 2 .8-4.1L2 6.1l4.2-.5Z'],
};

export function tabIcon(name: string): SVGSVGElement {
  return s('svg', { class: 'tab-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, ...(TAB_ICONS[name] ?? []).map(d => s('path', { d })));
}

/** A small chevron: open points down. */
export function chevron(open: boolean): SVGSVGElement {
  return s('svg', { class: 'car', viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: open ? 'M2.5 4.5 6 8l3.5-3.5' : 'M4.5 2.5 8 6 4.5 9.5' }));
}

/** An element's card's small graph: the element at the left, each link to the right by its field's name. */
export function linkGraph(centreType: string, links: ReadonlyArray<{ label: string; name: string; type: string; id: string }>, onStep: (id: string) => void): SVGSVGElement {
  const n = links.length;
  const W = 338, H = n ? Math.max(60, 26 + (n - 1) * 46 + 26) : 0, cx = 40, cy = H / 2, x = 146;
  const svg = s('svg', { class: 'graph', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group' });
  links.forEach((l, i) => {
    const y = n === 1 ? cy : 26 + i * ((H - 52) / (n - 1));
    svg.append(s('path', { class: 'edge', d: `M${cx + 19} ${cy} C ${cx + 60} ${cy}, ${x - 56} ${y}, ${x - 15} ${y}`, fill: 'none', 'stroke-width': 1.3 }));
    const label = s('text', { class: 'edge-label', x: x - 20, y: y - 6, 'text-anchor': 'end' });
    label.textContent = l.label;
    svg.append(label);
    const name = s('text', { class: 'nb-name', x: x + 19, y: y + 4 });
    name.textContent = l.name;
    const g = s('g', { class: 'nb', role: 'button', tabindex: 0, 'aria-label': `Open ${l.name}, ${l.label}`, 'data-step': l.id },
      s('rect', { class: 'hit', x: x - 16, y: y - 15, width: W - x + 12, height: 30, rx: 8 }),
      kindBody(l.type, 24, { x: x - 12, y: y - 12 }),
      name);
    g.addEventListener('click', () => onStep(l.id));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStep(l.id); } });
    svg.append(g);
  });
  if (n) svg.append(kindBody(centreType, 36, { x: cx - 18, y: cy - 18 }));
  return svg;
}

/** A type's colour group (blue, green, pink, amber), for a word drawn in its colour; none for a type the SDK does not know. */
export function kindGroup(type: string): string {
  try { return groupOf(type as ElementType); } catch { return 'none'; }
}
