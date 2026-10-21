import * as THREE from 'three';
import { VanModel } from './van/model.js';
import { VanSim } from './van/physics.js';
import { World, BOUNDS, SPAWN, createEnvironment } from './world.js';
import { CameraRig } from './cameras.js';
import { readDriveInput, readWalkInput, takeMouseDelta, isPointerLocked, onKey, onLockedClick, onScroll } from './input.js';
import { Player } from './player.js';
import { GameAudio } from './audio/sound.js';
import { Needs, NEEDS, needColor } from './needs.js';
import { GameClock, GAME_MINUTES_PER_SECOND } from './clock.js';
import { SleepWheel } from './ui/sleepWheel.js';
import { createFuelGauge } from './ui/fuelGauge.js';
import { fade, fadeThrough, setCaption } from './ui/fade.js';
import { HygieneThoughts } from './ui/thoughts.js';
import { Hotbar } from './items/hotbar.js';
import { ItemSystem, describeItem } from './items/items.js';
import { Fueling } from './items/fueling.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd8ecf5, 120, 650);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5f7f45, 1.3));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
const SUN_DIR = new THREE.Vector3(40, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const world = new World(scene);
const van = new VanModel();
van.setEnvironment(createEnvironment(renderer));
scene.add(van.root);
const sim = new VanSim();
const cameras = new CameraRig(van);
const player = new Player(window.innerWidth / window.innerHeight);
const audio = new GameAudio();
const needs = new Needs();
const clock = new GameClock(8);
const sleepWheel = new SleepWheel(document.getElementById('sleep-wheel'));
scene.add(player.camera); // so things held in front of it render
const hotbar = new Hotbar(document.getElementById('hotbar'), describeItem, 6);
const items = new ItemSystem({ scene, van, player, hotbar, needs, world, audio, notify: (t) => flashCamLabel(t) });
const fueling = new Fueling({ scene, station: world.fuelStation, van, items, needs, audio, notify: (t) => flashCamLabel(t) });
// Pump, fuel door and driver door are handled here rather than by the item system
items.extraAction = (fixture) => {
  if (fixture === 'driverDoor') {
    if (!van.driverDoorOpen) return { label: 'Open driver door', run: () => van.setDriverDoorOpen(true) };
    return { label: 'Get in', run: () => sitDown(), alt: { key: 'Q', label: 'Close door', run: () => van.setDriverDoorOpen(false) } };
  }
  return fueling.action(fixture);
};

// 'drive': in the driver's seat. 'walk': on foot, first person.
let mode = 'drive';

if (import.meta.env.DEV) window.__game = { scene, world, van, sim, cameras, player, audio, needs, clock, sleepWheel, fade, hotbar, items, fueling, get mode() { return mode; } };

function reset() {
  sim.reset(SPAWN.position, SPAWN.yaw);
  world.resetCones();
  van.sync(sim);
  cameras.snap(sim);
}
reset();

// --- HUD ---
const hud = {
  speed: document.getElementById('speed'),
  gear: document.getElementById('gear'),
  gauge: document.getElementById('gauge'),
  help: document.getElementById('help'),
  helpDrive: document.getElementById('help-drive'),
  helpWalk: document.getElementById('help-walk'),
  cam: document.getElementById('cam-label'),
  prompt: document.getElementById('prompt'),
  crosshair: document.getElementById('crosshair'),
  hotbar: document.getElementById('hotbar'),
  heldHint: document.getElementById('held-hint'),
  lookHint: document.getElementById('look-hint'),
};
// One bar per scarcity meter, bottom left (fuel has its own gauge)
const needBars = NEEDS.filter((n) => !n.gauge).map((n) => {
  const row = document.createElement('div');
  row.className = 'need';
  row.innerHTML = `<span>${n.label}</span><div class="need-track"><div class="need-fill"></div></div><span class="need-value"></span>`;
  document.getElementById('needs').appendChild(row);
  return { key: n.key, fill: row.querySelector('.need-fill'), value: row.querySelector('.need-value') };
});

const moneyLabel = document.getElementById('money');
const clockLabel = document.getElementById('clock');
const setFuelGauge = createFuelGauge(document.getElementById('fuel-gauge'));

function renderNeeds() {
  moneyLabel.textContent = `$${needs.money.toLocaleString('en-US')}`;
  clockLabel.textContent = clock.label();
  setFuelGauge(needs.values.fuel);
  for (const bar of needBars) {
    const v = needs.values[bar.key];
    bar.fill.style.width = `${v}%`;
    bar.fill.style.background = needColor(v);
    bar.value.textContent = `${Math.ceil(v)}%`;
  }
}

let camLabelTimer;
function flashCamLabel(text) {
  hud.cam.textContent = text;
  hud.cam.classList.add('show');
  clearTimeout(camLabelTimer);
  camLabelTimer = setTimeout(() => hud.cam.classList.remove('show'), 1200);
}

function setMode(next) {
  mode = next;
  const walking = mode === 'walk';
  hud.gauge.hidden = walking;
  hud.hotbar.hidden = !walking;
  hud.helpDrive.hidden = walking;
  hud.helpWalk.hidden = !walking;
  if (!walking && isPointerLocked()) document.exitPointerLock();
}

function getUp() {
  if (Math.abs(sim.speed) > 0.5) {
    flashCamLabel('Stop the van to get up');
    return;
  }
  sim.speed = 0;
  player.standUp(van);
  van.setOccupant('empty');
  setMode('walk');
}

// Looking out the driver's window from the seat (and stopped) lets you get out that side.
const LOOKING_AT_DOOR = 0.75; // head turned left, radians

function canGetOutDriverSide() {
  return cameras.mode === 'cockpit' && cameras.look.yaw > LOOKING_AT_DOOR && Math.abs(sim.speed) <= 0.5;
}

function getOutDriverSide() {
  sim.speed = 0;
  van.setDriverDoorOpen(true);
  van.driverDoorT = 1; // already swung open as you step out, so it doesn't sweep you aside
  player.standOutside(van, new THREE.Vector3(1.55, 0, 1.0), Math.PI / 2);
  van.setOccupant('empty');
  cameras.resetLook();
  setMode('walk');
}

function sitDown() {
  cameras.resetLook();
  fueling.release();
  van.setDoorOpen(false);
  van.setDriverDoorOpen(false);
  van.setOccupant(cameras.mode);
  setMode('drive');
}

const busy = () => fade.active || sleepWheel.isOpen;

function openSleepWheel() {
  if (isPointerLocked()) document.exitPointerLock();
  sleepWheel.open(clock.minutes, (h) => needs.previewSleep(h), needs.values);
}

// Fade out, let the hours tick by on the clock, wake up with the meters updated.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function sleep(hours) {
  sleepWheel.close();
  sleepFor(hours, `You slept ${plural(hours, 'hour')}`);
}

