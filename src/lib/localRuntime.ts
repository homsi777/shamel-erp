import { DEFAULT_CURRENCY_RATES, DEFAULT_LABELS, DEFAULT_PRINT_SETTINGS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type Account, type Agent, type AgentInventoryLine, type AppSettings, type BiometricDevice, type Branch, type CashBox, type Client, type DeliveryNotice, type Employee, type Expense, type InventoryItem, type Invoice, type ItemBarcode, type ItemSerial, type ManufacturingOrder, type Partner, type PartnerTransaction, type Party, type Promotion, type Recipe, type ReconciliationMark, type SalaryTransaction, type Unit, type UserRole, type Voucher, type Warehouse } from '../types';
import { getActivationMission, getActivationType } from './appMode';
import { BULK_PRICE_FIELD_MAP, buildBulkPricePreview, getNumeric, inferSystemCurrency, type CurrencyRatesMap } from './bulkPriceEngine';
import { LOCAL_DB_NAME, queryRows, resetLocalDb, runInTransaction, runStatement } from './localDb/database';
import { accountRepo, branchRepo, cashboxRepo, categoryRepo, employeeRepo, expenseRepo, invoiceRepo, itemRepo, partnerRepo, partyRepo, reconciliationRepo, runtimeRepo, settingsRepo, subCategoryRepo, transferRepo, unitRepo, userRepo, voucherRepo, warehouseRepo } from './localDb/repositories';

const nowIso = () => new Date().toISOString();
const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const PRICE_MUTATION_PERMISSIONS = [PERMISSIONS.PRICE_EDIT, PERMISSIONS.PRICE_BULK_EDIT, PERMISSIONS.EXCHANGE_RATE_UPDATE];
const LOCAL_LOGIN_MAX_ATTEMPTS = 3;
const LOCAL_LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
const localLoginAttempts = new Map<string, { failedCount: number; lockedUntil: number | null }>();

const buildLocalLoginAttemptKey = (username: string, companyId?: string | null) =>
  `${String(companyId || '__global__').trim().toLowerCase()}::${String(username || '').trim().toLowerCase()}`;

const getLocalLoginAttemptStatus = (key: string, now = Date.now()) => {
  const record = localLoginAttempts.get(key);
  if (!record) {
    return { isLocked: false, remainingMs: 0, failedCount: 0, remainingAttempts: LOCAL_LOGIN_MAX_ATTEMPTS };
  }
  if (record.lockedUntil && record.lockedUntil > now) {
    return { isLocked: true, remainingMs: record.lockedUntil - now, failedCount: record.failedCount, remainingAttempts: 0 };
  }
  if (record.lockedUntil && record.lockedUntil <= now) {
    localLoginAttempts.delete(key);
  }
  const currentFailedCount = localLoginAttempts.get(key)?.failedCount || 0;
  return {
    isLocked: false,
    remainingMs: 0,
    failedCount: currentFailedCount,
    remainingAttempts: Math.max(0, LOCAL_LOGIN_MAX_ATTEMPTS - currentFailedCount),
  };
};

const recordLocalFailedLoginAttempt = (key: string, now = Date.now()) => {
  const current = getLocalLoginAttemptStatus(key, now);
  const nextFailedCount = current.failedCount + 1;
  const shouldLock = nextFailedCount >= LOCAL_LOGIN_MAX_ATTEMPTS;
  localLoginAttempts.set(key, {
    failedCount: nextFailedCount,
    lockedUntil: shouldLock ? now + LOCAL_LOGIN_LOCKOUT_MS : null,
  });
  return {
    isLocked: shouldLock,
    failedCount: nextFailedCount,
    remainingAttempts: shouldLock ? 0 : Math.max(0, LOCAL_LOGIN_MAX_ATTEMPTS - nextFailedCount),
    remainingMs: shouldLock ? LOCAL_LOGIN_LOCKOUT_MS : 0,
  };
};

const clearLocalLoginAttemptState = (key: string) => {
  localLoginAttempts.delete(key);
};

const resolveSetupRole = (raw: unknown): UserRole => {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized && Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMISSIONS, normalized)) {
    return normalized as UserRole;
  }
  return 'admin';
};

const resolveSetupPermissions = (raw: unknown, role: UserRole): string[] => {
  const fallback = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.admin;
  if (Array.isArray(raw)) {
    const values = raw.map((value) => String(value || '').trim()).filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  if (typeof raw === 'string') {
    const values = raw.split(',').map((value) => String(value || '').trim()).filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  return fallback;
};

const hasLocalPermission = async (userId: string, permissions: string[]) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;
  const users = await userRepo.list();
  const user = users.find((entry) => String(entry.id) === normalizedUserId);
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions.map((value) => String(value || '').trim()) : [];
  return permissions.some((permission) => perms.includes(permission) || perms.includes('*'));
};

const requireLocalPermission = async (userId: string, permissions: string[], message = 'صلاحيات غير كافية.') => {
  const allowed = await hasLocalPermission(userId, permissions);
  if (!allowed) {
    const error = new Error(message);
    (error as any).status = 403;
    throw error;
  }
};

const getLocalCurrencyRates = async () => {
  const parsed = await settingsRepo.getValue<Record<string, number>>('currencyRates');
  return { USD: 1, ...(parsed || {}) } as CurrencyRatesMap;
};

const getBulkPriceUpdatePermissions = (payload: any) => {
  const permissions = new Set<string>();
  if (String(payload?.scope || '') === 'single') permissions.add(PERMISSIONS.PRICE_EDIT);
  else permissions.add(PERMISSIONS.PRICE_BULK_EDIT);
  if (payload?.useDailyExchangeRate || payload?.operation === 'adjust_exchange_rate') permissions.add(PERMISSIONS.EXCHANGE_RATE_UPDATE);
  return Array.from(permissions);
};

const splitEndpoint = (endpoint: string) => {
  const [pathPart, queryString = ''] = endpoint.replace(/^\//, '').split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return {
    path: pathPart,
    query: new URLSearchParams(queryString),
    segments,
  };
};

const envFlagEnabled = (...values: any[]) => values.some((value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
});

export const isStrictLocalBusinessWriteMode = () => {
  const strictMode = envFlagEnabled(
    process.env.ERP_STRICT_MODE,
    process.env.VITE_ERP_STRICT_MODE,
    process.env.NODE_ENV === 'production' ? 'true' : '',
  );
  const disableWrites = envFlagEnabled(
    process.env.DISABLE_LOCAL_BUSINESS_WRITES,
    process.env.VITE_DISABLE_LOCAL_BUSINESS_WRITES,
    strictMode ? 'true' : '',
  );
  return strictMode && disableWrites;
};

export const isLocalSensitiveWriteBlocked = () => {
  if (envFlagEnabled(process.env.ALLOW_LOCAL_SENSITIVE_WRITES, process.env.VITE_ALLOW_LOCAL_SENSITIVE_WRITES)) {
    return false;
  }
  if (envFlagEnabled(process.env.ERP_LOCAL_RUNTIME_READONLY, process.env.VITE_ERP_LOCAL_RUNTIME_READONLY)) {
    return true;
  }
  if (envFlagEnabled(process.env.ERP_STRICT_MODE, process.env.VITE_ERP_STRICT_MODE)) {
    return true;
  }
  return isStrictLocalBusinessWriteMode();
};

const isSensitiveLocalBusinessWrite = (method: string, path: string) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  if (path === 'settings' || path === 'setup/complete' || path === 'login') return false;

  return [
    /^invoices(?:\/|$)/,
    /^vouchers(?:\/|$)/,
    /^receipts(?:\/|$)/,
    /^payments(?:\/|$)/,
    /^expenses(?:\/|$)/,
    /^items(?:\/|$)/,
    /^inventory(?:\/|$)/,
    /^parties(?:\/|$)/,
    /^clients(?:\/|$)/,
    /^opening-balances\/parties$/,
    /^partners\/transaction$/,
    /^funds\/transfer$/,
    /^delivery-notices\/[^/]+\/confirm$/,
    /^agent-inventory\/transfer$/,
    /^agent-inventory\/return$/,
    /^agent-inventory\/reconcile$/,
    /^manufacturing\/process$/,
    /^reconciliation-marks$/,
    /^cash-boxes(?:\/|$)/,
    /^accounts(?:\/|$)/,
  ].some((pattern) => pattern.test(path));
};

export const assertLocalBusinessWriteAllowed = (method: string, path: string) => {
  if (!isSensitiveLocalBusinessWrite(method, path)) return;
  if (!isLocalSensitiveWriteBlocked()) return;
  const violationDetails = {
    method: String(method || '').toUpperCase(),
    path,
    policy: 'LOCAL_RUNTIME_READ_ONLY',
    code: 'LOCAL_BUSINESS_WRITES_DISABLED',
    timestamp: nowIso(),
  };
  console.warn('[local-runtime] sensitive write blocked', violationDetails);
  const error: any = new Error('OFFLINE_ACTION_REQUIRED');
  error.status = 403;
  error.code = 'LOCAL_BUSINESS_WRITES_DISABLED';
  error.details = {
    method: violationDetails.method,
    path: violationDetails.path,
    policy: violationDetails.policy,
    message: 'Sensitive local writes are blocked. Queue this operation for canonical server replay.',
    blockedAt: violationDetails.timestamp,
  };
  throw error;
};

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const parseInvoiceLineSerials = (line: any): string[] => {
  const source = line?.serialNumbers ?? line?.serials ?? [];
  if (Array.isArray(source)) return source.map((value: any) => String(value || '').trim()).filter(Boolean);
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed.map((value: any) => String(value || '').trim()).filter(Boolean) : [];
    } catch {
      return source.split(/\r?\n|,/).map((value) => String(value || '').trim()).filter(Boolean);
    }
  }
  return [];
};

const ensureUniqueBarcodeLocal = async (barcode: string, itemId?: string) => {
  const normalized = String(barcode || '').trim();
  if (!normalized) return;
  const itemBarcodes = await getCollection<ItemBarcode>('item_barcodes');
  const conflict = itemBarcodes.find((row) => String(row.barcode || '').trim() === normalized && String(row.itemId || '') !== String(itemId || ''));
  if (conflict) throw new Error(`الباركود مستخدم مسبقًا على مادة أخرى: ${normalized}`);
  const items = await itemRepo.list();
  const itemConflict = items.find((row) => String(row.barcode || '').trim() === normalized && String(row.id || '') !== String(itemId || ''));
  if (itemConflict) throw new Error(`الباركود مستخدم مسبقًا على مادة أخرى: ${normalized}`);
};

const resolveActivePromotion = async (itemId: string, quantity = 1, referenceDate?: string) => {
  const rows = await getCollection<Promotion>('promotions');
  const today = String(referenceDate || nowIso().slice(0, 10));
  const activePromotion = rows.find((promotion) => {
    let itemIds: string[] = [];
    if (Array.isArray((promotion as any).itemIds)) {
      itemIds = (promotion as any).itemIds;
    } else if (typeof (promotion as any).itemIds === 'string') {
      try {
        const parsed = JSON.parse((promotion as any).itemIds || '[]');
        itemIds = Array.isArray(parsed) ? parsed : [];
      } catch {
        itemIds = [];
      }
    }
    return String(promotion.status || 'active') === 'active'
      && itemIds.includes(itemId)
      && String(promotion.startDate || '') <= today
      && String(promotion.endDate || '') >= today;
  });
  if (!activePromotion) return null;
  const kind = String(activePromotion.discountType || '');
  return { promotion: activePromotion, kind, quantity };
};

