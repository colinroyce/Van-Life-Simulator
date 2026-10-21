import { NEEDS, needColor } from '../needs.js';
import { timeOfDay } from '../clock.js';

// Sleep dial: a 24-hour clock face (midnight at the top). The highlighted arc runs from now to
// the wake-up time; drag it, scroll, or press A/D to change how long to sleep. The panel beside
// it previews what each meter will be when you wake.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 320;
const C = SIZE / 2;
const R = 122; // ring radius
const RING = 28; // ring thickness
const MAX_HOURS = 24;

const el = (tag, attrs = {}, parent) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
};

// Angle (radians, clockwise from the top) of a time of day.
const angleOf = (minutes) => (((minutes % 1440) + 1440) % 1440) / 1440 * Math.PI * 2;
const polar = (a, r) => [C + r * Math.sin(a), C - r * Math.cos(a)];

export class SleepWheel {
  constructor(root) {
    this.root = root;
    this.isOpen = false;
    this.hours = 8;
    this.dragging = false;

    root.innerHTML = `
      <div class="sleep-dial"></div>
      <div class="sleep-panel">
        <div class="sleep-title">Sleep</div>
        <div class="sleep-effects"></div>
        <div class="sleep-keys"><kbd>Scroll</kbd>/<kbd>A</kbd><kbd>D</kbd> hours &nbsp; <kbd>E</kbd> sleep &nbsp; <kbd>Esc</kbd> cancel</div>
      </div>`;
    this.effects = root.querySelector('.sleep-effects');
    this.#buildDial(root.querySelector('.sleep-dial'));

    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.adjust(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  #buildDial(host) {
    const svg = el('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}` }, host);
    el('circle', { cx: C, cy: C, r: R, class: 'dial-track', 'stroke-width': RING }, svg);
    this.arc = el('path', { class: 'dial-arc', 'stroke-width': RING }, svg);
    this.fullArc = el('circle', { cx: C, cy: C, r: R, class: 'dial-arc', 'stroke-width': RING }, svg);

    for (let h = 0; h < 24; h++) {
      const a = (h / 24) * Math.PI * 2;
      const major = h % 3 === 0;
      const [x1, y1] = polar(a, R + RING / 2 + 2);
      const [x2, y2] = polar(a, R + RING / 2 + (major ? 10 : 5));
      el('line', { x1, y1, x2, y2, class: 'dial-tick' }, svg);
      if (major) {
        const [lx, ly] = polar(a, R - RING / 2 - 14);
        const label = el('text', { x: lx, y: ly, class: 'dial-label' }, svg);
        label.textContent = h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
      }
    }

    this.nowDot = el('circle', { r: 6, class: 'dial-now' }, svg);
    this.handle = el('circle', { r: 11, class: 'dial-handle' }, svg);
    this.hoursText = el('text', { x: C, y: C - 6, class: 'dial-hours' }, svg);
    this.wakeText = el('text', { x: C, y: C + 22, class: 'dial-wake' }, svg);

    const fromPointer = (e) => {
      const box = svg.getBoundingClientRect();
      const dx = e.clientX - box.left - C;
      const dy = e.clientY - box.top - C;
      const a = Math.atan2(dx, -dy);
      const minutes = ((a / (Math.PI * 2)) * 1440 + 1440) % 1440;
      const ahead = (minutes - (this.now % 1440) + 1440) % 1440;
      this.hours = Math.round(ahead / 60) || MAX_HOURS;
      this.#render();
    };
    svg.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      svg.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    svg.addEventListener('pointermove', (e) => this.dragging && fromPointer(e));
    svg.addEventListener('pointerup', () => (this.dragging = false));
  }

  // preview(hours) -> meter values after sleeping that long
  open(nowMinutes, preview, values) {
    this.now = nowMinutes;
    this.preview = preview;
    this.values = values;
    this.isOpen = true;
    this.root.hidden = false;
    this.#render();
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
  }

  adjust(delta) {
    this.hours = Math.min(Math.max(this.hours + delta, 1), MAX_HOURS);
    this.#render();
  }

  #render() {
    const start = angleOf(this.now);
    const wake = this.now + this.hours * 60;
    const end = angleOf(wake);
    const full = this.hours >= MAX_HOURS;
    this.fullArc.style.display = full ? '' : 'none';
    this.arc.style.display = full ? 'none' : '';
    if (!full) {
      const [x0, y0] = polar(start, R);
      const [x1, y1] = polar(end, R);
      const large = this.hours > 12 ? 1 : 0;
      this.arc.setAttribute('d', `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`);
    }
    const [nx, ny] = polar(start, R);
    const [hx, hy] = polar(end, R);
    this.nowDot.setAttribute('cx', nx);
    this.nowDot.setAttribute('cy', ny);
    this.handle.setAttribute('cx', hx);
    this.handle.setAttribute('cy', hy);
    this.hoursText.textContent = `${this.hours} hour${this.hours === 1 ? '' : 's'}`;
    const nextDay = Math.floor(wake / 1440) > Math.floor(this.now / 1440);
    this.wakeText.textContent = `Wake ${timeOfDay(wake)}${nextDay ? ' (next day)' : ''}`;

    const after = this.preview(this.hours);
    this.effects.innerHTML = NEEDS.filter((n) => !n.gauge).map((n) => {
      const from = this.values[n.key];
      const to = after[n.key];
      const delta = Math.round(to) - Math.round(from);
      const sign = delta > 0 ? '+' : '';
      const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
      return `<div class="sleep-row">
        <span>${n.label}</span>
        <div class="need-track"><div class="need-fill" style="width:${to}%;background:${needColor(to)}"></div>
          <div class="sleep-was" style="left:${from}%"></div></div>
        <span class="sleep-delta ${cls}">${Math.round(from)}→${Math.round(to)}% <b>${sign}${delta}</b></span>
      </div>`;
    }).join('');
  }
}
