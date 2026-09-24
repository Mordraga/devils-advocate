// The ritual layer: turns changes in the shared state into motion (CSS
// classes on <body>, see game.css "RITUAL MOTION") and sound (sound.js).
// Shared by the overlay, watch and contestant pages; cues.js decides *what*
// fires, this file just performs it.
//
// Motion is one-shot: a `ritual-*` class is added for the length of the
// flourish and then removed, and the CSS is written so the element's resting
// style is its finished, readable frame. Nothing here can leave the screen
// stuck mid-animation.

import { state, subscribe } from './state.js';
import { cuesForChange, isLowTime, secondsLeft, snapshot, timerCue } from './cues.js';
import { remainingMs } from './timer.js';
import * as sound from './sound.js';

const RITUAL_MS = 3600;
const POP_MIN_GAP_MS = 120; // a burst of votes is a patter, not a machine gun
const SPARKLES = 16;

let prev = null;
let prevSecond = null;
let clearTimer = null;
let lastPop = 0;

function performRitual(name) {
  const body = document.body;
  for (const cls of [...body.classList]) if (cls.startsWith('ritual-')) body.classList.remove(cls);
  void body.offsetWidth; // restart the CSS animations even for a repeated ritual
  body.classList.add(`ritual-${name}`);
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => body.classList.remove(`ritual-${name}`), RITUAL_MS);
  if (name === 'winner') sparkle();
}

// A burst of sparks around the winner card.
function sparkle() {
  const host = [...document.querySelectorAll('#overlay-results, #results-card')].find((e) => !e.hidden);
  if (!host) return;
  const burst = document.createElement('div');
  burst.className = 'sparkles';
  burst.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < SPARKLES; i++) {
    const spark = document.createElement('i');
    const angle = (i / SPARKLES) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 90 + Math.random() * 130;
    spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    spark.style.setProperty('--delay', `${Math.random() * 0.35}s`);
    burst.append(spark);
  }
  host.append(burst);
  setTimeout(() => burst.remove(), RITUAL_MS);
}

function onState(turnoutPops) {
  // Only judge a change between two snapshots of a live connection. The first
  // one after a load or a reconnect is just catching up, so it stays silent.
  if (state.connectionStatus !== 'online') {
    prev = null;
    prevSecond = null;
    return;
  }
  const next = snapshot(state);
  const cue = cuesForChange(prev, next, { turnoutPops });
  prev = next;

  if (cue.ritual) performRitual(cue.ritual);
  for (const { name, delay } of cue.sounds) {
    if (name === 'pop') {
      const now = Date.now();
      if (now - lastPop < POP_MIN_GAP_MS) continue;
      lastPop = now;
    }
    sound.play(name, { delay });
  }
}

function onClock() {
  const running = state.timer.startedAt != null && state.timer.pausedAt == null && ['PREPARATION', 'DEBATE'].includes(state.phase);
  const second = secondsLeft(remainingMs(state.timer, state.serverOffsetMs), running);
  document.body.classList.toggle('timer-low', isLowTime(second));

  if (state.connectionStatus !== 'online' || state.hidden) {
    prevSecond = null;
    return;
  }
  const cue = timerCue(prevSecond, second);
  prevSecond = second;
  if (cue) sound.play(cue);
}

function wireToggle() {
  const button = document.getElementById('sound-toggle');
  if (!button) return;
  if (!sound.isSupported()) {
    button.hidden = true;
    return;
  }
  const label = (on) => {
    button.textContent = on ? 'Sound on' : 'Enable sound';
    button.setAttribute('aria-pressed', String(on));
  };
  label(false);
  sound.onChange(label);
  button.addEventListener('click', () => (sound.isEnabled() ? sound.disable() : sound.enable()));
  // A remembered "on" needs one tap to wake up; a tap on the button itself
  // must not do that and then immediately toggle it back off.
  sound.resumeOnGesture((event) => !button.contains(event?.target));
}

/**
 * options.autoplay - the OBS overlay: try to make sound with no click.
 * options.turnoutPops - play a pop for every vote that lands (the shared screen).
 */
export function startRitual({ autoplay = false, turnoutPops = false } = {}) {
  const params = new URLSearchParams(location.search);
  if (params.has('volume')) sound.setVolume(params.get('volume'));

  subscribe(() => onState(turnoutPops));
  setInterval(onClock, 250);

  if (autoplay) {
    // ?sound=off silences an overlay that shouldn't make noise (a second scene, say).
    if (params.get('sound') !== 'off') sound.startQuiet();
  } else {
    wireToggle();
  }
}
