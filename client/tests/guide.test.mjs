import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPoll, complement, describe, pollSideLabels, seatName, winnerText } from '../js/guide.js';

const seat = (seat, name, joined, side = null) => ({ id: seat, seat, name, joined, side });
const host = (phase, over = {}) => ({
  round: { id: 'r1', phase, status: 'live', timer: {} },
  topic: null,
  contestants: [seat('one', 'Alice', true), seat('two', 'Bob', true)],
  winner: null,
  ...over,
});

test('no session: the only step is to start one', () => {
  const d = describe(null);
  assert.equal(d.primary.id, 'launch');
  assert.equal(d.index, -1);
});

test('lobby: cannot deal until both contestants have joined', () => {
  const h = host('LOBBY', { contestants: [seat('one', 'Alice', true), seat('two', 'Contestant Two', false)] });
  const d = describe(h);
  assert.equal(d.primary.id, 'deal');
  assert.equal(d.primary.disabled, true);
  assert.match(d.primary.hint, /Waiting for Contestant Two/);
  assert.equal(d.canSkipWait, true);
  assert.equal(d.showInvites, true);
});

test('lobby: skipping the wait unlocks the button', () => {
  const h = host('LOBBY', { contestants: [seat('one', 'Alice', true), seat('two', 'x', false)] });
  assert.equal(describe(h, { skipWait: true }).primary.disabled, false);
});

test('lobby: enabled once everyone is in', () => {
  const d = describe(host('LOBBY'));
  assert.equal(d.primary.disabled, false);
  assert.equal(d.canSkipWait, false);
});

test('each phase has exactly one primary action, in order', () => {
  const phases = ['LOBBY', 'TOPIC_LOCKED', 'REVEAL', 'PREPARATION', 'OPENING_POLL', 'DEBATE', 'CLOSING_POLL', 'RESULTS'];
  const ids = phases.map((p) => describe(host(p)).primary.id);
  assert.deepEqual(ids, ['deal', 'reveal', 'startPrep', 'openPoll', 'startDebate', 'closePoll', 'finish', 'newRound']);
});

test('step index follows the phase; ARCHIVED shares the results step', () => {
  assert.equal(describe(host('PREPARATION')).index, 3);
  assert.equal(describe(host('RESULTS')).index, 7);
  assert.equal(describe(host('ARCHIVED')).index, 7);
});

test('phases that need inputs ask for them', () => {
  assert.equal(describe(host('REVEAL')).minutes.key, 'prep');
  assert.equal(describe(host('OPENING_POLL')).poll, 'opening');
  assert.equal(describe(host('OPENING_POLL')).minutes.key, 'debate');
  assert.equal(describe(host('CLOSING_POLL')).poll, 'closing');
  assert.equal(describe(host('PREPARATION')).timer, true);
  assert.equal(describe(host('DEBATE')).timer, true);
});

test('a session with no round offers to create one', () => {
  assert.equal(describe({ round: null, contestants: [] }).primary.id, 'nextRound');
});

test('unjoined seats read as a placeholder, joined seats as their name', () => {
  assert.equal(seatName(seat('one', 'Contestant One', false)), 'Contestant One');
  assert.equal(seatName(seat('one', 'Alice', true)), 'Alice');
});

test('poll labels pair each side with who argues it', () => {
  const h = host('OPENING_POLL', {
    topic: { sideA: 'White and gold', sideB: 'Blue and black' },
    contestants: [seat('one', 'Alice', true, 'B'), seat('two', 'Bob', true, 'A')],
  });
  assert.deepEqual(pollSideLabels(h), { a: 'Bob: White and gold', b: 'Alice: Blue and black' });
});

test('winner text', () => {
  const contestants = [seat('one', 'Alice', true, 'A'), seat('two', 'Bob', true, 'B')];
  assert.equal(winnerText(host('RESULTS', { winner: 'B', contestants })), 'Bob won');
  assert.equal(winnerText(host('RESULTS', { winner: 'draw', contestants })), 'The round was a draw');
  assert.equal(winnerText(host('RESULTS')), null);
});

test('poll validation', () => {
  assert.deepEqual(checkPoll('70', '30'), { ok: true, a: 70, b: 30 });
  assert.equal(checkPoll('70.1', '29.9').ok, true);
  assert.equal(checkPoll('', '30').ok, false);
  assert.equal(checkPoll('abc', '30').ok, false);
  assert.match(checkPoll('70', '25').error, /add up to 100/);
  assert.match(checkPoll('110', '-10').error, /between 0 and 100/);
});

test('typing one percentage fills in the other', () => {
  assert.equal(complement('70'), '30');
  assert.equal(complement('33.3'), '66.7');
  assert.equal(complement(''), '');
  assert.equal(complement('abc'), '');
});

test('a finished round offers three ways on: new contestants, same contestants, archive', () => {
  const d = describe(host('RESULTS', { winner: 'B', contestants: [{ seat: 'one', name: 'Alice', joined: true, side: 'A' }, { seat: 'two', name: 'Bob', joined: true, side: 'B' }] }));
  assert.equal(d.title, 'Bob won');
  assert.equal(d.primary.id, 'newRound');
  assert.match(d.primary.hint, /Clears both names/);
  assert.deepEqual(d.alternatives.map((a) => a.id), ['sameContestants', 'archive']);
  assert.equal(d.archived, false);
});

test('once archived, archiving is no longer offered', () => {
  const d = describe(host('ARCHIVED'));
  assert.equal(d.title, 'Round archived');
  assert.equal(d.archived, true);
  assert.equal(d.primary.id, 'newRound');
  assert.deepEqual(d.alternatives.map((a) => a.id), ['sameContestants']);
});

test('a voided round mid-debate gets the same choices instead of a dead end', () => {
  const d = describe(host('DEBATE', { round: { id: 'r', phase: 'DEBATE', status: 'void' } }));
  assert.equal(d.title, 'This round was voided');
  assert.equal(d.primary.id, 'newRound');
  assert.deepEqual(d.alternatives.map((a) => a.id), ['sameContestants', 'archive']);
});

test('earlier phases have no alternatives', () => {
  assert.equal(describe(host('DEBATE')).alternatives, undefined);
});
