import * as THREE from 'three';

// Time of day on top of the weather. The world says what the sky and light look like at noon
// where you are (desert haze, mountain overcast, whiteout); this darkens and warms that for
// sunrise, sunset and night, moves the sun across the sky, and brings out the stars and moon.

const SUNRISE = 6.5; // hours
const SUNSET = 19.5;
const MAX_ELEVATION = THREE.MathUtils.degToRad(68);
const SKY_RADIUS = 7000;

const NIGHT = {
  top: new THREE.Color(0x070d22),
  horizon: new THREE.Color(0x1b2743),
  hemiSky: new THREE.Color(0x3a4b78),
  hemiGround: new THREE.Color(0x141a26),
};
const SUNSET_GLOW = new THREE.Color(0xf2864a);
const SUNSET_TOP = new THREE.Color(0x4a4f8c);
const SUN_LOW = new THREE.Color(0xff9a52);
const SUN_HIGH = new THREE.Color(0xfff1d6);
const MOONLIGHT = new THREE.Color(0x9fb4ff);
const MOONLIGHT_INTENSITY = 0.45;
const NIGHT_AMBIENT = 0.2; // fraction of daytime sky light left at night

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Unit vector toward the sun. It rises in the east (-X), arcs over the south (-Z) and sets in
// the west (+X); below the horizon at night.
export function sunDirection(hour, out = new THREE.Vector3()) {
  const theta = ((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
  return out.set(-Math.cos(theta), Math.sin(theta) * Math.sin(MAX_ELEVATION), -Math.sin(theta) * Math.cos(MAX_ELEVATION)).normalize();
}

function buildSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunGlow: { value: new THREE.Color() }, // color of the halo around the sun
      sunDisc: { value: 1 }, // 0 when the sun is behind cloud/fog
    },
    vertexShader: `varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunGlow; uniform float sunDisc;
      varying vec3 vPos;
      void main() {
        vec3 d = normalize(vPos);
        float h = clamp(d.y * 2.5, 0.0, 1.0);
        vec3 c = mix(horizon, top, h);
        float s = max(dot(d, sunDir), 0.0);
        c += sunGlow * (pow(s, 6.0) * 0.45 + pow(s, 64.0) * 0.6);
        c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9996, s) * sunDisc;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), m);
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  return sky;
}

function buildStars() {
  const count = 1800;
  const pos = new Float32Array(count * 3);
  const sizes = [];
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    // upper hemisphere, a little below the horizon too (fog hides the bottom)
    const u = rand() * 2 * Math.PI;
    const y = rand() * 1.05 - 0.05;
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(u) * r * 6500, y * 6500, Math.sin(u) * r * 6500], i * 3);
    sizes.push(rand());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(geo, mat);
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  return stars;
}

function buildMoon() {
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(95, 32),
    new THREE.MeshBasicMaterial({ color: 0xf2efe2, transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false }),
  );
  moon.renderOrder = -1;
  moon.frustumCulled = false;
  return moon;
}

export class DayNight {
  constructor(scene) {
    this.sky = buildSky();
    this.stars = buildStars();
    this.moon = buildMoon();
    scene.add(this.sky, this.stars, this.moon);
    this.sun = new THREE.Vector3();
    this.out = {
      top: new THREE.Color(),
      horizon: new THREE.Color(),
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      lightColor: new THREE.Color(),
      lightDir: new THREE.Vector3(), // toward the sun, or the moon at night
      lightIntensity: 0,
      hemi: 0,
      fogNear: 0,
      fogFar: 0,
      daylight: 1, // 1 broad day .. 0 night
    };
    this.#eye = new THREE.Vector3();
  }

  #eye;

  // base: the world's noon atmosphere ({ top, horizon, hemiSky, hemiGround, hemi, sun, fogNear, fogFar,
  // and optionally clear: 0..1 how much open sky shows; otherwise judged from the fog).
  update(hour, base, camera) {
    const out = this.out;
    const sun = sunDirection(hour, this.sun);
    const daylight = smoothstep(-0.12, 0.22, sun.y);
    const warm = smoothstep(-0.16, 0.0, sun.y) * (1 - smoothstep(0.02, 0.32, sun.y)); // around sunrise/sunset
    out.daylight = daylight;

    out.top.copy(NIGHT.top).lerp(base.top, daylight).lerp(SUNSET_TOP, warm * 0.35);
    out.horizon.copy(NIGHT.horizon).lerp(base.horizon, daylight).lerp(SUNSET_GLOW, warm * 0.6);
    out.hemiSky.copy(NIGHT.hemiSky).lerp(base.hemiSky, daylight);
    out.hemiGround.copy(NIGHT.hemiGround).lerp(base.hemiGround, daylight);
    out.hemi = base.hemi * (NIGHT_AMBIENT + (1 - NIGHT_AMBIENT) * daylight);
    out.fogNear = base.fogNear;
    out.fogFar = base.fogFar;

    // Sunlight fades out at the horizon; the moon (opposite the sun) takes over at night
    const sunUp = smoothstep(-0.02, 0.12, sun.y);
    const moonUp = smoothstep(0.0, 0.15, -sun.y);
    const clearSky = base.clear ?? smoothstep(600, 2500, base.fogFar); // no sun disc, stars or moon in a whiteout
    if (sunUp >= moonUp * 0.3) {
      out.lightDir.copy(sun);
      if (out.lightDir.y < 0.05) out.lightDir.y = 0.05; // keep shadows from stretching to infinity
      out.lightDir.normalize();
      out.lightColor.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.05, 0.45, sun.y));
      out.lightIntensity = base.sun * sunUp;
    } else {
      out.lightDir.copy(sun).negate();
      out.lightDir.y = Math.max(out.lightDir.y, 0.25);
      out.lightDir.normalize();
      out.lightColor.copy(MOONLIGHT);
      out.lightIntensity = MOONLIGHT_INTENSITY * moonUp * (0.4 + 0.6 * clearSky);
    }

    // Sky dome, stars and moon ride along with the camera
    const eye = camera.getWorldPosition(this.#eye);
    const u = this.sky.material.uniforms;
    u.top.value.copy(out.top);
    u.horizon.value.copy(out.horizon);
    u.sunDir.value.copy(sun);
    u.sunGlow.value.copy(SUNSET_GLOW).lerp(SUN_HIGH, smoothstep(0.1, 0.5, sun.y)).multiplyScalar(clearSky * sunUp * (0.4 + warm));
    u.sunDisc.value = clearSky * sunUp;
    this.sky.position.copy(eye);
    this.stars.position.copy(eye);
    this.stars.rotation.y = (hour / 24) * Math.PI * 2 * 0.25; // a slow wheel through the night
    this.stars.material.opacity = (1 - smoothstep(0.0, 0.5, daylight)) * clearSky;
    this.stars.visible = this.stars.material.opacity > 0.01;
    const moonDir = this.#eye.clone().set(-sun.x, Math.max(-sun.y, -0.2), -sun.z * 0.6 + 0.3).normalize();
    this.moon.position.copy(eye).addScaledVector(moonDir, 6000);
    this.moon.lookAt(eye);
    this.moon.material.opacity = moonUp * clearSky;
    this.moon.visible = this.moon.material.opacity > 0.01;
    return out;
  }
}
