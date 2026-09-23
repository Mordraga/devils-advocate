// Countdown maths. The server stores absolute timestamps (spec section 7)
// and never emits a message per second; every client derives the display
// itself, so this is shared by host, overlay/watch, and contestant pages.

// The server's ISO strings carry microseconds; trim to milliseconds so
// every browser's Date.parse agrees on them.
export function parseTime(iso) {
  return Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1'));
}

// serverOffsetMs = (server clock) - (this browser's clock), measured from
// the `server_time` in each state snapshot, so a wrong local clock doesn't
// skew the countdown.
export function remainingMs(timer, serverOffsetMs = 0, nowMs = Date.now()) {
  if (!timer || timer.startedAt == null) return null;
  if (timer.pausedAt != null) return timer.remainingMs;
  return Math.max(0, parseTime(timer.endsAt) - (nowMs + serverOffsetMs));
}

export function formatClock(ms) {
  if (ms == null) return '--:--';
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
