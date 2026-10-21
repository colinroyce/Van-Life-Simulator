import * as THREE from 'three';
import { BUILD, Buildout } from './buildout.js';
import { indoor, CAB_AMBIENT } from './indoor.js';

// Modeled on a Sprinter 144" wheelbase high roof. Van faces +Z, driver on the left (+X). Meters.
export const VAN = {
  halfWidth: 1.0,
  frontAxleZ: 1.83,
  rearAxleZ: -1.83,
  noseZ: 2.88,
  tailZ: -3.1,
  wheelRadius: 0.39,
  trackHalf: 0.86,
  eye: new THREE.Vector3(0.48, 1.93, 0.62),
};

export const DEFAULT_PAINT = 0x3a3e43; // graphite grey metallic

// ---------------------------------------------------------------------------
// Body shape. The shell is lofted through cross-sections whose dimensions come
// from these side-view tables of [z, value].
// ---------------------------------------------------------------------------
const TOP = [
  [-3.1, 2.6], [-3.06, 2.71], [-2.98, 2.76], [-2.85, 2.77], // rear roof edge
  [0.3, 2.77], [0.52, 2.74], [0.7, 2.66], [0.83, 2.52], [0.9, 2.36], // high-roof brow
  [0.95, 2.22], // windshield header
  [1.88, 1.4], // cowl
  [2.3, 1.34], [2.62, 1.27], [2.76, 1.22], [2.84, 1.14], [2.88, 1.02], // hood -> nose
];
const BOTTOM = [[-3.1, 0.52], [-2.95, 0.44], [2.6, 0.44], [2.88, 0.52]];
const HALF_W = [[-3.1, 0.955], [-3.03, 0.99], [-2.9, 1.0], [2.45, 1.0], [2.65, 0.975], [2.78, 0.935], [2.88, 0.88]];
const CORNER_R = [[-3.1, 0.2], [0.3, 0.22], [0.95, 0.2], [1.88, 0.16], [2.88, 0.12]];

const BELT = 1.4; // where the sides start leaning inward
const ROOF = 2.77;
const TUMBLEHOME = 0.08;
const CROWN = 0.03;
const ARCH_R = 0.53;
const ARCH_Y = VAN.wheelRadius;
const WELL_X = 0.7; // inner wall of the wheel wells

// Window openings cut through the shell (z ranges; side windows span WIN_LOW..WIN_HIGH)
const WIN_LOW = 1.45;
const WIN_HIGH = 2.33;
const CAB_WINDOW = [0.44, 2.0]; // front edge follows the A-pillar
const CARGO_WINDOW = [-0.92, 0.27];
const SLIDING_DOOR = [-1.0, 0.37]; // passenger side (-X), sill up to WIN_HIGH
const DRIVER_DOOR = [0.37, 1.65]; // driver side (+X), from the B-pillar to past the window
const DRIVER_DOOR_OPEN = -1.1; // swing (radians), hinged at its front edge
const FUEL_NECK = new THREE.Vector3(1.0, 0.95, 0.05); // filler behind the driver door
const WINDSHIELD = [0.97, 1.86];
const REAR_WINDOWS = { x: [0.06, 0.84], y: [1.77, 2.35] };

// Ring indices (right/driver half; the left half mirrors them in reverse)
const R = { winLow: 4, winHigh: 5, glassFrom: 7, center: 10, glassTo: 13, winHighL: 15, winLowL: 16 };

