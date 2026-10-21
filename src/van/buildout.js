import * as THREE from 'three';

// Camper build-out in the cargo area: rear platform bed with a garage underneath,
// galley kitchen inside the sliding door, fridge/pantry tower, bench, overhead cabinets.
// Van-local meters; driver side is +X, the sliding door is on -X.

const FLOOR = 0.7;

export const BUILD = {
  // Solid footprints for walking: [xMin, xMax, zMin, zMax]
  blocks: [
    [-1.0, 1.0, -3.1, -1.57], // bed platform
    [-1.0, -0.33, -1.57, -0.35], // galley
    [0.33, 1.0, -1.57, -0.97], // fridge/pantry tower
    [0.45, 1.0, -0.9, 0.0], // bench
  ],
  lightSwitch: new THREE.Vector3(0.62, 1.7, -0.97), // front of the tower, above the bench
  bedFront: new THREE.Vector3(0, 0, -1.57),
  bedStand: new THREE.Vector3(0, 0, -1.3), // where you end up after getting out of bed
  bedHead: new THREE.Vector3(0.62, 1.98, -2.3), // eyes, lying with your head on the pillows
};

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...opts });

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
const CUSHION = mat(0x3c3f44, { roughness: 1 });
const SWITCH = mat(0xf2f0ea);
// Light-emitting surfaces: dim when off, glowing when the lights are on
const PUCK = mat(0xfff3dc, { emissive: 0xffd9a0, emissiveIntensity: 0 });
const LED = mat(0xfff3dc, { emissive: 0xffc27a, emissiveIntensity: 0 });

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

  // Light switch on the tower's front face
  const s = BUILD.lightSwitch;
  g.add(slab(s.x - 0.04, s.x + 0.04, s.y - 0.06, s.y + 0.06, s.z, s.z + 0.008, SWITCH));
  g.add(slab(s.x - 0.012, s.x + 0.012, s.y - 0.025, s.y + 0.025, s.z + 0.008, s.z + 0.02, SWITCH));
  return g;
}

function buildBench() {
  const g = new THREE.Group();
  const face = 0.45;
  g.add(slab(face, 0.92, FLOOR, 1.1, -0.9, 0.0, BIRCH));
  for (const [za, zb] of [[-0.88, -0.46], [-0.44, -0.02]]) {
    g.add(slab(face - 0.015, face, 0.76, 1.06, za, zb, BIRCH_FRONT));
    g.add(handle(face - 0.025, 1.0, (za + zb) / 2));
  }
  g.add(slab(0.46, 0.92, 1.1, 1.2, -0.88, -0.02, CUSHION));
  g.add(slab(0.86, 0.94, 1.2, 1.45, -0.88, -0.02, CUSHION)); // back cushion against the wall
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

export function buildBuildout() {
  const group = new THREE.Group();
  group.add(
    buildShell(),
    buildGalley(),
    buildTower(),
    buildBench(),
    buildBed(),
    buildUpperCabinets(1, -3.0, 0.2),
    buildUpperCabinets(-1, -3.0, -0.35),
  );

  // Recessed puck lights in the ceiling
  const lights = [];
  for (const z of [-2.3, -1.2, -0.1]) {
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 12), PUCK);
    puck.position.set(0, 2.655, z);
    const light = new THREE.PointLight(0xffcf8a, 0, 3.5, 1.5);
    light.position.set(0, 2.5, z);
    group.add(puck, light);
    lights.push(light);
  }

  return {
    group,
    setLights(on) {
      for (const l of lights) l.intensity = on ? 1.6 : 0;
      PUCK.emissiveIntensity = on ? 1.4 : 0;
      LED.emissiveIntensity = on ? 1.6 : 0;
    },
  };
}
