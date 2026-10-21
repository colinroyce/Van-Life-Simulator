// Small Web Audio building blocks. Every sound in the game is synthesized; no audio files.

export function noiseBuffer(ctx, seconds = 2, color = 'white') {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

export function loop(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(0, Math.random() * buffer.duration);
  return src;
}

export function filter(ctx, type, frequency, Q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

export function gain(ctx, value = 0) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function osc(ctx, type, frequency) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = frequency;
  o.start();
  return o;
}

// Connects a chain of nodes in order and returns the last one.
export function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

// Smoothly moves an AudioParam toward a value.
export function glide(ctx, param, value, time = 0.05) {
  param.setTargetAtTime(value, ctx.currentTime, time);
}

function envelope(ctx, g, when, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return when + attack + decay + 0.05;
}

// One-shot filtered noise burst. `sweepTo` slides the filter frequency over the sound.
export function noiseHit(ctx, out, buffer, {
  type = 'bandpass', freq = 1000, q = 1, peak = 0.3, attack = 0.002, decay = 0.1, delay = 0, sweepTo,
}) {
  const when = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = filter(ctx, type, freq, q);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, when + attack + decay);
  const g = gain(ctx);
  chain(src, f, g, out);
  const end = envelope(ctx, g, when, peak, attack, decay);
  src.start(when, Math.random() * (buffer.duration - 0.5));
  src.stop(end);
}

// One-shot tone, optionally gliding in pitch.
export function toneHit(ctx, out, {
  type = 'sine', freq = 440, freqEnd, peak = 0.3, attack = 0.002, decay = 0.1, delay = 0,
}) {
  const when = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, when + attack + decay);
  const g = gain(ctx);
  chain(o, g, out);
  const end = envelope(ctx, g, when, peak, attack, decay);
  o.start(when);
  o.stop(end);
}
