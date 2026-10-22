import * as THREE from 'three';
import * as S from './synth.js';

// The van's radio. Four stations of public-domain / CC0 recordings (see public/radio/CREDITS.md).
// Stations keep "broadcasting" while you're tuned away: each has its own clock, so tuning back
// in drops you into the middle of whatever's on, like real radio.

const track = (file, title, artist, seconds) => ({ src: `/radio/${file}.m4a`, title, artist, seconds });

export const STATIONS = [
  {
    freq: '88.5',
    name: 'KROD Roadhouse',
    tracks: [
      track('classics-tiger-rag', 'Tiger Rag', 'Original Dixieland Jass Band', 184.9),
      track('classics-forever-blowing-bubbles', "I'm Forever Blowing Bubbles", 'Ben Selvin', 203.7),
      track('classics-krooked-blues', 'Krooked Blues', "King Oliver's Creole Jazz Band", 174.8),
      track('classics-dippermouth-blues', 'Dippermouth Blues', "King Oliver's Jazz Band", 143.7),
      track('classics-st-louis-blues', 'St. Louis Blues', 'Bessie Smith & Louis Armstrong', 190.1),
    ],
  },
  {
    freq: '94.1',
    name: 'Chill FM',
    tracks: [
      track('lofi-chill-lofi-inspired', 'Chill Lofi Inspired', 'omfgdude', 123.2),
      track('lofi-a-cup-of-tea', 'A Cup of Tea', 'TAD', 168.8),
      track('lofi-countryside', 'Countryside', 'TAD', 92.1),
      track('lofi-oceanside', 'Oceanside', 'TAD', 102.5),
      track('lofi-since-2-am', 'Since 2 A.M.', 'TAD', 256.5),
      track('lofi-happy-lofi-day', 'Happy Lofi Day', 'Tarush Singhal', 116.4),
    ],
  },
  {
    freq: '99.7',
    name: 'Classical 99.7',
    tracks: [
      track('classical-morning-mood', 'Morning Mood', 'Grieg · Musopen Symphony', 229.2),
      track('classical-gymnopedie-1', 'Gymnopédie No. 1', 'Satie', 183.6),
      track('classical-nocturne-op15-1', 'Nocturne Op. 15 No. 1', 'Chopin', 305.5),
      track('classical-nocturne-op55-1', 'Nocturne Op. 55 No. 1', 'Chopin', 316.7),
      track('classical-moonlight-sonata', 'Moonlight Sonata, I.', 'Beethoven', 335.8),
    ],
  },
  {
    freq: '104.3',
    name: 'Night Drive',
    tracks: [
      track('synth-midnight-cruiser', 'Midnight Cruiser', 'Zane Little', 144.4),
      track('synth-space-city', 'Space City', 'MintoDog', 116.9),
      track('synth-synth-wave', 'Synth Wave', 'Pro Sensory', 192.1),
      track('synth-calm-ambient-1', 'Calm Ambient 1', 'cynicmusic', 157.9),
      track('synth-synthwave-type', 'synthwave_type', 'G_P', 113.2),
    ],
  },
];

const VOLUME = 0.55;
const STATIC_TIME = 0.35; // seconds of hiss between stations

export class Radio {
  constructor(audio) {
    this.audio = audio;
    this.station = -1; // -1 = off
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.#tuneIn());
    // every station starts somewhere random in its playlist
    this.clocks = STATIONS.map((s) => Math.random() * s.tracks.reduce((t, k) => t + k.seconds, 0));
    this.started = performance.now() / 1000;
    this.nowPlaying = null;

    // Little green LCD on the head unit
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.scroll = 0;
    this.redraw = 0;
  }

