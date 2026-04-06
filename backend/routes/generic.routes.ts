import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { BASE_CURRENCY, normalizeCurrencyCode } from '../lib/currency';
import { SETTINGS_AUTHORITY_MATRIX, getDefaultSettingValue, getScopedSettingRow, loadNormalizedSettingsMap, repairPersistedSettingsRows, upsertValidatedSetting } from '../lib/settings';
import { isAppError } from '../lib/errors';
import { assertNoDirectItemQuantityMutation } from '../inventoryService';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  enforcePayloadTenantScope,
  filterRowsByTenantScope,
  normalizeTenantId,
} from '../lib/tenantScope';
import { ensurePartyAccountLinks } from '../services/partnerAccountEnforcement';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp, auditLogger, systemEventLogger } = ctx as any;
  const getRequestUser = async (req: any) => {
      try {
          await req.jwtVerify();
          if (req?.user?.id) {
              const jwtUser = await db.select().from(schema.users).where(eq(schema.users.id, String(req.user.id))).get();
              if (jwtUser) return jwtUser;
          }
      } catch {}
      const bodyUserId = String(req?.body?.userId || '').trim();
      if (!bodyUserId) return null;
      return db.select().from(schema.users).where(eq(schema.users.id, bodyUserId)).get();
  };

  type GenericPermissionSpec = {
      read: string[];
      create: string[] | null;
      update: string[] | null;
      delete: string[] | null;
      canonicalOnly?: boolean;
  };

  const normalizeCollection = (collection: string) => {
      const raw = String(collection || '').trim();
      if (raw === 'inventory') return 'items';
      if (raw === 'clients') return 'parties';
      if (raw === 'system-settings') return 'settings';
      return raw;
  };

  const GENERIC_COLLECTION_PERMISSIONS: Record<string, GenericPermissionSpec> = {
      items: { read: ['view_inventory'], create: ['manage_inventory'], update: ['manage_inventory'], delete: ['manage_inventory'] },
      warehouses: { read: ['view_inventory'], create: ['manage_inventory'], update: ['manage_inventory'], delete: ['manage_inventory'] },
      categories: { read: ['view_inventory'], create: ['manage_inventory'], update: ['manage_inventory'], delete: ['manage_inventory'] },
      'sub-categories': { read: ['view_inventory'], create: ['manage_inventory'], update: ['manage_inventory'], delete: ['manage_inventory'] },
      units: { read: ['manage_units', 'view_inventory'], create: ['manage_units'], update: ['manage_units'], delete: ['manage_units'] },
      parties: { read: ['manage_clients', 'view_accounts', 'view_reports'], create: ['manage_clients'], update: ['manage_clients'], delete: ['manage_clients'] },
      'cash-boxes': { read: ['view_funds', 'manage_vouchers', 'access_pos', 'pos_cashier'], create: ['manage_vouchers'], update: ['manage_vouchers'], delete: ['manage_vouchers'] },
      accounts: { read: ['view_accounts'], create: ['manage_accounts'], update: ['manage_accounts'], delete: ['manage_accounts'] },
      partners: { read: ['manage_partners', 'view_reports'], create: ['manage_partners'], update: ['manage_partners'], delete: ['manage_partners'] },
      users: { read: ['manage_users'], create: ['manage_users'], update: ['manage_users'], delete: ['manage_users'] },
      employees: { read: ['view_employees', 'manage_employees', 'manage_payroll'], create: ['manage_employees', 'manage_payroll'], update: ['manage_employees', 'manage_payroll'], delete: ['manage_employees', 'manage_payroll'] },
      companies: { read: ['manage_settings'], create: ['manage_settings'], update: ['manage_settings'], delete: ['manage_settings'] },
      branches: { read: ['manage_settings'], create: ['manage_settings'], update: ['manage_settings'], delete: ['manage_settings'] },
      'user-branch-access': { read: ['manage_users'], create: ['manage_users'], update: ['manage_users'], delete: ['manage_users'] },
      'remote-branches': { read: ['manage_settings'], create: ['manage_settings'], update: ['manage_settings'], delete: ['manage_settings'] },
      settings: { read: ['manage_settings'], create: ['manage_settings'], update: ['manage_settings'], delete: ['manage_settings'] },
      'item-groups': { read: ['view_inventory'], create: ['group_manage'], update: ['group_manage'], delete: ['group_manage'] },
      'item-group-items': { read: ['view_inventory'], create: ['group_manage'], update: ['group_manage'], delete: ['group_manage'] },
      'item-serials': { read: ['view_inventory'], create: ['manage_inventory'], update: ['manage_inventory'], delete: ['manage_inventory'] },
      'item-barcodes': { read: ['view_inventory'], create: ['manage_inventory'], update: ['manage_inventory'], delete: ['manage_inventory'] },
      promotions: { read: ['view_inventory'], create: ['price_edit', 'price_bulk_edit', 'exchange_rate_update'], update: ['price_edit', 'price_bulk_edit', 'exchange_rate_update'], delete: ['price_edit', 'price_bulk_edit', 'exchange_rate_update'] },
      agents: { read: ['manage_agents', 'manage_inventory'], create: ['manage_agents'], update: ['manage_agents'], delete: ['manage_agents'] },
      'biometric-devices': { read: ['view_employees', 'manage_employees'], create: ['manage_employees'], update: ['manage_employees'], delete: ['manage_employees'] },
      invoices: { read: ['create_sale_invoice', 'create_purchase_invoice', 'access_pos', 'manage_invoice_movements'], create: null, update: null, delete: null, canonicalOnly: true },
      vouchers: { read: ['view_funds', 'manage_vouchers'], create: null, update: null, delete: null, canonicalOnly: true },
      expenses: { read: ['manage_expenses', 'view_accounts', 'view_reports'], create: null, update: null, delete: null, canonicalOnly: true },
      'agent-inventory': { read: ['manage_agents', 'manage_inventory'], create: null, update: null, delete: null, canonicalOnly: true },
      'agent-transfers': { read: ['manage_agents', 'manage_inventory'], create: null, update: null, delete: null, canonicalOnly: true },
      'party-transactions': { read: ['manage_clients', 'view_accounts', 'view_reports'], create: null, update: null, delete: null, canonicalOnly: true },
      'partner-transactions': { read: ['manage_partners', 'view_reports'], create: null, update: null, delete: null, canonicalOnly: true },
      'payroll/transactions': { read: ['view_employees', 'manage_payroll'], create: null, update: null, delete: null, canonicalOnly: true },
      'inventory/transfers': { read: ['view_inventory'], create: null, update: null, delete: null, canonicalOnly: true },
      'parties/transfers': { read: ['manage_clients', 'view_accounts', 'view_reports'], create: null, update: null, delete: null, canonicalOnly: true },
      'reconciliation-marks': { read: ['view_accounts', 'manage_accounts'], create: null, update: null, delete: null, canonicalOnly: true },
      'attendance-records': { read: ['view_employees', 'manage_employees'], create: null, update: null, delete: null, canonicalOnly: true },
      'audit-logs': { read: ['manage_settings'], create: null, update: null, delete: null, canonicalOnly: true },
  };

  const requireCollectionWritePermission = async (
      req: any,
      reply: any,
      collection: string,
      action: 'create' | 'update' | 'delete'
  ) => {
      const normalized = normalizeCollection(collection);
      const spec = GENERIC_COLLECTION_PERMISSIONS[normalized];
      if (!spec) {
          reply.status(403).send({ error: 'لا توجد سياسة صلاحيات صريحة لهذه المجموعة الحساسة.' });
          return null;
      }
      const permissions = spec[action];
      if (!permissions || permissions.length === 0) {
          reply.status(403).send({
              error: spec.canonicalOnly
                  ? 'الكتابة على هذه المجموعة عبر المسار العام محظورة. استخدم المسار canonical المخصص.'
                  : 'هذه العملية محظورة على هذه المجموعة عبر المسار العام.',
              code: spec.canonicalOnly ? 'GENERIC_CANONICAL_ONLY' : 'GENERIC_WRITE_DENIED',
          });
          return null;
      }
      return requirePermissions(req, reply, permissions);
  };

  const hasAnyPermission = (user: any, permissions: string[]) => {
      if (!user) return false;
      if (String(user.role || '').toLowerCase() === 'admin') return true;
      const perms = String(user.permissions || '')
          .split(',')
          .map((value: string) => String(value || '').trim())
          .filter(Boolean);
      return permissions.some((perm) => perms.includes(perm) || perms.includes('*'));
  };

  async function requirePermissions(req: any, reply: any, permissions: string[]) {
      const user = await getRequestUser(req);
      if (!user) {
          reply.status(401).send({ error: 'غير مصرح.' });
          return null;
      }
      if (!hasAnyPermission(user, permissions)) {
          reply.status(403).send({ error: 'صلاحيات غير كافية.' });
          return null;
      }
      return user;
  }

  const hasPriceFieldChanges = (current: any, next: any) => {
      const priceFields = ['salePrice', 'costPrice', 'wholesalePrice', 'posPrice', 'salePriceBase', 'costPriceBase', 'wholesalePriceBase', 'posPriceBase', 'priceCurrency'];
      return priceFields.some((field) => {
          if (!(field in (next || {}))) return false;
          return String((current as any)?.[field] ?? '') !== String((next as any)?.[field] ?? '');
      });
  };

  const hasGroupFieldChanges = (current: any, next: any) =>
      ['groupId', 'groupName'].some((field) => field in (next || {}) && String((current as any)?.[field] ?? '') !== String((next as any)?.[field] ?? ''));

  const toBoolean = (value: any) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes';
  };

  const GENERIC_BLOCKED_MUTATION_COLLECTIONS = new Set([
      'invoices',
      'vouchers',
      'expenses',
      'inventory/transfers',
      'parties/transfers',
      'party-transactions',
      'partner-transactions',
      'reconciliation-marks',
  ]);

  const assertGenericMutationAllowed = (collection: string, reply: any) => {
      const normalized = normalizeCollection(collection);
      if (!GENERIC_BLOCKED_MUTATION_COLLECTIONS.has(normalized)) return true;
      reply.status(403).send({
          error: 'Direct mutation for this collection is disabled. Use canonical business routes.',
          code: 'GENERIC_MUTATION_BLOCKED',
      });
      return false;
  };

  const isStrictItemQuantityGuardEnabled = () => {
      const normalized = String(
          process.env.ERP_ENFORCE_ITEM_QUANTITY_GUARD || '',
      ).trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes';
  };

  const upsertSettingAndAudit = async (req: any, key: string, value: any) => {
      const body = (req.body as any) || {};
      const requestedScope = String(body.scope || body.scopeLevel || '').trim().toLowerCase();
      const writeBranchScoped = requestedScope === 'branch' || body.branchScoped === true;
      const scope = {
          companyId: normalizeTenantId((req as any)?.authContext?.companyId),
          branchId: writeBranchScoped
              ? normalizeTenantId(body.branchId ?? (req as any)?.authContext?.branchId)
              : null,
      };
      const { storedValue, existing, normalizedValue, rowKey } = await upsertValidatedSetting(db, schema, eq, key, value, scope);
      const before = existing ? safeJsonParse(existing.value, existing.value) : undefined;
      if (existing) {
          await db.update(schema.systemSettings)
              .set({ companyId: scope.companyId, branchId: scope.branchId, value: storedValue })
              .where(eq(schema.systemSettings.key, rowKey))
              .run();
      } else {
          await db.insert(schema.systemSettings).values({
              key: rowKey,
              companyId: scope.companyId,
              branchId: scope.branchId,
              value: storedValue,
          }).run();
      }
      await auditLogger.log({
          userId: String(req?.authContext?.userId || req?.body?.userId || 'system'),
          operationType: 'settings.update',
          affectedItems: [{ key }],
          oldValues: before === undefined ? null : { key, value: before },
          newValues: { key, value: normalizedValue },
      });
      return { storedValue, existing, normalizedValue };
  };

  const normalizeInventoryPayload = (data: any): string | null => {
      if (!String(data?.name || '').trim()) return 'اسم المادة مطلوب.';
      if (!String(data?.code || '').trim()) return 'رمز المادة مطلوب.';
      if (data.quantity !== undefined && Number.isNaN(Number(data.quantity))) {
          return 'الكمية يجب أن تكون رقماً.';
      }
      if (data.costPrice !== undefined && Number.isNaN(Number(data.costPrice))) {
          return 'سعر التكلفة يجب أن يكون رقماً.';
      }
      if (data.salePrice !== undefined && Number.isNaN(Number(data.salePrice))) {
          return 'سعر البيع يجب أن يكون رقماً.';
      }

      data.name = String(data.name || '').trim();
      data.code = String(data.code || '').trim();
      data.groupId = data.groupId ? String(data.groupId).trim() : null;
      data.groupName = data.groupName ? String(data.groupName).trim() : null;
      data.merged = data.merged === true || Number(data.merged || 0) === 1;
      data.inactive = data.inactive === true || Number(data.inactive || 0) === 1;
      data.mergedIntoItemId = data.mergedIntoItemId ? String(data.mergedIntoItemId).trim() : null;
      data.quantity = Number(data.quantity || 0);
      data.costPrice = Number(data.costPrice || 0);
      data.costPriceBase = Number(data.costPriceBase ?? data.costPrice ?? 0);
      data.salePrice = Number(data.salePrice || 0);
      data.salePriceBase = Number(data.salePriceBase ?? data.salePrice ?? 0);
      data.wholesalePrice = Number(data.wholesalePrice || 0);
      data.wholesalePriceBase = Number(data.wholesalePriceBase ?? data.wholesalePrice ?? 0);
      data.posPrice = Number(data.posPrice ?? data.salePrice ?? 0);
      data.posPriceBase = Number(data.posPriceBase ?? data.posPrice ?? data.salePrice ?? 0);
      data.priceCurrency = String(data.priceCurrency || 'USD').toUpperCase();
      data.isScaleItem = toBoolean(data.isScaleItem);

      if (!data.isScaleItem) {
          data.scalePluCode = null;
          data.scaleBarcodePrefix = null;
          data.scaleBarcodeMode = null;
          data.scaleUnit = null;
          data.scalePricePerKg = null;
          data.scaleItemCodeLength = null;
          data.scaleValueLength = null;
          data.scaleDecimals = null;
          return null;
      }

      const scalePluCode = String(data.scalePluCode || '').trim();
      const scaleBarcodePrefix = String(data.scaleBarcodePrefix || '').trim();
      const scaleBarcodeMode = String(data.scaleBarcodeMode || '').trim().toLowerCase();
      const scaleUnit = String(data.scaleUnit || '').trim().toLowerCase();
      const scaleItemCodeLength = Number(data.scaleItemCodeLength);
      const scaleValueLength = Number(data.scaleValueLength);
      const scaleDecimals = data.scaleDecimals === '' || data.scaleDecimals === null || data.scaleDecimals === undefined
          ? 0
          : Number(data.scaleDecimals);
      const scalePricePerKg = Number(data.scalePricePerKg ?? data.salePrice ?? 0);

      if (!scalePluCode) return 'كود الميزان مطلوب عند تفعيل مادة الميزان.';
      if (!scaleBarcodePrefix) return 'بادئة باركود الميزان مطلوبة.';
      if (!/^\d+$/.test(scalePluCode)) return 'كود الميزان يجب أن يكون رقمياً.';
      if (!/^\d+$/.test(scaleBarcodePrefix)) return 'بادئة باركود الميزان يجب أن تكون رقمية.';
      if (scaleBarcodeMode !== 'weight' && scaleBarcodeMode !== 'price') {
          return 'نوع باركود الميزان يجب أن يكون وزن أو سعر.';
      }
      if (scaleUnit !== 'gram' && scaleUnit !== 'kilogram') {
          return 'وحدة الوزن لمادة الميزان يجب أن تكون غرام أو كيلوغرام.';
      }
      if (!Number.isInteger(scaleItemCodeLength) || scaleItemCodeLength <= 0) {
          return 'عدد خانات كود المادة داخل باركود الميزان غير صالح.';
      }
      if (!Number.isInteger(scaleValueLength) || scaleValueLength <= 0) {
          return 'عدد خانات الوزن/القيمة داخل باركود الميزان غير صالح.';
      }
      if (!Number.isInteger(scaleDecimals) || scaleDecimals < 0 || scaleDecimals > 5) {
          return 'عدد المنازل العشرية لمادة الميزان غير صالح.';
      }
      if (scaleBarcodeMode === 'weight' && !(scalePricePerKg > 0)) {
          return 'سعر الكيلو مطلوب لمادة الميزان عند اختيار باركود يحمل الوزن.';
      }

      data.scalePluCode = scalePluCode;
      data.scaleBarcodePrefix = scaleBarcodePrefix;
      data.scaleBarcodeMode = scaleBarcodeMode;
      data.scaleUnit = scaleUnit;
      data.scalePricePerKg = scalePricePerKg > 0 ? scalePricePerKg : null;
      data.scaleItemCodeLength = scaleItemCodeLength;
      data.scaleValueLength = scaleValueLength;
      data.scaleDecimals = scaleDecimals;
      data.isTextile = toBoolean(data.isTextile);
      data.supportsColorDimension = data.supportsColorDimension === undefined
          ? data.isTextile
          : toBoolean(data.supportsColorDimension);
      data.textileBaseUom = data.isTextile
          ? String(data.textileBaseUom || '').trim().toLowerCase()
          : null;
      if (data.isTextile && !['meter', 'yard'].includes(data.textileBaseUom)) {
          return 'وحدة القماش الأساسية يجب أن تكون meter أو yard.';
      }
      if (!data.isTextile) {
          data.textileBaseUom = null;
          data.supportsColorDimension = false;
      }
      return null;
  };

  const INVENTORY_MUTATION_FIELDS = new Set([
      'id',
      'companyId',
      'branchId',
      'name',
      'code',
      'groupId',
      'groupName',
      'merged',
      'inactive',
      'mergedIntoItemId',
      'barcode',
      'serialNumber',
      'serialTracking',
      'unitName',
      'unitId',
      'quantity',
      'costPrice',
      'costPriceBase',
      'salePrice',
      'salePriceBase',
      'wholesalePrice',
      'wholesalePriceBase',
      'posPrice',
      'posPriceBase',
      'pricePerMeter',
      'warehouseId',
      'warehouseName',
      'categoryId',
      'subCategoryId',
      'imageUrl',
      'minStockAlert',
      'model',
      'dimensions',
      'color',
      'origin',
      'manufacturer',
      'grossWeight',
      'netWeight',
      'isScaleItem',
      'scalePluCode',
      'scaleBarcodePrefix',
      'scaleBarcodeMode',
      'scaleUnit',
      'scalePricePerKg',
      'scaleItemCodeLength',
      'scaleValueLength',
      'scaleDecimals',
      'wholesaleWholesalePrice',
      'wholesaleWholesalePriceBase',
      'distributionPrice',
      'distributionPriceBase',
      'delegatePrice',
      'delegatePriceBase',
      'itemType',
      'priceCurrency',
      'lastPurchasePriceTransaction',
      'lastPurchaseCurrency',
      'lastPurchaseExchangeRate',
      'lastPurchaseAt',
      'isTextile',
      'textileBaseUom',
      'supportsColorDimension',
      'notes',
      'lastUpdated',
  ]);

  const sanitizeInventoryMutationPayload = (payload: Record<string, any>, opts?: { allowId?: boolean }) => {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(payload || {})) {
          if (key === 'id' && !opts?.allowId) continue;
          if (INVENTORY_MUTATION_FIELDS.has(key)) sanitized[key] = value;
      }
      return sanitized;
  };

