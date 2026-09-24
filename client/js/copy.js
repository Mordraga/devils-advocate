// What the contestant page tells a contestant. Pure functions (no DOM) so
// the wording and the "did I win" logic can be checked without a browser
// (see client/tests/copy.test.mjs).

export const STEPS = ['Lobby', 'Locked', 'Reveal', 'Prep', 'Opening vote', 'Debate', 'Final vote', 'Results'];

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

  let swing = null;
  if (results && mySide) {
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
 *              winner, results }
 * @returns { step, headline, body, tone, timerLabel }
 */
export function describePhase(ctx) {
  const { phase, opponentName, opponentJoined } = ctx;
  const step = stepIndex(phase);

  switch (phase) {
    case 'LOBBY':
      return {
        step,
        tone: 'wait',
        headline: "You're in the lobby",
        body: opponentJoined
          ? `${opponentName} is here too. Waiting for the host to draw a topic.`
          : 'Waiting for your opponent to join. Then the host will draw a topic.',
        timerLabel: null,
      };
    case 'TOPIC_LOCKED':
      return {
        step,
        tone: 'wait',
        headline: 'Topic locked in',
        body: 'The host has chosen a topic. It is revealed in a moment - get ready.',
        timerLabel: null,
      };
    case 'REVEAL':
      return {
        step,
        tone: 'go',
        headline: 'The topic is revealed',
        body: `Read the question, then check which side you drew. You argue that side even if you disagree with it. Prep starts soon.`,
        timerLabel: null,
      };
    case 'PREPARATION':
      return {
        step,
        tone: 'go',
        headline: 'Prep time',
        body: 'Build your argument for your side. Jot ideas in the notes box below. The debate starts when the host says so.',
        timerLabel: 'Prep time left',
      };
    case 'OPENING_POLL':
      return {
        step,
        tone: 'poll',
        headline: 'Chat is voting',
        body: 'The opening poll is open. It sets the starting point - the debate begins right after.',
        timerLabel: null,
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
        body: 'Chat is voting again. This decides the winner.',
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
