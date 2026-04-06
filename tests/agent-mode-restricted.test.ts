import test from 'node:test';
import assert from 'node:assert/strict';
import { getPreferredLandingTabForUser, getUserScopedVisibleTabs, isAgentRestrictedUser } from '../src/lib/userAccess';
import { PERMISSIONS } from '../src/types';

const baseTabs = new Set(['dashboard', 'pos', 'reports']);

test('agent restricted mode is detected and constrained to POS', () => {
  const user = {
    id: 'u-agent',
    username: 'agent',
    name: 'Agent',
    role: 'agent',
    permissions: [PERMISSIONS.AGENT_MODE_RESTRICTED, PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.VIEW_INVENTORY],
  } as any;

  assert.equal(isAgentRestrictedUser(user), true);
  const scoped = getUserScopedVisibleTabs(user, baseTabs);
  assert.deepEqual(Array.from(scoped), ['pos']);
  assert.equal(getPreferredLandingTabForUser(user, scoped), 'pos');
});
