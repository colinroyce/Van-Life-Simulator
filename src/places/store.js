import * as THREE from 'three';
import { indoor } from '../van/indoor.js';
import { createPack, createBuns } from '../items/food.js';

// "GAS & GO" convenience store. Built in its own local frame (front faces +Z, centered on the
// origin) and dropped into the world with place(). Inside: a glass-door cooler of hot dogs on the
// back wall, a shelf of buns on the left wall, and a register with a clerk beside the entrance.
// Sliding front doors open as you walk up, unless you're trying to leave without paying.

const W = 7; // width (x)
const D = 6; // depth (z)
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
// Lit evenly by the fixtures; on its own its underside would only catch the green ground light.
const CEILING = mat(0xf4f4f2, { emissive: 0xc9cbc8, emissiveIntensity: 0.55 });
const PANEL_LIGHT = mat(0xffffff, { emissive: 0xfafcff, emissiveIntensity: 1.2 });
const COOLER = inside(0x2f3237, { roughness: 0.5 });
const COOLER_IN = mat(0xe9eef2, { emissive: 0xdfe9f5, emissiveIntensity: 0.45 });
const SHELF = inside(0x8d939a, { roughness: 0.6 });
const COUNTER = inside(0x6b4a33);
const COUNTER_TOP = inside(0x2b2d31, { roughness: 0.4 });
const COUNTER_STEEL = inside(0xb9bdc1, { metalness: 0.4, roughness: 0.35 });
const SIGN_BLUE = inside(0x2e5fb8);
const SKIN = inside(0xc98f6b);
const SHIRT = inside(0xc0392b);

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
    slab(-hw, hw, -0.02, 0.03, -hd, hd, FLOOR, g); // above the lot's asphalt so they don't flicker

    // Back and side walls, with white inner lining
    this.#wall(-hw + T, hw - T, -hd, -hd + T); // between the side walls, not overlapping them
    this.#wall(-hw, -hw + T, -hd, hd);
    this.#wall(hw - T, hw, -hd, hd);
    slab(-hw + T, hw - T, 0, H, -hd + T, -hd + T + 0.01, WALL_IN, g);
    slab(-hw + T, -hw + T + 0.01, 0, H, -hd + T + 0.01, hd - T, WALL_IN, g);
    slab(hw - T - 0.01, hw - T, 0, H, -hd + T + 0.01, hd - T, WALL_IN, g);

    // Front: low wall under big windows, a sign band above, doorway in the middle
    const fz0 = hd - T;
    // Each section runs from the side wall to the door frame without overlapping either, since
    // overlapping boxes with shared faces flicker.
    const frame = DOOR.half + 0.05;
    for (const [x0, x1] of [[-hw + T, -frame], [frame, hw - T]]) {
      slab(x0, x1, 0, WINDOW.bottom, fz0, hd, STUCCO, g);
      slab(x0, x1, WINDOW.top, H, fz0, hd, STUCCO, g);
      const glass = slab(x0, x1, WINDOW.bottom, WINDOW.top, hd - T / 2 - 0.01, hd - T / 2 + 0.01, GLASS, g);
      glass.castShadow = false;
      glass.userData.noAim = true;
      for (let k = 1; k < 4; k++) {
        const x = x0 + ((x1 - x0) * k) / 4;
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
    // Light panels, each with a soft light hung well below the ceiling so it lights the room
    // evenly instead of making a hot spot on the ceiling
    for (const [x, z] of [[-1.6, -1.0], [0.9, -1.2], [2.5, 1.6]]) {
      slab(x - 0.6, x + 0.6, H - 0.07, H - 0.06, z - 0.3, z + 0.3, PANEL_LIGHT, g);
      const light = new THREE.PointLight(0xfff8ef, 3.5, 10, 1);
      light.position.set(x, H - 0.9, z);
      g.add(light);
    }

    // Sign on the band above the windows
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.6, 0.8), new THREE.MeshBasicMaterial({ map: signTexture() }));
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

  // Glass-door cooler on the back wall with packs of hot dogs.
  #buildCoolers() {
    const g = this.group;
    const back = -D / 2 + T;
    const front = back + 0.7;
    const unit = 0.9;
    const x0 = -unit / 2;
    const x1 = unit / 2;
    // Cabinet: base, top, back, sides and a lit back panel
    slab(x0 - 0.05, x1 + 0.05, 0, 0.12, back, front, COOLER, g);
    slab(x0 - 0.05, x1 + 0.05, 2.05, 2.15, back, front, COOLER, g);
    slab(x0 - 0.05, x1 + 0.05, 0.12, 2.05, back, back + 0.04, COOLER, g);
    for (const x of [x0, x1]) slab(x - 0.03, x + 0.03, 0.12, 2.05, back, front, COOLER, g);
    slab(x0 + 0.03, x1 - 0.03, 0.12, 2.05, back + 0.04, back + 0.05, COOLER_IN, g);
    const y = 0.95;
    const shelf = slab(x0 + 0.05, x1 - 0.05, y - 0.012, y, back + 0.05, front - 0.02, SHELF, g);
    shelf.userData.fixture = 'hotdogCooler';
    for (let i = 0; i < 4; i++) {
      const pack = createPack();
      pack.refresh({ count: 6 });
      pack.group.position.set(-0.3 + i * 0.2, y, front - 0.2);
      pack.group.rotation.y = Math.PI / 2;
      g.add(pack.group);
      this.#shopItem('hotdogs', 6, pack.group, 'hotdogCooler');
    }
    // Glass door hinged on its left edge
    const pivot = new THREE.Group();
    pivot.position.set(x0 + 0.03, 0, front + 0.03);
    slab(0, unit - 0.06, 0.12, 2.05, -0.01, 0.01, GLASS, pivot).userData.noAim = true;
    slab(0, 0.03, 0.12, 2.05, -0.015, 0.015, FRAME, pivot);
    slab(unit - 0.09, unit - 0.06, 0.12, 2.05, -0.015, 0.015, FRAME, pivot);
    slab(unit - 0.14, unit - 0.12, 0.8, 1.4, 0.015, 0.04, FRAME, pivot); // handle
    g.add(pivot);
    this.coolerDoors.push({ pivot, x: 0, t: 0 });
    this.localWalls.push([[x0 - 0.05, front], [x1 + 0.05, front]]);
  }

  // Bread shelf along the left wall with bags of buns.
  #buildShelves() {
    const g = this.group;
    const x0 = -W / 2 + T;
    const x1 = x0 + 0.6;
    const z0 = -1.9;
    const z1 = -0.2;
    slab(x0, x1, 0, 0.1, z0, z1, SHELF, g);
    slab(x0, x0 + 0.04, 0, 1.2, z0, z1, SHELF, g);
    const shelf = slab(x0, x1, 0.88, 0.9, z0, z1, SHELF, g);
    shelf.userData.fixture = 'bunShelf';
    for (let i = 0; i < 4; i++) {
      const buns = createBuns();
      buns.refresh({ count: 8 });
      buns.group.position.set(x1 - 0.2, 0.9, -1.6 + i * 0.36);
      buns.group.rotation.y = Math.PI / 2;
      g.add(buns.group);
      this.#shopItem('buns', 4, buns.group, 'bunShelf');
    }
    this.localWalls.push([[x1, z0], [x1, z1]], [[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]]);
  }

  // Cashier's enclosure in the front-right corner beside the entrance: a long counter facing the
  // entrance aisle (steel front, blue sign) and a return closing it off, with the clerk behind it.
  #buildCounter() {
    const g = this.group;
    const xIn = W / 2 - T; // inside face of the right wall
    const zIn = D / 2 - T; // inside face of the front wall
    const cx0 = 1.6; // counter front, facing the customer (-X)
    const cx1 = 2.2;
    const zBack = 0.3; // the return closes the enclosure here
    const rz = (zBack + 0.5 + zIn) / 2; // middle of the main counter, where the register sits
    const top = 1.0;

    // Main counter, running back from the front wall
    slab(cx0 + 0.02, cx1, 0, top, zBack + 0.5, zIn, COUNTER, g);
    slab(cx0, cx0 + 0.02, 0.06, top - 0.04, zBack + 0.5, zIn, COUNTER_STEEL, g);
    slab(cx0 - 0.005, cx0, 0.35, 0.75, rz - 0.4, rz + 0.4, SIGN_BLUE, g);
    slab(cx0 - 0.04, cx1 + 0.02, top, top + 0.04, zBack + 0.5, zIn, COUNTER_TOP, g);
    // Return along the side, closing off the clerk's corner
    slab(cx0 + 0.02, xIn, 0, top, zBack, zBack + 0.5, COUNTER, g);
    slab(cx0, cx0 + 0.02, 0.06, top - 0.04, zBack, zBack + 0.5, COUNTER_STEEL, g);
    slab(cx0 - 0.04, xIn, top, top + 0.04, zBack - 0.02, zBack + 0.5, COUNTER_TOP, g);

    // Register on the counter
    const register = new THREE.Group();
    register.userData.fixture = 'register';
    slab(cx0 + 0.15, cx0 + 0.5, top + 0.04, top + 0.16, rz - 0.2, rz + 0.2, COUNTER_TOP, register);
    const screen = slab(cx0 + 0.18, cx0 + 0.21, top + 0.18, top + 0.38, rz - 0.15, rz + 0.15, mat(0x0f1a26, { emissive: 0x1d3c5c, emissiveIntensity: 0.9 }), register);
    screen.rotation.z = 0.25;
    slab(cx0 + 0.22, cx0 + 0.26, top + 0.16, top + 0.22, rz - 0.02, rz + 0.02, COUNTER_TOP, register);
    // Generous invisible target over the counter top
    const proxy = slab(cx0 - 0.1, cx1, top, top + 0.5, zBack + 0.5, zIn, new THREE.MeshBasicMaterial({ visible: false }), register);
    proxy.castShadow = false;
    g.add(register);

    // Clerk, facing the customer
    const clerk = new THREE.Group();
    clerk.position.set((cx1 + xIn) / 2, 0, rz);
    clerk.rotation.y = -Math.PI / 2;
    slab(-0.18, 0.18, 0.85, 1.5, -0.12, 0.12, SHIRT, clerk);
    slab(-0.15, 0.15, 0, 0.85, -0.1, 0.1, COUNTER_TOP, clerk);
    slab(-0.1, 0.1, 1.5, 1.75, -0.1, 0.1, SKIN, clerk);
    slab(-0.11, 0.11, 1.72, 1.8, -0.11, 0.11, SHIRT, clerk); // cap
    slab(-0.11, 0.11, 1.72, 1.74, 0.1, 0.18, SHIRT, clerk); // brim
    g.add(clerk);

    // Counter front and return, closing the clerk's corner off from the shop floor
    this.localWalls.push([[cx0, zBack], [cx0, zIn]], [[cx0, zBack], [xIn, zBack]]);
  }

  #shopItem(kind, price, mesh, fixture) {
    const item = { kind, price, mesh, fixture };
    mesh.traverse((o) => (o.userData.shop = item));
    this.shopItems.push(item);
  }
}
