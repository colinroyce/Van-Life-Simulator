import * as THREE from 'three';

// 1 L wide-mouth "Nalgene" style bottle: translucent blue body, black cap with a tether loop.
// The water inside is a separate cylinder scaled to the fill level, visible through the plastic.
// Origin is the center of the base.

export const BOTTLE = { radius: 0.045, height: 0.245 };

const BODY_H = 0.18;
const INNER_H = 0.172; // usable water column

const SHELL = new THREE.MeshStandardMaterial({
  color: 0x2a6bd8, roughness: 0.25, transparent: true, opacity: 0.45, depthWrite: false,
});
const WATER = new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.1, transparent: true, opacity: 0.85 });
const CAP = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6, flatShading: true });
const GHOST = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });

function cylinder(rTop, rBottom, h, segments, material, y) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  m.position.y = y;
  return m;
}

export function createBottle() {
  const group = new THREE.Group();
  const r = BOTTLE.radius;

  const water = cylinder(r - 0.004, r - 0.004, 1, 16, WATER, 0);
  water.geometry.translate(0, 0.5, 0);
  water.position.y = 0.005;
  water.renderOrder = 1;

  const body = cylinder(r, r, BODY_H, 18, SHELL, BODY_H / 2);
  const shoulder = cylinder(r - 0.006, r, 0.02, 18, SHELL, BODY_H + 0.01);
  for (const m of [body, shoulder]) {
    m.renderOrder = 2;
    m.castShadow = true;
  }
  const cap = cylinder(r - 0.004, r - 0.004, 0.035, 14, CAP, BODY_H + 0.035);
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.004, 4, 10), CAP);
  loop.position.y = BODY_H + 0.065;
  cap.castShadow = true;
  group.add(water, body, shoulder, cap, loop);

  return {
    group,
    setLevel(level) {
      water.visible = level > 0.005;
      water.scale.y = Math.max(level, 0.001) * INNER_H;
    },
  };
}

// Translucent white silhouette used to preview where a bottle will be set down.
export function createBottleGhost() {
  const group = new THREE.Group();
  const r = BOTTLE.radius;
  group.add(cylinder(r, r, BODY_H + 0.02, 14, GHOST, (BODY_H + 0.02) / 2));
  group.add(cylinder(r - 0.004, r - 0.004, 0.035, 12, GHOST, BODY_H + 0.035));
  group.traverse((o) => (o.userData.noAim = true));
  return group;
}

// Little hotbar icon: a bottle outline filled to the current level.
export function bottleIcon(level) {
  const h = 26;
  const fill = Math.round(h * level);
  return `<svg width="22" height="38" viewBox="0 0 22 38">
    <rect x="5" y="1" width="12" height="6" rx="1.5" fill="#151618"/>
    <rect x="2.5" y="8" width="17" height="${h + 3}" rx="3" fill="rgba(42,107,216,0.45)" stroke="#5f9cf0" stroke-width="1.2"/>
    <rect x="4" y="${9.5 + h - fill}" width="14" height="${fill}" rx="2" fill="#a8dcff"/>
  </svg>`;
}