function sample(table, z) {
  if (z <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i];
    if (z <= z1) {
      const [z0, v0] = table[i - 1];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return table[table.length - 1][1];
}

const tumble = (y) => TUMBLEHOME * THREE.MathUtils.clamp((y - BELT) / (ROOF - BELT), 0, 1);

// Outer surface x of the flat side panels at height y.
const sideX = (y, z) => sample(HALF_W, z) - tumble(y);

function bottomAt(z) {
  let b = sample(BOTTOM, z);
  for (const axle of [VAN.frontAxleZ, VAN.rearAxleZ]) {
    const dz = z - axle;
    if (Math.abs(dz) < ARCH_R) b = Math.max(b, ARCH_Y + Math.sqrt(ARCH_R ** 2 - dz * dz));
  }
  return b;
}

// Cross-section at z, counter-clockwise seen from the front:
// 0-1 wheel-well wall, 2 arch, 3 belt, 4-5 window, 6-9 roof corner, 10 top center, 11-20 mirrored.
function ring(z) {
  const t = sample(TOP, z);
  const b = bottomAt(z);
  const base = sample(BOTTOM, z);
  const w = sample(HALF_W, z);
  const r = sample(CORNER_R, z);
  const top = t - r;
  const belt = Math.max(Math.min(BELT, top - 0.01), b + 0.01);
  const lo = THREE.MathUtils.clamp(WIN_LOW, belt, top);
  const hi = THREE.MathUtils.clamp(WIN_HIGH, lo, top);
  const xs = w - tumble(top);
  const right = [
    [WELL_X, base], [WELL_X, b], [w, b], [w, belt],
    [w - tumble(lo), lo], [w - tumble(hi), hi], [xs, top],
  ];
  for (const a of [Math.PI / 6, Math.PI / 3, Math.PI / 2]) {
    right.push([xs - r + r * Math.cos(a), top + r * Math.sin(a)]);
  }
  const pts = [...right, [0, t + CROWN], ...right.slice().reverse().map(([x, y]) => [-x, y])];
  return pts.map(([x, y]) => new THREE.Vector3(x, y, z));
}

function stationZs() {
  const zs = new Set([CAB_WINDOW[0], ...CARGO_WINDOW, ...WINDSHIELD, ...SLIDING_DOOR, ...DRIVER_DOOR]);
  for (const table of [TOP, BOTTOM, HALF_W, CORNER_R]) for (const [z] of table) zs.add(z);
  const phi0 = Math.acos((sample(BOTTOM, 0) - ARCH_Y) / ARCH_R);
  for (const axle of [VAN.frontAxleZ, VAN.rearAxleZ]) {
    for (let i = 0; i <= 8; i++) zs.add(axle + ARCH_R * Math.sin(-phi0 + (2 * phi0 * i) / 8));
  }
  return [...zs].sort((a, b) => a - b).filter((z, i, arr) => i === 0 || z - arr[i - 1] > 1e-3);
}

const STATIONS = stationZs();
const RINGS = STATIONS.map(ring);
const ringsWithin = ([z0, z1]) => RINGS.filter((r) => r[0].z >= z0 - 1e-6 && r[0].z <= z1 + 1e-6);

function isWindow(zMid, k0, k1) {
  const inside = ([z0, z1]) => zMid > z0 && zMid < z1;
  if ((k0 === R.winLow && k1 === R.winHigh) || (k0 === R.winHighL && k1 === R.winLowL)) {
    return inside(CAB_WINDOW) || inside(CARGO_WINDOW);
  }
  return k1 > k0 && k0 >= R.glassFrom && k1 <= R.glassTo && inside(WINDSHIELD);
}

// Ring edges covered by the sliding door panel (left half: winHigh -> belt -> sill).
const DOOR_EDGES = [R.winHighL, R.winLowL, R.winLowL + 1, R.winLowL + 2];
const isDoorPanel = (zMid, k0, k1) =>
  k1 > k0 && zMid > SLIDING_DOOR[0] && zMid < SLIDING_DOOR[1] && k0 >= DOOR_EDGES[0] && k1 <= DOOR_EDGES[3];
// Driver door covers the right half from the arch/sill up to the top of the window.
const DRIVER_EDGES = [2, 3, R.winLow, R.winHigh];
const isDriverDoor = (zMid, k0, k1) =>
  k1 > k0 && zMid > DRIVER_DOOR[0] && zMid < DRIVER_DOOR[1] && k0 >= DRIVER_EDGES[0] && k1 <= DRIVER_EDGES[3];
const isShellOpening = (zMid, k0, k1) => isWindow(zMid, k0, k1) || isDoorPanel(zMid, k0, k1) || isDriverDoor(zMid, k0, k1);

// Van-local floor plan used for walking around (x, z in meters).
export const LAYOUT = {
  floorY: 0.7,
  wallX: 0.965,
  rearZ: -3.05,
  dashZ: 1.22,
  noseZ: 2.98,
  door: SLIDING_DOOR,
  driverDoor: DRIVER_DOOR,
  fuelNeck: FUEL_NECK,
  driverSeat: new THREE.Vector3(0.48, 0, 0.72),
  standUp: new THREE.Vector3(0, 0, 0.6), // between the seats
  // Solid boxes inside: [xMin, xMax, zMin, zMax]
  blocks: [
    [0.25, 0.74, 0.38, 1.0], // driver seat
    [-0.74, -0.25, 0.38, 1.0], // passenger seat
    [-0.18, 0.18, 0.875, 1.325], // center console
    [0.7, 1.0, -2.36, -1.3], // rear wheel wells
    [-1.0, -0.7, -2.36, -1.3],
    ...BUILD.blocks,
  ],
  walls: BUILD.walls,
  inBath: BUILD.inBath,
  bathDoor: BUILD.bathDoor,
  showerValve: BUILD.showerValve,
  toilet: BUILD.toilet,
  lightSwitch: BUILD.lightSwitch,
  faucetTip: BUILD.faucetTip,
  burner: BUILD.burner,
  // Bottle holders (base of the bottle). The dash one sits beside the touchscreen.
  holders: [
    { id: 'dash', label: 'dash holder', at: new THREE.Vector3(-0.28, 1.348, 1.4), mount: 'dash' },
    ...BUILD.holders,
    // Inside the fridge: takes any item, only reachable while the door is open
    ...BUILD.fridgeSlots.map((at, i) => ({ id: `fridge${i}`, label: 'fridge', at, mount: 'none', accepts: 'any', fridge: true })),
  ],
  bedFront: BUILD.bedFront,
  bedStand: BUILD.bedStand,
  bedHead: BUILD.bedHead,
  cabZ: 0.38, // forward of this the overhead shelf makes you duck
};

// Moves a ring point outward along the cross-section normal.
function pushOut(pts, k, dist) {
  const prev = pts[Math.max(k - 1, 0)];
  const next = pts[Math.min(k + 1, pts.length - 1)];
  const n = new THREE.Vector3(next.y - prev.y, -(next.x - prev.x), 0).normalize();
  return pts[k].clone().addScaledVector(n, dist);
}

function loft(rings, indices, { wrap = false, lift = 0, skip } = {}) {
  const pos = [];
  const pt = (r, k) => (lift ? pushOut(r, k, lift) : r[k]);
  const edges = indices.length - (wrap ? 0 : 1);
  for (let i = 0; i < rings.length - 1; i++) {
    const zMid = (rings[i][0].z + rings[i + 1][0].z) / 2;
    for (let j = 0; j < edges; j++) {
      const k0 = indices[j];
      const k1 = indices[(j + 1) % indices.length];
      if (skip?.(zMid, k0, k1)) continue;
      const a = pt(rings[i], k0);
      const b = pt(rings[i], k1);
      const c = pt(rings[i + 1], k1);
      const d = pt(rings[i + 1], k0);
      for (const v of [a, b, c, a, c, d]) pos.push(v.x, v.y, v.z);
    }
  }
  return pos;
}

function fanCap(pts) {
  const pos = [];
  const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(pts.length);
  for (let j = 0; j < pts.length; j++) {
    for (const v of [c, pts[j], pts[(j + 1) % pts.length]]) pos.push(v.x, v.y, v.z);
  }
  return pos;
}

// Flat rear face with the two rear-door window openings, facing -Z.
function rearCap(pts) {
  const outline = pts
    .map((p) => new THREE.Vector2(p.x, p.y))
    .filter((p, i, arr) => p.distanceTo(arr[(i + 1) % arr.length]) > 1e-4);
  const shape = new THREE.Shape(outline);
  const { x: [x0, x1], y: [y0, y1] } = REAR_WINDOWS;
  for (const s of [1, -1]) {
    const xs = [s * x0, s * x1].sort((a, b) => a - b);
    shape.holes.push(new THREE.Path([
      new THREE.Vector2(xs[0], y0), new THREE.Vector2(xs[1], y0),
      new THREE.Vector2(xs[1], y1), new THREE.Vector2(xs[0], y1),
    ]));
  }
  const g = new THREE.ShapeGeometry(shape);
  const p = g.attributes.position;
  const idx = g.index.array;
  const pos = [];
  for (let i = 0; i < idx.length; i += 3) {
    for (const k of [idx[i], idx[i + 2], idx[i + 1]]) pos.push(p.getX(k), p.getY(k), pts[0].z);
  }
  return pos;
}

function toGeometry(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function buildShellGeometry() {
  const all = [...RINGS[0].keys()];
  return toGeometry([
    ...loft(RINGS, all, { wrap: true, skip: isShellOpening }),
    ...rearCap(RINGS[0]),
    ...fanCap(RINGS[RINGS.length - 1]),
  ]);
}

// Glass that exactly fills the openings, lifted just off the surface.
function glassGeometry(range, indices) {
  return toGeometry(loft(ringsWithin(range), indices, { lift: 0.006 }));
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...opts });
const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

const TRIM = mat(0x1a1b1d, { roughness: 0.85 });
const SEAM = mat(0x121315, { roughness: 0.9, ...decal });
const TRIM_DECAL = mat(0x18191b, { roughness: 0.6, ...decal });
// Glass is single-sided: tinted from outside, clear from the driver's seat.
const GLASS = mat(0x0b1014, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
const PRIVACY_GLASS = mat(0x07090b, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.78, depthWrite: false });
const MIRROR = mat(0xb8c4cc, { roughness: 0.02, metalness: 1 });
const CHROME = mat(0xc8ccd0, { roughness: 0.2, metalness: 1 });
const GRILLE = mat(0x101113, { roughness: 0.4 });
const LENS = mat(0x8e979e, { roughness: 0.05, metalness: 0.4 });
const HOUSING = mat(0x1b1d20, { roughness: 0.3, metalness: 0.5 });
const DRL = mat(0xffffff, { emissive: 0xf4f8ff, emissiveIntensity: 1.5 });
const TAIL = mat(0xa01a14, { roughness: 0.2, emissive: 0x5a0a06, emissiveIntensity: 0.6 });
const AMBER = mat(0xd98a1a, { roughness: 0.2, emissive: 0x6a3a00, emissiveIntensity: 0.6 });
const PLATE = mat(0xd9d9d2);
const TIRE = mat(0x1c1c1e, { roughness: 0.95 });
const RIM = mat(0x3a3d41, { roughness: 0.45, metalness: 0.6 });

// Interior
const LINING = indoor(mat(0x4a4d53, { side: THREE.BackSide, roughness: 0.8 }), 0.3);
const cab = (color, opts) => indoor(mat(color, opts), CAB_AMBIENT);
const DASH = cab(0x2a2c30, { roughness: 0.75 });
const DASH_TOP = cab(0x1f2124, { roughness: 0.9 });
const DASH_DARK = cab(0x141517, { roughness: 0.9 });
const PANEL = cab(0x3b3e44, { roughness: 0.8 });
const HEADLINER = cab(0x8b8e93, { roughness: 0.95 });
const SHELF = cab(0x55585e, { roughness: 0.8 });
const FLOOR = indoor(mat(0x1e1f22, { roughness: 0.95 }));
const SEAT = cab(0x33363b, { roughness: 0.95 });
const SEAT_INSERT = cab(0x45484e, { roughness: 1 });
const SCREEN = mat(0x0f1a26, { roughness: 0.2, emissive: 0x1d3c5c, emissiveIntensity: 0.8 });
const GAUGE = mat(0x101215, { roughness: 0.3, emissive: 0x0c1620, emissiveIntensity: 0.6 });
const NEEDLE = mat(0xff5a1f, { emissive: 0xff3a00, emissiveIntensity: 0.8 });
const WHEEL_MAT = cab(0x1d1e21, { roughness: 0.6 });
const SKIN = cab(0xd9a07a);
const SLEEVE = cab(0x3f6b8c);
const HAIR = cab(0x3a2a1e);

const REFLECTIVE = [GLASS, PRIVACY_GLASS, MIRROR, CHROME, LENS, RIM];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cylinderZ(radius, depth, segments, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Side-profile [z, y] polygon extruded across x from x0 to x1.
function extrudeAcross(points, x0, x1, material) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2); // shape x -> z, depth -> -x
  g.translate(x1, 0, 0);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Flat polygon laid onto a side panel, from [z, y] points. side: +1 left, -1 right.
function sideDecal(points, side, material, lift = 0.006) {
  const tris = THREE.ShapeUtils.triangulateShape(points.map(([z, y]) => new THREE.Vector2(z, y)), []);
  const v = points.map(([z, y]) => new THREE.Vector3(side * (sideX(y, z) + lift), y, z));
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const pos = [];
  for (const [i, j, k] of tris) {
    ab.subVectors(v[j], v[i]);
    ac.subVectors(v[k], v[i]);
    const order = Math.sign(ab.cross(ac).x) === side ? [i, j, k] : [i, k, j];
    for (const n of order) pos.push(v[n].x, v[n].y, v[n].z);
  }
  const m = new THREE.Mesh(toGeometry(pos), material);
  m.receiveShadow = true;
  return m;
}

// Thin seam line between [z, y] points.
function sideLine(points, side, width = 0.012) {
  const g = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) {
    const [z0, y0] = points[i];
    const [z1, y1] = points[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const nz = (-(y1 - y0) / len) * width * 0.5;
    const ny = ((z1 - z0) / len) * width * 0.5;
    g.add(sideDecal([[z0 - nz, y0 - ny], [z1 - nz, y1 - ny], [z1 + nz, y1 + ny], [z0 + nz, y0 + ny]], side, SEAM, 0.004));
  }
  return g;
}

function archFlare() {
  const ro = 0.6;
  const ri = ARCH_R - 0.005;
  const y0 = sample(BOTTOM, 0) - ARCH_Y;
  const ends = (r) => [Math.atan2(y0, -Math.sqrt(r * r - y0 * y0)), Math.atan2(y0, Math.sqrt(r * r - y0 * y0))];
  const [o0, o1] = ends(ro);
  const [i0, i1] = ends(ri);
  const s = new THREE.Shape();
  s.absarc(0, ARCH_Y, ro, o0, o1, true);
  s.absarc(0, ARCH_Y, ri, i1, i0, false);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  return g;
}

function frontBumperGeometry() {
  const back = 2.36;
  const front = 2.98;
  const hw = 1.03;
  const cr = 0.25;
  const s = new THREE.Shape(); // (x, -z) in plan view
  s.moveTo(-hw, -back);
  s.lineTo(-hw, -(front - cr));
  s.quadraticCurveTo(-hw, -front, -hw + cr, -front);
  s.lineTo(hw - cr, -front);
  s.quadraticCurveTo(hw, -front, hw, -(front - cr));
  s.lineTo(hw, -back);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.44, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.28, 0);
  return g;
}

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------
function buildExterior(paint) {
  const g = new THREE.Group();

  const shellGeo = buildShellGeometry();
  const shell = new THREE.Mesh(shellGeo, paint);
  shell.castShadow = true;
  shell.receiveShadow = true;
  // Same surface seen from inside: the bare interior walls.
  const lining = new THREE.Mesh(shellGeo, LINING);
  lining.receiveShadow = true;
  g.add(shell, lining);

  // Glass
  const windshield = [R.glassFrom, 8, 9, R.center, 11, 12, R.glassTo];
  g.add(new THREE.Mesh(glassGeometry(WINDSHIELD, windshield), GLASS));
  g.add(new THREE.Mesh(glassGeometry(CAB_WINDOW, [R.winHighL, R.winLowL]), GLASS)); // driver's is on the door
  g.add(new THREE.Mesh(glassGeometry(CARGO_WINDOW, [R.winLow, R.winHigh]), PRIVACY_GLASS));

  const flare = archFlare();
  const nose = VAN.noseZ;
  const tail = VAN.tailZ;
  const { x: [rx0, rx1], y: [ry0, ry1] } = REAR_WINDOWS;

  for (const side of [1, -1]) {
    // Blacked-out B-pillar between the cab and cargo windows (passenger side: the rest is on the door)
    // (the part over each door opening is on the door)
    const [bFrom, bTo] = side > 0 ? [CARGO_WINDOW[1], DRIVER_DOOR[0]] : [SLIDING_DOOR[1], CAB_WINDOW[0]];
    g.add(sideDecal([[bFrom, WIN_LOW], [bTo, WIN_LOW], [bTo, WIN_HIGH], [bFrom, WIN_HIGH]], side, TRIM_DECAL, 0.005));
    g.add(sideLine([[0.37, 2.34], [0.37, 2.38]], side));

    // Passenger front door seams + handle (the driver's door is a separate panel)
    if (side < 0) {
      g.add(sideLine([[1.56, 1.42], [1.54, 0.9]], side));
      g.add(sideLine([[1.28, 0.47], [0.37, 0.47], [0.37, 1.44]], side));
      g.add(box(0.03, 0.04, 0.16, TRIM, side * 1.02, 1.3, 0.58));
    }

    // Wheel arch flares and rocker trim
    for (const axle of [VAN.frontAxleZ, VAN.rearAxleZ]) {
      const f = new THREE.Mesh(flare, TRIM);
      f.position.set(side > 0 ? 1.035 : -1.0, 0, axle);
      f.castShadow = true;
      g.add(f);
    }
    if (side > 0) g.add(box(0.03, 0.15, 2.46, TRIM, 1.005, 0.52, 0));

    // Mirrors: arm, housing, glass facing back
    g.add(box(0.14, 0.05, 0.06, TRIM, side * 1.08, 1.52, 1.58));
    g.add(box(0.2, 0.36, 0.08, TRIM, side * 1.22, 1.68, 1.58));
    g.add(box(0.17, 0.3, 0.01, MIRROR, side * 1.22, 1.69, 1.535));

    // Headlight: front lens angled back toward the corner, wrapping onto the fender
    const head = new THREE.Group();
    head.position.set(side * 0.69, 0.95, nose - 0.02);
    head.rotation.y = side * 0.3;
    head.add(box(0.38, 0.21, 0.12, LENS));
    head.add(box(0.36, 0.16, 0.02, HOUSING, 0, 0.012, 0.055));
    for (const x of [-0.09, 0.07]) head.add(cylinderZ(0.05, 0.02, 10, CHROME, side * x, 0.02, 0.065));
    head.add(box(0.36, 0.025, 0.02, DRL, 0, -0.085, 0.062)); // LED strip
    head.add(box(0.025, 0.14, 0.02, DRL, side * 0.17, -0.02, 0.062));
    g.add(head);
    g.add(box(0.06, 0.17, 0.3, LENS, side * 0.885, 0.96, 2.64));

    // Fog light
    g.add(box(0.14, 0.07, 0.03, LENS, side * 0.68, 0.42, 2.98));

    // Tall taillights in the rear corners
    g.add(box(0.16, 0.55, 0.04, TAIL, side * 0.9, 1.3, tail - 0.025));
    g.add(box(0.16, 0.28, 0.04, AMBER, side * 0.9, 0.88, tail - 0.025));

    // Rear door glass
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(rx1 - rx0 + 0.02, ry1 - ry0 + 0.02), PRIVACY_GLASS);
    rw.rotation.y = Math.PI;
    rw.position.set((side * (rx0 + rx1)) / 2, (ry0 + ry1) / 2, tail - 0.006);
    g.add(rw);

    // Windshield wiper
    const wiper = box(0.62, 0.02, 0.025, TRIM, side * 0.3, 1.415, 1.9);
    wiper.rotation.z = side * -0.06;
    g.add(wiper);
  }

  // Passenger side: rocker trim either side of the door opening, door top seam, track cover
  const [d0, d1] = SLIDING_DOOR;
  g.add(box(0.03, 0.15, 1.23 - d1, TRIM, -1.005, 0.52, (1.23 + d1) / 2));
  g.add(box(0.03, 0.15, d0 + 1.23, TRIM, -1.005, 0.52, (d0 - 1.23) / 2));
  g.add(sideLine([[d1, 2.38], [d0, 2.38]], -1));
  g.add(sideDecal([[-2.92, 1.37], [d0, 1.37], [d0, 1.44], [-2.92, 1.44]], -1, TRIM_DECAL, 0.01));

  // Front end: grille with chrome bars and a round badge, bumper with intake and plate
  const grilleShape = new THREE.Shape([
    new THREE.Vector2(-0.47, 0.72), new THREE.Vector2(0.47, 0.72),
    new THREE.Vector2(0.53, 1.07), new THREE.Vector2(-0.53, 1.07),
  ]);
  const grille = new THREE.Mesh(new THREE.ExtrudeGeometry(grilleShape, { depth: 0.08, bevelEnabled: false }), GRILLE);
  grille.position.z = nose - 0.05;
  g.add(grille);
  for (const [y, w] of [[0.98, 1.0], [0.85, 0.94]]) g.add(box(w, 0.035, 0.03, CHROME, 0, y, nose + 0.035));
  const badge = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 20), CHROME);
  badge.position.set(0, 0.915, nose + 0.05);
  g.add(badge);

  const bumper = new THREE.Mesh(frontBumperGeometry(), TRIM);
  bumper.castShadow = true;
  g.add(bumper);
  g.add(box(1.2, 0.16, 0.03, GRILLE, 0, 0.42, 2.985));
  g.add(box(0.32, 0.16, 0.02, PLATE, 0, 0.6, 2.99));

  // Amber roof clearance lights on the brow
  for (const x of [-0.18, 0, 0.18]) g.add(box(0.08, 0.04, 0.05, AMBER, x, sample(TOP, 0.6) + 0.03, 0.6));

  // Rear: bumper with step, door seam and handle, third brake light, plate
  g.add(box(2.02, 0.24, 0.26, TRIM, 0, 0.55, tail - 0.02));
  g.add(box(0.7, 0.05, 0.2, TRIM, 0, 0.66, tail - 0.18));
  g.add(box(0.012, 2.0, 0.01, SEAM, 0, 1.55, tail - 0.008));
  g.add(box(0.18, 0.05, 0.04, TRIM, -0.15, 1.3, tail - 0.025));
  g.add(box(0.4, 0.05, 0.03, TAIL, 0, 2.5, tail - 0.02));
  g.add(box(0.32, 0.16, 0.02, PLATE, 0, 0.86, tail - 0.015));

  return g;
}

