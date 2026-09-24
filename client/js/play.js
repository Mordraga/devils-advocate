// Contestant room (spec 5.C). Read-only against server state - this page
// never mutates official state. Identity comes from redeeming an invite
// token (spec section 10); the one thing a contestant *does* is choose their
// own display name. copy.js decides what to tell them at each phase.

import { subscribe, state } from './state.js';
import { connect } from './socket.js';
import { redeemInvite, setContestantName } from './api.js';
import { formatClock, remainingMs } from './timer.js';
import { STEPS, describePhase, scoreboardLines } from './copy.js';
import { el, renderStepper } from './ui.js';

const $ = (id) => document.getElementById(id);
const NOTES_KEY = 'devils-advocate:notes:';

let token = null;
let me = null; // { contestantId, seat, name, joined } once the invite is redeemed
let editingName = false;
let notesRound = null;

function mySide() {
  if (!me) return null;
  if (state.contestants.A?.id === me.contestantId) return 'A';
  if (state.contestants.B?.id === me.contestantId) return 'B';
  return null;
}

function opponent() {
  const seat = me?.seat === 'one' ? 'two' : 'one';
  return state.roster[seat];
}

// ---- notes: one box, saved per round in this browser -----------------------

function loadNotesFor(roundId) {
  const box = $('private-notes');
  if (notesRound === roundId) return;
  notesRound = roundId;
  try {
    box.value = localStorage.getItem(NOTES_KEY + (roundId ?? 'lobby')) ?? '';
  } catch {
    box.value = '';
  }
}

$('private-notes').addEventListener('input', (e) => {
  try {
    localStorage.setItem(NOTES_KEY + (notesRound ?? 'lobby'), e.target.value);
  } catch {
    // Storage blocked - notes just won't survive a refresh.
  }
});

// ---- rendering -------------------------------------------------------------

function show(id, visible) {
  $(id).hidden = !visible;
}

function renderTimer(label, ticking) {
  const clock = formatClock(remainingMs(state.timer, state.serverOffsetMs));
  $('timer-display').textContent = clock;
  if (!ticking) return;
  const note = $('timer-note');
  const notStarted = state.timer.startedAt == null;
  note.hidden = !(notStarted || state.timer.pausedAt != null);
  note.textContent = notStarted ? "The host hasn't started the timer yet." : 'The host has paused the timer.';
  $('timer-label').textContent = label;
}

function tick() {
  if (!me) return;
  const label = $('timer-label').textContent;
  if (!$('timer-card').hidden) renderTimer(label, false);
}

function render() {
  const pill = $('connection-pill');
  pill.dataset.status = state.connectionStatus;
  pill.textContent =
    { online: 'Live', connecting: 'Connecting…', stale: 'Reconnecting…', offline: 'Offline' }[state.connectionStatus] ??
    state.connectionStatus;

  if (!me) return;

  const needsName = !me.joined || editingName;
  show('join-card', needsName);
  show('room', me.joined);
  if (!me.joined) return;

  const side = mySide();
  const opp = opponent();
  const phase = describePhase({
    phase: state.phase,
    mySide: side,
    opponentName: opp?.name,
    opponentJoined: Boolean(opp?.joined),
    winner: state.winner,
    results: state.results,
    pollTotal: state.poll.total,
  });

  renderStepper($('stepper'), STEPS, phase.step);

  $('banner').dataset.tone = phase.tone;
  $('banner-headline').textContent = phase.headline;
  $('banner-body').textContent = phase.body;
  $('who-line').textContent = `You're playing as ${me.name}.`;

  // Timer: shown when this phase has one (prep, debate).
  show('timer-card', Boolean(phase.timerLabel));
  if (phase.timerLabel) renderTimer(phase.timerLabel, true);

  // The question + what it means, from REVEAL onward.
  show('topic-card', Boolean(state.topic));
  $('topic-prompt').textContent = state.topic?.prompt ?? '';
  $('topic-explainer').textContent = state.topic?.explainer ?? '';
  $('topic-explainer').hidden = !state.topic?.explainer;

  // Which side is mine - and what the other one argues.
  const dealt = Boolean(state.topic && side);
  show('side-grid', dealt);
  if (dealt) {
    const mine = side === 'A' ? state.topic.sideA : state.topic.sideB;
    const theirs = side === 'A' ? state.topic.sideB : state.topic.sideA;
    $('my-position').textContent = mine;
    $('my-name').textContent = me.name;
    $('their-position').textContent = theirs;
    $('their-name').textContent = opp?.name ?? 'Your opponent';
  }

  // Results, once the host announces them.
  const resultsShown = Boolean(state.winner) && (state.phase === 'RESULTS' || state.phase === 'ARCHIVED');
  show('results-card', resultsShown);
  if (resultsShown) {
    const lines = scoreboardLines({ mySide: side, results: state.results, myName: me.name, opponentName: opp?.name });
    $('results-lines').replaceChildren(...lines.map((text) => el('li', { text })));
  }

  loadNotesFor(state.roundId);
}

// ---- joining / naming ------------------------------------------------------

function showInviteError(message) {
  show('join-card', false);
  show('room', false);
  show('invite-error', true);
  $('invite-error-text').textContent = message;
}

function applyIdentity(redeemed) {
  me = {
    contestantId: redeemed.contestant_id,
    seat: redeemed.seat,
    name: redeemed.display_name,
    joined: redeemed.joined,
  };
}

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('join-name').value.trim();
  const error = $('join-error');
  error.hidden = true;
  if (!name) return;

  const button = $('join-submit');
  button.disabled = true;
  try {
    applyIdentity(await setContestantName(token, name));
    editingName = false;
    render();
  } catch {
    error.textContent = "Couldn't save your name - check your connection and try again.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('btn-change-name').addEventListener('click', () => {
  editingName = true;
  $('join-title').textContent = 'Change your name';
  $('join-blurb').textContent = 'This is the name the host, chat and your opponent see.';
  $('join-name').value = me.name;
  render();
  $('join-name').focus();
});

// ---- start -----------------------------------------------------------------

subscribe(render);
render();
setInterval(tick, 250);

token = new URLSearchParams(location.search).get('token');
if (!token) {
  showInviteError('This link is missing its invite code. Ask the host for a new one.');
} else {
  redeemInvite(token)
    .then((redeemed) => {
      applyIdentity(redeemed);
      connect(redeemed.session_code);
      render();
      if (!me.joined) $('join-name').focus();
    })
    .catch(() => showInviteError('This invite link is invalid, has expired, or was replaced. Ask the host for a new one.'));
}
