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

/**
 * How much time the host just added between two timer snapshots (ms), or 0.
 * A restart or resume gets a fresh `startedAt` and doesn't count; nor does
 * pausing. A clock that had already run out counts from now, not from the past.
 * Changes under five seconds are ignored as rounding noise.
 */
export function addedTimeMs(prev, next, nowMs = Date.now()) {
  if (!prev || !next || prev.startedAt == null || next.startedAt == null) return 0;
  if (prev.startedAt !== next.startedAt) return 0;

  let added = 0;
  if (prev.pausedAt != null && next.pausedAt != null) {
    added = (next.remainingMs ?? 0) - (prev.remainingMs ?? 0);
  } else if (prev.pausedAt == null && next.pausedAt == null) {
    added = parseTime(next.endsAt) - Math.max(parseTime(prev.endsAt), nowMs);
  }
  return added >= 5000 ? added : 0;
}

/** "+5 min" for whole minutes, otherwise "+0:30" / "+1:30". */
export function formatAdded(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 1 && Math.abs(ms - minutes * 60000) < 1500) return `+${minutes} min`;
  const total = Math.round(ms / 1000);
  return `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