api.get('/:collection', async (req, reply) => {
  const { collection } = req.params as any;
  const table = TABLE_MAP[collection];
  if (!table) return reply.status(404).send({ error: 'Not Found' });
  try {
      const keyParam = (req.query as any)?.key;
      const isSettings = collection === 'settings' || collection === 'system-settings';
      if (isSettings && keyParam) {
          const row = await getScopedSettingRow(db, schema, String(keyParam), {
              companyId: normalizeTenantId((req as any).authContext?.companyId),
              branchId: normalizeTenantId((req as any).authContext?.branchId),
          });
          if (!row) {
              const defaultValue = getDefaultSettingValue(String(keyParam));
              if (defaultValue !== null) {
                  return {
                      key: String(keyParam),
                      value: typeof defaultValue === 'string' ? defaultValue : JSON.stringify(defaultValue),
                      defaulted: true,
                  };
              }
              return reply.status(404).send({ error: 'Not Found' });
          }
          assertEntityBelongsToCompany(row, String((req as any).authContext?.companyId || ''));
          assertEntityBelongsToAllowedBranch(row, (req as any).authContext || {});
          return { key: (row as any).key, value: (row as any).value };
      }
      const rows = filterRowsByTenantScope(await db.select().from(table).all(), (req as any).authContext || {}, collection);
      if (isSettings) {
          const scopedMap = await loadNormalizedSettingsMap(db, schema, {
              companyId: normalizeTenantId((req as any).authContext?.companyId),
              branchId: normalizeTenantId((req as any).authContext?.branchId),
          });
          return Array.from(scopedMap.entries()).map(([key, value]) => ({ key, value }));
      }
      return rows;
  } catch (e: any) {
      return reply.status(500).send({ error: e.message });
  }
});