// Driver door, hinged at its front edge. Like the sliding door it's lofted from the shell's own
// rings, so it fills the opening exactly when closed. Carries its window, trim and inside panel.
function buildDriverDoor(paint) {
  const [d0, d1] = DRIVER_DOOR;
  const pivot = new THREE.Group();
  pivot.position.set(VAN.halfWidth, 0, d1);
  const g = new THREE.Group(); // door parts in body space, shifted so the pivot is the hinge
  g.position.set(-VAN.halfWidth, 0, -d1);
  pivot.add(g);
  pivot.userData.fixture = 'driverDoor';

  const skin = toGeometry(loft(ringsWithin(DRIVER_DOOR), DRIVER_EDGES, { skip: isWindow }));
  const outer = new THREE.Mesh(skin, paint);
  outer.castShadow = true;
  outer.receiveShadow = true;
  const inner = new THREE.Mesh(skin, LINING);
  inner.receiveShadow = true;
  g.add(outer, inner);
  g.add(new THREE.Mesh(glassGeometry(CAB_WINDOW, [R.winLow, R.winHigh]), GLASS));
  g.add(sideDecal([[d0, WIN_LOW], [CAB_WINDOW[0], WIN_LOW], [CAB_WINDOW[0], WIN_HIGH], [d0, WIN_HIGH]], 1, TRIM_DECAL, 0.005));
  g.add(sideLine([[1.28, 0.47], [d0, 0.47], [d0, 1.44]], 1));
  g.add(box(0.03, 0.04, 0.16, TRIM, 1.02, 1.3, 0.58)); // outside handle
  g.add(buildDoorCard(1));
  return pivot;
}

