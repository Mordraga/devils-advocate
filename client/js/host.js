// Host control panel (spec 5.A), built around one idea: the round's phase
// decides the single thing to do next. guide.js describes each step (pure,
// tested); this file draws it and turns the primary button into the right
// sequence of API calls. Nothing loads until auth.js has signed the host in
// (Twitch login, or the shared admin token as a fallback).

import { PHASES, state, subscribe } from './state.js';
import * as api from './api.js';
import { connect, disconnect } from './socket.js';
import { withApi } from './config.js';
import { formatClock, remainingMs } from './timer.js';
import { DEFAULT_MINUTES, STEPS, checkPoll, complement, describe, pollSideLabels, seatName } from './guide.js';
import { copyText, el, flash, renderStepper } from './ui.js';
import { requireAuth } from './auth.js';

const $ = (id) => document.getElementById(id);
const SAVED_KEY = 'devils-advocate:host-session-id';
const REVEAL_INDEX = PHASES.indexOf('REVEAL');

let sessionId = loadSavedSessionId();
let host = null; // latest host-state from the server (api.normalizeHostState)
const ui = { skipWait: false };
const inviteCache = {}; // seat -> the invite the server handed back (raw token, shown once)
let busy = false;
let structureKey = '';
let overlayHidden = false;

// ---- persistence -----------------------------------------------------------
// A refresh mid-show must not lose the session (spec section 12). The id
// isn't a secret - the admin token is what authorizes anything.

function loadSavedSessionId() {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
}

function saveSessionId() {
  try {
    localStorage.setItem(SAVED_KEY, sessionId);
  } catch {
    // Storage blocked - the session just won't survive a refresh.
  }
}

function forgetSession() {
  sessionId = null;
  host = null;
  for (const seat of Object.keys(inviteCache)) delete inviteCache[seat];
  ui.skipWait = false;
  structureKey = '';
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // ignore
  }
  disconnect();
  render();
}

// ---- small helpers ---------------------------------------------------------

function logEvent(text) {
  const log = $('event-log');
  if (log.firstElementChild?.textContent === 'Nothing yet.') log.replaceChildren();
  const time = new Date().toLocaleTimeString();
  log.prepend(el('li', {}, el('span', { class: 'event-actor', text: time }), ` — ${text}`));
}

function showError(message) {
  const box = $('now-error');
  box.textContent = message;
  box.hidden = false;
}

function hideError() {
  $('now-error').hidden = true;
}

function showLinkFallback(label, url) {
  // Clipboard blocked (e.g. an insecure origin): let the host copy by hand.
  window.prompt(`Copy this ${label}:`, url);
}

function pageLink(path, query) {
  return withApi(new URL(`${path}?${query}`, location.href).href);
}

// ---- loading state ---------------------------------------------------------

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 120);
}

async function refresh() {
  if (!sessionId) return;
  try {
    host = await api.getHostState(sessionId);
  } catch (err) {
    if (/failed: 404/.test(err.message)) {
      logEvent('That session no longer exists on the server');
      forgetSession();
      return;
    }
    throw err;
  }
  // Mid-action, hold the redraw: otherwise the next step's title shows up
  // while the button still says "Working...". runPrimary redraws once at the end.
  if (!busy) render();
}

// ---- the sequences behind each primary button ------------------------------

const current = () => api.getHostState(sessionId);

async function moveTo(target) {
  const h = await current();
  if (h.round.phase !== target) await api.transitionPhase(h.round.id, target);
}

function readMinutes() {
  const minutes = Number($('input-minutes')?.value);
  if (!(minutes > 0)) throw new Error('Enter a number of minutes.');
  return minutes;
}

function readPoll() {
  const result = checkPoll($('poll-a')?.value ?? '', $('poll-b')?.value ?? '');
  if (!result.ok) throw new Error(result.error);
  return result;
}

// Records the poll that is open: the audience tally by default, or the
// numbers typed into the "by hand" fallback when that is expanded.
async function recordPoll(kind) {
  const h = await current();
  if ($('manual-poll')?.open) {
    const poll = readPoll();
    const record = kind === 'opening' ? api.recordOpeningPoll : api.recordClosingPoll;
    await record(h.round.id, poll.a, poll.b);
    return `${poll.a} / ${poll.b} entered by hand`;
  }
  try {
    const round = await api.recordPollFromVotes(h.round.id, kind);
    return `${Number(round[`${kind}_a`])} / ${Number(round[`${kind}_b`])} from ${h.poll.total} votes`;
  } catch (err) {
    if (/no votes/i.test(err.message)) {
      throw new Error('No votes yet. Wait for someone to vote, or open "Enter a result by hand" below.');
    }
    throw err;
  }
}

