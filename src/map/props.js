import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF, SEA_LEVEL } from './route.js';

// Roadside plants and rocks, scattered per terrain tile and drawn instanced.

// One colored, positioned part of a prop.
function part(geo, color, x = 0, y = 0, z = 0, opts = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (opts.rx) g.rotateX(opts.rx);
  if (opts.rz) g.rotateZ(opts.rz);
  if (opts.ry) g.rotateY(opts.ry);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function jitter(geo, amount, seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * (1 + (rand() - 0.5) * amount), pos.getY(i) * (1 + (rand() - 0.5) * amount), pos.getZ(i) * (1 + (rand() - 0.5) * amount));
  }
  return geo;
}

const cyl = (r0, r1, h, seg = 7) => new THREE.CylinderGeometry(r0, r1, h, seg);

function saguaro() {
  const green = 0x55753a;
  const parts = [part(cyl(0.32, 0.36, 5), green, 0, 2.5), part(new THREE.SphereGeometry(0.32, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), green, 0, 5)];
  for (const [side, h, len] of [[1, 2.0, 1.6], [-1, 2.6, 1.2]]) {
    parts.push(part(cyl(0.2, 0.2, 0.7), green, side * 0.55, h, 0, { rz: Math.PI / 2 }));
    parts.push(part(cyl(0.2, 0.22, len), green, side * 0.85, h + len / 2 - 0.1, 0));
    parts.push(part(new THREE.SphereGeometry(0.2, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), green, side * 0.85, h + len - 0.1, 0));
  }
  return { geo: mergeGeometries(parts), radius: 0.4 };
}

function joshuaTree() {
  const bark = 0x6e5a43;
  const spikes = 0x7d8f45;
  const parts = [part(cyl(0.18, 0.28, 2.6), bark, 0, 1.3)];
  for (const [ang, tilt, len] of [[0, 0.7, 1.4], [2.1, 0.8, 1.2], [4.0, 0.6, 1.5], [1.0, 0.2, 1.0]]) {
    const dx = Math.sin(ang) * Math.sin(tilt) * len;
    const dz = Math.cos(ang) * Math.sin(tilt) * len;
    const dy = Math.cos(tilt) * len;
    const arm = cyl(0.1, 0.14, len, 5);
    arm.translate(0, len / 2, 0);
    arm.rotateX(tilt);
    arm.rotateY(ang);
    parts.push(part(arm, bark, 0, 2.5, 0));
    parts.push(part(jitter(new THREE.IcosahedronGeometry(0.42, 0), 0.4, 3), spikes, dx, 2.5 + dy + 0.15, dz));
  }
  return { geo: mergeGeometries(parts), radius: 0.35 };
}

function shrub(color, seed) {
  const g = jitter(new THREE.IcosahedronGeometry(0.7, 0), 0.5, seed);
  g.scale(1, 0.6, 1);
  return { geo: mergeGeometries([part(g, color, 0, 0.3)]), radius: 0 };
}

function rock(color, seed) {
  const g = jitter(new THREE.DodecahedronGeometry(1, 0), 0.45, seed);
  g.scale(1.2, 0.7, 1);
  return { geo: mergeGeometries([part(g, color, 0, 0.25)]), radius: 1.0 };
}

function pine(snowy) {
  const parts = [part(cyl(0.18, 0.28, 2.2), 0x5e4630, 0, 1.1)];
  const green = 0x2f5a35;
  for (let i = 0; i < 3; i++) {
    const r = 1.9 - i * 0.5;
    const y = 2.4 + i * 1.7;
    parts.push(part(new THREE.ConeGeometry(r, 3, 7), snowy && i === 2 ? 0xe9eef2 : green, 0, y));
    if (snowy && i < 2) parts.push(part(new THREE.ConeGeometry(r * 0.7, 1.1, 7), 0xe9eef2, 0, y + 1.05));
  }
  return { geo: mergeGeometries(parts), radius: 0.4 };
}

function juniper() {
  const parts = [part(cyl(0.15, 0.22, 1.2, 5), 0x5d4a35, 0, 0.6)];
  parts.push(part(jitter(new THREE.IcosahedronGeometry(1.4, 0), 0.35, 11), 0x4b6638, 0, 2.0));
  parts.push(part(jitter(new THREE.IcosahedronGeometry(0.9, 0), 0.35, 5), 0x56723f, 0.6, 2.8, 0.3));
  return { geo: mergeGeometries(parts), radius: 0.35 };
}

function oak() {
  const parts = [part(cyl(0.22, 0.32, 2.6, 6), 0x6b5038, 0, 1.3)];
  parts.push(part(jitter(new THREE.IcosahedronGeometry(2.4, 0), 0.3, 7), 0x6f8a3c, 0, 3.6));
  parts.push(part(jitter(new THREE.IcosahedronGeometry(1.6, 0), 0.3, 9), 0x7b9442, 1.3, 3.2, 0.8));
  return { geo: mergeGeometries(parts), radius: 0.45 };
}

