// What the host should do next. Pure functions - no DOM, no network - so
// the logic that decides "which button, and why is it disabled" can be
// checked without a browser (see client/tests/guide.test.mjs).
//
// The show is driven by the round's phase; each phase has exactly one
// primary action that moves it forward. host.js turns that action id into
// the right sequence of API calls.

export const STEPS = [
  'Invite',
  'Locked',
  'Reveal',
  'Prep',
  'Opening vote',
  'Debate',
  'Closing vote',
  'Results',
];

const PHASE_STEP = {
  LOBBY: 0,
  TOPIC_LOCKED: 1,
  REVEAL: 2,
  PREPARATION: 3,
  OPENING_POLL: 4,
  DEBATE: 5,
  CLOSING_POLL: 6,
  RESULTS: 7,
  ARCHIVED: 7,
};

export const DEFAULT_MINUTES = { prep: 15, debate: 10 };

const SEAT_LABEL = { one: 'Contestant One', two: 'Contestant Two' };

export function seatName(contestant) {
  return contestant.joined ? contestant.name : SEAT_LABEL[contestant.seat] ?? 'A contestant';
}

function sideLabel(host, side) {
  const name = host.contestants.find((c) => c.side === side);
  const text = side === 'A' ? host.topic?.sideA : host.topic?.sideB;
  return name && text ? `${seatName(name)}: ${text}` : `Side ${side}`;
}

export function pollSideLabels(host) {
  return { a: sideLabel(host, 'A'), b: sideLabel(host, 'B') };
}

// "Alice", "Alice and Bob", "A, B and C"
function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "37 votes in so far." - the host sees turnout, never the split. */
export function turnoutHint(total) {
  if (!total) return 'No votes yet.';
  return `${total} vote${total === 1 ? '' : 's'} in so far.`;
}

export function winnerText(host) {
  if (!host.winner) return null;
  if (host.winner === 'draw') return 'The round was a draw';
  const winner = host.contestants.find((c) => c.side === host.winner);
  return winner ? `${seatName(winner)} won` : `Side ${host.winner} won`;
}

/**
 * @param host  normalized host state (api.normalizeHostState), or null when
 *              no session is running.
 * @param ui    { skipWait: boolean } - the host chose to start without
 *              waiting for everyone to join.
 */
