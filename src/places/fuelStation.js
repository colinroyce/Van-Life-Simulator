import * as THREE from 'three';

// Pump island under a canopy. Built in its own frame (island along local Z, the pump's hose side
// facing -X) and dropped into the world with place(). The pump shows the running sale on its
// display; the nozzle and hose themselves are handled by the Fueling controller.

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...opts });
const CONCRETE = mat(0xb9b6ae, { roughness: 0.95 });
const PUMP_RED = mat(0xc0392b, { roughness: 0.5 });
const PUMP_WHITE = mat(0xf2f0ea, { roughness: 0.5 });
const DARK = mat(0x1d1e21, { roughness: 0.5 });
const STEEL = mat(0xb8bcc0, { metalness: 0.6, roughness: 0.35 });
// Faintly self-lit: its underside only gets the grass-green ground light otherwise
const CANOPY = mat(0xf4f4f2, { emissive: 0x9a9a96, emissiveIntensity: 0.6 });
const LIGHT = mat(0xffffff, { emissive: 0xfafcff, emissiveIntensity: 1.1 });

const CANOPY_HEIGHT = 5;

function slab(x0, x1, y0, y1, z0, z1, material, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export const PRICE_PER_GALLON = 4;

export class FuelStation {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;

    // Island and bollards
    slab(-0.6, 0.6, 0, 0.15, -2.2, 2.2, CONCRETE, g);
    for (const z of [-2.0, 2.0]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 10), mat(0xf1c40f));
      post.position.set(0, 0.6, z);
      post.castShadow = true;
      g.add(post);
    }

    // Pump body, tagged so you can aim at it
    this.pump = new THREE.Group();
    this.pump.userData.fixture = 'pump';
    slab(-0.3, 0.3, 0.15, 1.85, -0.45, 0.45, PUMP_WHITE, this.pump);
    slab(-0.31, 0.31, 1.55, 1.95, -0.47, 0.47, PUMP_RED, this.pump);
    slab(-0.31, 0.31, 0.15, 0.4, -0.47, 0.47, DARK, this.pump);
    // Displays on both long faces
    this.display = this.#makeDisplay();
    for (const side of [-1, 1]) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.32), new THREE.MeshBasicMaterial({ map: this.display.texture }));
      screen.position.set(side * 0.305, 1.3, 0);
      screen.rotation.y = side * Math.PI / 2;
      this.pump.add(screen);
    }
    // Holster on the -X face, where the nozzle hangs and the hose leaves the pump
    slab(-0.38, -0.3, 0.95, 1.15, 0.12, 0.3, DARK, this.pump);
    this.holster = new THREE.Vector3(-0.42, 0.95, 0.21);
    this.hoseOut = new THREE.Vector3(-0.32, 1.45, 0.3);
    slab(-0.36, -0.3, 1.4, 1.5, 0.25, 0.35, STEEL, this.pump);
    // Big invisible target so the pump is easy to aim at
    const proxy = slab(-0.5, 0.5, 0.15, 2.0, -0.6, 0.6, new THREE.MeshBasicMaterial({ visible: false }), this.pump);
    proxy.castShadow = false;
    g.add(this.pump);

    // Canopy on two columns
    for (const z of [-4, 4]) slab(-0.2, 0.2, 0.15, CANOPY_HEIGHT, z - 0.2, z + 0.2, CANOPY, g);
    slab(-4.5, 4.5, CANOPY_HEIGHT, CANOPY_HEIGHT + 0.6, -6, 6, CANOPY, g);
    slab(-4.55, 4.55, CANOPY_HEIGHT + 0.3, CANOPY_HEIGHT + 0.6, -6.05, 6.05, PUMP_RED, g);
    for (const x of [-2.5, 2.5]) {
      for (const z of [-3.5, 0, 3.5]) slab(x - 0.5, x + 0.5, CANOPY_HEIGHT - 0.02, CANOPY_HEIGHT, z - 0.25, z + 0.25, LIGHT, g);
    }
    this.showSale(0, 0);
  }

  place(scene, x, z, rotationY) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rotationY;
    this.group.updateMatrixWorld(true);
    scene.add(this.group);
  }

  worldPoint(local) {
    return this.group.localToWorld(local.clone());
  }

  // Island, pump and canopy columns, as circles the van (and you) can't go through.
  obstacles() {
    const out = [];
    for (let z = -2; z <= 2; z += 1) out.push([0, z, 0.65]);
    for (const z of [-4, 4]) out.push([0, z, 0.35]);
    return out.map(([x, z, r]) => {
      const w = this.worldPoint(new THREE.Vector3(x, 0, z));
      return { x: w.x, z: w.z, r };
    });
  }

  showSale(gallons, dollars) {
    const { ctx, texture } = this.display;
    ctx.fillStyle = '#0d1a12';
    ctx.fillRect(0, 0, 256, 132);
    ctx.fillStyle = '#7dff9a';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('SALE', 14, 34);
    ctx.fillText('GALLONS', 14, 74);
    ctx.textAlign = 'right';
    ctx.font = 'bold 30px monospace';
    ctx.fillText(`$${dollars.toFixed(2)}`, 242, 36);
    ctx.fillText(gallons.toFixed(3), 242, 76);
    ctx.font = '18px monospace';
    ctx.fillText(`$${PRICE_PER_GALLON.toFixed(2)}/gal DIESEL`, 242, 116);
    ctx.textAlign = 'left';
    texture.needsUpdate = true;
  }

  #makeDisplay() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 132;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { ctx: canvas.getContext('2d'), texture };
  }
}
