import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLoginAttemptKey,
  clearLoginAttemptState,
  getLoginAttemptPolicy,
  getLoginAttemptStatus,
  recordFailedLoginAttempt,
  resetLoginAttemptLimiterForTests,
} from '../backend/lib/loginAttemptLimiter';

test.beforeEach(() => {
  resetLoginAttemptLimiterForTests();
});

test('locks login after 3 failed attempts for 5 minutes', () => {
  const key = buildLoginAttemptKey('accountant', 'company-a');
  const startedAt = Date.UTC(2026, 3, 2, 10, 0, 0);
  const policy = getLoginAttemptPolicy();

  let state = recordFailedLoginAttempt(key, startedAt);
  assert.equal(state.isLocked, false);
  assert.equal(state.remainingAttempts, 2);

  state = recordFailedLoginAttempt(key, startedAt + 1_000);
  assert.equal(state.isLocked, false);
  assert.equal(state.remainingAttempts, 1);

  state = recordFailedLoginAttempt(key, startedAt + 2_000);
  assert.equal(state.isLocked, true);
  assert.equal(state.remainingAttempts, 0);
  assert.equal(state.remainingMs, policy.lockoutWindowMs);

  const locked = getLoginAttemptStatus(key, startedAt + 3_000);
  assert.equal(locked.isLocked, true);
  assert.ok(locked.remainingMs > 0);
});

test('clears lock status after successful reset', () => {
  const key = buildLoginAttemptKey('manager', 'company-a');
  const startedAt = Date.UTC(2026, 3, 2, 11, 0, 0);

  recordFailedLoginAttempt(key, startedAt);
  recordFailedLoginAttempt(key, startedAt + 1_000);
  recordFailedLoginAttempt(key, startedAt + 2_000);

  clearLoginAttemptState(key);

  const status = getLoginAttemptStatus(key, startedAt + 3_000);
  assert.equal(status.isLocked, false);
  assert.equal(status.failedCount, 0);
  assert.equal(status.remainingAttempts, 3);
});

test('expires lockout automatically after five minutes', () => {
  const key = buildLoginAttemptKey('cashier', 'company-a');
  const startedAt = Date.UTC(2026, 3, 2, 12, 0, 0);
  const { lockoutWindowMs } = getLoginAttemptPolicy();

  recordFailedLoginAttempt(key, startedAt);
  recordFailedLoginAttempt(key, startedAt + 1_000);
  recordFailedLoginAttempt(key, startedAt + 2_000);

  const expired = getLoginAttemptStatus(key, startedAt + 2_000 + lockoutWindowMs + 1);
  assert.equal(expired.isLocked, false);
  assert.equal(expired.failedCount, 0);
  assert.equal(expired.remainingAttempts, 3);
});