export function describe(host, ui = {}) {
  if (!host) {
    return {
      index: -1,
      title: 'Start a session',
      blurb: 'This creates the session and two invite links, one per contestant.',
      audience: null,
      primary: { id: 'launch', label: 'Start a session', disabled: false },
    };
  }

  if (!host.round) {
    return {
      index: 0,
      title: 'No round yet',
      blurb: 'This session has no round in progress.',
      audience: null,
      primary: { id: 'nextRound', label: 'Create a round', disabled: false },
    };
  }

  const phase = host.round.phase;
  const index = PHASE_STEP[phase] ?? 0;
  const base = { index, phase, minutes: null, poll: null, timer: false };

  if (host.round.status === 'void' && phase !== 'ARCHIVED') return endOfRound(host, base);

  switch (phase) {
    case 'LOBBY': {
      const waiting = host.contestants.filter((c) => !c.joined).map(seatName);
      const everyoneIn = waiting.length === 0;
      const canGo = everyoneIn || ui.skipWait;
      return {
        ...base,
        title: 'Invite your contestants',
        blurb: 'Send each contestant their invite link. They choose their own name when they join.',
        audience: 'The overlay shows the cauldron on standby.',
        showInvites: true,
        canSkipWait: !everyoneIn,
        primary: {
          id: 'deal',
          label: 'Draw topic & sides',
          disabled: !canGo,
          hint: everyoneIn
            ? 'Both contestants are in.'
            : ui.skipWait
              ? `Starting without ${listNames(waiting)}.`
              : `Waiting for ${listNames(waiting)} to join.`,
        },
      };
    }
    case 'TOPIC_LOCKED':
      return {
        ...base,
        title: 'Topic locked in',
        blurb: 'The topic and sides are chosen, and only you can see them. Tell the contestants it is coming, then reveal.',
        audience: 'Nothing yet - the topic is still hidden.',
        primary: { id: 'reveal', label: 'Reveal topic & sides', disabled: false },
      };
    case 'REVEAL':
      return {
        ...base,
        title: 'Topic revealed',
        blurb: 'Everyone can see the topic and who argues what. Give them a moment to read, then start prep.',
        audience: 'The topic and both sides.',
        minutes: { key: 'prep', label: 'Prep minutes', value: DEFAULT_MINUTES.prep },
        primary: { id: 'startPrep', label: 'Start preparation', disabled: false },
      };
    case 'PREPARATION':
      return {
        ...base,
        title: 'Contestants are preparing',
        blurb: 'When the prep timer runs out, or you are ready, open the opening vote.',
        audience: 'The sides and the prep countdown.',
        timer: true,
        primary: { id: 'openPoll', label: 'Open the opening vote', disabled: false, hint: 'Viewers get the vote buttons straight away.' },
      };
    case 'OPENING_POLL':
      return {
        ...base,
        title: 'Opening vote',
        blurb: 'The audience is voting on the watch page. When enough people have voted, close voting and the result is recorded for you. This is the starting point the winner is measured from.',
        audience: 'Vote buttons on the watch page; the room code and vote count on the overlay.',
        poll: 'opening',
        minutes: { key: 'debate', label: 'Debate minutes', value: DEFAULT_MINUTES.debate },
        primary: {
          id: 'startDebate',
          label: 'Close voting & start debate',
          disabled: false,
          hint: turnoutHint(host.poll?.kind === 'opening' ? host.poll.total : 0),
        },
      };
    case 'DEBATE':
      return {
        ...base,
        title: 'Debate',
        blurb: 'The contestants are arguing. When time is up, open the closing vote.',
        audience: 'The sides and the debate countdown.',
        timer: true,
        primary: { id: 'closePoll', label: 'Open the closing vote', disabled: false, hint: 'Viewers get the vote buttons straight away.' },
      };
    case 'CLOSING_POLL':
      return {
        ...base,
        title: 'Closing vote',
        blurb: 'The audience votes again. Close voting to record the result and announce who moved the crowd furthest.',
        audience: 'Vote buttons on the watch page; the room code and vote count on the overlay.',
        poll: 'closing',
        primary: {
          id: 'finish',
          label: 'Close voting & reveal winner',
          disabled: false,
          hint: turnoutHint(host.poll?.kind === 'closing' ? host.poll.total : 0),
        },
      };
    case 'RESULTS':
    case 'ARCHIVED':
    default:
      return endOfRound(host, base);
  }
}

/**
 * A finished round (results announced, archived, or voided) has three ways on:
 * a new round with fresh contestants (the default - the seats are cleared and
 * everyone picks a name again), the same contestants with a new topic, or
 * archiving the round and stopping there.
 */
function endOfRound(host, base) {
  const voided = host.round.status === 'void';
  const archived = host.round.phase === 'ARCHIVED';

  const alternatives = [
    {
      id: 'sameContestants',
      label: 'Same contestants, new topic',
      hint: 'Keeps both names. You draw a fresh topic.',
    },
  ];
  if (!archived) {
    alternatives.push({
      id: 'archive',
      label: 'Archive this round',
      hint: 'Saves it to the archive and stops here.',
    });
  }

  let title = winnerText(host) ?? 'Results';
  let blurb = 'The winner has been announced. Choose what happens next.';
  if (voided) {
    title = 'This round was voided';
    blurb = 'It stays in the log but does not count. Choose what happens next.';
  } else if (archived) {
    blurb = 'Saved to the archive. Ready for the next round when you are.';
  }

  return {
    ...base,
    title: archived && !voided ? 'Round archived' : title,
    blurb,
    audience: 'The winner and the audience swing.',
    archived,
    primary: {
      id: 'newRound',
      label: 'New round, new contestants',
      disabled: false,
      hint: 'Clears both names. Contestants pick a name again with the same links.',
    },
    alternatives,
  };
}

// ---- poll entry --------------------------------------------------------

export function complement(value) {
  const n = Number(value);
  if (value === '' || Number.isNaN(n)) return '';
  return String(Math.round((100 - n) * 10) / 10);
}

/** Checks the two percentages a host typed in. */
export function checkPoll(aRaw, bRaw) {
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (aRaw === '' || bRaw === '' || Number.isNaN(a) || Number.isNaN(b)) {
    return { ok: false, error: 'Enter both percentages.' };
  }
  if (a < 0 || a > 100 || b < 0 || b > 100) {
    return { ok: false, error: 'Percentages must be between 0 and 100.' };
  }
  if (Math.abs(a + b - 100) > 0.2) {
    return { ok: false, error: 'The two percentages must add up to 100.' };
  }
  return { ok: true, a, b };
}
