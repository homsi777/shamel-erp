import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessTestingReset, parseTestingResetFlag, TESTING_RESET_CONFIRMATION_PHRASE } from '../src/lib/testingReset.ts';

test('testing reset feature flag defaults to enabled outside production and respects overrides', () => {
  assert.equal(parseTestingResetFlag(undefined, 'development'), true);
  assert.equal(parseTestingResetFlag(undefined, 'production'), false);
  assert.equal(parseTestingResetFlag('true', 'production'), true);
  assert.equal(parseTestingResetFlag('0', 'development'), false);
});

test('testing reset access is restricted to high-level admin users', () => {
  assert.equal(canAccessTestingReset({ role: 'admin', permissions: [] } as any), true);
  assert.equal(canAccessTestingReset({ role: 'manager', permissions: ['manage_settings'] } as any), false);
  assert.equal(canAccessTestingReset({ role: 'employee', permissions: ['view_reports'] } as any), false);
  assert.equal(canAccessTestingReset(null as any), false);
  assert.equal(TESTING_RESET_CONFIRMATION_PHRASE, 'RESET CLEAN TESTING');
});
