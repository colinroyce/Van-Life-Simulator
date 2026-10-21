import * as THREE from 'three';
import { LAYOUT } from '../van/model.js';
import { BOTTLE } from './bottle.js';
import { KINDS, describeItem } from './kinds.js';
import { Stove, quality } from './stove.js';

export { describeItem };

// Everything about picking things up, carrying them, setting them down and using them.
// An item lives in exactly one place: your hotbar (and hand), a holder, or set down on a surface.

const REACH = 2.3; // meters from the eye (enough to reach the ground outside)
const SIP = 0.125; // fraction of a full bottle per sip: 8 sips per liter
const THIRST_PER_SIP = 10; // percent
const FILL_RATE = 0.45; // bottles per second at the faucet
const USE_TIME = 0.75; // seconds for the raise-to-mouth-and-lower motion
const FLAT_ENOUGH = 0.75; // surface normal's up component needed to set something down
const COCKPIT_AIM = 0.16; // radians off-center that still counts as looking at the dash bottle

const HAND_REST = { pos: new THREE.Vector3(0.24, -0.31, -0.5), rot: new THREE.Euler(0.08, -0.35, 0.06) };
const HAND_USE = { pos: new THREE.Vector3(0.03, -0.12, -0.24), rot: new THREE.Euler(1.15, -0.1, 0.0) };

const HOLDER = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.6, flatShading: true });
const SKIN = new THREE.MeshStandardMaterial({ color: 0xd9a07a, flatShading: true });
const HIT_PROXY = new THREE.MeshBasicMaterial({ visible: false });
const GHOST = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
const STREAM = new THREE.LineBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0.7, depthWrite: false });

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Walks up from a hit object looking for an item, holder, shop or fixture tag.
function tagOf(object) {
  for (let o = object; o; o = o.parent) {
    const { item, holder, fixture, shop } = o.userData;
    if (item || holder || fixture || shop) return { item, holder, fixture, shop };
  }
  return {};
}

function aimable(object) {
  for (let o = object; o; o = o.parent) {
    if (!o.visible || o.userData.noAim) return false;
  }
  return true;
}

