import * as THREE from 'three';
import { indoor } from '../van/indoor.js';
import { createPack, createBuns } from '../items/food.js';

// "GAS & GO" convenience store. Built in its own local frame (front faces +Z, centered on the
// origin) and dropped into the world with place(). Inside: glass-door coolers along the back
// wall (hot dogs), a shelf of buns along the left wall, a snack aisle and a register with a clerk.
// Sliding front doors open as you walk up, unless you're trying to leave without paying.

const W = 12; // width (x)
const D = 9; // depth (z)
const H = 3.4; // wall height
const T = 0.2; // wall thickness
const DOOR = { half: 0.8, height: 2.5 };
const WINDOW = { bottom: 0.6, top: 2.8 };

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...opts });
const inside = (color, opts) => indoor(mat(color, opts), 0.35);

const STUCCO = mat(0xd9cbb0);
const TRIM = mat(0xc0392b);
const GLASS = mat(0x9fc6d8, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
const FRAME = mat(0x2b2d31, { roughness: 0.5 });
const WALL_IN = inside(0xf1efe9);
const FLOOR = inside(0xd8d8d2, { roughness: 0.5 });
const CEILING = inside(0xf4f4f2);
const PANEL_LIGHT = mat(0xffffff, { emissive: 0xfafcff, emissiveIntensity: 1.2 });
const COOLER = inside(0x2f3237, { roughness: 0.5 });
const COOLER_IN = mat(0xe9eef2, { emissive: 0xdfe9f5, emissiveIntensity: 0.45 });
const SHELF = inside(0x8d939a, { roughness: 0.6 });
const COUNTER = inside(0x6b4a33);
const COUNTER_TOP = inside(0x2b2d31, { roughness: 0.4 });
const SKIN = inside(0xc98f6b);
const SHIRT = inside(0xc0392b);
const PRODUCT_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xe67e22, 0x1abc9c];
const PRODUCTS = PRODUCT_COLORS.map((c) => inside(c, { roughness: 0.5 }));

