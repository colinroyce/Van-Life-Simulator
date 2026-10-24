import * as THREE from 'three';
import { buildRoute, ROAD_HALF, SEA_LEVEL } from './route.js';
import { Terrain, buildTile, tileHeight, ROAD_LIFT } from './terrain.js';
import { buildRoad } from './roadMesh.js';
import { Flora } from './props.js';
import { ConvenienceStore } from '../places/store.js';
import { FuelStation } from '../places/fuelStation.js';

// The road trip map: desert gas station -> hills -> mountains -> snowy pass -> coast -> beach.

// Gas station compound beside the first stretch of highway (road runs along x = 18).
const LOT = { x0: ROAD_HALF + 18, x1: 66, z0: 18, z1: 62 };
const LOT_Y = 0.012;
const STORE = { x: 57, z: 40, facing: -Math.PI / 2 }; // front faces the road
const PUMPS = { x: 42, z: 40, facing: 0 };
const SPAWN = { position: new THREE.Vector3(40, LOT_Y, 54), yaw: -Math.PI / 2 }; // parked, nose toward the road

// Terrain streaming: detailed tiles near you, coarse ones out to the horizon.
const NEAR = { size: 250, segs: 50, load: 1100, unload: 1350 };
const FAR = { size: 1000, segs: 25, load: 6500, unload: 7500 };
const NEAR_COVER = 900; // far tiles are cut away inside this radius (near tiles always reach it)

const OFFROAD_LIMIT = 160; // how far from the road you can wander

// Sky, fog and light per section; blends across boundaries like the terrain.
const ATMOS = {
  desert: { top: 0x4f9ad8, horizon: 0xe8dcc4, fogNear: 600, fogFar: 6000, hemiSky: 0xd8e6ff, hemiGround: 0xb59a70, hemi: 1.25, sun: 2.6 },
  hills: { top: 0x5aa0dc, horizon: 0xdfe7ea, fogNear: 500, fogFar: 5500, hemiSky: 0xd2e6ff, hemiGround: 0x8f8a5a, hemi: 1.25, sun: 2.5 },
  ridge: { top: 0x5b98d0, horizon: 0xd4e0e8, fogNear: 400, fogFar: 4500, hemiSky: 0xcfe2f8, hemiGround: 0x6c7a4a, hemi: 1.3, sun: 2.4 },
  peaks: { top: 0x7d9cbd, horizon: 0xcdd6de, fogNear: 200, fogFar: 2600, hemiSky: 0xd6e0ea, hemiGround: 0x8a8f8a, hemi: 1.35, sun: 1.8 },
  pass: { top: 0xdde1e6, horizon: 0xdde1e6, fogNear: 4, fogFar: 150, hemiSky: 0xe8ecf0, hemiGround: 0xd0d6dc, hemi: 1.7, sun: 0.5 },
  descent: { top: 0x6f98c2, horizon: 0xd2dbe4, fogNear: 250, fogFar: 3500, hemiSky: 0xd4e2f2, hemiGround: 0x7a8a6a, hemi: 1.3, sun: 2.3 },
  coast: { top: 0x3f8fe0, horizon: 0xd0e6f2, fogNear: 600, fogFar: 6500, hemiSky: 0xcfe6ff, hemiGround: 0x7a8f5a, hemi: 1.3, sun: 2.6 },
  beach: { top: 0x3c8fe4, horizon: 0xd6eaf4, fogNear: 600, fogFar: 6500, hemiSky: 0xd2e8ff, hemiGround: 0xb8a77a, hemi: 1.35, sun: 2.7 },
};
const ATMOS_BLEND = 700;

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...opts });

function buildLot() {
  const g = new THREE.Group();
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(LOT.x1 - LOT.x0, LOT.z1 - LOT.z0), mat(0x4a4d52));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set((LOT.x0 + LOT.x1) / 2, LOT_Y, (LOT.z0 + LOT.z1) / 2);
  asphalt.receiveShadow = true;
  g.add(asphalt);
  const paint = mat(0xf3f0e6);
  for (let z = 33; z <= 47; z += 3) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.15), paint);
    s.rotation.x = -Math.PI / 2;
    s.position.set(47.5, 0.02, z);
    g.add(s);
  }
  return g;
}

