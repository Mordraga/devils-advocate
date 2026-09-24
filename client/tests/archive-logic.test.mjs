import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resultLine, shitpostText, whenText } from '../js/archive-logic.js';

const entry = (over = {}) => ({
  status: 'complete',
  topic: { prompt: 'Is a hot dog a sandwich?', sideA: 'Yes', sideB: 'No' },
  names: { A: 'Alice', B: 'Bob' },
  winner: 'B',
  winnerName: 'Bob',
  opening: { a: 70, b: 30 },
  closing: { a: 54, b: 46 },
  sway: { a: -16, b: 16 },
  ...over,
});

test('a win says who won and how far chat swung', () => {
  assert.equal(resultLine(entry()), 'Bob won: chat swung 16 points toward "No" (30% to 46%).');
  assert.equal(
    resultLine(entry({ winner: 'A', winnerName: 'Alice', sway: { a: 12.34, b: -12.34 }, opening: { a: 40, b: 60 }, closing: { a: 52.34, b: 47.66 } })),
    'Alice won: chat swung 12.3 points toward "Yes" (40% to 52.3%).',
  );
});

test('a side that is already quoted is not quoted twice', () => {
  const e = entry({ topic: { prompt: 'What does the audio clip say?', sideA: '"Laurel"', sideB: '"Yanny"' } });
  assert.equal(resultLine(e), 'Bob won: chat swung 16 points toward "Yanny" (30% to 46%).');
});

test('a draw, a void round and a missing result each get their own line', () => {
  assert.match(resultLine(entry({ winner: 'draw', winnerName: null })), /draw/);
  assert.match(resultLine(entry({ status: 'void', winner: null })), /voided/);
  assert.equal(resultLine(entry({ winner: null })), '');
});

test('without the numbers a win is still reported', () => {
  assert.equal(resultLine(entry({ sway: null })), 'Bob won.');
});

test('missing names fall back to the side', () => {
  const e = entry({ names: { A: null, B: null }, winnerName: null });
  assert.match(shitpostText(e), /^Side A \(Yes\) vs Side B \(No\)$/m);
  assert.match(resultLine(e), /^Side B won/);
});

test('the post text is the question, who argued what, the result and where to play', () => {
  assert.equal(
    shitpostText(entry()),
    [
      'Is a hot dog a sandwich?',
      'Alice (Yes) vs Bob (No)',
      'Bob won: chat swung 16 points toward "No" (30% to 46%).',
      "Devil's Advocate - advocate.mordraga.me",
    ].join('\n'),
  );
});

test('a round with no topic still makes a sensible post', () => {
  const text = shitpostText(entry({ topic: null, winner: null, status: 'void' }));
  assert.match(text, /voided/);
  assert.match(text, /advocate\.mordraga\.me$/);
});

test('dates read in a stable, friendly form', () => {
  assert.match(whenText('2026-09-24T01:30:00Z'), /^24 Sep\w* 2026$/);
  assert.equal(whenText('nonsense'), '');
  assert.equal(whenText(null), '');
});
