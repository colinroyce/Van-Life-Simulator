import * as THREE from 'three';
import { VAN } from './van/model.js';

const CHASE_OFFSET = new THREE.Vector3(0, 3.4, -8.5);

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class CameraRig {
  constructor(van) {
    const aspect = window.innerWidth / window.innerHeight;

    this.chase = new THREE.PerspectiveCamera(62, aspect, 0.1, 3000);
    this.chaseYaw = 0;

    this.cockpit = new THREE.PerspectiveCamera(72, aspect, 0.03, 3000);
    this.cockpit.position.copy(VAN.eye);
    this.cockpit.rotation.set(-0.12, Math.PI, 0, 'YXZ');
    van.body.add(this.cockpit);

    this.mode = 'chase';
  }

  get active() {
    return this.mode === 'chase' ? this.chase : this.cockpit;
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    return this.mode;
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

    const look = sim.position.clone();
    look.y += 1.6;
    look.x += Math.sin(this.chaseYaw) * 3;
    look.z += Math.cos(this.chaseYaw) * 3;
    this.chase.lookAt(look);
  }
}