// Little flap over the filler, opening outward from its front edge.
function buildFuelDoor(paint) {
  const n = FUEL_NECK;
  const g = new THREE.Group();
  g.userData.fixture = 'fuelDoor';
  // Recess with the filler neck, flat on the skin so the closed flap (x +0.008..+0.016) covers it
  const recess = box(0.004, 0.15, 0.15, GRILLE, n.x + 0.002, n.y, n.z);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.003, 12), CHROME);
  neck.rotation.z = Math.PI / 2;
  neck.position.set(n.x + 0.0055, n.y, n.z);
  const flapPivot = new THREE.Group();
  flapPivot.position.set(n.x + 0.012, n.y, n.z + 0.085);
  flapPivot.add(box(0.008, 0.16, 0.17, paint, 0, 0, -0.085));
  // Easy-to-aim-at target around the flap
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.set(n.x + 0.04, n.y, n.z);
  g.add(recess, neck, flapPivot, proxy);

  // Green frame around the door, shown while you're looking right at it
  const glow = new THREE.MeshBasicMaterial({ color: 0x3dff6e, transparent: true, depthTest: false, toneMapped: false });
  const highlight = new THREE.Group();
  highlight.visible = false;
  const [hh, hw, t] = [0.1, 0.105, 0.01]; // half height, half width, bar thickness
  for (const [y, z, h, w] of [[hh, 0, t, hw * 2 + t], [-hh, 0, t, hw * 2 + t], [0, hw, hh * 2, t], [0, -hw, hh * 2, t]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.002, h, w), glow);
    bar.position.set(n.x + 0.02, n.y + y, n.z + z);
    bar.renderOrder = 10;
    bar.userData.noAim = true;
    highlight.add(bar);
  }
  g.add(highlight);
  return { group: g, flap: flapPivot, highlight, glow };
}

