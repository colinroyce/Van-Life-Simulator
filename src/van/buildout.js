import * as THREE from 'three';
import { indoor } from './indoor.js';

// Camper build-out in the cargo area: rear platform bed with a garage underneath, galley
// kitchen inside the sliding door, fridge/pantry tower, wet bath (toilet + shower), overhead
// cabinets. Van-local meters; driver side is +X, the sliding door is on -X.

const FLOOR = 0.7;

// Wet bath enclosure on the driver side, between the fridge tower and the driver's seat.
// x0..inner is the aisle wall, thick enough to hide the pocket door.
const BATH = { x0: 0.26, inner: 0.33, x1: 0.94, z0: -0.95, z1: 0.28, wall: 0.03, top: 2.66 };
// Pocket door: closed it fills the doorway (z0..z1); open it slides back into the aisle wall,
// leaving its edge just proud of the opening to grab.
const POCKET_DOOR = { x: 0.295, z0: -0.33, z1: 0.25, travel: 0.56, top: 2.45 };

export const BUILD = {
  // Solid footprints for walking: [xMin, xMax, zMin, zMax]
  blocks: [
    [-1.0, 1.0, -3.1, -1.57], // bed platform
    [-1.0, -0.33, -1.57, -0.35], // galley
    [0.33, 1.0, -1.57, -0.97], // fridge/pantry tower
    [0.47, 1.0, -0.92, -0.5], // toilet
  ],
  // Thin walls for walking: [[x, z], [x, z]] (the bath door is added separately as it swings)
  walls: [
    [[POCKET_DOOR.x, BATH.z0], [POCKET_DOOR.x, POCKET_DOOR.z0]],
    [[BATH.x0, BATH.z1 - 0.015], [1.0, BATH.z1 - 0.015]],
    [[BATH.x0, BATH.z0 + 0.015], [1.0, BATH.z0 + 0.015]],
  ],
  lightSwitch: new THREE.Vector3(BATH.x0, 1.6, -0.72), // outside wall of the bath
  bathDoor: new THREE.Vector3(POCKET_DOOR.x, 0, (POCKET_DOOR.z0 + POCKET_DOOR.z1) / 2),
  showerHead: new THREE.Vector3(0.62, 2.48, -0.06), // rain head hanging from the ceiling
  showerValve: new THREE.Vector3(0.62, 1.55, BATH.z1 - BATH.wall - 0.01), // on the front wall
  toilet: new THREE.Vector3(0.68, 0, -0.7),
  bedFront: new THREE.Vector3(0, 0, -1.57),
  bedStand: new THREE.Vector3(0, 0, -1.3), // where you end up after getting out of bed
  bedHead: new THREE.Vector3(0.62, 1.98, -2.3), // eyes, lying with your head on the pillows
  inBath: (p) => p.x > BATH.inner && p.z > BATH.z0 && p.z < BATH.z1,
};

const mat = (color, opts = {}) =>
  indoor(new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...opts }));

const BIRCH = mat(0xc9a06b);
const BIRCH_FRONT = mat(0xd1aa75);
const BUTCHER = mat(0xa86f3d, { roughness: 0.6 });
const CEDAR = [mat(0xb7794b), mat(0xa8693f), mat(0xc48a5a)];
const OAK_FLOOR = [mat(0x9c7a55), mat(0x8f6f4c)];
const FELT = mat(0x8b857c, { roughness: 1 });
const HARDWARE = mat(0x1b1b1b, { roughness: 0.5 });
const STEEL = mat(0xb8bcc0, { metalness: 0.8, roughness: 0.3 });
const STEEL_DARK = mat(0x7d8287, { metalness: 0.8, roughness: 0.35 });
const GLASS_TOP = mat(0x111214, { roughness: 0.15 });
const FRIDGE = mat(0x2a2c2f, { roughness: 0.4, metalness: 0.3 });
const MATTRESS = mat(0xe9e3d6, { roughness: 1 });
const DUVET = mat(0x4d6650, { roughness: 1 });
const DUVET_FOLD = mat(0x5d7a60, { roughness: 1 });
const PILLOW = mat(0xf3efe6, { roughness: 1 });
const SHOWER_WALL = mat(0xeeeeea, { roughness: 0.35 });
const SHOWER_CHROME = mat(0xcfd3d6, { metalness: 0.3, roughness: 0.35 });
// Down-facing surfaces get almost no light indoors; a faint glow keeps the nozzle plate readable.
const NOZZLES = mat(0xd9dde0, { roughness: 0.4, emissive: 0x6a6e72, emissiveIntensity: 0.5 });
const FROSTED = mat(0xf2f4f5, { roughness: 0.3, transparent: true, opacity: 0.85 });
const PORCELAIN = mat(0xf4f4f1, { roughness: 0.25 });
const TOILET_SEAT = mat(0xd9dad6, { roughness: 0.4 });
const SWITCH = mat(0xf2f0ea);
// Light-emitting surfaces: dim when off, glowing when the lights are on
const PUCK = mat(0xfff3dc, { emissive: 0xffd9a0, emissiveIntensity: 0 });
const LED = mat(0xfff3dc, { emissive: 0xffc27a, emissiveIntensity: 0 });
const WATER = new THREE.LineBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0.6, depthWrite: false });

