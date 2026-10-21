import * as THREE from 'three';
import { HULL } from './van/physics.js';

export const BOUNDS = 190;
export const SPAWN = { position: new THREE.Vector3(0, 0, -60), yaw: 0 };

const PAD = { halfX: 30, halfZ: 80 };

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...opts });

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(1500, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x5fa8e0) },
      horizon: { value: new THREE.Color(0xd8ecf5) },
    },
    vertexShader: `varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
      void main() { float h = clamp(normalize(vPos).y * 2.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, h), 1.0); }`,
  });
  return new THREE.Mesh(geo, m);
}

// Sky + ground reflection map for glossy materials.
export function createEnvironment(renderer) {
  const envScene = new THREE.Scene();
  envScene.add(buildSky());
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 16), new THREE.MeshBasicMaterial({ color: 0x5e7f45 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02, 0.1, 2000).texture;
  pmrem.dispose();
  return env;
}

function buildGround(rand) {
  const geo = new THREE.PlaneGeometry(1400, 1400, 70, 70).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const colors = [];
  const base = new THREE.Color(0x7fae55);
  const c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i += 3) {
    c.copy(base).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.06);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(geo, mat(0xffffff, { vertexColors: true }));
  ground.receiveShadow = true;
  return ground;
}

function buildPad() {
  const g = new THREE.Group();
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(PAD.halfX * 2, PAD.halfZ * 2), mat(0x4a4d52));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.01;
  asphalt.receiveShadow = true;
  g.add(asphalt);

  const paint = mat(0xf3f0e6);
  const yellow = mat(0xe8b923);
  const stripe = (w, l, x, z, m = paint) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, l), m);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.02, z);
    s.receiveShadow = true;
    g.add(s);
  };
  for (let z = -PAD.halfZ + 4; z < PAD.halfZ - 2; z += 8) stripe(0.25, 4, 0, z, yellow);
  stripe(0.3, PAD.halfZ * 2 - 2, -PAD.halfX + 1, 0);
  stripe(0.3, PAD.halfZ * 2 - 2, PAD.halfX - 1, 0);
  // parking bays at the far end
  for (let x = -24; x <= 24; x += 4) stripe(0.2, 6, x, PAD.halfZ - 6);
  return g;
}

function buildPine(rand) {
  const g = new THREE.Group();
  const h = 5 + rand() * 5;
  g.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, h * 0.3, 6), mat(0x6b4a2f))));
  g.children[0].position.y = h * 0.15;
  const green = mat(new THREE.Color().setHSL(0.3 + rand() * 0.05, 0.45, 0.25 + rand() * 0.08));
  for (let i = 0; i < 3; i++) {
    const r = (1.9 - i * 0.5) * (h / 8);
    const cone = shadowed(new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.4, 7), green));
    cone.position.y = h * (0.35 + i * 0.2);
    g.add(cone);
  }
  return g;
}

function buildRoundTree(rand) {
  const g = new THREE.Group();
  const h = 3 + rand() * 2;
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h, 6), mat(0x7a5535)));
  trunk.position.y = h / 2;
  const leaves = shadowed(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.8 + rand(), 0),
      mat(new THREE.Color().setHSL(0.22 + rand() * 0.06, 0.5, 0.38)),
    ),
  );
  leaves.position.y = h + 1;
  g.add(trunk, leaves);
  return g;
}

function buildRock(rand, size) {
  const geo = new THREE.DodecahedronGeometry(size, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * (0.8 + rand() * 0.4), pos.getY(i) * (0.6 + rand() * 0.3), pos.getZ(i));
  }
  geo.computeVertexNormals();
  const rock = shadowed(new THREE.Mesh(geo, mat(0x8a8d90)));
  rock.position.y = size * 0.25;
  rock.rotation.y = rand() * Math.PI;
  return rock;
}

function buildMountains(rand) {
  const g = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const dist = 480 + rand() * 120;
    const h = 90 + rand() * 140;
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(h * 1.1, h, 5 + Math.floor(rand() * 3)),
      mat(new THREE.Color().setHSL(0.38 + rand() * 0.1, 0.18, 0.42 + rand() * 0.1)),
    );
    m.position.set(Math.cos(a) * dist, h / 2 - 5, Math.sin(a) * dist);
    m.rotation.y = rand() * Math.PI;
    g.add(m);
  }
  return g;
}

