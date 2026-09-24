// A small "+5 min" that floats up from the clock and fades when the host adds
// time. It reacts to the timer itself changing (not to a button press), so
// every screen showing the clock - host, contestants, viewers, the overlay -
// pops at the same moment.

import { state, subscribe } from './state.js';
import { addedTimeMs, formatAdded } from './timer.js';

const CLOCKS = '#overlay-timer-display, #timer-display';

function pop(text) {
  const clock = [...document.querySelectorAll(CLOCKS)].find((e) => e.getBoundingClientRect().width > 0);
  if (!clock) return;
  const box = clock.getBoundingClientRect();
  const bubble = document.createElement('div');
  bubble.className = 'time-pop';
  bubble.textContent = text;
  bubble.setAttribute('aria-hidden', 'true');
  bubble.style.left = `${box.left + box.width / 2}px`;
  bubble.style.top = `${box.top}px`;
  document.body.append(bubble);
  bubble.addEventListener('animationend', () => bubble.remove());
  setTimeout(() => bubble.remove(), 3000); // in case animations are off
}

export function startTimerPop() {
  let prev = null;
  subscribe(() => {
    // Compare only two snapshots of a live connection; the first one after a
    // load or reconnect is just catching up.
    if (state.connectionStatus !== 'online') {
      prev = null;
      return;
    }
    const next = { ...state.timer };
    const added = addedTimeMs(prev, next, Date.now() + state.serverOffsetMs);
    if (added > 0) pop(formatAdded(added));
    prev = next;
  });
}