function slab(x0, x1, y0, y1, z0, z1, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Black bar pull. Along z unless vertical.
function handle(x, y, z, vertical = false) {
  return vertical ? slab(x - 0.008, x + 0.008, y - 0.07, y + 0.07, z - 0.008, z + 0.008, HARDWARE)
    : slab(x - 0.008, x + 0.008, y - 0.008, y + 0.008, z - 0.06, z + 0.06, HARDWARE);
}

function buildGalley() {
  const g = new THREE.Group();
  const [x0, x1, z0, z1] = [-0.93, -0.36, -1.57, -0.35];
  const face = x1; // facing the aisle (+X)
  g.add(slab(x0, x1, FLOOR + 0.08, 1.56, z0, z1, BIRCH));
  g.add(slab(x0, x1 - 0.04, FLOOR, FLOOR + 0.08, z0, z1, HARDWARE)); // toe kick

  // Drawer stack, then two cupboard doors
  for (const [ya, yb] of [[0.8, 1.05], [1.07, 1.3], [1.32, 1.54]]) {
    g.add(slab(face, face + 0.015, ya, yb, -1.55, -1.12, BIRCH_FRONT));
    g.add(handle(face + 0.025, yb - 0.05, -1.335));
  }
  for (const [za, zb] of [[-1.1, -0.73], [-0.71, -0.37]]) {
    g.add(slab(face, face + 0.015, 0.8, 1.54, za, zb, BIRCH_FRONT));
    g.add(handle(face + 0.025, 1.4, za < -1 ? zb - 0.04 : za + 0.04, true));
  }

  // Butcher-block counter
  g.add(slab(-0.95, -0.32, 1.56, 1.6, -1.585, -0.335, BUTCHER));

  // Sink near the door, with a black gooseneck faucet
  g.add(slab(-0.82, -0.46, 1.6, 1.606, -0.83, -0.47, STEEL));
  g.add(slab(-0.8, -0.48, 1.6, 1.608, -0.81, -0.49, STEEL_DARK));
  g.add(slab(-0.9, -0.87, 1.6, 1.9, -0.665, -0.635, HARDWARE));
  g.add(slab(-0.9, -0.7, 1.885, 1.905, -0.66, -0.64, HARDWARE));
  g.add(slab(-0.72, -0.7, 1.82, 1.905, -0.66, -0.64, HARDWARE));

  // Two-burner cooktop
  g.add(slab(-0.84, -0.44, 1.6, 1.612, -1.45, -0.95, GLASS_TOP));
  for (const z of [-1.33, -1.07]) {
    const burner = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.008, 4, 16), STEEL_DARK);
    burner.rotation.x = Math.PI / 2;
    burner.position.set(-0.64, 1.616, z);
    g.add(burner);
    g.add(slab(-0.73, -0.55, 1.614, 1.624, z - 0.006, z + 0.006, HARDWARE)); // grate
    g.add(slab(-0.646, -0.634, 1.614, 1.624, z - 0.09, z + 0.09, HARDWARE));
  }
  return g;
}

function buildTower() {
  const g = new THREE.Group();
  const face = 0.36; // facing the aisle (-X)
  g.add(slab(face, 0.9, FLOOR, 2.3, -1.57, -0.97, BIRCH));
  g.add(slab(face - 0.015, face, 0.78, 1.5, -1.55, -0.99, FRIDGE));
  g.add(slab(face - 0.03, face - 0.015, 1.15, 1.42, -1.04, -1.02, STEEL));
  g.add(slab(face - 0.015, face, 1.53, 2.27, -1.55, -0.99, BIRCH_FRONT));
  g.add(handle(face - 0.025, 1.75, -1.03, true));
  return g;
}

