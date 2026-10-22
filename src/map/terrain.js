import * as THREE from 'three';
import { ROAD_HALF, SEA_LEVEL } from './route.js';

// Land on either side of the highway. Height comes from three layers:
//  - a coarse field (50 m cells) holding the elevation, signed distance and trip distance of the
//    nearest bit of road, so terrain far from the road still knows "where" on the trip it is;
//  - biome relief (hills, peaks, sea cliffs) that grows with distance from the road;
//  - the road itself, flattened into the land within a few meters of the pavement.

// Per-section terrain and color settings. Numbers blend across section boundaries.
export const BIOMES = {
  desert: { up: 0, vary: 7, reach: 700, mesa: 1, sea: 0, snowline: 1e5, ground: 0xd8b98a, alt: 0xc9a46e, rock: 0xb27550 },
  hills: { up: 30, vary: 42, reach: 520, mesa: 0, sea: 0, snowline: 1e5, ground: 0xc0a865, alt: 0x8b9a55, rock: 0x9b8668 },
  ridge: { up: 100, vary: 90, reach: 430, mesa: 0, sea: 0, snowline: 700, ground: 0x7c8a4e, alt: 0x5d7343, rock: 0x847e72 },
  peaks: { up: 300, vary: 170, reach: 360, mesa: 0, sea: 0, snowline: 430, ground: 0x6c7856, alt: 0x56684a, rock: 0x77746f },
  pass: { up: 210, vary: 120, reach: 300, mesa: 0, sea: 0, snowline: -1e5, ground: 0x6c7856, alt: 0x56684a, rock: 0x77746f },
  descent: { up: 150, vary: 90, reach: 380, mesa: 0, sea: 0, snowline: 470, ground: 0x6f8a4c, alt: 0x52703f, rock: 0x7d7a72 },
  coast: { up: 75, vary: 45, reach: 320, mesa: 0, sea: 1, seaReach: 110, snowline: 1e5, ground: 0x93a45a, alt: 0xb7aa6a, rock: 0x8d7c68 },
  beach: { up: 25, vary: 12, reach: 260, mesa: 0, sea: 1, seaReach: 240, snowline: 1e5, ground: 0x9aa860, alt: 0xb9ad70, rock: 0x8d7c68 },
};
const BLEND = 450; // m either side of a section boundary
const SNOW = new THREE.Color(0xf1f4f7);
const SAND = new THREE.Color(0xe3cf9e);
const WET_SAND = new THREE.Color(0xb9a57a);
const SHOULDER = new THREE.Color(0x8d8578);

const FLAT = ROAD_HALF + 7; // land matches the road out to here...
const SHOULDER_BLEND = 38; // ...then eases back to natural over this many meters
export const ROAD_LIFT = 0.04; // pavement sits this far above the road's elevation
const UNDER_ROAD = -0.2; // land under the pavement is pushed down out of its way

const GRID = 50;
const GRID_MARGIN = 2500;

// --- noise ---
function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}

