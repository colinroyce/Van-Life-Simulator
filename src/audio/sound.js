import * as S from './synth.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const IDLE_RPM = 750;
const STRIDE = { walk: 0.72, run: 1.15 };

// Low-pass cutoffs (Hz) for what the listener hears from outside and from the engine bay.
const MUFFLE = {
  chase: { outside: 20000, engine: 7000 },
  cockpit: { outside: 1300, engine: 1600 },
  outside: { outside: 20000, engine: 7000 },
  inside: { outside: 900, engine: 1600 }, // opens up as the sliding door opens
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineState = 'off'; // off | starting | running | stopping
    this.engineT = 0;
    this.engineFlare = 0;
    this.slip = 0;
    this.stepAcc = 0;
    this.impactCooldown = 0;
    this.coneCooldown = 0;
    this.birdTimer = 2;
    this.prevDoorT = 0;
    this.prevDoorOpen = false;
    this.prevInside = null;
  }

  // Browsers only allow audio after a user gesture, so this is called from input handlers.
  unlock() {
    if (!this.ctx) this.init(new AudioContext());
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  init(ctx) {
    this.ctx = ctx;
    this.white = S.noiseBuffer(ctx, 2);
    this.brown = S.noiseBuffer(ctx, 2, 'brown');

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 4;
    this.master = S.gain(ctx, this.muted ? 0 : 0.8);
    S.chain(this.master, limiter, ctx.destination);

    this.direct = S.gain(ctx, 1); // sounds right where the player is
    this.direct.connect(this.master);
    this.outsideFilter = S.filter(ctx, 'lowpass', 20000, 0.5);
    this.outside = S.gain(ctx, 1); // the world outside the van
    S.chain(this.outside, this.outsideFilter, this.master);
    this.engineFilter = S.filter(ctx, 'lowpass', 7000, 0.7);
    this.engineBus = S.gain(ctx, 1); // engine and tire roar
    S.chain(this.engineBus, this.engineFilter, this.master);

    this.#buildEngine();
    this.#buildRoad();
    this.#buildHorn();
    this.#buildAmbient();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) S.glide(this.ctx, this.master.gain, this.muted ? 0 : 0.8, 0.05);
    return this.muted;
  }

  // ---------------------------------------------------------------------------
  // Continuous sounds
  // ---------------------------------------------------------------------------
  #buildEngine() {
    const ctx = this.ctx;
    const e = {};
    e.out = S.gain(ctx, 0);
    e.out.connect(this.engineBus);

    // Firing pulses: a sawtooth at the firing frequency through a low-pass gives the diesel rumble.
    e.tone = S.filter(ctx, 'lowpass', 300, 2);
    e.tone.connect(e.out);
    e.fire = S.osc(ctx, 'sawtooth', 25);
    S.chain(e.fire, S.gain(ctx, 0.5), e.tone);
    e.growl = S.osc(ctx, 'square', 50);
    S.chain(e.growl, S.gain(ctx, 0.12), e.tone);
    e.sub = S.osc(ctx, 'sine', 12.5);
    S.chain(e.sub, S.gain(ctx, 0.35), e.out);

    // Diesel clatter: band-passed noise chopped at the firing rate.
    e.clatter = S.gain(ctx, 0);
    S.chain(S.loop(ctx, this.white), S.filter(ctx, 'bandpass', 2600, 1.5), e.clatter, e.out);
    e.pulse = S.osc(ctx, 'square', 25);
    e.pulseDepth = S.gain(ctx, 0);
    S.chain(e.pulse, e.pulseDepth).connect(e.clatter.gain);

    // Turbo whistle under load
    e.turbo = S.osc(ctx, 'sine', 3000);
    e.turboGain = S.gain(ctx, 0);
    S.chain(e.turbo, e.turboGain, e.out);

    // Starter motor: a buzzing whine chopped by the compression strokes
    e.starterLevel = S.gain(ctx, 0);
    const chop = S.gain(ctx, 0.5);
    S.chain(S.osc(ctx, 'sawtooth', 170), S.filter(ctx, 'lowpass', 900, 1), chop, e.starterLevel, this.engineBus);
    S.chain(S.osc(ctx, 'square', 9), S.gain(ctx, 0.5)).connect(chop.gain);

    this.engine = e;
  }

  #buildRoad() {
    const ctx = this.ctx;
    const r = {};
    r.tires = S.gain(ctx, 0);
    S.chain(S.loop(ctx, this.brown), S.filter(ctx, 'bandpass', 420, 0.8), r.tires, this.engineBus);
    r.rough = S.gain(ctx, 0); // off-road rumble
    S.chain(S.loop(ctx, this.white), S.filter(ctx, 'lowpass', 600, 0.7), r.rough, this.engineBus);
    r.wind = S.gain(ctx, 0);
    S.chain(S.loop(ctx, this.white), S.filter(ctx, 'bandpass', 900, 0.4), r.wind, this.outside);

    r.squeal = S.gain(ctx, 0);
    r.squealBands = [2300, 3150].map((f) => {
      const band = S.filter(ctx, 'bandpass', f, 18);
      S.chain(S.loop(ctx, this.white), band, r.squeal);
      return band;
    });
    r.squeal.connect(this.outside);
    this.road = r;
  }

  #buildHorn() {
    const ctx = this.ctx;
    this.horn = S.gain(ctx, 0);
    const tone = S.filter(ctx, 'lowpass', 1800, 1);
    S.chain(tone, this.horn, this.outside);
    for (const f of [415, 505]) S.chain(S.osc(ctx, 'square', f), S.gain(ctx, 0.3), tone);
  }

  #buildAmbient() {
    const ctx = this.ctx;
    const breeze = S.gain(ctx, 0.045);
    S.chain(S.loop(ctx, this.brown), S.filter(ctx, 'lowpass', 400, 0.5), breeze, this.outside);
    S.chain(S.osc(ctx, 'sine', 0.13), S.gain(ctx, 0.025)).connect(breeze.gain);
  }

  // Called every frame with a snapshot of the game.
  update(dt, st) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;

    // Muffling depends on where the listener is.
    const m = MUFFLE[st.listener];
    let outsideCut = m.outside;
    if (st.listener === 'inside') outsideCut = 900 + (20000 - 900) * st.doorT ** 2;
    S.glide(ctx, this.outsideFilter.frequency, outsideCut, 0.08);
    S.glide(ctx, this.engineFilter.frequency, m.engine, 0.08);

    this.#updateEngine(dt, st);
    this.#updateRoad(st);
    S.glide(ctx, this.horn.gain, st.horn ? 0.32 : 0, 0.01);
    this.#triggers(dt, st);

    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.#birdCall();
      this.birdTimer = 3 + Math.random() * 7;
    }
  }

  #updateEngine(dt, st) {
    const ctx = this.ctx;
    const e = this.engine;

    if (st.engineOn && (this.engineState === 'off' || this.engineState === 'stopping')) {
      this.engineState = 'starting';
      this.engineT = 0;
    }
    if (!st.engineOn && (this.engineState === 'running' || this.engineState === 'starting')) {
      this.engineState = 'stopping';
      this.engineT = 0;
    }

    this.engineT += dt;
    this.engineFlare = Math.max(0, this.engineFlare - dt * 1.2);
    let rpm = 0;
    let level = 0;
    if (this.engineState === 'starting') {
      rpm = 200;
      if (this.engineT > 0.85) {
        this.engineState = 'running';
        this.engineFlare = 1; // catches and revs up before settling to idle
      }
    } else if (this.engineState === 'running') {
      rpm = st.rpm + this.engineFlare * 700;
      level = 1;
    } else if (this.engineState === 'stopping') {
      const k = Math.max(0, 1 - this.engineT / 0.7);
      rpm = IDLE_RPM * k;
      level = k;
      if (k === 0) this.engineState = 'off';
    }

    const fire = Math.max(rpm, 60) / 30; // 4 cylinders, 4-stroke
    const load = st.load;
    S.glide(ctx, e.fire.frequency, fire);
    S.glide(ctx, e.growl.frequency, fire * 2);
    S.glide(ctx, e.sub.frequency, fire / 2);
    S.glide(ctx, e.pulse.frequency, fire);
    S.glide(ctx, e.tone.frequency, 180 + fire * 3 + load * 500);
    S.glide(ctx, e.out.gain, level * (0.22 + 0.12 * load + (0.1 * rpm) / 4200));
    const clatter = level * (0.05 + 0.05 * load);
    S.glide(ctx, e.clatter.gain, clatter);
    S.glide(ctx, e.pulseDepth.gain, clatter);
    S.glide(ctx, e.turbo.frequency, 2500 + rpm * 0.9);
    S.glide(ctx, e.turboGain.gain, level * load * clamp((rpm - 1500) / 2500, 0, 1) * 0.012);
    S.glide(ctx, e.starterLevel.gain, this.engineState === 'starting' ? 0.2 : 0, 0.02);
  }

  #updateRoad(st) {
    const ctx = this.ctx;
    const r = this.road;
    const v = Math.abs(st.speed);
    const onGrass = st.vanSurface === 'grass';
    S.glide(ctx, r.tires.gain, (v / 31) ** 0.8 * 0.35 * (onGrass ? 0.6 : 1));
    S.glide(ctx, r.rough.gain, onGrass ? Math.min(v / 10, 1) * 0.22 : 0);
    S.glide(ctx, r.wind.gain, (v / 31) ** 2 * 0.3);

    this.slip += (st.slip - this.slip) * 0.15;
    const squeal = onGrass ? 0 : this.slip * Math.min(v / 8, 1) * 0.22;
    S.glide(ctx, r.squeal.gain, squeal, 0.03);
    const wobble = Math.sin(ctx.currentTime * 31) * 70;
    r.squealBands.forEach((b, i) => S.glide(ctx, b.frequency, (i ? 3150 : 2300) + wobble, 0.02));
  }

  // One-shot sounds driven by changes in the game state.
  #triggers(dt, st) {
    this.impactCooldown -= dt;
    this.coneCooldown -= dt;
    if (st.impact > 1.5 && this.impactCooldown <= 0) {
      this.impact(Math.min(st.impact / 12, 1));
      this.impactCooldown = 0.25;
    }
    if (st.coneHit > 1 && this.coneCooldown <= 0) {
      this.coneKnock(Math.min(st.coneHit / 15, 1));
      this.coneCooldown = 0.06;
    }

    if (st.doorOpen !== this.prevDoorOpen) this.doorSlide();
    if (this.prevDoorT < 1 && st.doorT >= 1) this.doorStop();
    if (this.prevDoorT > 0 && st.doorT <= 0) this.doorSlam();
    this.prevDoorOpen = st.doorOpen;
    this.prevDoorT = st.doorT;

    if (st.walking) {
      if (this.prevInside !== null && st.inside !== this.prevInside) {
        this.footstep(st.footSurface, true);
        this.stepAcc = 0;
      }
      this.stepAcc += st.moved;
      if (this.stepAcc > (st.running ? STRIDE.run : STRIDE.walk)) {
        this.footstep(st.footSurface);
        this.stepAcc = 0;
      }
      this.prevInside = st.inside;
    } else {
      this.prevInside = null;
      this.stepAcc = 0.5; // first step comes quickly
    }
  }

  // ---------------------------------------------------------------------------
  // One-shots
  // ---------------------------------------------------------------------------
  impact(strength) {
    const { ctx, direct: out, white } = this;
    strength *= 2.5;
    S.toneHit(ctx, out, { freq: 90, freqEnd: 40, peak: 0.7 * strength, decay: 0.35 });
    S.noiseHit(ctx, out, white, { type: 'lowpass', freq: 1200, peak: 0.6 * strength, decay: 0.2 });
    S.noiseHit(ctx, out, white, { freq: 600, q: 3, peak: 0.25 * strength, decay: 0.5 }); // panel rattle
  }

  coneKnock(strength) {
    const { ctx, outside: out, white } = this;
    strength *= 2;
    S.toneHit(ctx, out, { type: 'square', freq: 620, freqEnd: 420, peak: 0.08 * strength, decay: 0.06 });
    S.noiseHit(ctx, out, white, { freq: 1800, q: 2, peak: 0.2 * strength, decay: 0.05 });
  }

  doorSlide() {
    const { ctx, direct: out, white, brown } = this;
    S.noiseHit(ctx, out, white, { freq: 3200, q: 2, peak: 0.22, decay: 0.03 }); // latch
    S.toneHit(ctx, out, { type: 'square', freq: 900, freqEnd: 500, peak: 0.04, decay: 0.03 });
    S.noiseHit(ctx, out, brown, { freq: 260, q: 1.2, peak: 0.55, attack: 0.15, decay: 0.9, delay: 0.05, sweepTo: 420 }); // rollers
    S.noiseHit(ctx, out, white, { freq: 1400, q: 3, peak: 0.05, attack: 0.1, decay: 0.8, delay: 0.05 });
  }

  doorStop() {
    const { ctx, direct: out, white } = this;
    S.toneHit(ctx, out, { freq: 110, freqEnd: 70, peak: 0.3, decay: 0.12 });
    S.noiseHit(ctx, out, white, { type: 'lowpass', freq: 900, peak: 0.25, decay: 0.1 });
  }

  doorSlam() {
    const { ctx, direct: out, white } = this;
    S.toneHit(ctx, out, { freq: 85, freqEnd: 45, peak: 1.2, decay: 0.3 });
    S.noiseHit(ctx, out, white, { type: 'lowpass', freq: 1400, peak: 1.0, decay: 0.18 });
    S.noiseHit(ctx, out, white, { freq: 2800, q: 2, peak: 0.3, decay: 0.05, delay: 0.02 }); // latch
    S.noiseHit(ctx, out, white, { freq: 700, q: 4, peak: 0.16, decay: 0.35 }); // rattle
  }

  footstep(surface, heavy = false) {
    const { ctx, direct: out, white } = this;
    const k = heavy ? 2.6 : 1.6;
    const p = 0.9 + Math.random() * 0.2; // vary each step
    if (surface === 'van') {
      S.toneHit(ctx, out, { freq: 95 * p, freqEnd: 60, peak: 0.3 * k, decay: 0.08 });
      S.noiseHit(ctx, out, white, { type: 'lowpass', freq: 800 * p, peak: 0.12 * k, decay: 0.05 });
      S.toneHit(ctx, out, { type: 'triangle', freq: 420 * p, peak: 0.025 * k, decay: 0.12 }); // floor ring
    } else if (surface === 'asphalt') {
      S.noiseHit(ctx, out, white, { freq: 2500 * p, q: 1, peak: 0.12 * k, decay: 0.04 });
      S.noiseHit(ctx, out, white, { type: 'lowpass', freq: 400 * p, peak: 0.18 * k, decay: 0.06 });
    } else {
      S.noiseHit(ctx, out, white, { type: 'highpass', freq: 3000 * p, peak: 0.07 * k, attack: 0.01, decay: 0.09 });
      S.noiseHit(ctx, out, white, { freq: 1200 * p, q: 1, peak: 0.06 * k, attack: 0.01, decay: 0.07 });
      if (heavy) S.toneHit(ctx, out, { freq: 70, freqEnd: 45, peak: 0.2, decay: 0.1 });
    }
  }

  #birdCall() {
    const { ctx, outside: out } = this;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2800 + Math.random() * 1500;
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + Math.random() * 0.1);
      S.toneHit(ctx, out, { freq: f, freqEnd: f * 1.35, peak: 0.025, attack: 0.005, decay: 0.07, delay: i * 0.11 });
    }
  }
}
