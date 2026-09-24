import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountLabel, authMessage, withoutAuthParam } from '../js/auth-logic.js';

test('each way a Twitch login can fail has its own plain message', () => {
  for (const reason of ['forbidden', 'denied', 'error', 'state']) assert.ok(authMessage(reason).length > 10, reason);
  assert.match(authMessage('forbidden'), /host list/);
  assert.equal(authMessage('ok'), null);
  assert.equal(authMessage(null), null);
});

test('the auth marker is removed from the address, everything else kept', () => {
  assert.equal(withoutAuthParam('https://advocate.mordraga.me/host.html?auth=forbidden'), 'https://advocate.mordraga.me/host.html');
  assert.equal(
    withoutAuthParam('http://localhost:8080/host.html?api=http%3A%2F%2Flocalhost%3A8000&auth=state#top'),
    'http://localhost:8080/host.html?api=http%3A%2F%2Flocalhost%3A8000#top',
  );
  assert.equal(withoutAuthParam('https://x.test/topics.html'), 'https://x.test/topics.html');
});

test('the account label says how you are signed in', () => {
  assert.equal(accountLabel({ authenticated: true, via: 'twitch', displayName: 'Mordraga0', login: 'mordraga0' }), 'Signed in as Mordraga0');
  assert.equal(accountLabel({ authenticated: true, via: 'twitch', displayName: null, login: 'mordraga0' }), 'Signed in as mordraga0');
  assert.equal(accountLabel({ authenticated: true, via: 'token' }), 'Using the admin token');
  assert.equal(accountLabel({ authenticated: false }), '');
  assert.equal(accountLabel(null), '');
});
