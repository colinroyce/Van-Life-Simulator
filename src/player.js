import * as THREE from 'three';
import { LAYOUT } from './van/model.js';

const RADIUS = 0.2;
const EYE = 1.62;
const EYE_DUCK = 1.45; // under the overhead shelf in the cab
const WALK_SPEED = 1.7;
const RUN_SPEED = 4.2;
const LOOK_SENSITIVITY = 0.0022;
const TURN_RATE = 2.2; // arrow-key turning, rad/s

const clamp = THREE.MathUtils.clamp;

// Pushes point p (x/z) out of segment a-b to at least distance r.
function pushFromSegment(p, [ax, az], [bx, bz], r) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  let ox = p.x - cx;
  let oz = p.z - cz;
  let d = Math.hypot(ox, oz);
  if (d >= r) return;
  if (d < 1e-6) {
    ox = -dz;
    oz = dx;
    d = Math.hypot(ox, oz);
  }
  p.x = cx + (ox / d) * r;
  p.z = cz + (oz / d) * r;
}

function pushFromBox(p, [x0, x1, z0, z1], r) {
  const cx = clamp(p.x, x0, x1);
  const cz = clamp(p.z, z0, z1);
  const ox = p.x - cx;
  const oz = p.z - cz;
  const d = Math.hypot(ox, oz);
  if (d >= r) return;
  if (d > 1e-6) {
    p.x = cx + (ox / d) * r;
    p.z = cz + (oz / d) * r;
    return;
  }
  // Center is inside the box: leave along the shallowest side.
  const exits = [[x0 - r - p.x, 0], [x1 + r - p.x, 0], [0, z0 - r - p.z], [0, z1 + r - p.z]];
  const [ex, ez] = exits.reduce((best, e) => (Math.hypot(...e) < Math.hypot(...best) ? e : best));
  p.x += ex;
  p.z += ez;
}

// Van walls as 2D segments in van-local x/z. The sliding door is a segment that moves with the panel.
function vanWalls(van) {
  const { wallX: w, rearZ: r, dashZ, noseZ: n, door: [d0, d1] } = LAYOUT;
  const { x: dx, z: dz } = van.door.position;
  return [
    [[w, r], [w, n]], // driver side
    [[-w, r], [-w, d0]], // passenger side behind the door opening
    [[-w, d1], [-w, n]], // passenger side ahead of it
    [[-w, r], [w, r]], // rear doors
    [[-w, n], [w, n]], // nose
    [[-w, dashZ], [w, dashZ]], // dashboard
    [[-w + dx, d0 + dz], [-w + dx, d1 + dz]], // sliding door panel
  ];
}

