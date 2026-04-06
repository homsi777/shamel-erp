import test from 'node:test';
import assert from 'node:assert/strict';

import { isTextileModeEnabled, textileRequiresWarehousePreparation } from '../src/lib/textileMode';
import { normalizeSettingValue } from '../backend/lib/settings';

test('textile mode is disabled by default', () => {
  assert.equal(isTextileModeEnabled(undefined), false);
  assert.equal(textileRequiresWarehousePreparation(undefined), true);
});

test('textile mode reads from item settings payload', () => {
  const settings = {
    itemSettings: {
      enableTextileMode: true,
      textileRequireWarehousePreparationForSales: false,
    },
  };

  assert.equal(isTextileModeEnabled(settings as any), true);
  assert.equal(textileRequiresWarehousePreparation(settings as any), false);
});

test('backend settings normalization keeps textile item settings flags', () => {
  const normalized = normalizeSettingValue('itemSettings', {
    enableTextileMode: true,
    textileRequireWarehousePreparationForSales: true,
    preferredPriceReferenceCurrency: 'USD',
  }) as any;

  assert.equal(normalized.enableTextileMode, true);
  assert.equal(normalized.textileRequireWarehousePreparationForSales, true);
  assert.equal(normalized.preferredPriceReferenceCurrency, 'USD');
});