function fbm(x, z, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f + i * 17.3, z * f - i * 9.1) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export class Terrain {
  constructor(route, flatZones = []) {
    this.route = route;
    this.flatZones = flatZones; // [{ x0, x1, z0, z1, y, margin }]
    this.#buildField();
    this.near = {}; // scratch for road queries
    this.biome = {};
    for (const k of ['up', 'vary', 'reach', 'mesa', 'sea', 'seaReach', 'snowline']) this.biome[k] = 0;
    this.biome.ground = new THREE.Color();
    this.biome.alt = new THREE.Color();
    this.biome.rock = new THREE.Color();
    this.colors = Object.fromEntries(
      Object.entries(BIOMES).map(([k, b]) => [k, { ground: new THREE.Color(b.ground), alt: new THREE.Color(b.alt), rock: new THREE.Color(b.rock) }]),
    );
  }

  // Coarse field via jump flooding: each cell learns its nearest road sample.
  #buildField() {
    const r = this.route;
    this.gx0 = r.minX - GRID_MARGIN;
    this.gz0 = r.minZ - GRID_MARGIN;
    this.nx = Math.ceil((r.maxX - r.minX + 2 * GRID_MARGIN) / GRID) + 1;
    this.nz = Math.ceil((r.maxZ - r.minZ + 2 * GRID_MARGIN) / GRID) + 1;
    const n = this.nx * this.nz;
    const idx = new Int32Array(n).fill(-1);
    const cellX = (i) => this.gx0 + (i % this.nx) * GRID;
    const cellZ = (i) => this.gz0 + Math.floor(i / this.nx) * GRID;
    const d2 = (cell, sample) => (cellX(cell) - r.x[sample]) ** 2 + (cellZ(cell) - r.z[sample]) ** 2;

    for (let s = 0; s < r.count; s++) {
      const ix = Math.round((r.x[s] - this.gx0) / GRID);
      const iz = Math.round((r.z[s] - this.gz0) / GRID);
      const c = iz * this.nx + ix;
      if (idx[c] < 0 || d2(c, s) < d2(c, idx[c])) idx[c] = s;
    }
    let step = 1;
    while (step < Math.max(this.nx, this.nz)) step *= 2;
    for (step /= 2; step >= 1; step /= 2) {
      for (let iz = 0; iz < this.nz; iz++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const c = iz * this.nx + ix;
          let best = idx[c];
          let bestD = best < 0 ? Infinity : d2(c, best);
          for (let dz = -step; dz <= step; dz += step) {
            const jz = iz + dz;
            if (jz < 0 || jz >= this.nz) continue;
            for (let dx = -step; dx <= step; dx += step) {
              const jx = ix + dx;
              if (jx < 0 || jx >= this.nx) continue;
              const cand = idx[jz * this.nx + jx];
              if (cand < 0) continue;
              const dd = d2(c, cand);
              if (dd < bestD) {
                bestD = dd;
                best = cand;
              }
            }
          }
          idx[c] = best;
        }
      }
    }

    // Exact signed distance to the road segments around each cell's nearest sample
    this.fBase = new Float32Array(n);
    this.fSigned = new Float32Array(n);
    this.fS = new Float32Array(n);
    this.fIndex = idx;
    for (let c = 0; c < n; c++) {
      const px = cellX(c);
      const pz = cellZ(c);
      let best = Infinity;
      let seg = 0;
      let bt = 0;
      for (let k = Math.max(idx[c] - 3, 0); k <= Math.min(idx[c] + 3, r.count - 2); k++) {
        const ax = r.x[k];
        const az = r.z[k];
        const dx = r.x[k + 1] - ax;
        const dz = r.z[k + 1] - az;
        const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0), 1);
        const dd = (px - ax - dx * t) ** 2 + (pz - az - dz * t) ** 2;
        if (dd < best) {
          best = dd;
          seg = k;
          bt = t;
        }
      }
      const dx = r.x[seg + 1] - r.x[seg];
      const dz = r.z[seg + 1] - r.z[seg];
      const side = dz * (px - r.x[seg]) - dx * (pz - r.z[seg]) >= 0 ? 1 : -1;
      this.fBase[c] = r.y[seg] + (r.y[seg + 1] - r.y[seg]) * bt;
      this.fSigned[c] = side * Math.sqrt(best);
      this.fS[c] = (seg + bt) * 2;
    }
  }

  // Bilinear lookup in the coarse field. Returns { base, signed, s }.
  field(x, z, out = {}) {
    const fx = Math.min(Math.max((x - this.gx0) / GRID, 0), this.nx - 1.001);
    const fz = Math.min(Math.max((z - this.gz0) / GRID, 0), this.nz - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const c = iz * this.nx + ix;
    const lerp4 = (arr) => {
      const a = arr[c];
      const b = arr[c + 1];
      const d = arr[c + this.nx];
      const e = arr[c + this.nx + 1];
      return (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
    };
    out.base = lerp4(this.fBase);
    out.signed = lerp4(this.fSigned);
    // s jumps between switchback legs, so take the nearest cell's rather than blending
    out.s = this.fS[c + (tx > 0.5 ? 1 : 0) + (tz > 0.5 ? this.nx : 0)];
    out.index = this.fIndex[c + (tx > 0.5 ? 1 : 0) + (tz > 0.5 ? this.nx : 0)];
    out.outside = x < this.gx0 || z < this.gz0 || x > this.gx0 + (this.nx - 1) * GRID || z > this.gz0 + (this.nz - 1) * GRID;
    return out;
  }

  // Blended biome settings at trip distance s (written into this.biome).
  biomeAt(s) {
    const secs = this.route.sections;
    const i = this.route.sectionIndexAt(s);
    let from = secs[i].key;
    let to = from;
    let k = 0;
    if (i > 0 && s < secs[i].start + BLEND) {
      from = secs[i - 1].key;
      to = secs[i].key;
      k = 0.5 + (0.5 * (s - secs[i].start)) / BLEND;
    } else if (i < secs.length - 1 && s > secs[i].end - BLEND) {
      to = secs[i + 1].key;
      k = (0.5 * (s - (secs[i].end - BLEND))) / BLEND;
    }
    const A = BIOMES[from];
    const B = BIOMES[to];
    const out = this.biome;
    for (const key of ['up', 'vary', 'reach', 'mesa', 'sea', 'snowline']) out[key] = A[key] + (B[key] - A[key]) * k;
    out.seaReach = (A.seaReach ?? 110) + ((B.seaReach ?? 110) - (A.seaReach ?? 110)) * k;
    const ca = this.colors[from];
    const cb = this.colors[to];
    out.ground.copy(ca.ground).lerp(cb.ground, k);
    out.alt.copy(ca.alt).lerp(cb.alt, k);
    out.rock.copy(ca.rock).lerp(cb.rock, k);
    out.key = k < 0.5 ? from : to;
    return out;
  }

  // Natural land height plus road flattening. `info` (optional) receives road distance and s.
  heightAt(x, z, info) {
    const f = this.field(x, z, this.#fieldScratch);
    const B = this.biomeAt(f.s);
    const d = Math.abs(f.signed);
    const far = smoothstep(14, B.reach, d);

    const n = fbm(x / 430, z / 430);
    const ridge = 1 - Math.abs(fbm(x / 760 + 31, z / 760 - 12, 3) * 2);
    let h = f.base + far * (B.up * (0.45 + 0.55 * ridge) + B.vary * n);
    h += fbm(x / 60, z / 60, 2) * 1.6 * (0.3 + far); // small lumps everywhere off the pavement

    if (B.mesa > 0) {
      // flat-topped mesas out in the desert
      const m = valueNoise(x / 950 + 7, z / 950 - 3);
      h += B.mesa * smoothstep(250, 600, d) * smoothstep(0.38, 0.44, m) * (38 + 10 * valueNoise(x / 300, z / 300));
    }

    if (B.sea > 0) {
      // On the ocean side (left of travel) the land falls away below sea level
      const seaward = B.sea * smoothstep(-15, 25, f.signed);
      const drop = smoothstep(12, B.seaReach, d) * (f.base - SEA_LEVEL + 22);
      h += (f.base - drop + n * 3 - h) * seaward;
    } else {
      h = Math.max(h, SEA_LEVEL + 3);
    }

    // Blend into the road
    let roadDist = d;
    let s = f.s;
    if (d < FLAT + SHOULDER_BLEND + GRID) {
      const nr = this.route.nearest(x, z, FLAT + SHOULDER_BLEND, this.near);
      if (nr) {
        roadDist = nr.dist;
        s = nr.s;
        const w = 1 - smoothstep(FLAT, FLAT + SHOULDER_BLEND, nr.dist);
        const under = nr.dist < ROAD_HALF + 1.5 ? UNDER_ROAD : 0;
        h += (nr.y + under - h) * w;
      }
    }

    for (const z0 of this.flatZones) {
      const ox = Math.max(z0.x0 - x, 0, x - z0.x1);
      const oz = Math.max(z0.z0 - z, 0, z - z0.z1);
      const w = 1 - smoothstep(0, z0.margin, Math.hypot(ox, oz));
      if (w > 0) h += (z0.y - h) * w;
    }

    if (info) {
      info.roadDist = roadDist;
      info.s = s;
      info.far = far;
    }
    return h;
  }

  #fieldScratch = {};

  // Face color from biome, height, steepness and a bit of noise.
  colorFor(out, x, z, h, normalY, roadDist, s) {
    const B = this.biomeAt(s);
    const n = valueNoise(x / 37, z / 37) * 0.5 + valueNoise(x / 9, z / 9) * 0.5;
    out.copy(B.ground).lerp(B.alt, smoothstep(-0.2, 0.5, n) * 0.85);
    const steep = smoothstep(0.86, 0.7, normalY);
    out.lerp(B.rock, steep);
    if (h > B.snowline + n * 25 && normalY > 0.55) out.copy(SNOW).offsetHSL(0, 0, n * 0.02);
    if (B.sea > 0 && h < SEA_LEVEL + 6) out.copy(h < SEA_LEVEL + 1 ? WET_SAND : SAND);
    if (roadDist < ROAD_HALF + 2.5) out.lerp(SHOULDER, 0.55);
    out.offsetHSL(0, 0, n * 0.025);
    return out;
  }
}

// --- tiles ---
const colorScratch = new THREE.Color();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

// A square of land, flat shaded. Heights are kept so things can stand on it.
export function buildTile(terrain, x0, z0, size, segs, material) {
  const n = segs + 1;
  const step = size / segs;
  const heights = new Float32Array(n * n);
  const roadDist = new Float32Array(n * n);
  const sAt = new Float32Array(n * n);
  const info = {};
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      heights[j * n + i] = terrain.heightAt(x0 + i * step, z0 + j * step, info);
      roadDist[j * n + i] = info.roadDist;
      sAt[j * n + i] = info.s;
    }
  }

  const positions = new Float32Array(segs * segs * 18);
  const colors = new Float32Array(segs * segs * 18);
  let p = 0;
  const tri = (i0, j0, i1, j1, i2, j2) => {
    const pts = [[i0, j0], [i1, j1], [i2, j2]];
    let hy = 0;
    let rd = Infinity;
    let sSum = 0;
    pts.forEach(([i, j], k) => {
      const v = [a, b, c][k];
      v.set(i * step, heights[j * n + i], j * step);
      hy += v.y / 3;
      rd = Math.min(rd, roadDist[j * n + i]);
      sSum += sAt[j * n + i] / 3;
    });
    const nrm = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    terrain.colorFor(colorScratch, x0 + ((i0 + i1 + i2) / 3) * step, z0 + ((j0 + j1 + j2) / 3) * step, hy, nrm.y, rd, sSum);
    for (const v of [a, b, c]) {
      positions[p] = v.x;
      positions[p + 1] = v.y;
      positions[p + 2] = v.z;
      colors[p] = colorScratch.r;
      colors[p + 1] = colorScratch.g;
      colors[p + 2] = colorScratch.b;
      p += 3;
    }
  };
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      // corners a(i,j) b(i+1,j) c(i,j+1) d(i+1,j+1), split along b-c; wound to face up
      tri(i, j, i, j + 1, i + 1, j);
      tri(i + 1, j, i, j + 1, i + 1, j + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x0, 0, z0);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, heights, n, step, x0, z0 };
}

// Height on a tile's actual triangles (matches what you see).
export function tileHeight(tile, x, z) {
  const fx = (x - tile.x0) / tile.step;
  const fz = (z - tile.z0) / tile.step;
  const i = Math.min(Math.max(Math.floor(fx), 0), tile.n - 2);
  const j = Math.min(Math.max(Math.floor(fz), 0), tile.n - 2);
  const u = fx - i;
  const v = fz - j;
  const H = tile.heights;
  const n = tile.n;
  const ha = H[j * n + i];
  const hb = H[j * n + i + 1];
  const hc = H[(j + 1) * n + i];
  const hd = H[(j + 1) * n + i + 1];
  if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
  return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
}
