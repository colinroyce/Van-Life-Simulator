import * as THREE from 'three';
import { ROAD_HALF, SAMPLE } from './route.js';
import { ROAD_LIFT } from './terrain.js';

// The pavement: a ribbon following the route, split into chunks so off-screen ones get culled.
const CHUNK = 100; // samples per chunk (200 m)
const TEX_LENGTH = 24; // meters of road per texture repeat
const SKIRT = 0.6; // edge drops this far so the pavement never looks like it's floating

// Center line style per section.
const MARKINGS = { desert: 'dashed', hills: 'dashed', ridge: 'double', peaks: 'double', pass: 'double', descent: 'double', coast: 'double', beach: 'dashed' };

function roadTexture(style) {
  const W = 256;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const px = W / (ROAD_HALF * 2); // pixels per meter across
  const py = H / TEX_LENGTH; // pixels per meter along

  ctx.fillStyle = '#4a4c50';
  ctx.fillRect(0, 0, W, H);
  // speckle so the asphalt isn't a flat color
  for (let i = 0; i < 9000; i++) {
    const v = 60 + Math.random() * 30;
    ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // shoulders a shade lighter
  const shoulder = 0.75;
  ctx.fillStyle = 'rgba(150,145,135,0.18)';
  ctx.fillRect(0, 0, shoulder * px, H);
  ctx.fillRect(W - shoulder * px, 0, shoulder * px, H);
  // white edge lines
  ctx.fillStyle = '#e8e6df';
  const edge = 0.14 * px;
  ctx.fillRect(shoulder * px, 0, edge, H);
  ctx.fillRect(W - shoulder * px - edge, 0, edge, H);
  // yellow center
  ctx.fillStyle = '#e2b42a';
  const line = 0.12 * px;
  if (style === 'double') {
    ctx.fillRect(W / 2 - line * 1.8, 0, line, H);
    ctx.fillRect(W / 2 + line * 0.8, 0, line, H);
  } else {
    for (let s = 0; s < TEX_LENGTH; s += 12) ctx.fillRect(W / 2 - line / 2, s * py, line, 3 * py);
  }
  // faint tire wear down each lane
  ctx.fillStyle = 'rgba(30,30,32,0.12)';
  for (const lane of [-1, 1]) {
    for (const off of [-0.9, 0.9]) ctx.fillRect(W / 2 + (lane * 1.85 + off - 0.3) * px, 0, 0.6 * px, H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function buildRoad(route) {
  const group = new THREE.Group();
  const materials = {};
  const materialFor = (style) => {
    if (!materials[style]) {
      materials[style] = new THREE.MeshStandardMaterial({
        map: roadTexture(style),
        roughness: 0.92,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    }
    return materials[style];
  };

  for (let start = 0; start < route.count - 1; start += CHUNK) {
    const end = Math.min(start + CHUNK, route.count - 1);
    const style = MARKINGS[route.sectionAt[Math.floor((start + end) / 2)]];
    const n = end - start + 1;
    // 4 vertices per sample: skirt-left, left edge, right edge, skirt-right
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    for (let k = 0; k < n; k++) {
      const i = start + k;
      const h = route.heading[i];
      const lx = Math.cos(h);
      const lz = -Math.sin(h);
      const x = route.x[i];
      const z = route.z[i];
      const y = route.y[i] + ROAD_LIFT;
      const v = (i * SAMPLE) / TEX_LENGTH;
      const verts = [
        [ROAD_HALF + 0.05, y - SKIRT, 0],
        [ROAD_HALF, y, 0],
        [-ROAD_HALF, y, 1],
        [-ROAD_HALF - 0.05, y - SKIRT, 1],
      ];
      verts.forEach(([off, vy, u], j) => {
        const o = (k * 4 + j) * 3;
        pos[o] = x + lx * off;
        pos[o + 1] = vy;
        pos[o + 2] = z + lz * off;
        uv[(k * 4 + j) * 2] = u;
        uv[(k * 4 + j) * 2 + 1] = v;
      });
    }
    const index = [];
    for (let k = 0; k < n - 1; k++) {
      for (let j = 0; j < 3; j++) {
        const a = k * 4 + j;
        const b = a + 1;
        const c = a + 4;
        const d = a + 5;
        // left is +X when heading +Z; wound counter-clockwise seen from above
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materialFor(style));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