api.post('/:collection', async (req, reply) => {
  const { collection } = req.params as any;
  const table = TABLE_MAP[collection];
  if (!table) return reply.status(404).send({ error: 'Not Found' });
  try {
	      const authorizedUser = await requireCollectionWritePermission(req, reply, collection, 'create');
	      if (!authorizedUser) return;
          if (!assertGenericMutationAllowed(collection, reply)) return;
	      let data = { ...((req.body as any) || {}) };
	      delete data.userId;
	      if (!data.id) data.id = `${collection.charAt(0)}-${Date.now()}`;
          enforcePayloadTenantScope(data, (req as any).authContext || {}, collection);
      
      // Enhanced validation and error handling for inventory items
      if (collection === 'items' || collection === 'inventory') {
          data = sanitizeInventoryMutationPayload(data, { allowId: true });
          if (isStrictItemQuantityGuardEnabled()) {
              if (Object.prototype.hasOwnProperty.call(data, 'quantity') && Number(data.quantity || 0) !== 0) {
                  return reply.status(409).send({
                      error: 'Direct opening quantity on item create is blocked. Use opening stock posting flow.',
                      code: 'ITEM_OPENING_QTY_DIRECT_BLOCKED',
                  });
              }
              data.quantity = 0;
          }
          const normalizeError = normalizeInventoryPayload(data);
          if (normalizeError) return reply.status(400).send({ error: normalizeError });
      }
      
      // Filter out fields not in schema for the parties table to avoid 500
      if (collection === 'parties') {
          const scopedCompanyId = normalizeTenantId((req as any).authContext?.companyId);
          const scopedBranchId = normalizeTenantId((req as any).authContext?.branchId);
          if (!scopedCompanyId) {
              return reply.status(401).send({ error: 'يجب تمرير سياق مؤسسة صالح مع هذا الطلب.' });
          }
          data.companyId = scopedCompanyId;
          data.branchId = scopedBranchId || null;
          const openingEntryType = String(data.openingEntryType || '').toLowerCase();
          const openingAmount = roundMoney(Number(data.openingAmount || 0));
          const settingsMap = await loadNormalizedSettingsMap(db, schema, {
              companyId: normalizeTenantId((req as any).authContext?.companyId),
              branchId: normalizeTenantId((req as any).authContext?.branchId),
          });
          const ratesRaw = settingsMap.get('currencyRates');
          const currencyRates = (ratesRaw && typeof ratesRaw === 'object') ? ratesRaw : {};
          const explicitBaseRaw = settingsMap.get('defaultCurrency') ?? settingsMap.get('primaryCurrency') ?? settingsMap.get('baseCurrency');
          const inferredBaseFromRates = (['USD', 'SYP', 'TRY'] as const).find((code) => Number((currencyRates as any)?.[code]) === 1);
          const effectiveBaseCurrency = normalizeCurrencyCode(explicitBaseRaw || inferredBaseFromRates || BASE_CURRENCY);
          const openingCurrency = normalizeCurrencyCode(data.openingCurrency || effectiveBaseCurrency);
          const providedRate = Number(data.openingExchangeRate ?? data.exchangeRate ?? 0);
          let openingRate = openingCurrency === effectiveBaseCurrency ? 1 : (Number.isFinite(providedRate) && providedRate > 0 ? providedRate : 0);
          if (openingCurrency !== effectiveBaseCurrency && !(openingRate > 0)) {
              const targetRate = Number((currencyRates as any)?.[openingCurrency] || 0);
              const baseRate = Number((currencyRates as any)?.[effectiveBaseCurrency] || 1);
              if (targetRate > 0 && baseRate > 0) {
                  openingRate = targetRate / baseRate;
              }
          }
          if (openingCurrency !== effectiveBaseCurrency && !(openingRate > 0)) {
              return reply.status(400).send({ error: `سعر صرف عملة الرصيد الافتتاحي غير مضبوط (${openingCurrency}/${effectiveBaseCurrency}).` });
          }
          const openingAmountBase = openingCurrency === effectiveBaseCurrency
              ? openingAmount
              : roundMoney(openingAmount / openingRate);
          const hasOpening = !!openingEntryType && openingAmount > 0;

          const allowed = ['id', 'companyId', 'branchId', 'name', 'type', 'phone', 'email', 'address', 'notes', 'taxNo', 'balance', 'isActive', 'geoLat', 'geoLng', 'geoLabel', 'arAccountId', 'apAccountId', 'accountId', 'defaultPricingMode', 'allowLastPriceOverride', 'allowCustomerItemSpecialPrices', 'allowManualPriceEdit', 'preferredCurrencyForSales'];
          Object.keys(data).forEach(k => { if(!allowed.includes(k)) delete data[k]; });

          data.balance = 0;

          // Step 1: Insert the party record first (guaranteed save)
          try {
              await db.insert(table).values(data).run();
          } catch (insertErr: any) {
              console.error('Party insert error:', insertErr?.message);
              return reply.status(500).send({ error: `فشل حفظ الطرف: ${insertErr?.message || 'خطأ غير معروف'}` });
          }

          // Step 2: Create accounting sub-accounts (non-blocking â€” party already saved)
          let createdPartyAccountId: number | null = null;
          try {
              const enforcedParty = await ensurePartyAccountLinks(db, String(data.id), scopedCompanyId);
              createdPartyAccountId = Number((enforcedParty as any)?.accountId || 0) || null;
          } catch (acctErr: any) {
              await db.delete(schema.parties).where(eq(schema.parties.id, data.id)).run();
              throw new Error(`فشل إنشاء الحسابات الفرعية للطرف: ${acctErr?.message || acctErr}`);
          }

          // Step 3: Opening balance (if requested)
          if (hasOpening) {
              try {
                  const openingDelta = computePartyDelta({
                      partyType: data.type,
                      event: 'opening_balance',
                      entryType: openingEntryType,
                      totalOrAmount: openingAmountBase
                  });

                  if (openingDelta !== 0) {
                      const voucherId = `v-ob-${Date.now()}`;
                      const now = new Date().toISOString();

                      await db.transaction(async (tx: any) => {
                          await applyPartyTransaction(tx, {
                              id: ledgerIdForRef(voucherId),
                              companyId: String((req as any).authContext?.companyId || ''),
                              branchId: String((req as any).authContext?.branchId || '').trim() || null,
                              partyId: data.id,
                              partyType: data.type,
                              kind: 'opening_balance',
                              refId: voucherId,
                              amount: openingAmountBase,
                              amountBase: openingAmountBase,
                              amountTransaction: openingAmount,
                              delta: openingDelta,
                              deltaBase: openingDelta,
                              deltaTransaction: openingCurrency === effectiveBaseCurrency ? openingDelta : roundMoney(openingDelta * openingRate),
                              currency: openingCurrency,
                              exchangeRate: openingRate,
                              createdAt: now
                          });

                          await tx.insert(schema.vouchers).values({
                              id: voucherId,
                              type: 'adjustment',
                              date: now,
                              amount: openingAmountBase,
                              amountBase: openingAmountBase,
                              amountTransaction: openingAmount,
                              originalAmount: openingAmount,
                              currency: openingCurrency,
                              exchangeRate: openingRate,
                              cashBoxId: null,
                              clientId: data.id,
                              clientName: data.name,
                              category: 'منتج نهائي?',
                              description: `رصيد افتتاحي لـ ${data.type === 'SUPPLIER' ? 'مورد' : 'عميل'}: ${data.name}`,
                              referenceNumber: `OB-${data.id}`,
                          }).run();

                          await tx.insert(schema.reconciliationMarks).values({
                              id: `rm-ob-${Date.now()}`,
                              scopeType: 'parties',
                              scopeId: data.id,
                              reportType: 'opening_receivables',
                              markAt: now,
                              rowRefId: voucherId,
                              note: `رصيد افتتاحي للجهة ${data.name}`,
                          }).run();
                      });
                  }
              } catch (openingErr: any) {
                  console.error('Opening balance error (party saved OK):', openingErr?.message);
              }
          }

          // Step 4: Create journal entry for opening balance
          if (hasOpening && createdPartyAccountId) {
              try {
                  let offsetAccountId: number;
                  try {
                      offsetAccountId = await resolveAccountByCode(db, SYSTEM_ACCOUNTS.OPENING_OFFSET, scopedCompanyId);
                  } catch {
                      offsetAccountId = await resolveAccountByCode(db, SYSTEM_ACCOUNTS.RETAINED, scopedCompanyId);
                  }

                  const isDebit = openingEntryType === 'debit';
                  const entry = await createJournalEntry({
                      description: `رصيد افتتاحي — ${data.name}`,
                      referenceType: 'opening',
                      referenceId: null,
                      entryDate: new Date().toISOString(),
                      currencyCode: openingCurrency,
                      lines: [
                          {
                              accountId: createdPartyAccountId,
                              debit: isDebit ? openingAmountBase : 0,
                              credit: isDebit ? 0 : openingAmountBase,
                              description: 'رصيد افتتاحي',
                              currencyCode: openingCurrency,
                              exchangeRate: openingRate,
                              amountInCurrency: openingAmount
                          },
                          {
                              accountId: offsetAccountId,
                              debit: isDebit ? 0 : openingAmountBase,
                              credit: isDebit ? openingAmountBase : 0,
                              description: 'موازنة تلقائية - رصيد افتتاحي',
                              currencyCode: openingCurrency,
                              exchangeRate: openingRate,
                              amountInCurrency: openingAmount
                          }
                      ]
                  });
                  await postJournalEntry(entry.id);
              } catch (journalError: any) {
                  console.error('Opening balance journal creation error:', journalError?.message || journalError);
              }
          }

          return { success: true, id: data.id, openingPosted: hasOpening };
      }
      if (collection === 'invoices') {
          // Invoices are handled exclusively by invoices.routes.ts which runs first.
          // This generic handler must not process invoices to avoid duplicate-insert 400 errors.
          return reply.status(404).send({ error: 'Use /api/invoices endpoint.' });
      }
      if (collection === 'settings' || collection === 'system-settings') {
          if (!data.key) return reply.status(400).send({ error: 'Missing setting key.' });
          if (data.value === undefined) return reply.status(400).send({ error: 'Missing setting value.' });
          const { storedValue } = await upsertSettingAndAudit(req, data.key, data.value);
          return { success: true, key: data.key, value: storedValue };
      }
      if (collection === 'promotions') {
          data.itemIds = stringifyOrEmpty(data.itemIds);
          data.extraImageUrls = stringifyOrEmpty(data.extraImageUrls);
          if (data.showOnDisplay !== undefined) data.showOnDisplay = data.showOnDisplay ? 1 : 0;
      }

        await db.insert(table).values(data).run();
        if (collection === 'items' || collection === 'inventory') {
            await systemEventLogger?.log({
                eventType: SYSTEM_EVENT_TYPES.ITEM_CREATED,
                severity: 'info',
                sourceModule: 'inventory',
                action: 'item.create',
                status: 'success',
                affectedDocumentType: 'item',
                affectedDocumentId: String(data.id || ''),
                metadata: {
                    itemName: data.name || null,
                    itemCode: data.code || null,
                    warehouseId: data.warehouseId || null,
                },
            });
        }
        return { success: true };
  } catch (e: any) { 
      console.error(`DB POST ERROR [${collection}]:`, e.message);
      console.error('Error details:', e);
      
      // Provide more detailed error information
      let errorMessage = e.message;
      if (e.message.includes('SQLITE_READONLY')) {
          errorMessage = 'قاعدة البيانات للقراءة فقط - لا يمكن الحفظ. تحقق من أذونات الملفات.';
      } else if (e.message.includes('SQLITE_CANTOPEN')) {
          errorMessage = 'لا يمكن فتح قاعدة البيانات. تحقق من أن الملف موجود ولديك صلاحيات الوصول.';
      } else if (e.message.includes('SQLITE_BUSY') || e.message.includes('SQLITE_LOCKED') || e.message.toLowerCase().includes('database is locked')) {
          errorMessage = 'قاعدة البيانات مشغولة حالياً (مقفلة). أغلق أي نسخة أخرى من البرنامج ثم أعد المحاولة.';
      } else if (e.message.includes('no such table')) {
          errorMessage = 'جدول غير موجود في قاعدة البيانات. قد تحتاج إلى إعادة تهيئة قاعدة البيانات.';
      } else if (e.message.includes('UNIQUE constraint failed')) {
          errorMessage = 'يوجد مادة أو عنصر بنفس الاسم أو الرمز بالفعل.';
      } else if (e.message.includes('NOT NULL constraint failed')) {
          errorMessage = 'بعض الحقول المطلوبة غير مملوءة.';
      } else if (e.message.includes('CHECK constraint failed')) {
          errorMessage = 'قيمة غير صالحة في أحد الحقول.';
      }
      
      const statusCode = (e.message.includes('SQLITE_BUSY') || e.message.includes('SQLITE_LOCKED') || e.message.toLowerCase().includes('database is locked')) ? 503 : 500;
      if (isAppError(e)) {
          return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(statusCode).send({ 
          error: errorMessage,
          technicalDetails: process.env.NODE_ENV === 'development' ? e.message : undefined
      }); 
  }
});


// PUT /system-settings or /settings (body: { key, value }) — upsert by key
api.put('/system-settings', async (req, reply) => {
  try {
      const data = (req.body as any) || {};
      if (!data.key) return reply.status(400).send({ error: 'Missing setting key.' });
      if (data.value === undefined) return reply.status(400).send({ error: 'Missing setting value.' });
      await upsertSettingAndAudit(req, data.key, data.value);
      return { success: true };
  } catch (e: any) {
      if (isAppError(e)) return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      return reply.status(500).send({ error: e.message });
  }
});
api.put('/settings', async (req, reply) => {
  try {
      const data = (req.body as any) || {};
      if (!data.key) return reply.status(400).send({ error: 'Missing setting key.' });
      if (data.value === undefined) return reply.status(400).send({ error: 'Missing setting value.' });
      await upsertSettingAndAudit(req, data.key, data.value);
      return { success: true };
  } catch (e: any) {
      if (isAppError(e)) return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      return reply.status(500).send({ error: e.message });
  }
});

api.get('/settings-authority-matrix', async () => ({ rows: SETTINGS_AUTHORITY_MATRIX }));

api.post('/settings/repair', async (req, reply) => {
  try {
      const body = (req.body as any) || {};
      const dryRun = body.dryRun !== false;
      const result = await repairPersistedSettingsRows(db, schema, eq, { dryRun });
      await auditLogger.log({
          userId: String((req as any)?.authContext?.userId || body?.userId || 'system'),
          operationType: 'settings.repair',
          affectedItems: result.changes.map((entry: any) => ({ key: entry.key })),
          newValues: { dryRun, updated: result.updated, scanned: result.scanned },
      });
      return { success: true, dryRun, ...result };
  } catch (e: any) {
      if (isAppError(e)) return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      return reply.status(500).send({ error: e.message });
  }
});

api.put('/:collection/:id', async (req, reply) => {
  const { collection, id } = req.params as any;
  const table = TABLE_MAP[collection];
  if (!table) return reply.status(404).send({ error: 'Not Found' });
  try {
      const authorizedUser = await requireCollectionWritePermission(req, reply, collection, 'update');
      if (!authorizedUser) return;
      if (!assertGenericMutationAllowed(collection, reply)) return;
      const existingRow = await db.select().from(table).where(eq((table as any).id, id)).get();
      if (!existingRow) return reply.status(404).send({ error: 'Not Found' });
      assertEntityBelongsToCompany(existingRow, String((req as any).authContext?.companyId || ''));
      assertEntityBelongsToAllowedBranch(existingRow, (req as any).authContext || {});

      let data = { ...((req.body as any) || {}) };
      delete data.userId;
      enforcePayloadTenantScope(data, (req as any).authContext || {}, collection);

      if (collection === 'items' || collection === 'inventory') {
          const currentItem = await db.select().from(schema.items).where(eq(schema.items.id, id)).get();
          if (!currentItem) return reply.status(404).send({ error: 'Item not found.' });
          data = sanitizeInventoryMutationPayload(data);

          if (Object.prototype.hasOwnProperty.call(data, 'quantity')) {
              const requestedQty = Number(data.quantity);
              const currentQty = Number((currentItem as any)?.quantity || 0);
              if (Number.isFinite(requestedQty) && Math.abs(requestedQty - currentQty) < 0.000001) {
                  delete data.quantity;
              }
          }
          if (Object.prototype.hasOwnProperty.call(data, 'quantity')) {
              return reply.status(409).send({
                  error: 'Direct stock quantity edits are blocked. Use canonical stock movement routes.',
                  code: 'DIRECT_ITEM_QUANTITY_MUTATION_BLOCKED',
              });
          }
          assertNoDirectItemQuantityMutation(data);

          const requestingUser = await getRequestUser(req);
          const isAdmin = String(requestingUser?.role || '').toLowerCase() === 'admin';
          if (!isAdmin) {
              const requiredPermissions: string[] = [];
              if (hasPriceFieldChanges(currentItem, data)) {
                  requiredPermissions.push('price_edit', 'price_bulk_edit', 'exchange_rate_update');
              }
              if (hasGroupFieldChanges(currentItem, data)) {
                  requiredPermissions.push('group_manage');
              }
              if (requiredPermissions.length > 0) {
                  const authorized = await requirePermissions(req, reply, Array.from(new Set(requiredPermissions)));
                  if (!authorized) return;
              }
          }

          // For PUT (partial edit), merge with current item so name+code are always present for validation.
          // This prevents 400 errors when the frontend only sends changed fields.
          const mergedForValidation = {
              name: (currentItem as any).name,
              code: (currentItem as any).code,
              ...data,
          };
          const normalizeError = normalizeInventoryPayload(mergedForValidation);
          if (normalizeError) return reply.status(400).send({ error: normalizeError });
          // Copy back any normalized scalar values that were set on the merged object
          for (const k of Object.keys(data)) {
              if (mergedForValidation[k] !== undefined) data[k] = mergedForValidation[k];
          }
          // Remove quantity from data — it's blocked; don't set it to 0 on every edit
          delete data.quantity;
      }

      if (collection === 'promotions') {
          if (data.itemIds !== undefined) data.itemIds = stringifyOrEmpty(data.itemIds);
          if (data.extraImageUrls !== undefined) data.extraImageUrls = stringifyOrEmpty(data.extraImageUrls);
          if (data.showOnDisplay !== undefined) data.showOnDisplay = data.showOnDisplay ? 1 : 0;
      }

      if (Object.keys(data).length === 0) {
          return { success: true, skipped: true };
      }

      if (collection === 'parties') {
          const partyAllowed = ['name', 'type', 'phone', 'email', 'address', 'notes', 'taxNo', 'balance', 'isActive', 'geoLat', 'geoLng', 'geoLabel', 'arAccountId', 'apAccountId', 'accountId', 'defaultPricingMode', 'allowLastPriceOverride', 'allowCustomerItemSpecialPrices', 'allowManualPriceEdit', 'preferredCurrencyForSales'];
          const partyUpdate: Record<string, any> = {};
          partyAllowed.forEach(k => { if (data[k] !== undefined) partyUpdate[k] = data[k]; });
          if (Object.keys(partyUpdate).length > 0) {
              await db.update(table).set(partyUpdate).where(eq((table as any).id, id)).run();
          }
          const enforcedParty = await ensurePartyAccountLinks(
              db,
              String(id),
              normalizeTenantId((req as any).authContext?.companyId) || String((existingRow as any)?.companyId || '').trim() || null,
          );
          return {
              success: true,
              accountId: (enforcedParty as any)?.accountId || null,
              arAccountId: (enforcedParty as any)?.arAccountId || null,
              apAccountId: (enforcedParty as any)?.apAccountId || null,
          };
      }

      await db.update(table).set(data).where(eq((table as any).id, id)).run();
      if (collection === 'items' || collection === 'inventory') {
          await systemEventLogger?.log({
              eventType: SYSTEM_EVENT_TYPES.ITEM_UPDATED,
              severity: 'info',
              sourceModule: 'inventory',
              action: 'item.update',
              status: 'success',
              affectedDocumentType: 'item',
              affectedDocumentId: String(id || ''),
              metadata: {
                  updatedFields: Object.keys(data || {}),
              },
          });
      }
      return { success: true };
  } catch (e: any) {
      if (isAppError(e)) return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      if (String(e?.message || '') === 'DIRECT_ITEM_QUANTITY_MUTATION_BLOCKED') {
          return reply.status(409).send({
              error: 'Direct stock quantity edits are blocked. Use canonical stock movement routes.',
              code: 'DIRECT_ITEM_QUANTITY_MUTATION_BLOCKED',
          });
      }
      return reply.status(500).send({ error: e.message });
  }
});


api.delete('/:collection/:id', async (req, reply) => {
  const { collection, id } = req.params as any;
  const table = TABLE_MAP[collection];
  if (!table) return reply.status(404).send({ error: 'Not Found' });
	  try {
	      const authorizedUser = await requireCollectionWritePermission(req, reply, collection, 'delete');
	      if (!authorizedUser) return;
          if (!assertGenericMutationAllowed(collection, reply)) return;
          const existingRow = await db.select().from(table).where(eq((table as any).id, id)).get();
          if (!existingRow) return reply.status(404).send({ error: 'Not Found' });
          assertEntityBelongsToCompany(existingRow, String((req as any).authContext?.companyId || ''));
          assertEntityBelongsToAllowedBranch(existingRow, (req as any).authContext || {});
      // === REFERENTIAL INTEGRITY CHECKS ===
      // Prevent deletion of parties (customers/suppliers) linked to invoices, vouchers, or transactions
      if (collection === 'parties') {
          const linkedInvoices = await db.select({ cnt: sql<number>`count(*)` })
              .from(schema.invoices).where(eq(schema.invoices.clientId, id)).get();
          if (Number(linkedInvoices?.cnt || 0) > 0) {
              return reply.status(409).send({ error: `لا يمكن حذف هذا الطرف — مرتبط بـ ${linkedInvoices?.cnt} فاتورة. يجب حذف الفواتير أولاً.` });
          }
          const linkedVouchers = await db.select({ cnt: sql<number>`count(*)` })
              .from(schema.vouchers).where(eq(schema.vouchers.clientId, id)).get();
          if (Number(linkedVouchers?.cnt || 0) > 0) {
              return reply.status(409).send({ error: `لا يمكن حذف هذا الطرف — مرتبط بـ ${linkedVouchers?.cnt} سند محاسبي. يجب حذف السندات أولاً.` });
          }
          const linkedTx = await db.select({ cnt: sql<number>`count(*)` })
              .from(schema.partyTransactions).where(eq(schema.partyTransactions.partyId, id)).get();
          if (Number(linkedTx?.cnt || 0) > 0) {
              return reply.status(409).send({ error: `لا يمكن حذف هذا الطرف — يوجد ${linkedTx?.cnt} حركة مالية مرتبطة. يجب حذف الحركات أولاً.` });
          }
      }

      // Prevent deletion of inventory items linked to invoices
      if (collection === 'items' || collection === 'inventory') {
          const allInvoices = await db.select().from(schema.invoices).all();
          let linkedCount = 0;
          for (const inv of (allInvoices || [])) {
              const items = safeJsonParse((inv as any).items, []);
              if (Array.isArray(items) && items.some((line: any) => line.itemId === id)) {
                  linkedCount++;
              }
          }
          if (linkedCount > 0) {
              return reply.status(409).send({ error: `لا يمكن حذف هذه المادة — مرتبطة بـ ${linkedCount} فاتورة. يجب حذف الفواتير المرتبطة أولاً.` });
          }
      }

      // Prevent deletion of accounts linked to journal entries or parties
      if (collection === 'accounts') {
          try {
              const linkedJournalLines = await db.select({ cnt: sql<number>`count(*)` })
                  .from(schema.journalEntryLines).where(eq(schema.journalEntryLines.accountId, Number(id))).get();
              if (Number(linkedJournalLines?.cnt || 0) > 0) {
                  return reply.status(409).send({ error: `لا يمكن حذف هذا الحساب — مرتبط بـ ${linkedJournalLines?.cnt} قيد محاسبي.` });
              }
          } catch {}
          const linkedParty = await db.select({ cnt: sql<number>`count(*)` })
              .from(schema.parties).where(eq(schema.parties.accountId, Number(id))).get();
          if (Number(linkedParty?.cnt || 0) > 0) {
              return reply.status(409).send({ error: 'لا يمكن حذف هذا الحساب — مرتبط بطرف (عميل/مورد).' });
          }
      }

      if (collection === 'invoices') {
          const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
          if (!invoice) return reply.status(404).send({ error: 'Invoice not found.' });

          const invType = String((invoice as any).type || '');
          const items = safeJsonParse((invoice as any).items, []);
            const applyStock = invType !== 'purchase' ? true : Number((invoice as any).applyStock ?? 1) === 1;

          // Reverse party balance impact using ledger when available
          const partyId = (invoice as any).clientId;
          if (partyId && ['sale', 'purchase', 'return', 'exchange'].includes(invType)) {
              const party = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get();
              if (party) {
                  const sumRow = await db.select({
                      sum: sql<number>`coalesce(sum(${schema.partyTransactions.delta}), 0)`,
                      cnt: sql<number>`count(*)`
                  })
                      .from(schema.partyTransactions)
                      .where(eq(schema.partyTransactions.refId, id))
                      .get();
                  const ledgerDelta = Number(sumRow?.sum || 0);
                  const ledgerCount = Number(sumRow?.cnt || 0);
                  if (ledgerCount > 0) {
                      if (ledgerDelta !== 0) {
                          await db.update(schema.parties)
                              .set({ balance: (Number(party.balance || 0) || 0) - ledgerDelta })
                              .where(eq(schema.parties.id, partyId)).run();
                      }
                      await db.delete(schema.partyTransactions).where(eq(schema.partyTransactions.refId, id)).run();
                  } else {
                      const remainingAmount = Number((invoice as any).remainingAmount || 0);
                      if (remainingAmount !== 0) {
                          let delta = remainingAmount * (invType === 'return' ? -1 : 1);
                          if (invType === 'purchase') delta = -delta;
                          if (delta !== 0) {
                              const newBalance = (Number(party.balance || 0) || 0) - delta;
                              await db.update(schema.parties).set({ balance: newBalance }).where(eq(schema.parties.id, partyId)).run();
                          }
                      }
                  }
              }
          }

          // Reverse inventory movements
          if (applyStock) {
            const returnType = String((invoice as any).returnType || (invoice as any).return_type || '').toLowerCase();
            const isPurchaseReturn = invType === 'return' && returnType === 'purchase';
            const qtySign = invType === 'sale'
                ? -1
                : (invType === 'purchase' || invType === 'opening_stock')
                    ? 1
                    : (invType === 'return' ? (isPurchaseReturn ? -1 : 1) : 0);
              const reverseSign = -qtySign;
              if (reverseSign !== 0 && Array.isArray(items)) {
                  for (const line of items) {
                      const targetWarehouseId = line.warehouseId || (invoice as any).targetWarehouseId;
                      const lineQty = Number(line.baseQuantity ?? line.quantity ?? 0);
                      if (!line.itemId || !lineQty) continue;
                      const invItem = await db.select().from(schema.items)
                          .where(sql`${schema.items.id} = ${line.itemId} AND (${schema.items.warehouseId} = ${targetWarehouseId} OR ${targetWarehouseId} IS NULL)`)
                          .get();
                      if (!invItem) continue;
                      const itemType = (invItem as any).itemType || '';
                      if (itemType === 'SERVICE' || itemType === 'NON_STOCK') continue;
                      const newQty = (Number(invItem.quantity) || 0) + (reverseSign * lineQty);
                      await db.update(schema.items).set({ quantity: newQty, lastUpdated: new Date().toISOString() }).where(eq(schema.items.id, invItem.id)).run();
                  }
              }
          }

          const jeId = Number((invoice as any).journalEntryId);
          if (Number.isFinite(jeId)) {
              try { await reverseJournalEntry(jeId, 'حذف فاتورة'); } catch {}
          }

          // Remove linked vouchers and reverse their balances
          const voucherRows = await db.select().from(schema.vouchers).where(eq(schema.vouchers.referenceNumber, (invoice as any).invoiceNumber)).all();
          for (const v of voucherRows || []) {
              const amount = roundMoney(Number(v.amount || 0));
              const delta = v.type === 'payment' ? -amount : amount;

              if (v.cashBoxId) {
                  const box = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, v.cashBoxId)).get();
                  if (box) {
                      await db.update(schema.cashBoxes)
                          .set({ balance: Number(box.balance || 0) - delta })
                          .where(eq(schema.cashBoxes.id, box.id)).run();
                  }
              }

              const isCashMove = v.type === 'payment' || v.type === 'receipt';
              if (v.clientId && isCashMove) {
                  const party = await db.select().from(schema.parties).where(eq(schema.parties.id, v.clientId)).get();
                  if (party) {
                      const ledgerRow = await db.select({
                          sum: sql<number>`coalesce(sum(${schema.partyTransactions.delta}), 0)`,
                          cnt: sql<number>`count(*)`
                      }).from(schema.partyTransactions).where(eq(schema.partyTransactions.refId, v.id)).get();
                      const ledgerDelta = Number(ledgerRow?.sum || 0);
                      const ledgerCount = Number(ledgerRow?.cnt || 0);
                      if (ledgerCount > 0) {
                          if (ledgerDelta !== 0) {
                              const newBalance = Number(party.balance || 0) - ledgerDelta;
                              await db.update(schema.parties).set({ balance: newBalance }).where(eq(schema.parties.id, party.id)).run();
                          }
                          await db.delete(schema.partyTransactions).where(eq(schema.partyTransactions.refId, v.id)).run();
                      } else {
                          const shouldApplyLedger = await shouldApplyPartyLedgerForVoucher(db, v, isCashMove);
                          if (shouldApplyLedger) {
                              const partyDelta = computePartyDelta({
                                  partyType: party.type,
                                  event: v.type === 'receipt' ? 'receipt' : 'payment',
                                  paymentTerm: 'cash',
                                  totalOrAmount: amount
                              });
                              if (partyDelta !== 0) {
                                  const newBalance = Number(party.balance || 0) - partyDelta;
                                  await db.update(schema.parties).set({ balance: newBalance }).where(eq(schema.parties.id, party.id)).run();
                              }
                          }
                      }
                  } else {
                      await db.delete(schema.partyTransactions).where(eq(schema.partyTransactions.refId, v.id)).run();
                  }
              }

              await db.delete(schema.vouchers).where(eq(schema.vouchers.id, v.id)).run();
          }

          // Clean related movement logs
          try { await db.delete(schema.invoiceMovements).where(eq(schema.invoiceMovements.invoiceId, id)).run(); } catch {}

          await db.delete(schema.invoices).where(eq(schema.invoices.id, id)).run();
          return { success: true };
      }
      await db.delete(table).where(eq(table.id, id)).run();
      return { success: true };
  } catch (e: any) {
      console.error(`DB DELETE ERROR [${collection}]:`, e.message);
      return reply.status(500).send({ error: e.message });
  }
});

}
