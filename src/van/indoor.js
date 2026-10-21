import * as THREE from 'three';

// The sky (hemisphere) light isn't shadowed, so on its own it lights the inside of the van as
// brightly as the outside. Indoor materials get a flat ambient-occlusion map so only a fraction
// of that ambient reaches them; direct light (sun through the windows, the van's own lamps) is
// unaffected.
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export const CAB_AMBIENT = 0.45; // big windshield lets in plenty of sky
export const LIVING_AMBIENT = 0.22;

export function indoor(material, ambient = LIVING_AMBIENT) {
  material.aoMap = BLACK;
  material.aoMapIntensity = 1 - ambient;
  return material;
}