// Collapsing from exhaustion: out cold until energy is back to half.
const PASS_OUT_WAKE_ENERGY = 50;

function passOut() {
  if (sleepWheel.isOpen) sleepWheel.close();
  sim.speed = 0;
  const hours = Math.ceil(needs.hoursToReach(PASS_OUT_WAKE_ENERGY));
  setCaption('You passed out from exhaustion…');
  sleepFor(hours, `You passed out for ${plural(hours, 'hour')}`, 'You passed out…');
}

// Fade out, let the hours tick by on the clock, wake up with the meters updated.
function sleepFor(hours, wakeText, sleepingText = 'Zzz…') {
  const from = clock.minutes;
  fadeThrough({
    out: 900,
    back: 1100,
    text: wakeText,
    onBlack: async () => {
      const steps = 40;
      for (let i = 1; i <= steps; i++) {
        clock.minutes = from + (hours * 60 * i) / steps;
        setCaption(`${sleepingText}  ${clock.label()}`);
        await new Promise((r) => setTimeout(r, 40));
      }
      needs.sleep(hours);
    },
  });
}

function takeShower() {
  van.setShower(true);
  fadeThrough({
    out: 900,
    hold: 1400,
    text: "You're squeaky clean!",
    onBlack: () => {
      clock.advance(15);
      needs.shower();
      van.setShower(false);
    },
  });
}

