// Which sound and which motion belong to which moment of the show. Pure
// (no DOM, no audio) so it can be unit tested; ritual.js does the playing.
//
// Rule of thumb: a cue fires only on a *change* the viewer just watched
// happen. The first snapshot after a page load or a reconnect never fires
// anything, so opening the page mid-debate doesn't clang at you.

import { PHASES } from './state.js';

const order = (phase) => PHASES.indexOf(phase);

/** The bits of shared state that cues care about. */
export function snapshot(state) {
  return {
    phase: state.phase,
    hidden: Boolean(state.hidden),
    voided: Boolean(state.voided),
    pollOpen: Boolean(state.poll?.open),
    pollKind: state.poll?.kind ?? null,
    pollTotal: state.poll?.total ?? 0,
    winner: state.winner ?? null,
  };
}

// What each phase is greeted with when the show moves *forward* into it.
// `delay` is seconds after the change (the seal lands after the draw).
const ENTERING = {
  TOPIC_LOCKED: { ritual: 'lock', sounds: [{ name: 'draw', delay: 0 }, { name: 'seal', delay: 0.9 }] },
  REVEAL: { ritual: 'reveal', sounds: [{ name: 'reveal', delay: 0 }] },
  // Prep and the opening vote start together: the bell, then the voting chime.
  PREPARATION: { ritual: 'prep', sounds: [{ name: 'start', delay: 0 }, { name: 'pollOpen', delay: 1.1 }] },
  DEBATE: { ritual: 'debate', sounds: [{ name: 'gong', delay: 0 }] },
  CLOSING_POLL: { ritual: 'poll', sounds: [{ name: 'pollOpen', delay: 0 }] },
};

/**
 * What to play for the change from `prev` to `next` (both `snapshot`s).
 * Returns { sounds: [{ name, delay }], ritual: string | null }.
 * `turnoutPops` is true where each new vote should make a sound (the shared
 * screen), false where the voter already hears their own tap (the phone).
 */
export function cuesForChange(prev, next, { turnoutPops = false } = {}) {
  const none = { sounds: [], ritual: null };
  if (!prev || !next) return none;

  // The host's emergency hide is a quiet cut, not a show moment.
  if (next.hidden || prev.hidden) return none;

  // The host voided the round: the cauldron fizzles out. (A voided round makes
  // no further show sounds - the countdown stops ticking too, see ritual.js.)
  if (next.voided && !prev.voided) return { ritual: 'void', sounds: [{ name: 'fizzle', delay: 0 }] };
  if (next.voided) return none;

  if (next.phase !== prev.phase) {
    // Stepping backwards (a correction) or into the archive stays silent.
    if (order(next.phase) < order(prev.phase)) return none;
    if (next.phase === 'RESULTS') {
      const draw = next.winner === 'draw';
      return { ritual: 'winner', sounds: [{ name: draw ? 'gong' : 'winner', delay: 0 }] };
    }
    return ENTERING[next.phase] ?? none;
  }

  // Voting closed without the phase moving (the host recorded the tally).
  if (prev.pollOpen && !next.pollOpen) {
    return { ritual: 'pollClosed', sounds: [{ name: 'pollClose', delay: 0 }] };
  }

  if (turnoutPops && next.pollOpen && prev.pollOpen && next.pollKind === prev.pollKind && next.pollTotal > prev.pollTotal) {
    return { ritual: null, sounds: [{ name: 'pop', delay: 0 }] };
  }

  return none;
}

/**
 * Countdown ticks. `prevSecond` / `nextSecond` are the whole seconds left
 * (ceil) at the previous and current check, or null when there is no running
 * clock. Ticks over the last ten seconds, sharper over the last three, and a
 * gong when it reaches zero.
 */
export function timerCue(prevSecond, nextSecond) {
  if (prevSecond == null || nextSecond == null || prevSecond === nextSecond) return null;
  if (nextSecond > prevSecond) return null; // the host added time or restarted it
  if (nextSecond === 0) return 'timeUp';
  if (nextSecond <= 3) return 'tickFinal';
  if (nextSecond <= 10) return 'tick';
  return null;
}

/** Whole seconds left, or null unless the clock is actually running. */
export function secondsLeft(remainingMs, running) {
  if (!running || remainingMs == null) return null;
  return Math.ceil(remainingMs / 1000);
}

/** True for the last ten seconds of a running clock (drives the red pulse). */
export const isLowTime = (second) => second != null && second > 0 && second <= 10;
