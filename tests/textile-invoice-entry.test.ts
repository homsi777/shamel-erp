import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTextileDecompositionDraft,
  shouldAutoCreatePurchaseMaterialOnEnter,
  shouldShowTextileDecompositionButton,
  shouldUseTextileEntryLayout,
} from '../src/components/invoices/textileInvoiceEntry.utils.ts';

test('Textile Mode OFF keeps invoice entry generic', () => {
  assert.equal(shouldUseTextileEntryLayout(false, 'sale'), false);
  assert.equal(shouldUseTextileEntryLayout(false, 'purchase'), false);
});

test('Textile Mode ON enables textile sales layout and decomposition button for textile items only', () => {
  assert.equal(shouldUseTextileEntryLayout(true, 'sale'), true);
  assert.equal(
    shouldShowTextileDecompositionButton({
      textileModeEnabled: true,
      invoiceType: 'sale',
      selectedItemIsTextile: true,
    }),
    true,
  );
  assert.equal(
    shouldShowTextileDecompositionButton({
      textileModeEnabled: true,
      invoiceType: 'sale',
      selectedItemIsTextile: false,
      entryIsTextile: false,
    }),
    false,
  );
});

test('Purchase invoice uses quick auto-create on Enter while opening stock does not', () => {
  assert.equal(shouldAutoCreatePurchaseMaterialOnEnter('purchase'), true);
  assert.equal(shouldAutoCreatePurchaseMaterialOnEnter('sale'), false);
  assert.equal(shouldAutoCreatePurchaseMaterialOnEnter('opening_stock'), false);
});

test('Decomposition draft normalizes rows and sums total length', () => {
  const result = normalizeTextileDecompositionDraft([
    { sequence: 1, lengthValue: '12.5', unit: 'meter' },
    { sequence: 2, lengthValue: '10', unit: 'meter' },
  ], 'meter');

  assert.equal(result.isComplete, true);
  assert.equal(result.totalLength, 22.5);
  assert.deepEqual(result.rows, [
    { sequence: 1, lengthValue: 12.5, unit: 'meter', rollLabel: null },
    { sequence: 2, lengthValue: 10, unit: 'meter', rollLabel: null },
  ]);
});
