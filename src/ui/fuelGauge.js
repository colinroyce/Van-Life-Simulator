import { needColor } from '../needs.js';

// Round fuel gauge: a dark dial with a 120° E-to-F arc across the top, a colored fill and a needle.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 112;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 40;
const SWEEP = (120 * Math.PI) / 180;

const el = (tag, attrs, parent) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
};

// Angle from straight up: E on the left, F on the right.
const angleAt = (percent) => -SWEEP / 2 + (SWEEP * percent) / 100;
const point = (a, r) => [CX + r * Math.sin(a), CY - r * Math.cos(a)];
const arcPath = (from, to, r) => {
  const [x0, y0] = point(angleAt(from), r);
  const [x1, y1] = point(angleAt(to), r);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
};

export function createFuelGauge(host) {
  const svg = el('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}` }, host);
  el('circle', { cx: CX, cy: CY, r: SIZE / 2 - 2, class: 'fuel-dial' }, svg);
  el('path', { d: arcPath(0, 100, R), class: 'fuel-track' }, svg);
  el('path', { d: arcPath(0, 12.5, R), class: 'fuel-reserve' }, svg);
  const fill = el('path', { class: 'fuel-fill' }, svg);
  for (const p of [0, 25, 50, 75, 100]) {
    const [x1, y1] = point(angleAt(p), R - 5);
    const [x2, y2] = point(angleAt(p), R - (p % 50 === 0 ? 12 : 9));
    el('line', { x1, y1, x2, y2, class: 'fuel-tick' }, svg);
  }
  for (const [p, text] of [[0, 'E'], [100, 'F']]) {
    const [x, y] = point(angleAt(p), R + 1);
    el('text', { x, y: y + 16, class: 'fuel-letter' }, svg).textContent = text;
  }
  el('text', { x: CX, y: CY + 26, class: 'fuel-label' }, svg).textContent = 'FUEL';
  const needle = el('line', { x1: CX, y1: CY + 6, x2: CX, y2: CY - R + 6, class: 'fuel-needle' }, svg);
  el('circle', { cx: CX, cy: CY, r: 4, class: 'fuel-hub' }, svg);

  return (percent) => {
    const v = Math.min(Math.max(percent, 0), 100);
    fill.setAttribute('d', v > 0.5 ? arcPath(0, v, R) : '');
    fill.style.stroke = needColor(v);
    needle.setAttribute('transform', `rotate(${(angleAt(v) * 180) / Math.PI} ${CX} ${CY})`);
  };
}
