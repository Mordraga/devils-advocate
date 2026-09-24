import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedTimeMs, formatAdded } from '../js/timer.js';

const at = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-10-04T20:00:00Z');
const running = (endsInMs, startedAt = at(NOW - 60000)) => ({ startedAt, endsAt: at(NOW + endsInMs), pausedAt: null, remainingMs: 600000 });

test('adding time to a running clock is the distance the finish line moved', () => {
  assert.equal(addedTimeMs(running(300000), running(360000), NOW), 60000);
  assert.equal(addedTimeMs(running(300000), running(600000), NOW), 300000);
});

test('a clock that had run out counts the added time from now', () => {
  // it ended 45s ago; the host added two minutes, so it now ends two minutes from now
  assert.equal(addedTimeMs(running(-45000), running(120000), NOW), 120000);
});

test('adding to a paused clock is the growth in time left', () => {
  const paused = (remainingMs) => ({ startedAt: at(NOW - 60000), endsAt: at(NOW + 240000), pausedAt: at(NOW), remainingMs });
  assert.equal(addedTimeMs(paused(240000), paused(300000), NOW), 60000);
});

test('nothing to celebrate: no change, a restart, a resume, a pause, or a fresh clock', () => {
  assert.equal(addedTimeMs(running(300000), running(300000), NOW), 0);
  assert.equal(addedTimeMs(running(-45000), running(-45000), NOW), 0); // still expired
  assert.equal(addedTimeMs(running(300000), running(900000, at(NOW)), NOW), 0); // restarted: new startedAt
  const paused = { startedAt: at(NOW - 60000), endsAt: at(NOW + 240000), pausedAt: at(NOW), remainingMs: 240000 };
  assert.equal(addedTimeMs(running(300000), paused, NOW), 0); // paused
  assert.equal(addedTimeMs(paused, running(600000), NOW), 0); // resumed
  assert.equal(addedTimeMs(null, running(300000), NOW), 0);
  assert.equal(addedTimeMs(running(300000), null, NOW), 0);
  assert.equal(addedTimeMs({ startedAt: null }, running(300000), NOW), 0);
});

test('a jitter of a second or two is not "added time"', () => {
  assert.equal(addedTimeMs(running(300000), running(302000), NOW), 0);
});

test('whole minutes read as "+N min", anything else as a clock', () => {
  assert.equal(formatAdded(60000), '+1 min');
  assert.equal(formatAdded(300000), '+5 min');
  assert.equal(formatAdded(59200), '+1 min'); // network delay shaved a moment off
  assert.equal(formatAdded(30000), '+0:30');
  assert.equal(formatAdded(90000), '+1:30');
});