function cypress() {
  // windswept coastal cypress: leaning trunk, flat layered canopy
  const parts = [part(cyl(0.2, 0.32, 3.2, 6), 0x5a4634, 0.5, 1.5, 0, { rz: -0.3 })];
  for (const [x, y, z, r] of [[1.2, 3.4, 0, 2.2], [2.4, 3.0, 0.6, 1.6], [0.2, 3.6, -0.7, 1.5]]) {
    const g = jitter(new THREE.IcosahedronGeometry(r, 0), 0.3, Math.round(r * 10));
    g.scale(1, 0.45, 1);
    parts.push(part(g, 0x34573a, x, y, z));
  }
  return { geo: mergeGeometries(parts), radius: 0.4 };
}

// What grows where: [prop, count per tile, min scale, max scale].
const FLORA = {
  desert: [['creosote', 70, 0.6, 1.3], ['saguaro', 7, 0.7, 1.25], ['joshua', 5, 0.8, 1.3], ['redRock', 14, 0.4, 2.2]],
  hills: [['juniper', 26, 0.7, 1.3], ['oak', 10, 0.8, 1.3], ['sage', 60, 0.6, 1.2], ['greyRock', 8, 0.5, 1.8]],
  ridge: [['pine', 55, 0.8, 1.5], ['juniper', 10, 0.8, 1.2], ['greyRock', 16, 0.6, 2.5]],
  peaks: [['pine', 40, 0.8, 1.6], ['snowPine', 12, 0.8, 1.5], ['greyRock', 22, 0.8, 3.0]],
  pass: [['snowPine', 30, 0.7, 1.4], ['greyRock', 12, 0.8, 2.5]],
  descent: [['snowPine', 14, 0.8, 1.5], ['pine', 40, 0.8, 1.6], ['greyRock', 14, 0.6, 2.4]],
  coast: [['cypress', 10, 0.8, 1.3], ['sage', 50, 0.6, 1.2], ['greyRock', 6, 0.5, 1.6]],
  beach: [['sage', 20, 0.5, 1.0]],
};

const MAKERS = {
  creosote: () => shrub(0x7a8648, 21),
  sage: () => shrub(0x8a9666, 33),
  saguaro,
  joshua: joshuaTree,
  redRock: () => rock(0xa66a48, 17),
  greyRock: () => rock(0x8a8a86, 29),
  pine: () => pine(false),
  snowPine: () => pine(true),
  juniper,
  oak,
  cypress,
};

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Flora {
  constructor(terrain, route, keepOut) {
    this.terrain = terrain;
    this.route = route;
    this.keepOut = keepOut; // [{ x0, x1, z0, z1 }] nothing grows here
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.kinds = Object.fromEntries(Object.entries(MAKERS).map(([k, make]) => [k, make()]));
  }

  // Instanced props for one tile, plus the solid ones as {x, z, r} circles.
  scatter(ix, iz, x0, z0, size, groundAt) {
    const rand = rng(ix * 7919 + iz * 104729 + 1);
    const group = new THREE.Group();
    const obstacles = [];
    const placed = {};
    const near = {};
    const cx = x0 + size / 2;
    const cz = z0 + size / 2;
    const f = this.terrain.field(cx, cz);
    const area = (size / 250) ** 2;

    // The biome at the tile center decides the mix; spots across a border mostly get skipped
    // so neighboring tiles blend into each other.
    const tryPlace = (kind, scale, x, z) => {
      for (const k of this.keepOut) if (x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1) return;
      if (this.route.nearest(x, z, ROAD_HALF + 8, near)) return; // keep the road and shoulders clear
      const y = groundAt(x, z);
      if (y < SEA_LEVEL + 3) return;
      (placed[kind] ??= []).push([x, y, z, scale, rand() * Math.PI * 2]);
      const r = this.kinds[kind].radius * scale;
      if (r > 0) obstacles.push({ x, z, r });
    };

    const key = this.terrain.biomeAt(f.s).key;
    for (const [kind, count, s0, s1] of FLORA[key] ?? []) {
      const n = Math.round(count * area);
      for (let i = 0; i < n; i++) {
        const x = x0 + rand() * size;
        const z = z0 + rand() * size;
        const scale = s0 + rand() * (s1 - s0);
        if (this.terrain.biomeAt(this.terrain.field(x, z).s).key !== key && rand() < 0.7) continue;
        tryPlace(kind, scale, x, z);
      }
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const [key, list] of Object.entries(placed)) {
      const inst = new THREE.InstancedMesh(this.kinds[key].geo, this.material, list.length);
      list.forEach(([x, y, z, s, rot], i) => {
        q.setFromAxisAngle(up, rot);
        m.compose(v.set(x, y - 0.05, z), q, sc.set(s, s, s));
        inst.setMatrixAt(i, m);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    return { group, obstacles };
  }
}
