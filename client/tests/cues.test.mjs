import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cuesForChange, isLowTime, secondsLeft, snapshot, timerCue } from '../js/cues.js';

const snap = (over = {}) => ({
  phase: 'LOBBY',
  hidden: false,
  pollOpen: false,
  pollKind: null,
  pollTotal: 0,
  winner: null,
  ...over,
});
const names = (cue) => cue.sounds.map((s) => s.name);

test('the first snapshot after load plays nothing', () => {
  assert.deepEqual(cuesForChange(null, snap({ phase: 'DEBATE' })), { sounds: [], ritual: null });
});

test('drawing a topic: the cauldron draws, then the seal lands', () => {
  const cue = cuesForChange(snap(), snap({ phase: 'TOPIC_LOCKED' }));
  assert.equal(cue.ritual, 'lock');
  assert.deepEqual(names(cue), ['draw', 'seal']);
  assert.ok(cue.sounds[1].delay > cue.sounds[0].delay);
});

test('each forward step has its own cue', () => {
  const step = (from, to) => cuesForChange(snap({ phase: from }), snap({ phase: to }));
  assert.equal(step('TOPIC_LOCKED', 'REVEAL').ritual, 'reveal');
  assert.deepEqual(names(step('REVEAL', 'PREPARATION')), ['start', 'pollOpen']); // prep and the opening vote begin together
  assert.deepEqual(names(step('PREPARATION', 'DEBATE')), ['gong']);
  assert.deepEqual(names(step('DEBATE', 'CLOSING_POLL')), ['pollOpen']);
});

test('results: a winner gets the bell, a draw only a gong', () => {
  assert.deepEqual(names(cuesForChange(snap({ phase: 'CLOSING_POLL' }), snap({ phase: 'RESULTS', winner: 'A' }))), ['winner']);
  const draw = cuesForChange(snap({ phase: 'CLOSING_POLL' }), snap({ phase: 'RESULTS', winner: 'draw' }));
  assert.deepEqual(names(draw), ['gong']);
  assert.equal(draw.ritual, 'winner');
});

test('going backwards or into the archive is silent', () => {
  assert.deepEqual(cuesForChange(snap({ phase: 'REVEAL' }), snap({ phase: 'TOPIC_LOCKED' })).sounds, []);
  assert.deepEqual(cuesForChange(snap({ phase: 'RESULTS' }), snap({ phase: 'ARCHIVED' })).sounds, []);
});

test('a resync that jumps ahead plays the cue for where it landed', () => {
  assert.deepEqual(names(cuesForChange(snap({ phase: 'LOBBY' }), snap({ phase: 'DEBATE' }))), ['gong']);
});

test('the emergency hide is silent both ways', () => {
  assert.deepEqual(cuesForChange(snap(), snap({ phase: 'TOPIC_LOCKED', hidden: true })).sounds, []);
  assert.deepEqual(cuesForChange(snap({ hidden: true }), snap({ phase: 'TOPIC_LOCKED' })).sounds, []);
});

test('closing the vote without moving on chimes once', () => {
  const open = snap({ phase: 'PREPARATION', pollOpen: true, pollKind: 'opening', pollTotal: 4 });
  const closed = snap({ phase: 'PREPARATION', pollOpen: false, pollKind: null, pollTotal: 4 });
  assert.deepEqual(names(cuesForChange(open, closed)), ['pollClose']);
});

test('new votes pop only where asked, and only while the poll is open', () => {
  const a = snap({ phase: 'PREPARATION', pollOpen: true, pollKind: 'opening', pollTotal: 1 });
  const b = { ...a, pollTotal: 2 };
  assert.deepEqual(names(cuesForChange(a, b, { turnoutPops: true })), ['pop']);
  assert.deepEqual(cuesForChange(a, b).sounds, []);
  assert.deepEqual(cuesForChange(b, a, { turnoutPops: true }).sounds, []); // a recount downwards
  assert.deepEqual(cuesForChange(a, { ...b, pollKind: 'closing' }, { turnoutPops: true }).sounds, []);
});

test('voiding a round fizzles once, then stays quiet', () => {
  const live = snap({ phase: 'PREPARATION' });
  const voided = snap({ phase: 'PREPARATION', voided: true });
  const cue = cuesForChange(live, voided);
  assert.equal(cue.ritual, 'void');
  assert.deepEqual(names(cue), ['fizzle']);
  assert.deepEqual(cuesForChange(voided, { ...voided }).sounds, []); // no repeat
  assert.deepEqual(cuesForChange(voided, { ...voided, pollTotal: 5 }).sounds, []);
  // ...and a hidden overlay stays silent about it too
  assert.deepEqual(cuesForChange(live, { ...voided, hidden: true }).sounds, []);
});

test('nothing changed, nothing plays', () => {
  const a = snap({ phase: 'DEBATE' });
  assert.deepEqual(cuesForChange(a, { ...a }), { sounds: [], ritual: null });
});

test('countdown: quiet until ten, tick, sharper tick, then a gong', () => {
  assert.equal(timerCue(12, 11), null);
  assert.equal(timerCue(11, 10), 'tick');
  assert.equal(timerCue(5, 4), 'tick');
  assert.equal(timerCue(4, 3), 'tickFinal');
  assert.equal(timerCue(2, 1), 'tickFinal');
  assert.equal(timerCue(1, 0), 'timeUp');
});

test('countdown: no cue without a running clock, a repeat second, or added time', () => {
  assert.equal(timerCue(null, 9), null);
  assert.equal(timerCue(9, null), null);
  assert.equal(timerCue(9, 9), null);
  assert.equal(timerCue(3, 30), null);
});

test('seconds left counts up to the next whole second and needs a running clock', () => {
  assert.equal(secondsLeft(9100, true), 10);
  assert.equal(secondsLeft(1, true), 1);
  assert.equal(secondsLeft(0, true), 0);
  assert.equal(secondsLeft(9100, false), null);
  assert.equal(secondsLeft(null, true), null);
  assert.equal(isLowTime(10), true);
  assert.equal(isLowTime(11), false);
  assert.equal(isLowTime(0), false);
  assert.equal(isLowTime(null), false);
});

test('snapshot keeps only what cues need', () => {
  const s = snapshot({ phase: 'DEBATE', hidden: 0, poll: { open: true, kind: 'closing', total: 3 }, winner: undefined, topic: {} });
  assert.deepEqual(s, { phase: 'DEBATE', hidden: false, voided: false, pollOpen: true, pollKind: 'closing', pollTotal: 3, winner: null });
});
