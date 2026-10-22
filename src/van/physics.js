import * as THREE from 'three';
import { VAN } from './model.js';

// Arcade handling tuned to feel like a heavy, top-heavy van.
const TUNING = {
  maxSpeed: 53.6, // m/s (120 mph)
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
  gravity: 9.81,
};

// Collision circles along the van's length (local z offset, radius).
export const HULL = [
  [1.9, 1.03],
  [-0.1, 1.03],
  [-2.1, 1.03],
];

// Automatic gearbox, for engine sound: rpm per m/s of road speed in each gear.
const GEAR_RATIOS = [330, 210, 145, 110, 88, 74];
const REVERSE_RATIO = 300;
const IDLE_RPM = 750;
const REDLINE_RPM = 4200;

function approach(value, target, rate) {
  return value < target ? Math.min(value + rate, target) : Math.max(value - rate, target);
}

export class VanSim {
  constructor() {
    this.ground = () => 0; // height of the surface under (x, z)
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
    this.rpm = IDLE_RPM;
    this.gearIndex = 0; // -1 reverse
    this.load = 0; // 0..1 how hard the engine is pulling
    this.slip = 0; // 0..1 tires sliding past grip
    this.impact = 0; // strongest hit during the last collide(), m/s into the obstacle
    this.groundPitch = 0; // + = nose up, from the slope under the wheels
    this.groundRoll = 0; // + = driver (left) side up
    this.#followGround(1);
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
    this.slip = 0;
    if (Math.abs(lat) > T.maxLateralAccel) {
      this.slip = Math.min((Math.abs(lat) - T.maxLateralAccel) / T.maxLateralAccel, 1);
      yawRate = (Math.sign(yawRate) * T.maxLateralAccel) / Math.max(absV, 0.01);
      // scrub a little speed when pushing past grip
      this.speed = approach(this.speed, 0, 1.5 * dt);
    }
    this.yawRate = yawRate;
    this.yaw += yawRate * dt;

    // Hills: gravity pulls along the slope, but the brakes (or the auto-hold when stopped) win
    const holding = !input.throttle && (input.brake || Math.abs(this.speed) < 0.3) && Math.abs(this.speed) < 1;
    if (holding && !input.brake) this.speed = 0;
    else if (!holding) this.speed -= T.gravity * Math.sin(this.groundPitch) * dt;

    this.position.addScaledVector(this.forward, this.speed * dt);
    this.wheelSpin += (this.speed * dt) / VAN.wheelRadius;
    this.#followGround(dt);

    // --- body lean on a springy suspension ---
    const longAccel = (this.speed - prevSpeed) / dt;
    const latAccel = this.speed * yawRate;
    this.#spring('roll', latAccel * T.rollPerAccel, dt);
    this.#spring('pitch', -longAccel * T.pitchPerAccel, dt);

    if (input.handbrake && absV > 3) this.slip = Math.max(this.slip, Math.min(absV / 15, 1));
    this.#updateDrivetrain(dt, input);
  }

  // Sit the van on the ground: height from the four tire contact points, tilt from their differences.
  #followGround(dt) {
    const fwd = this.forward;
    const lx = Math.cos(this.yaw); // left (+X when facing +Z)
    const lz = -Math.sin(this.yaw);
    const p = this.position;
    const h = (along, side) => this.ground(p.x + fwd.x * along + lx * side, p.z + fwd.z * along + lz * side);
    const t = VAN.trackHalf;
    const fl = h(VAN.frontAxleZ, t);
    const fr = h(VAN.frontAxleZ, -t);
    const rl = h(VAN.rearAxleZ, t);
    const rr = h(VAN.rearAxleZ, -t);
    const pitch = Math.atan2((fl + fr - rl - rr) / 2, VAN.frontAxleZ - VAN.rearAxleZ);
    const roll = Math.atan2((fl + rl - fr - rr) / 2, 2 * t);
    const y = (fl + fr + rl + rr) / 4;
    const k = dt >= 1 ? 1 : 1 - Math.exp(-18 * dt);
    this.groundPitch += (pitch - this.groundPitch) * k;
    this.groundRoll += (roll - this.groundRoll) * k;
    this.position.y += (y - this.position.y) * (dt >= 1 ? 1 : 1 - Math.exp(-40 * dt));
    this.position.y = Math.max(this.position.y, y - 0.03);
  }

  #updateDrivetrain(dt, input) {
    const v = Math.abs(this.speed);
    const pulling = input.throttle && this.speed >= -0.5;
    this.load += ((pulling ? 1 : 0) - this.load) * (1 - Math.exp(-6 * dt));

    let target;
    if (this.speed < -0.3) {
      this.gearIndex = -1;
      target = IDLE_RPM + v * REVERSE_RATIO;
    } else {
      this.gearIndex = Math.max(this.gearIndex, 0);
      const upshiftAt = pulling ? 2700 : 1900;
      while (this.gearIndex < GEAR_RATIOS.length - 1 && v * GEAR_RATIOS[this.gearIndex] > upshiftAt) this.gearIndex++;
      while (this.gearIndex > 0 && v * GEAR_RATIOS[this.gearIndex] < 1100) this.gearIndex--;
      target = Math.max(IDLE_RPM, v * GEAR_RATIOS[this.gearIndex]);
      // torque converter lets the revs flare when pulling away
      if (pulling && v < 3) target = Math.max(target, 1800);
      if (input.handbrake && input.throttle) target = 3400; // revving in place
    }
    this.rpm += (Math.min(target, REDLINE_RPM) - this.rpm) * (1 - Math.exp(-8 * dt));
  }

  #spring(key, target, dt) {
    const T = TUNING;
    const velKey = key + 'Vel';
    const accel = T.suspStiffness * (target - this[key]) - T.suspDamping * this[velKey];
    this[velKey] += accel * dt;
    this[key] += this[velKey] * dt;
  }

  // Push out of solid circles ({x, z, r}); returns the impact speed (m/s), 0 if no hit.
  collide(obstacles) {
    this.impact = 0;
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
      }
    }

    return this.impact;
  }

  // Shove the van `depth` meters along (nx, nz), as if it hit a wall facing that way.
  pushOut(nx, nz, depth) {
    this.position.x += nx * depth;
    this.position.z += nz * depth;
    this.#absorbImpact(nx, nz);
    return this.impact;
  }

  #absorbImpact(nx, nz) {
    const fwd = this.forward;
    const into = -(fwd.x * nx + fwd.z * nz) * Math.sign(this.speed);
    if (into <= 0) return; // sliding away
    this.impact = Math.max(this.impact, into * Math.abs(this.speed));
    if (into > 0.7) {
      this.speed *= -0.25; // near head-on: bounce back
    } else {
      this.speed *= 1 - into * 0.8;
    }
  }
}
