import test from 'node:test';
import assert from 'node:assert/strict';

import { OPERATION_PERMISSION_ALIASES } from '../backend/lib/security.ts';
import {
  canApproveTextileDispatch,
  canConfirmTextileDispatchPreparation,
  canConvertTextileDispatchToInvoice,
  canCreateTextileDispatchRequest,
  canOpenTextileDispatchDocument,
  canPrepareTextileDispatch,
  canPrintTextileDispatchDocument,
  getPreferredLandingTabForUser,
  getUserScopedVisibleTabs,
  isRestrictedTextileWarehouseUser,
} from '../src/lib/userAccess';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS, type AppUser } from '../src/types';

const baseTabs = new Set([
  'dashboard',
  'settings',
  'reports',
  'invoices',
  'inventory',
  'delivery_notices',
  'delivery_approvals',
]);

const textileWarehouseKeeper: AppUser = {
  id: 'u-textile',
  username: 'keeper',
  name: 'Keeper',
  role: 'textile_warehouse_keeper',
  permissions: DEFAULT_ROLE_PERMISSIONS.textile_warehouse_keeper,
};

const textileManager: AppUser = {
  id: 'u-manager',
  username: 'manager',
  name: 'Manager',
  role: 'manager',
  permissions: DEFAULT_ROLE_PERMISSIONS.manager,
};

const cashier: AppUser = {
  id: 'u-cashier',
  username: 'cashier',
  name: 'Cashier',
  role: 'cashier',
  permissions: DEFAULT_ROLE_PERMISSIONS.cashier,
};

test('Users & Security exposes textile warehouse permissions and preset role', () => {
  assert.ok(PERMISSION_GROUPS.textile);
  assert.ok(PERMISSION_GROUPS.textile.keys.includes(PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE));
  assert.ok(PERMISSION_GROUPS.textile.keys.includes(PERMISSIONS.APPROVE_TEXTILE_DISPATCH));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.textile_warehouse_keeper.includes(PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.textile_warehouse_keeper.includes(PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT));
});

test('restricted textile warehouse keeper lands on delivery notices only', () => {
  const visibleTabs = getUserScopedVisibleTabs(textileWarehouseKeeper, baseTabs);

  assert.equal(isRestrictedTextileWarehouseUser(textileWarehouseKeeper), true);
  assert.deepEqual(Array.from(visibleTabs), ['delivery_notices']);
  assert.equal(getPreferredLandingTabForUser(textileWarehouseKeeper, visibleTabs), 'delivery_notices');
});

test('restricted textile warehouse keeper is blocked from dashboard, invoices, and approval routes', () => {
  const visibleTabs = getUserScopedVisibleTabs(textileWarehouseKeeper, baseTabs);

  assert.equal(visibleTabs.has('dashboard'), false);
  assert.equal(visibleTabs.has('settings'), false);
  assert.equal(visibleTabs.has('reports'), false);
  assert.equal(visibleTabs.has('invoices'), false);
  assert.equal(visibleTabs.has('delivery_approvals'), false);
});

test('restricted textile warehouse keeper can prepare workflow but cannot approve or convert', () => {
  assert.equal(canOpenTextileDispatchDocument(textileWarehouseKeeper), true);
  assert.equal(canPrepareTextileDispatch(textileWarehouseKeeper), true);
  assert.equal(canConfirmTextileDispatchPreparation(textileWarehouseKeeper), true);
  assert.equal(canPrintTextileDispatchDocument(textileWarehouseKeeper), true);
  assert.equal(canCreateTextileDispatchRequest(textileWarehouseKeeper), false);
  assert.equal(canApproveTextileDispatch(textileWarehouseKeeper), false);
  assert.equal(canConvertTextileDispatchToInvoice(textileWarehouseKeeper), false);
});

test('approval and invoice conversion remain separate manager permissions', () => {
  assert.equal(canApproveTextileDispatch(textileManager), true);
  assert.equal(canConvertTextileDispatchToInvoice(textileManager), true);
  assert.equal(canCreateTextileDispatchRequest(textileManager), true);
});

test('non-restricted users keep broader navigation behavior', () => {
  const visibleTabs = getUserScopedVisibleTabs(cashier, baseTabs);

  assert.equal(isRestrictedTextileWarehouseUser(cashier), false);
  assert.equal(visibleTabs.has('dashboard'), true);
  assert.equal(getPreferredLandingTabForUser(cashier, visibleTabs), 'dashboard');
});

test('backend textile route aliases map to the new dedicated permissions', () => {
  assert.ok(OPERATION_PERMISSION_ALIASES['textile.dispatch.view'].includes('view_textile_dispatch_module'));
  assert.ok(OPERATION_PERMISSION_ALIASES['textile.dispatch.prepare'].includes('decompose_textile_dispatch'));
  assert.ok(OPERATION_PERMISSION_ALIASES['textile.dispatch.confirm'].includes('confirm_textile_dispatch_preparation'));
  assert.ok(OPERATION_PERMISSION_ALIASES['textile.dispatch.print'].includes('print_textile_dispatch_document'));
  assert.ok(OPERATION_PERMISSION_ALIASES['textile.dispatch.approve'].includes('approve_textile_dispatch'));
  assert.ok(OPERATION_PERMISSION_ALIASES['textile.dispatch.convert'].includes('convert_textile_dispatch_to_invoice'));
});
