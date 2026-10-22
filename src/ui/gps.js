import * as THREE from 'three';
import { SAMPLE, SEA_LEVEL } from '../map/route.js';

// The van's center touchscreen: a heading-up route map with where you are, the road you're on,
// and how far is left to go. Drawn to a canvas that becomes the screen's texture.
const W = 640;
const H = 360;
const TOP_BAR = 74;
const BOTTOM_BAR = 54;
const REDRAW = 1 / 8; // seconds between redraws
const METERS_TO_MILES = 1 / 1609.34;
const FEET_PER_METER = 13; // the map's mountains are squashed; this makes the readout feel right

// Map background tint per region.
const BACKDROP = {
  desert: '#2b2519', hills: '#262818', ridge: '#1d261d', peaks: '#1f2428',
  pass: '#2a2f35', descent: '#1d2528', coast: '#152634', beach: '#1a2b36',
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class Gps {
  // places: [{ x, z, icon }] marked on the map
  constructor(route, destination, places = []) {
    this.route = route;
    this.destination = destination;
    this.places = places;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.timer = 0;
    this.zoom = 0.3; // pixels per meter

    // every 10 m is plenty for drawing
    const step = Math.round(10 / SAMPLE);
    this.pts = [];
    for (let i = 0; i < route.count; i += step) this.pts.push([route.x[i], route.z[i], i * SAMPLE]);
    this.pts.push([route.x[route.count - 1], route.z[route.count - 1], route.length]);
  }

  update(dt, sim, here) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REDRAW;
    // zoom out at speed so you can see what's coming
    const target = THREE.MathUtils.lerp(0.42, 0.14, Math.min(Math.abs(sim.speed) / 28, 1));
    this.zoom += (target - this.zoom) * 0.15;
    this.#draw(sim, here);
    this.texture.needsUpdate = true;
  }

  #draw(sim, here) {
    const ctx = this.ctx;
    const { x, z } = sim.position;
    const h = sim.yaw;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const lx = Math.cos(h);
    const lz = -Math.sin(h);
    const cx = W / 2;
    const cy = TOP_BAR + (H - TOP_BAR - BOTTOM_BAR) * 0.72;
    const k = this.zoom;
    const toScreen = (px, pz) => {
      const dx = px - x;
      const dz = pz - z;
      return [cx - (dx * lx + dz * lz) * k, cy - (dx * fx + dz * fz) * k];
    };
    const reach = (Math.hypot(W, H) / k) * 0.75;

    ctx.fillStyle = BACKDROP[here.section.key] ?? '#1d2228';
    ctx.fillRect(0, 0, W, H);

    // faint grid that turns with you, so movement reads even on long straights
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const gridM = 250;
    const gx0 = Math.floor((x - reach) / gridM) * gridM;
    const gz0 = Math.floor((z - reach) / gridM) * gridM;
    ctx.beginPath();
    for (let gx = gx0; gx <= x + reach; gx += gridM) {
      const [ax, ay] = toScreen(gx, z - reach);
      const [bx, by] = toScreen(gx, z + reach);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    for (let gz = gz0; gz <= z + reach; gz += gridM) {
      const [ax, ay] = toScreen(x - reach, gz);
      const [bx, by] = toScreen(x + reach, gz);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    // route: traveled part grey, the rest blue with a dark casing
    const strokeRoute = (from, to, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      for (const [px, pz, s] of this.pts) {
        if (s < from || s > to || Math.abs(px - x) > reach || Math.abs(pz - z) > reach) {
          pen = false;
          continue;
        }
        const [sx, sy] = toScreen(px, pz);
        if (pen) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
        pen = true;
      }
      ctx.stroke();
    };
    strokeRoute(0, here.s + 10, 7, '#59626d');
    strokeRoute(here.s - 10, Infinity, 14, '#0f3766');
    strokeRoute(here.s - 10, Infinity, 8, '#3d9bff');

    // places and the destination flag
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.places) {
      const [sx, sy] = toScreen(p.x, p.z);
      if (sx < -20 || sx > W + 20 || sy < TOP_BAR - 20 || sy > H) continue;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(p.icon, sx, sy + 1);
    }
    const end = this.pts.at(-1);
    const [ex, ey] = toScreen(end[0], end[1]);
    ctx.fillText('🏁', ex, ey - 12);

    // you
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0d5bd6';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(14, 15);
    ctx.lineTo(0, 7);
    ctx.lineTo(-14, 15);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // top bar: region, road, heading
    ctx.fillStyle = 'rgba(8,12,18,0.88)';
    ctx.fillRect(0, 0, W, TOP_BAR);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(here.section.region, 20, 38);
    ctx.fillStyle = '#9fb4c9';
    ctx.font = '22px sans-serif';
    ctx.fillText(here.dist > 25 ? `Off road · near ${here.section.road}` : here.section.road, 20, 64);

    const bearing = ((-h * 180) / Math.PI + 360 * 4) % 360; // north is +Z, east is -X
    const dir = COMPASS[Math.round(bearing / 45) % 8];
    ctx.textAlign = 'right';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(dir, W - 20, 46);

    // bottom bar: distance left and elevation
    ctx.fillStyle = 'rgba(8,12,18,0.88)';
    ctx.fillRect(0, H - BOTTOM_BAR, W, BOTTOM_BAR);
    const miles = Math.max(this.route.length - here.s, 0) * METERS_TO_MILES;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    const left = miles < 0.1 ? `Arrived · ${this.destination}` : `${miles.toFixed(1)} mi`;
    ctx.fillText(left, 20, H - BOTTOM_BAR / 2);
    if (miles >= 0.1) {
      const w = ctx.measureText(left).width;
      ctx.font = '22px sans-serif';
      ctx.fillStyle = '#9fb4c9';
      ctx.fillText(`to ${this.destination}`, 30 + w, H - BOTTOM_BAR / 2);
    }
    ctx.textAlign = 'right';
    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#9fb4c9';
    const feet = Math.round(((sim.position.y - SEA_LEVEL) * FEET_PER_METER) / 10) * 10;
    ctx.fillText(`ELEV ${feet.toLocaleString('en-US')} ft`, W - 20, H - BOTTOM_BAR / 2);
  }
}
