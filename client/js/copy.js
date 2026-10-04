// What the contestant page tells a contestant. Pure functions (no DOM) so
// the wording and the "did I win" logic can be checked without a browser
// (see client/tests/copy.test.mjs).

export const STEPS = ['Topic', 'Sides', 'Reveal', 'Opening vote', 'Debate', 'Final vote', 'Results'];

const PHASE_STEP = {
  LOBBY: 0,
  TOPIC_LOCKED: 1,
  REVEAL: 2,
  PREPARATION: 3,
  DEBATE: 4,
  CLOSING_POLL: 5,
  RESULTS: 6,
  ARCHIVED: 6,
};

export function stepIndex(phase) {
  return PHASE_STEP[phase] ?? 0;
}

function points(value) {
  return String(Math.round(Math.abs(value) * 10) / 10);
}

function percent(value) {
  return `${Math.round(value * 10) / 10}%`;
}

/** "Alice: 30% -> 46% (+16)" for each side, the viewer's own first. */
export function scoreboardLines({ mySide, results, myName, opponentName }) {
  if (!results || !mySide) return [];
  const mineIsA = mySide === 'A';
  const line = (name, before, after, sway) => {
    const sign = sway > 0 ? '+' : sway < 0 ? '-' : '';
    return `${name}: ${percent(before)} → ${percent(after)} (${sign}${points(sway)})`;
  };
  return [
    line(myName, mineIsA ? results.openingA : results.openingB, mineIsA ? results.closingA : results.closingB, mineIsA ? results.swayA : results.swayB),
    line(opponentName ?? 'Your opponent', mineIsA ? results.openingB : results.openingA, mineIsA ? results.closingB : results.closingA, mineIsA ? results.swayB : results.swayA),
  ];
}

/** The outcome, from one contestant's point of view. */
export function describeResults({ mySide, winner, results }) {
  if (!winner) return null;

  let verdict;
  let tone;
  if (winner === 'draw') {
    verdict = "It's a draw";
    tone = 'draw';
  } else if (winner === mySide) {
    verdict = 'You won!';
    tone = 'win';
  } else {
    verdict = 'Your opponent won';
    tone = 'lose';
  }

  // No movement, but a winner: it was a draw on swing, so the majority of the
  // closing vote decided (the server's rule; see scoring.resolve_winner).
  const byMajority = winner !== 'draw' && results && Math.abs(results.swayA) < 0.005 && Math.abs(results.swayB) < 0.005;

  let swing = null;
  if (byMajority && mySide) {
    const winning = winner === 'A' ? results.closingA : results.closingB;
    swing = `It was a draw on swing - chat didn't move - so the majority decided: the winning side held ${percent(winning)}.`;
  } else if (results && mySide) {
    const mine = mySide === 'A' ? results.swayA : results.swayB;
    const before = mySide === 'A' ? results.openingA : results.openingB;
    const after = mySide === 'A' ? results.closingA : results.closingB;
    const direction = mine > 0 ? `${points(mine)} points toward your side` : mine < 0 ? `${points(mine)} points away from your side` : 'not at all';
    swing = `Chat moved ${direction}. Your side went from ${percent(before)} to ${percent(after)}.`;
  }

  return { verdict, tone, swing };
}

/**
 * @param ctx { phase, mySide ('A'|'B'|null), opponentName, opponentJoined,
 *              winner, results, hasTopic (this week's topic is out) }
 * @returns { step, headline, body, tone, timerLabel }
 */