const mergeInventoryItemsLocal = async (payload: any) => {
  const sourceItemId = String(payload?.sourceItemId || '').trim();
  const targetItemId = String(payload?.targetItemId || '').trim();
  const userId = String(payload?.userId || 'local-user');
  await requireLocalPermission(userId, [PERMISSIONS.ITEM_MERGE], 'صلاحيات غير كافية لدمج المواد.');
  if (!sourceItemId || !targetItemId) throw new Error('يجب اختيار المادة المصدر والمادة الهدف.');
  if (sourceItemId === targetItemId) throw new Error('لا يمكن دمج المادة بنفسها.');

  const sourceItem = await itemRepo.findById(sourceItemId);
  const targetItem = await itemRepo.findById(targetItemId);
  if (!sourceItem || !targetItem) throw new Error('المادة المصدر أو الهدف غير موجودة.');
  if (sourceItem.merged || sourceItem.inactive) throw new Error('المادة المصدر غير صالحة للدمج.');
  if (targetItem.inactive) throw new Error('المادة الهدف غير صالحة للدمج.');
  if (String(sourceItem.warehouseId || '') !== String(targetItem.warehouseId || '')) throw new Error('لا يمكن دمج مادتين من مستودعين مختلفين.');
  if (String(sourceItem.unitId || '') !== String(targetItem.unitId || '')) throw new Error('لا يمكن دمج مادتين بوحدتين مختلفتين.');

  const now = nowIso();
  const transferredQuantity = Number(sourceItem.quantity || 0);
  let affectedInvoiceCount = 0;
  let affectedInvoiceLineCount = 0;
  let affectedTransferCount = 0;
  let affectedAgentInventoryCount = 0;
  let affectedDeliveryNoticeCount = 0;
  let affectedItemGroupLinks = 0;
  let affectedInventoryTransactionCount = 0;

  const invoices = await invoiceRepo.list();
  for (const invoice of invoices) {
    let changed = false;
    const nextItems = (invoice.items || []).map((line: any) => {
      if (String(line?.itemId || '') !== sourceItemId) return line;
      changed = true;
      affectedInvoiceLineCount += 1;
      return { ...line, itemId: targetItemId, itemName: targetItem.name };
    });
    if (changed) {
      affectedInvoiceCount += 1;
      await invoiceRepo.upsert({ ...invoice, items: nextItems });
    }
  }

  const invoiceItemRows = await queryRows<any>(`SELECT id, payload_json FROM invoice_items WHERE item_id = ?`, [sourceItemId]);
  for (const row of invoiceItemRows) {
    const payloadJson = row.payload_json ? JSON.parse(row.payload_json) : {};
    payloadJson.itemId = targetItemId;
    payloadJson.itemName = targetItem.name;
    await runStatement(`UPDATE invoice_items SET item_id = ?, item_name = ?, payload_json = ? WHERE id = ?`, [
      targetItemId,
      targetItem.name,
      JSON.stringify(payloadJson),
      row.id,
    ]);
  }

  const inventoryTxRows = await queryRows<any>(`SELECT id, payload_json FROM inventory_transactions WHERE item_id = ?`, [sourceItemId]);
  for (const row of inventoryTxRows) {
    const payloadJson = row.payload_json ? JSON.parse(row.payload_json) : {};
    payloadJson.itemId = targetItemId;
    payloadJson.itemName = targetItem.name;
    await runStatement(`UPDATE inventory_transactions SET item_id = ?, item_name = ?, payload_json = ? WHERE id = ?`, [
      targetItemId,
      targetItem.name,
      JSON.stringify(payloadJson),
      row.id,
    ]);
    affectedInventoryTransactionCount += 1;
  }

  const transfers = await transferRepo.listStockTransfers();
  for (const transfer of transfers) {
    let changed = false;
    const nextTransfer: any = { ...transfer };
    if (String(nextTransfer.itemId || '') === sourceItemId) {
      nextTransfer.itemId = targetItemId;
      nextTransfer.itemName = targetItem.name;
      changed = true;
    }
    if (String(nextTransfer.fromItemId || '') === sourceItemId) {
      nextTransfer.fromItemId = targetItemId;
      changed = true;
    }
    if (String(nextTransfer.toItemId || '') === sourceItemId) {
      nextTransfer.toItemId = targetItemId;
      changed = true;
    }
    if (changed) {
      affectedTransferCount += 1;
      await transferRepo.addStockTransfer(nextTransfer);
    }
  }

  const agentInventoryRows = await getCollection<AgentInventoryLine>('agent_inventory');
  const nextAgentInventoryRows = [...agentInventoryRows];
  for (const row of agentInventoryRows.filter((entry) => String((entry as any).itemId || '') === sourceItemId)) {
    const existingIndex = nextAgentInventoryRows.findIndex((entry: any) => String(entry.agentId || '') === String((row as any).agentId || '') && String(entry.itemId || '') === targetItemId);
    const rowIndex = nextAgentInventoryRows.findIndex((entry: any) => String(entry.id || '') === String((row as any).id || ''));
    if (existingIndex >= 0 && rowIndex >= 0 && existingIndex !== rowIndex) {
      nextAgentInventoryRows[existingIndex] = {
        ...nextAgentInventoryRows[existingIndex],
        quantity: Number((nextAgentInventoryRows[existingIndex] as any).quantity || 0) + Number((row as any).quantity || 0),
        itemName: targetItem.name,
        updatedAt: now,
      } as any;
      nextAgentInventoryRows.splice(rowIndex, 1);
    } else if (rowIndex >= 0) {
      nextAgentInventoryRows[rowIndex] = {
        ...nextAgentInventoryRows[rowIndex],
        itemId: targetItemId,
        itemName: targetItem.name,
        updatedAt: now,
      } as any;
    }
    affectedAgentInventoryCount += 1;
  }
  await setCollection('agent_inventory', nextAgentInventoryRows);

  const notices = await getCollection<DeliveryNotice>('delivery_notices');
  const nextNotices = notices.map((notice: any) => {
    const lines = Array.isArray(notice?.items) ? notice.items : [];
    let changed = false;
    const nextLines = lines.map((line: any) => {
      if (String(line?.itemId || '') !== sourceItemId) return line;
      changed = true;
      return { ...line, itemId: targetItemId, itemName: targetItem.name };
    });
    if (changed) {
      affectedDeliveryNoticeCount += 1;
      return { ...notice, items: nextLines, updatedAt: now };
    }
    return notice;
  });
  await setCollection('delivery_notices', nextNotices);

  const groupItems = await getCollection<any>('item_group_items');
  const sourceGroupLink = groupItems.find((row: any) => String(row.itemId || '') === sourceItemId);
  const targetGroupLink = groupItems.find((row: any) => String(row.itemId || '') === targetItemId);
  if (sourceGroupLink) {
    affectedItemGroupLinks = 1;
    if (targetGroupLink) {
      await deleteCollectionEntry('item_group_items', String(sourceGroupLink.id));
    } else {
      await upsertCollectionEntry('item_group_items', { ...sourceGroupLink, itemId: targetItemId });
    }
  }

  await itemRepo.upsert({
    ...targetItem,
    quantity: Number(targetItem.quantity || 0) + transferredQuantity,
    groupId: targetItem.groupId || sourceItem.groupId,
    groupName: targetItem.groupName || sourceItem.groupName,
    lastUpdated: now,
  });
  await itemRepo.upsert({
    ...sourceItem,
    quantity: 0,
    merged: true,
    inactive: true,
    mergedIntoItemId: targetItemId,
    lastUpdated: now,
  });

  await upsertCollectionEntry('audit_logs', {
    id: createId('audit-merge'),
    userId,
    operationType: 'item_merge',
    affectedItems: [sourceItemId, targetItemId],
    oldValues: {
      sourceQuantity: Number(sourceItem.quantity || 0),
      targetQuantity: Number(targetItem.quantity || 0),
    },
    newValues: {
      sourceMerged: true,
      sourceInactive: true,
      sourceMergedIntoItemId: targetItemId,
      targetQuantity: Number(targetItem.quantity || 0) + transferredQuantity,
    },
    meta: {
      sourceItemId,
      sourceItemName: sourceItem.name,
      targetItemId,
      targetItemName: targetItem.name,
      affectedInvoiceCount,
      affectedInvoiceLineCount,
      affectedTransferCount,
      affectedAgentInventoryCount,
      affectedDeliveryNoticeCount,
      affectedItemGroupLinks,
      affectedInventoryTransactionCount,
      affectedRecordsCount:
        affectedInvoiceLineCount +
        affectedTransferCount +
        affectedAgentInventoryCount +
        affectedDeliveryNoticeCount +
        affectedItemGroupLinks +
        affectedInventoryTransactionCount,
    },
    timestamp: now,
  } as any);

  return {
    success: true,
    sourceItemId,
    targetItemId,
    transferredQuantity,
    affectedInvoiceCount,
    affectedInvoiceLineCount,
    affectedTransferCount,
    affectedAgentInventoryCount,
    affectedDeliveryNoticeCount,
    affectedItemGroupLinks,
    affectedInventoryTransactionCount,
    affectedRecordsCount:
      affectedInvoiceLineCount +
      affectedTransferCount +
      affectedAgentInventoryCount +
      affectedDeliveryNoticeCount +
      affectedItemGroupLinks +
      affectedInventoryTransactionCount,
  };
};

const mergeInventoryItemsLocalAtomic = async (payload: any) => {
  const sourceItemId = String(payload?.sourceItemId || '').trim();
  const targetItemId = String(payload?.targetItemId || '').trim();
  const userId = String(payload?.userId || 'local-user');
  await requireLocalPermission(userId, [PERMISSIONS.ITEM_MERGE], 'صلاحيات غير كافية لدمج المواد.');
  if (!sourceItemId || !targetItemId) throw new Error('يجب اختيار المادة المصدر والمادة الهدف.');
  if (sourceItemId === targetItemId) throw new Error('لا يمكن دمج المادة بنفسها.');

  const sourceItem = await itemRepo.findById(sourceItemId);
  const targetItem = await itemRepo.findById(targetItemId);
  if (!sourceItem || !targetItem) throw new Error('المادة المصدر أو الهدف غير موجودة.');
  if (sourceItem.merged || sourceItem.inactive) throw new Error('المادة المصدر غير صالحة للدمج.');
  if (targetItem.inactive) throw new Error('المادة الهدف غير صالحة للدمج.');
  if (String(sourceItem.warehouseId || '') !== String(targetItem.warehouseId || '')) throw new Error('لا يمكن دمج مادتين من مستودعين مختلفين.');
  if (String(sourceItem.unitId || '') !== String(targetItem.unitId || '')) throw new Error('لا يمكن دمج مادتين بوحدتين مختلفتين.');

  const now = nowIso();
  const transferredQuantity = Number(sourceItem.quantity || 0);
  let affectedInvoiceCount = 0;
  let affectedInvoiceLineCount = 0;
  let affectedTransferCount = 0;
  let affectedAgentInventoryCount = 0;
  let affectedDeliveryNoticeCount = 0;
  let affectedItemGroupLinks = 0;
  let affectedInventoryTransactionCount = 0;

  await runInTransaction(async (db) => {
    const getRuntimeCollectionTx = async <T,>(key: string): Promise<T[]> => {
      const result = await db.query(`SELECT value_json FROM runtime_meta WHERE key = ? LIMIT 1`, [`collection:${key}`]);
      const value = result.values?.[0]?.value_json;
      return value ? JSON.parse(String(value)) : [];
    };
    const setRuntimeCollectionTx = async <T,>(key: string, rows: T[]) => {
      await db.run(`INSERT OR REPLACE INTO runtime_meta (key, value_json, updated_at) VALUES (?, ?, ?)`, [
        `collection:${key}`,
        JSON.stringify(rows),
        now,
      ]);
    };

    const invoiceRows = await db.query(`SELECT id, payload_json FROM invoices ORDER BY date DESC, created_at DESC`);
    for (const row of invoiceRows.values || []) {
      const invoice = row.payload_json ? JSON.parse(String(row.payload_json)) : null;
      if (!invoice) continue;
      let changed = false;
      const nextItems = (invoice.items || []).map((line: any) => {
        if (String(line?.itemId || '') !== sourceItemId) return line;
        changed = true;
        affectedInvoiceLineCount += 1;
        return { ...line, itemId: targetItemId, itemName: targetItem.name };
      });
      if (changed) {
        affectedInvoiceCount += 1;
        await db.run(`UPDATE invoices SET payload_json = ?, updated_at = ? WHERE id = ?`, [
          JSON.stringify({ ...invoice, items: nextItems }),
          now,
          row.id,
        ]);
      }
    }

    const invoiceItemRows = await db.query(`SELECT id, payload_json FROM invoice_items WHERE item_id = ?`, [sourceItemId]);
    for (const row of invoiceItemRows.values || []) {
      const payloadJson = row.payload_json ? JSON.parse(String(row.payload_json)) : {};
      payloadJson.itemId = targetItemId;
      payloadJson.itemName = targetItem.name;
      await db.run(`UPDATE invoice_items SET item_id = ?, item_name = ?, payload_json = ? WHERE id = ?`, [
        targetItemId,
        targetItem.name,
        JSON.stringify(payloadJson),
        row.id,
      ]);
    }

    const inventoryTxRows = await db.query(`SELECT id, payload_json FROM inventory_transactions WHERE item_id = ?`, [sourceItemId]);
    affectedInventoryTransactionCount = (inventoryTxRows.values || []).length;
    for (const row of inventoryTxRows.values || []) {
      const payloadJson = row.payload_json ? JSON.parse(String(row.payload_json)) : {};
      payloadJson.itemId = targetItemId;
      payloadJson.itemName = targetItem.name;
      await db.run(`UPDATE inventory_transactions SET item_id = ?, item_name = ?, payload_json = ? WHERE id = ?`, [
        targetItemId,
        targetItem.name,
        JSON.stringify(payloadJson),
        row.id,
      ]);
    }

    const transferRows = await db.query(`SELECT id, item_id, payload_json FROM stock_transfers ORDER BY created_at DESC`);
    for (const row of transferRows.values || []) {
      const transfer = row.payload_json ? JSON.parse(String(row.payload_json)) : {};
      let changed = false;
      if (String(transfer.itemId || row.item_id || '') === sourceItemId) {
        transfer.itemId = targetItemId;
        transfer.itemName = targetItem.name;
        changed = true;
      }
      if (String(transfer.fromItemId || '') === sourceItemId) {
        transfer.fromItemId = targetItemId;
        changed = true;
      }
      if (String(transfer.toItemId || '') === sourceItemId) {
        transfer.toItemId = targetItemId;
        changed = true;
      }
      if (changed) {
        affectedTransferCount += 1;
        await db.run(`UPDATE stock_transfers SET item_id = ?, payload_json = ? WHERE id = ?`, [
          transfer.itemId || targetItemId,
          JSON.stringify(transfer),
          row.id,
        ]);
      }
    }

    const agentInventoryRows = await getRuntimeCollectionTx<AgentInventoryLine>('agent_inventory');
    const nextAgentInventoryRows = [...agentInventoryRows];
    for (const row of agentInventoryRows.filter((entry) => String((entry as any).itemId || '') === sourceItemId)) {
      const existingIndex = nextAgentInventoryRows.findIndex((entry: any) => String(entry.agentId || '') === String((row as any).agentId || '') && String(entry.itemId || '') === targetItemId);
      const rowIndex = nextAgentInventoryRows.findIndex((entry: any) => String(entry.id || '') === String((row as any).id || ''));
      if (existingIndex >= 0 && rowIndex >= 0 && existingIndex !== rowIndex) {
        nextAgentInventoryRows[existingIndex] = {
          ...nextAgentInventoryRows[existingIndex],
          quantity: Number((nextAgentInventoryRows[existingIndex] as any).quantity || 0) + Number((row as any).quantity || 0),
          itemName: targetItem.name,
          updatedAt: now,
        } as any;
        nextAgentInventoryRows.splice(rowIndex, 1);
      } else if (rowIndex >= 0) {
        nextAgentInventoryRows[rowIndex] = {
          ...nextAgentInventoryRows[rowIndex],
          itemId: targetItemId,
          itemName: targetItem.name,
          updatedAt: now,
        } as any;
      }
      affectedAgentInventoryCount += 1;
    }
    await setRuntimeCollectionTx('agent_inventory', nextAgentInventoryRows);

    const notices = await getRuntimeCollectionTx<DeliveryNotice>('delivery_notices');
    const nextNotices = notices.map((notice: any) => {
      const lines = Array.isArray(notice?.items) ? notice.items : [];
      let changed = false;
      const nextLines = lines.map((line: any) => {
        if (String(line?.itemId || '') !== sourceItemId) return line;
        changed = true;
        return { ...line, itemId: targetItemId, itemName: targetItem.name };
      });
      if (!changed) return notice;
      affectedDeliveryNoticeCount += 1;
      return { ...notice, items: nextLines, updatedAt: now };
    });
    await setRuntimeCollectionTx('delivery_notices', nextNotices);

    const groupItems = await getRuntimeCollectionTx<any>('item_group_items');
    const sourceGroupLinks = groupItems.filter((row: any) => String(row.itemId || '') === sourceItemId);
    const targetGroupLinks = groupItems.filter((row: any) => String(row.itemId || '') === targetItemId);
    affectedItemGroupLinks = sourceGroupLinks.length;
    const targetGroupIds = new Set(targetGroupLinks.map((row: any) => String(row.groupId || '')));
    const nextGroupItems = groupItems
      .filter((row: any) => !sourceGroupLinks.some((sourceRow: any) => String(sourceRow.id) === String(row.id)))
      .concat(sourceGroupLinks.filter((row: any) => !targetGroupIds.has(String(row.groupId || ''))).map((row: any) => ({ ...row, itemId: targetItemId })));
    await setRuntimeCollectionTx('item_group_items', nextGroupItems);

    const nextTargetItem = {
      ...targetItem,
      quantity: Number(targetItem.quantity || 0) + transferredQuantity,
      groupId: targetItem.groupId || sourceItem.groupId,
      groupName: targetItem.groupName || sourceItem.groupName,
      lastUpdated: now,
    };
    const nextSourceItem = {
      ...sourceItem,
      quantity: 0,
      merged: true,
      inactive: true,
      mergedIntoItemId: targetItemId,
      lastUpdated: now,
    };
    await db.run(`UPDATE items SET quantity = ?, payload_json = ?, updated_at = ? WHERE id = ?`, [
      Number(nextTargetItem.quantity || 0),
      JSON.stringify(nextTargetItem),
      now,
      targetItemId,
    ]);
    await db.run(`UPDATE items SET quantity = ?, payload_json = ?, updated_at = ? WHERE id = ?`, [
      0,
      JSON.stringify(nextSourceItem),
      now,
      sourceItemId,
    ]);

    const auditLogs = await getRuntimeCollectionTx<any>('audit_logs');
    auditLogs.push({
      id: createId('audit-merge'),
      userId,
      operationType: 'item_merge',
      affectedItems: [sourceItemId, targetItemId],
      oldValues: {
        sourceQuantity: Number(sourceItem.quantity || 0),
        targetQuantity: Number(targetItem.quantity || 0),
      },
      newValues: {
        sourceMerged: true,
        sourceInactive: true,
        sourceMergedIntoItemId: targetItemId,
        targetQuantity: Number(targetItem.quantity || 0) + transferredQuantity,
      },
      meta: {
        sourceItemId,
        sourceItemName: sourceItem.name,
        targetItemId,
        targetItemName: targetItem.name,
        affectedInvoiceCount,
        affectedInvoiceLineCount,
        affectedTransferCount,
        affectedAgentInventoryCount,
        affectedDeliveryNoticeCount,
        affectedItemGroupLinks,
        affectedInventoryTransactionCount,
        affectedRecordsCount:
          affectedInvoiceLineCount +
          affectedTransferCount +
          affectedAgentInventoryCount +
          affectedDeliveryNoticeCount +
          affectedItemGroupLinks +
          affectedInventoryTransactionCount,
      },
      timestamp: now,
    });
    await setRuntimeCollectionTx('audit_logs', auditLogs);
  });

  const affectedRecordsCount =
    affectedInvoiceLineCount +
    affectedTransferCount +
    affectedAgentInventoryCount +
    affectedDeliveryNoticeCount +
    affectedItemGroupLinks +
    affectedInventoryTransactionCount;

  return {
    success: true,
    sourceItemId,
    targetItemId,
    transferredQuantity,
    affectedInvoiceCount,
    affectedInvoiceLineCount,
    affectedTransferCount,
    affectedAgentInventoryCount,
    affectedDeliveryNoticeCount,
    affectedItemGroupLinks,
    affectedInventoryTransactionCount,
    affectedRecordsCount,
  };
};

