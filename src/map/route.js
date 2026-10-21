// The road trip, as one continuous highway built turtle-style from pieces:
// [length m, total turn (degrees, + = left), elevation at the end of the piece (m)].
// Elevation 0 is the desert floor at the start; sea level is SEA_LEVEL.

export const SEA_LEVEL = -150;
export const ROAD_HALF = 4.6; // two lanes plus narrow shoulders
export const SAMPLE = 2; // meters between road samples

// Regions in driving order. `blend` is how far (m) each one fades into the next.
export const SECTIONS = {
  desert: { region: 'Dry Wash Flats', road: 'Hwy 41' },
  hills: { region: 'Juniper Hills', road: 'Hwy 41' },
  ridge: { region: 'Cedar Ridge', road: 'Hwy 41' },
  peaks: { region: 'Granite Peaks', road: 'Hwy 41' },
  pass: { region: 'Whitecap Pass', road: 'Hwy 41' },
  descent: { region: 'Whitecap Grade', road: 'Hwy 41' },
  coast: { region: 'Seacliff Coast', road: 'Coast Hwy 1' },
  beach: { region: 'Driftwood Beach', road: 'Beach Access Rd' },
};

const PIECES = {
  desert: [
    [400, 0, 0], // past the gas station
    [1200, 0, 2], [700, 12, 6], [1800, 0, -4], [900, -20, 4], [1500, 0, 12], [600, 18, 18],
  ],
  hills: [
    [500, 35, 30], [450, -45, 45], [400, 0, 38], [500, 55, 55], [600, 0, 75], [450, -60, 90],
    [500, 25, 72], [700, 0, 95], [450, -40, 120], [550, 50, 140], [600, 0, 150],
  ],
  ridge: [
    [350, 75, 175], [300, -80, 195], [500, 0, 225], [300, 95, 250], [400, -70, 275], [450, 0, 300],
    [300, 80, 320], [350, -60, 340],
  ],
  peaks: [
    [500, 0, 370], [250, 120, 390], [300, 0, 410], [200, -150, 425], [350, 0, 450], [220, 160, 467], [300, 0, 490],
  ],
  pass: [
    [200, -170, 505], [300, 0, 525], [250, 60, 540], [400, 0, 550], [300, -40, 552], [500, 0, 545],
  ],
  descent: [
    [300, 90, 525], [250, -170, 505], [350, 0, 478], [230, 170, 460], [400, 0, 428], [250, -120, 410],
    [500, 0, 370], [300, 80, 345], [600, 0, 300], [350, -70, 275], [700, 0, 225], [400, 60, 195],
    [800, 0, 140], [500, -50, 110], [900, 0, 60], [600, 40, 30], [800, 0, -10], [500, -30, -40],
    [800, 0, -80], [600, 25, -100],
  ],
  coast: [
    [800, 0, -110], [600, -25, -105], [700, 0, -115], [500, 35, -108], [900, 0, -118], [500, -30, -112], [600, 0, -120],
  ],
  beach: [[250, 20, -135]],
};

export const START = { x: 18, z: -400, heading: 0 }; // heading 0 drives toward +Z

// Box-filter a series in place (window in samples), keeping the ends pinned.
function smooth(values, window) {
  const half = Math.floor(window / 2);
  const out = values.slice();
  let sum = 0;
  const at = (i) => values[Math.min(Math.max(i, 0), values.length - 1)];
  for (let i = -half; i <= half; i++) sum += at(i);
  for (let i = 0; i < values.length; i++) {
    out[i] = sum / (2 * half + 1);
    sum += at(i + half + 1) - at(i - half);
  }
  return out;
}

export function buildRoute() {
  const xs = [];
  const zs = [];
  const headings = [];
  const ys = [];
  const sectionAt = [];
  const sections = []; // { key, start, end }

  let x = START.x;
  let z = START.z;
  let heading = START.heading;
  let y = 0;
  let s = 0;
  const knots = [[0, 0]]; // [s, y] at piece ends

  const push = (key) => {
    xs.push(x);
    zs.push(z);
    headings.push(heading);
    sectionAt.push(key);
  };

  push('desert');
  for (const [key, pieces] of Object.entries(PIECES)) {
    sections.push({ key, start: s, ...SECTIONS[key] });
    for (const [len, turnDeg, endY] of pieces) {
      const steps = Math.round(len / SAMPLE);
      const dHeading = ((turnDeg * Math.PI) / 180) / steps;
      for (let i = 0; i < steps; i++) {
        // midpoint heading so arcs close properly
        const h = heading + dHeading / 2;
        x += Math.sin(h) * SAMPLE;
        z += Math.cos(h) * SAMPLE;
        heading += dHeading;
        s += SAMPLE;
        push(key);
      }
      knots.push([s, endY]);
      y = endY;
    }
  }
  sections.forEach((sec, i) => (sec.end = sections[i + 1]?.start ?? s));

  // Elevation: straight lines between knots, then rounded off into vertical curves.
  let k = 0;
  for (let i = 0; i < xs.length; i++) {
    const si = i * SAMPLE;
    while (k < knots.length - 2 && si > knots[k + 1][0]) k++;
    const [s0, y0] = knots[k];
    const [s1, y1] = knots[k + 1];
    ys.push(y0 + ((y1 - y0) * (si - s0)) / (s1 - s0));
  }
  let elev = smooth(smooth(ys, 101), 101);
  // Keep the gas station stretch dead flat
  elev = elev.map((v, i) => (i * SAMPLE < 700 ? v * Math.min(Math.max((i * SAMPLE - 600) / 100, 0), 1) : v));

  return new Route(xs, zs, elev, headings, sectionAt, sections);
}