onKey('KeyE', () => {
  if (fade.active) return;
  if (sleepWheel.isOpen) return sleep(sleepWheel.hours);
  if (mode === 'drive') {
    const drink = cameras.mode === 'cockpit' && items.cockpitAction(cameras.cockpit);
    if (drink) return drink.run();
    return canGetOutDriverSide() ? getOutDriverSide() : getUp();
  }
  const itemAction = items.actions().e;
  if (itemAction) return itemAction.run();
  const action = player.interaction(van)?.action;
  if (action === 'drive') sitDown();
  if (action === 'door') van.setDoorOpen(!van.doorOpen);
  if (action === 'lights') van.setLights(!van.lightsOn);
  if (action === 'bathDoor') van.setBathDoorOpen(!van.bathDoorOpen);
  if (action === 'shower') takeShower();
  if (action === 'flush') audio.flush();
  if (action === 'lie') player.lieDown(van);
  if (action === 'sleep') openSleepWheel();
});
onKey('KeyQ', () => {
  if (busy() || mode !== 'walk') return;
  if (player.lying) return player.getOutOfBed(van);
  items.actions().e?.alt?.run();
});
onKey('Escape', () => sleepWheel.isOpen && sleepWheel.close());
for (const [code, delta] of [['KeyA', -1], ['ArrowLeft', -1], ['KeyD', 1], ['ArrowRight', 1]]) {
  onKey(code, () => sleepWheel.isOpen && sleepWheel.adjust(delta));
}
onKey('KeyG', () => {
  if (mode === 'walk' && !busy()) items.actions().g?.run();
});
for (let i = 0; i < hotbar.slots.length; i++) onKey(`Digit${i + 1}`, () => mode === 'walk' && hotbar.select(i));
onKey('KeyR', () => {
  if (mode === 'drive') return reset();
  if (!busy()) items.actions().r?.run();
});
onScroll((dir) => {
  if (mode === 'walk' && !busy()) hotbar.select(hotbar.selected + dir);
});
onLockedClick(() => {
  if (mode === 'walk' && !busy()) items.useHeld();
});
onKey('KeyC', () => {
  if (mode !== 'drive') return;
  const cockpit = cameras.toggle() === 'cockpit';
  if (!cockpit && isPointerLocked()) document.exitPointerLock();
  van.setOccupant(cameras.mode);
  flashCamLabel(cockpit ? 'Driver view' : 'Chase camera');
});
onKey('Slash', () => (hud.help.hidden = !hud.help.hidden));
onKey('KeyM', () => flashCamLabel(audio.toggleMute() ? 'Sound off' : 'Sound on'));

// Audio can only start after the player interacts with the page.
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, () => audio.unlock());

// Click to capture the mouse: on foot, or to look around from the driver's seat.
renderer.domElement.addEventListener('click', () => {
  const canLook = mode === 'walk' || cameras.mode === 'cockpit';
  if (canLook && !isPointerLocked()) renderer.domElement.requestPointerLock();
});

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  cameras.resize(aspect);
  player.camera.aspect = aspect;
  player.camera.updateProjectionMatrix();
});

// --- running on empty ---
const hygieneThoughts = new HygieneThoughts();
let wasRunning = false;
let noFuelNotice = 0;
let blurPx = 0;

function showConsequences() {
  // Exhaustion: the world blurs below 10% energy, and at 0% you pass out
  const energy = needs.values.energy;
  const blur = energy < 10 ? Math.round((1 - energy / 10) * 40) / 10 : 0; // up to 4px
  if (blur !== blurPx) {
    renderer.domElement.style.filter = blur ? `blur(${blur}px)` : '';
    blurPx = blur;
  }
  if (energy <= 0 && !busy()) passOut();

  hygieneThoughts.update(needs.values.hygiene);
}

// --- loop ---
const frameClock = new THREE.Clock();
const STEP = 1 / 120;
let acc = 0;