export function describePhase(ctx) {
  const { phase, opponentName, opponentJoined, pollTotal, voided, hasTopic } = ctx;
  const votes = pollTotal > 0 ? ` ${pollTotal} vote${pollTotal === 1 ? '' : 's'} in so far.` : '';
  const step = stepIndex(phase);

  // The host voided this round, whatever phase it was in.
  if (voided) {
    return {
      step,
      tone: 'wait',
      headline: 'Round voided',
      body: "The host voided this round, so it doesn't count. The Cauldron fizzles out. Hang tight for the next one.",
      timerLabel: null,
    };
  }

  switch (phase) {
    case 'LOBBY':
      if (hasTopic) {
        return {
          step,
          tone: 'go',
          headline: "This week's topic is in",
          body: "Prep both sides - on show day the cauldron decides which one you argue. Keep it to yourself: the audience doesn't see the topic until the host reveals it on stream.",
          timerLabel: null,
        };
      }
      return {
        step,
        tone: 'wait',
        headline: "You're in",
        body: opponentJoined
          ? `${opponentName} is here too. The host will send this week's topic here, about a week before the show.`
          : "Waiting for your opponent to join. The host will send this week's topic here, about a week before the show.",
        timerLabel: null,
      };
    case 'TOPIC_LOCKED':
      return {
        step,
        tone: 'wait',
        headline: 'The cauldron has chosen sides',
        body: 'Who argues what is decided. It is revealed in a moment - get ready.',
        timerLabel: null,
      };
    case 'REVEAL':
      return {
        step,
        tone: 'go',
        headline: 'Sides revealed',
        body: `Check which side you drew. You argue that side even if you disagree with it. The opening vote comes next.`,
        timerLabel: null,
      };
    case 'PREPARATION':
      return {
        step,
        tone: 'go',
        headline: 'Opening vote',
        body: `Chat is voting before hearing any arguments - that sets the starting point. Use the moment to plan your opening. The debate starts when the host says so.${votes}`,
        timerLabel: 'Opening vote closes in',
      };
    case 'DEBATE':
      return {
        step,
        tone: 'go',
        headline: 'Debate!',
        body: 'Argue your side. Whoever moves chat furthest toward their side wins.',
        timerLabel: 'Debate time left',
      };
    case 'CLOSING_POLL':
      return {
        step,
        tone: 'poll',
        headline: 'Final vote',
        body: `The audience is voting again. This decides the winner.${votes}`,
        timerLabel: null,
      };
    case 'RESULTS':
    case 'ARCHIVED': {
      const outcome = describeResults(ctx);
      return {
        step,
        tone: outcome?.tone ?? 'wait',
        headline: outcome?.verdict ?? 'Results are in',
        body: outcome?.swing ?? 'The host is announcing the result.',
        timerLabel: null,
      };
    }
    default:
      return { step, tone: 'wait', headline: 'Waiting', body: 'Waiting for the host.', timerLabel: null };
  }
}

/**
 * What to tell a contestant whose invite link no longer works, from the
 * server's refusal message. A revoked link means the host removed them from
 * their seat, and they should be told so plainly rather than just asked for a
 * new name.
 */
export function describeInviteError(message = '') {
  // No status code in the message means we never got an answer at all.
  if (message && !/failed: \d{3}/.test(message)) {
    return {
      kind: 'offline',
      title: "Couldn't reach the show",
      text: 'Check your connection and reload this page.',
      flourish: 'The Cauldron is not answering.',
    };
  }
  if (/revoked/i.test(message)) {
    return {
      kind: 'removed',
      title: "You've been removed from your seat",
      text: 'The host has removed you from your seat. If you think this was a mistake, ask them for a new link.',
      flourish: 'The Cauldron will not hear your appeal.',
    };
  }
  if (/expired/i.test(message)) {
    return {
      kind: 'expired',
      title: 'This invite has expired',
      text: 'Invite links last two weeks. Ask the host for a new one.',
      flourish: 'The Cauldron does not wait forever.',
    };
  }
  return {
    kind: 'invalid',
    title: "This invite doesn't work",
    text: 'This invite link is invalid or was replaced. Ask the host for a new one.',
    flourish: 'The Cauldron does not know you.',
  };
}

/** The same voice for a link that has no invite code at all. */
export const MISSING_INVITE = {
  kind: 'missing',
  title: "This invite doesn't work",
  text: 'This link is missing its invite code. Ask the host for a new one.',
  flourish: 'The Cauldron cannot summon a nameless witch.',
};