// Spatial hash over road segments for fast "where's the nearest bit of road" queries.
const CELL = 24;

export class Route {
  constructor(xs, zs, ys, headings, sectionAt, sections) {
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.y = Float32Array.from(ys);
    this.heading = Float32Array.from(headings);
    this.sectionAt = sectionAt;
    this.sections = sections;
    this.count = xs.length;
    this.length = (this.count - 1) * SAMPLE;

    this.minX = Math.min(...this.x);
    this.maxX = Math.max(...this.x);
    this.minZ = Math.min(...this.z);
    this.maxZ = Math.max(...this.z);

    this.cells = new Map();
    for (let i = 0; i < this.count - 1; i++) {
      const cx0 = Math.floor(Math.min(this.x[i], this.x[i + 1]) / CELL);
      const cx1 = Math.floor(Math.max(this.x[i], this.x[i + 1]) / CELL);
      const cz0 = Math.floor(Math.min(this.z[i], this.z[i + 1]) / CELL);
      const cz1 = Math.floor(Math.max(this.z[i], this.z[i + 1]) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = cx * 100000 + cz;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  // Nearest point on the road within `radius` m, or null. Returns distance, signed side
  // (+ = left of the direction of travel), distance along the route, and road elevation there.
  nearest(px, pz, radius = CELL, out = {}) {
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(px / CELL);
    const cz = Math.floor(pz / CELL);
    let best = radius * radius;
    let found = -1;
    let bestT = 0;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const list = this.cells.get((cx + i) * 100000 + cz + j);
        if (!list) continue;
        for (const seg of list) {
          const ax = this.x[seg];
          const az = this.z[seg];
          const dx = this.x[seg + 1] - ax;
          const dz = this.z[seg + 1] - az;
          let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ox = px - (ax + dx * t);
          const oz = pz - (az + dz * t);
          const d2 = ox * ox + oz * oz;
          if (d2 < best) {
            best = d2;
            found = seg;
            bestT = t;
          }
        }
      }
    }
    if (found < 0) return null;
    return this.#describe(found, bestT, px, pz, Math.sqrt(best), out);
  }

  // Same, but searching the whole road (slow; for one-off queries).
  nearestAnywhere(px, pz, out = {}) {
    let best = Infinity;
    let found = 0;
    let bestT = 0;
    for (let seg = 0; seg < this.count - 1; seg++) {
      const ax = this.x[seg];
      const az = this.z[seg];
      const dx = this.x[seg + 1] - ax;
      const dz = this.z[seg + 1] - az;
      let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz);
      t = Math.min(Math.max(t, 0), 1);
      const d2 = (px - ax - dx * t) ** 2 + (pz - az - dz * t) ** 2;
      if (d2 < best) {
        best = d2;
        found = seg;
        bestT = t;
      }
    }
    return this.#describe(found, bestT, px, pz, Math.sqrt(best), out);
  }

  #describe(seg, t, px, pz, dist, out) {
    const ax = this.x[seg];
    const az = this.z[seg];
    const dx = this.x[seg + 1] - ax;
    const dz = this.z[seg + 1] - az;
    const cross = dz * (px - ax) - dx * (pz - az); // > 0: point is left of travel (+X when heading +Z)
    out.dist = dist;
    out.side = cross >= 0 ? 1 : -1;
    out.s = (seg + t) * SAMPLE;
    out.index = seg;
    out.y = this.y[seg] + (this.y[seg + 1] - this.y[seg]) * t;
    out.heading = this.heading[seg];
    out.x = ax + dx * t;
    out.z = az + dz * t;
    return out;
  }

  // Point on the road at distance s.
  at(s, out = {}) {
    const f = Math.min(Math.max(s / SAMPLE, 0), this.count - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    out.heading = this.heading[i];
    out.index = i;
    return out;
  }

  sectionIndexAt(s) {
    let i = 0;
    while (i < this.sections.length - 1 && s >= this.sections[i + 1].start) i++;
    return i;
  }
}
