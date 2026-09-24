// Renders the OBS overlay (spec 5.B) and, since it "mirrors the overlay"
// (spec 5.D), also drives watch.html — both pages share the same
// `overlay-*` element ids, so this one module renders both. Elements
// watch.html doesn't include (poll indicator, technical pause) are
// looked up defensively and simply skipped if absent.

import { subscribe, state } from './state.js';
import { connect } from './socket.js';
import { formatClock, remainingMs } from './timer.js';

const $ = (id) => document.getElementById(id);

const SECTIONS = [
  'overlay-standby',
  'overlay-topic',
  'overlay-sides',
  'overlay-timer',
  'overlay-poll-indicator',
  'overlay-results',
  'overlay-technical-pause',
];

function sectionsForPhase(phase, hidden) {
  // Emergency hide (spec 5.A "switch to standby card") overrides
  // whatever the phase would normally show.
  if (hidden) return ['overlay-technical-pause'];

  switch (phase) {
    case 'TOPIC_LOCKED':
      return ['overlay-topic'];
    case 'REVEAL':
      return ['overlay-topic', 'overlay-sides'];
    case 'PREPARATION':
    case 'DEBATE':
      return ['overlay-topic', 'overlay-sides', 'overlay-timer'];
    case 'OPENING_POLL':
    case 'CLOSING_POLL':
      return ['overlay-topic', 'overlay-sides', 'overlay-poll-indicator'];
    case 'RESULTS':
    case 'ARCHIVED':
      return ['overlay-results'];
    case 'LOBBY':
    default:
      return ['overlay-standby'];
  }
}

function setConnectionPill(status) {
  const pill = $('connection-pill');
  if (!pill) return;
  pill.dataset.status = status;
  pill.textContent = { online: 'Live', connecting: 'Connecting…', stale: 'Reconnecting…', offline: 'Offline' }[status] ?? status;
  if (pill.classList.contains('stale-indicator')) pill.hidden = status === 'online';
}

// "Alice vs Bob" once both have joined, otherwise how many are in.
function rosterLine() {
  const { one, two } = state.roster;
  if (one?.joined && two?.joined) return `${one.name} vs ${two.name}`;
  const joined = [one, two].filter((c) => c?.joined).length;
  return `Waiting for contestants (${joined}/2 joined)`;
}

// How far chat swung towards the winner's side.
function swayLine() {
  const r = state.results;
  if (!r || state.winner === 'draw') return state.winner === 'draw' ? 'Chat did not move either way' : '';
  const isA = state.winner === 'A';
  const sway = isA ? r.swayA : r.swayB;
  const before = isA ? r.openingA : r.openingB;
  const after = isA ? r.closingA : r.closingB;
  return `Chat swung ${Math.round(Math.abs(sway) * 10) / 10} points: ${Math.round(before * 10) / 10}% to ${Math.round(after * 10) / 10}%`;
}

function renderTimer() {
  const el = $('overlay-timer-display');
  if (el) el.textContent = formatClock(remainingMs(state.timer, state.serverOffsetMs));
}

function render() {
  const visible = new Set(sectionsForPhase(state.phase, state.hidden));
  SECTIONS.forEach((id) => {
    const el = $(id);
    if (el) el.hidden = !visible.has(id);
  });

  if (state.topic) {
    const promptEl = $('overlay-topic-prompt');
    if (promptEl) promptEl.textContent = state.topic.prompt;
    const explainerEl = $('overlay-topic-explainer');
    if (explainerEl) explainerEl.textContent = state.topic.explainer ?? '';
  }

  const rosterEl = $('overlay-roster');
  if (rosterEl) rosterEl.textContent = rosterLine();

  if (state.contestants.A) {
    $('overlay-side-a') && ($('overlay-side-a').textContent = state.topic?.sideA ?? '—');
    $('overlay-contestant-a') && ($('overlay-contestant-a').textContent = state.contestants.A.displayName);
  }
  if (state.contestants.B) {
    $('overlay-side-b') && ($('overlay-side-b').textContent = state.topic?.sideB ?? '—');
    $('overlay-contestant-b') && ($('overlay-contestant-b').textContent = state.contestants.B.displayName);
  }

  $('overlay-phase-label') && ($('overlay-phase-label').textContent = state.phase.replace('_', ' '));
  renderTimer();

  if (state.winner) {
    const winnerEl = $('overlay-winner');
    if (winnerEl) {
      const name = state.contestants[state.winner]?.displayName;
      winnerEl.textContent = state.winner === 'draw' ? 'Draw' : name ?? '—';
    }
    const labelEl = $('overlay-results-label');
    if (labelEl) labelEl.textContent = state.winner === 'draw' ? 'Result' : 'Winner';
    const swayEl = $('overlay-sway');
    if (swayEl) swayEl.textContent = swayLine();
  }

  setConnectionPill(state.connectionStatus);
}

subscribe(render);
render();
setInterval(renderTimer, 250);

// Static hosting only knows query params for now (spec's clean
// /overlay/{session_code} routing needs a real router, added once this
// deploys behind more than GitHub Pages). No `?session=` means nothing
// to connect to yet, not a fallback to the filename.
const sessionCode = new URLSearchParams(location.search).get('session');
if (sessionCode) connect(sessionCode);