const bulkPriceUpdateLocal = async (request: { mode?: 'preview' | 'execute'; payload?: any; currencyRates?: CurrencyRatesMap; userId?: string }) => {
  const payload = request?.payload || {};
  const mode = request?.mode === 'execute' ? 'execute' : 'preview';
  const userId = String(request?.userId || request?.payload?.userId || 'local-user');
  await requireLocalPermission(userId, getBulkPriceUpdatePermissions(payload), 'صلاحيات غير كافية لتعديل الأسعار.');

  const currencyRates = payload.useDailyExchangeRate
    ? { ...(await getLocalCurrencyRates()), ...((request?.currencyRates || {}) as CurrencyRatesMap) }
    : ((request?.currencyRates || { USD: 1 }) as CurrencyRatesMap);
  const systemCurrency = inferSystemCurrency(currencyRates);
  if (payload.operation === 'adjust_exchange_rate') {
    const exchangeRateValid = payload.useDailyExchangeRate
      ? Object.entries(currencyRates || {}).some(([code, rate]) => String(code || '').toUpperCase() !== systemCurrency && getNumeric(rate) > 0)
      : getNumeric(payload.exchangeRate) > 0;
    if (!exchangeRateValid) throw new Error('سعر الصرف غير صالح.');
  }

  const items = await itemRepo.list();
  const preview = buildBulkPricePreview(items, payload, currencyRates);
  if (mode === 'preview' || preview.affectedCount === 0) return preview;

  const timestamp = nowIso();
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const fieldMeta = BULK_PRICE_FIELD_MAP[payload.targetField];
  const sqlColumnMap: Record<string, string> = {
    salePrice: 'sale_price',
    costPrice: 'cost_price',
    wholesalePrice: 'wholesale_price',
    posPrice: 'pos_price',
  };
  const sqlColumn = sqlColumnMap[String(fieldMeta.key)];
  if (!sqlColumn) throw new Error('حقل السعر غير مدعوم.');

  await runInTransaction(async (db) => {
    for (const row of preview.rows) {
      const item = itemById.get(String(row.itemId));
      if (!item) continue;
      const nextItem = {
        ...item,
        [fieldMeta.key]: row.newValue,
        lastUpdated: timestamp,
      };
      await db.run(
        `UPDATE items SET ${sqlColumn} = ?, payload_json = ?, updated_at = ? WHERE id = ?`,
        [row.newValue, JSON.stringify(nextItem), timestamp, row.itemId],
      );
    }

    const currentAuditRows = await db.query(`SELECT value_json FROM runtime_meta WHERE key = ? LIMIT 1`, ['collection:audit_logs']);
    const auditLogs = currentAuditRows.values?.[0]?.value_json ? JSON.parse(String(currentAuditRows.values[0].value_json)) : [];
    auditLogs.push({
      id: createId('audit-bulk-price'),
      userId,
      timestamp,
      operationType: payload.useDailyExchangeRate ? 'exchange_rate_update' : 'bulk_price_update',
      affectedItems: preview.rows.map((row) => row.itemId),
      oldValues: Object.fromEntries(preview.rows.map((row) => [row.itemId, row.oldValue])),
      newValues: Object.fromEntries(preview.rows.map((row) => [row.itemId, row.newValue])),
      meta: {
        scope: payload.scope,
        targetField: payload.targetField,
        operation: payload.operation,
        useDailyExchangeRate: Boolean(payload.useDailyExchangeRate),
        sourceField: payload.sourceField || null,
        categoryId: payload.categoryId || null,
        unitId: payload.unitId || null,
        groupId: payload.groupId || null,
        amount: payload.amount ?? null,
        amountMode: payload.amountMode || null,
        percentage: payload.percentage ?? null,
        marginPercent: payload.marginPercent ?? null,
        exchangeRate: payload.exchangeRate ?? null,
        currencyRates: payload.useDailyExchangeRate ? currencyRates : null,
        notes: payload.notes || '',
        affectedCount: preview.affectedCount,
      },
    });
    await db.run(
      `INSERT OR REPLACE INTO runtime_meta (key, value_json, updated_at) VALUES (?, ?, ?)`,
      ['collection:audit_logs', JSON.stringify(auditLogs), timestamp],
    );
  });

  return preview;
};