const actions = {
  async launch() {
    const out = await api.launchSession("Devil's Advocate", 'mordraga');
    sessionId = out.session.id;
    saveSessionId();
    for (const invite of out.invites) inviteCache[invite.seat] = invite;
    ui.skipWait = false;
    overlayHidden = false;
    structureKey = '';
    connect(out.session.public_code);
    logEvent(`Session ${out.session.public_code} started`);
  },

  // Draw a topic and assign sides in one go. Each step checks what is
  // already done, so pressing it again after a failure just carries on.
  async deal() {
    let h = await current();
    if (!h.topic) await api.drawTopic(h.round.id);
    h = await current();
    if (!h.contestants.some((c) => c.side)) await api.assignSides(h.round.id);
    if (h.round.phase === 'LOBBY') await api.transitionPhase(h.round.id, 'TOPIC_LOCKED');
    logEvent('Topic and sides locked in');
  },

  async reveal() {
    await moveTo('REVEAL');
    logEvent('Topic and sides revealed');
  },

  async startPrep() {
    const minutes = readMinutes();
    const h = await current();
    // Timer first, then the phase: everyone's screen switches to a clock
    // that is already running, never to a blank "--:--".
    await api.startTimer(h.round.id, minutes * 60_000);
    await moveTo('PREPARATION');
    logEvent(`Preparation started (${minutes} min)`);
  },

  async startDebate() {
    const minutes = readMinutes();
    const summary = await recordPoll('opening');
    const h = await current();
    await api.startTimer(h.round.id, minutes * 60_000);
    await moveTo('DEBATE');
    logEvent(`Opening vote recorded (${summary}); debate started (${minutes} min)`);
  },

  async closePoll() {
    await moveTo('CLOSING_POLL');
    logEvent('Closing vote open');
  },

  async finish() {
    const summary = await recordPoll('closing');
    const h = await current();
    if (h.round.status === 'live') await api.finalizeRound(h.round.id);
    await moveTo('RESULTS');
    logEvent(`Closing vote recorded (${summary}); winner announced`);
  },

  // A session with no round yet.
  async nextRound() {
    await api.createRound(sessionId);
    structureKey = '';
    logEvent('New round started');
  },

  // The end of a round. The same invite links keep working, so they are kept.
  async newRound() {
    await api.startNextRound(sessionId, false);
    structureKey = '';
    logEvent('New round started - contestants pick their names again');
  },

  async sameContestants() {
    await api.startNextRound(sessionId, true);
    structureKey = '';
    logEvent('New round started with the same contestants');
  },

  async archive() {
    const h = await current();
    await api.archiveRound(h.round.id);
    logEvent('Round archived');
  },
};

async function runPrimary() {
  return runAction($('btn-primary').dataset.action);
}

async function runAction(action) {
  if (busy || !actions[action]) return;
  busy = true;
  hideError();
  render();
  try {
    await actions[action]();
  } catch (err) {
    showError(err.message);
    logEvent(`${action} failed - ${err.message}`);
  } finally {
    busy = false;
    try {
      await refresh();
    } catch (err) {
      showError(err.message);
    }
    render();
  }
}

// Secondary controls: run one call, then refresh; report failures inline.
async function runSecondary(label, fn) {
  hideError();
  try {
    await fn();
    logEvent(label);
    await refresh();
  } catch (err) {
    showError(err.message);
    logEvent(`${label} failed - ${err.message}`);
  }
}

// ---- rendering -------------------------------------------------------------

function renderConnection() {
  const pill = $('connection-pill');
  pill.dataset.status = state.connectionStatus;
  pill.textContent =
    { online: 'Live', connecting: 'Connecting…', stale: 'Reconnecting…', offline: 'Offline' }[state.connectionStatus] ??
    state.connectionStatus;
}

function inviteSignature() {
  return host ? host.contestants.map((c) => `${c.seat}:${c.name}:${c.joined}`).join('|') : '';
}