  // Scrolls the song title across the display.
  update(dt) {
    if (!this.on) return;
    this.scroll += dt * 70;
    this.redraw -= dt;
    if (this.redraw > 0) return;
    this.redraw = 1 / 20;
    const ctx = this.canvas.getContext('2d');
    const s = STATIONS[this.station];
    ctx.fillStyle = '#071510';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#8dffb8';
    ctx.font = 'bold 46px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${s.freq} FM`, 18, 36);
    ctx.textAlign = 'right';
    ctx.font = '30px monospace';
    ctx.fillText(s.name.toUpperCase(), 494, 38);
    ctx.textAlign = 'left';
    const t = this.nowPlaying;
    const text = t ? `${t.title}  ·  ${t.artist}     ` : 'Tuning…';
    ctx.font = '34px monospace';
    const w = ctx.measureText(text).width;
    const x = 18 - (w > 476 ? this.scroll % w : 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(14, 70, 484, 50);
    ctx.clip();
    ctx.fillText(text, x, 94);
    if (w > 476) ctx.fillText(text, x + w, 94);
    ctx.restore();
    this.texture.needsUpdate = true;
  }

  get on() {
    return this.station >= 0;
  }

  // Off -> each station in turn -> off.
  nextStation() {
    this.station = this.station + 1 < STATIONS.length ? this.station + 1 : -1;
    this.#hiss();
    if (this.on) setTimeout(() => this.#tuneIn(), STATIC_TIME * 700);
    else {
      this.el.pause();
      this.nowPlaying = null;
    }
    return this.label();
  }

  // Jump to the start of the next song on this station.
  skip() {
    if (!this.on) return null;
    const { index, offset } = this.#position(this.station);
    const tracks = STATIONS[this.station].tracks;
    this.clocks[this.station] += tracks[index].seconds - offset;
    this.#hiss();
    setTimeout(() => this.#tuneIn(), STATIC_TIME * 500);
    return this.label();
  }

  label() {
    if (!this.on) return 'Radio off';
    const s = STATIONS[this.station];
    return `${s.freq} ${s.name}`;
  }

  // Where a station's broadcast is right now: which track, how far in.
  #position(i) {
    const tracks = STATIONS[i].tracks;
    const total = tracks.reduce((t, k) => t + k.seconds, 0);
    let t = (this.clocks[i] + performance.now() / 1000 - this.started) % total;
    let index = 0;
    while (t >= tracks[index].seconds) {
      t -= tracks[index].seconds;
      index = (index + 1) % tracks.length;
    }
    return { index, offset: t };
  }

  #tuneIn() {
    if (!this.on) return;
    this.#connect();
    const station = this.station;
    const { index, offset } = this.#position(station);
    const t = STATIONS[station].tracks[index];
    this.nowPlaying = t;
    if (!this.el.src.endsWith(t.src)) this.el.src = t.src;
    const start = () => {
      if (this.station !== station) return;
      this.el.currentTime = Math.min(offset, Math.max(t.seconds - 1, 0));
      this.el.play().catch(() => {});
    };
    if (this.el.readyState >= 1) start();
    else this.el.addEventListener('loadedmetadata', start, { once: true });
  }

  // Route the player through a car-speaker EQ into the van's cabin (muffled from outside).
  #connect() {
    const a = this.audio;
    if (this.out || !a.ctx) return;
    const ctx = a.ctx;
    this.out = S.gain(ctx, VOLUME);
    const source = ctx.createMediaElementSource(this.el);
    S.chain(source, S.filter(ctx, 'highpass', 90, 0.7), S.filter(ctx, 'lowpass', 11000, 0.7), this.out, a.cabin);
  }

  #hiss() {
    const a = this.audio;
    if (!a.ctx || a.ctx.state !== 'running') return;
    const ctx = a.ctx;
    const g = S.gain(ctx, 0);
    const src = S.loop(ctx, a.white);
    S.chain(src, S.filter(ctx, 'bandpass', 3500, 0.6), g, a.cabin);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.03);
    g.gain.setValueAtTime(0.12, now + STATIC_TIME - 0.08);
    g.gain.linearRampToValueAtTime(0, now + STATIC_TIME);
    src.stop(now + STATIC_TIME + 0.05);
  }
}
