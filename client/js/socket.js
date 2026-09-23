// WebSocket client for the real-time contract in spec section 11.
// Tracks the envelope `version`; a gap or reconnect triggers a REST
// resync instead of trusting a partial delta (spec section 11/12).

import { applyPatch, state } from './state.js';
import { getPublicState, normalizePublicState } from './api.js';
import { WS_BASE } from './config.js';

const MAX_BACKOFF_MS = 30_000;

let socket = null;
let attempt = 0;
let sessionCode = null;
let reconnectTimer = null;

function scheduleReconnect() {
  const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  attempt += 1;
  reconnectTimer = setTimeout(() => openSocket(sessionCode), delay);
}

async function resync() {
  try {
    const fresh = await getPublicState(sessionCode);
    applyPatch({ ...fresh, connectionStatus: 'online' });
  } catch {
    // Server unreachable — keep rendering the last known state
    // (spec section 12: stale-state indicator, not a blank screen).
    applyPatch({ connectionStatus: 'stale' });
  }
}

function handleEnvelope(envelope) {
  const expectedVersion = state.version + 1;
  if (envelope.version !== expectedVersion) {
    resync();
    return;
  }

  // overlay.visibility_changed isn't a state snapshot - it's a standalone
  // live signal with no persisted column (see sessions.py's
  // set_overlay_visibility), so it doesn't go through normalizePublicState.
  if (envelope.type === 'overlay.visibility_changed') {
    applyPatch({ hidden: envelope.data.hidden, version: envelope.version, connectionStatus: 'online' });
    return;
  }

  // Every other envelope's data is the exact PublicSessionStateOut shape
  // `getPublicState` returns (see api/session_state.py's
  // broadcast_session_state) - same normalizer, so a value arriving by
  // push or by pull ends up identical.
  applyPatch({ ...normalizePublicState(envelope.data), connectionStatus: 'online' });
}

function openSocket(code) {
  sessionCode = code;
  applyPatch({ sessionCode: code, connectionStatus: 'connecting' });

  const ws = new WebSocket(`${WS_BASE}/ws/sessions/${code}`);
  socket = ws;

  ws.addEventListener('open', () => {
    attempt = 0;
    resync();
  });

  ws.addEventListener('message', (event) => {
    try {
      handleEnvelope(JSON.parse(event.data));
    } catch {
      // Malformed frame — ignore rather than crash the render loop.
    }
  });

  ws.addEventListener('close', () => {
    // A socket we deliberately replaced/closed (see disconnect) must not
    // trigger a reconnect to whatever session is current now.
    if (socket !== ws) return;
    applyPatch({ connectionStatus: 'stale' });
    scheduleReconnect();
  });

  ws.addEventListener('error', () => ws.close());
}

export function disconnect() {
  clearTimeout(reconnectTimer);
  attempt = 0;
  const old = socket;
  socket = null; // cleared first so old's close handler sees it was replaced
  old?.close();
}

export function connect(code) {
  disconnect();
  openSocket(code);
}