async function copyInvite(contestant, button) {
  try {
    let invite = inviteCache[contestant.seat];
    if (!invite) {
      invite = await api.createInvite(sessionId, contestant.id);
      inviteCache[contestant.seat] = invite;
    }
    const url = withApi(invite.url);
    if (await copyText(url)) {
      flash(button, 'Copied ✓');
      logEvent(`Copied invite link for ${seatName(contestant)}`);
    } else {
      showLinkFallback('invite link', url);
    }
  } catch (err) {
    showError(err.message);
  }
}

async function removeContestant(contestant) {
  const name = seatName(contestant);
  if (!window.confirm(`Remove ${name}? Their invite link stops working and their seat is emptied. You get a fresh link for the seat.`)) return;
  hideError();
  try {
    inviteCache[contestant.seat] = await api.kickContestant(sessionId, contestant.id);
    logEvent(`Removed ${name}; the seat has a fresh link`);
    await refresh();
  } catch (err) {
    showError(err.message);
  }
}

// Rebuilt only when who-has-joined changes, so a "Copied ✓" flash isn't
// wiped by every live update.
function renderInvites(container, visible) {
  container.hidden = !visible || !host;
  if (container.hidden) return;
  const signature = inviteSignature();
  if (container.dataset.signature === signature) return;
  container.dataset.signature = signature;

  container.replaceChildren(
    ...host.contestants.map((contestant) => {
      const button = el('button', {
        class: 'btn btn-ghost',
        text: `Copy ${contestant.joined ? 'their' : 'invite'} link`,
        attrs: { type: 'button' },
        on: { click: () => copyInvite(contestant, button) },
      });
      return el(
        'div',
        { class: 'invite-row' },
        el('span', { class: 'invite-name', text: seatName(contestant) }),
        el('span', {
          class: `badge ${contestant.joined ? 'badge-gold' : ''}`,
          text: contestant.joined ? '✓ Joined' : 'Waiting to join',
        }),
        button,
        contestant.joined
          ? el('button', {
              class: 'link-btn',
              text: 'Remove',
              attrs: { type: 'button', 'aria-label': `Remove ${seatName(contestant)}` },
              on: { click: () => removeContestant(contestant) },
            })
          : null,
      );
    }),
  );
}

function buildInputs(d) {
  const box = $('now-inputs');
  const rows = [];

  if (d.poll) {
    const previous = d.poll === 'opening' ? host.opening : host.closing;
    const a = el('input', {
      class: 'crypt-input',
      attrs: { id: 'poll-a', type: 'number', min: '0', max: '100', step: 'any', inputmode: 'decimal' },
    });
    const b = el('input', {
      class: 'crypt-input',
      attrs: { id: 'poll-b', type: 'number', min: '0', max: '100', step: 'any', inputmode: 'decimal' },
    });
    if (previous) {
      a.value = previous.a;
      b.value = previous.b;
    }
    // Twitch polls total 100, so typing one side fills in the other.
    a.addEventListener('input', () => {
      b.value = complement(a.value);
    });
    b.addEventListener('input', () => {
      a.value = complement(b.value);
    });
    // Audience voting is the default. Typing a result by hand (say, from a
    // Twitch poll) is a fallback, so it stays tucked away until asked for.
    rows.push(
      el(
        'details',
        { class: 'manual-poll', attrs: { id: 'manual-poll' } },
        el('summary', { text: 'Enter a result by hand instead (e.g. from a Twitch poll)' }),
        el(
          'div',
          { class: 'poll-grid' },
          el('div', {}, el('label', { class: 'field-label', attrs: { for: 'poll-a', id: 'poll-a-label' } }), a),
          el('div', {}, el('label', { class: 'field-label', attrs: { for: 'poll-b', id: 'poll-b-label' } }), b),
        ),
      ),
    );
  }

  if (d.minutes) {
    rows.push(
      el(
        'div',
        { class: 'minutes-row' },
        el('label', { class: 'field-label', text: d.minutes.label, attrs: { for: 'input-minutes' } }),
        el('input', {
          class: 'crypt-input',
          attrs: { id: 'input-minutes', type: 'number', min: '1', step: 'any', value: String(d.minutes.value) },
        }),
      ),
    );
  }

  box.replaceChildren(...rows);
}