function slab(x0, x1, y0, y1, z0, z1, material, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#fbf8f1';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#c0392b';
  g.font = 'bold 104px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GAS & GO  MARKET', c.width / 2, c.height / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ConvenienceStore {
  constructor() {
    this.group = new THREE.Group();
    this.localWalls = []; // [[x, z], [x, z]] in store space
    this.shopItems = []; // product props you can take: { kind, price, mesh, fixture }
    this.coolerDoors = [];
    this.#buildShell();
    this.#buildCoolers();
    this.#buildShelves();
    this.#buildCounter();
    this.doorT = 0;
    this.blockedNotice = 0;
  }

  // Puts the store in the world: position (x, z) and which way the front faces.
  place(scene, x, z, rotationY) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rotationY;
    this.group.updateMatrixWorld(true);
    scene.add(this.group);
  }

  toWorld([x, z]) {
    const v = this.group.localToWorld(new THREE.Vector3(x, 0, z));
    return [v.x, v.z];
  }

  toLocal(world) {
    return this.group.worldToLocal(world.clone().setY(0));
  }

  contains(world, margin = 0) {
    const p = this.toLocal(world);
    return Math.abs(p.x) < W / 2 + margin && Math.abs(p.z) < D / 2 + margin;
  }

  // Walls for walking, in world space. The doorway is open only while the doors are.
  walls() {
    const segs = [...this.localWalls];
    if (this.doorT < 0.8) segs.push([[-DOOR.half, D / 2 - T / 2], [DOOR.half, D / 2 - T / 2]]);
    return segs.map(([a, b]) => [this.toWorld(a), this.toWorld(b)]);
  }

  // Circles along the outside walls so the van can't drive through the building.
  vanObstacles() {
    const out = [];
    for (let s = -W / 2; s <= W / 2; s += 1) {
      // Leave the doorway clear for walking; the gap is still far too narrow for the van
      if (Math.abs(s) > DOOR.half) out.push(this.toWorld([s, D / 2]));
      out.push(this.toWorld([s, -D / 2]));
    }
    for (let s = -D / 2; s <= D / 2; s += 1) {
      out.push(this.toWorld([W / 2, s]), this.toWorld([-W / 2, s]));
    }
    return out.map(([x, z]) => ({ x, z, r: 0.5 }));
  }

  // Doors slide open when you walk up, except on your way out with unpaid items.
  update(dt, playerPos, hasUnpaid, notify) {
    const p = this.toLocal(playerPos);
    const near = Math.abs(p.x) < 2 && Math.abs(p.z - D / 2) < 2.4;
    const leavingUnpaid = hasUnpaid && p.z < D / 2;
    if (near && leavingUnpaid && p.z > D / 2 - 1.6) {
      this.blockedNotice -= dt;
      if (this.blockedNotice <= 0) {
        notify('Pay for your items first');
        this.blockedNotice = 2.5;
      }
    }
    const open = near && !leavingUnpaid;
    this.doorT = THREE.MathUtils.clamp(this.doorT + (open ? 1 : -1) * dt * 2.5, 0, 1);
    const slide = DOOR.half * this.doorT;
    this.doorLeft.position.x = -DOOR.half / 2 - slide;
    this.doorRight.position.x = DOOR.half / 2 + slide;

    // Cooler doors swing open while you stand in front of them
    for (const c of this.coolerDoors) {
      const want = Math.abs(p.x - c.x) < 0.7 && p.z < -D / 2 + 2.2 ? 1 : 0;
      c.t = THREE.MathUtils.clamp(c.t + (want ? 1 : -1) * dt * 3, 0, 1);
      c.pivot.rotation.y = -1.4 * c.t;
    }
  }

  // Shelf items you've taken out of the store come back when you put them back.
  take(shopItem) {
    shopItem.mesh.visible = false;
  }

  putBack(kind) {
    const spot = this.shopItems.find((s) => s.kind === kind && !s.mesh.visible);
    if (spot) spot.mesh.visible = true;
    return !!spot;
  }

  // ---------------------------------------------------------------------------
  #wall(x0, x1, z0, z1) {
    slab(x0, x1, 0, H, z0, z1, STUCCO, this.group);
  }

  #buildShell() {
    const g = this.group;
    const hw = W / 2;
    const hd = D / 2;
    slab(-hw, hw, -0.02, 0.012, -hd, hd, FLOOR, g);

    // Back and side walls, with white inner lining
    this.#wall(-hw, hw, -hd, -hd + T);
    this.#wall(-hw, -hw + T, -hd, hd);
    this.#wall(hw - T, hw, -hd, hd);
    slab(-hw + T, hw - T, 0, H, -hd + T, -hd + T + 0.01, WALL_IN, g);
    slab(-hw + T, -hw + T + 0.01, 0, H, -hd + T, hd - T, WALL_IN, g);
    slab(hw - T - 0.01, hw - T, 0, H, -hd + T, hd - T, WALL_IN, g);

    // Front: low wall under big windows, a sign band above, doorway in the middle
    const fz0 = hd - T;
    for (const [x0, x1] of [[-hw, -DOOR.half], [DOOR.half, hw]]) {
      slab(x0, x1, 0, WINDOW.bottom, fz0, hd, STUCCO, g);
      slab(x0, x1, WINDOW.top, H, fz0, hd, STUCCO, g);
      const glass = slab(x0, x1, WINDOW.bottom, WINDOW.top, hd - T / 2 - 0.01, hd - T / 2 + 0.01, GLASS, g);
      glass.castShadow = false;
      glass.userData.noAim = true;
      for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 4) {
        slab(x - 0.04, x + 0.04, WINDOW.bottom, WINDOW.top, hd - T, hd, FRAME, g);
      }
    }
    slab(-DOOR.half, DOOR.half, DOOR.height, H, fz0, hd, STUCCO, g);
    slab(-DOOR.half - 0.05, -DOOR.half, 0, DOOR.height, fz0, hd, FRAME, g);
    slab(DOOR.half, DOOR.half + 0.05, 0, DOOR.height, fz0, hd, FRAME, g);

    // Sliding glass doors
    const door = () => {
      const d = new THREE.Group();
      const pane = slab(-DOOR.half / 2, DOOR.half / 2, 0.02, DOOR.height - 0.02, -0.01, 0.01, GLASS, d);
      pane.userData.noAim = true;
      pane.castShadow = false;
      slab(-DOOR.half / 2, DOOR.half / 2, 0.02, 0.1, -0.02, 0.02, FRAME, d);
      slab(-DOOR.half / 2, DOOR.half / 2, DOOR.height - 0.1, DOOR.height - 0.02, -0.02, 0.02, FRAME, d);
      d.position.z = hd - T - 0.05;
      g.add(d);
      return d;
    };
    this.doorLeft = door();
    this.doorRight = door();

    // Roof with a red parapet band, ceiling with light panels
    slab(-hw - 0.3, hw + 0.3, H, H + 0.25, -hd - 0.3, hd + 0.3, STUCCO, g);
    slab(-hw - 0.3, hw + 0.3, H + 0.25, H + 0.5, hd + 0.2, hd + 0.3, TRIM, g);
    slab(-hw - 0.3, hw + 0.3, H + 0.25, H + 0.5, -hd - 0.3, -hd - 0.2, TRIM, g);
    slab(-hw - 0.3, -hw - 0.2, H + 0.25, H + 0.5, -hd - 0.3, hd + 0.3, TRIM, g);
    slab(hw + 0.2, hw + 0.3, H + 0.25, H + 0.5, -hd - 0.3, hd + 0.3, TRIM, g);
    slab(-hw + T, hw - T, H - 0.06, H - 0.04, -hd + T, hd - T, CEILING, g);
    for (const x of [-3, 3]) {
      for (const z of [-2.2, 1.8]) slab(x - 0.6, x + 0.6, H - 0.07, H - 0.06, z - 0.3, z + 0.3, PANEL_LIGHT, g);
      const light = new THREE.PointLight(0xf4f8ff, 9, 11, 1.4);
      light.position.set(x, H - 0.3, -0.2);
      g.add(light);
    }

    // Sign on the band above the windows
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.9), new THREE.MeshBasicMaterial({ map: signTexture() }));
    sign.position.set(0, (WINDOW.top + H) / 2 + 0.05, hd + 0.01);
    g.add(sign);

    // Walls for walking (store space): back, sides, front either side of the doorway
    const wz = hd - T / 2;
    this.localWalls.push(
      [[-hw, -hd + T / 2], [hw, -hd + T / 2]],
      [[-hw + T / 2, -hd], [-hw + T / 2, hd]],
      [[hw - T / 2, -hd], [hw - T / 2, hd]],
      [[-hw, wz], [-DOOR.half, wz]],
      [[DOOR.half, wz], [hw, wz]],
    );
  }

  // Three glass-door coolers on the back wall; hot dogs in the middle one.
  #buildCoolers() {
    const g = this.group;
    const back = -D / 2 + T;
    const front = back + 0.7;
    const unit = 0.9;
    const x0 = -1.5 * unit;
    const x1 = -x0;
    // Cabinet frame: base, top, back and the uprights between the doors
    slab(x0 - 0.05, x1 + 0.05, 0, 0.12, back, front, COOLER, g);
    slab(x0 - 0.05, x1 + 0.05, 2.05, 2.15, back, front, COOLER, g);
    slab(x0 - 0.05, x1 + 0.05, 0.12, 2.05, back, back + 0.04, COOLER, g);
    for (let k = 0; k <= 3; k++) {
      const x = x0 + unit * k;
      slab(x - 0.03, x + 0.03, 0.12, 2.05, back, front, COOLER, g);
    }
    for (let u = 0; u < 3; u++) {
      const cx = x0 + unit * (u + 0.5);
      // Lit back panel
      slab(cx - unit / 2 + 0.03, cx + unit / 2 - 0.03, 0.12, 2.05, back + 0.04, back + 0.05, COOLER_IN, g);
      for (const y of [0.5, 0.95, 1.4]) {
        const shelf = slab(cx - unit / 2 + 0.05, cx + unit / 2 - 0.05, y - 0.012, y, back + 0.05, front - 0.02, SHELF, g);
        shelf.userData.fixture = u === 1 ? 'hotdogCooler' : 'cooler';
        if (u === 1 && y === 0.95) {
          for (let i = 0; i < 4; i++) {
            const pack = createPack();
            pack.refresh({ count: 6 });
            pack.group.position.set(cx - 0.3 + i * 0.2, y, front - 0.2);
            pack.group.rotation.y = Math.PI / 2;
            g.add(pack.group);
            this.#shopItem('hotdogs', 6, pack.group, 'hotdogCooler');
          }
        } else {
          // Drinks for decoration
          for (let i = 0; i < 6; i++) {
            const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), PRODUCTS[(u * 3 + i + y * 10) % PRODUCTS.length]);
            can.position.set(cx - 0.32 + i * 0.13, y + 0.1, front - 0.2);
            g.add(can);
          }
        }
      }
      // Glass door hinged on its left edge
      const pivot = new THREE.Group();
      pivot.position.set(cx - unit / 2 + 0.03, 0, front + 0.03);
      slab(0, unit - 0.06, 0.12, 2.05, -0.01, 0.01, GLASS, pivot).userData.noAim = true;
      slab(0, 0.03, 0.12, 2.05, -0.015, 0.015, FRAME, pivot);
      slab(unit - 0.09, unit - 0.06, 0.12, 2.05, -0.015, 0.015, FRAME, pivot);
      slab(unit - 0.14, unit - 0.12, 0.8, 1.4, 0.015, 0.04, FRAME, pivot); // handle
      g.add(pivot);
      this.coolerDoors.push({ pivot, x: cx, t: 0 });
    }
    this.localWalls.push([[x0 - 0.05, front], [x1 + 0.05, front]]);
  }

  // Bread shelf along the left wall, and a snack aisle in the middle.
  #buildShelves() {
    const g = this.group;
    const x0 = -W / 2 + T;
    const x1 = x0 + 0.6;
    const z0 = -2.6;
    const z1 = 1.4;
    slab(x0, x1, 0, 0.1, z0, z1, SHELF, g);
    slab(x0, x0 + 0.04, 0, 1.7, z0, z1, SHELF, g);
    for (const y of [0.45, 0.9, 1.35]) {
      const shelf = slab(x0, x1, y - 0.02, y, z0, z1, SHELF, g);
      shelf.userData.fixture = y === 0.9 ? 'bunShelf' : 'shelf';
    }
    for (let i = 0; i < 4; i++) {
      const buns = createBuns();
      buns.refresh({ count: 8 });
      buns.group.position.set(x1 - 0.2, 0.9, -1.6 + i * 0.32);
      buns.group.rotation.y = Math.PI / 2;
      g.add(buns.group);
      this.#shopItem('buns', 4, buns.group, 'bunShelf');
    }
    // Boxes of other stuff on the remaining shelves
    for (const y of [0.45, 1.35]) {
      for (let z = z0 + 0.15; z < z1 - 0.1; z += 0.28) {
        const h = 0.18 + ((z * 7) % 0.1);
        slab(x0 + 0.1, x0 + 0.4, y, y + h, z - 0.1, z + 0.1, PRODUCTS[Math.abs(Math.round(z * 3 + y * 5)) % PRODUCTS.length], g);
      }
    }
    this.localWalls.push([[x1, z0], [x1, z1]], [[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]]);

    // Double-sided snack aisle
    const ax0 = -3.2;
    const ax1 = 0.4;
    const az0 = -1.1;
    const az1 = -0.3;
    slab(ax0, ax1, 0, 0.1, az0, az1, SHELF, g);
    slab(ax0, ax1, 0, 1.4, -0.72, -0.68, SHELF, g);
    for (const y of [0.4, 0.85, 1.3]) {
      slab(ax0, ax1, y - 0.02, y, az0, az1, SHELF, g);
      for (let x = ax0 + 0.2; x < ax1 - 0.1; x += 0.3) {
        for (const z of [az0 + 0.15, az1 - 0.15]) {
          slab(x - 0.1, x + 0.1, y, y + 0.22, z - 0.08, z + 0.08, PRODUCTS[Math.abs(Math.round(x * 4 + y * 3 + z)) % PRODUCTS.length], g);
        }
      }
    }
    this.localWalls.push([[ax0, az0], [ax1, az0]], [[ax0, az1], [ax1, az1]], [[ax0, az0], [ax0, az1]], [[ax1, az0], [ax1, az1]]);
  }

  // Checkout counter near the door, a register on top and a clerk behind it.
  #buildCounter() {
    const g = this.group;
    const [x0, x1, z0, z1] = [2.2, 4.6, 1.8, 2.5];
    slab(x0, x1, 0, 0.98, z0, z1, COUNTER, g);
    slab(x0 - 0.03, x1 + 0.03, 0.98, 1.02, z0 - 0.03, z1 + 0.03, COUNTER_TOP, g);
    const register = new THREE.Group();
    register.userData.fixture = 'register';
    slab(3.2, 3.6, 1.02, 1.14, 2.0, 2.3, COUNTER_TOP, register);
    const screen = slab(3.25, 3.55, 1.16, 1.36, 2.2, 2.23, mat(0x0f1a26, { emissive: 0x1d3c5c, emissiveIntensity: 0.9 }), register);
    screen.rotation.x = -0.25;
    slab(3.38, 3.42, 1.14, 1.2, 2.18, 2.22, COUNTER_TOP, register);
    // Generous invisible target over the whole counter top
    const proxy = slab(x0, x1, 1.02, 1.5, z0, z1, new THREE.MeshBasicMaterial({ visible: false }), register);
    proxy.castShadow = false;
    g.add(register);

    // Clerk
    const clerk = new THREE.Group();
    clerk.position.set(3.4, 0, 1.35);
    slab(-0.18, 0.18, 0.85, 1.5, -0.12, 0.12, SHIRT, clerk);
    slab(-0.15, 0.15, 0, 0.85, -0.1, 0.1, COUNTER_TOP, clerk);
    slab(-0.1, 0.1, 1.5, 1.75, -0.1, 0.1, SKIN, clerk);
    slab(-0.11, 0.11, 1.72, 1.8, -0.11, 0.11, SHIRT, clerk); // cap
    slab(-0.11, 0.11, 1.72, 1.74, 0.1, 0.18, SHIRT, clerk); // brim
    g.add(clerk);

    // Counter, plus a closed-off area behind it for the clerk
    this.localWalls.push(
      [[x0, z1], [x1, z1]], [[x0, z0], [x0, z1]], [[x1, z0], [x1, z1]],
      [[x1, z0], [W / 2, z0]], [[x0, 0.6], [x0, z0]], [[x0, 0.6], [W / 2, 0.6]],
    );
  }

  #shopItem(kind, price, mesh, fixture) {
    const item = { kind, price, mesh, fixture };
    mesh.traverse((o) => (o.userData.shop = item));
    this.shopItems.push(item);
  }
}
