import * as THREE from 'three';
import { VAN } from './van/model.js';

const CHASE_OFFSET = new THREE.Vector3(0, 3.4, -8.5);
const COCKPIT_PITCH = -0.12; // resting head tilt
const LOOK_SENSITIVITY = 0.0022;
const LOOK_LIMITS = { yaw: 2.3, pitchDown: -0.9, pitchUp: 0.7 };

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class CameraRig {
  constructor(van) {
    const aspect = window.innerWidth / window.innerHeight;

    this.chase = new THREE.PerspectiveCamera(62, aspect, 0.1, 9000);
    this.chaseYaw = 0;

    this.cockpit = new THREE.PerspectiveCamera(72, aspect, 0.03, 9000);
    this.cockpit.position.copy(VAN.eye);
    this.cockpit.rotation.set(COCKPIT_PITCH, Math.PI, 0, 'YXZ');
    van.body.add(this.cockpit);
    this.look = { yaw: 0, pitch: 0, idle: 0 }; // head swivel in the driver's seat

    this.mode = 'chase';
    this.ground = () => -Infinity; // keeps the chase camera above hillsides
  }

  get active() {
    return this.mode === 'chase' ? this.chase : this.cockpit;
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    return this.mode;
  }

  resetLook() {
    Object.assign(this.look, { yaw: 0, pitch: 0, idle: 0 });
    this.#applyLook();
  }

  // Mouse turns the driver's head; it drifts back to the road when you stop looking around
  // while the van is moving.
  lookAround(mouse, dt, speed) {
    const L = this.look;
    if (mouse.x || mouse.y) {
      L.yaw = THREE.MathUtils.clamp(L.yaw - mouse.x * LOOK_SENSITIVITY, -LOOK_LIMITS.yaw, LOOK_LIMITS.yaw);
      L.pitch = THREE.MathUtils.clamp(L.pitch - mouse.y * LOOK_SENSITIVITY, LOOK_LIMITS.pitchDown, LOOK_LIMITS.pitchUp);
      L.idle = 0;
    } else {
      L.idle += dt;
    }
    if (L.idle > 1.2 && Math.abs(speed) > 3) {
      const k = 1 - Math.exp(-2.5 * dt);
      L.yaw -= L.yaw * k;
      L.pitch -= L.pitch * k;
    }
    this.#applyLook();
  }

  #applyLook() {
    this.cockpit.rotation.set(COCKPIT_PITCH + this.look.pitch, Math.PI + this.look.yaw, 0, 'YXZ');
  }

  snap(sim) {
    this.chaseYaw = sim.yaw;
    this.#placeChase(sim, 1);
  }

  resize(aspect) {
    for (const cam of [this.chase, this.cockpit]) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }

  update(dt, sim) {
    // Heading lags behind the van so turns swing the camera out a little.
    this.chaseYaw += wrapAngle(sim.yaw - this.chaseYaw) * (1 - Math.exp(-3 * dt));
    this.#placeChase(sim, 1 - Math.exp(-10 * dt));

    const fov = 62 + Math.min(Math.abs(sim.speed), 31) * 0.35;
    if (Math.abs(this.chase.fov - fov) > 0.01) {
      this.chase.fov = fov;
      this.chase.updateProjectionMatrix();
    }
  }

  #placeChase(sim, t) {
    const offset = CHASE_OFFSET.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.chaseYaw);
    const target = sim.position.clone().add(offset);
    this.chase.position.lerp(target, t);
    const floor = this.ground(this.chase.position.x, this.chase.position.z) + 1.2;
    if (this.chase.position.y < floor) this.chase.position.y = floor;

    const look = sim.position.clone();
    look.y += 1.6;
    look.x += Math.sin(this.chaseYaw) * 3;
    look.z += Math.cos(this.chaseYaw) * 3;
    this.chase.lookAt(look);
  }
}