// Far terrain is cut away near the camera, where the detailed tiles take over.
function farMaterial() {
  const m = mat(0xffffff, { vertexColors: true, roughness: 0.95 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.nearCover = { value: NEAR_COVER };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFarDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFarDist = length((modelMatrix * vec4(transformed, 1.0)).xz - cameraPosition.xz);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFarDist;\nuniform float nearCover;')
      .replace('void main() {', 'void main() {\nif (vFarDist < nearCover) discard;');
  };
  return m;
}

export class RoadTripWorld {
  constructor(scene) {
    this.scene = scene;
    this.route = buildRoute();
    const compound = { x0: LOT.x0 - 2, x1: LOT.x1 + 4, z0: LOT.z0 - 4, z1: LOT.z1 + 4 };
    this.terrain = new Terrain(this.route, [{ ...compound, y: -0.1, margin: 40 }]);
    this.flora = new Flora(this.terrain, this.route, [{ x0: compound.x0 - 10, x1: compound.x1 + 10, z0: compound.z0 - 10, z1: compound.z1 + 10 }]);
    this.spawn = SPAWN;
    this.destination = this.route.sections.at(-1).region;

    this.ocean = new THREE.Mesh(
      new THREE.CircleGeometry(8000, 48),
      new THREE.MeshStandardMaterial({ color: 0x2c6d8c, roughness: 0.25, metalness: 0.1 }),
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = SEA_LEVEL;
    this.road = buildRoad(this.route);
    this.nearGroup = new THREE.Group();
    this.farGroup = new THREE.Group();
    this.lot = buildLot();
    scene.add(this.ocean, this.road, this.nearGroup, this.farGroup, this.lot);

    this.nearMaterial = mat(0xffffff, { vertexColors: true, roughness: 0.95 });
    this.farMaterial = farMaterial();
    this.nearTiles = new Map();
    this.farTiles = new Map();

    this.store = new ConvenienceStore();
    this.store.place(scene, STORE.x, STORE.z, STORE.facing);
    this.fuelStation = new FuelStation();
    this.fuelStation.place(scene, PUMPS.x, PUMPS.z, PUMPS.facing);
    this.staticObstacles = [...this.store.vanObstacles(), ...this.fuelStation.obstacles()];
    // things you can aim at and set items down on
    this.surfaces = [this.nearGroup, this.road, this.lot, this.store.group, this.fuelStation.group];

    this.atmos = {
      top: new THREE.Color(), horizon: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
      fogNear: 0, fogFar: 0, hemi: 0, sun: 0,
    };
    this.#scratch = {};
    this.stream(SPAWN.position, Infinity);
  }

  #scratch;
  #eye = new THREE.Vector3();

  // --- streaming ---

  // Load tiles around `focus`, at most `budget` new detailed tiles per call.
  stream(focus, budget = 1) {
    this.#streamRing(this.nearTiles, NEAR, focus, budget, (ix, iz) => this.#loadNear(ix, iz));
    // far tiles only once the near ring is settled
    if (budget === Infinity || !this.pendingNear) this.#streamRing(this.farTiles, FAR, focus, budget, (ix, iz) => this.#loadFar(ix, iz));
  }

  #streamRing(tiles, ring, focus, budget, load) {
    const r = Math.ceil(ring.load / ring.size);
    const cx = Math.floor(focus.x / ring.size);
    const cz = Math.floor(focus.z / ring.size);
    const wanted = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const ix = cx + i;
        const iz = cz + j;
        const d = Math.hypot((ix + 0.5) * ring.size - focus.x, (iz + 0.5) * ring.size - focus.z);
        if (d < ring.load && !tiles.has(`${ix},${iz}`)) wanted.push([d, ix, iz]);
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    if (tiles === this.nearTiles) this.pendingNear = wanted.length > 0;
    for (const [, ix, iz] of wanted.slice(0, budget)) load(ix, iz);

    for (const [key, tile] of tiles) {
      const d = Math.hypot(tile.x0 + ring.size / 2 - focus.x, tile.z0 + ring.size / 2 - focus.z);
      if (d < ring.unload) continue;
      tile.mesh.removeFromParent();
      tile.mesh.geometry.dispose();
      if (tile.props) {
        tile.props.removeFromParent();
        for (const inst of tile.props.children) inst.dispose();
      }
      tiles.delete(key);
    }
  }

  #loadNear(ix, iz) {
    const { size, segs } = NEAR;
    const tile = buildTile(this.terrain, ix * size, iz * size, size, segs, this.nearMaterial);
    tile.mesh.receiveShadow = true;
    this.nearGroup.add(tile.mesh);
    const { group, obstacles } = this.flora.scatter(ix, iz, ix * size, iz * size, size, (x, z) => tileHeight(tile, x, z));
    tile.props = group;
    tile.obstacles = obstacles;
    this.nearGroup.add(group);
    this.nearTiles.set(`${ix},${iz}`, tile);
  }

  #loadFar(ix, iz) {
    const { size, segs } = FAR;
    const tile = buildTile(this.terrain, ix * size, iz * size, size, segs, this.farMaterial);
    this.farGroup.add(tile.mesh);
    this.farTiles.set(`${ix},${iz}`, tile);
  }

  // Per frame: stream terrain around the van, keep the sea centered on the camera,
  // and blend the weather for where you are on the trip.
  frame(focus, camera) {
    this.stream(focus, 1);
    const eye = camera.getWorldPosition(this.#eye);
    this.ocean.position.x = eye.x;
    this.ocean.position.z = eye.z;
    const here = this.locate(focus.x, focus.z);
    this.ocean.visible = here.s > this.route.sections.find((s) => s.key === 'descent').start;
    return this.atmosphereAt(here.s);
  }

  // --- queries ---

  // Where on the trip a point is: { s, section, dist (from the road), y (road elevation) }.
  locate(x, z) {
    const nr = this.route.nearest(x, z, 60, this.#scratch);
    if (nr) {
      const i = this.route.sectionIndexAt(nr.s);
      return { s: nr.s, dist: nr.dist, y: nr.y, section: this.route.sections[i], heading: nr.heading };
    }
    const f = this.terrain.field(x, z);
    const i = this.route.sectionIndexAt(f.s);
    return { s: f.s, dist: Math.abs(f.signed), y: f.base, section: this.route.sections[i], heading: this.route.heading[f.index] };
  }

  atmosphereAt(s) {
    const secs = this.route.sections;
    const i = this.route.sectionIndexAt(s);
    let from = secs[i].key;
    let to = from;
    let k = 0;
    if (i > 0 && s < secs[i].start + ATMOS_BLEND) {
      from = secs[i - 1].key;
      to = secs[i].key;
      k = 0.5 + (0.5 * (s - secs[i].start)) / ATMOS_BLEND;
    } else if (i < secs.length - 1 && s > secs[i].end - ATMOS_BLEND) {
      to = secs[i + 1].key;
      k = (0.5 * (s - (secs[i].end - ATMOS_BLEND))) / ATMOS_BLEND;
    }
    const A = ATMOS[from];
    const B = ATMOS[to];
    const out = this.atmos;
    for (const key of ['top', 'horizon', 'hemiSky', 'hemiGround']) out[key].set(A[key]).lerp(new THREE.Color(B[key]), k);
    // fog distances blend in log space so the whiteout closes in gradually
    for (const key of ['fogNear', 'fogFar']) out[key] = Math.exp(Math.log(A[key]) + (Math.log(B[key]) - Math.log(A[key])) * k);
    for (const key of ['hemi', 'sun']) out[key] = A[key] + (B[key] - A[key]) * k;
    return out;
  }

  // Height of whatever you'd be standing or driving on.
  groundHeight(x, z) {
    if (x > LOT.x0 && x < LOT.x1 && z > LOT.z0 && z < LOT.z1) return LOT_Y;
    const nr = this.route.nearest(x, z, ROAD_HALF + 0.3, this.#scratch);
    if (nr) return nr.y + ROAD_LIFT;
    const size = NEAR.size;
    const tile = this.nearTiles.get(`${Math.floor(x / size)},${Math.floor(z / size)}`);
    return tile ? tileHeight(tile, x, z) : this.terrain.heightAt(x, z);
  }

  surfaceAt(x, z) {
    if (this.store.contains(new THREE.Vector3(x, 0, z))) return 'tile';
    if (x > LOT.x0 && x < LOT.x1 && z > LOT.z0 && z < LOT.z1) return 'asphalt';
    return this.route.nearest(x, z, ROAD_HALF, this.#scratch) ? 'asphalt' : 'grass';
  }

  // Solid circles around a point: the station buildings plus nearby rocks, trees and cacti.
  obstaclesNear(x, z) {
    const size = NEAR.size;
    const ix = Math.floor(x / size);
    const iz = Math.floor(z / size);
    const out = this.staticObstacles.slice();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const tile = this.nearTiles.get(`${ix + i},${iz + j}`);
        if (tile) for (const o of tile.obstacles) if (Math.abs(o.x - x) < 30 && Math.abs(o.z - z) < 30) out.push(o);
      }
    }
    return out;
  }

  // Too far from the road: an invisible fence turns you back.
  constrainVan(sim) {
    const p = sim.position;
    const f = this.terrain.field(p.x, p.z, this.#scratch);
    if (Math.abs(f.signed) < OFFROAD_LIMIT - 20) return 0;
    const nr = this.route.nearest(p.x, p.z, OFFROAD_LIMIT + 60);
    if (!nr || nr.dist <= OFFROAD_LIMIT) return 0;
    const nx = (nr.x - p.x) / nr.dist;
    const nz = (nr.z - p.z) / nr.dist;
    return sim.pushOut(nx, nz, nr.dist - OFFROAD_LIMIT);
  }

  constrainWalker(p) {
    const nr = this.route.nearest(p.x, p.z, OFFROAD_LIMIT + 60);
    if (!nr || nr.dist <= OFFROAD_LIMIT) return;
    p.x += ((nr.x - p.x) / nr.dist) * (nr.dist - OFFROAD_LIMIT);
    p.z += ((nr.z - p.z) / nr.dist) * (nr.dist - OFFROAD_LIMIT);
  }

  // Back on the road (right lane, facing the way the trip goes), for the R key.
  resetPose(from) {
    const nr = this.route.nearestAnywhere(from.x, from.z);
    const h = nr.heading;
    const position = new THREE.Vector3(nr.x - Math.cos(h) * 1.9, 0, nr.z + Math.sin(h) * 1.9);
    position.y = this.groundHeight(position.x, position.z);
    return { position, yaw: h };
  }

  walls() {
    return this.store.walls();
  }

  // No traffic cones out here.
  update() {
    return 0;
  }

  resetCones() {}
}