// Birch-clad wet bath: white shower walls inside, cassette toilet at the back, rain shower at the front.
function buildBath() {
  const g = new THREE.Group();
  const { x0, inner, x1, z0, z1, wall, top } = BATH;
  const { z0: doorway, top: doorTop } = POCKET_DOOR;
  const lowTop = 2.3; // above this the van's walls curve inward, so the enclosure narrows

  // Aisle wall: two skins around the door pocket behind the doorway, solid above door height
  g.add(slab(x0, x0 + 0.015, FLOOR, doorTop, z0, doorway, BIRCH));
  g.add(slab(inner - 0.015, inner, FLOOR, doorTop, z0, doorway, BIRCH));
  g.add(slab(x0, inner, doorTop, top, z0, z1 - wall, BIRCH));
  // Front and back walls
  for (const [za, zb] of [[z1 - wall, z1], [z0, z0 + wall]]) {
    g.add(slab(x0, x1, FLOOR, lowTop, za, zb, BIRCH));
    g.add(slab(x0, 0.88, lowTop, top, za, zb, BIRCH));
  }

  // White shower panels: front, back, aisle wall, van wall, above the window, ceiling
  for (const [za, zb] of [[z1 - wall - 0.004, z1 - wall], [z0 + wall, z0 + wall + 0.004]]) {
    g.add(slab(inner, x1 - 0.01, 0.74, lowTop, za, zb, SHOWER_WALL));
    g.add(slab(inner, 0.875, lowTop, 2.64, za, zb, SHOWER_WALL));
  }
  g.add(slab(inner, inner + 0.004, 0.74, doorTop, z0 + wall, doorway, SHOWER_WALL));
  g.add(slab(inner, inner + 0.004, doorTop, top - 0.02, z0 + wall, z1 - wall, SHOWER_WALL));
  g.add(slab(0.925, 0.935, 0.74, 1.45, z0 + wall, z1 - wall, SHOWER_WALL));
  g.add(slab(0.885, 0.895, 2.33, 2.6, z0 + wall, z1 - wall, SHOWER_WALL));
  g.add(slab(inner, 0.88, 2.64, 2.655, z0 + wall, z1 - wall, SHOWER_WALL));
  g.add(slab(0.91, 0.915, 1.45, 2.33, z0 + wall, z1 - wall, FROSTED)); // frosted film over the window

  // Shower pan with a drain
  const head = BUILD.showerHead;
  g.add(slab(inner, x1 - 0.01, FLOOR, 0.74, z0 + wall, z1 - wall, SHOWER_WALL));
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.004, 12), STEEL);
  drain.position.set(head.x, 0.742, head.z);
  g.add(drain);

  // Rain shower head on a short drop pipe from the ceiling; mixer valve on the front wall
  g.add(slab(head.x - 0.012, head.x + 0.012, head.y + 0.02, 2.64, head.z - 0.012, head.z + 0.012, SHOWER_CHROME));
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), SHOWER_CHROME);
  rose.position.set(head.x, head.y + 0.01, head.z);
  const nozzles = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.004, 20), NOZZLES);
  nozzles.position.set(head.x, head.y - 0.002, head.z);
  g.add(rose, nozzles);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), SHOWER_CHROME);
  valve.rotation.x = Math.PI / 2;
  const v = BUILD.showerValve;
  valve.position.copy(v);
  g.add(valve, slab(v.x - 0.006, v.x + 0.006, v.y, v.y + 0.09, v.z - 0.02, v.z - 0.01, SHOWER_CHROME));

  // Cassette toilet against the back wall
  const t = BUILD.toilet;
  g.add(slab(t.x - 0.2, t.x + 0.21, 0.74, 1.12, -0.9, -0.52, PORCELAIN));
  g.add(slab(t.x - 0.18, t.x + 0.14, 1.12, 1.15, -0.88, -0.54, TOILET_SEAT));
  g.add(slab(t.x + 0.14, t.x + 0.22, 1.12, 1.3, -0.88, -0.54, PORCELAIN)); // tank
  g.add(slab(t.x + 0.16, t.x + 0.2, 1.3, 1.31, -0.74, -0.68, TOILET_SEAT)); // flush button

  // Light switch on the outside of the aisle wall
  const s = BUILD.lightSwitch;
  g.add(slab(s.x - 0.008, s.x, s.y - 0.06, s.y + 0.06, s.z - 0.04, s.z + 0.04, SWITCH));
  g.add(slab(s.x - 0.02, s.x - 0.008, s.y - 0.025, s.y + 0.025, s.z - 0.012, s.z + 0.012, SWITCH));
  return g;
}