// Passenger sliding door. Built from the same rings as the shell so it fills the
// opening exactly when closed; it pops out and slides back along the track to open.
function buildSlidingDoor(paint) {
  const g = new THREE.Group();
  const [d0, d1] = SLIDING_DOOR;
  const skin = toGeometry(loft(ringsWithin(SLIDING_DOOR), DOOR_EDGES, { skip: isWindow }));
  const outer = new THREE.Mesh(skin, paint);
  outer.castShadow = true;
  outer.receiveShadow = true;
  const inner = new THREE.Mesh(skin, LINING);
  inner.receiveShadow = true;
  g.add(outer, inner);
  g.add(new THREE.Mesh(glassGeometry(CARGO_WINDOW, [R.winHighL, R.winLowL]), PRIVACY_GLASS));
  g.add(sideDecal([[CARGO_WINDOW[1], WIN_LOW], [d1, WIN_LOW], [d1, WIN_HIGH], [CARGO_WINDOW[1], WIN_HIGH]], -1, TRIM_DECAL, 0.005));
  g.add(sideLine([[d0, WIN_HIGH], [d0, 0.47], [d1, 0.47]], -1));
  g.add(box(0.03, 0.15, d1 - d0, TRIM, -1.005, 0.52, (d0 + d1) / 2)); // rocker
  g.add(box(0.03, 0.04, 0.2, TRIM, -1.02, 1.25, -0.85)); // outside handle
  g.add(box(0.03, 0.04, 0.16, CHROME, -0.95, 1.25, -0.85)); // inside handle
  return g;
}

