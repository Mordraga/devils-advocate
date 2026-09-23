// Contestant room (spec 5.C). Read-only against server state — this
// page never mutates official state, it only renders it and persists
// scratch notes locally. Identity comes from redeeming an invite token
// (spec section 10), not a guessable query param.

import { subscribe, state } from './state.js';
import { connect } from './socket.js';
import { redeemInvite } from './api.js';
import { formatClock, remainingMs } from './timer.js';

const $ = (id) => document.getElementById(id);
const NOTES_KEY = 'devils-advocate:notes';

let myContestantId = null;
let myDisplayName = null;

function mySide() {
  if (state.contestants.A?.id === myContestantId) return 'A';
  if (state.contestants.B?.id === myContestantId) return 'B';
  return null;
}

function renderTimer() {
  $('timer-display').textContent = formatClock(remainingMs(state.timer, state.serverOffsetMs));
}

function render() {
  $('contestant-name').textContent = myDisplayName ?? '—';

  const side = mySide();
  const position = side === 'A' ? state.topic?.sideA : side === 'B' ? state.topic?.sideB : null;
  $('contestant-stance').textContent = position ?? 'Waiting for reveal…';

  $('topic-prompt').textContent = state.topic?.prompt ?? "The topic hasn't been drawn yet.";
  $('phase-pill').textContent = `Phase: ${state.phase}`;
  renderTimer();

  const pill = $('connection-pill');
  pill.dataset.status = state.connectionStatus;
  pill.textContent = { online: 'Live', connecting: 'Connecting…', stale: 'Reconnecting…', offline: 'Offline' }[state.connectionStatus] ?? state.connectionStatus;
}

function showInviteError(message) {
  $('contestant-name').textContent = 'Invite invalid';
  $('contestant-stance').textContent = message;
}

const notesEl = $('private-notes');
try {
  notesEl.value = localStorage.getItem(NOTES_KEY) ?? '';
} catch {
  // Private-browsing/storage-blocked — notes just won't persist across reloads.
}
notesEl.addEventListener('input', () => {
  try {
    localStorage.setItem(NOTES_KEY, notesEl.value);
  } catch {
    // Ignore — same as above.
  }
});

subscribe(render);
render();
setInterval(renderTimer, 250);

const token = new URLSearchParams(location.search).get('token');
if (!token) {
  showInviteError('This link is missing an invite token.');
} else {
  redeemInvite(token)
    .then((redeemed) => {
      myContestantId = redeemed.contestant_id;
      myDisplayName = redeemed.display_name;
      render();
      connect(redeemed.session_code);
    })
    .catch(() => showInviteError('This invite link is invalid, expired, or has been revoked.'));
}
