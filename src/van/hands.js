import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { indoor, CAB_AMBIENT } from './indoor.js';

// The driver's hands, gripping the steering wheel at 10 and 2. Built from tapered capsules
// (three joints per finger, two for the thumb) wrapped around the rim's cross-section, with the
// backs of the hands facing the driver the way you'd see your own.

export const SKIN_SMOOTH = indoor(
  new THREE.MeshPhysicalMaterial({
    color: 0xd59c78,
    roughness: 0.58,
    sheen: 0.5,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0xffb796),
  }),
  CAB_AMBIENT,
);
const NAIL = indoor(new THREE.MeshStandardMaterial({ color: 0xe8bfae, roughness: 0.3 }), CAB_AMBIENT);

const UP = new THREE.Vector3(0, 1, 0);
const RADIAL = 16; // segments around each finger

// Tapered limb from a (radius r0) to b (radius r1), with rounded joints at both ends.
function limb(a, b, r0, r1 = r0, out = []) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const cyl = new THREE.CylinderGeometry(r1, r0, len, RADIAL, 1, true);
  cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  cyl.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  out.push(cyl, joint(a, r0), joint(b, r1));
  return out;
}

function joint(p, r) {
  return new THREE.SphereGeometry(r, RADIAL, 10).translate(p.x, p.y, p.z);
}

// Fingernail: a thin ellipsoid lying on the skin.
function nail(center, x, y, width, length) {
  const g = new THREE.SphereGeometry(0.5, 14, 8).scale(width, length, 0.0035);
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(center));
}

// A rounded slab with its own axes (x: across, y: along, z: thickness direction).
function slab(center, x, y, size, radius) {
  const g = new RoundedBoxGeometry(size[0], size[1], size[2], 4, radius);
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(center));
  return g;
}

// Finger layout: offset across the back of the hand (+ toward the index finger), radius,
// and joint lengths (proximal, middle, distal).
const FINGERS = [
  { across: 0.027, r: 0.0093, lengths: [0.043, 0.026, 0.021] },
  { across: 0.009, r: 0.0097, lengths: [0.047, 0.029, 0.022] },
  { across: -0.0095, r: 0.0093, lengths: [0.044, 0.027, 0.021] },
  { across: -0.0265, r: 0.0082, lengths: [0.035, 0.021, 0.018] },
];
const SLANT = 0.7; // how far the hand leans off square to the rim (radians)