// ---------------------------------------------------------------------------
// Cab interior. Everything stays inside the shell; the lining covers the rest.
// ---------------------------------------------------------------------------
function buildDashboard() {
  const g = new THREE.Group();

  // Main dash body: rear face toward the driver, top running forward to meet the windshield base
  g.add(extrudeAcross(
    [[1.24, 1.12], [1.4, 0.98], [1.92, 0.98], [1.92, 1.37], [1.55, 1.355], [1.36, 1.345], [1.27, 1.29]],
    -0.9, 0.9, DASH,
  ));
  // Storage trays on top
  g.add(box(0.5, 0.01, 0.2, DASH_DARK, -0.45, 1.356, 1.5));
  g.add(box(0.3, 0.01, 0.14, DASH_DARK, 0, 1.36, 1.66));

  // Instrument binnacle rising above the dash, visible through the top of the wheel
  const x = VAN.eye.x;
  const gy = 1.48;
  g.add(box(0.5, 0.04, 0.2, DASH_TOP, x, gy + 0.1, 1.58));
  g.add(box(0.03, 0.24, 0.3, DASH_TOP, x - 0.235, gy - 0.01, 1.52));
  g.add(box(0.03, 0.24, 0.3, DASH_TOP, x + 0.235, gy - 0.01, 1.52));
  g.add(box(0.46, 0.24, 0.03, DASH_DARK, x, gy - 0.01, 1.64));
  for (const dx of [-0.1, 0.1]) {
    g.add(cylinderZ(0.055, 0.01, 18, GAUGE, x + dx, gy, 1.62));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.057, 0.006, 4, 18), CHROME);
    rim.position.set(x + dx, gy, 1.616);
    g.add(rim);
    const needle = box(0.006, 0.045, 0.004, NEEDLE, x + dx, gy + 0.012, 1.612);
    needle.rotation.z = dx > 0 ? 0.6 : -0.9;
    g.add(needle);
  }
  g.add(box(0.07, 0.05, 0.005, SCREEN, x, gy - 0.02, 1.62)); // trip display between dials

  // Free-standing touchscreen in the center
  const screen = new THREE.Group();
  screen.position.set(0, 1.47, 1.42);
  screen.rotation.x = 0.2;
  screen.add(box(0.36, 0.22, 0.03, DASH_DARK));
  screen.add(box(0.33, 0.19, 0.005, SCREEN, 0, 0, -0.016));
  // Display surface (the GPS draws on it when the engine's running)
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.18), SCREEN);
  display.name = 'gpsDisplay';
  display.position.z = -0.0195;
  display.rotation.y = Math.PI;
  screen.add(display);
  g.add(screen);

  // Round air vents on the dash face
  for (const vx of [-0.78, -0.11, 0.11, 0.78]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 14), CHROME);
    ring.position.set(vx, 1.22, 1.242);
    g.add(ring, cylinderZ(0.038, 0.02, 12, DASH_DARK, vx, 1.22, 1.25));
  }

  // Climate controls and glovebox
  g.add(box(0.3, 0.07, 0.02, DASH_DARK, 0, 1.13, 1.235));
  for (const kx of [-0.09, 0, 0.09]) g.add(cylinderZ(0.018, 0.02, 10, CHROME, kx, 1.13, 1.222));
  g.add(box(0.44, 0.12, 0.012, DASH_TOP, -0.5, 1.2, 1.25));

  // Footwell floor and lower center console with cupholders
  g.add(box(1.4, 0.04, 0.62, FLOOR, 0, 0.72, 1.61));
  g.add(box(0.36, 0.3, 0.42, DASH, 0, 0.85, 1.1));
  for (const cz of [0.98, 1.1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 10), DASH_DARK);
    cup.position.set(0, 1.003, cz);
    g.add(cup);
  }
  return g;
}

function buildDoorCard(side) {
  const g = new THREE.Group();
  const outline = [[0.4, 0.72], [1.25, 0.72]];
  for (let i = 0; i <= 5; i++) {
    const z = 1.3 + (0.52 * i) / 5;
    outline.push([z, bottomAt(z) + 0.03]);
  }
  outline.push([1.82, 1.1], [1.6, 1.43], [0.4, 1.43]);
  const x1 = side > 0 ? 0.98 : -0.93;
  g.add(extrudeAcross(outline, x1 - 0.05, x1, PANEL));

  const inner = side * 0.93;
  g.add(box(0.08, 0.05, 0.7, DASH, inner - side * 0.04, 1.13, 0.95)); // armrest
  g.add(box(0.07, 0.16, 0.8, DASH, inner - side * 0.035, 0.86, 1.05)); // door pocket
  g.add(box(0.02, 0.04, 0.12, CHROME, inner - side * 0.01, 1.27, 1.38)); // handle
  return g;
}

function buildSeat(side) {
  const g = new THREE.Group();
  const x = side * 0.48;
  g.add(box(0.42, 0.34, 0.42, DASH_DARK, x, 0.87, 0.72)); // pedestal
  g.add(box(0.52, 0.13, 0.54, SEAT, x, 1.105, 0.72)); // cushion
  const back = new THREE.Group();
  back.position.set(x, 1.17, 0.45);
  back.rotation.x = -0.1;
  back.add(box(0.52, 0.76, 0.14, SEAT, 0, 0.38, 0));
  back.add(box(0.3, 0.5, 0.02, SEAT_INSERT, 0, 0.36, 0.075));
  back.add(box(0.32, 0.24, 0.12, SEAT, 0, 0.88, -0.02)); // headrest
  g.add(back);
  // inboard armrest
  g.add(box(0.07, 0.06, 0.4, SEAT, side * 0.19, 1.37, 0.68));
  return g;
}