function renderTable() {
  const card = $('table-card');
  card.hidden = !host?.topic;
  if (card.hidden) return;

  const revealed = PHASES.indexOf(host.round.phase) >= REVEAL_INDEX;
  $('table-visibility').textContent = revealed ? 'Everyone can see this' : 'Only you can see this yet';
  $('table-prompt').textContent = host.topic.prompt;
  $('table-explainer').textContent = host.topic.explainer ?? '';

  const argues = (side, text) => {
    const contestant = host.contestants.find((c) => c.side === side);
    return el('li', { text: `Side ${side} - ${text}: ${contestant ? seatName(contestant) : 'not assigned yet'}` });
  };
  $('table-sides').replaceChildren(argues('A', host.topic.sideA), argues('B', host.topic.sideB));
}

function timerPhaseLabel(phase) {
  return phase === 'PREPARATION' ? 'Preparation timer' : phase === 'DEBATE' ? 'Debate timer' : 'Timer';
}

function renderTimer(d) {
  const box = $('now-timer');
  box.hidden = !d.timer || !host?.round;
  if (box.hidden) return;

  const timer = host.round.timer;
  $('now-timer-label').textContent = timerPhaseLabel(host.round.phase) + (timer.pausedAt != null ? ' (paused)' : '');
  $('timer-display').textContent = formatClock(remainingMs(timer, host.serverOffsetMs));
  $('btn-timer-toggle').textContent =
    timer.startedAt == null ? 'Start timer' : timer.pausedAt != null ? 'Resume timer' : 'Pause timer';
  // There's nothing to add time to until the clock has been started.
  for (const button of document.querySelectorAll('.btn-add-time')) button.disabled = timer.startedAt == null;
}

// The "or..." choices under the main button (end of a round). Rebuilt only
// when the choices or the busy state change, so a click is never lost to a redraw.
let alternativesKey = '';
function renderAlternatives(d) {
  const box = $('now-alternatives');
  const list = d.alternatives ?? [];
  const key = `${list.map((a) => a.id).join(',')}|${busy}`;
  box.hidden = list.length === 0;
  $('now-archive-link').hidden = !d.archived;
  if (key === alternativesKey) return;
  alternativesKey = key;
  box.replaceChildren(
    ...list.map((choice) =>
      el(
        'div',
        { class: 'now-alternative' },
        el('button', {
          class: 'btn btn-ghost',
          text: choice.label,
          attrs: { type: 'button', 'data-action': choice.id, ...(busy ? { disabled: '' } : {}) },
          on: { click: () => runAction(choice.id) },
        }),
        el('span', { class: 'now-hint', text: choice.hint ?? '' }),
      ),
    ),
  );
}

function render() {
  renderConnection();
  const d = describe(host, ui);

  $('session-line').textContent = host ? `Session ${host.session.publicCode}` : 'No session running';
  $('phase-pill').textContent = host?.round ? `Phase: ${host.round.phase.replace('_', ' ')}` : 'No round';

  $('stepper').hidden = d.index < 0;
  renderStepper($('stepper'), STEPS, d.index);

  $('now-step').textContent = d.index >= 0 ? `Step ${d.index + 1} of ${STEPS.length}` : 'Ready when you are';
  $('now-title').textContent = d.title;
  $('now-blurb').textContent = d.blurb;
  const audience = $('now-audience');
  audience.hidden = !d.audience;
  audience.textContent = d.audience ? `The audience sees: ${d.audience}` : '';

  renderInvites($('now-invites'), Boolean(d.showInvites));
  renderInvites($('links-invites'), Boolean(host) && !d.showInvites);

  // Inputs are rebuilt only when the step changes, so typing survives live updates.
  const key = [d.primary.id, d.poll ?? '', d.minutes?.key ?? ''].join('|');
  if (key !== structureKey && (host || d.primary.id === 'launch')) {
    structureKey = key;
    buildInputs(d);
  }
  if (d.poll && host) {
    const labels = pollSideLabels(host);
    const a = $('poll-a-label');
    const b = $('poll-b-label');
    if (a) a.textContent = `${labels.a} (%)`;
    if (b) b.textContent = `${labels.b} (%)`;
  }

  renderTimer(d);
  renderTable();

  const primary = $('btn-primary');
  primary.textContent = busy ? 'Working…' : d.primary.label;
  primary.disabled = busy || Boolean(d.primary.disabled);
  primary.dataset.action = d.primary.id;
  $('now-hint').textContent = busy ? '' : (d.primary.hint ?? '');
  $('btn-skip-wait').hidden = !d.canSkipWait || ui.skipWait;
  renderAlternatives(d);

  // Secondary controls only make sense with a session running.
  for (const id of ['btn-copy-overlay', 'btn-copy-watch', 'btn-back', 'btn-hide', 'btn-void', 'btn-reroll', 'btn-forget']) {
    $(id).disabled = !host;
  }
}