// Pocket door panel; slides along z inside the aisle wall.
function buildBathDoor() {
  const g = new THREE.Group();
  const { x, z0, z1, top } = POCKET_DOOR;
  g.add(slab(x - 0.01, x + 0.01, FLOOR + 0.02, top - 0.01, z0, z1, BIRCH_FRONT));
  g.add(slab(x + 0.01, x + 0.013, FLOOR + 0.05, top - 0.04, z0 + 0.02, z1 - 0.02, SHOWER_WALL)); // shower side
  // Flush finger pulls on both faces, plus an edge pull to grab when it's tucked away
  g.add(slab(x - 0.013, x - 0.01, 0.95, 1.1, z1 - 0.08, z1 - 0.05, HARDWARE));
  g.add(slab(x + 0.013, x + 0.016, 0.95, 1.1, z1 - 0.08, z1 - 0.05, HARDWARE));
  g.add(slab(x - 0.006, x + 0.006, 0.95, 1.1, z1 - 0.004, z1 + 0.002, HARDWARE));
  return g;
}

function buildBed() {
  const g = new THREE.Group();
  const front = BUILD.bedFront.z;
  // Front of the platform, with a door into the garage between the galley and the tower
  g.add(slab(-0.92, 0.92, FLOOR, 1.62, front - 0.03, front, BIRCH));
  g.add(slab(-0.3, 0.3, 0.8, 1.52, front, front + 0.015, BIRCH_FRONT));
  g.add(handle(0.24, 1.2, front + 0.025, true));
  g.add(slab(-0.92, 0.92, 1.58, 1.62, -3.02, front, BIRCH)); // platform
  g.add(slab(-0.92, 0.92, 1.62, 1.7, front - 0.03, front, BIRCH)); // lip that keeps the mattress in

  g.add(slab(-0.91, 0.91, 1.62, 1.78, -3.0, front - 0.03, MATTRESS));
  g.add(slab(-0.91, 0.45, 1.78, 1.81, -3.0, front - 0.01, DUVET));
  g.add(slab(0.35, 0.45, 1.78, 1.83, -3.0, front - 0.01, DUVET_FOLD));
  for (const [za, zb] of [[-2.95, -2.35], [-2.25, -1.65]]) g.add(slab(0.55, 0.88, 1.78, 1.88, za, zb, PILLOW));
  return g;
}

// Cabinets along the top of a wall, with an LED strip under the front edge.
function buildUpperCabinets(side, z0, z1) {
  const g = new THREE.Group();
  const inner = 0.55;
  const outer = 0.88;
  const xs = (a, b) => (side > 0 ? [a, b] : [-b, -a]);
  g.add(slab(...xs(inner, outer), 2.34, 2.62, z0, z1, BIRCH));
  const doors = Math.round((z1 - z0) / 0.55);
  const w = (z1 - z0) / doors;
  for (let i = 0; i < doors; i++) {
    const za = z0 + i * w + 0.01;
    const zb = za + w - 0.02;
    g.add(slab(...xs(inner - 0.015, inner), 2.35, 2.61, za, zb, BIRCH_FRONT));
    g.add(handle(side * (inner - 0.025), 2.39, (za + zb) / 2));
  }
  g.add(slab(...xs(inner + 0.01, inner + 0.03), 2.333, 2.34, z0, z1, LED));
  return g;
}

function buildShell() {
  const g = new THREE.Group();
  // Cedar plank ceiling
  for (let i = 0; i < 12; i++) {
    const x = -0.78 + i * 0.13;
    g.add(slab(x, x + 0.125, 2.66, 2.685, -3.0, 0.42, CEDAR[i % 3]));
  }
  // Oak plank floor
  for (let i = 0; i < 10; i++) {
    const x = -0.93 + i * 0.186;
    g.add(slab(x, x + 0.184, FLOOR, FLOOR + 0.015, -3.02, 0.35, OAK_FLOOR[i % 2]));
  }
  // Felt wall panels, leaving the windows and the sliding door clear
  g.add(slab(0.94, 0.96, FLOOR, 1.45, -3.0, 0.3, FELT));
  g.add(slab(0.91, 0.93, 1.45, 2.34, -3.0, -0.92, FELT));
  g.add(slab(-0.96, -0.94, FLOOR, 1.45, -3.0, -1.0, FELT));
  g.add(slab(-0.93, -0.91, 1.45, 2.34, -3.0, -1.0, FELT));
  return g;
}