export class ItemSystem {
  constructor({ scene, van, player, hotbar, needs, world, audio, notify }) {
    Object.assign(this, { van, player, hotbar, needs, audio, notify });
    this.store = world.store;

    this.loose = new THREE.Group(); // items set down outside the van
    scene.add(this.loose);
    this.aimTargets = [van.root, this.loose, ...world.surfaces];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = REACH;
    this.raycaster.params.Points.threshold = 0.02;
    this.raycaster.params.Line.threshold = 0.01;
    this.target = null;

    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.ghostFor = null;

    // Held items ride in front of the first-person camera
    this.hand = new THREE.Group();
    this.hand.position.copy(HAND_REST.pos);
    this.hand.rotation.copy(HAND_REST.rot);
    this.fist = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.085), SKIN);
    this.fist.position.set(0.042, 0.085, 0.012);
    this.hand.add(this.fist);
    player.camera.add(this.hand);

    this.holders = LAYOUT.holders.map((spec) => this.#buildHolder(spec));
    this.stream = this.#buildStream();
    this.stove = new Stove(van.body, LAYOUT.burner);

    this.filling = null;
    this.using = null; // drinking or eating: { item, t, applied, animate, apply }

    // The bottle starts full in the dash holder.
    this.#putInHolder(this.#newItem('bottle', { water: 1 }), this.holder('dash'));
  }

  holder(id) {
    return this.holders.find((h) => h.id === id);
  }

  get hasUnpaid() {
    return this.hotbar.slots.some((i) => i?.unpaid);
  }

  get faucetRunning() {
    return !!this.filling;
  }

  // ---------------------------------------------------------------------------
  // Aiming and the actions it offers
  // ---------------------------------------------------------------------------
  aim(camera) {
    this.target = null;
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    for (const hit of this.raycaster.intersectObjects(this.aimTargets, true)) {
      if (!aimable(hit.object)) continue;
      this.target = { ...tagOf(hit.object), hit };
      return;
    }
  }

  // { e, g, r }: what each key would do right now.
  actions() {
    const out = {};
    const held = this.hotbar.held;
    if (held?.kind === 'hotdog' && this.#buns()) out.r = { label: 'Put in bun', run: () => this.#putInBun(held) };

    const t = this.target;
    if (!t) return out;
    const item = t.item ?? t.holder?.item;
    const e = this.#primary(t, item, held);
    if (e) out.e = e;

    const normal = t.hit.face && t.hit.face.normal.clone().transformDirection(t.hit.object.matrixWorld);
    if (held && !item && !t.holder && !t.shop && !t.fixture && normal && normal.y > FLAT_ENOUGH) {
      const parent = this.#isInVan(t.hit.object) ? this.van.body : this.loose;
      out.g = { label: 'Place', point: t.hit.point, parent, run: () => this.#setDown(held, t.hit.point, parent) };
    }
    return out;
  }

  #primary(t, item, held) {
    const noop = (label) => ({ label, run: () => {} });

    if (t.shop?.mesh.visible) {
      if (this.hotbar.full) return noop('Hands full');
      const kind = KINDS[t.shop.kind];
      return { label: `Take ${kind.title} ($${t.shop.price})`, run: () => this.#takeFromShelf(t.shop) };
    }
    if (item && item !== held) {
      if (this.hotbar.full) return noop('Hands full');
      return { label: `${t.holder ? 'Take' : 'Pick up'} ${KINDS[item.kind].name(item)}`, run: () => this.#pickUp(item) };
    }
    if (t.holder && held && this.#accepts(t.holder, held)) {
      return { label: `Put ${KINDS[held.kind].name(held)} in ${t.holder.label}`, run: () => this.#putInHolder(held, t.holder) };
    }

    switch (t.fixture) {
      case 'sink':
        if (this.filling) return noop('Filling…');
        if (held?.kind === 'bottle' && held.water < 0.99) return { label: 'Fill water bottle', run: () => (this.filling = held) };
        return null;
      case 'stove': {
        // Taking cooked food off comes first, so it can't burn while you're holding the pack
        const s = this.stove;
        if (s.ready.length) {
          const burnt = s.ready.some((d) => quality(d) === 'burnt');
          return { label: `Take ${plural(s.ready.length, 'hot dog')}${burnt ? ' (burnt)' : ''}`, run: () => this.#takeFromPan() };
        }
        if (held?.kind === 'hotdogs' && held.count > 0 && !s.full) {
          return { label: `Put hot dog in pan${s.cooking ? ` · ${s.status}` : ''}`, run: () => this.#addToPan(held) };
        }
        return s.cooking ? noop(s.status) : null;
      }
      case 'fridge': {
        const b = this.van.buildout;
        return { label: b.fridgeOpen ? 'Close fridge' : 'Open fridge', run: () => b.setFridgeOpen(!b.fridgeOpen) };
      }
      case 'register': {
        const total = this.#unpaidTotal();
        return total ? { label: `Pay $${total}`, run: () => this.#pay(total) } : null;
      }
      case 'hotdogCooler':
      case 'bunShelf': {
        const kind = t.fixture === 'hotdogCooler' ? 'hotdogs' : 'buns';
        if (held?.unpaid && held.kind === kind) return { label: 'Put back', run: () => this.#putBack(held) };
        return null;
      }
      default:
        return null;
    }
  }

  // Looking at the dash bottle from the driver's seat.
  cockpitAction(camera) {
    const item = this.holder('dash').item;
    if (!item || item.kind !== 'bottle' || item.water < 0.01) return null;
    const bottle = item.mesh.group.getWorldPosition(new THREE.Vector3());
    bottle.y += 0.1;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const look = camera.getWorldDirection(new THREE.Vector3());
    const to = bottle.sub(eye);
    if (to.length() > 1.6 || look.angleTo(to) > COCKPIT_AIM) return null;
    return { label: `Drink (${Math.round(item.water * 100)}%)`, run: () => this.#drink(item, false) };
  }

  // Click: use whatever's in your hand.
  useHeld() {
    const held = this.hotbar.held;
    if (!held || this.using) return;
    const kind = KINDS[held.kind];
    if (held.kind === 'bottle') return this.#drink(held, true);
    if (kind.raw) return this.notify('Cook these first');
    if (!kind.hunger) return;
    if (held.unpaid) return this.notify('Pay for it first');
    this.#eat(held);
  }

  // What clicking would do with the held item, for the hint above the hotbar.
  get useHint() {
    const held = this.hotbar.held;
    if (!held) return '';
    if (held.kind === 'bottle') return 'Click to drink';
    return KINDS[held.kind].hunger ? 'Click to eat' : '';
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------
  update(dt, walking) {
    this.hand.visible = walking;
    const held = this.hotbar.held;
    for (const slot of this.hotbar.slots) if (slot) slot.mesh.group.visible = slot === held;
    this.fist.visible = !!held;

    this.stove.update(dt);
    const fridgeOpen = this.van.buildout.fridgeOpen;
    for (const h of this.holders) if (h.fridge) h.proxy.visible = fridgeOpen;

    // Filling at the faucet: keep aiming at the sink with the bottle in hand
    const f = this.filling;
    if (f && (held !== f || this.target?.fixture !== 'sink' || !walking)) this.filling = null;
    if (this.filling) {
      f.water = Math.min(1, f.water + FILL_RATE * dt);
      this.#changed(f);
      if (f.water >= 1) this.filling = null;
    }
    this.stream.visible = !!this.filling;
    if (this.stream.visible) this.#animateStream();

    // Drinking/eating: raise to the mouth, take effect at the top, lower
    const u = this.using;
    if (u) {
      u.t += dt / USE_TIME;
      if (!u.applied && u.t >= 0.5) {
        u.apply();
        u.applied = true;
      }
      if (u.t >= 1) this.using = null;
    }
    const lift = u?.animate ? Math.sin(Math.PI * Math.min(u.t, 1)) : 0;
    this.hand.position.lerpVectors(HAND_REST.pos, HAND_USE.pos, lift);
    this.hand.rotation.set(
      THREE.MathUtils.lerp(HAND_REST.rot.x, HAND_USE.rot.x, lift),
      THREE.MathUtils.lerp(HAND_REST.rot.y, HAND_USE.rot.y, lift),
      THREE.MathUtils.lerp(HAND_REST.rot.z, HAND_USE.rot.z, lift),
    );

    // Ghost preview where G would set the held item down
    const g = walking && !this.using ? this.actions().g : null;
    this.ghost.visible = !!g;
    if (g) {
      if (this.ghostFor !== held) this.#rebuildGhost(held);
      this.ghost.position.copy(g.point);
      g.parent.getWorldQuaternion(this.ghost.quaternion);
    }
  }

  // ---------------------------------------------------------------------------
  // Using items
  // ---------------------------------------------------------------------------
  #drink(item, animate) {
    if (this.using) return;
    if (item.water < 0.01) return this.notify('The bottle is empty');
    this.using = {
      item, t: 0, applied: false, animate,
      apply: () => {
        const amount = Math.min(SIP, item.water);
        item.water -= amount;
        this.needs.values.thirst = Math.min(100, this.needs.values.thirst + (amount / SIP) * THIRST_PER_SIP);
        this.#changed(item);
        this.audio.gulp();
      },
    };
  }

  #eat(item) {
    const gain = KINDS[item.kind].hunger[item.quality ?? 'plain'];
    this.using = {
      item, t: 0, applied: false, animate: true,
      apply: () => {
        this.needs.values.hunger = Math.min(100, this.needs.values.hunger + gain);
        this.audio.chew();
        if (item.quality === 'burnt') this.notify('A bit charred…');
        this.#consume(item, 1);
      },
    };
  }

  // A cooked hot dog plus a bun from your hotbar makes a hot dog in a bun.
  #putInBun(dog) {
    const buns = this.#buns();
    if (!buns) return;
    if (dog.unpaid || buns.unpaid) return this.notify('Pay for it first');
    const stack = this.#stackFor('hotdogInBun', dog.quality);
    const freesSlot = dog.count === 1 || buns.count === 1;
    if (!stack && this.hotbar.full && !freesSlot) return this.notify('Hands full');
    const q = dog.quality;
    this.#consume(buns, 1);
    this.#consume(dog, 1);
    this.#give('hotdogInBun', { quality: q }, 1);
    this.audio.pickup();
  }

  #buns() {
    return this.hotbar.slots.find((i) => i?.kind === 'buns' && i.count > 0);
  }

  // ---------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------
  #takeFromShelf(shop) {
    const kind = KINDS[shop.kind];
    const item = this.#newItem(shop.kind, { unpaid: true, price: shop.price, count: kind.count });
    if (!this.#toHand(item)) return;
    this.store.take(shop);
    this.audio.pickup();
  }

  #putBack(item) {
    this.store.putBack(item.kind);
    this.#discard(item);
    this.audio.pickup();
  }

  #unpaidTotal() {
    return this.hotbar.slots.reduce((sum, i) => sum + (i?.unpaid ? i.price : 0), 0);
  }

  #pay(total) {
    if (this.needs.money < total) return this.notify("You can't afford that");
    this.needs.money -= total;
    for (const i of this.hotbar.slots) if (i) i.unpaid = false;
    this.hotbar.render();
    this.audio.kaching();
    this.notify(`Paid $${total}`);
  }

  // ---------------------------------------------------------------------------
  // Stove
  // ---------------------------------------------------------------------------
  #addToPan(pack) {
    if (!this.stove.add()) return;
    this.#consume(pack, 1);
    this.audio.tap();
  }

  #takeFromPan() {
    const qualities = [...new Set(this.stove.ready.map(quality))];
    const newSlots = qualities.filter((q) => !this.#stackFor('hotdog', q)).length;
    const empty = this.hotbar.slots.filter((s) => !s).length;
    if (newSlots > empty) return this.notify('Hands full');
    const taken = this.stove.takeReady();
    for (const q of qualities) this.#give('hotdog', { quality: q }, taken.filter((d) => quality(d) === q).length);
    this.audio.pickup();
  }

  // ---------------------------------------------------------------------------
  // Moving items between places
  // ---------------------------------------------------------------------------
  #newItem(kind, props = {}) {
    const item = { kind, count: 1, holder: null, ...props };
    item.mesh = KINDS[kind].create(item);
    item.mesh.refresh(item);
    item.mesh.group.userData.item = item;
    return item;
  }

  #stackFor(kind, q) {
    return this.hotbar.slots.find((i) => i?.kind === kind && i.quality === q && !i.unpaid);
  }

  // Adds to a matching stack in the hotbar, or a new item in a free slot.
  #give(kind, props, count) {
    const stack = KINDS[kind].stack && this.#stackFor(kind, props.quality);
    if (stack) {
      stack.count += count;
      this.#changed(stack);
      return true;
    }
    return this.#toHand(this.#newItem(kind, { ...props, count }));
  }

  // Uses up n of a stack; the item disappears when it's gone.
  #consume(item, n) {
    item.count -= n;
    if (item.count <= 0) this.#discard(item);
    else this.#changed(item);
  }

  #discard(item) {
    this.#detach(item);
    if (this.ghostFor === item) this.ghostFor = null;
  }

  #detach(item) {
    if (item.holder) item.holder.item = null;
    item.holder = null;
    this.hotbar.remove(item);
    item.mesh.group.removeFromParent();
  }

  #toHand(item) {
    if (this.hotbar.full) return false;
    this.#detach(item);
    this.hotbar.add(item);
    const g = item.mesh.group;
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(KINDS[item.kind].handScale ?? 1);
    this.hand.add(g);
    return true;
  }

  #pickUp(item) {
    if (this.#toHand(item)) this.audio.pickup();
  }

  #accepts(holder, item) {
    return !holder.item && (holder.accepts === 'any' || item.kind === 'bottle');
  }

  #putInHolder(item, holder) {
    this.#detach(item);
    holder.item = item;
    item.holder = holder;
    const g = item.mesh.group;
    g.position.set(0, 0, 0);
    g.rotation.set(0, holder.fridge ? Math.PI / 2 : Math.random() * Math.PI * 2, 0);
    g.scale.setScalar(1);
    g.visible = true;
    holder.group.add(g);
    this.audio.tap();
  }

  #setDown(item, worldPoint, parent) {
    this.#detach(item);
    const g = item.mesh.group;
    parent.updateMatrixWorld();
    g.position.copy(parent.worldToLocal(worldPoint.clone()));
    g.rotation.set(0, Math.random() * Math.PI * 2, 0);
    g.scale.setScalar(1);
    g.visible = true;
    parent.add(g);
    this.audio.tap();
  }

  #changed(item) {
    item.mesh.refresh(item);
    this.hotbar.render();
  }

  #isInVan(object) {
    for (let o = object; o; o = o.parent) if (o === this.van.root) return true;
    return false;
  }

  // Translucent copy of the held item for the placement preview. Built by hand rather than with
  // clone(), which would try to serialize the item hanging off userData.
  #rebuildGhost(item) {
    const copy = (src) => {
      const o = src.isMesh ? new THREE.Mesh(src.geometry, GHOST) : new THREE.Group();
      o.position.copy(src.position);
      o.quaternion.copy(src.quaternion);
      o.scale.copy(src.scale);
      o.visible = src.visible;
      o.userData.noAim = true;
      for (const child of src.children) o.add(copy(child));
      return o;
    };
    const ghost = copy(item.mesh.group);
    ghost.position.set(0, 0, 0);
    ghost.quaternion.identity();
    ghost.visible = true;
    this.ghost.clear();
    this.ghost.add(ghost);
    this.ghostFor = item;
  }

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------
  // Black ring holder ('dash', 'counter' or 'wall' mount) or a bare spot ('none', e.g. in the fridge).
  #buildHolder(spec) {
    const holder = { ...spec, item: null };
    const g = new THREE.Group();
    g.position.copy(spec.at);
    g.userData.holder = holder;
    const r = BOTTLE.radius;
    if (spec.mount !== 'none') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.007, 0.006, 6, 18), HOLDER);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.008, 18), HOLDER);
      base.position.y = -0.004;
      g.add(ring, base);
      for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.008), HOLDER);
        strut.position.set(Math.sin(a) * (r + 0.007), 0.03, Math.cos(a) * (r + 0.007));
        g.add(strut);
      }
    }
    if (spec.mount === 'wall') {
      // Back plate against the wall on the given side (+x or +z)
      const alongX = spec.wall === '+x';
      const plate = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.008 : 0.1, 0.1, alongX ? 0.1 : 0.008), HOLDER);
      plate.position.set(alongX ? r + 0.012 : 0, 0.03, alongX ? 0 : r + 0.012);
      g.add(plate);
    }
    // Generous invisible target so the spot is easy to aim at
    const [pr, ph] = spec.fridge ? [0.1, 0.16] : [0.07, 0.22];
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, ph, 8), HIT_PROXY);
    proxy.position.y = ph / 2;
    g.add(proxy);
    this.van.body.add(g);
    holder.group = g;
    holder.proxy = proxy;
    return holder;
  }

  // Water falling from the faucet into the sink while you fill up.
  #buildStream() {
    this.streamDrops = Array.from({ length: 14 }, () => Math.random());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 6), 3));
    const lines = new THREE.LineSegments(geo, STREAM);
    lines.frustumCulled = false;
    lines.userData.noAim = true;
    lines.position.copy(LAYOUT.faucetTip);
    lines.visible = false;
    this.van.body.add(lines);
    return lines;
  }

  #animateStream() {
    const pos = this.stream.geometry.attributes.position;
    const drop = LAYOUT.faucetTip.y - 1.6;
    this.streamDrops.forEach((t, i) => {
      const next = (t + 0.08) % 1;
      this.streamDrops[i] = next;
      const x = Math.sin(i * 2.3) * 0.006;
      const z = Math.cos(i * 1.7) * 0.006;
      pos.setXYZ(i * 2, x, -next * drop, z);
      pos.setXYZ(i * 2 + 1, x, -Math.min(next * drop + 0.05, drop), z);
    });
    pos.needsUpdate = true;
  }
}
