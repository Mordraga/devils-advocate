// Shared client state. The server is the sole authority (spec section 1) —
// this module never invents state, it only holds what socket.js/api.js
// hand it and notifies subscribers so render code can react.

export const PHASES = [
  'LOBBY',
  'TOPIC_LOCKED',
  'REVEAL',
  'PREPARATION',
  'OPENING_POLL',
  'DEBATE',
  'CLOSING_POLL',
  'RESULTS',
  'ARCHIVED',
];

export const state = {
  connectionStatus: 'offline', // 'offline' | 'connecting' | 'online' | 'stale'
  sessionCode: null,
  roundId: null,
  version: 0,
  serverOffsetMs: 0, // server clock minus this browser's clock (see timer.js)
  phase: 'LOBBY',
  topic: null, // { prompt, sideA, sideB, category, tags }
  contestants: {
    A: null, // { id, displayName, pronouns, avatarUrl, accentColor } - debate sides, hidden until REVEAL
    B: null,
  },
  roster: {
    one: null, // { name, joined } - who holds each seat (visible in the lobby)
    two: null,
  },
  timer: {
    startedAt: null,
    endsAt: null,
    pausedAt: null,
    remainingMs: null,
  },
  polls: {
    opening: null, // { a, b }
    closing: null, // { a, b }
  },
  poll: { kind: null, open: false, total: 0 }, // audience voting: which poll is open + turnout (never the split)
  openingSplit: null, // { a, b } - the audience's starting point, shown once the opening poll has closed
  winner: null, // 'A' | 'B' | 'draw' | null - only set from RESULTS onward
  results: null, // { openingA, openingB, closingA, closingB, swayA, swayB } - same
  hidden: false, // host's emergency-hide toggle (overlay.visibility_changed)
};

const subscribers = new Set();

export const subscribe = (fn) => subscribers.add(fn);
export const unsubscribe = (fn) => subscribers.delete(fn);
export const notify = () => subscribers.forEach((fn) => fn(state));

// Merges a partial state patch (e.g. the `data` payload of a
// `session.state_changed` envelope) and notifies subscribers.
export function applyPatch(patch) {
  Object.assign(state, patch);
  notify();
}
