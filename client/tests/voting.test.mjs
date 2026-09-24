import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePhase } from '../js/copy.js';
import { describe, turnoutHint } from '../js/guide.js';

const seat = (seat, name, side) => ({ id: seat, seat, name, joined: true, side });
const host = (phase, poll) => ({
  round: { id: 'r1', phase, status: 'live', timer: {} },
  topic: null,
  contestants: [seat('one', 'Alice', 'A'), seat('two', 'Bob', 'B')],
  winner: null,
  poll,
});

test('the host sees turnout as a plain count', () => {
  assert.equal(turnoutHint(0), 'No votes yet.');
  assert.equal(turnoutHint(1), '1 vote in so far.');
  assert.equal(turnoutHint(37), '37 votes in so far.');
});

test('opening vote: closing voting is the primary action and shows turnout', () => {
  const d = describe(host('OPENING_POLL', { kind: 'opening', total: 12 }));
  assert.equal(d.primary.id, 'startDebate');
  assert.equal(d.primary.label, 'Close voting & start debate');
  assert.equal(d.primary.hint, '12 votes in so far.');
  assert.equal(d.poll, 'opening');
});

test('closing vote: closing voting reveals the winner', () => {
  const d = describe(host('CLOSING_POLL', { kind: 'closing', total: 1 }));
  assert.equal(d.primary.id, 'finish');
  assert.equal(d.primary.label, 'Close voting & reveal winner');
  assert.equal(d.primary.hint, '1 vote in so far.');
});

test('the host never gets a disabled button for voting - zero votes is handled when clicked', () => {
  assert.equal(describe(host('OPENING_POLL', { kind: 'opening', total: 0 })).primary.disabled, false);
});

test('a turnout figure for a different poll is not shown', () => {
  const d = describe(host('CLOSING_POLL', { kind: 'opening', total: 40 }));
  assert.equal(d.primary.hint, 'No votes yet.');
});

test('contestants are told the audience is voting, with turnout', () => {
  const opening = describePhase({ phase: 'OPENING_POLL', pollTotal: 3 });
  assert.match(opening.body, /audience is voting/);
  assert.match(opening.body, /3 votes in so far/);

  const closing = describePhase({ phase: 'CLOSING_POLL', pollTotal: 1 });
  assert.match(closing.body, /1 vote in so far/);

  assert.doesNotMatch(describePhase({ phase: 'OPENING_POLL', pollTotal: 0 }).body, /in so far/);
});
