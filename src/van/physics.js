import * as THREE from 'three';
import { VAN } from './model.js';

// Arcade handling tuned to feel like a heavy, top-heavy van.
const TUNING = {
  maxSpeed: 31, // m/s (~70 mph)
  maxReverse: 7,
  engineAccel: 3.8, // ~0-60 mph in 10s
  reverseAccel: 3,
  brakeDecel: 11,
  handbrakeDecel: 15,
  rollingDecel: 0.6,
  aeroDrag: 0.0018,
  wheelbase: VAN.frontAxleZ - VAN.rearAxleZ,
  maxSteer: 0.6, // rad at standstill; shrinks with speed
  steerRate: 1.6,
  steerReturn: 2.6,
  maxLateralAccel: 6.5, // grip limit -> understeer at speed
  rollPerAccel: 0.012,
  pitchPerAccel: 0.008,
  suspStiffness: 55,
  suspDamping: 7,
};

// Collision circles along the van's length (local z offset, radius).
export const HULL = [
  [1.9, 1.03],
  [-0.1, 1.03],
  [-2.1, 1.03],
];

function approach(value, target, rate) {
  return value < target ? Math.min(value + rate, target) : Math.max(value - rate, target);
}

export class VanSim {
  constructor() {
    this.reset(new THREE.Vector3(), 0);
  }

  reset(position, yaw) {
    this.position = position.clone();
    this.yaw = yaw;
    this.speed = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.wheelSpin = 0;
    this.roll = 0;
    this.rollVel = 0;
    this.pitch = 0;
    this.pitchVel = 0;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get velocity() {
    return this.forward.multiplyScalar(this.speed);
  }

  get gear() {
    if (this.speed < -0.3) return 'R';
    if (Math.abs(this.speed) < 0.3) return 'N';
    return 'D';
  }

  update(dt, input) {
    const T = TUNING;
    const prevSpeed = this.speed;
    const v = this.speed;
    const absV = Math.abs(v);

    // --- longitudinal ---
    if (input.handbrake) {
      this.speed = approach(v, 0, T.handbrakeDecel * dt);
    } else if (input.throttle && v >= -0.5) {
      const headroom = 1 - (v / T.maxSpeed) ** 2;
      this.speed += T.engineAccel * Math.max(headroom, 0) * dt;
    } else if (input.throttle) {
      this.speed = approach(v, 0, T.brakeDecel * dt);
    } else if (input.brake && v > 0.5) {
      this.speed = approach(v, 0, T.brakeDecel * dt);
    } else if (input.brake) {
      this.speed = Math.max(v - T.reverseAccel * dt, -T.maxReverse);
    } else {
      const drag = T.rollingDecel + T.aeroDrag * v * v;
      this.speed = approach(v, 0, drag * dt);
    }

    // --- steering ---
    const steerLimit = T.maxSteer / (1 + absV * 0.11);
    const target = input.steer * steerLimit;
    const rate = input.steer === 0 ? T.steerReturn : T.steerRate;
    this.steer = approach(this.steer, target, rate * dt);

    let yawRate = (this.speed * Math.tan(this.steer)) / T.wheelbase;
    const lat = this.speed * yawRate;
    if (Math.abs(lat) > T.maxLateralAccel) {
      yawRate = (Math.sign(yawRate) * T.maxLateralAccel) / Math.max(absV, 0.01);
      // scrub a little speed when pushing past grip
      this.speed = approach(this.speed, 0, 1.5 * dt);
    }
    this.yawRate = yawRate;
    this.yaw += yawRate * dt;

    this.position.addScaledVector(this.forward, this.speed * dt);
    this.wheelSpin += (this.speed * dt) / VAN.wheelRadius;

    // --- body lean on a springy suspension ---
    const longAccel = (this.speed - prevSpeed) / dt;
    const latAccel = this.speed * yawRate;
    this.#spring('roll', latAccel * T.rollPerAccel, dt);
    this.#spring('pitch', -longAccel * T.pitchPerAccel, dt);
  }

  #spring(key, target, dt) {
    const T = TUNING;
    const velKey = key + 'Vel';
    const accel = T.suspStiffness * (target - this[key]) - T.suspDamping * this[velKey];
    this[velKey] += accel * dt;
    this[key] += this[velKey] * dt;
  }

  // Push out of solid circles ({x, z, r}); returns true on contact.
  collide(obstacles, bounds) {
    let hit = false;
    const fwd = this.forward;
    for (const [offset, radius] of HULL) {
      for (const o of obstacles) {
        const cx = this.position.x + fwd.x * offset;
        const cz = this.position.z + fwd.z * offset;
        const dx = cx - o.x;
        const dz = cz - o.z;
        const minDist = radius + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d;
        const nz = dz / d;
        this.position.x += nx * (minDist - d);
        this.position.z += nz * (minDist - d);
        this.#absorbImpact(nx, nz);
        hit = true;
      }
    }

    // Invisible walls at the edge of the sandbox
    for (const axis of ['x', 'z']) {
      if (Math.abs(this.position[axis]) > bounds) {
        this.position[axis] = Math.sign(this.position[axis]) * bounds;
        this.speed *= -0.2;
        hit = true;
      }
    }
    return hit;
  }

  #absorbImpact(nx, nz) {
    const fwd = this.forward;
    const into = -(fwd.x * nx + fwd.z * nz) * Math.sign(this.speed);
    if (into <= 0) return; // sliding away
    if (into > 0.7) {
      this.speed *= -0.25; // near head-on: bounce back
    } else {
      this.speed *= 1 - into * 0.8;
    }
  }
}
