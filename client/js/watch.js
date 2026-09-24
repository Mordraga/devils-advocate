// Audience voting on the watch page (the "phones are the controllers" half of
// the show). overlay.js already draws the shared screen and connects the
// socket; this adds the vote buttons that appear while a poll is open.
// Anonymous: one vote per browser per poll, changeable until voting closes.

import { applyPatch, state, subscribe } from './state.js';
import { castVote, getMyVote } from './api.js';
import { getVoterId } from './voter.js';

const $ = (id) => document.getElementById(id);

const roomCode = new URLSearchParams(location.search).get('session');
if (!roomCode) {
  // Nothing to watch without a room - send them to the code box.
  location.replace('index.html');
}

const voterId = getVoterId();
let myVote = null; // 'A' | 'B' | null, for the poll that is open right now
let loadedFor = null; // which poll (round + kind) myVote was last loaded for
let message = null; // a transient problem to show instead of the usual status
let sending = false;

const QUESTIONS = {
  opening: 'Which side are you on right now?',
  closing: "You've heard the debate - which side are you on now?",
};

function sideText(side) {
  return side === 'A' ? state.topic?.sideA : state.topic?.sideB;
}

function render() {
  const room = $('room-code');
  if (state.sessionCode) {
    room.textContent = `Room ${state.sessionCode}`;
    room.hidden = false;
  }

  const open = state.poll.open && Boolean(state.topic);
  $('vote-card').hidden = !open;
  if (!open) {
    myVote = null;
    loadedFor = null;
    message = null;
    return;
  }

  // A new poll (or a page reload) - ask the server what this browser already voted.
  const key = `${state.roundId}:${state.poll.kind}`;
  if (loadedFor !== key) {
    loadedFor = key;
    myVote = null;
    getMyVote(roomCode, voterId)
      .then((mine) => {
        if (loadedFor === key && mine.side) {
          myVote = mine.side;
          render();
        }
      })
      .catch(() => {});
  }

  $('vote-kicker').textContent = state.poll.kind === 'closing' ? 'Final vote' : 'Vote now';
  $('vote-question').textContent = QUESTIONS[state.poll.kind] ?? QUESTIONS.opening;
  $('vote-topic').textContent = state.topic.prompt;
  $('vote-explainer').textContent = state.topic.explainer ?? '';
  $('vote-explainer').hidden = !state.topic.explainer;

  // The shared screen's topic and sides would repeat what the card already
  // says; overlay.js has drawn them by now (it subscribed first), so hide them.
  $('overlay-topic').hidden = true;
  $('overlay-sides').hidden = true;

  for (const side of ['A', 'B']) {
    const lower = side.toLowerCase();
    const button = $(`vote-${lower}`);
    $(`vote-${lower}-text`).textContent = sideText(side) ?? '';
    const by = state.contestants[side]?.displayName;
    $(`vote-${lower}-by`).textContent = by ? `argued by ${by}` : '';
    button.setAttribute('aria-pressed', String(myVote === side));
    button.disabled = sending;
  }

  const total = state.poll.total;
  const turnout = `${total} vote${total === 1 ? '' : 's'} in`;
  if (message) {
    $('vote-status').textContent = message;
  } else if (myVote) {
    $('vote-status').textContent = `Your vote is in. You can change it until voting closes. ${turnout}.`;
  } else {
    $('vote-status').textContent = `Tap a side to vote. ${turnout}.`;
  }
}

async function vote(side) {
  if (sending) return;
  sending = true;
  message = null;
  render();
  try {
    const result = await castVote(roomCode, voterId, side);
    myVote = result.side;
    applyPatch({ poll: { ...state.poll, total: result.total } });
  } catch (err) {
    if (/failed: 409/.test(err.message)) message = 'Voting just closed.';
    else if (/failed: 429/.test(err.message)) message = 'Easy there - try again in a moment.';
    else message = "Couldn't send your vote. Check your connection and try again.";
  } finally {
    sending = false;
    render();
  }
}

$('vote-a').addEventListener('click', () => vote('A'));
$('vote-b').addEventListener('click', () => vote('B'));

subscribe(render);
render();
