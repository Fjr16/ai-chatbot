import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getReconnectDelayMs,
  isAuthResetRequired,
} from './wa-connection.js';

test('detects auth reset conditions for session conflicts', () => {
  assert.equal(isAuthResetRequired({ error: { output: { statusCode: 401 } } }), true);
  assert.equal(isAuthResetRequired({ error: { output: { statusCode: 440 } } }), true);
  assert.equal(isAuthResetRequired({ error: { output: { payload: { message: 'logged out' } } } }), true);
  assert.equal(isAuthResetRequired({ error: { output: { payload: { message: 'Connection was lost' } } } }), false);
});

test('uses a short delay for normal reconnects and a longer delay for auth resets', () => {
  assert.equal(getReconnectDelayMs({ shouldResetAuth: false, restartCount: 0 }), 5000);
  assert.equal(getReconnectDelayMs({ shouldResetAuth: false, restartCount: 2 }), 15000);
  assert.equal(getReconnectDelayMs({ shouldResetAuth: true, restartCount: 0 }), 15000);
  assert.equal(getReconnectDelayMs({ shouldResetAuth: true, restartCount: 4 }), 15000);
});