// side: +1 left hand (10 o'clock, +X is the driver's left), -1 right hand (2 o'clock).
// Returns a group whose origin is the wrist, in the steering wheel's frame.
//
// Matches how people actually hold a wheel at 10 and 2 (seen from the driver's seat): the back
// of the hand faces you, the forearm comes up from below, and the knuckle row crosses the rim
// at an angle. Each finger hooks over the rim at its own spot and disappears behind it; the
// thumb lies along the inside of the rim.
export function buildGripHand(side, rimR, tubeR) {
  const phi0 = side > 0 ? 0.52 : Math.PI - 0.52;

  // Point in the rim's cross-section: `v` outward from the hub, `w` toward the dash
  // (negative = the driver's side), `along` = meters along the rim toward 12 o'clock.
  const cs = (v, w, along = 0) => {
    const phi = phi0 + (side * along) / rimR;
    const radial = rimR + v;
    return new THREE.Vector3(Math.cos(phi) * radial, Math.sin(phi) * radial, w);
  };
  const around = (angle, rho, along) => cs(Math.cos(angle) * rho, Math.sin(angle) * rho, along);

  const skin = [];
  const nails = [];

  // The back of the hand's own axes, lying on the driver's face of the rim
  const palmW = -(tubeR + 0.0105);
  const origin = cs(0, palmW);
  const T = cs(0, palmW, 0.01).sub(origin).normalize(); // along the rim toward 12 o'clock
  const O = cs(0.01, palmW).sub(origin).normalize(); // outward from the hub
  const N = new THREE.Vector3(0, 0, -1); // toward the driver
  const across = T.clone().multiplyScalar(Math.cos(SLANT)).addScaledVector(O, -Math.sin(SLANT)); // toward the index finger
  const down = O.clone().multiplyScalar(-Math.cos(SLANT)).addScaledVector(T, -Math.sin(SLANT)); // knuckles -> wrist
  const KNUCKLE_V = 0.012;
  const knuckles = cs(KNUCKLE_V, palmW, 0);
  const onHand = (x, y, lift = 0) => knuckles.clone().addScaledVector(across, x).addScaledVector(down, y).addScaledVector(N, lift);

  // Fingers: from each knuckle, over the outer part of the rim and around behind it
  for (const f of FINGERS) {
    const along = f.across * Math.cos(SLANT);
    const v0 = KNUCKLE_V - f.across * Math.sin(SLANT);
    const knuckle = cs(v0, palmW, along);
    const rho = tubeR + f.r + 0.003;
    let angle = Math.atan2(palmW, v0);
    let prev = knuckle;
    skin.push(joint(prev, f.r * 1.22)); // knuckle bump on the back of the hand
    const taper = [1, 0.93, 0.86, 0.78];
    f.lengths.forEach((len, k) => {
      const fromRho = k === 0 ? Math.hypot(v0, palmW) : rho;
      angle += 2 * Math.asin(Math.min(len / (fromRho + rho), 1));
      const next = around(angle, rho, along);
      limb(prev, next, f.r * taper[k], f.r * taper[k + 1], skin);
      if (k === 2) {
        // fingernail on the outside of the fingertip
        const mid = prev.clone().lerp(next, 0.62);
        const outward = mid.clone().sub(around(angle - 0.25, 0, along)).normalize();
        const tangent = next.clone().sub(prev).normalize();
        const side3 = new THREE.Vector3().crossVectors(tangent, outward).normalize();
        nails.push(nail(mid.addScaledVector(outward, f.r * 0.72), side3, tangent, f.r * 1.45, len * 0.62));
      }
      prev = next;
    });
  }

  // Back of the hand: a thin rounded slab for the edges under a gently domed top
  const axes = (center, geo) => {
    const z = new THREE.Vector3().crossVectors(across, down).normalize();
    return geo.applyMatrix4(new THREE.Matrix4().makeBasis(across, down, z).setPosition(center));
  };
  const dome = (center, size) => axes(center, new THREE.SphereGeometry(0.5, 28, 18).scale(size[0], size[1], size[2]));
  skin.push(axes(onHand(0, 0.042), new RoundedBoxGeometry(0.086, 0.082, 0.018, 4, 0.0088)));
  skin.push(dome(onHand(0.002, 0.044, 0.002), [0.088, 0.096, 0.022]));
  // heel of the hand (pinky side) and the pad at the base of the thumb, mostly on the rim side
  skin.push(dome(onHand(-0.012, 0.07, -0.004), [0.06, 0.045, 0.022]));
  skin.push(dome(onHand(0.028, 0.064, -0.006), [0.04, 0.05, 0.024]));

  // Thumb: from the base of the palm up along the inside of the rim toward 12 o'clock
  const thumbW = -(tubeR + 0.0085);
  const t0 = onHand(0.036, 0.064, -0.004);
  const t1 = cs(-0.02, thumbW - 0.002, 0.034);
  const t2 = cs(-0.022, thumbW, 0.058);
  const t3 = cs(-0.02, thumbW + 0.001, 0.08);
  limb(t0, t1, 0.0135, 0.0115, skin);
  limb(t1, t2, 0.0115, 0.0104, skin);
  limb(t2, t3, 0.0104, 0.0094, skin);
  const thumbDir = t3.clone().sub(t2).normalize();
  const thumbSide = new THREE.Vector3().crossVectors(thumbDir, N).normalize();
  nails.push(nail(t2.clone().lerp(t3, 0.62).addScaledVector(N, 0.0085), thumbSide, thumbDir, 0.0135, 0.015));

  // Wrist: continues down the hand, dipping back toward the driver
  const wrist = onHand(-0.004, 0.118, 0.022);
  limb(onHand(-0.004, 0.08, 0.004), wrist, 0.025, 0.027, skin);

  const group = new THREE.Group();
  group.position.copy(wrist);
  const toLocal = (geos) => geos.map((g) => (g.index ? g.toNonIndexed() : g).translate(-wrist.x, -wrist.y, -wrist.z));
  const handMesh = new THREE.Mesh(mergeGeometries(toLocal(skin)), SKIN_SMOOTH);
  const nailMesh = new THREE.Mesh(mergeGeometries(toLocal(nails)), NAIL);
  handMesh.castShadow = true;
  group.add(handMesh, nailMesh);
  return group;
}

// Forearm in a rolled-up sleeve, stretched from shoulder to wrist each frame (see layArm).
export function buildArm(sleeveMaterial) {
  const arm = new THREE.Group();
  const sleeveGeo = new THREE.CylinderGeometry(0.052, 0.06, 1, 20, 1, true);
  sleeveGeo.translate(0, 0.5, 0);
  const sleeve = new THREE.Mesh(sleeveGeo, sleeveMaterial);
  const cuffGeo = new THREE.TorusGeometry(0.053, 0.009, 8, 24);
  cuffGeo.rotateX(Math.PI / 2);
  const cuff = new THREE.Mesh(cuffGeo, sleeveMaterial);
  const forearmGeo = new THREE.CylinderGeometry(0.027, 0.038, 1, 20, 1, true);
  forearmGeo.translate(0, 0.5, 0);
  const forearm = new THREE.Mesh(forearmGeo, SKIN_SMOOTH);
  arm.add(sleeve, cuff, forearm);
  arm.userData.parts = { sleeve, cuff, forearm };
  return arm;
}

const FOREARM = 0.2; // bare skin between the cuff and the wrist

export function layArm(arm, shoulder, wrist) {
  const dir = wrist.clone().sub(shoulder);
  const len = dir.length();
  arm.position.copy(shoulder);
  arm.quaternion.setFromUnitVectors(UP, dir.normalize());
  const { sleeve, cuff, forearm } = arm.userData.parts;
  const sleeveLen = Math.max(len - FOREARM, 0.05);
  sleeve.scale.y = sleeveLen;
  cuff.position.y = sleeveLen;
  forearm.position.y = sleeveLen - 0.03;
  forearm.scale.y = len - sleeveLen + 0.03;
}