function buildCone() {
  const g = new THREE.Group();
  const orange = mat(0xf26b1d);
  const white = mat(0xf5f5f0);
  g.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), orange)));
  const body = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.7, 8), orange));
  body.position.y = 0.38;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.115, 0.12, 8), white);
  band.position.y = 0.45;
  g.add(body, band);
  return g;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = []; // solid {x, z, r}
    this.cones = [];
    const rand = rng(7);

    scene.add(buildSky(), buildGround(rand), buildPad(), buildMountains(rand));

    const onPad = (x, z, margin) => Math.abs(x) < PAD.halfX + margin && Math.abs(z) < PAD.halfZ + margin;
    const place = (mesh, x, z, r) => {
      mesh.position.x = x;
      mesh.position.z = z;
      scene.add(mesh);
      if (r) this.obstacles.push({ x, z, r });
    };

    // Scattered trees and rocks around the pad
    for (let i = 0; i < 160; i++) {
      const x = (rand() - 0.5) * BOUNDS * 2;
      const z = (rand() - 0.5) * BOUNDS * 2;
      if (onPad(x, z, 6)) continue;
      if (rand() < 0.6) place(buildPine(rand), x, z, 0.5);
      else place(buildRoundTree(rand), x, z, 0.45);
    }
    for (let i = 0; i < 50; i++) {
      const x = (rand() - 0.5) * BOUNDS * 2;
      const z = (rand() - 0.5) * BOUNDS * 2;
      if (onPad(x, z, 3)) continue;
      const size = 0.6 + rand() * 1.6;
      place(buildRock(rand, size), x, z, size * 0.85);
    }
    // Tree line just outside the invisible wall
    for (let i = 0; i < 220; i++) {
      const a = (i / 220) * Math.PI * 2;
      const d = BOUNDS + 6 + rand() * 25;
      place(rand() < 0.7 ? buildPine(rand) : buildRoundTree(rand), Math.cos(a) * d, Math.sin(a) * d);
    }

    // Cone slalom down one side of the pad, plus a loose cluster to plow through
    this.coneSpawns = [];
    for (let i = 0; i < 9; i++) this.coneSpawns.push([i % 2 ? 13 : 19, -50 + i * 12]);
    for (let i = 0; i < 12; i++) this.coneSpawns.push([-14 + (i % 4) * 1.5, 20 + Math.floor(i / 4) * 1.5]);
    for (const [x, z] of this.coneSpawns) {
      const holder = new THREE.Group();
      const mesh = buildCone();
      holder.add(mesh);
      scene.add(holder);
      this.cones.push({ holder, mesh, x, z, vx: 0, vz: 0, tilt: 0, spin: 0 });
    }
    this.resetCones();
  }

  resetCones() {
    this.cones.forEach((c, i) => {
      [c.x, c.z] = this.coneSpawns[i];
      c.vx = c.vz = c.tilt = c.spin = 0;
      c.down = false;
      this.#syncCone(c);
    });
  }

  // Cones get knocked around by the van but never block it.
  update(dt, sim) {
    const fwd = sim.forward;
    const vel = sim.velocity;
    for (const c of this.cones) {
      for (const [offset, radius] of HULL) {
        const dx = c.x - (sim.position.x + fwd.x * offset);
        const dz = c.z - (sim.position.z + fwd.z * offset);
        const minDist = radius + 0.25;
        const d2 = dx * dx + dz * dz;
        if (d2 > minDist * minDist) continue;
        const d = Math.sqrt(d2) || 0.001;
        const kick = 1.5 + Math.abs(sim.speed) * 0.3;
        c.vx = vel.x * 1.1 + (dx / d) * kick;
        c.vz = vel.z * 1.1 + (dz / d) * kick;
        c.x += (dx / d) * (minDist - d);
        c.z += (dz / d) * (minDist - d);
        c.down = true;
        c.spin = (Math.random() - 0.5) * 8;
      }

      const damp = Math.exp(-(c.down ? 2.5 : 6) * dt);
      c.vx *= damp;
      c.vz *= damp;
      c.spin *= damp;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      if (c.down) c.tilt = Math.min(c.tilt + dt * 9, Math.PI / 2 - 0.25);
      this.#syncCone(c, dt);
    }
  }

  #syncCone(c, dt = 0) {
    c.holder.position.set(c.x, 0, c.z);
    if (c.vx || c.vz) c.holder.rotation.y = Math.atan2(c.vx, c.vz);
    c.mesh.rotation.x = c.tilt;
    c.mesh.rotation.y += c.spin * dt;
    if (!c.down) c.mesh.rotation.y = 0;
    c.mesh.position.y = Math.sin(c.tilt) * 0.12;
  }
}