function buildInterior() {
  const g = new THREE.Group();
  g.add(buildDashboard());

  // Floor: center strip between the wheel wells, side strips where there are no wells
  g.add(box(1.4, 0.04, 4.35, FLOOR, 0, 0.68, -0.875));
  for (const side of [1, -1]) {
    g.add(box(0.28, 0.04, 2.6, FLOOR, side * 0.84, 0.68, 0));
    g.add(box(0.28, 0.04, 0.68, FLOOR, side * 0.84, 0.68, -2.71));
  }

  // High-roof storage shelf over the cab (the cargo ceiling is part of the build-out)
  g.add(box(1.6, 0.04, 0.45, SHELF, 0, 2.33, 0.66));
  g.add(box(1.6, 0.08, 0.03, SHELF, 0, 2.37, 0.87));

  // Sun visors and rear-view mirror
  for (const side of [1, -1]) {
    const visor = box(0.42, 0.025, 0.18, HEADLINER, side * 0.45, 2.2, 0.82);
    visor.rotation.x = 0.15;
    g.add(visor);
  }
  g.add(box(0.03, 0.06, 0.03, DASH_DARK, 0, 2.15, 0.97));
  g.add(box(0.24, 0.07, 0.03, DASH_DARK, 0, 2.09, 0.955));
  g.add(box(0.21, 0.05, 0.005, MIRROR, 0, 2.09, 0.939));

  for (const side of [1, -1]) {
    if (side < 0) g.add(buildDoorCard(side)); // the driver's is on the door
    g.add(buildSeat(side));
    g.add(box(0.04, 0.08, 0.05, DASH_DARK, side * 0.9, 2.1, 0.38)); // seatbelt anchor
  }
  return g;
}

// Shown only in the chase view; in the driver view the camera is the driver's head.
function buildDriver() {
  const g = new THREE.Group();
  const x = VAN.eye.x;
  const torso = box(0.4, 0.56, 0.22, SLEEVE, x, 1.48, 0.6);
  torso.rotation.x = -0.1;
  g.add(torso);
  g.add(box(0.1, 0.08, 0.1, SKIN, x, 1.8, 0.62)); // neck
  g.add(box(0.19, 0.23, 0.21, SKIN, x, 1.93, 0.63)); // head
  g.add(box(0.21, 0.08, 0.23, HAIR, x, 2.06, 0.62)); // beanie
  return g;
}

function buildWheel(side) {
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  const r = VAN.wheelRadius;
  const cyl = (radius, width, segs, material) => {
    const geo = new THREE.CylinderGeometry(radius, radius, width, segs);
    geo.rotateZ(Math.PI / 2);
    return new THREE.Mesh(geo, material);
  };
  const tire = cyl(r, 0.245, 14, TIRE);
  tire.castShadow = true;
  spin.add(tire, cyl(0.245, 0.25, 12, RIM), cyl(0.07, 0.27, 8, CHROME));
  // spokes on the outer face
  for (let k = 0; k < 3; k++) {
    const spoke = box(0.02, 0.44, 0.07, RIM, side * 0.128, 0, 0);
    spoke.rotation.x = (k * Math.PI) / 3;
    spin.add(spoke);
  }
  pivot.add(spin);
  return { pivot, spin };
}

// ---------------------------------------------------------------------------
const SHOULDERS = {
  cockpit: new THREE.Vector3(0.24, 1.45, 0.55), // kept low so the arms don't fill the view
  chase: new THREE.Vector3(0.2, 1.66, 0.62),
};

