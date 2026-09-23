// Host control panel (spec 5.A). Wires each control to its REST call
// against the draga-server session/round endpoints. Auth is a shared
// admin token (api.js prompts for it once, then caches it in
// localStorage) - not the real per-host login spec section 10 describes.

import { PHASES, applyPatch, state, subscribe } from './state.js';
import * as api from './api.js';
import { connect } from './socket.js';
import { withApi } from './config.js';
import { formatClock, remainingMs } from './timer.js';

const $ = (id) => document.getElementById(id);

// What the host is currently running. Persisted to localStorage so a page
// refresh mid-show picks the session back up (spec section 12: refreshing
// must not lose the active match). Ids aren't secrets - the admin token
// is what authorizes anything.
const SAVED_KEY = 'devils-advocate:host-session';
let sessionId = null;
let roundId = null;
let contestants = { one: null, two: null }; // { id, name } per seat

function saveHostSession() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ sessionId, roundId, contestants }));
  } catch {
    // Storage blocked - the session just won't survive a refresh.
  }
}

function loadHostSession() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY));
  } catch {
    return null;
  }
}

function forgetHostSession() {
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // ignore
  }
}

function logEvent(text) {
  const log = $('event-log');
  if (log.firstElementChild?.textContent === 'No events yet.') log.innerHTML = '';
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="event-actor">${time}</span> — ${text}`;
  log.prepend(li);
}

// Round-returning endpoints all send back the same shape (phase, timer
// fields, etc.) - feeding it into the shared state keeps phase-pill/
// timer-display current without a separate local copy.
function applyRound(round) {
  applyPatch({
    phase: round.phase,
    timer: {
      startedAt: round.started_at,
      endsAt: round.ends_at,
      pausedAt: round.paused_at,
      remainingMs: round.remaining_ms,
    },
  });
}

async function run(label, fn) {
  logEvent(`${label}…`);
  try {
    return await fn();
  } catch (err) {
    logEvent(`${label} failed — ${err.message}`);
    return null;
  }
}

async function resumeSession() {
  const saved = loadHostSession();
  if (!saved?.sessionId) throw new Error('no saved session in this browser');

  let session;
  try {
    session = await api.getSession(saved.sessionId);
  } catch (err) {
    forgetHostSession();
    throw err;
  }

  sessionId = session.id;
  roundId = session.current_round_id ?? saved.roundId;
  contestants = saved.contestants ?? { one: null, two: null };
  $('input-contestant-a').value = contestants.one?.name ?? '';
  $('input-contestant-b').value = contestants.two?.name ?? '';

  // Connecting also pulls the current phase/timer, so the host sees the
  // same state the overlay does.
  connect(session.public_code);
  logEvent(`Resumed session ${session.public_code}`);
}

$('btn-create-session').addEventListener('click', () =>
  run('Create session', async () => {
    const session = await api.createSession('Devil\'s Advocate', 'mordraga');
    sessionId = session.id;
    contestants = { one: null, two: null };
    logEvent(`Session created (${session.public_code})`);

    const round = await api.createRound(sessionId);
    roundId = round.id;
    saveHostSession();
    connect(session.public_code);
    applyRound(round);
    logEvent('Round created');
  })
);

$('btn-resume-session').addEventListener('click', () => run('Resume session', resumeSession));

$('btn-save-contestants').addEventListener('click', () =>
  run('Save contestants', async () => {
    if (!sessionId) throw new Error('no active session');
    const nameOne = $('input-contestant-a').value;
    const nameTwo = $('input-contestant-b').value;
    const one = await api.addContestant(sessionId, { seat: 'one', displayName: nameOne });
    const two = await api.addContestant(sessionId, { seat: 'two', displayName: nameTwo });
    contestants = { one: { id: one.id, name: nameOne }, two: { id: two.id, name: nameTwo } };
    saveHostSession();
  })
);

$('btn-draw-topic').addEventListener('click', () =>
  run('Draw topic', async () => {
    if (!roundId) throw new Error('no active round');
    applyRound(await api.drawTopic(roundId));
  })
);

$('btn-assign-sides').addEventListener('click', () =>
  run('Assign sides', async () => applyRound(await api.assignSides(roundId)))
);

$('btn-reveal').addEventListener('click', () =>
  run('Reveal', async () => applyRound(await api.transitionPhase(roundId, 'REVEAL')))
);

$('btn-phase-advance').addEventListener('click', () =>
  run('Advance phase', async () => {
    const to = PHASES[PHASES.indexOf(state.phase) + 1];
    if (!to) throw new Error(`${state.phase} has no next phase`);
    applyRound(await api.transitionPhase(roundId, to));
  })
);

$('btn-phase-back').addEventListener('click', () =>
  run('Previous phase', async () => {
    const to = PHASES[PHASES.indexOf(state.phase) - 1];
    if (!to) throw new Error(`${state.phase} has no previous phase`);
    applyRound(await api.transitionPhase(roundId, to));
  })
);

// The API has start and pause but no resume (spec section 9), so resuming
// is just starting again with whatever time was left when it was paused.
$('btn-timer-start').addEventListener('click', () =>
  run('Start timer', async () => {
    const { pausedAt, remainingMs: left } = state.timer;
    const durationMs = pausedAt != null && left > 0 ? left : (Number($('input-timer-minutes').value) || 15) * 60_000;
    applyRound(await api.startTimer(roundId, durationMs));
  })
);

$('btn-timer-pause').addEventListener('click', () => run('Pause timer', async () => applyRound(await api.pauseTimer(roundId))));

$('btn-finalize').addEventListener('click', () =>
  run('Finalize round', async () => {
    await api.recordOpeningPoll(roundId, Number($('input-opening-a').value), Number($('input-opening-b').value));
    await api.recordClosingPoll(roundId, Number($('input-closing-a').value), Number($('input-closing-b').value));
    const round = await api.finalizeRound(roundId);
    applyRound(round);
    // state.winner is 'A' | 'B' | 'draw' (see overlay.js); the API only
    // gives back a contestant id, so map it against the round's own
    // side assignments rather than duplicating that logic here.
    let winner = 'draw';
    if (round.winner_contestant_id === round.side_a_contestant_id) winner = 'A';
    else if (round.winner_contestant_id === round.side_b_contestant_id) winner = 'B';
    applyPatch({ winner });
  })
);

$('btn-void').addEventListener('click', () => run('Void round', () => api.voidRound(roundId)));
$('btn-reroll').addEventListener('click', () =>
  run('Reroll', async () => applyRound(await api.rerollRound(roundId)))
);

let overlayHidden = false;
$('btn-emergency-hide').addEventListener('click', () =>
  run(overlayHidden ? 'Show overlay' : 'Emergency hide overlay', async () => {
    if (!sessionId) throw new Error('no active session');
    overlayHidden = !overlayHidden;
    await api.setOverlayVisibility(sessionId, overlayHidden);
  })
);

async function copyLink(url, label) {
  try {
    await navigator.clipboard.writeText(url);
    logEvent(`Copied ${label}`);
  } catch {
    logEvent(`${label}: ${url}`);
  }
}

document.querySelectorAll('[data-copy-url]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const surface = btn.dataset.copyUrl;
    if (!state.sessionCode) return logEvent('Create or resume a session first');
    // These open in other browsers (OBS, viewers) that don't share this
    // one's saved API address, so it travels in the link.
    const url = withApi(`${location.origin}/${surface}.html?session=${state.sessionCode}`);
    return copyLink(url, `${surface} URL`);
  });
});

// Contestant links are real invite tokens (spec section 10), not a
// guessed URL - each one is minted server-side and shown exactly once.
async function inviteContestant(seat, label) {
  return run(`Invite ${label}`, async () => {
    if (!sessionId) throw new Error('no active session');
    const contestant = contestants[seat];
    if (!contestant) throw new Error('save contestants first');
    const invite = await api.createInvite(sessionId, contestant.id);
    await copyLink(withApi(invite.url), `${label} invite (expires ${new Date(invite.expires_at).toLocaleString()})`);
  });
}

$('btn-invite-one').addEventListener('click', () => inviteContestant('one', 'Contestant One'));
$('btn-invite-two').addEventListener('click', () => inviteContestant('two', 'Contestant Two'));

function renderTimer() {
  $('timer-display').textContent = formatClock(remainingMs(state.timer, state.serverOffsetMs));
}

function render() {
  $('connection-pill').dataset.status = state.connectionStatus;
  $('connection-pill').textContent = { online: 'Live', connecting: 'Connecting…', stale: 'Reconnecting…', offline: 'Offline' }[state.connectionStatus] ?? state.connectionStatus;
  $('phase-pill').textContent = `Phase: ${state.phase}`;
  renderTimer();
}

subscribe(render);
render();
setInterval(renderTimer, 250);

// Pick the previous session back up on refresh (only if this browser has
// one saved, so a first visit doesn't prompt for a token or log a failure).
if (loadHostSession()) run('Resume session', resumeSession);
