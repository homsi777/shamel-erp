/**
 * Restaurant QR hardening — FSM and idempotency contracts (no full DB).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStatusForCashierAction } from '../backend/lib/restaurantRequestFsm';

describe('restaurantRequestFsm', () => {
  test('new may become seen, accepted, or rejected', () => {
    assert.equal(nextStatusForCashierAction('new', 'seen'), 'seen');
    assert.equal(nextStatusForCashierAction('new', 'accept'), 'accepted');
    assert.equal(nextStatusForCashierAction('new', 'reject'), 'rejected');
    assert.equal(nextStatusForCashierAction('new', 'archive'), null);
  });

  test('seen may become accepted or rejected but not archived', () => {
    assert.equal(nextStatusForCashierAction('seen', 'accept'), 'accepted');
    assert.equal(nextStatusForCashierAction('seen', 'reject'), 'rejected');
    assert.equal(nextStatusForCashierAction('seen', 'archive'), null);
  });

  test('archive only from accepted or rejected', () => {
    assert.equal(nextStatusForCashierAction('accepted', 'archive'), 'archived');
    assert.equal(nextStatusForCashierAction('rejected', 'archive'), 'archived');
    assert.equal(nextStatusForCashierAction('archived', 'archive'), null);
  });

  test('terminal archived blocks further actions', () => {
    assert.equal(nextStatusForCashierAction('archived', 'accept'), null);
    assert.equal(nextStatusForCashierAction('archived', 'reject'), null);
  });
});