export class VanModel {
  constructor({ paint = DEFAULT_PAINT } = {}) {
    this.paint = mat(paint, { roughness: 0.4, metalness: 0.3, envMapIntensity: 0.45 });

    this.root = new THREE.Group(); // moves with the van; wheels attach here
    this.body = new THREE.Group(); // leans/pitches on the suspension
    this.root.add(this.body);

    this.driver = buildDriver();
    this.door = buildSlidingDoor(this.paint);
    this.driverDoor = buildDriverDoor(this.paint);
    this.driverDoorOpen = false;
    this.driverDoorT = 0;
    this.fuelDoor = buildFuelDoor(this.paint);
    this.fuelDoorOpen = false;
    this.fuelDoorT = 0;
    this.body.add(this.driverDoor, this.fuelDoor.group);
    this.buildout = new Buildout();
    this.body.add(buildExterior(this.paint), buildInterior(), this.driver, this.door, this.buildout.group);
    this.lightsOn = false;
    this.doorOpen = false;
    this.doorT = 0; // 0 closed .. 1 fully open


    this.wheels = [];
    for (const z of [VAN.frontAxleZ, VAN.rearAxleZ]) {
      for (const side of [1, -1]) {
        const w = buildWheel(side);
        w.pivot.position.set(side * VAN.trackHalf, VAN.wheelRadius, z);
        w.front = z > 0;
        this.root.add(w.pivot);
        this.wheels.push(w);
      }
    }

    this.#buildSteering();
    this.setOccupant('chase');
    this.screen = this.body.getObjectByName('gpsDisplay');
    // Rolled-up road map lying on the passenger seat
    this.roadMap = new THREE.Group();
    this.roadMap.position.set(-0.46, 1.205, 0.78);
    this.roadMap.rotation.y = 0.5;
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.42, 10), mat(0xeee4c8));
    roll.rotation.z = Math.PI / 2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 10), mat(0xc0392b));
    band.rotation.z = Math.PI / 2;
    this.roadMap.add(roll, band);
    this.body.add(this.roadMap);
    this.screenOff = this.screen.material;
  }

  // Show a texture on the center touchscreen, or blank it (null).
  setScreen(material) {
    this.screen.material = material ?? this.screenOff;
  }

  // Reflections for paint, glass and chrome.
  setEnvironment(envMap) {
    for (const m of [this.paint, ...REFLECTIVE]) {
      m.envMap = envMap;
      m.needsUpdate = true;
    }
  }

  // Who's in the driver's seat: 'cockpit' (just hands, camera is the head),
  // 'chase' (whole driver visible) or 'empty' (player is walking around).
  setOccupant(mode) {
    this.driver.visible = mode === 'chase';
    for (const part of [...this.hands, ...this.arms]) part.visible = mode !== 'empty';
    this.shoulder = mode === 'cockpit' ? SHOULDERS.cockpit : SHOULDERS.chase;
  }

  get doorPassable() {
    return this.doorT > 0.85;
  }

  setDriverDoorOpen(open) {
    this.driverDoorOpen = open;
  }

  setFuelDoorOpen(open) {
    this.fuelDoorOpen = open;
  }

  // Outline the fuel door (with a gentle pulse) while the player is aiming at it.
  setFuelDoorHighlight(on, time = 0) {
    this.fuelDoor.highlight.visible = on;
    if (on) this.fuelDoor.glow.opacity = 0.65 + 0.35 * Math.sin(time * 6);
  }

  // The driver door as a wall segment (van space); it swings out when open.
  driverDoorSegment() {
    const a = this.driverDoor.rotation.y;
    const [d0, d1] = DRIVER_DOOR;
    const len = d1 - d0;
    return [[VAN.halfWidth, d1], [VAN.halfWidth - len * Math.sin(a), d1 - len * Math.cos(a)]];
  }

  setDoorOpen(open) {
    this.doorOpen = open;
  }

  setLights(on) {
    this.lightsOn = on;
    this.buildout.setLights(on);
  }

  get bathDoorOpen() {
    return this.buildout.bathDoorOpen;
  }

  get showerOn() {
    return this.buildout.showerOn;
  }

  setBathDoorOpen(open) {
    this.buildout.setBathDoorOpen(open);
  }

  setShower(on) {
    this.buildout.setShower(on);
  }

  // Animates things that move on their own (doors, shower water).
  update(dt) {
    this.buildout.update(dt);
    this.doorT = THREE.MathUtils.clamp(this.doorT + (this.doorOpen ? 1 : -1) * dt * 0.9, 0, 1);
    const ease = (t) => t * t * (3 - 2 * t);
    const out = ease(THREE.MathUtils.clamp(this.doorT / 0.25, 0, 1));
    const back = ease(THREE.MathUtils.clamp((this.doorT - 0.2) / 0.8, 0, 1));
    this.door.position.set(-0.1 * out, 0, -1.32 * back);

    this.driverDoorT = THREE.MathUtils.clamp(this.driverDoorT + (this.driverDoorOpen ? 1 : -1) * dt * 2, 0, 1);
    this.driverDoor.rotation.y = DRIVER_DOOR_OPEN * ease(this.driverDoorT);
    this.fuelDoorT = THREE.MathUtils.clamp(this.fuelDoorT + (this.fuelDoorOpen ? 1 : -1) * dt * 4, 0, 1);
    this.fuelDoor.flap.rotation.y = -1.7 * ease(this.fuelDoorT);
  }

  #buildSteering() {
    // Column tilts forward-down into the dash; wheel face is perpendicular to it.
    const column = new THREE.Group();
    column.position.set(VAN.eye.x, 1.58, 1.2);
    column.rotation.x = 0.65;
    this.body.add(column);

    column.add(box(0.11, 0.11, 0.32, DASH, 0, 0, 0.2)); // column shroud
    column.add(box(0.14, 0.015, 0.02, DASH_DARK, 0.1, 0.02, 0.1)); // indicator stalk
    column.add(box(0.12, 0.015, 0.02, DASH_DARK, -0.09, 0.02, 0.1)); // gear selector stalk

    this.wheelSpin = new THREE.Group();
    column.add(this.wheelSpin);

    // Three-spoke wheel: spokes at 3, 9 and 6 o'clock around an airbag hub
    this.wheelSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 24), WHEEL_MAT));
    this.wheelSpin.add(box(0.13, 0.1, 0.05, WHEEL_MAT));
    for (const s of [1, -1]) {
      this.wheelSpin.add(box(0.11, 0.045, 0.02, WHEEL_MAT, s * 0.115, -0.01, 0.005));
      this.wheelSpin.add(box(0.035, 0.025, 0.006, DASH_TOP, s * 0.1, -0.005, -0.008)); // buttons
    }
    this.wheelSpin.add(box(0.05, 0.11, 0.02, WHEEL_MAT, 0, -0.11, 0.005));
    this.wheelSpin.add(box(0.035, 0.02, 0.006, CHROME, 0, 0, -0.028)); // hub badge

    // Hands at 10 and 2. +X is the driver's left.
    this.hands = [];
    this.arms = [];
    const armGeo = new THREE.CylinderGeometry(0.045, 0.055, 1, 6);
    armGeo.translate(0, 0.5, 0);
    for (const side of [1, -1]) {
      const hand = new THREE.Group();
      hand.position.set(side * 0.165, 0.095, -0.02);
      hand.rotation.z = side * -0.5;
      hand.add(box(0.09, 0.1, 0.07, SKIN));
      hand.add(box(0.05, 0.035, 0.05, SKIN, side * -0.04, 0.03, -0.02)); // thumb
      this.wheelSpin.add(hand);
      this.hands.push(hand);

      const arm = new THREE.Mesh(armGeo, SLEEVE);
      arm.userData.side = side;
      this.body.add(arm);
      this.arms.push(arm);
    }
  }

  // Applies simulation state to the scene graph.
  sync(sim) {
    this.root.position.copy(sim.position);
    this.root.rotation.set(-sim.groundPitch, sim.yaw, sim.groundRoll, 'YXZ');
    this.body.rotation.set(sim.pitch, 0, sim.roll, 'YXZ');

    for (const w of this.wheels) {
      w.spin.rotation.x = sim.wheelSpin;
      w.pivot.rotation.y = w.front ? sim.steer : 0;
    }

    this.wheelSpin.rotation.z = -sim.steer * 3.2;
    this.#updateArms();
  }

  #updateArms() {
    this.root.updateMatrixWorld(true);
    const hand = new THREE.Vector3();
    const shoulder = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    this.arms.forEach((arm, i) => {
      this.hands[i].getWorldPosition(hand);
      this.body.worldToLocal(hand);
      shoulder.copy(this.shoulder);
      shoulder.x = VAN.eye.x + arm.userData.side * this.shoulder.x;
      const dir = hand.sub(shoulder);
      const len = dir.length();
      arm.position.copy(shoulder);
      arm.quaternion.setFromUnitVectors(up, dir.normalize());
      arm.scale.set(1, len - 0.04, 1);
    });
  }
}
