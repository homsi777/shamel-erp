import test from 'node:test';
import assert from 'node:assert/strict';

import { buildControlMatrix } from '../src/lib/systemModules.ts';

test('customer-facing extra sections are hidden by default in commercial profile', () => {
  const matrix = buildControlMatrix('COMPREHENSIVE_COMMERCIAL', {});
  const visible = matrix.visibleTabs;
  const settingsVisible = matrix.visibleSettingsTabs;

  assert.equal(visible.has('delivery_notices'), false);
  assert.equal(visible.has('delivery_approvals'), false);
  assert.equal(visible.has('inventory_promotions'), false);
  assert.equal(visible.has('restaurant_tables'), false);
  assert.equal(visible.has('manufacturing'), false);
  assert.equal(visible.has('partners'), false);
  assert.equal(visible.has('branches_radar'), false);
  assert.equal(visible.has('system_monitoring'), false);
  assert.equal(settingsVisible.has('item_settings'), false);
  assert.equal(settingsVisible.has('deployment'), false);
  assert.equal(settingsVisible.has('devices'), false);
  assert.equal(settingsVisible.has('labels'), false);
});

test('super admin module control can re-enable hidden sections explicitly', () => {
  const matrix = buildControlMatrix('COMPREHENSIVE_COMMERCIAL', {
    nodeOverrides: {
      'inventory.delivery_notices': 'enabled',
      'inventory.delivery_approvals': 'enabled',
      'inventory.promotions': 'enabled',
      'restaurant.tables': 'enabled',
      'manufacturing.core': 'enabled',
      'parties.partners': 'enabled',
      'dashboard.branches_radar': 'enabled',
      'system_monitoring.core': 'enabled',
      'settings.items': 'enabled',
      'settings.deployment': 'enabled',
      'settings.devices': 'enabled',
      'settings.labels': 'enabled',
    },
  });
  const visible = matrix.visibleTabs;
  const settingsVisible = matrix.visibleSettingsTabs;

  assert.equal(visible.has('delivery_notices'), true);
  assert.equal(visible.has('delivery_approvals'), true);
  assert.equal(visible.has('inventory_promotions'), true);
  assert.equal(visible.has('restaurant_tables'), true);
  assert.equal(visible.has('manufacturing'), true);
  assert.equal(visible.has('partners'), true);
  assert.equal(visible.has('branches_radar'), true);
  assert.equal(visible.has('system_monitoring'), true);
  assert.equal(settingsVisible.has('item_settings'), true);
  assert.equal(settingsVisible.has('deployment'), true);
  assert.equal(settingsVisible.has('devices'), true);
  assert.equal(settingsVisible.has('labels'), true);
});