export class Player {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.05, 3000);
    this.camera.rotation.order = 'YXZ';
    this.position = new THREE.Vector3(); // feet, world space
    this.heading = 0; // same convention as the van's yaw: 0 looks along +Z
    this.pitch = 0;
    this.floorY = 0;
    this.eye = EYE;
    this.local = new THREE.Vector3(); // position in van space, updated each frame
    this.inside = true;
    this.moved = 0; // meters walked last update (for footsteps)
    this.running = false;
    this.lying = false;
    this.headPos = new THREE.Vector3(); // eye position while lying in bed
  }

  // Stand up between the front seats, facing the back of the van.
  standUp(van) {
    this.#placeInside(van, LAYOUT.standUp, Math.PI, -0.15);
    this.eye = EYE_DUCK;
    this.#placeCamera();
  }

  lieDown(van) {
    van.root.updateMatrixWorld(true);
    this.lying = true;
    this.headPos.copy(van.body.localToWorld(LAYOUT.bedHead.clone()));
    this.heading = van.root.rotation.y - Math.PI / 2; // looking down the bed toward your feet
    this.pitch = 0.35;
    this.moved = 0;
    this.#placeCamera();
  }

  getOutOfBed(van) {
    this.lying = false;
    this.#placeInside(van, LAYOUT.bedStand, 0, -0.1);
    this.#placeCamera();
  }

  #placeInside(van, localSpot, localHeading, pitch) {
    van.root.updateMatrixWorld(true);
    this.local.copy(localSpot);
    this.position.copy(van.root.localToWorld(this.local.clone()));
    this.position.y = 0;
    this.heading = van.root.rotation.y + localHeading;
    this.pitch = pitch;
    this.inside = true;
    this.floorY = LAYOUT.floorY;
    this.eye = EYE;
  }

  update(dt, input, mouse, van, world, bounds) {
    this.heading -= mouse.x * LOOK_SENSITIVITY;
    this.heading += input.turn * TURN_RATE * dt;
    const [minPitch, maxPitch] = this.lying ? [-0.4, 1.3] : [-1.45, 1.45];
    this.pitch = clamp(this.pitch - mouse.y * LOOK_SENSITIVITY, minPitch, maxPitch);
    if (this.lying) {
      this.#placeCamera();
      return;
    }

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // right-hand side is (-cos h, sin h)
    let mx = fx * input.forward - fz * input.strafe;
    let mz = fz * input.forward + fx * input.strafe;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const startX = this.position.x;
    const startZ = this.position.z;
    this.position.x += mx * speed * dt;
    this.position.z += mz * speed * dt;

    this.#collide(van, world, bounds);
    this.moved = Math.hypot(this.position.x - startX, this.position.z - startZ);
    this.running = input.run;

    const targetFloor = this.inside ? LAYOUT.floorY : 0;
    const targetEye = this.inside && this.local.z > LAYOUT.cabZ ? EYE_DUCK : EYE;
    this.floorY += (targetFloor - this.floorY) * (1 - Math.exp(-12 * dt));
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-8 * dt));
    this.#placeCamera();
  }

  #collide(van, world, bounds) {
    van.root.updateMatrixWorld(true);
    const p = van.root.worldToLocal(this.position.clone());
    const walls = vanWalls(van);
    for (let i = 0; i < 2; i++) {
      for (const [a, b] of walls) pushFromSegment(p, a, b, RADIUS);
      for (const block of LAYOUT.blocks) pushFromBox(p, block, RADIUS);
    }
    this.inside = Math.abs(p.x) < LAYOUT.wallX && p.z > LAYOUT.rearZ && p.z < LAYOUT.noseZ;
    this.local.copy(p);
    this.position.copy(van.root.localToWorld(p));
    this.position.y = 0;

    if (this.inside) return;
    for (const o of world.obstacles) {
      const dx = this.position.x - o.x;
      const dz = this.position.z - o.z;
      const min = o.r + RADIUS;
      const d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-6) continue;
      this.position.x = o.x + (dx / d) * min;
      this.position.z = o.z + (dz / d) * min;
    }
    this.position.x = clamp(this.position.x, -bounds, bounds);
    this.position.z = clamp(this.position.z, -bounds, bounds);
  }

  // What E would do right now, or null. Picks the nearby thing you're most facing.
  interaction(van) {
    if (this.lying) return { action: 'getup', label: 'Get up' };
    const p = this.local;
    const [d0, d1] = LAYOUT.door;
    const candidates = [
      {
        action: 'door',
        label: van.doorOpen ? 'Close sliding door' : 'Open sliding door',
        at: [-LAYOUT.wallX, clamp(p.z, d0 + 0.1, d1 - 0.1)],
        range: 1.3,
      },
    ];
    if (this.inside) {
      const seat = LAYOUT.driverSeat;
      const sw = LAYOUT.lightSwitch;
      candidates.push(
        // Facing barely matters for the seat, so you can sit straight back down after getting up
        { action: 'drive', label: 'Drive', at: [seat.x, seat.z], range: 0.9, minFacing: -0.6 },
        { action: 'lights', label: van.lightsOn ? 'Lights off' : 'Lights on', at: [sw.x, sw.z], range: 0.9 },
        { action: 'lie', label: 'Lie down', at: [clamp(p.x, -0.3, 0.3), LAYOUT.bedFront.z], range: 0.9 },
      );
    }

    const look = this.heading - van.root.rotation.y;
    const lx = Math.sin(look);
    const lz = Math.cos(look);
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const dx = c.at[0] - p.x;
      const dz = c.at[1] - p.z;
      const dist = Math.hypot(dx, dz);
      const facing = dist < 0.05 ? 1 : (dx * lx + dz * lz) / dist;
      if (dist > c.range || facing < (c.minFacing ?? 0.2)) continue;
      const score = dist * (1.6 - facing);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  #placeCamera() {
    if (this.lying) this.camera.position.copy(this.headPos);
    else this.camera.position.set(this.position.x, this.floorY + this.eye, this.position.z);
    this.camera.rotation.set(this.pitch, this.heading + Math.PI, 0);
  }
}
