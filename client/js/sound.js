// The show's sound kit, synthesized live with the Web Audio API - no audio
// files. Every effect is a small recipe (oscillators + filtered noise shaped
// by envelopes) written against any BaseAudioContext, so the same code plays
// through the speakers and renders offline for testing (see e2e/sound-check.js).
//
// Autoplay rules: browsers only let a page make sound after the visitor
// interacts with it. The OBS overlay is a browser source that allows it, so it
// calls startQuiet(). Viewer and contestant pages offer an "Enable sound"
// toggle (ritual.js wires it) and remember the choice.

const STORAGE_KEY = 'devils-advocate:sound';

// ---- building blocks -------------------------------------------------------

/** Deterministic random numbers, so a recipe sounds the same every time it is rendered. */
function seeded(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rand = seeded(7);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

/** Gain envelope: quick linear attack, then an exponential fall to silence. */
function envelope(ctx, node, t, { gain, attack = 0.005, dur }) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.linearRampToValueAtTime(gain, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** One pitched note; the frequency can glide from `freq` to `freqEnd`. */
function tone(ctx, out, { type = 'sine', freq, freqEnd, t, dur, gain = 0.3, attack = 0.005 }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  envelope(ctx, amp, t, { gain, attack, dur });
  osc.connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A burst of noise through a filter that can sweep from `freq` to `freqEnd`. */
function noise(ctx, out, { t, dur, gain = 0.2, attack = 0.005, filter = 'bandpass', freq = 1000, freqEnd, q = 1 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const amp = ctx.createGain();
  envelope(ctx, amp, t, { gain, attack, dur });
  src.connect(f).connect(amp).connect(out);
  src.start(t, 0, dur + 0.05);
}

// Inharmonic partials are what make a struck bell or gong sound like metal.
const BELL_PARTIALS = [
  [1, 1, 1],
  [2.76, 0.45, 0.6],
  [5.4, 0.22, 0.4],
  [8.93, 0.1, 0.25],
];

function bell(ctx, out, { freq, t, dur = 1.6, gain = 0.3 }) {
  for (const [ratio, level, decay] of BELL_PARTIALS) {
    tone(ctx, out, { freq: freq * ratio, t, dur: dur * decay, gain: gain * level, attack: 0.003 });
  }
}

function bubble(ctx, out, { t, freq, gain = 0.12 }) {
  // A rising blip: the sound of a bubble breaking the surface.
  tone(ctx, out, { freq, freqEnd: freq * 2.2, t, dur: 0.11, gain, attack: 0.008 });
}

// Notes, for chords and arpeggios.
const NOTE = { A3: 220, C4: 261.63, E4: 329.63, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.5 };

// ---- the recipes -----------------------------------------------------------
// Each is (ctx, out, t0, rand) -> length in seconds.

export const RECIPES = {
  // The cauldron churning up a topic: rumble, a rising whoosh, bubbles popping.
  draw(ctx, out, t, rand) {
    tone(ctx, out, { type: 'sine', freq: 48, freqEnd: 70, t, dur: 1.1, gain: 0.32, attack: 0.15 });
    noise(ctx, out, { t, dur: 1.0, gain: 0.22, attack: 0.25, freq: 250, freqEnd: 2200, q: 1.2 });
    for (let i = 0; i < 9; i++) {
      bubble(ctx, out, { t: t + 0.05 + i * 0.1 + rand() * 0.06, freq: 220 + rand() * 380, gain: 0.1 });
    }
    return 1.3;
  },

  // The seal stamping the topic shut: a low thunk, a click, a small metallic ring.
  seal(ctx, out, t) {
    tone(ctx, out, { freq: 130, freqEnd: 38, t, dur: 0.45, gain: 0.7, attack: 0.002 });
    noise(ctx, out, { t, dur: 0.09, gain: 0.35, attack: 0.001, filter: 'lowpass', freq: 1800, freqEnd: 300 });
    bell(ctx, out, { freq: 330, t: t + 0.02, dur: 1.0, gain: 0.16 });
    return 1.1;
  },

  // Sides revealed: a minor chord rising through the air, with a shimmer on top.
  reveal(ctx, out, t) {
    [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.A4, NOTE.C5].forEach((freq, i) => {
      tone(ctx, out, { type: 'triangle', freq, t: t + i * 0.11, dur: 1.5 - i * 0.1, gain: 0.16, attack: 0.03 });
    });
    noise(ctx, out, { t, dur: 0.9, gain: 0.08, attack: 0.3, filter: 'highpass', freq: 2500, freqEnd: 7000, q: 0.7 });
    return 1.7;
  },

  // Preparation begins: one soft bell.
  start(ctx, out, t) {
    bell(ctx, out, { freq: NOTE.A4, t, dur: 1.4, gain: 0.26 });
    return 1.4;
  },

  // Voting opens: a bright two-note chime, going up.
  pollOpen(ctx, out, t) {
    bell(ctx, out, { freq: NOTE.E5, t, dur: 1.0, gain: 0.24 });
    bell(ctx, out, { freq: NOTE.B5, t: t + 0.17, dur: 1.3, gain: 0.24 });
    return 1.5;
  },

  // Voting closes: the same two notes, falling and softer.
  pollClose(ctx, out, t) {
    bell(ctx, out, { freq: NOTE.B5, t, dur: 0.9, gain: 0.2 });
    bell(ctx, out, { freq: NOTE.E5, t: t + 0.17, dur: 1.3, gain: 0.2 });
    return 1.5;
  },

  // A struck gong: the debate begins, or time is up.
  gong(ctx, out, t) {
    bell(ctx, out, { freq: 98, t, dur: 3.2, gain: 0.5 });
    noise(ctx, out, { t, dur: 0.6, gain: 0.12, filter: 'lowpass', freq: 1200, freqEnd: 200 });
    return 3.3;
  },

  // Countdown ticks over the last ten seconds, sharper over the last three.
  tick(ctx, out, t) {
    tone(ctx, out, { type: 'square', freq: 1100, t, dur: 0.035, gain: 0.08, attack: 0.001 });
    return 0.05;
  },
  tickFinal(ctx, out, t) {
    tone(ctx, out, { type: 'square', freq: 1700, t, dur: 0.06, gain: 0.12, attack: 0.001 });
    return 0.08;
  },

  // Time is up (same gong, named for what the cue means).
  timeUp(ctx, out, t, rand) {
    return RECIPES.gong(ctx, out, t, rand);
  },

  // The host voided the round: a cauldron losing heat. A hiss that falls away,
  // a sagging low tone, and bubbles popping further apart and lower each time.
  fizzle(ctx, out, t, rand) {
    noise(ctx, out, { t, dur: 1.7, gain: 0.22, attack: 0.02, filter: 'bandpass', freq: 5200, freqEnd: 600, q: 0.9 });
    noise(ctx, out, { t, dur: 1.0, gain: 0.1, attack: 0.01, filter: 'highpass', freq: 6500, freqEnd: 2500, q: 0.7 });
    tone(ctx, out, { type: 'sawtooth', freq: 180, freqEnd: 38, t, dur: 1.5, gain: 0.12, attack: 0.01 });
    for (let i = 0; i < 7; i++) {
      bubble(ctx, out, { t: t + 0.1 + i * 0.16 + i * i * 0.03 + rand() * 0.05, freq: 240 - i * 22, gain: 0.11 * (1 - i / 9) });
    }
    return 1.8;
  },

  // A vote landing.
  pop(ctx, out, t) {
    tone(ctx, out, { freq: 520, freqEnd: 980, t, dur: 0.07, gain: 0.2, attack: 0.003 });
    return 0.1;
  },

  // The winner: a rising bell arpeggio, a gong underneath, sparkle on top.
  winner(ctx, out, t) {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((freq, i) => {
      bell(ctx, out, { freq, t: t + 0.05 + i * 0.13, dur: 1.6, gain: 0.16 });
    });
    bell(ctx, out, { freq: 98, t, dur: 3.0, gain: 0.32 });
    noise(ctx, out, { t: t + 0.4, dur: 1.4, gain: 0.07, attack: 0.2, filter: 'highpass', freq: 5000, freqEnd: 9000, q: 0.7 });
    return 3.1;
  },
};

export const SOUND_NAMES = Object.keys(RECIPES);

/** Renders one effect offline; returns its samples. For tests and previews. */
export async function renderOffline(name, { sampleRate = 44100, seconds = 4 } = {}) {
  const ctx = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
  RECIPES[name](ctx, ctx.destination, 0, seeded(42));
  const buffer = await ctx.startRendering();
  return buffer.getChannelData(0);
}

// ---- live playback ---------------------------------------------------------

let ctx = null;
let master = null;
let enabled = false;
let volume = 0.7;
const listeners = new Set();

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePreference(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked - the toggle just won't be remembered.
  }
}

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = volume;
  // A gentle limiter so overlapping effects (a gong under a bell arpeggio) never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.ratio.value = 6;
  master.connect(limiter).connect(ctx.destination);
  return ctx;
}

const notify = () => listeners.forEach((fn) => fn(enabled));

export const onChange = (fn) => listeners.add(fn);
export const isEnabled = () => enabled;
export const isSupported = () => Boolean(window.AudioContext || window.webkitAudioContext);
export const wasEnabledBefore = readPreference;

export function setVolume(value) {
  volume = Math.min(1, Math.max(0, Number(value) || 0));
  if (master) master.gain.value = volume;
}

/** Turn sound on. Must be called from a click/tap on pages that need a gesture. */
export async function enable({ remember = true } = {}) {
  const c = ensureContext();
  if (!c) return false;
  try {
    await c.resume();
  } catch {
    return false;
  }
  enabled = c.state === 'running';
  if (enabled && remember) writePreference(true);
  notify();
  return enabled;
}

export function disable({ remember = true } = {}) {
  enabled = false;
  if (remember) writePreference(false);
  notify();
}

/**
 * For the OBS overlay: switch sound on without a click if the browser allows
 * it (OBS does), and if not, on the first click anywhere.
 */
export function startQuiet() {
  const attempt = () => enable({ remember: false });
  attempt();
  const retry = () => {
    if (!enabled) attempt();
    else window.removeEventListener('pointerdown', retry);
  };
  window.addEventListener('pointerdown', retry);
}

/**
 * For viewer/contestant pages: if the visitor turned sound on before, pick it
 * up again on their first tap (browsers won't allow it before that).
 */
export function resumeOnGesture(accept = () => true) {
  if (!readPreference()) return;
  const go = (event) => {
    if (!accept(event)) return;
    window.removeEventListener('pointerdown', go);
    window.removeEventListener('keydown', go);
    enable();
  };
  window.addEventListener('pointerdown', go);
  window.addEventListener('keydown', go);
}

/** Plays an effect, `delay` seconds from now. Silent (never throws) if sound is off. */
export function play(name, { delay = 0 } = {}) {
  const recipe = RECIPES[name];
  if (!recipe || !enabled || !ctx || ctx.state !== 'running') return 0;
  try {
    return recipe(ctx, master, ctx.currentTime + 0.02 + delay, Math.random);
  } catch {
    return 0;
  }
}
