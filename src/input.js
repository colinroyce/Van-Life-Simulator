// Keyboard state. Driving/walking axes are read every frame; one-shot actions fire callbacks.
const held = new Set();
const actions = {};

const BLOCK_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

window.addEventListener('keydown', (e) => {
  if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
  if (!e.repeat && actions[e.code]) actions[e.code]();
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

const any = (...codes) => codes.some((c) => held.has(c));

export function onKey(code, fn) {
  actions[code] = fn;
}

export function readDriveInput() {
  return {
    throttle: any('KeyW', 'ArrowUp') ? 1 : 0,
    brake: any('KeyS', 'ArrowDown') ? 1 : 0,
    // +1 = left, -1 = right
    steer: (any('KeyA', 'ArrowLeft') ? 1 : 0) - (any('KeyD', 'ArrowRight') ? 1 : 0),
    handbrake: any('Space'),
    horn: any('KeyH'),
  };
}

export function readWalkInput() {
  return {
    forward: (any('KeyW', 'ArrowUp') ? 1 : 0) - (any('KeyS', 'ArrowDown') ? 1 : 0),
    // +1 = strafe right
    strafe: (any('KeyD') ? 1 : 0) - (any('KeyA') ? 1 : 0),
    // +1 = turn left; arrow keys are a fallback for mouse look
    turn: (any('ArrowLeft') ? 1 : 0) - (any('ArrowRight') ? 1 : 0),
    run: any('ShiftLeft', 'ShiftRight'),
  };
}

// --- mouse look (pointer lock) ---
let mouseDX = 0;
let mouseDY = 0;

window.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  mouseDX += e.movementX;
  mouseDY += e.movementY;
});

export function takeMouseDelta() {
  const d = { x: mouseDX, y: mouseDY };
  mouseDX = mouseDY = 0;
  return d;
}

export function isPointerLocked() {
  return !!document.pointerLockElement;
}

// Left click while the mouse is captured (using the held item).
export function onLockedClick(fn) {
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && document.pointerLockElement) fn();
  });
}

// Scroll wheel steps: +1 down, -1 up.
export function onScroll(fn) {
  window.addEventListener('wheel', (e) => fn(Math.sign(e.deltaY)), { passive: true });
}