const WATER_DROPS = 180;

export class Buildout {
  constructor() {
    this.group = new THREE.Group();
    this.group.add(
      buildShell(),
      buildGalley(),
      buildTower(),
      buildBath(),
      buildBed(),
      buildUpperCabinets(1, -3.0, -0.97),
      buildUpperCabinets(-1, -3.0, -0.35),
    );

    // Recessed puck lights: three warm ones down the aisle, a neutral one in the bath
    this.lights = [];
    const aisle = 0xffdcaa;
    for (const [x, y, z, color] of [[0, 2.655, -2.3, aisle], [0, 2.655, -1.2, aisle], [0, 2.655, -0.1, aisle], [0.62, 2.635, -0.5, 0xfff2e2]]) {
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 12), PUCK);
      puck.position.set(x, y, z);
      const light = new THREE.PointLight(color, 0, 3.5, 1.5);
      light.position.set(x, 2.5, z);
      this.group.add(puck, light);
      this.lights.push(light);
    }

    this.bathDoor = buildBathDoor();
    this.group.add(this.bathDoor);
    this.bathDoorOpen = false;
    this.bathDoorT = 0;

    // Shower water: drops falling from the head, recycled when they reach the pan.
    // Each drop is drawn as a short streak along its velocity.
    this.drops = new Float32Array(WATER_DROPS * 3);
    this.dropVel = new Float32Array(WATER_DROPS * 3);
    this.streaks = new Float32Array(WATER_DROPS * 6);
    for (let i = 0; i < WATER_DROPS; i++) this.#spawnDrop(i, Math.random());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.streaks, 3));
    this.water = new THREE.LineSegments(geo, WATER);
    this.water.frustumCulled = false;
    this.water.visible = false;
    this.group.add(this.water);
    this.showerOn = false;
  }

  setLights(on) {
    for (const l of this.lights) l.intensity = on ? 1.6 : 0;
    PUCK.emissiveIntensity = on ? 1.4 : 0;
    LED.emissiveIntensity = on ? 1.6 : 0;
  }

  setShower(on) {
    this.showerOn = on;
    this.water.visible = on;
  }

  setBathDoorOpen(open) {
    this.bathDoorOpen = open;
  }

  // Current bath door panel as a wall segment (van-local x/z), for walking collisions.
  bathDoorSegment() {
    const { x, z0, z1 } = POCKET_DOOR;
    const dz = this.bathDoor.position.z;
    return [[x, z0 + dz], [x, z1 + dz]];
  }

  update(dt) {
    this.bathDoorT = THREE.MathUtils.clamp(this.bathDoorT + (this.bathDoorOpen ? 1 : -1) * dt * 2.2, 0, 1);
    const t = this.bathDoorT;
    this.bathDoor.position.z = -POCKET_DOOR.travel * t * t * (3 - 2 * t);

    if (!this.showerOn) return;
    for (let i = 0; i < WATER_DROPS; i++) {
      const k = i * 3;
      this.dropVel[k + 1] -= 9.8 * dt;
      for (let c = 0; c < 3; c++) this.drops[k + c] += this.dropVel[k + c] * dt;
      if (this.drops[k + 1] < 0.75) this.#spawnDrop(i, 0);
      for (let c = 0; c < 3; c++) {
        this.streaks[i * 6 + c] = this.drops[k + c];
        this.streaks[i * 6 + 3 + c] = this.drops[k + c] - this.dropVel[k + c] * 0.012;
      }
    }
    this.water.geometry.attributes.position.needsUpdate = true;
  }

  // Starts a drop at the shower head; `progress` pre-advances it so the stream starts full.
  #spawnDrop(i, progress) {
    const head = BUILD.showerHead;
    const k = i * 3;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.09; // anywhere across the rain head
    this.dropVel[k] = Math.cos(a) * 0.12;
    this.dropVel[k + 1] = -1.5;
    this.dropVel[k + 2] = Math.sin(a) * 0.12;
    const fall = progress * 0.5;
    this.drops[k] = head.x + Math.cos(a) * r + this.dropVel[k] * fall;
    this.drops[k + 1] = head.y - 1.5 * fall - 4.9 * fall * fall;
    this.drops[k + 2] = head.z + Math.sin(a) * r + this.dropVel[k + 2] * fall;
    this.dropVel[k + 1] -= 9.8 * fall;
  }
}
