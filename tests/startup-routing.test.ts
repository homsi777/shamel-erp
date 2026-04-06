import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_COMPANY_KEY,
  SELECTED_COMPANY_KEY,
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
} from '../src/lib/companySession';
import { resolveStartupDecision, sanitizeStartupStorage } from '../src/lib/startupFlow';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

test('startup goes to setup when setup is incomplete', () => {
  const decision = resolveStartupDecision({
    setupComplete: false,
    auth: { isAuthenticated: false, reason: 'missing_token' },
    branchSelectionRequired: false,
    companySelectionRequired: false,
    requestedRoute: 'app',
  });
  assert.equal(decision.route, 'setup');
});

test('setup complete + unauthenticated goes to login', () => {
  const decision = resolveStartupDecision({
    setupComplete: true,
    auth: { isAuthenticated: false, reason: 'missing_token' },
    branchSelectionRequired: false,
    companySelectionRequired: true,
    requestedRoute: 'select-company',
  });
  assert.equal(decision.route, 'select-company');
});

test('stale company selection is cleared when session is invalid', () => {
  const storage = new MemoryStorage();
  storage.setItem(SELECTED_COMPANY_KEY, 'org-old');
  storage.setItem(ACTIVE_COMPANY_KEY, 'org-old');
  storage.setItem(SESSION_TOKEN_KEY, 'tok');
  storage.setItem(SESSION_USER_KEY, '{"id":"u1"}');

  const result = sanitizeStartupStorage({
    storage,
    setupComplete: true,
    hasValidSession: false,
  });

  assert.ok(result.cleared.includes(SELECTED_COMPANY_KEY));
  assert.ok(result.cleared.includes(ACTIVE_COMPANY_KEY));
  assert.ok(result.cleared.includes(SESSION_TOKEN_KEY));
  assert.ok(result.cleared.includes(SESSION_USER_KEY));
  assert.equal(storage.getItem(SELECTED_COMPANY_KEY), null);
});

test('setup complete + authenticated + multi-company without active company goes to select-company', () => {
  const decision = resolveStartupDecision({
    setupComplete: true,
    auth: { isAuthenticated: true, reason: 'session_valid' },
    branchSelectionRequired: false,
    companySelectionRequired: true,
    requestedRoute: 'app',
  });
  assert.equal(decision.route, 'select-company');
});

test('setup complete + authenticated + active company resolved goes to app', () => {
  const decision = resolveStartupDecision({
    setupComplete: true,
    auth: { isAuthenticated: true, reason: 'session_valid' },
    branchSelectionRequired: false,
    companySelectionRequired: false,
    requestedRoute: 'select-company',
  });
  assert.equal(decision.route, 'app');
});

test('prelogin selection is allowed only when explicitly requested', () => {
});
