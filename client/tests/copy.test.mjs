import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePhase, describeResults, scoreboardLines, stepIndex } from '../js/copy.js';

const results = { openingA: 70, openingB: 30, closingA: 54, closingB: 46, swayA: -16, swayB: 16 };

test('every phase gives a headline and body', () => {
  const phases = ['LOBBY', 'TOPIC_LOCKED', 'REVEAL', 'PREPARATION', 'OPENING_POLL', 'DEBATE', 'CLOSING_POLL', 'RESULTS'];
  for (const phase of phases) {
    const d = describePhase({ phase, mySide: 'A', opponentName: 'Bob', opponentJoined: true });
    assert.ok(d.headline && d.body, phase);
  }
});

test('timers are labelled only for the phases that have one', () => {
  const label = (phase) => describePhase({ phase }).timerLabel;
  assert.equal(label('PREPARATION'), 'Prep time left');
  assert.equal(label('DEBATE'), 'Debate time left');
  assert.equal(label('REVEAL'), null);
  assert.equal(label('OPENING_POLL'), null);
});

test('lobby tells you whether your opponent is here', () => {
  assert.match(describePhase({ phase: 'LOBBY', opponentName: 'Bob', opponentJoined: true }).body, /Bob is here/);
  assert.match(describePhase({ phase: 'LOBBY', opponentJoined: false }).body, /Waiting for your opponent/);
});

test('the side that gained ground wins, from either point of view', () => {
  // Side B gained 16 points (30 -> 46).
  const asB = describeResults({ mySide: 'B', winner: 'B', results });
  assert.equal(asB.verdict, 'You won!');
  assert.equal(asB.tone, 'win');
  assert.match(asB.swing, /16 points toward your side/);
  assert.match(asB.swing, /30% to 46%/);

  const asA = describeResults({ mySide: 'A', winner: 'B', results });
  assert.equal(asA.verdict, 'Your opponent won');
  assert.equal(asA.tone, 'lose');
  assert.match(asA.swing, /16 points away from your side/);
  assert.match(asA.swing, /70% to 54%/);
});

test('a draw reads as a draw for both', () => {
  const flat = { openingA: 50, openingB: 50, closingA: 50, closingB: 50, swayA: 0, swayB: 0 };
  const d = describeResults({ mySide: 'A', winner: 'draw', results: flat });
  assert.equal(d.verdict, "It's a draw");
  assert.match(d.swing, /not at all/);
});

test('no winner announced yet means no results text', () => {
  assert.equal(describeResults({ mySide: 'A', winner: null, results: null }), null);
  const d = describePhase({ phase: 'RESULTS', mySide: 'A', winner: null, results: null });
  assert.match(d.body, /announcing/);
});

test('results phase uses the outcome as its headline', () => {
  assert.equal(describePhase({ phase: 'RESULTS', mySide: 'B', winner: 'B', results }).headline, 'You won!');
});

test('step index', () => {
  assert.equal(stepIndex('LOBBY'), 0);
  assert.equal(stepIndex('DEBATE'), 5);
  assert.equal(stepIndex('ARCHIVED'), 7);
});

test('scoreboard lists both sides with the viewer first', () => {
  const lines = scoreboardLines({ mySide: 'A', results, myName: 'Alice', opponentName: 'Bob' });
  assert.deepEqual(lines, ['Alice: 70% → 54% (-16)', 'Bob: 30% → 46% (+16)']);
  const asB = scoreboardLines({ mySide: 'B', results, myName: 'Bob', opponentName: 'Alice' });
  assert.deepEqual(asB, ['Bob: 30% → 46% (+16)', 'Alice: 70% → 54% (-16)']);
  assert.deepEqual(scoreboardLines({ mySide: null, results, myName: 'x' }), []);
});

test('no movement but a winner is explained as a majority decision', () => {
  const results = { openingA: 100, openingB: 0, closingA: 100, closingB: 0, swayA: 0, swayB: 0 };
  const win = describeResults({ mySide: 'A', winner: 'A', results });
  assert.equal(win.verdict, 'You won!');
  assert.match(win.swing, /majority decided/);
  assert.match(win.swing, /100%/);
  assert.match(describeResults({ mySide: 'B', winner: 'A', results }).swing, /majority decided/);
  // a genuine draw keeps its own wording
  assert.match(describeResults({ mySide: 'A', winner: 'draw', results }).swing, /not at all/);
});