function tick(dt) {
  const mouse = takeMouseDelta();
  const driveInput = readDriveInput();
  let impact = 0;
  let coneHit = 0;

  // Out of fuel the engine dies: no power (forward or reverse), but you can still coast and brake.
  const engineRunning = mode === 'drive' && needs.values.fuel > 0;
  const coasting = { ...driveInput, throttle: 0, brake: sim.speed > 0.5 ? driveInput.brake : 0 };
  if (mode === 'drive' && !engineRunning && wasRunning) flashCamLabel("You're out of fuel. The engine died.");
  wasRunning = engineRunning;
  noFuelNotice -= dt;
  if (mode === 'drive' && !engineRunning && driveInput.throttle && noFuelNotice <= 0) {
    flashCamLabel('No fuel. Get to a gas pump.');
    noFuelNotice = 3;
  }

  if (mode === 'drive') {
    acc += dt;
    while (acc >= STEP) {
      sim.update(STEP, engineRunning ? driveInput : coasting);
      impact = Math.max(impact, sim.collide(world.obstacles, BOUNDS));
      coneHit = Math.max(coneHit, world.update(STEP, sim));
      acc -= STEP;
    }
  }

  van.update(dt);
  van.sync(sim);

  let camera;
  let focus;
  if (mode === 'drive') {
    cameras.update(dt, sim);
    const cockpit = cameras.mode === 'cockpit';
    if (cockpit) cameras.lookAround(isPointerLocked() ? mouse : { x: 0, y: 0 }, dt, sim.speed);
    camera = cameras.active;
    focus = sim.position;
    hud.speed.textContent = Math.round(Math.abs(sim.speed) * 2.23694);
    hud.gear.textContent = sim.gear;
    const drink = cockpit && items.cockpitAction(cameras.cockpit);
    const stopped = Math.abs(sim.speed) <= 0.5;
    hud.prompt.hidden = !drink && !stopped;
    const getUpLabel = canGetOutDriverSide() ? 'Get out' : 'Get up';
    hud.prompt.innerHTML = `<kbd>E</kbd> ${drink ? drink.label : getUpLabel}`;
    hud.crosshair.hidden = !(cockpit && isPointerLocked());
    hud.heldHint.textContent = '';
    hud.lookHint.hidden = true;
    items.update(dt, false);
    fueling.update(dt, player.position);
    van.setFuelDoorHighlight(false);
  } else {
    const still = { forward: 0, strafe: 0, turn: 0, run: false };
    player.update(dt, busy() ? still : readWalkInput(), busy() ? { x: 0, y: 0 } : mouse, van, world, BOUNDS);
    camera = player.camera;
    focus = player.position;
    items.aim(player.camera);
    items.update(dt, true);
    fueling.update(dt, player.position);
    van.setFuelDoorHighlight(items.target?.fixture === 'fuelDoor' && !busy(), clock.minutes);
    const { e: itemAction, g: placeAction, r: combineAction } = items.actions();
    const it = itemAction ?? player.interaction(van);
    const parts = [];
    if (it) parts.push(`<kbd>E</kbd> ${it.label}`);
    if (it?.alt) parts.push(`<kbd>${it.alt.key}</kbd> ${it.alt.label}`);
    if (placeAction) parts.push(`<kbd>G</kbd> ${placeAction.label}`);
    if (combineAction) parts.push(`<kbd>R</kbd> ${combineAction.label}`);
    hud.prompt.hidden = !parts.length || busy();
    hud.prompt.innerHTML = parts.join(' &nbsp; ');
    const held = hotbar.held;
    if (fueling.inHand) hud.heldHint.textContent = 'Fuel nozzle · E at the van\'s fuel door';
    else hud.heldHint.textContent = held ? [describeItem(held).name, items.useHint].filter(Boolean).join(' · ') : '';
    hud.crosshair.hidden = false;
    hud.lookHint.hidden = isPointerLocked() || busy();
  }

  const walking = mode === 'walk';
  world.store.update(dt, walking ? player.position : sim.position, items.hasUnpaid, flashCamLabel);
  if (!sleepWheel.isOpen) {
    const gameMinutes = dt * GAME_MINUTES_PER_SECOND;
    clock.advance(gameMinutes);
    needs.update(gameMinutes / 60, { engineOn: engineRunning, speed: sim.speed });
  }
  renderNeeds();
  showConsequences();

  audio.update(dt, {
    listener: walking ? (player.inside ? 'inside' : 'outside') : cameras.mode,
    engineOn: engineRunning,
    rpm: sim.rpm,
    load: sim.load,
    speed: sim.speed,
    slip: sim.slip,
    vanSurface: world.surfaceAt(sim.position.x, sim.position.z),
    horn: !walking && driveInput.horn,
    impact,
    coneHit,
    doorOpen: van.doorOpen,
    doorT: van.doorT,
    lightsOn: van.lightsOn,
    showerOn: van.showerOn,
    bathDoorOpen: van.bathDoorOpen,
    faucetOn: items.faucetRunning,
    sizzle: items.stove.sizzle,
    burning: items.stove.burning,
    fridgeOpen: van.buildout.fridgeOpen,
    driverDoorOpen: van.driverDoorOpen,
    fuelDoorOpen: van.fuelDoorOpen,
    pumping: fueling.pumping,
    lying: player.lying,
    walking,
    inside: player.inside,
    moved: walking ? player.moved : 0,
    running: player.running,
    footSurface: player.inside ? 'van' : world.surfaceAt(player.position.x, player.position.z),
  });

  sun.target.position.copy(focus);
  sun.position.copy(focus).add(SUN_DIR);

  renderer.render(scene, camera);
}

function frame() {
  tick(Math.min(frameClock.getDelta(), 0.1));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev hook: advance the game by hand (animation frames pause when the tab is hidden).
if (import.meta.env.DEV) {
  window.__game.advance = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds; t += dt) tick(dt);
  };
}
