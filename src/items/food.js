import * as THREE from 'three';

// Low-poly food props and their hotbar icons. Every mesh has its origin at the center of its
// base so it can sit on surfaces, and a refresh(item) that redraws it for the current count.

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...opts });

export const SAUSAGE = { raw: 0xe08d7f, cooked: 0x9c4a2b, burnt: 0x2b1d18 };
const SAUSAGE_MATS = Object.fromEntries(Object.entries(SAUSAGE).map(([k, c]) => [k, mat(c, { roughness: 0.5 })]));
const TRAY = mat(0xc0392b);
const LABEL = mat(0xf1c40f);
const BAG = mat(0xf4f1ea, { transparent: true, opacity: 0.35, depthWrite: false });
const BAG_LABEL = mat(0x2e6fbf);
const BUN = mat(0xd9a35a);
const MUSTARD = mat(0xf2c500);

const SAUSAGE_GEO = new THREE.CapsuleGeometry(0.011, 0.11, 3, 8);
SAUSAGE_GEO.rotateZ(Math.PI / 2); // lie along x

function sausage(quality) {
  const m = new THREE.Mesh(SAUSAGE_GEO, SAUSAGE_MATS[quality]);
  m.castShadow = true;
  return m;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Tray of 6 raw hot dogs under a yellow label band.
export function createPack() {
  const group = new THREE.Group();
  group.add(box(0.15, 0.022, 0.1, TRAY, 0, 0.011, 0));
  group.add(box(0.152, 0.004, 0.035, LABEL, 0, 0.024, 0.03));
  const dogs = [];
  for (let i = 0; i < 6; i++) {
    const s = sausage('raw');
    s.position.set(0, 0.03, -0.04 + i * 0.0155);
    s.scale.set(0.95, 1, 1);
    group.add(s);
    dogs.push(s);
  }
  return { group, refresh: (item) => dogs.forEach((d, i) => (d.visible = i < item.count)) };
}

// Bag of 8 buns: two rows of four, visible through the plastic.
export function createBuns() {
  const group = new THREE.Group();
  const buns = [];
  for (let i = 0; i < 8; i++) {
    const b = box(0.12, 0.04, 0.042, BUN, i < 4 ? -0.064 : 0.064, 0.022, -0.066 + (i % 4) * 0.044);
    group.add(b);
    buns.push(b);
  }
  const bag = box(0.27, 0.05, 0.19, BAG, 0, 0.025, 0);
  bag.castShadow = false;
  bag.renderOrder = 2;
  group.add(bag, box(0.06, 0.052, 0.192, BAG_LABEL, 0, 0.025, 0));
  return { group, refresh: (item) => buns.forEach((b, i) => (b.visible = i < item.count)) };
}

// Loose cooked (or burnt) hot dogs, up to four shown side by side.
export function createHotdogs(item) {
  const group = new THREE.Group();
  const dogs = [];
  for (let i = 0; i < 4; i++) {
    const s = sausage(item.quality);
    s.position.set(0, 0.011, -0.036 + i * 0.024);
    group.add(s);
    dogs.push(s);
  }
  return { group, refresh: (it) => dogs.forEach((d, i) => (d.visible = i < it.count)) };
}

// Hot dog in a bun with a squiggle of mustard; up to three side by side.
export function createHotdogInBun(item) {
  const group = new THREE.Group();
  const meals = [];
  for (let i = 0; i < 3; i++) {
    const meal = new THREE.Group();
    meal.position.z = -0.05 + i * 0.05;
    meal.add(box(0.13, 0.03, 0.016, BUN, 0, 0.015, -0.014), box(0.13, 0.03, 0.016, BUN, 0, 0.015, 0.014));
    meal.add(box(0.13, 0.012, 0.03, BUN, 0, 0.006, 0)); // bottom of the bun
    const s = sausage(item.quality);
    s.position.y = 0.026;
    s.scale.set(1.05, 1, 1);
    meal.add(s, box(0.1, 0.004, 0.006, MUSTARD, 0, 0.039, 0));
    group.add(meal);
    meals.push(meal);
  }
  return { group, refresh: (it) => meals.forEach((m, i) => (m.visible = i < it.count)) };
}

// --- hotbar icons (38x38 SVG) ---
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const sausageSvg = (y, color, x0 = 8, x1 = 30) =>
  `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;

export const ICONS = {
  hotdogs: () => `<svg width="38" height="38" viewBox="0 0 38 38">
    <rect x="4" y="11" width="30" height="18" rx="3" fill="#c0392b"/>
    ${sausageSvg(16, '#e08d7f')}${sausageSvg(21, '#e08d7f')}
    <rect x="4" y="24" width="30" height="5" rx="1" fill="#f1c40f"/></svg>`,
  buns: () => `<svg width="38" height="38" viewBox="0 0 38 38">
    <rect x="4" y="12" width="30" height="16" rx="4" fill="rgba(244,241,234,0.5)" stroke="#ddd" stroke-width="1"/>
    <rect x="7" y="15" width="11" height="10" rx="3" fill="#d9a35a"/><rect x="20" y="15" width="11" height="10" rx="3" fill="#d9a35a"/>
    <rect x="16" y="12" width="6" height="16" fill="#2e6fbf"/></svg>`,
  hotdog: (item) => `<svg width="38" height="38" viewBox="0 0 38 38">
    ${sausageSvg(16, hex(SAUSAGE[item.quality]), 7, 31)}${sausageSvg(23, hex(SAUSAGE[item.quality]), 7, 31)}</svg>`,
  hotdogInBun: (item) => `<svg width="38" height="38" viewBox="0 0 38 38">
    <rect x="5" y="15" width="28" height="11" rx="5" fill="#d9a35a"/>
    ${sausageSvg(17, hex(SAUSAGE[item.quality]), 6, 32)}
    <polyline points="9,16 13,14 17,17 21,14 25,17 29,15" fill="none" stroke="#f2c500" stroke-width="1.6"/></svg>`,
};
