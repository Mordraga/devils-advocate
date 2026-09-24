// Thin REST wrapper for the Devil's Advocate API (spec section 9).
// Host calls are authorised one of two ways (see draga-server/app/auth/admin.py):
// a Twitch login, which is an HttpOnly cookie this file never sees (the browser
// sends it because of `credentials: 'include'`), or the shared admin token,
// which the operator's browser keeps in localStorage. auth.js owns signing in;
// this file just attaches whichever credentials exist.

import { API_BASE } from './config.js';
import { parseTime } from './timer.js';

const ADMIN_TOKEN_KEY = 'devils-advocate:admin-token';

function cachedAdminToken() {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token) {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    // storage blocked - the token only lasts until the page closes
  }
}

export function clearAdminToken() {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // storage blocked - nothing cached to forget
  }
}

async function request(path, options = {}) {
  // /public/* needs no credentials (spec section 9/10) - overlay, watch and
  // invite redemption all hit these from pages with no host present.
  const isPublic = path.startsWith('/public/');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (!isPublic) {
    // The custom header is what lets the server trust a cookie-authenticated
    // change: a forged cross-site request can't add it.
    headers['X-Devils-Advocate'] = '1';
    const token = cachedAdminToken();
    if (token) headers['X-Admin-Token'] = token;
  }

  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers, ...options });
  if (res.status === 401 && !isPublic) {
    // Signed out (an expired login, or a rejected token). Forget any cached
    // token so a typo can't lock the host out, and let auth.js show sign-in.
    clearAdminToken();
    window.dispatchEvent(new Event('da-auth-lost'));
    throw new Error('You are signed out - sign in again to continue');
  }
  if (!res.ok) {
    // The server explains refusals (e.g. "cannot move from LOBBY to
    // REVEAL") in `detail` - surface it instead of just the status code.
    let detail = '';
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') {
        detail = ` - ${body.detail}`;
      } else if (Array.isArray(body.detail)) {
        // FastAPI validation errors: [{ loc: ['body', 'prompt'], msg: '...' }]
        const parts = body.detail.slice(0, 3).map((d) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`);
        detail = ` - ${parts.join('; ')}`;
      }
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

// "+1 min" / "+5 min": works on a running, paused or just-expired clock.
export const addTime = (roundId, ms) =>
  request(`/rounds/${roundId}/timer/add`, { method: 'POST', body: JSON.stringify({ duration_ms: ms }) });

export const recordOpeningPoll = (roundId, a, b) =>
  request(`/rounds/${roundId}/polls/opening`, { method: 'POST', body: JSON.stringify({ a, b }) });

export const recordClosingPoll = (roundId, a, b) =>
  request(`/rounds/${roundId}/polls/closing`, { method: 'POST', body: JSON.stringify({ a, b }) });

export const finalizeRound = (roundId) => request(`/rounds/${roundId}/finalize`, { method: 'POST' });

export const voidRound = (roundId) => request(`/rounds/${roundId}/void`, { method: 'POST' });

// Remove whoever holds a seat; returns a fresh invite for the seat.
export const kickContestant = (sessionId, contestantId) =>
  request(`/sessions/${sessionId}/contestants/${contestantId}/kick`, { method: 'POST' });

// End of a round: save it to the archive, or move on (fresh contestants, or the same ones).
export const archiveRound = (roundId) => request(`/rounds/${roundId}/archive`, { method: 'POST' });
export const startNextRound = (sessionId, keepContestants) =>
  request(`/sessions/${sessionId}/next-round`, { method: 'POST', body: JSON.stringify({ keep_contestants: keepContestants }) });

export async function listArchive(limit = 100) {
  const rows = await request(`/rounds/archive?limit=${limit}`);
  return rows.map((row) => ({
    id: row.id,
    sessionTitle: row.session_title,
    archivedAt: row.archived_at,
    completedAt: row.completed_at,
    status: row.summary.status ?? 'complete',
    topic: row.summary.topic && {
      prompt: row.summary.topic.prompt,
      explainer: row.summary.topic.explainer,
      sideA: row.summary.topic.side_a,
      sideB: row.summary.topic.side_b,
      category: row.summary.topic.category,
    },
    names: row.summary.contestants ?? { A: null, B: null },
    winner: row.summary.winner ?? null,
    winnerName: row.summary.winner_name ?? null,
    opening: row.summary.opening ?? null,
    closing: row.summary.closing ?? null,
    sway: row.summary.sway ?? null,
  }));
}

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

// Topic administration (host only).
export const listTopics = () => request('/topics');
export const createTopic = (topic) => request('/topics', { method: 'POST', body: JSON.stringify(topic) });
export const updateTopic = (id, changes) =>
  request(`/topics/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
export const exportTopics = () => request('/topics/export');
export const importTopics = (topics) =>
  request('/topics/import', { method: 'POST', body: JSON.stringify({ topics }) });

// ---- who is signed in ------------------------------------------------------

export async function getAuth() {
  const body = await request('/auth/me');
  return {
    twitchEnabled: body.twitch_enabled,
    authenticated: body.authenticated,
    via: body.via,
    login: body.login,
    displayName: body.display_name,
  };
}

export const signOut = () => request('/auth/logout', { method: 'POST' });

/** Where to send the browser to log in with Twitch; it comes back to `returnTo`. */
export const twitchLoginUrl = (returnTo) => `${API_BASE}/auth/twitch/login?return=${encodeURIComponent(returnTo)}`;

export const getPublicSession = (code) => request(`/public/sessions/${code}`);

// Audience voting (public - no admin token): one vote per browser per poll,
// changeable until the host closes voting.
export const castVote = (code, voterId, side) =>
  request(`/public/sessions/${code}/vote`, { method: 'POST', body: JSON.stringify({ voter_id: voterId, side }) });

export const getMyVote = (code, voterId) =>
  request(`/public/sessions/${code}/my-vote?voter_id=${encodeURIComponent(voterId)}`);

// Host: close voting by recording the tally as this poll's result.
export const recordPollFromVotes = (roundId, kind) =>
  request(`/rounds/${roundId}/polls/${kind}/from-votes`, { method: 'POST' });

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
    poll: { kind: raw.poll.kind, open: raw.poll.open, total: raw.poll.total },
    openingSplit: raw.opening_split && { a: raw.opening_split.a, b: raw.opening_split.b },
    winner: raw.winner,
    voided: Boolean(raw.voided),
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
    poll: { kind: raw.poll.kind, total: raw.poll.total },
    winner: raw.winner,
    version: raw.version,
    serverOffsetMs: parseTime(raw.server_time) - Date.now(),
  };
}
