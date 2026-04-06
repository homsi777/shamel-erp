/**
 * POS dual-print & queue — unit tests
 */
import assert from 'assert';
import { buildQueueScopeKey } from '../backend/services/queueService';
import { buildKitchenReceiptLines, buildReceiptLines } from '../backend/services/escpos';

{
  const k = buildQueueScopeKey({
    companyId: 'org-1',
    branchId: 'br-1',
    scope: 'branch',
    resetMode: 'daily',
    businessDate: '2025-03-20',
  });
  assert.strictEqual(k, 'qd:org-1:br-1:2025-03-20');
  console.log('✅ buildQueueScopeKey — daily branch');
}

{
  const k = buildQueueScopeKey({
    companyId: 'org-1',
    branchId: null,
    scope: 'global',
    resetMode: 'continuous',
    businessDate: '2025-03-20',
  });
  assert.strictEqual(k, 'qc:org-1:global');
  console.log('✅ buildQueueScopeKey — continuous global');
}

{
  const kLines = buildKitchenReceiptLines({
    storeName: 'مطعم',
    queueNumber: '42',
    invoiceNo: 'P-1',
    dateText: '2025-03-20',
    items: [{ name: 'برجر', qty: 2, note: 'بدون بصل' }],
  });
  const joined = JSON.stringify(kLines);
  assert(!joined.includes('سعر'), 'kitchen ticket must not contain price label');
  assert(!joined.includes('إجمالي'), 'kitchen ticket must not contain total');
  assert(joined.includes('42'), 'queue on kitchen');
  console.log('✅ buildKitchenReceiptLines — no financial wording');
}

{
  const rLines = buildReceiptLines({
    storeName: 'متجر',
    invoiceNo: 'X',
    dateText: 'now',
    customerName: 'زبون',
    items: [{ name: 'صنف', qty: 1, price: 10 }],
    currencyLabel: 'USD',
    queueNumber: '7',
  });
  const j = JSON.stringify(rLines);
  assert(j.includes('7') || j.includes('الدور'), 'customer receipt should reference queue');
  console.log('✅ buildReceiptLines — queue on customer');
}
