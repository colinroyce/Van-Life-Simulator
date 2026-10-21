import * as THREE from 'three';
import { LAYOUT } from '../van/model.js';
import { PRICE_PER_GALLON } from '../places/fuelStation.js';

// The pump's nozzle and hose. The nozzle is on the pump, in your hand, or in the van's filler.
// While it's in the van fuel flows, the gauge rises and the sale is charged as it goes.

export const TANK_GALLONS = 25;
const FLOW = 0.8; // gallons per second
const HOSE = 4.5; // meters of hose

const DARK = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.5, flatShading: true });
const STEEL = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.6, roughness: 0.35, flatShading: true });
const HOSE_MAT = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6 });

// Pistol-grip nozzle; origin at the spout tip, pointing along -Z.
function buildNozzle() {
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), DARK);
  grip.position.set(0, -0.06, 0.2);
  grip.rotation.x = -0.35;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), DARK);
  body.position.set(0, 0, 0.13);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), STEEL);
  spout.rotation.x = Math.PI / 2;
  spout.position.set(0, 0, 0.03);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 4, 10, Math.PI), STEEL);
  guard.position.set(0, -0.04, 0.15);
  guard.rotation.y = Math.PI / 2;
  g.add(grip, body, spout, guard);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class Fueling {
  constructor({ scene, station, van, items, needs, audio, notify }) {
    Object.assign(this, { station, van, items, needs, audio, notify });
    this.nozzle = buildNozzle();
    this.where = 'pump'; // 'pump' | 'hand' | 'van'
    this.pumping = false;
    this.sale = { gallons: 0, dollars: 0 };
    this.#hangUp();

    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), HOSE_MAT);
    this.hose.castShadow = true;
    this.hose.userData.noAim = true;
    this.hose.frustumCulled = false;
    scene.add(this.hose);
  }

  get inHand() {
    return this.where === 'hand';
  }

  // E action for the pump or the van's fuel door, or null.
  action(fixture) {
    const van = this.van;
    if (fixture === 'pump') {
      if (this.where === 'pump') return { label: `Take nozzle ($${PRICE_PER_GALLON}/gal)`, run: () => this.#take() };
      if (this.where === 'hand') return { label: 'Hang up nozzle', run: () => this.#hangUp(true) };
      return null;
    }
    if (fixture !== 'fuelDoor') return null;
    if (this.where === 'van') {
      if (this.pumping) return { label: `Stop pumping · $${this.sale.dollars.toFixed(2)}`, run: () => this.#stop() };
      return { label: 'Remove nozzle', run: () => this.#take() };
    }
    if (!van.fuelDoorOpen) return { label: 'Open fuel door', run: () => van.setFuelDoorOpen(true) };
    if (this.where === 'hand') {
      if (this.needs.values.fuel >= 99.5) return { label: 'Tank is full', run: () => {} };
      return { label: 'Insert nozzle', run: () => this.#insert() };
    }
    return { label: 'Close fuel door', run: () => van.setFuelDoorOpen(false) };
  }

  // Sitting down with the nozzle in your hand puts it back. (Left in the van it keeps pumping,
  // and pops out if you drive off.)
  release() {
    if (this.where === 'hand') this.#hangUp(true);
  }

  update(dt, playerPos) {
    const outlet = this.station.worldPoint(this.station.hoseOut);

    if (this.where === 'hand' && playerPos.distanceTo(outlet) > HOSE + 0.6) {
      this.#hangUp();
      this.notify("The hose won't reach that far");
    }
    if (this.where === 'van') {
      const neck = this.van.body.localToWorld(LAYOUT.fuelNeck.clone());
      if (neck.distanceTo(outlet) > HOSE + 0.3) {
        this.#hangUp();
        this.notify('The nozzle popped out');
      }
    }

    if (this.pumping) {
      const room = ((100 - this.needs.values.fuel) / 100) * TANK_GALLONS;
      const affordable = this.needs.money / PRICE_PER_GALLON;
      const gallons = Math.min(FLOW * dt, room, affordable);
      this.sale.gallons += gallons;
      this.sale.dollars += gallons * PRICE_PER_GALLON;
      this.needs.values.fuel = Math.min(100, this.needs.values.fuel + (gallons / TANK_GALLONS) * 100);
      this.needs.money = Math.max(0, this.needs.money - gallons * PRICE_PER_GALLON);
      this.station.showSale(this.sale.gallons, this.sale.dollars);
      if (room - gallons <= 0.001) this.#stop('Tank is full');
      else if (affordable - gallons <= 0.001) this.#stop("You're out of money");
    }

    this.#drawHose(outlet);
  }

  // ---------------------------------------------------------------------------
  #take() {
    this.#stop();
    this.where = 'hand';
    this.nozzle.position.set(0.02, 0.1, -0.05);
    this.nozzle.rotation.set(0, 0, 0);
    this.items.hand.add(this.nozzle);
    this.items.handOverride = true;
    this.audio.pickup();
  }

  #hangUp(sound = false) {
    this.#stop();
    this.where = 'pump';
    this.nozzle.position.copy(this.station.holster);
    this.nozzle.rotation.set(-Math.PI / 2, 0, 0); // spout down
    this.station.pump.add(this.nozzle);
    this.items.handOverride = false;
    if (sound) this.audio.tap();
  }

  #insert() {
    this.where = 'van';
    const n = LAYOUT.fuelNeck;
    this.nozzle.position.set(n.x + 0.005, n.y + 0.01, n.z);
    this.nozzle.rotation.set(0, Math.PI / 2, 0); // spout points into the van, body sticks out
    this.nozzle.rotateX(-0.4); // tipped down into the neck
    this.van.body.add(this.nozzle);
    this.items.handOverride = false;
    this.sale = { gallons: 0, dollars: 0 };
    this.station.showSale(0, 0);
    this.pumping = true;
    this.audio.tap();
  }

  #stop(message) {
    if (!this.pumping) return;
    this.pumping = false;
    this.needs.money = Math.round(this.needs.money * 100) / 100;
    this.notify(message ? `${message} · $${this.sale.dollars.toFixed(2)}` : `Pumped ${this.sale.gallons.toFixed(1)} gal · $${this.sale.dollars.toFixed(2)}`);
  }

  // Hose sags between the pump and wherever the nozzle is.
  #drawHose(outlet) {
    const end = this.nozzle.localToWorld(new THREE.Vector3(0, 0, 0.21));
    const span = outlet.distanceTo(end);
    const sag = Math.max(0.15, (HOSE - span) * 0.45);
    const lowest = Math.min(outlet.y, end.y);
    const points = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const p = outlet.clone().lerp(end, t);
      p.y = Math.max(0.05, p.y - Math.min(sag, lowest - 0.05) * 4 * t * (1 - t));
      points.push(p);
    }
    this.hose.geometry.dispose();
    this.hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.016, 6, false);
  }
}