const manageItemGroupsLocal = async (payload: any) => {
  const action = String(payload?.action || '').trim();
  const userId = String(payload?.userId || 'local-user');
  await requireLocalPermission(userId, [PERMISSIONS.GROUP_MANAGE], 'صلاحيات غير كافية لإدارة مجموعات المواد.');
  const timestamp = nowIso();

  if (!['create', 'update', 'delete', 'assign', 'unassign'].includes(action)) {
    throw new Error('عملية مجموعات المواد غير مدعومة.');
  }

  await runInTransaction(async (db) => {
    const getRuntimeCollectionTx = async <T,>(key: string): Promise<T[]> => {
      const result = await db.query(`SELECT value_json FROM runtime_meta WHERE key = ? LIMIT 1`, [`collection:${key}`]);
      const value = result.values?.[0]?.value_json;
      return value ? JSON.parse(String(value)) : [];
    };
    const setRuntimeCollectionTx = async <T,>(key: string, rows: T[]) => {
      await db.run(`INSERT OR REPLACE INTO runtime_meta (key, value_json, updated_at) VALUES (?, ?, ?)`, [
        `collection:${key}`,
        JSON.stringify(rows),
        timestamp,
      ]);
    };

    const groups = await getRuntimeCollectionTx<any>('item_groups');
    const assignments = await getRuntimeCollectionTx<any>('item_group_items');
    const auditLogs = await getRuntimeCollectionTx<any>('audit_logs');

    if (action === 'create') {
      const groupId = String(payload?.groupId || payload?.id || `igroup-${Date.now()}`);
      const groupName = String(payload?.name || '').trim();
      if (!groupName) throw new Error('اسم المجموعة مطلوب.');
      const nextGroups = [...groups.filter((row: any) => String(row.id) !== groupId), {
        id: groupId,
        name: groupName,
        notes: String(payload?.notes || '').trim() || '',
        createdAt: timestamp,
        updatedAt: timestamp,
      }];
      auditLogs.push({
        id: createId('audit-group'),
        userId,
        operationType: 'item_group_changes',
        affectedItems: [],
        oldValues: undefined,
        newValues: { groupId, groupName },
        meta: { action: 'create_group', groupId, groupName },
        timestamp,
      });
      await setRuntimeCollectionTx('item_groups', nextGroups);
      await setRuntimeCollectionTx('audit_logs', auditLogs);
      return;
    }

    const groupId = String(payload?.groupId || payload?.id || '').trim();
    const group = groups.find((row: any) => String(row.id) === groupId);
    if (action !== 'unassign' && !group) throw new Error('المجموعة غير موجودة.');

    if (action === 'update') {
      const groupName = String(payload?.name || '').trim();
      if (!groupName) throw new Error('اسم المجموعة مطلوب.');
      const nextGroups = groups.map((row: any) => String(row.id) === groupId ? { ...row, name: groupName, notes: String(payload?.notes || '').trim() || '', updatedAt: timestamp } : row);
      const itemRows = await queryRows<any>(`SELECT id, payload_json FROM items WHERE group_id = ?`, [groupId]);
      for (const row of itemRows) {
        const item = row.payload_json ? JSON.parse(String(row.payload_json)) : null;
        if (!item) continue;
        const nextItem = { ...item, groupId, groupName, lastUpdated: timestamp };
        await db.run(`UPDATE items SET payload_json = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(nextItem), timestamp, row.id]);
      }
      auditLogs.push({
        id: createId('audit-group'),
        userId,
        operationType: 'item_group_changes',
        affectedItems: itemRows.map((row: any) => String(row.id)),
        oldValues: { name: group.name, notes: group.notes || '' },
        newValues: { name: groupName, notes: String(payload?.notes || '').trim() || '' },
        meta: { action: 'update_group', groupId, groupName },
        timestamp,
      });
      await setRuntimeCollectionTx('item_groups', nextGroups);
      await setRuntimeCollectionTx('audit_logs', auditLogs);
      return;
    }

    if (action === 'delete') {
      const linkedAssignments = assignments.filter((row: any) => String(row.groupId || '') === groupId);
      const linkedItemIds = linkedAssignments.map((row: any) => String(row.itemId || ''));
      for (const itemId of linkedItemIds) {
        const itemRow = await db.query(`SELECT id, payload_json FROM items WHERE id = ? LIMIT 1`, [itemId]);
        const payloadJson = itemRow.values?.[0]?.payload_json;
        if (!payloadJson) continue;
        const item = JSON.parse(String(payloadJson));
        const nextItem = { ...item, groupId: null, groupName: null, lastUpdated: timestamp };
        await db.run(`UPDATE items SET payload_json = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(nextItem), timestamp, itemId]);
      }
      auditLogs.push({
        id: createId('audit-group'),
        userId,
        operationType: 'item_group_changes',
        affectedItems: linkedItemIds,
        oldValues: { groupId, groupName: group.name },
        newValues: undefined,
        meta: { action: 'delete_group', groupId, groupName: group.name, affectedItemIds: linkedItemIds },
        timestamp,
      });
      await setRuntimeCollectionTx('item_group_items', assignments.filter((row: any) => String(row.groupId || '') !== groupId));
      await setRuntimeCollectionTx('item_groups', groups.filter((row: any) => String(row.id) !== groupId));
      await setRuntimeCollectionTx('audit_logs', auditLogs);
      return;
    }

    const itemIds = Array.isArray(payload?.itemIds) ? payload.itemIds.map((value: any) => String(value || '').trim()).filter(Boolean) : [];
    if (itemIds.length === 0) throw new Error('يجب تحديد مادة واحدة على الأقل.');
    const nextAssignments = assignments.filter((row: any) => !itemIds.includes(String(row.itemId || '')));
    if (action === 'assign') {
      for (const itemId of itemIds) {
        nextAssignments.push({
          id: `igroup-item-${Date.now()}-${itemId}-${Math.random().toString(36).slice(2, 6)}`,
          groupId,
          itemId,
          createdAt: timestamp,
        });
      }
    }
    for (const itemId of itemIds) {
      const itemRow = await db.query(`SELECT id, payload_json FROM items WHERE id = ? LIMIT 1`, [itemId]);
      const payloadJson = itemRow.values?.[0]?.payload_json;
      if (!payloadJson) continue;
      const item = JSON.parse(String(payloadJson));
      const nextItem = {
        ...item,
        groupId: action === 'assign' ? groupId : null,
        groupName: action === 'assign' ? String(group.name || '') : null,
        lastUpdated: timestamp,
      };
      await db.run(`UPDATE items SET payload_json = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(nextItem), timestamp, itemId]);
    }
    auditLogs.push({
      id: createId('audit-group'),
      userId,
      operationType: 'item_group_changes',
      affectedItems: itemIds,
      oldValues: undefined,
      newValues: { groupId: action === 'assign' ? groupId : null, groupName: action === 'assign' ? String(group.name || '') : null },
      meta: {
        action: action === 'assign' ? 'assign_items' : 'unassign_items',
        groupId: action === 'assign' ? groupId : null,
        groupName: action === 'assign' ? String(group.name || '') : null,
        affectedItemIds: itemIds,
      },
      timestamp,
    });
    await setRuntimeCollectionTx('item_group_items', nextAssignments);
    await setRuntimeCollectionTx('audit_logs', auditLogs);
  });

  return { success: true };
};

const getCollection = async <T,>(key: string): Promise<T[]> => {
  const rows = await runtimeRepo.get(`collection:${key}`);
  return Array.isArray(rows) ? rows : [];
};

const setCollection = async <T,>(key: string, rows: T[]) => {
  await runtimeRepo.set(`collection:${key}`, rows);
};

const upsertCollectionEntry = async <T extends { id: string }>(key: string, entry: T) => {
  const rows = await getCollection<T>(key);
  const next = rows.filter((row) => String(row.id) !== String(entry.id));
  next.push(entry);
  await setCollection(key, next);
  return entry;
};

const deleteCollectionEntry = async (key: string, id: string) => {
  const rows = await getCollection<any>(key);
  await setCollection(key, rows.filter((row: any) => String(row.id) !== String(id)));
};

const getCounter = async (key: string) => {
  const current = Number(await runtimeRepo.get(`counter:${key}`) || 0) + 1;
  await runtimeRepo.set(`counter:${key}`, current);
  return current;
};

const getNextNumber = async (key: string) => {
  const value = await getCounter(`next:${key}`);
  return { number: `${key.toUpperCase()}-${String(value).padStart(5, '0')}` };
};

const getDefaultSettings = (companyName = 'نظام إدارة ERP', companyAddress = 'دمشق', phone = '011-123456'): AppSettings => ({
  company: { name: companyName, address: companyAddress, email: '', phone1: phone, phone2: '', logo: '' },
  theme: { primaryColor: '#0f766e', backgroundColor: '#f3f4f6', secondaryColor: '#f59e0b', textColor: '#111827', inputBgColor: '#ffffff', sidebarBgColor: '#ffffff' },
  labels: DEFAULT_LABELS,
  print: DEFAULT_PRINT_SETTINGS,
  lowStockThreshold: 5,
  registeredDevices: [],
  currencyRates: DEFAULT_CURRENCY_RATES,
  defaultCurrency: 'USD',
});

const ensureAccountsSeed = async () => {
  const accounts = await accountRepo.list();
  if (accounts.length > 0) return;
  const seed: Account[] = [
    { id: 1, code: '1', nameAr: 'الأصول', parentId: null, level: 1, accountType: 'assets', accountNature: 'debit', isParent: true, isActive: true, isSystem: true, balance: 0, totalDebit: 0, totalCredit: 0 },
    { id: 2, code: '11', nameAr: 'الصندوق', parentId: 1, level: 2, accountType: 'assets', accountNature: 'debit', isParent: false, isActive: true, isSystem: true, balance: 0, totalDebit: 0, totalCredit: 0 },
    { id: 3, code: '12', nameAr: 'المخزون', parentId: 1, level: 2, accountType: 'assets', accountNature: 'debit', isParent: false, isActive: true, isSystem: true, balance: 0, totalDebit: 0, totalCredit: 0 },
    { id: 4, code: '2', nameAr: 'الالتزامات', parentId: null, level: 1, accountType: 'liabilities', accountNature: 'credit', isParent: true, isActive: true, isSystem: true, balance: 0, totalDebit: 0, totalCredit: 0 },
    { id: 5, code: '3', nameAr: 'الإيرادات', parentId: null, level: 1, accountType: 'revenue', accountNature: 'credit', isParent: true, isActive: true, isSystem: true, balance: 0, totalDebit: 0, totalCredit: 0 },
    { id: 6, code: '4', nameAr: 'المصروفات', parentId: null, level: 1, accountType: 'expenses', accountNature: 'debit', isParent: true, isActive: true, isSystem: true, balance: 0, totalDebit: 0, totalCredit: 0 },
  ];
  for (const account of seed) {
    await accountRepo.upsert(account);
  }
};

const ensureSettingsSeed = async () => {
  const current = await settingsRepo.getAppSettings();
  if (current) return;
  const defaults = getDefaultSettings();
  await settingsRepo.setValue('company', defaults.company);
  await settingsRepo.setValue('theme', defaults.theme);
  await settingsRepo.setValue('print', defaults.print);
  await settingsRepo.setValue('labels', defaults.labels);
  await settingsRepo.setValue('registeredDevices', defaults.registeredDevices);
  await settingsRepo.setValue('currencyRates', defaults.currencyRates);
  await settingsRepo.setValue('defaultCurrency', defaults.defaultCurrency);
  await settingsRepo.setValue('primaryCurrency', defaults.defaultCurrency);
  await settingsRepo.setValue('lowStockThreshold', defaults.lowStockThreshold);
};

const bootstrapLocalRuntime = async () => {
  await ensureAccountsSeed();
  await ensureSettingsSeed();
};

const sanitizeUser = (user: any) => {
  const { password: _password, ...safe } = user;
  return safe;
};

const updateCashboxBalance = async (cashBoxId: string, delta: number) => {
  const rows = await cashboxRepo.list();
  const cashBox = rows.find((row) => String(row.id) === String(cashBoxId));
  if (!cashBox) return;
  await cashboxRepo.upsert({ ...cashBox, balance: Number(cashBox.balance || 0) + delta });
};

const updatePartyBalance = async (partyId: string, delta: number) => {
  const party = await partyRepo.findById(partyId);
  if (!party) return;
  await partyRepo.upsert({ ...party, balance: Number(party.balance || 0) + delta });
};

const getInvoiceInventoryDirection = (invoice: Invoice) => {
  if (invoice.type === 'purchase' || invoice.type === 'opening_stock') return 1;
  if (invoice.type === 'sale') return -1;
  return 0;
};

const createPartyTransaction = async (payload: any) => {
  await partyRepo.addTransaction({
    id: payload.id || createId('ptx'),
    createdAt: payload.createdAt || nowIso(),
    ...payload,
  });
};

const upsertInventorySkeleton = async (line: any, invoice: Invoice, quantity: number) => {
  await itemRepo.upsert({
    id: String(line.itemId || createId('item')),
    name: line.itemName || 'مادة',
    code: String(line.itemId || createId('code')),
    quantity,
    costPrice: Number(line.unitPrice || 0),
    salePrice: Number(line.unitPrice || 0),
    unitId: line.unitId,
    unitName: line.unitName || 'قطعة',
    warehouseId: invoice.targetWarehouseId,
    warehouseName: invoice.targetWarehouseName,
    lastUpdated: nowIso(),
  } as InventoryItem);
};

const applyInventoryDelta = async (invoice: Invoice, multiplier = 1) => {
  const sign = getInvoiceInventoryDirection(invoice) * multiplier;
  if (!sign) return;

  for (const line of invoice.items || []) {
    const existing = await itemRepo.findById(String(line.itemId));
    if (existing) {
      await itemRepo.upsert({
        ...existing,
        quantity: Number(existing.quantity || 0) + sign * Number(line.quantity || 0),
        lastUpdated: nowIso(),
      });
      continue;
    }
    if (sign > 0) {
      await upsertInventorySkeleton(line, invoice, Number(line.quantity || 0));
    }

    const itemRecord = existing || await itemRepo.findById(String(line.itemId));
    const tracking = String((itemRecord as any)?.serialTracking || 'none');
    const serialNumbers = parseInvoiceLineSerials(line);
    if (tracking === 'none' || serialNumbers.length === 0) continue;

    const currentSerials = await getCollection<ItemSerial>('item_serials');
    if (invoice.type === 'purchase' || invoice.type === 'opening_stock') {
      if (multiplier > 0) {
        for (const serialNumber of serialNumbers) {
          const conflict = currentSerials.find((row) => String(row.serialNumber || '') === serialNumber);
          if (conflict) throw new Error(`رقم السيريال مستخدم مسبقًا: ${serialNumber}`);
          await upsertCollectionEntry('item_serials', {
            id: createId('iserial'),
            itemId: String(line.itemId || ''),
            serialNumber,
            warehouseId: invoice.targetWarehouseId || null,
            status: 'available',
            purchaseInvoiceId: invoice.id,
            salesInvoiceId: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          } as any);
        }
      } else {
        for (const row of currentSerials.filter((entry) => String(entry.purchaseInvoiceId || '') === String(invoice.id) && serialNumbers.includes(String(entry.serialNumber || '')))) {
          await deleteCollectionEntry('item_serials', String(row.id));
        }
      }
      continue;
    }

    if (invoice.type === 'sale' || (invoice.type === 'exchange' && invoice.returnType !== 'purchase')) {
      for (const serialNumber of serialNumbers) {
        const row = currentSerials.find((entry) => String(entry.serialNumber || '') === serialNumber && String(entry.itemId || '') === String(line.itemId || ''));
        if (!row) throw new Error(`رقم السيريال غير موجود على الصنف: ${serialNumber}`);
        await upsertCollectionEntry('item_serials', {
          ...row,
          status: multiplier > 0 ? 'sold' : 'available',
          salesInvoiceId: multiplier > 0 ? invoice.id : null,
          updatedAt: nowIso(),
        } as any);
      }
      continue;
    }

    if (invoice.type === 'return') {
      for (const serialNumber of serialNumbers) {
        const row = currentSerials.find((entry) => String(entry.serialNumber || '') === serialNumber && String(entry.itemId || '') === String(line.itemId || ''));
        if (!row) continue;
        await upsertCollectionEntry('item_serials', {
          ...row,
          status: multiplier > 0 ? 'returned' : 'sold',
          updatedAt: nowIso(),
        } as any);
      }
    }
  }
};

const applyInvoiceFinancialEffects = async (invoice: Invoice, multiplier = 1) => {
  const cashBoxId = String((((invoice as any)?.cashBoxId) ?? (invoice as any)?.selectedCashBoxId ?? '') || '');
  const paidAmount = Number(invoice.paidAmount || 0) * multiplier;
  if (invoice.paymentType === 'cash' && cashBoxId && paidAmount !== 0) {
    await updateCashboxBalance(cashBoxId, paidAmount);
  }

  const remainingAmount = Number(invoice.remainingAmount || 0) * multiplier;
  if (invoice.clientId && remainingAmount !== 0) {
    await updatePartyBalance(invoice.clientId, remainingAmount);
    if (multiplier < 0) {
      await partyRepo.deleteTransactionsByReference('invoice', invoice.id);
    } else {
      await createPartyTransaction({
        id: createId('ptx'),
        partyId: invoice.clientId,
        partyName: invoice.clientName,
        referenceType: 'invoice',
        referenceId: invoice.id,
        amount: remainingAmount,
        currency: invoice.currency,
        createdAt: invoice.createdAt || nowIso(),
      });
    }
  }
};

const buildLinkedInvoiceVoucher = async (invoice: Invoice): Promise<Voucher | null> => {
  const cashBoxId = String((((invoice as any)?.cashBoxId) ?? (invoice as any)?.selectedCashBoxId ?? '') || '');
  const paidAmount = Number(invoice.paidAmount || 0);
  if (!cashBoxId || paidAmount <= 0) return null;

  let voucherType: Voucher['type'] | null = null;
  let category = 'حركة مرتبطة بالفاتورة';
  if (invoice.type === 'sale') {
    voucherType = 'receipt';
    category = 'مبيعات';
  } else if (invoice.type === 'purchase' || invoice.type === 'opening_stock') {
    voucherType = 'payment';
    category = invoice.type === 'purchase' ? 'مشتريات' : 'بضاعة أول المدة';
  }

  if (!voucherType) return null;

  const cashBoxes = await cashboxRepo.list();
  const cashBox = cashBoxes.find((row) => String(row.id) === cashBoxId);
  return {
    id: `inv-v-${invoice.id}`,
    type: voucherType,
    status: 'POSTED',
    date: invoice.date,
    amount: paidAmount,
    currency: invoice.currency || 'USD',
    cashBoxId,
    cashBoxName: String((invoice as any)?.cashBoxName || cashBox?.name || ''),
    category,
    description: `سند تلقائي مرتبط بالفاتورة ${invoice.invoiceNumber || invoice.id}`,
    referenceNumber: invoice.invoiceNumber || invoice.id,
    linkedInvoiceId: invoice.id,
    createdAt: invoice.createdAt || nowIso(),
  } as Voucher;
};

const upsertInvoiceWithEffects = async (invoice: Invoice) => {
  const previous = await invoiceRepo.findById(String(invoice.id));
  if (previous) {
    await applyInventoryDelta(previous, -1);
    await applyInvoiceFinancialEffects(previous, -1);
    const previousVoucher = await voucherRepo.findById(`inv-v-${previous.id}`);
    if (previousVoucher) {
      await deleteVoucherWithEffects(previousVoucher.id);
    }
  }
  await invoiceRepo.upsert(invoice);
  await applyInventoryDelta(invoice, 1);
  await applyInvoiceFinancialEffects(invoice, 1);
  const linkedVoucher = await buildLinkedInvoiceVoucher(invoice);
  if (linkedVoucher) {
    await upsertVoucherWithEffects(linkedVoucher);
  }
  return invoice;
};

const deleteInvoiceWithEffects = async (id: string) => {
  const previous = await invoiceRepo.findById(id);
  if (!previous) return;
  await applyInventoryDelta(previous, -1);
  await applyInvoiceFinancialEffects(previous, -1);
  const previousVoucher = await voucherRepo.findById(`inv-v-${previous.id}`);
  if (previousVoucher) {
    await deleteVoucherWithEffects(previousVoucher.id);
  }
  await invoiceRepo.delete(id);
};

const getVoucherBalanceDelta = (voucher: Voucher) => (voucher.type === 'receipt' ? Number(voucher.amount || 0) : -Number(voucher.amount || 0));

const applyVoucherEffects = async (voucher: Voucher, multiplier = 1) => {
  const cashDelta = getVoucherBalanceDelta(voucher) * multiplier;
  if (voucher.cashBoxId && cashDelta !== 0) {
    await updateCashboxBalance(voucher.cashBoxId, cashDelta);
  }
  if (voucher.clientId && cashDelta !== 0) {
    await updatePartyBalance(voucher.clientId, -cashDelta);
    if (multiplier < 0) {
      await partyRepo.deleteTransactionsByReference('voucher', voucher.id);
    } else {
      await createPartyTransaction({
        id: createId('ptx'),
        partyId: voucher.clientId,
        partyName: voucher.clientName,
        referenceType: 'voucher',
        referenceId: voucher.id,
        amount: -cashDelta,
        currency: voucher.currency || 'USD',
        createdAt: voucher.createdAt || nowIso(),
      });
    }
  }
};

const upsertVoucherWithEffects = async (voucher: Voucher) => {
  const previous = await voucherRepo.findById(String(voucher.id));
  if (previous) {
    await applyVoucherEffects(previous, -1);
  }
  await voucherRepo.upsert(voucher);
  await applyVoucherEffects(voucher, 1);
  return voucher;
};

const deleteVoucherWithEffects = async (id: string) => {
  const previous = await voucherRepo.findById(id);
  if (!previous) return;
  await applyVoucherEffects(previous, -1);
  await voucherRepo.delete(id);
};

const findInventoryMirror = async (sourceItem: InventoryItem, warehouseId?: string) => {
  const rows = await itemRepo.list();
  return rows.find((row) =>
    String(row.id) !== String(sourceItem.id)
    && String(row.warehouseId || '') === String(warehouseId || '')
    && String(row.code || '') === String(sourceItem.code || ''),
  ) || null;
};

const applyStockTransferEffect = async (transfer: any, multiplier = 1) => {
  const quantity = Number(transfer.baseQuantity ?? transfer.quantity ?? 0) * multiplier;
  if (!quantity) return;

  const sourceItem = await itemRepo.findById(String(transfer.itemId || ''));
  if (!sourceItem) return;

  await itemRepo.upsert({
    ...sourceItem,
    quantity: Number(sourceItem.quantity || 0) - quantity,
    lastUpdated: nowIso(),
  });

  const mirror = await findInventoryMirror(sourceItem, transfer.toWarehouseId || transfer.toWH);
  if (mirror) {
    await itemRepo.upsert({
      ...mirror,
      quantity: Number(mirror.quantity || 0) + quantity,
      lastUpdated: nowIso(),
    });
    return;
  }

  await itemRepo.upsert({
    ...sourceItem,
    id: createId('item'),
    warehouseId: transfer.toWarehouseId || transfer.toWH,
    warehouseName: transfer.toWarehouseName || transfer.toWarehouse || '',
    quantity,
    lastUpdated: nowIso(),
  });
};

const upsertStockTransferWithEffects = async (payload: any) => {
  const previous = payload?.id ? await transferRepo.findStockTransferById(String(payload.id)) : null;
  if (previous) {
    await applyStockTransferEffect(previous, -1);
  }
  const nextPayload = {
    ...payload,
    fromWarehouseId: payload.fromWarehouseId || payload.fromWH,
    toWarehouseId: payload.toWarehouseId || payload.toWH,
  };
  await transferRepo.addStockTransfer(nextPayload);
  await applyStockTransferEffect(nextPayload, 1);
  return nextPayload;
};

const buildPartyStatement = async (scope: 'customers' | 'suppliers', partyId: string, query: URLSearchParams) => {
  const party = await partyRepo.findById(partyId);
  const transactions = await partyRepo.listTransactionsByParty(partyId);
  const latestMark = await reconciliationRepo.getLatest('PARTY', partyId, 'PARTY_STATEMENT');
  const currency = query.get('currency') || 'ALL';
  const from = query.get('from');
  const to = query.get('to');
  const isSupplier = scope === 'suppliers';

  const filtered = transactions
    .filter((row) => {
      const rowDate = String(row.createdAt || row.date || '');
      if (currency !== 'ALL' && String(row.currency || 'USD').toUpperCase() != String(currency).toUpperCase()) return false;
      if (from && rowDate.slice(0, 10) < from) return false;
      if (to && rowDate.slice(0, 10) > to) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt || a.date || 0).getTime() - new Date(b.createdAt || b.date || 0).getTime());

  let runningBalance = 0;
  const perCurrencyTotals: Record<string, { debit: number; credit: number; balance: number }> = {};
  const lines = filtered.map((row) => {
    const amount = Number(row.amount || 0);
    const rowCurrency = String(row.currency || 'USD').toUpperCase();
    const debit = isSupplier ? (amount < 0 ? Math.abs(amount) : 0) : (amount > 0 ? amount : 0);
    const credit = isSupplier ? (amount > 0 ? amount : 0) : (amount < 0 ? Math.abs(amount) : 0);
    runningBalance += debit - credit;
    perCurrencyTotals[rowCurrency] ||= { debit: 0, credit: 0, balance: 0 };
    perCurrencyTotals[rowCurrency].debit += debit;
    perCurrencyTotals[rowCurrency].credit += credit;
    perCurrencyTotals[rowCurrency].balance += debit - credit;
    return {
      id: row.id,
      kind: row.referenceType || 'transaction',
      refId: row.referenceId || row.id,
      date: row.createdAt || row.date || nowIso(),
      description: row.note || row.description || row.referenceType || 'حركة مالية',
      debit,
      credit,
      balance: runningBalance,
      currencyCode: rowCurrency,
    };
  });

  const totals = lines.reduce((acc, row) => ({
    debit: acc.debit + Number(row.debit || 0),
    credit: acc.credit + Number(row.credit || 0),
    balance: acc.balance + Number(row.debit || 0) - Number(row.credit || 0),
  }), { debit: 0, credit: 0, balance: 0 });

  return { party, lines, totals, currency, perCurrencyTotals, latestMark };
};

const getPartnerBalanceDelta = (transactionType: PartnerTransaction['type'], amount: number) => {
  if (transactionType === 'capital_injection' || transactionType === 'profit_distribution') return amount;
  return -amount;
};

const applyPartnerTransaction = async (transaction: PartnerTransaction) => {
  const partner = await partnerRepo.findById(transaction.partnerId);
  if (!partner) throw new Error('الشريك غير موجود');
  const delta = getPartnerBalanceDelta(transaction.type, Number(transaction.amount || 0));
  await partnerRepo.upsert({
    ...partner,
    currentBalance: Number(partner.currentBalance || 0) + delta,
  });
  await partnerRepo.addTransaction(transaction);
  return transaction;
};

const createVoucherForPayroll = async (transaction: SalaryTransaction, cashBoxName?: string) => {
  if (!transaction.cashBoxId) return null;
  return upsertVoucherWithEffects({
    id: `payroll-v-${transaction.id}`,
    type: 'payment',
    status: 'POSTED',
    date: transaction.date,
    amount: Number(transaction.amount || 0),
    cashBoxId: transaction.cashBoxId,
    cashBoxName: cashBoxName || '',
    category: transaction.type === 'advance' ? 'سلفة موظف' : 'رواتب وأجور',
    description: transaction.notes || `حركة رواتب للموظف ${transaction.employeeName}`,
    referenceNumber: transaction.id,
    createdAt: nowIso(),
  } as Voucher);
};

const processPayrollTransaction = async (payload: any) => {
  const employee = await employeeRepo.findById(String(payload?.employeeId || ''));
  if (!employee) throw new Error('الموظف غير موجود');
  const amount = Number(payload?.amount || 0);
  if (!(amount > 0)) throw new Error('المبلغ غير صالح');
  const transaction: SalaryTransaction = {
    id: payload?.id || createId('salary'),
    employeeId: employee.id,
    employeeName: payload?.employeeName || employee.name,
    amount,
    currency: payload?.currency || employee.currency || 'USD',
    type: payload?.type || 'full_salary',
    period: payload?.period || '',
    cashBoxId: payload?.cashBoxId || '',
    date: payload?.date || nowIso().slice(0, 10),
    notes: payload?.notes || '',
  };
  await employeeRepo.addSalaryTransaction(transaction);
  if (payload?.affectCashBox !== false && transaction.cashBoxId) {
    const cashBox = (await cashboxRepo.list()).find((row) => String(row.id) === String(transaction.cashBoxId));
    await createVoucherForPayroll(transaction, cashBox?.name);
  }
  return transaction;
};

const upsertExpenseWithEffects = async (expense: Expense) => {
  const previous = await expenseRepo.findById(String(expense.id));
  if (previous?.status === 'POSTED' && previous.cashBoxId && Number(previous.totalAmount || 0) > 0) {
    await updateCashboxBalance(previous.cashBoxId, Number(previous.totalAmount || 0));
  }

  await expenseRepo.upsert(expense);

  if (expense.status === 'POSTED' && expense.paymentType === 'CASH' && expense.cashBoxId && Number(expense.totalAmount || 0) > 0) {
    await updateCashboxBalance(expense.cashBoxId, -Number(expense.totalAmount || 0));
    const box = (await cashboxRepo.list()).find((row) => String(row.id) === String(expense.cashBoxId));
    await upsertVoucherWithEffects({
      id: `expense-v-${expense.id}`,
      type: 'payment',
      status: 'POSTED',
      date: expense.date,
      amount: Number(expense.totalAmount || 0),
      cashBoxId: expense.cashBoxId,
      cashBoxName: expense.cashBoxName || box?.name || '',
      category: 'مصاريف تشغيلية',
      description: expense.description,
      referenceNumber: expense.code,
      createdAt: expense.postedAt || expense.createdAt || nowIso(),
    } as Voucher);
  }

  return expense;
};

const createOrUpdatePartyWithOpeningBalance = async (body: any, idOverride?: string) => {
  const partyId = idOverride || body?.id || createId('party');
  const existing = await partyRepo.findById(String(partyId));
  const openingAmount = Number(body?.openingAmount || 0);
  const entryType = String(body?.openingEntryType || body?.entryType || '').toLowerCase();
  const signedOpeningAmount = entryType === 'credit' ? -Math.abs(openingAmount) : Math.abs(openingAmount);
  const nextBalance = openingAmount > 0 && entryType
    ? signedOpeningAmount
    : Number(body?.balance ?? existing?.balance ?? 0);

  const party: Party = {
    ...(existing || {}),
    ...(body || {}),
    id: partyId,
    name: String(body?.name || existing?.name || '').trim(),
    type: (body?.type || existing?.type || 'CUSTOMER') as any,
    phone: String(body?.phone || existing?.phone || ''),
    email: String(body?.email || existing?.email || ''),
    address: String(body?.address || existing?.address || ''),
    taxNo: String(body?.taxNo || existing?.taxNo || ''),
    notes: String(body?.notes || existing?.notes || ''),
    isActive: body?.isActive !== false,
    balance: nextBalance,
  } as Party;

  await partyRepo.upsert(party);

  if (openingAmount > 0 && entryType) {
    await partyRepo.deleteTransactionsByReference('opening_balance', party.id);
    await createPartyTransaction({
      id: createId('opening'),
      partyId: party.id,
      partyName: party.name,
      referenceType: 'opening_balance',
      referenceId: party.id,
      amount: signedOpeningAmount,
      delta: signedOpeningAmount,
      deltaBase: signedOpeningAmount,
      deltaTransaction: signedOpeningAmount,
      currency: body?.openingCurrency || body?.currency || 'USD',
      createdAt: body?.date || nowIso(),
      note: 'رصيد افتتاحي',
    });
  }

  return { success: true, party: deepClone(party) };
};

const buildProductQuickView = async (id: string) => {
  const item = await itemRepo.findById(id);
  if (!item) throw new Error('المادة غير موجودة');
  const rows = await itemRepo.list();
  const sameCodeRows = rows.filter((row) => String(row.code || '') === String(item.code || ''));
  const stockRows = (sameCodeRows.length > 0 ? sameCodeRows : [item]).map((row) => ({
    warehouseName: row.warehouseName || 'المستودع الرئيسي',
    quantity: Number(row.quantity || 0),
    costPrice: Number(row.costPrice || 0),
    salePrice: Number(row.salePrice || 0),
  }));
  const totalStock = stockRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return {
    type: 'product',
    id: item.id,
    title: item.name || 'مادة',
    subtitle: item.code || item.barcode || '',
    badges: [
      { label: 'الرصيد', value: String(totalStock), kind: totalStock > 0 ? 'success' : 'warning' },
      { label: 'العملة', value: String((item as any).priceCurrency || 'USD'), kind: 'muted' },
    ],
    fields: [
      { label: 'الاسم', value: item.name || '—' },
      { label: 'الكود', value: item.code || '—' },
      { label: 'الباركود', value: (item as any).barcode || '—' },
      { label: 'سعر المبيع', value: Number(item.salePrice || 0), type: 'currency' },
      { label: 'سعر الجملة', value: Number(item.wholesalePrice || 0), type: 'currency' },
      { label: 'سعر الكلفة', value: Number(item.costPrice || 0), type: 'currency' },
    ],
    sections: [
      {
        title: 'الأرصدة حسب المستودعات',
        rows: [{ label: 'إجمالي الرصيد', value: totalStock, type: 'number' }],
        table: {
          columns: [
            { key: 'warehouseName', label: 'المستودع', type: 'text' },
            { key: 'quantity', label: 'الكمية', type: 'number' },
            { key: 'costPrice', label: 'الكلفة', type: 'currency' },
            { key: 'salePrice', label: 'المبيع', type: 'currency' },
          ],
          data: stockRows,
        },
      },
    ],
    actions: {
      canOpen: true,
      canEdit: true,
      canExport: false,
      canPrint: false,
    },
  };
};

const buildCashBoxQuickView = async (id: string) => {
  const box = (await cashboxRepo.list()).find((row) => String(row.id) === String(id));
  if (!box) throw new Error('Local cash box not found');

  return {
    type: 'cashBox',
    id: box.id,
    title: box.name || 'Cash Box',
    subtitle: 'Financial cash box',
    badges: [
      { label: 'Currency', value: String(box.currency || 'USD'), kind: 'muted' },
    ],
    fields: [
      { label: 'Name', value: box.name || '-' },
      { label: 'Balance', value: Number(box.balance || 0), type: 'currency' },
      { label: 'Currency', value: box.currency || 'USD' },
    ],
    sections: [],
    actions: {
      canOpen: true,
      canEdit: true,
      canExport: false,
      canPrint: false,
    },
  };
};

const updateInventoryQuantityById = async (itemId: string, nextQuantity: number) => {
  const item = await itemRepo.findById(itemId);
  if (!item) return null;
  const nextItem = { ...item, quantity: nextQuantity, lastUpdated: nowIso() };
  await itemRepo.upsert(nextItem);
  return nextItem;
};

const getDeliveryNoticeOperationMode = (notice: any) => {
  const op = String(notice?.operationType || '').toUpperCase();
  if (notice?.convertToInvoice) return 'invoice';
  if (op === 'INVOICE' || op === 'SALE_INVOICE') return 'invoice';
  return 'delivery';
};

const applyDeliveryNoticeInventory = async (notice: DeliveryNotice, multiplier = 1) => {
  for (const line of notice.items || []) {
    const item = await itemRepo.findById(String(line.itemId || ''));
    if (!item) continue;
    await itemRepo.upsert({
      ...item,
      quantity: Number(item.quantity || 0) - (Number(line.quantity || 0) * multiplier),
      lastUpdated: nowIso(),
    });
  }
};

const confirmDeliveryNotice = async (notice: DeliveryNotice, body: any) => {
  let linkedInvoiceId: string | undefined;
  if (getDeliveryNoticeOperationMode(notice) === 'invoice') {
    const items = (notice.items || []).map((line) => {
      const inv = {
        quantity: Number(line.quantity || 0),
        itemId: String(line.itemId || ''),
        itemName: line.itemName || '',
        unitName: line.unitName || '',
      } as any;
      const item = notice.warehouseId ? null : null;
      return inv;
    });
    const inventoryRows = await itemRepo.list();
    const invoiceItems = items.map((line: any) => {
      const item = inventoryRows.find((row) => String(row.id) === String(line.itemId));
      const unitPrice = Number(item?.salePrice || item?.wholesalePrice || item?.costPrice || 0);
      return {
        ...line,
        unitPrice,
        total: unitPrice * Number(line.quantity || 0),
      };
    });
    const totalAmount = invoiceItems.reduce((sum: number, line: any) => sum + Number(line.total || 0), 0);
    linkedInvoiceId = createId('delivery-invoice');
    await upsertInvoiceWithEffects({
      id: linkedInvoiceId,
      invoiceNumber: body?.invoiceNumber || (await getNextNumber('sale')).number,
      type: 'sale',
      status: 'posted',
      paymentType: 'credit',
      clientId: body?.receiverId || notice.receiverId || '',
      clientName: body?.receiverName || notice.receiverName || 'عميل',
      date: notice.date || nowIso().slice(0, 10),
      createdAt: nowIso(),
      items: invoiceItems,
      totalAmount,
      paidAmount: 0,
      remainingAmount: totalAmount,
      currency: 'USD',
      targetWarehouseId: notice.warehouseId,
      targetWarehouseName: notice.warehouseName,
      notes: notice.notes || 'فاتورة ناتجة عن إشعار تسليم',
    } as Invoice);
  } else {
    await applyDeliveryNoticeInventory(notice, 1);
  }

  const confirmed: DeliveryNotice = {
    ...notice,
    ...body,
    id: notice.id,
    status: 'CONFIRMED',
    confirmedAt: nowIso(),
    linkedInvoiceId: linkedInvoiceId || (notice as any).linkedInvoiceId,
  } as DeliveryNotice;
  await upsertCollectionEntry('delivery_notices', confirmed as any);
  return { success: true, linkedInvoiceId };
};

const upsertAgentLocation = async (agentId: string, lat: number, lng: number) => {
  const rows = await getCollection<Agent>('agents');
  const agent = rows.find((row) => String(row.id) === String(agentId));
  if (!agent) throw new Error('المندوب غير موجود');
  const next: Agent = { ...agent, lastLat: lat, lastLng: lng, lastSeenAt: nowIso() };
  await upsertCollectionEntry('agents', next);
  return next;
};

const transferInventoryToAgent = async (body: any) => {
  const agentId = String(body?.agentId || '');
  const items = Array.isArray(body?.items) ? body.items : [];
  const rows = await getCollection<AgentInventoryLine>('agent_inventory');
  const transferId = body?.id || createId('agent-transfer');
  const now = nowIso();

  for (const line of items) {
    const itemId = String(line?.itemId || '');
    const quantity = Number(line?.quantity || 0);
    if (!itemId || quantity <= 0) continue;
    const item = await itemRepo.findById(itemId);
    if (!item || Number(item.quantity || 0) < quantity) {
      const error: any = new Error('INSUFFICIENT_STOCK');
      error.code = 'INSUFFICIENT_STOCK';
      throw error;
    }
    await itemRepo.upsert({ ...item, quantity: Number(item.quantity || 0) - quantity, lastUpdated: nowIso() });
    const existing = rows.find((row) => String(row.agentId) === agentId && String(row.itemId) === itemId);
    const nextLine: AgentInventoryLine = {
      ...(existing || {}),
      id: existing?.id || createId('agent-line'),
      agentId,
      itemId,
      itemName: existing?.itemName || item.name,
      quantity: Number(existing?.quantity || 0) + quantity,
      updatedAt: now,
    } as AgentInventoryLine;
    const nextRows = rows.filter((row) => String(row.id) !== String(nextLine.id));
    nextRows.push(nextLine);
    await setCollection('agent_inventory', nextRows);
  }
  const transfers = await getCollection<any>('agent_transfers');
  const nextTransfers = Array.isArray(transfers) ? transfers.slice() : [];
  nextTransfers.push({
    id: transferId,
    agentId,
    warehouseId: String(body?.warehouseId || ''),
    transferType: 'transfer',
    status: 'posted',
    items,
    notes: String(body?.notes || ''),
    createdAt: now,
    updatedAt: now,
  });
  await setCollection('agent_transfers', nextTransfers);
  return { success: true };
};

const returnInventoryFromAgent = async (body: any) => {
  const agentId = String(body?.agentId || '');
  const items = Array.isArray(body?.items) ? body.items : [];
  const rows = await getCollection<AgentInventoryLine>('agent_inventory');
  const transferId = body?.id || createId('agent-return');
  const now = nowIso();

  for (const line of items) {
    const itemId = String(line?.itemId || '');
    const quantity = Number(line?.quantity || 0);
    if (!itemId || quantity <= 0) continue;
    const existing = rows.find((row) => String(row.agentId) === agentId && String(row.itemId) === itemId);
    const currentQty = Number(existing?.quantity || 0);
    if (currentQty < quantity) {
      const error: any = new Error('INSUFFICIENT_AGENT_STOCK');
      error.code = 'INSUFFICIENT_AGENT_STOCK';
      throw error;
    }
    const nextQty = currentQty - quantity;
    const nextLine: AgentInventoryLine = {
      ...(existing || {}),
      id: existing?.id || createId('agent-line'),
      agentId,
      itemId,
      itemName: existing?.itemName,
      quantity: nextQty,
      updatedAt: now,
    } as AgentInventoryLine;
    const nextRows = rows.filter((row) => String(row.id) !== String(nextLine.id));
    if (nextQty > 0) nextRows.push(nextLine);
    await setCollection('agent_inventory', nextRows);

    const item = await itemRepo.findById(itemId);
    if (item) {
      await itemRepo.upsert({ ...item, quantity: Number(item.quantity || 0) + quantity, lastUpdated: now });
    }
  }
  const transfers = await getCollection<any>('agent_transfers');
  const nextTransfers = Array.isArray(transfers) ? transfers.slice() : [];
  nextTransfers.push({
    id: transferId,
    agentId,
    warehouseId: String(body?.warehouseId || ''),
    transferType: 'return',
    status: 'posted',
    items,
    notes: String(body?.notes || ''),
    createdAt: now,
    updatedAt: now,
  });
  await setCollection('agent_transfers', nextTransfers);
  return { success: true };
};

const reconcileAgentInventory = async (body: any) => {
  const agentId = String(body?.agentId || '');
  const items = Array.isArray(body?.items) ? body.items : [];
  const rows = await getCollection<AgentInventoryLine>('agent_inventory');
  const transferId = body?.id || createId('agent-reconcile');
  const now = nowIso();
  const mode = String(body?.mode || 'adjust').toLowerCase();

  let nextRows = rows.slice();
  for (const line of items) {
    const itemId = String(line?.itemId || '');
    const quantity = Number(line?.quantity || 0);
    if (!itemId || !Number.isFinite(quantity) || quantity === 0) continue;
    const existing = nextRows.find((row) => String(row.agentId) === agentId && String(row.itemId) === itemId);
    const currentQty = Number(existing?.quantity || 0);
    const nextQty = mode === 'set' ? quantity : currentQty + quantity;
    if (nextQty < 0) {
      const error: any = new Error('AGENT_RECONCILE_NEGATIVE');
      error.code = 'AGENT_RECONCILE_NEGATIVE';
      throw error;
    }
    nextRows = nextRows.filter((row) => String(row.id) !== String(existing?.id));
    if (nextQty > 0) {
      nextRows.push({
        ...(existing || {}),
        id: existing?.id || createId('agent-line'),
        agentId,
        itemId,
        itemName: existing?.itemName || String(line?.itemName || ''),
        quantity: nextQty,
        updatedAt: now,
      } as AgentInventoryLine);
    }
  }
  await setCollection('agent_inventory', nextRows);
  const transfers = await getCollection<any>('agent_transfers');
  const nextTransfers = Array.isArray(transfers) ? transfers.slice() : [];
  nextTransfers.push({
    id: transferId,
    agentId,
    transferType: 'reconcile',
    status: 'posted',
    items,
    notes: String(body?.notes || ''),
    createdAt: now,
    updatedAt: now,
  });
  await setCollection('agent_transfers', nextTransfers);
  return { success: true };
};

const processManufacturingOrder = async (body: any) => {
  const items = Array.isArray(body?.items) ? body.items : [];
  for (const line of items) {
    const item = await itemRepo.findById(String(line?.inputItemId || ''));
    const qty = Number(line?.inputQty || 0);
    if (!item || qty <= 0 || Number(item.quantity || 0) < qty) {
      throw new Error('كمية المواد غير كافية للتصنيع');
    }
  }
  for (const line of items) {
    const item = await itemRepo.findById(String(line?.inputItemId || ''));
    if (!item) continue;
    await itemRepo.upsert({ ...item, quantity: Number(item.quantity || 0) - Number(line.inputQty || 0), lastUpdated: nowIso() });
  }
  const outputId = String(body?.outputItemId || '');
  const outputQty = Number(body?.outputQty || 0);
  if (outputId && outputQty > 0) {
    const outputItem = await itemRepo.findById(outputId);
    if (outputItem) {
      await itemRepo.upsert({ ...outputItem, quantity: Number(outputItem.quantity || 0) + outputQty, lastUpdated: nowIso() });
    }
  }
  const payload: ManufacturingOrder = {
    ...body,
    id: body?.id || createId('mfg'),
    status: body?.status || 'POSTED',
    totalCost: Number(body?.totalCost || body?.total || 0),
    unitCost: Number(body?.unitCost || body?.unit || 0),
    createdAt: body?.createdAt || nowIso(),
  } as ManufacturingOrder;
  await upsertCollectionEntry('manufacturing_orders', payload as any);
  return payload;
};

const handleSetupComplete = async (body: any) => {
  const timestamp = nowIso();
  const companyId = String(body?.company?.id || body?.companyId || 'org-main').trim();
  const branchName = String(
    body?.branch?.name ||
    body?.branchName ||
    body?.settings?.branchName ||
    body?.company?.branchName ||
    'الفرع الرئيسي',
  ).trim() || 'الفرع الرئيسي';
  const setupRole = resolveSetupRole(body?.user?.role);
  const setupPermissions = resolveSetupPermissions(body?.user?.permissions, setupRole);
  const warehouseId = 'wh-main';
  const cashBoxId = 'cb-main';
  const unitId = createId('unit');
  const categoryId = createId('cat');
  const subCategoryId = createId('subcat');
  const userId = createId('user');

  const user = {
    id: userId,
    username: String(body?.user?.username || 'admin').trim(),
    password: String(body?.user?.password || ''),
    name: String(body?.user?.name || 'المدير العام'),
    role: setupRole,
    permissions: setupPermissions,
    companyId,
  };
  await userRepo.upsert(user);

  await branchRepo.upsert({
    id: 'br-main',
    companyId,
    name: branchName,
    code: 'MAIN',
    isMain: true,
    isActive: true,
    location: String(body?.company?.address || ''),
    manager: user.name,
    phone: String(body?.company?.phone || ''),
    notes: '',
    createdAt: timestamp,
  } as Branch);

  await warehouseRepo.upsert({
    id: warehouseId,
    name: String(body?.settings?.mainWarehouseName || 'المستودع الرئيسي'),
    location: String(body?.company?.address || ''),
    manager: user.name,
  });

  await cashboxRepo.upsert({
    id: cashBoxId,
    name: String(body?.settings?.mainCashBoxName || 'الصندوق الرئيسي'),
    type: 'main',
    balance: 0,
    currency: String(body?.settings?.primaryCurrency || 'USD'),
  });

  await unitRepo.upsert({
    id: unitId,
    name: String(body?.settings?.defaultUnit || 'قطعة'),
    isBase: true,
    factor: 1,
    multiplier: 1,
    createdAt: timestamp,
  } as Unit);

  await categoryRepo.upsert({ id: categoryId, name: 'رئيسي' });
  await subCategoryRepo.upsert({ id: subCategoryId, name: 'عام', categoryId });

  await partyRepo.upsert({
    id: 'party-cash-customer',
    name: String(body?.settings?.defaultClientName || 'عميل نقدي عام'),
    type: 'CUSTOMER',
    phone: '',
    balance: 0,
    isActive: true,
  } as Party);
  await partyRepo.upsert({
    id: 'party-cash-supplier',
    name: String(body?.settings?.defaultSupplierName || 'مورد أساسي'),
    type: 'SUPPLIER',
    phone: '',
    balance: 0,
    isActive: true,
  } as Party);

  for (const row of Array.isArray(body?.parties) ? body.parties : []) {
    await partyRepo.upsert({
      id: row.id || createId('party'),
      name: String(row.name || 'طرف'),
      type: row.type === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
      phone: '',
      balance: Number(row.openingBalance || 0),
      isActive: true,
    } as Party);
  }

  const defaults = getDefaultSettings(
    String(body?.company?.name || 'المؤسسة'),
    String(body?.company?.address || ''),
    String(body?.company?.phone || ''),
  );
  defaults.company.logo = String(body?.company?.logo || '');
  defaults.print = body?.printers || DEFAULT_PRINT_SETTINGS;
  defaults.defaultCurrency = String(body?.settings?.primaryCurrency || 'USD').toUpperCase() as any;
  defaults.currencyRates = {
    USD: 1,
    ...DEFAULT_CURRENCY_RATES,
    ...(body?.settings?.secondaryCurrency && body?.settings?.secondaryCurrencyRate
      ? { [String(body.settings.secondaryCurrency).toUpperCase()]: Number(body.settings.secondaryCurrencyRate) }
      : {}),
  };

  await settingsRepo.setValue('company', defaults.company);
  await settingsRepo.setValue('theme', defaults.theme);
  await settingsRepo.setValue('print', defaults.print);
  await settingsRepo.setValue('labels', defaults.labels);
  await settingsRepo.setValue('registeredDevices', defaults.registeredDevices);
  await settingsRepo.setValue('currencyRates', defaults.currencyRates);
  await settingsRepo.setValue('defaultCurrency', defaults.defaultCurrency);
  await settingsRepo.setValue('primaryCurrency', defaults.defaultCurrency);
  await settingsRepo.setValue('lowStockThreshold', defaults.lowStockThreshold);

  await runtimeRepo.set('setup_completed_at', timestamp);
  const token = `local-token-${Date.now()}`;
  await runtimeRepo.set('last_token', token);

  return {
    success: true,
    token,
    user: sanitizeUser(user),
  };
};

const listAliases: Record<string, () => Promise<any[]>> = {
  inventory: () => itemRepo.list(),
  warehouses: () => warehouseRepo.list(),
  branches: () => branchRepo.list(),
  clients: () => partyRepo.list(),
  parties: () => partyRepo.list(),
  'party-transactions': () => partyRepo.listTransactions(),
  'parties/transfers': () => partyRepo.listTransfers(),
  invoices: () => invoiceRepo.list(),
  'cash-boxes': () => cashboxRepo.list(),
  vouchers: () => voucherRepo.list(),
  users: async () => (await userRepo.list()).map(sanitizeUser),
  settings: async () => {
    const rows = await settingsRepo.listRows();
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value_json) }));
  },
  categories: () => categoryRepo.list(),
  'sub-categories': () => subCategoryRepo.list(),
  units: () => unitRepo.list(),
  accounts: () => accountRepo.list(),
  agents: async () => getCollection<Agent>('agents'),
  partners: () => partnerRepo.list(),
  'partner-transactions': () => partnerRepo.listTransactions(),
  'inventory/transfers': () => transferRepo.listStockTransfers(),
  'reconciliation-marks': async () => [],
  'remote-branches': async () => getCollection<any>('remote_branches'),
  'journal-entries': async () => [],
  'delivery-notices': async () => getCollection<DeliveryNotice>('delivery_notices'),
  'agent-inventory': async () => getCollection<AgentInventoryLine>('agent_inventory'),
  'manufacturing/recipes': async () => getCollection<Recipe>('manufacturing_recipes'),
  'manufacturing/orders': async () => getCollection<ManufacturingOrder>('manufacturing_orders'),
  'biometric-devices': async () => getCollection<BiometricDevice>('biometric_devices'),
  'biometric/attendance': async () => getCollection<any>('biometric_attendance'),
  employees: () => employeeRepo.list(),
  'payroll/transactions': () => employeeRepo.listSalaryTransactions(),
  expenses: () => expenseRepo.list(),
  'audit-logs': async () => getCollection<any>('audit_logs'),
  'item-serials': async () => getCollection<ItemSerial>('item_serials'),
  'item-barcodes': async () => getCollection<ItemBarcode>('item_barcodes'),
  promotions: async () => getCollection<Promotion>('promotions'),
  'inventory-transactions': async () => {
    const rows = await queryRows<any>(`SELECT payload_json FROM inventory_transactions ORDER BY created_at DESC`);
    return rows.map((row) => (row.payload_json ? JSON.parse(row.payload_json) : row));
  },
  'item-groups': async () => getCollection<any>('item_groups'),
  'item-group-items': async () => getCollection<any>('item_group_items'),
};

const writeGeneric = async (resource: string, method: string, body: any, id?: string) => {
  if (resource === 'inventory') {
    const userId = String(body?.userId || '').trim();
    const cleanBody = body ? { ...body } : body;
    if (cleanBody && 'userId' in cleanBody) delete (cleanBody as any).userId;
    const currentItem = id ? await itemRepo.findById(id) : null;
    const hasPriceChanges = currentItem && ['salePrice', 'costPrice', 'wholesalePrice', 'posPrice', 'salePriceBase', 'costPriceBase', 'wholesalePriceBase', 'posPriceBase', 'priceCurrency']
      .some((field) => field in (cleanBody || {}) && String((currentItem as any)?.[field] ?? '') !== String((cleanBody as any)?.[field] ?? ''));
    const hasGroupChanges = currentItem && ['groupId', 'groupName']
      .some((field) => field in (cleanBody || {}) && String((currentItem as any)?.[field] ?? '') !== String((cleanBody as any)?.[field] ?? ''));
    if (hasPriceChanges) {
      await requireLocalPermission(userId, PRICE_MUTATION_PERMISSIONS, 'صلاحيات غير كافية لتعديل الأسعار.');
    }
    if (hasGroupChanges) {
      await requireLocalPermission(userId, [PERMISSIONS.GROUP_MANAGE], 'صلاحيات غير كافية لإدارة مجموعات المواد.');
    }
    if (method === 'DELETE' && id) return itemRepo.delete(id);
    return itemRepo.upsert({ ...(cleanBody || {}), id: id || cleanBody?.id || createId('item') });
  }
  if (resource === 'warehouses') {
    if (method === 'DELETE' && id) return warehouseRepo.delete(id);
    return warehouseRepo.upsert({ ...(body || {}), id: id || body?.id || createId('wh') });
  }
  if (resource === 'branches') {
    if (method === 'DELETE' && id) return branchRepo.delete(id);
    return branchRepo.upsert({ ...(body || {}), id: id || body?.id || createId('branch') });
  }
  if (resource === 'categories') {
    if (method === 'DELETE' && id) return categoryRepo.delete(id);
    return categoryRepo.upsert({ ...(body || {}), id: id || body?.id || createId('cat') });
  }
  if (resource === 'sub-categories') {
    if (method === 'DELETE' && id) return subCategoryRepo.delete(id);
    return subCategoryRepo.upsert({ ...(body || {}), id: id || body?.id || createId('subcat') });
  }
  if (resource === 'units') {
    if (method === 'DELETE' && id) return unitRepo.delete(id);
    return unitRepo.upsert({ ...(body || {}), id: id || body?.id || createId('unit') });
  }
  if (resource === 'parties' || resource === 'clients') {
    if (method === 'DELETE' && id) return partyRepo.delete(id);
    return partyRepo.upsert({ ...(body || {}), id: id || body?.id || createId('party') });
  }
  if (resource === 'cash-boxes') {
    if (method === 'DELETE' && id) return cashboxRepo.delete(id);
    return cashboxRepo.upsert({ ...(body || {}), id: id || body?.id || createId('cb') });
  }
  if (resource === 'vouchers') {
    if (method === 'DELETE' && id) return voucherRepo.delete(id);
    return voucherRepo.upsert({ ...(body || {}), id: id || body?.id || createId('v') });
  }
  if (resource === 'accounts') {
    if (method === 'DELETE' && id) return accountRepo.delete(Number(id));
    const current = await accountRepo.list();
    const numericId = id ? Number(id) : (Math.max(0, ...current.map((row) => Number(row.id || 0))) + 1);
    return accountRepo.upsert({ ...(body || {}), id: numericId });
  }
  if (resource === 'partners') {
    if (method === 'DELETE' && id) return partnerRepo.delete(id);
    return partnerRepo.upsert({ ...(body || {}), id: id || body?.id || createId('partner') } as Partner);
  }
  if (resource === 'employees') {
    if (method === 'DELETE' && id) return employeeRepo.delete(id);
    return employeeRepo.upsert({ ...(body || {}), id: id || body?.id || createId('emp') } as Employee);
  }
  if (resource === 'agents') {
    if (method === 'DELETE' && id) return deleteCollectionEntry('agents', id);
    return upsertCollectionEntry('agents', { ...(body || {}), id: id || body?.id || createId('agent') } as Agent);
  }
  if (resource === 'remote-branches') {
    if (method === 'DELETE' && id) return deleteCollectionEntry('remote_branches', id);
    return upsertCollectionEntry('remote_branches', { ...(body || {}), id: id || body?.id || createId('rbranch') } as any);
  }
  if (resource === 'users') {
    if (method === 'DELETE' && id) return userRepo.delete(id);
    const payload = { ...(body || {}), id: id || body?.id || createId('user') };
    await userRepo.upsert(payload);
    return sanitizeUser(payload);
  }
  if (resource === 'audit-logs') {
    if (method === 'DELETE' && id) return deleteCollectionEntry('audit_logs', id);
    return upsertCollectionEntry('audit_logs', { ...(body || {}), id: id || body?.id || createId('audit') } as any);
  }
  if (resource === 'item-groups') {
    await requireLocalPermission(String(body?.userId || '').trim(), [PERMISSIONS.GROUP_MANAGE], 'صلاحيات غير كافية لإدارة مجموعات المواد.');
    if (method === 'DELETE' && id) return deleteCollectionEntry('item_groups', id);
    const cleanBody = body ? { ...body } : body;
    if (cleanBody && 'userId' in cleanBody) delete (cleanBody as any).userId;
    return upsertCollectionEntry('item_groups', { ...(cleanBody || {}), id: id || cleanBody?.id || createId('igroup') } as any);
  }
  if (resource === 'item-group-items') {
    await requireLocalPermission(String(body?.userId || '').trim(), [PERMISSIONS.GROUP_MANAGE], 'صلاحيات غير كافية لإدارة مجموعات المواد.');
    if (method === 'DELETE' && id) return deleteCollectionEntry('item_group_items', id);
    const cleanBody = body ? { ...body } : body;
    if (cleanBody && 'userId' in cleanBody) delete (cleanBody as any).userId;
    return upsertCollectionEntry('item_group_items', { ...(cleanBody || {}), id: id || cleanBody?.id || createId('igroup-item') } as any);
  }
  if (resource === 'item-barcodes') {
    if (method === 'DELETE' && id) return deleteCollectionEntry('item_barcodes', id);
    const cleanBody = body ? { ...body } : body;
    if (!String(cleanBody?.itemId || '').trim()) throw new Error('معرف المادة مطلوب للباركود.');
    if (!String(cleanBody?.barcode || '').trim()) throw new Error('قيمة الباركود مطلوبة.');
    await ensureUniqueBarcodeLocal(String(cleanBody.barcode || ''), String(cleanBody.itemId || ''));
    return upsertCollectionEntry('item_barcodes', {
      ...(cleanBody || {}),
      barcode: String(cleanBody.barcode || '').trim(),
      id: id || cleanBody?.id || createId('ibarcode'),
      createdAt: cleanBody?.createdAt || nowIso(),
    } as any);
  }
  if (resource === 'item-serials') {
    if (method === 'DELETE' && id) return deleteCollectionEntry('item_serials', id);
    const cleanBody = body ? { ...body } : body;
    const serial = String(cleanBody?.serialNumber || '').trim();
    if (!String(cleanBody?.itemId || '').trim()) throw new Error('معرف المادة مطلوب للسيريال.');
    if (!serial) throw new Error('رقم السيريال مطلوب.');
    const current = await getCollection<ItemSerial>('item_serials');
    const conflict = current.find((row) => String(row.serialNumber || '').trim() === serial && String(row.id || '') !== String(id || cleanBody?.id || ''));
    if (conflict) throw new Error(`رقم السيريال مكرر: ${serial}`);
    return upsertCollectionEntry('item_serials', {
      ...(cleanBody || {}),
      serialNumber: serial,
      id: id || cleanBody?.id || createId('iserial'),
      status: cleanBody?.status || 'available',
      createdAt: cleanBody?.createdAt || nowIso(),
      updatedAt: nowIso(),
    } as any);
  }
  if (resource === 'promotions') {
    if (method === 'DELETE' && id) return deleteCollectionEntry('promotions', id);
    const cleanBody = body ? { ...body } : body;
    return upsertCollectionEntry('promotions', {
      ...(cleanBody || {}),
      id: id || cleanBody?.id || createId('promo'),
      itemIds: Array.isArray(cleanBody?.itemIds) ? cleanBody.itemIds : [],
      extraImageUrls: Array.isArray(cleanBody?.extraImageUrls) ? cleanBody.extraImageUrls : [],
      displayOrder: Number(cleanBody?.displayOrder || 0),
      displayDurationSeconds: Math.max(5, Number(cleanBody?.displayDurationSeconds || 10)),
      showOnDisplay: cleanBody?.showOnDisplay !== false,
      createdAt: cleanBody?.createdAt || nowIso(),
      updatedAt: nowIso(),
    } as any);
  }
  throw new Error(`Local runtime write is not implemented for ${resource}`);
};

export const localRuntimeRequest = async (endpoint: string, options: any = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined;
  const { path, segments, query } = splitEndpoint(endpoint);
  assertLocalBusinessWriteAllowed(method, path);

  await bootstrapLocalRuntime();

  const first = segments[0] || '';
  const second = segments[1] || '';
  const third = segments[2] || '';

  if (method === 'GET' && path === 'system/status') {
    return {
      ok: true,
      mode: 'local',
      runtime: 'sqlite-embedded',
      serverIp: 'LOCAL',
      port: 0,
      timestamp: nowIso(),
    };
  }

  if (method === 'GET' && path === 'system/db-status') {
    return {
      status: 'connected',
      dbPath: `${LOCAL_DB_NAME}.db`,
      testQuery: true,
      timestamp: nowIso(),
    };
  }

  if (method === 'GET' && path === 'activation/status') {
    return {
      activated: localStorage.getItem('shamel_activated') === '1',
      activationType: getActivationType() || 'local',
      activationMission: getActivationMission() || 'LOCAL_STANDALONE',
    };
  }

  if (method === 'POST' && path === 'activation/notify-success') {
    console.warn('[localRuntime] activation/notify-success: Telegram requires full API server; skipped in embedded runtime.');
    return { success: true, delivered: false, reason: 'embedded_runtime' };
  }

  if (method === 'GET' && path === 'setup/status') {
    const users = await userRepo.list();
    return { needsSetup: users.length === 0 };
  }

  if (method === 'POST' && path === 'setup/complete') {
    return handleSetupComplete(body);
  }

  if (method === 'POST' && path === 'login') {
    const requestedCompanyId = String(body?.companyId || '').trim();
    const username = String(body?.username || '').trim();
    const loginAttemptKey = buildLocalLoginAttemptKey(username, requestedCompanyId || 'local');
    if (!requestedCompanyId) {
      const error: any = new Error('يجب اختيار مؤسسة قبل تسجيل الدخول');
      error.status = 400;
      error.code = 'COMPANY_REQUIRED';
      throw error;
    }
    const lockStatus = getLocalLoginAttemptStatus(loginAttemptKey);
    if (lockStatus.isLocked) {
      const error: any = new Error('تم إيقاف تسجيل الدخول مؤقتاً بعد 3 محاولات فاشلة. حاول مرة أخرى بعد 5 دقائق.');
      error.status = 429;
      error.code = 'LOGIN_LOCKED';
      error.details = {
        remainingSeconds: Math.ceil(lockStatus.remainingMs / 1000),
        retryAfterSeconds: Math.ceil(lockStatus.remainingMs / 1000),
        maxFailedAttempts: LOCAL_LOGIN_MAX_ATTEMPTS,
        lockoutWindowSeconds: Math.floor(LOCAL_LOGIN_LOCKOUT_MS / 1000),
      };
      throw error;
    }
    const user = await userRepo.findByCredentials(username, String(body?.password || ''));
    if (!user) {
      const failedAttempt = recordLocalFailedLoginAttempt(loginAttemptKey);
      const error: any = new Error(
        failedAttempt.isLocked
          ? 'تم إيقاف تسجيل الدخول مؤقتاً بعد 3 محاولات فاشلة. حاول مرة أخرى بعد 5 دقائق.'
          : 'اسم المستخدم أو كلمة المرور غير صحيحة'
      );
      error.status = failedAttempt.isLocked ? 429 : 401;
      error.code = failedAttempt.isLocked ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS';
      error.details = failedAttempt.isLocked
        ? {
            remainingSeconds: Math.ceil((failedAttempt.remainingMs || 0) / 1000),
            retryAfterSeconds: Math.ceil((failedAttempt.remainingMs || 0) / 1000),
            maxFailedAttempts: LOCAL_LOGIN_MAX_ATTEMPTS,
            lockoutWindowSeconds: Math.floor(LOCAL_LOGIN_LOCKOUT_MS / 1000),
          }
        : {
            remainingAttempts: failedAttempt.remainingAttempts,
          };
      throw error;
    }
    clearLocalLoginAttemptState(loginAttemptKey);
    const token = `local-token-${Date.now()}`;
    await runtimeRepo.set('last_token', token);
    const userCompanyId = String(user?.companyId || '').trim();
    if (userCompanyId && userCompanyId !== requestedCompanyId) {
      const error: any = new Error('سياق المؤسسة المحدد لا يطابق جلسة المستخدم');
      error.status = 409;
      error.code = 'COMPANY_CONTEXT_MISMATCH';
      throw error;
    }
    return { token, user: sanitizeUser({ ...user, companyId: requestedCompanyId }) };
  }

  if (method === 'GET' && first === 'next-number' && second) {
    return getNextNumber(second);
  }

  if (method === 'POST' && path === 'settings') {
    await settingsRepo.setValue(String(body?.key || ''), body?.value);
    return { success: true };
  }

  if (method === 'GET' && first === 'smart' && second === 'quickview' && third === 'product' && segments[3]) {
    return buildProductQuickView(segments[3]);
  }

  if (method === 'GET' && first === 'smart' && second === 'quickview' && third === 'cashBox' && segments[3]) {
    return buildCashBoxQuickView(segments[3]);
  }

  if (method === 'GET' && path === 'inventory/serials') {
    const itemId = String(query.get('itemId') || '').trim();
    const warehouseId = String(query.get('warehouseId') || '').trim();
    const status = String(query.get('status') || '').trim();
    const search = String(query.get('search') || '').trim().toLowerCase();
    const page = Math.max(1, Number(query.get('page') || 1));
    const pageSize = Math.max(1, Math.min(200, Number(query.get('pageSize') || 50)));
    let rows = await getCollection<ItemSerial>('item_serials');
    rows = rows
      .filter((row) => {
        if (itemId && String(row.itemId || '') !== itemId) return false;
        if (warehouseId && String(row.warehouseId || '') !== warehouseId) return false;
        if (status && String(row.status || '') !== status) return false;
        if (search && !String(row.serialNumber || '').toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => String(a.serialNumber || '').localeCompare(String(b.serialNumber || '')));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return {
      rows: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  if (method === 'POST' && path === 'parties') {
    return createOrUpdatePartyWithOpeningBalance(body);
  }

  if ((method === 'PUT' || method === 'PATCH') && first === 'parties' && second) {
    return createOrUpdatePartyWithOpeningBalance(body, second);
  }

  if (method === 'POST' && path === 'invoices') {
    const invoice: Invoice = {
      id: body?.id || createId('inv'),
      invoiceNumber: body?.invoiceNumber || (await getNextNumber('invoice')).number,
      type: body?.type || 'sale',
      status: body?.status || 'posted',
      paymentType: body?.paymentType || 'cash',
      clientId: body?.clientId || '',
      clientName: body?.clientName || '',
      date: body?.date || nowIso().slice(0, 10),
      items: body?.items || [],
      totalAmount: Number(body?.totalAmount || 0),
      paidAmount: Number(body?.paidAmount || 0),
      remainingAmount: Number(body?.remainingAmount || 0),
      currency: body?.currency || 'USD',
      targetWarehouseId: body?.targetWarehouseId,
      targetWarehouseName: body?.targetWarehouseName,
      createdAt: body?.createdAt || nowIso(),
      ...body,
    };
    await upsertInvoiceWithEffects(invoice);
    return deepClone(invoice);
  }

  if ((method === 'PUT' || method === 'PATCH') && first === 'invoices' && second) {
    const previous = await invoiceRepo.findById(second);
    if (!previous) throw new Error('الفاتورة غير موجودة');
    const invoice: Invoice = {
      ...previous,
      ...body,
      id: second,
      items: body?.items || previous.items || [],
      createdAt: previous.createdAt || nowIso(),
    };
    await upsertInvoiceWithEffects(invoice);
    return deepClone(invoice);
  }

  if (method === 'DELETE' && first === 'invoices' && second) {
    await deleteInvoiceWithEffects(second);
    return { success: true };
  }

  if (method === 'POST' && path === 'vouchers') {
    const voucher: Voucher = {
      id: body?.id || createId('v'),
      type: body?.type || 'receipt',
      status: body?.status || 'POSTED',
      date: body?.date || nowIso().slice(0, 10),
      amount: Number(body?.amount || 0),
      cashBoxId: body?.cashBoxId || '',
      cashBoxName: body?.cashBoxName || '',
      category: body?.category || '',
      description: body?.description || '',
      createdAt: body?.createdAt || nowIso(),
      ...body,
    };
    await upsertVoucherWithEffects(voucher);
    return deepClone(voucher);
  }

  if ((method === 'PUT' || method === 'PATCH') && first === 'vouchers' && second) {
    const previous = await voucherRepo.findById(second);
    if (!previous) throw new Error('السند غير موجود');
    const voucher: Voucher = {
      ...previous,
      ...body,
      id: second,
      createdAt: previous.createdAt || nowIso(),
    };
    await upsertVoucherWithEffects(voucher);
    return deepClone(voucher);
  }

  if (method === 'DELETE' && first === 'vouchers' && second) {
    await deleteVoucherWithEffects(second);
    return { success: true };
  }

  if (method === 'POST' && path === 'partners/transaction') {
    const transaction: PartnerTransaction = {
      id: body?.transaction?.id || createId('partner-tx'),
      partnerId: body?.partnerId || body?.transaction?.partnerId || '',
      partnerName: body?.transaction?.partnerName || '',
      type: body?.transaction?.type || 'capital_injection',
      amount: Number(body?.transaction?.amount || 0),
      date: body?.transaction?.date || nowIso(),
      description: body?.transaction?.description || '',
      relatedVoucherId: body?.voucher?.id || undefined,
    };
    await applyPartnerTransaction(transaction);
    if (body?.voucher && body?.cashBoxUpdate !== false) {
      await upsertVoucherWithEffects({
        ...body.voucher,
        id: body.voucher.id || createId('v'),
        amount: Number(body?.voucher?.amount || transaction.amount || 0),
        createdAt: body?.voucher?.createdAt || nowIso(),
      } as Voucher);
    }
    return transaction;
  }

  if (method === 'POST' && path === 'payroll/process') {
    return processPayrollTransaction(body);
  }

  if (method === 'POST' && path === 'expenses') {
    const expense: Expense = {
      id: body?.id || createId('exp'),
      code: body?.code || `EXP-${Date.now().toString().slice(-6)}`,
      date: body?.date || nowIso().slice(0, 10),
      description: body?.description || '',
      totalAmount: Number(body?.totalAmount || 0),
      currency: body?.currency || 'USD',
      paymentType: body?.paymentType || 'CASH',
      cashBoxId: body?.cashBoxId,
      cashBoxName: body?.cashBoxName,
      warehouseId: body?.warehouseId,
      warehouseName: body?.warehouseName,
      manufacturingOrderId: body?.manufacturingOrderId,
      status: body?.status || 'DRAFT',
      lines: Array.isArray(body?.lines) ? body.lines : [],
      postedAt: body?.postedAt,
      createdAt: body?.createdAt || nowIso(),
      ...body,
    };
    await expenseRepo.upsert(expense);
    return deepClone(expense);
  }

  if (method === 'POST' && first === 'expenses' && second && third === 'post') {
    const expense = await expenseRepo.findById(second);
    if (!expense) throw new Error('المصروف غير موجود');
    const postedExpense: Expense = {
      ...expense,
      status: 'POSTED',
      postedAt: nowIso(),
    };
    await upsertExpenseWithEffects(postedExpense);
    return deepClone(postedExpense);
  }

  if (method === 'POST' && path === 'inventory/transfer') {
    const payload = {
      id: body?.id || createId('transfer'),
      createdAt: body?.createdAt || nowIso(),
      ...body,
    };
    await upsertStockTransferWithEffects(payload);
    return payload;
  }

  if (method === 'POST' && path === 'inventory/bulk-price-update') {
    return bulkPriceUpdateLocal(body);
  }

  if (method === 'POST' && path === 'inventory/serials/import') {
    const serialNumbers = Array.isArray(body?.serialNumbers)
      ? body.serialNumbers.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
    if (!String(body?.itemId || '').trim()) throw new Error('معرف المادة مطلوب.');
    if (serialNumbers.length === 0) throw new Error('لا توجد أرقام سيريال للاستيراد.');
    const duplicate = serialNumbers.find((value, index) => serialNumbers.indexOf(value) !== index);
    if (duplicate) throw new Error(`رقم السيريال مكرر داخل القائمة: ${duplicate}`);
    const current = await getCollection<ItemSerial>('item_serials');
    const conflict = current.find((row) => serialNumbers.includes(String(row.serialNumber || '').trim()));
    if (conflict) throw new Error(`رقم السيريال مستخدم مسبقًا: ${conflict.serialNumber}`);
    const now = nowIso();
    for (const serialNumber of serialNumbers) {
      await upsertCollectionEntry('item_serials', {
        id: createId('iserial'),
        itemId: String(body.itemId),
        serialNumber,
        warehouseId: body?.warehouseId || null,
        status: 'available',
        purchaseInvoiceId: body?.purchaseInvoiceId || null,
        salesInvoiceId: null,
        createdAt: now,
        updatedAt: now,
      } as any);
    }
    await upsertCollectionEntry('audit_logs', {
      id: createId('audit-serial'),
      userId: String(body?.userId || 'local-user'),
      operationType: 'item_serial_import',
      affectedItems: [String(body.itemId)],
      newValues: { count: serialNumbers.length },
      meta: { itemId: body.itemId, warehouseId: body?.warehouseId || null, purchaseInvoiceId: body?.purchaseInvoiceId || null, serialNumbers },
      timestamp: now,
    } as any);
    return { success: true, count: serialNumbers.length };
  }

  if (method === 'POST' && path === 'promotions/evaluate') {
    const itemId = String(body?.itemId || '').trim();
    const quantity = Number(body?.quantity || 1);
    const unitPrice = Number(body?.unitPrice || 0);
    if (!itemId) throw new Error('معرف المادة مطلوب.');
    const promotionEntry = await resolveActivePromotion(itemId, quantity, body?.referenceDate);
    if (!promotionEntry) return { promotion: null };
    const { promotion, kind } = promotionEntry as any;
    let finalPrice = unitPrice;
    if (kind === 'percentage' && Number(promotion.discountPercent || 0) > 0) {
      finalPrice = Math.max(0, unitPrice * (1 - Number(promotion.discountPercent || 0) / 100));
    } else if (kind === 'amount' && Number(promotion.discountValue || 0) > 0) {
      finalPrice = Math.max(0, unitPrice - Number(promotion.discountValue || 0));
    } else if (kind === 'special_price' && Number(promotion.specialPrice || 0) > 0) {
      finalPrice = Number(promotion.specialPrice || 0);
    } else if (kind === 'buy_quantity_discount' && Number(quantity || 0) >= Number(promotion.buyQuantity || 0) && Number(promotion.getDiscountPercent || 0) > 0) {
      finalPrice = Math.max(0, unitPrice * (1 - Number(promotion.getDiscountPercent || 0) / 100));
    }
    return {
      promotion: {
        promotionId: String(promotion.id),
        promotionName: String(promotion.name || ''),
        originalPrice: unitPrice,
        finalPrice,
        discountAmount: Math.max(0, unitPrice - finalPrice),
        label: String(promotion.name || ''),
      },
    };
  }

  if (method === 'POST' && path === 'item-groups/manage') {
    return manageItemGroupsLocal(body);
  }

  if (method === 'POST' && path === 'inventory/merge') {
    return mergeInventoryItemsLocalAtomic(body);
  }

  if ((method === 'PUT' || method === 'PATCH') && first === 'inventory' && second === 'transfers' && third) {
    const previous = await transferRepo.findStockTransferById(third);
    if (!previous) throw new Error('المناقلة غير موجودة');
    const payload = {
      ...previous,
      ...body,
      id: third,
      createdAt: previous.createdAt || nowIso(),
    };
    await upsertStockTransferWithEffects(payload);
    return payload;
  }

  if (method === 'POST' && path === 'parties/transfer') {
    const payload = {
      id: body?.id || createId('party-transfer'),
      createdAt: body?.createdAt || nowIso(),
      ...body,
    };
    await partyRepo.addTransfer(payload);
    return payload;
  }

  if (method === 'POST' && path === 'opening-balances/parties') {
    const amount = Number(body?.amount || 0);
    const signedAmount = String(body?.entryType || body?.type || 'debit').toLowerCase() === 'credit' ? -amount : amount;
    if (body?.partyId) {
      await updatePartyBalance(String(body.partyId), signedAmount);
      await createPartyTransaction({
        id: createId('opening'),
        partyId: body.partyId,
        partyName: body.partyName,
        referenceType: 'opening_balance',
        referenceId: createId('opening-ref'),
        amount: signedAmount,
        currency: body.currency || 'USD',
        createdAt: body.date || nowIso(),
      });
    }
    return { success: true };
  }

  if (method === 'GET' && first === 'accounts' && second && third === 'statement') {
    return accountRepo.listStatement(Number(second));
  }

  if (method === 'GET' && first === 'parties' && second && third === 'statement') {
    const lines = await partyRepo.listTransactions();
    return lines.filter((row) => String(row.partyId) === String(second));
  }

  if (method === 'GET' && first === 'customers' && second && third === 'statement') {
    return buildPartyStatement('customers', second, query);
  }

  if (method === 'GET' && first === 'suppliers' && second && third === 'statement') {
    return buildPartyStatement('suppliers', second, query);
  }

  if (method === 'GET' && path === 'reports/item-movement') {
    const itemId = query.get('itemId');
    const invoices = await invoiceRepo.list();
    return invoices.flatMap((invoice) =>
      (invoice.items || [])
        .filter((item) => !itemId || String(item.itemId) === String(itemId))
        .map((item) => ({
          id: `${invoice.id}-${item.itemId}`,
          date: invoice.date,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          type: invoice.type,
          quantity: Number(item.quantity || 0),
          itemId: item.itemId,
          itemName: item.itemName,
        })),
    );
  }

  if (method === 'POST' && first === 'invoices' && second && third === 'stock-toggle') {
    const invoice = await invoiceRepo.findById(second);
    if (!invoice) throw new Error('الفاتورة غير موجودة');
    const nextStockStatus = body?.action === 'lock' ? 'LOCKED' : 'ACTIVE';
    await invoiceRepo.upsert({ ...invoice, stockStatus: nextStockStatus });
    return { success: true };
  }

  if (method === 'POST' && path === 'admin/recompute-party-balances') {
    return { success: true };
  }

  if (method === 'POST' && path === 'reconciliation-marks') {
    const payload: ReconciliationMark = {
      id: body?.id || createId('mark'),
      scopeType: body?.scopeType || 'PARTY',
      scopeId: body?.scopeId || '',
      reportType: body?.reportType || 'PARTY_STATEMENT',
      markAt: body?.markAt || nowIso(),
      rowRefId: body?.rowRefId,
      note: body?.note,
      isActive: body?.isActive !== false,
      createdAt: body?.createdAt || nowIso(),
    };
    await reconciliationRepo.upsert(payload);
    return payload;
  }

  if (method === 'POST' && path === 'funds/transfer') {
    const amount = Number(body?.amount || 0);
    const fromBoxId = String(body?.fromBoxId || '');
    const toBoxId = String(body?.toBoxId || '');
    if (!fromBoxId || !toBoxId) throw new Error('الصناديق مطلوبة');
    if (fromBoxId === toBoxId) throw new Error('لا يمكن المناقلة لنفس الصندوق');
    if (!(amount > 0)) throw new Error('قيمة المناقلة غير صالحة');

    const transferId = createId('fund-transfer');
    const timestamp = nowIso();
    await upsertVoucherWithEffects({
      id: `${transferId}-out`,
      type: 'payment',
      status: 'POSTED',
      date: body?.date || timestamp.slice(0, 10),
      amount,
      cashBoxId: fromBoxId,
      cashBoxName: body?.fromBoxName || '',
      category: 'تحويل صناديق',
      description: body?.notes || 'مناقلة إلى صندوق آخر',
      referenceNumber: transferId,
      createdAt: timestamp,
    } as Voucher);
    await upsertVoucherWithEffects({
      id: `${transferId}-in`,
      type: 'receipt',
      status: 'POSTED',
      date: body?.date || timestamp.slice(0, 10),
      amount,
      cashBoxId: toBoxId,
      cashBoxName: body?.toBoxName || '',
      category: 'تحويل صناديق',
      description: body?.notes || 'مناقلة من صندوق آخر',
      referenceNumber: transferId,
      createdAt: timestamp,
    } as Voucher);
    return { success: true, id: transferId };
  }

  if (method === 'POST' && path === 'system/reset') {
    await resetLocalDb();
    return { success: true };
  }

  if (method === 'GET' && path === 'delivery-notices') {
    const rows = await getCollection<DeliveryNotice>('delivery_notices');
    const createdById = String(query.get('createdById') || '');
    const status = String(query.get('status') || '').toUpperCase();
    return rows.filter((row) => {
      if (createdById && String((row as any).createdById || '') !== createdById) return false;
      if (status && String((row as any).status || '').toUpperCase() !== status) return false;
      return true;
    });
  }

  if (method === 'POST' && path === 'delivery-notices') {
    const payload: DeliveryNotice = {
      ...(body || {}),
      id: body?.id || createId('dn'),
      status: body?.status || 'DRAFT',
      createdAt: body?.createdAt || nowIso(),
    } as DeliveryNotice;
    await upsertCollectionEntry('delivery_notices', payload as any);
    return { success: true, id: payload.id };
  }

  if ((method === 'PUT' || method === 'PATCH') && first === 'delivery-notices' && second && !third) {
    const rows = await getCollection<DeliveryNotice>('delivery_notices');
    const current = rows.find((row) => String(row.id) === String(second));
    if (!current) throw new Error('إشعار التسليم غير موجود');
    const payload = { ...current, ...(body || {}), id: second } as DeliveryNotice;
    await upsertCollectionEntry('delivery_notices', payload as any);
    return { success: true, notice: payload };
  }

  if (method === 'POST' && first === 'delivery-notices' && second && third === 'submit') {
    const rows = await getCollection<DeliveryNotice>('delivery_notices');
    const current = rows.find((row) => String(row.id) === String(second));
    if (!current) throw new Error('إشعار التسليم غير موجود');
    const payload = {
      ...current,
      status: 'SUBMITTED',
      submittedAt: nowIso(),
      ...(body || {}),
    } as DeliveryNotice;
    await upsertCollectionEntry('delivery_notices', payload as any);
    return { success: true };
  }

  if (method === 'POST' && first === 'delivery-notices' && second && third === 'confirm') {
    const rows = await getCollection<DeliveryNotice>('delivery_notices');
    const current = rows.find((row) => String(row.id) === String(second));
    if (!current) throw new Error('إشعار التسليم غير موجود');
    return confirmDeliveryNotice(current, body || {});
  }

  if (method === 'POST' && first === 'delivery-notices' && second && third === 'reject') {
    const rows = await getCollection<DeliveryNotice>('delivery_notices');
    const current = rows.find((row) => String(row.id) === String(second));
    if (!current) throw new Error('إشعار التسليم غير موجود');
    const payload = {
      ...current,
      status: 'REJECTED',
      rejectReason: body?.reason || '',
      rejectedAt: nowIso(),
      ...(body || {}),
    } as DeliveryNotice;
    await upsertCollectionEntry('delivery_notices', payload as any);
    return { success: true };
  }

  if (method === 'GET' && path === 'agent-inventory') {
    const agentId = String(query.get('agentId') || '');
    const rows = await getCollection<AgentInventoryLine>('agent_inventory');
    return agentId ? rows.filter((row) => String((row as any).agentId || '') === agentId) : rows;
  }
  if (method === 'GET' && path === 'agent-inventory/summary') {
    const rows = await getCollection<AgentInventoryLine>('agent_inventory');
    const totals = new Map<string, { agentId: string; totalQty: number; itemCount: number }>();
    for (const row of rows || []) {
      const agentId = String((row as any).agentId || '');
      if (!agentId) continue;
      const current = totals.get(agentId) || { agentId, totalQty: 0, itemCount: 0 };
      current.totalQty += Number((row as any).quantity || 0);
      current.itemCount += 1;
      totals.set(agentId, current);
    }
    return Array.from(totals.values());
  }

  if (method === 'POST' && path === 'agent-inventory/transfer') {
    return transferInventoryToAgent(body || {});
  }
  if (method === 'POST' && path === 'agent-inventory/return') {
    return returnInventoryFromAgent(body || {});
  }
  if (method === 'POST' && path === 'agent-inventory/reconcile') {
    return reconcileAgentInventory(body || {});
  }

  if (method === 'POST' && first === 'agents' && second && third === 'location') {
    return upsertAgentLocation(second, Number(body?.lat || 0), Number(body?.lng || 0));
  }

  if (method === 'POST' && path === 'manufacturing/recipes') {
    const payload: Recipe = { ...(body || {}), id: body?.id || createId('recipe'), createdAt: body?.createdAt || nowIso() } as Recipe;
    await upsertCollectionEntry('manufacturing_recipes', payload as any);
    return payload;
  }

  if (method === 'DELETE' && first === 'manufacturing' && second === 'recipes' && third) {
    await deleteCollectionEntry('manufacturing_recipes', third);
    return { success: true };
  }

  if (method === 'POST' && path === 'manufacturing/process') {
    return processManufacturingOrder(body || {});
  }

  if (method === 'POST' && path === 'inventory/audit') {
    const auditItems = Array.isArray(body?.items) ? body.items : [];
    for (const row of auditItems) {
      const item = await itemRepo.findById(String(row?.id || ''));
      if (!item) continue;
      await updateInventoryQuantityById(item.id, Number(row?.quantity || 0));
    }
    return { success: true };
  }

  if (method === 'POST' && path === 'biometric-devices') {
    const payload = { ...(body || {}), id: body?.id || createId('bio'), createdAt: body?.createdAt || nowIso() };
    await upsertCollectionEntry('biometric_devices', payload as any);
    return payload;
  }

  if (method === 'DELETE' && first === 'biometric-devices' && second) {
    await deleteCollectionEntry('biometric_devices', second);
    return { success: true };
  }

  if (method === 'POST' && path === 'biometric/test-connection') return { success: true };
  if (method === 'POST' && path === 'biometric/sync') return { success: true, count: 0 };

  if (method === 'GET' && path === 'backups/list') return [];
  if (method === 'GET' && path === 'journal-entries') return [];

  if (method === 'GET' && listAliases[path]) {
    return listAliases[path]();
  }

  if (method === 'GET' && listAliases[first] && second) {
    const rows = await listAliases[first]();
    return rows.find((row: any) => String(row?.id) === String(second)) || null;
  }

  if (['POST', 'PUT', 'DELETE'].includes(method) && first) {
    const result = await writeGeneric(path.includes('/') ? first : path, method, body, second);
    return result ?? { success: true };
  }

  throw new Error(`Local SQLite runtime does not handle endpoint: ${endpoint}`);
};
