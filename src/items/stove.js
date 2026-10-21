import * as THREE from 'three';
import { SAUSAGE } from './food.js';
import { indoor } from '../van/indoor.js';

// Skillet on the van's front burner. Hot dogs go in raw, brown over COOK_TIME seconds and start
// to char (and smoke) if left on. The burner lights itself whenever there's food in the pan.

export const COOK_TIME = 20; // seconds from raw to perfectly cooked
const DONE = 0.7; // doneness at which a hot dog counts as cooked
const BURNT = 1.3; // ...and as burnt
const CAPACITY = 4;

const PAN = indoor(new THREE.MeshStandardMaterial({
  color: 0x2a2b2e, roughness: 0.5, metalness: 0.4, flatShading: true, side: THREE.DoubleSide,
}));
const FLAME = new THREE.MeshBasicMaterial({ color: 0x4f8dff, transparent: true, opacity: 0.85 });
// Soft round puff for the smoke particles
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const SMOKE = new THREE.PointsMaterial({
  color: 0x8a8a8a, size: 0.12, map: puffTexture(), transparent: true, opacity: 0.4, depthWrite: false,
});

const RAW = new THREE.Color(SAUSAGE.raw);
const COOKED = new THREE.Color(SAUSAGE.cooked);
const CHARRED = new THREE.Color(SAUSAGE.burnt);

export const quality = (doneness) => (doneness >= BURNT ? 'burnt' : 'cooked');

export class Stove {
  constructor(parent, burner) {
    this.dogs = []; // doneness of each hot dog in the pan
    this.group = new THREE.Group();
    this.group.position.copy(burner);
    this.group.userData.fixture = 'stove';
    parent.add(this.group);

    // Skillet with its handle pointing into the aisle
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.095, 0.035, 18, 1, true), PAN);
    pan.position.y = 0.022;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.006, 18), PAN);
    bottom.position.y = 0.007;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.022), PAN);
    handle.position.set(0.18, 0.035, 0);
    handle.rotation.z = 0.12;
    this.group.add(pan, bottom, handle);

    this.flame = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 4, 16), FLAME);
    this.flame.rotation.x = Math.PI / 2;
    this.flame.position.y = 0.002;
    this.group.add(this.flame);

    this.sausageMats = [];
    this.sausages = [];
    const geo = new THREE.CapsuleGeometry(0.011, 0.11, 3, 8);
    geo.rotateZ(Math.PI / 2);
    for (let i = 0; i < CAPACITY; i++) {
      const m = new THREE.MeshStandardMaterial({ color: RAW, roughness: 0.5, flatShading: true });
      const s = new THREE.Mesh(geo, m);
      s.position.set(0, 0.022, -0.045 + i * 0.03);
      s.visible = false;
      this.group.add(s);
      this.sausages.push(s);
      this.sausageMats.push(m);
    }

    // Smoke puffs rising off burning food
    this.smokeParts = Array.from({ length: 24 }, () => ({ t: Math.random() }));
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.smoke = new THREE.Points(smokeGeo, SMOKE);
    this.smoke.frustumCulled = false;
    this.smoke.userData.noAim = true;
    this.group.add(this.smoke);
    this.#show();
  }

  get full() {
    return this.dogs.length >= CAPACITY;
  }

  get cooking() {
    return this.dogs.length > 0;
  }

  // How hard the pan is sizzling (0..1), and whether something is burning, for sound.
  get sizzle() {
    return this.cooking ? Math.min(1, 0.5 + this.dogs.length * 0.15) : 0;
  }

  get burning() {
    return this.dogs.some((d) => d >= BURNT);
  }

  get ready() {
    return this.dogs.filter((d) => d >= DONE);
  }

  // e.g. "Cooking… 45%" for the least-done hot dog
  get status() {
    const least = Math.min(...this.dogs);
    return `Cooking… ${Math.round(Math.min(least, 1) * 100)}%`;
  }

  add() {
    if (this.full) return false;
    this.dogs.push(0);
    this.#show();
    return true;
  }

  // Removes and returns the doneness of every hot dog that's cooked (or burnt).
  takeReady() {
    const taken = this.ready;
    this.dogs = this.dogs.filter((d) => d < DONE);
    this.#show();
    return taken;
  }

  update(dt) {
    for (let i = 0; i < this.dogs.length; i++) this.dogs[i] += dt / COOK_TIME;
    this.#show();

    const pos = this.smoke.geometry.attributes.position;
    this.smoke.visible = this.burning;
    if (!this.smoke.visible) return;
    this.smokeParts.forEach((p, i) => {
      p.t = (p.t + dt * 0.35) % 1;
      const a = i * 2.4;
      pos.setXYZ(i, Math.sin(a) * 0.04 * (1 + p.t * 2), 0.03 + p.t * 0.6, Math.cos(a) * 0.04 * (1 + p.t * 2));
    });
    pos.needsUpdate = true;
  }

  #show() {
    this.flame.visible = this.cooking;
    this.sausages.forEach((s, i) => {
      const d = this.dogs[i];
      s.visible = d !== undefined;
      if (d === undefined) return;
      const c = this.sausageMats[i].color;
      if (d <= 1) c.copy(RAW).lerp(COOKED, d);
      else c.copy(COOKED).lerp(CHARRED, Math.min((d - 1) / (BURNT + 0.3 - 1), 1));
      s.rotation.x = d * 3; // rolled now and then
    });
  }
}
