import * as THREE from 'three';
import { VanModel } from './van/model.js';
import { VanSim } from './van/physics.js';
import { World, BOUNDS, SPAWN, createEnvironment } from './world.js';
import { CameraRig } from './cameras.js';
import { readDriveInput, readWalkInput, takeMouseDelta, isPointerLocked, onKey } from './input.js';
import { Player } from './player.js';
import { GameAudio } from './audio/sound.js';

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

// 'drive': in the driver's seat. 'walk': on foot, first person.
let mode = 'drive';

if (import.meta.env.DEV) window.__game = { scene, world, van, sim, cameras, player, audio, get mode() { return mode; } };

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
  lookHint: document.getElementById('look-hint'),
};
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
  hud.crosshair.hidden = !walking;
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

function sitDown() {
  van.setDoorOpen(false);
  van.setOccupant(cameras.mode);
  setMode('drive');
}

onKey('KeyE', () => {
  if (mode === 'drive') return getUp();
  const action = player.interaction(van)?.action;
  if (action === 'drive') sitDown();
  if (action === 'door') van.setDoorOpen(!van.doorOpen);
  if (action === 'lights') van.setLights(!van.lightsOn);
  if (action === 'bathDoor') van.setBathDoorOpen(!van.bathDoorOpen);
  if (action === 'shower') van.setShower(!van.showerOn);
  if (action === 'flush') audio.flush();
  if (action === 'lie') player.lieDown(van);
  if (action === 'getup') player.getOutOfBed(van);
});
onKey('KeyC', () => {
  if (mode !== 'drive') return;
  const cockpit = cameras.toggle() === 'cockpit';
  van.setOccupant(cameras.mode);
  flashCamLabel(cockpit ? 'Driver view' : 'Chase camera');
});
onKey('KeyR', () => mode === 'drive' && reset());
onKey('Slash', () => (hud.help.hidden = !hud.help.hidden));
onKey('KeyM', () => flashCamLabel(audio.toggleMute() ? 'Sound off' : 'Sound on'));

// Audio can only start after the player interacts with the page.
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, () => audio.unlock());

renderer.domElement.addEventListener('click', () => {
  if (mode === 'walk' && !isPointerLocked()) renderer.domElement.requestPointerLock();
});

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  cameras.resize(aspect);
  player.camera.aspect = aspect;
  player.camera.updateProjectionMatrix();
});

// --- loop ---
const clock = new THREE.Clock();
const STEP = 1 / 120;
let acc = 0;

function tick(dt) {
  const mouse = takeMouseDelta();
  const driveInput = readDriveInput();
  let impact = 0;
  let coneHit = 0;

  if (mode === 'drive') {
    acc += dt;
    while (acc >= STEP) {
      sim.update(STEP, driveInput);
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
    camera = cameras.active;
    focus = sim.position;
    hud.speed.textContent = Math.round(Math.abs(sim.speed) * 2.23694);
    hud.gear.textContent = sim.gear;
    hud.prompt.hidden = Math.abs(sim.speed) > 0.5;
    hud.prompt.innerHTML = '<kbd>E</kbd> Get up';
    hud.lookHint.hidden = true;
  } else {
    player.update(dt, readWalkInput(), mouse, van, world, BOUNDS);
    camera = player.camera;
    focus = player.position;
    const it = player.interaction(van);
    hud.prompt.hidden = !it;
    if (it) hud.prompt.innerHTML = `<kbd>E</kbd> ${it.label}`;
    hud.lookHint.hidden = isPointerLocked();
  }

  const walking = mode === 'walk';
  audio.update(dt, {
    listener: walking ? (player.inside ? 'inside' : 'outside') : cameras.mode,
    engineOn: !walking,
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
  tick(Math.min(clock.getDelta(), 0.1));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev hook: advance the game by hand (animation frames pause when the tab is hidden).
if (import.meta.env.DEV) {
  window.__game.advance = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds; t += dt) tick(dt);
  };
}
