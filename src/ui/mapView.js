// Full-screen paper road map of the whole trip, opened from the map on the passenger seat.
const SECTION_COLORS = {
  desert: '#d9b77e', hills: '#c2b06a', ridge: '#8fa067', peaks: '#8e9488',
  pass: '#c9d3dc', descent: '#8fa38a', coast: '#7fb0c4', beach: '#e3cf9e',
};
const METERS_TO_MILES = 1 / 1609.34;

export class MapView {
  constructor(host, route, destination) {
    this.host = host;
    this.route = route;
    this.destination = destination;
    this.canvas = document.createElement('canvas');
    host.appendChild(this.canvas);
    const hint = document.createElement('div');
    hint.className = 'map-hint';
    hint.innerHTML = '<kbd>E</kbd> / <kbd>Esc</kbd> roll the map back up';
    host.appendChild(hint);
    this.isOpen = false;
  }

  open(position, s) {
    this.isOpen = true;
    this.host.hidden = false;
    this.#draw(position, s);
  }

  close() {
    this.isOpen = false;
    this.host.hidden = true;
  }

  #draw(pos, sNow) {
    const r = this.route;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    const ctx = this.canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // paper
    ctx.fillStyle = '#efe6cf';
    ctx.fillRect(0, 0, W, H);

    // Fit the route, north (+Z) up and east (-X) right
    const pad = 70;
    const top = 90;
    const spanX = r.maxX - r.minX;
    const spanZ = r.maxZ - r.minZ;
    const k = Math.min((W - pad * 2) / spanX, (H - top - pad * 1.6) / spanZ);
    const ox = (W - spanX * k) / 2;
    const oy = top + (H - top - pad * 1.6 - spanZ * k) / 2;
    const to = (x, z) => [ox + (r.maxX - x) * k, oy + (r.maxZ - z) * k];

    // region tints along the road, then the road itself
    const step = 5;
    for (const sec of r.sections) {
      ctx.strokeStyle = SECTION_COLORS[sec.key] ?? '#ccc';
      ctx.lineWidth = 34;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = Math.floor(sec.start / 2); i <= Math.min(Math.ceil(sec.end / 2), r.count - 1); i += step) {
        const [x, y] = to(r.x[i], r.z[i]);
        if (i === Math.floor(sec.start / 2)) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const road = (from, toS, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let first = true;
      for (let i = Math.floor(from / 2); i <= Math.min(Math.ceil(toS / 2), r.count - 1); i += step) {
        const [x, y] = to(r.x[i], r.z[i]);
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    };
    road(0, r.length, 7, '#7a2e22');
    road(0, r.length, 4, '#e8553f');
    road(0, sNow, 4, '#3b3b3b'); // already driven

    // region labels
    ctx.font = 'italic 15px Georgia, serif';
    ctx.fillStyle = '#4a3f2c';
    ctx.textAlign = 'center';
    r.sections.forEach((sec, i) => {
      if (i === r.sections.length - 1) return; // the destination pin names it
      const mid = r.at((sec.start + sec.end) / 2);
      const [x, y] = to(mid.x, mid.z);
      ctx.fillText(sec.region, x + (i % 2 ? 70 : -70), y + (i % 2 ? 26 : -22));
    });

    // start, gas, finish
    const pin = (x, z, label, color) => {
      const [px, py] = to(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#2d2618';
      ctx.fillText(label, px, py - 14);
    };
    pin(42, 40, '⛽ Start', '#2c7a3f');
    const end = r.at(r.length);
    pin(end.x, end.z, `🏁 ${this.destination}`, '#1d5fa8');

    // you are here
    const [vx, vy] = to(pos.x, pos.z);
    ctx.fillStyle = 'rgba(29,95,168,0.25)';
    ctx.beginPath();
    ctx.arc(vx, vy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d5fa8';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(vx, vy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#1d5fa8';
    ctx.fillText('You are here', vx, vy + 30);

    // title and progress
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2d2618';
    ctx.font = 'bold 26px Georgia, serif';
    ctx.fillText('Road Trip', 28, 44);
    const done = Math.min(Math.max(sNow / r.length, 0), 1);
    const left = Math.max(r.length - sNow, 0) * METERS_TO_MILES;
    ctx.font = '16px sans-serif';
    const region = r.sections[r.sectionIndexAt(sNow)].region;
    ctx.fillText(`${region} · ${Math.round(done * 100)}% of the way · ${left.toFixed(1)} mi to ${this.destination}`, 28, 70);
    // progress bar
    const bw = Math.min(W - 56, 420);
    ctx.fillStyle = '#d8ccae';
    ctx.fillRect(28, H - 46, bw, 10);
    ctx.fillStyle = '#e8553f';
    ctx.fillRect(28, H - 46, bw * done, 10);
  }
}
