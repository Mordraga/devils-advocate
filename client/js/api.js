// Thin REST wrapper for the Devil's Advocate API (spec section 9).
// draga-server's host mutations are gated by a shared admin token (an
// interim MVP mechanism - see draga-server/app/auth/admin.py - a real
// login flow that sets an HttpOnly cookie is a follow-up). Until that
// exists, the operator's browser has nowhere else to keep it, so it's
// stashed in localStorage rather than baked into this file.

import { API_BASE } from './config.js';
import { parseTime } from './timer.js';

const ADMIN_TOKEN_KEY = 'devils-advocate:admin-token';

function getAdminToken() {
  let token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) {
    token = window.prompt('Admin token (draga-server ADMIN_SESSION_SECRET):') ?? '';
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  }
  return token;
}

async function request(path, options = {}) {
  // /public/* never needs the admin token (spec section 9/10) - overlay,
  // watch, and now invite redemption all hit these from a page that has
  // no host present, so prompting for a credential there would be wrong.
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (!path.startsWith('/public/')) headers['X-Admin-Token'] = getAdminToken();

  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers, ...options });
  if (res.status === 401 && !path.startsWith('/public/')) {
    // Forget the rejected token, otherwise a typo stays cached in
    // localStorage and locks the host out; the next click re-prompts.
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // storage blocked - nothing cached to forget
    }
    throw new Error('admin token rejected - click again to re-enter it');
  }
  if (!res.ok) {
    // The server explains refusals (e.g. "cannot move from LOBBY to
    // REVEAL") in `detail` - surface it instead of just the status code.
    let detail = '';
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = ` - ${body.detail}`;
    } catch {
      // no JSON body
    }
    throw new Error(`${options.method || 'GET'} ${path} failed: ${res.status}${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

export const createSession = (title, createdBy) =>
  request('/sessions', { method: 'POST', body: JSON.stringify({ title, created_by: createdBy }) });

export const getSession = (id) => request(`/sessions/${id}`);

// One call: session + two unnamed seats + first round + an invite per seat.
export const launchSession = (title, createdBy) =>
  request('/sessions/launch', { method: 'POST', body: JSON.stringify({ title, created_by: createdBy }) });

export const getHostState = async (sessionId) => normalizeHostState(await request(`/sessions/${sessionId}/host-state`));

export const addContestant = (sessionId, { displayName, seat, pronouns, avatarUrl, accentColor }) =>
  request(`/sessions/${sessionId}/contestants`, {
    method: 'POST',
    body: JSON.stringify({
      display_name: displayName,
      seat,
      pronouns: pronouns ?? null,
      avatar_url: avatarUrl ?? null,
      accent_color: accentColor ?? null,
    }),
  });

export const createRound = (sessionId) =>
  request(`/sessions/${sessionId}/rounds`, { method: 'POST' });

export const drawTopic = (roundId, filter = {}) =>
  request(`/rounds/${roundId}/draw-topic`, { method: 'POST', body: JSON.stringify(filter) });

export const assignSides = (roundId) =>
  request(`/rounds/${roundId}/assign-sides`, { method: 'POST' });

export const transitionPhase = (roundId, toPhase) =>
  request(`/rounds/${roundId}/transition`, { method: 'POST', body: JSON.stringify({ to_phase: toPhase }) });

export const startTimer = (roundId, durationMs) =>
  request(`/rounds/${roundId}/timer/start`, { method: 'POST', body: JSON.stringify({ duration_ms: durationMs }) });

export const pauseTimer = (roundId) => request(`/rounds/${roundId}/timer/pause`, { method: 'POST' });

export const recordOpeningPoll = (roundId, a, b) =>
  request(`/rounds/${roundId}/polls/opening`, { method: 'POST', body: JSON.stringify({ a, b }) });

export const recordClosingPoll = (roundId, a, b) =>
  request(`/rounds/${roundId}/polls/closing`, { method: 'POST', body: JSON.stringify({ a, b }) });

export const finalizeRound = (roundId) => request(`/rounds/${roundId}/finalize`, { method: 'POST' });

export const voidRound = (roundId) => request(`/rounds/${roundId}/void`, { method: 'POST' });

export const rerollRound = (roundId) => request(`/rounds/${roundId}/reroll`, { method: 'POST' });

export const createInvite = (sessionId, contestantId) =>
  request(`/sessions/${sessionId}/invites`, { method: 'POST', body: JSON.stringify({ contestant_id: contestantId }) });

// No admin token (see request() above) - this is what play.js calls
// with the token from its own invite link, not a host action.
export const redeemInvite = (token) =>
  request('/public/invites/redeem', { method: 'POST', body: JSON.stringify({ token }) });

// A contestant choosing the name everyone will see - also what marks them joined.
export const setContestantName = (token, displayName) =>
  request('/public/invites/profile', { method: 'POST', body: JSON.stringify({ token, display_name: displayName }) });

export const setOverlayVisibility = (sessionId, hidden) =>
  request(`/sessions/${sessionId}/overlay-visibility`, { method: 'POST', body: JSON.stringify({ hidden }) });

// The server's public state payload (PublicSessionStateOut) is
// snake_case JSON; this is the one place that translates it into the
// camelCase shape the rest of the client uses, so REST reads (below) and
// WS envelopes (socket.js) both end up in `state` the same way.
function normalizeContestant(contestant) {
  if (!contestant) return null;
  return {
    id: contestant.id,
    displayName: contestant.display_name,
    pronouns: contestant.pronouns,
    avatarUrl: contestant.avatar_url,
    accentColor: contestant.accent_color,
  };
}

function normalizeRosterEntry(entry) {
  return entry ? { name: entry.display_name, joined: entry.joined } : null;
}

function normalizeTimer(t) {
  return { startedAt: t.started_at, endsAt: t.ends_at, pausedAt: t.paused_at, remainingMs: t.remaining_ms };
}

export function normalizePublicState(raw) {
  return {
    sessionCode: raw.public_code,
    roundId: raw.round_id,
    version: raw.version,
    serverOffsetMs: parseTime(raw.server_time) - Date.now(),
    phase: raw.phase,
    topic: raw.topic && {
      prompt: raw.topic.prompt,
      explainer: raw.topic.explainer,
      sideA: raw.topic.side_a,
      sideB: raw.topic.side_b,
      category: raw.topic.category,
      tags: raw.topic.tags,
    },
    contestants: {
      A: normalizeContestant(raw.contestants.A),
      B: normalizeContestant(raw.contestants.B),
    },
    roster: {
      one: normalizeRosterEntry(raw.roster.one),
      two: normalizeRosterEntry(raw.roster.two),
    },
    timer: {
      startedAt: raw.timer.started_at,
      endsAt: raw.timer.ends_at,
      pausedAt: raw.timer.paused_at,
      remainingMs: raw.timer.remaining_ms,
    },
    winner: raw.winner,
    results: raw.results && {
      openingA: raw.results.opening_a,
      openingB: raw.results.opening_b,
      closingA: raw.results.closing_a,
      closingB: raw.results.closing_b,
      swayA: raw.results.sway_a,
      swayB: raw.results.sway_b,
    },
  };
}

export const getPublicState = async (publicCode) => normalizePublicState(await request(`/public/sessions/${publicCode}/state`));

// The host-only, unmasked view (GET /sessions/{id}/host-state).
export function normalizeHostState(raw) {
  return {
    session: {
      id: raw.session.id,
      publicCode: raw.session.public_code,
      title: raw.session.title,
      status: raw.session.status,
    },
    round: raw.round && {
      id: raw.round.id,
      phase: raw.round.phase,
      status: raw.round.status,
      timer: normalizeTimer(raw.round),
    },
    topic: raw.topic && {
      prompt: raw.topic.prompt,
      explainer: raw.topic.explainer,
      sideA: raw.topic.side_a,
      sideB: raw.topic.side_b,
      category: raw.topic.category,
    },
    contestants: raw.contestants.map((c) => ({
      id: c.id,
      seat: c.seat,
      name: c.display_name,
      joined: c.joined,
      side: c.side,
    })),
    opening: raw.opening,
    closing: raw.closing,
    winner: raw.winner,
    version: raw.version,
    serverOffsetMs: parseTime(raw.server_time) - Date.now(),
  };
}