// ---- wiring ----------------------------------------------------------------

$('btn-primary').addEventListener('click', runPrimary);

$('btn-skip-wait').addEventListener('click', () => {
  ui.skipWait = true;
  render();
});

$('btn-timer-toggle').addEventListener('click', () =>
  runSecondary('Timer changed', async () => {
    const h = await current();
    const timer = h.round.timer;
    if (timer.startedAt == null) {
      const minutes = h.round.phase === 'DEBATE' ? DEFAULT_MINUTES.debate : DEFAULT_MINUTES.prep;
      await api.startTimer(h.round.id, minutes * 60_000);
    } else if (timer.pausedAt == null) {
      await api.pauseTimer(h.round.id);
    } else {
      // The API has start and pause but no resume, so resuming is starting
      // again with whatever time was left.
      await api.startTimer(h.round.id, timer.remainingMs);
    }
  }),
);

// +1 / +5 minutes. Wired by class so a missing button can never stop the rest of
// the page from loading.
for (const button of document.querySelectorAll('.btn-add-time')) {
  const minutes = Number(button.dataset.minutes);
  button.addEventListener('click', () =>
    runSecondary(`Added ${minutes} minute${minutes === 1 ? '' : 's'} to the timer`, async () => {
      const h = await current();
      await api.addTime(h.round.id, minutes * 60_000);
    }),
  );
}

async function copyShowLink(page, label, button) {
  if (!host) return;
  const url = pageLink(page, `session=${host.session.publicCode}`);
  if (await copyText(url)) {
    flash(button, 'Copied ✓');
    logEvent(`Copied ${label} link`);
  } else {
    showLinkFallback(`${label} link`, url);
  }
}

$('btn-copy-overlay').addEventListener('click', (e) => copyShowLink('overlay.html', 'overlay', e.currentTarget));
$('btn-copy-watch').addEventListener('click', (e) => copyShowLink('watch.html', 'audience', e.currentTarget));

$('btn-back').addEventListener('click', () =>
  runSecondary('Went back one phase', async () => {
    const h = await current();
    const previous = PHASES[PHASES.indexOf(h.round.phase) - 1];
    if (!previous) throw new Error('Already at the first phase.');
    await api.transitionPhase(h.round.id, previous);
  }),
);

$('btn-hide').addEventListener('click', () =>
  runSecondary(overlayHidden ? 'Overlay shown' : 'Overlay hidden', async () => {
    overlayHidden = !overlayHidden;
    $('btn-hide').textContent = overlayHidden ? 'Show overlay again' : 'Emergency hide overlay';
    await api.setOverlayVisibility(sessionId, overlayHidden);
  }),
);

$('btn-void').addEventListener('click', () => {
  if (!window.confirm('Void this round? It stays in the log but does not count toward results.')) return;
  runSecondary('Round voided', async () => {
    await api.voidRound((await current()).round.id);
  });
});

$('btn-reroll').addEventListener('click', () => {
  if (!window.confirm('Clear both poll results for this round? Topic and sides stay.')) return;
  runSecondary('Poll results cleared', async () => {
    await api.rerollRound((await current()).round.id);
  });
});

$('btn-forget').addEventListener('click', () => {
  if (!window.confirm('Forget this session on this browser? The session itself keeps running on the server.')) return;
  forgetSession();
  logEvent('Forgot the saved session');
});

let lastVersion = -1;
subscribe(() => {
  renderConnection();
  // Any broadcast means something changed - refetch the host view.
  if (state.version !== lastVersion) {
    lastVersion = state.version;
    if (sessionId) scheduleRefresh();
  }
});

render();
setInterval(() => {
  if (host) renderTimer(describe(host, ui));
}, 250);

// Sign in first, then pick the previous session back up after a refresh.
requireAuth().then(() => {
  if (!sessionId) return;
  refresh()
    .then(() => {
      if (host) {
        connect(host.session.publicCode);
        logEvent(`Resumed session ${host.session.publicCode}`);
      }
    })
    .catch((err) => showError(err.message));
});
