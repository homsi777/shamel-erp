import { z } from 'zod';
import { appError } from './errors';

const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;

const normalizeCurrencyCode = (value: any, fallback = 'USD') => {
  const normalized = String(value || fallback).trim().toUpperCase();
  return CURRENCY_CODE_REGEX.test(normalized) ? normalized : fallback;
};

const coerceCurrencyCodeInput = (value: any, fallback = 'USD') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const currencyCodeSchema = z.string().regex(CURRENCY_CODE_REGEX, 'Currency code must be a 3-letter ISO-style code.');

const coerceBoolean = (value: any, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const coerceNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseMaybeJson = (value: any) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!['{', '[', '"'].includes(trimmed[0]) && trimmed !== 'true' && trimmed !== 'false' && Number.isNaN(Number(trimmed))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const normalizeCurrencyRates = (value: any) => {
  const parsed = parseMaybeJson(value);
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const next: Record<string, number> = {};
  for (const [rawCode, rawValue] of Object.entries(source as Record<string, any>)) {
    const code = normalizeCurrencyCode(rawCode, '');
    if (!code) continue;
    const rate = coerceNumber(rawValue, NaN);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    next[code] = rate;
  }
  if (!next.USD) next.USD = 1;
  return next;
};

const currencyRatesSchema = z.record(
  z.string().regex(CURRENCY_CODE_REGEX),
  z.number().positive(),
).refine((value) => Object.keys(value || {}).length > 0, {
  message: 'At least one currency rate is required.',
});

const companySchema = z.object({
  name: z.string().default(''),
  address: z.string().default(''),
  email: z.string().default(''),
  phone1: z.string().default(''),
  phone2: z.string().default(''),
  logo: z.string().default(''),
}).passthrough();

const themeSchema = z.object({
  primaryColor: z.string().default('#0f766e'),
  secondaryColor: z.string().default('#f59e0b'),
  backgroundColor: z.string().default('#f3f4f6'),
  textColor: z.string().default('#111827'),
  inputBgColor: z.string().default('#ffffff'),
  sidebarBgColor: z.string().default('#ffffff'),
}).passthrough();

const printProfileSchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  paperSize: z.string().default('A4'),
  orientation: z.string().default('portrait'),
  headerTitle: z.string().default(''),
  headerSubtitle: z.string().default(''),
  footerText: z.string().default(''),
  showLogo: z.boolean().default(true),
  showPhone: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  showQrCode: z.boolean().default(false),
  showTaxNumber: z.boolean().default(false),
  fontSize: z.string().default('md'),
}).passthrough();

const printSchema = z.object({
  autoPrint: z.boolean().default(false),
  defaultA4PrinterId: z.string().optional().default(''),
  defaultA4PrinterName: z.string().optional().default(''),
  thermal: z.object({
    enabled: z.boolean().default(false),
    printerId: z.string().default(''),
    paperSize: z.string().default('80mm'),
    autoPrintPos: z.boolean().default(true),
  }).passthrough().optional().default({ enabled: false, printerId: '', paperSize: '80mm', autoPrintPos: true }),
  /** Restaurant / dual-printer POS — see types PrintSettings.restaurant */
  restaurant: z.object({
    queueEnabled: z.boolean().default(false),
    queueResetMode: z.enum(['continuous', 'daily']).default('daily'),
    queueScope: z.enum(['global', 'branch']).default('branch'),
    queuePrefix: z.string().default(''),
    kitchenEnabled: z.boolean().default(false),
    kitchenHost: z.string().optional().default(''),
    kitchenPort: z.number().optional().default(9100),
    kitchenPaperSize: z.enum(['58mm', '80mm']).default('80mm'),
    kitchenCopies: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    kitchenAutoPrint: z.boolean().default(true),
    customerReceiptCopies: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    customerTemplateId: z.string().optional().default(''),
    kitchenTemplateId: z.string().optional().default(''),
    showCashierOnReceipt: z.boolean().default(true),
    showQueueOnKitchen: z.boolean().default(true),
    showQueueOnCustomer: z.boolean().default(true),
  }).passthrough().optional(),
  profiles: z.record(printProfileSchema).default({}),
}).passthrough();

const deploymentSchema = z.object({
  mode: z.enum(['standalone', 'local_network']).default('standalone'),
  role: z.enum(['standalone', 'host', 'terminal']).default('standalone'),
  apiBaseUrl: z.union([z.string(), z.null()]).transform((val) => val ?? '').default(''),
  allowLocalUsbPrinting: z.boolean().default(true),
}).passthrough();

const projectProfileSchema = z.object({
  id: z.enum([
    'COMPREHENSIVE_GENERAL',
    'COMPREHENSIVE_COMMERCIAL',
    'COMPREHENSIVE_RESTAURANT',
    'COMPREHENSIVE_MANUFACTURING',
    'COMPREHENSIVE_DISTRIBUTION',
  ]).default('COMPREHENSIVE_GENERAL'),
  source: z.enum(['setup_wizard', 'settings', 'server', 'legacy_inference']).optional(),
  configuredAt: z.string().optional(),
}).passthrough();

const moduleControlSchema = z.object({
  disabledTabs: z.array(z.string()).default([]),
  forceEnabledTabs: z.array(z.string()).default([]),
  lastUpdatedAt: z.string().optional(),
  lastUpdatedBy: z.string().optional(),
  extensionCodes: z.array(z.string()).default([]),
}).passthrough();

const pricingSettingsSchema = z.object({
  enableCustomerSpecificPrices: z.boolean().default(true),
  enableLastSoldPriceRecall: z.boolean().default(true),
  pricingResolutionPriority: z.string().default('customer_special,last_sold,base_price'),
  allowManualPriceOverride: z.boolean().default(true),
  showPriceSourceInInvoice: z.boolean().default(false),
}).passthrough();

const invoiceSettingsSchema = z.object({
  showLastPurchasePriceColumn: z.boolean().default(false),
  showAvailableQtyColumn: z.boolean().default(false),
  showCommissionColumn: z.boolean().default(false),
  showColumnTotals: z.boolean().default(true),
  allowPostedInvoiceCorrection: z.boolean().default(false),
  postedInvoiceCorrectionMode: z.enum(['corrective_edit', 'reverse_recreate', 'unpost_repost']).default('reverse_recreate'),
  enableImageExport: z.boolean().default(true),
  defaultImageFormat: z.enum(['png', 'jpeg', 'jpg', 'webp']).default('png'),
  /**
   * allowDraftInvoices — when true, invoices can be saved without immediate journal posting.
   * Default: false (auto-post behavior — the standard and recommended mode).
   * Set to true only when a review/approval workflow before posting is required.
   */
  allowDraftInvoices: z.boolean().default(false),
}).passthrough();

const itemSettingsSchema = z.object({
  enableServiceItems: z.boolean().default(true),
  enableBarcodePerUnit: z.boolean().default(false),
  enableMultiUnitPricing: z.boolean().default(false),
  autoSyncAlternateCurrencyPrices: z.boolean().default(false),
  preferredPriceReferenceCurrency: currencyCodeSchema.default('USD'),
  allowManualLockOfAlternatePrice: z.boolean().default(true),
  enableTextileMode: z.boolean().default(false),
  textileRequireWarehousePreparationForSales: z.boolean().default(true),
}).passthrough();

const consignmentSettingsSchema = z.object({
  supplierPolicy: z.enum(['REAL_LEDGER', 'MEMO_ONLY']).default('REAL_LEDGER'),
}).passthrough();

const fxSettingsSchema = z.object({
  /**
   * strictFxPosting — controls what happens when the FX difference journal entry
   * fails during voucher creation.
   *
   * 'strict'  → the voucher creation fails; the entire operation is rolled back.
   *             Use this when FX gain/loss accuracy is a hard accounting requirement.
   * 'relaxed' → the FX JE failure is logged but the voucher is saved successfully.
   *             The FX difference must be posted manually later.
   *             Default: matches current production behavior.
   */
  strictFxPosting: z.enum(['strict', 'relaxed']).default('relaxed'),
}).passthrough();

const purchaseSettingsSchema = z.object({
  /**
   * requireGoodsSubtotal — when true (strict mode), purchase invoices that do not
   * supply goodsSubtotal separately from additionalCostsTotal are rejected with a
   * validation error. This prevents extra costs (shipping, customs, etc.) from
   * inflating the AP supplier balance.
   *
   * Default: false (warn-only for backward compatibility).
   * Recommended for new deployments: true.
   */
  requireGoodsSubtotal: z.boolean().default(false),
}).passthrough();

const labelsSchema = z.record(z.any()).default({});
const registeredDevicesSchema = z.array(z.record(z.any())).default([]);
const lowStockSchema = z.number().int().nonnegative().default(5);

type SettingClassification = {
  field: string;
  classification: 'authoritative' | 'ui_only' | 'deprecated';
  consumer: string;
  enforcementPoint: string;
};

export const SETTINGS_AUTHORITY_MATRIX: SettingClassification[] = [
  { field: 'currencyRates', classification: 'authoritative', consumer: 'pricing / invoices / opening', enforcementPoint: 'backend settings normalization + runtime consumers' },
  { field: 'defaultCurrency', classification: 'authoritative', consumer: 'currency baseline', enforcementPoint: 'backend currency normalization' },
  { field: 'primaryCurrency', classification: 'authoritative', consumer: 'legacy currency baseline', enforcementPoint: 'backend currency normalization' },
  { field: 'print', classification: 'authoritative', consumer: 'printing configuration', enforcementPoint: 'frontend print service' },
  { field: 'deployment', classification: 'authoritative', consumer: 'deployment/runtime configuration', enforcementPoint: 'deployment mode guards across electron/frontend/backend' },
  { field: 'projectProfile', classification: 'authoritative', consumer: 'profile-driven navigation and specialization', enforcementPoint: 'setup wizard + frontend runtime shaping' },
  { field: 'moduleControl', classification: 'authoritative', consumer: 'system-level module visibility overrides', enforcementPoint: 'super admin module control + frontend navigation shaping' },
  { field: 'pricingSettings.enableCustomerSpecificPrices', classification: 'authoritative', consumer: 'invoice pricing resolution', enforcementPoint: 'canonical invoice lifecycle' },
  { field: 'pricingSettings.enableLastSoldPriceRecall', classification: 'authoritative', consumer: 'invoice pricing resolution', enforcementPoint: 'canonical invoice lifecycle' },
  { field: 'invoiceSettings.allowPostedInvoiceCorrection', classification: 'authoritative', consumer: 'invoice edit policy', enforcementPoint: 'backend invoice update policy' },
  { field: 'invoiceSettings.postedInvoiceCorrectionMode', classification: 'authoritative', consumer: 'invoice edit policy', enforcementPoint: 'backend invoice update policy' },
  { field: 'invoiceSettings.allowDraftInvoices', classification: 'authoritative', consumer: 'invoice creation workflow', enforcementPoint: 'backend invoice lifecycle' },
  { field: 'consignmentSettings.supplierPolicy', classification: 'authoritative', consumer: 'consignment accounting', enforcementPoint: 'consignment backend routes' },
  { field: 'purchaseSettings.requireGoodsSubtotal', classification: 'authoritative', consumer: 'purchase invoice AP accuracy', enforcementPoint: 'backend invoice lifecycle' },
  { field: 'fxSettings.strictFxPosting', classification: 'authoritative', consumer: 'FX difference journal posting', enforcementPoint: 'backend voucher createVoucherWithAccounting' },
  { field: 'pricingSettings.pricingResolutionPriority', classification: 'ui_only', consumer: 'no backend consumer yet', enforcementPoint: 'not enforced' },
  { field: 'pricingSettings.allowManualPriceOverride', classification: 'ui_only', consumer: 'no backend consumer yet', enforcementPoint: 'not enforced' },
  { field: 'pricingSettings.showPriceSourceInInvoice', classification: 'ui_only', consumer: 'presentation only', enforcementPoint: 'frontend only' },
  { field: 'invoiceSettings.showLastPurchasePriceColumn', classification: 'ui_only', consumer: 'invoice UI', enforcementPoint: 'frontend only' },
  { field: 'invoiceSettings.showAvailableQtyColumn', classification: 'ui_only', consumer: 'invoice UI', enforcementPoint: 'frontend only' },
  { field: 'invoiceSettings.showCommissionColumn', classification: 'ui_only', consumer: 'invoice UI', enforcementPoint: 'frontend only' },
  { field: 'invoiceSettings.showColumnTotals', classification: 'ui_only', consumer: 'invoice UI', enforcementPoint: 'frontend only' },
  { field: 'invoiceSettings.enableImageExport', classification: 'ui_only', consumer: 'invoice export UI', enforcementPoint: 'frontend only' },
  { field: 'invoiceSettings.defaultImageFormat', classification: 'ui_only', consumer: 'invoice export UI', enforcementPoint: 'frontend only' },
  { field: 'itemSettings.enableServiceItems', classification: 'ui_only', consumer: 'item UI', enforcementPoint: 'not enforced' },
  { field: 'itemSettings.enableBarcodePerUnit', classification: 'ui_only', consumer: 'item UI', enforcementPoint: 'not enforced' },
  { field: 'itemSettings.enableMultiUnitPricing', classification: 'ui_only', consumer: 'item UI', enforcementPoint: 'not enforced' },
  { field: 'itemSettings.autoSyncAlternateCurrencyPrices', classification: 'ui_only', consumer: 'item UI', enforcementPoint: 'not enforced' },
  { field: 'itemSettings.preferredPriceReferenceCurrency', classification: 'ui_only', consumer: 'item UI', enforcementPoint: 'not enforced' },
  { field: 'itemSettings.allowManualLockOfAlternatePrice', classification: 'ui_only', consumer: 'item UI', enforcementPoint: 'not enforced' },
];

const settingSchemas = {
  company: companySchema,
  theme: themeSchema,
  print: printSchema,
  deployment: deploymentSchema,
  projectProfile: projectProfileSchema,
  moduleControl: moduleControlSchema,
  labels: labelsSchema,
  registeredDevices: registeredDevicesSchema,
  currencyRates: currencyRatesSchema,
  defaultCurrency: currencyCodeSchema,
  primaryCurrency: currencyCodeSchema,
  pricingSettings: pricingSettingsSchema,
  invoiceSettings: invoiceSettingsSchema,
  itemSettings: itemSettingsSchema,
  consignmentSettings: consignmentSettingsSchema,
  purchaseSettings: purchaseSettingsSchema,
  fxSettings: fxSettingsSchema,
  lowStockThreshold: lowStockSchema,
} as const;

export type KnownSettingKey = keyof typeof settingSchemas;

const settingDefaultInputs: Record<KnownSettingKey, any> = {
  company: {},
  theme: {},
  print: {},
  deployment: {},
  projectProfile: {},
  moduleControl: {},
  labels: {},
  registeredDevices: [],
  currencyRates: {},
  defaultCurrency: 'USD',
  primaryCurrency: 'USD',
  pricingSettings: {},
  invoiceSettings: {},
  itemSettings: {},
  consignmentSettings: {},
  purchaseSettings: {},
  fxSettings: {},
  lowStockThreshold: 5,
};

const booleanFieldsBySetting: Partial<Record<KnownSettingKey, string[]>> = {
  pricingSettings: [
    'enableCustomerSpecificPrices',
    'enableLastSoldPriceRecall',
    'allowManualPriceOverride',
    'showPriceSourceInInvoice',
  ],
  invoiceSettings: [
    'showLastPurchasePriceColumn',
    'showAvailableQtyColumn',
    'showCommissionColumn',
    'showColumnTotals',
    'allowPostedInvoiceCorrection',
    'enableImageExport',
    'allowDraftInvoices',
  ],
  itemSettings: [
    'enableServiceItems',
    'enableBarcodePerUnit',
    'enableMultiUnitPricing',
    'autoSyncAlternateCurrencyPrices',
    'allowManualLockOfAlternatePrice',
    'enableTextileMode',
    'textileRequireWarehousePreparationForSales',
  ],
};

const validateKnownSetting = (key: KnownSettingKey, value: any) => {
  const schema = settingSchemas[key];
  let normalizedSource = parseMaybeJson(value);
  if (key === 'currencyRates') normalizedSource = normalizeCurrencyRates(value);
  if (key === 'defaultCurrency' || key === 'primaryCurrency') normalizedSource = coerceCurrencyCodeInput(normalizedSource, 'USD');
  if (key === 'lowStockThreshold') normalizedSource = coerceNumber(normalizedSource, 5);

  if (key === 'pricingSettings' || key === 'invoiceSettings' || key === 'itemSettings') {
    const source = normalizedSource && typeof normalizedSource === 'object' ? normalizedSource : {};
    const booleanFields = new Set(booleanFieldsBySetting[key] || []);
    normalizedSource = Object.fromEntries(
      Object.entries(source).map(([field, entry]) => {
        if (booleanFields.has(field)) return [field, coerceBoolean(entry, entry === true)];
        if (key === 'itemSettings' && field === 'preferredPriceReferenceCurrency') {
          return [field, coerceCurrencyCodeInput(entry, 'USD')];
        }
        return [field, entry];
      })
    );
  }

  const parsed = schema.safeParse(normalizedSource);
  if (!parsed.success) {
    throw appError(400, 'INVALID_SETTING_PAYLOAD', `Invalid setting payload for ${key}.`, {
      key,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
};

export const normalizeSettingValue = (key: string, value: any) => {
  if ((settingSchemas as any)[key]) {
    return validateKnownSetting(key as KnownSettingKey, value);
  }
  return parseMaybeJson(value);
};

export const getDefaultSettingValue = (key: string) => {
  if (!(settingSchemas as any)[key]) return null;
  return validateKnownSetting(key as KnownSettingKey, settingDefaultInputs[key as KnownSettingKey]);
};

export type SettingScope = {
  companyId?: string | null;
  branchId?: string | null;
};

const SETTING_SCOPE_PREFIX = 'scoped-setting';

const normalizeScopeId = (value: any) => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const parseScopedSettingKey = (storedKey: string) => {
  const raw = String(storedKey || '').trim();
  const prefix = `${SETTING_SCOPE_PREFIX}::`;
  if (!raw.startsWith(prefix)) return null;
  const parts = raw.slice(prefix.length).split('::');
  if (parts.length < 3) return null;
  const logicalKey = parts.slice(2).join('::');
  return {
    companyId: parts[0] === '*' ? null : parts[0],
    branchId: parts[1] === '*' ? null : parts[1],
    logicalKey,
  };
};

export const buildScopedSettingKey = (key: string, scope?: SettingScope | null) => {
  const companyId = normalizeScopeId(scope?.companyId);
  const branchId = normalizeScopeId(scope?.branchId);
  if (!companyId && !branchId) return String(key || '').trim();
  return `${SETTING_SCOPE_PREFIX}::${companyId || '*'}::${branchId || '*'}::${String(key || '').trim()}`;
};

const getLogicalSettingKey = (storedKey: string) => parseScopedSettingKey(storedKey)?.logicalKey || String(storedKey || '').trim();

const getRowScope = (row: any) => {
  const storedKey = String(row?.key || '').trim();
  const parsed = parseScopedSettingKey(storedKey);
  return {
    storedKey,
    logicalKey: parsed?.logicalKey || storedKey,
    companyId: normalizeScopeId(parsed?.companyId ?? row?.companyId ?? row?.company_id),
    branchId: normalizeScopeId(parsed?.branchId ?? row?.branchId ?? row?.branch_id),
  };
};

const rowMatchesScope = (row: any, scope?: SettingScope | null) => {
  const targetCompanyId = normalizeScopeId(scope?.companyId);
  const targetBranchId = normalizeScopeId(scope?.branchId);
  const rowScope = getRowScope(row);
  if (targetCompanyId && rowScope.companyId && rowScope.companyId !== targetCompanyId) return false;
  if (targetBranchId && rowScope.branchId && rowScope.branchId !== targetBranchId) return false;
  return true;
};

const scoreScopedRow = (row: any, scope?: SettingScope | null) => {
  const targetCompanyId = normalizeScopeId(scope?.companyId);
  const targetBranchId = normalizeScopeId(scope?.branchId);
  const rowScope = getRowScope(row);
  let score = 0;
  if (targetCompanyId && rowScope.companyId === targetCompanyId) score += 10;
  else if (!rowScope.companyId) score += 1;
  else if (targetCompanyId) score -= 100;

  if (targetBranchId && rowScope.branchId === targetBranchId) score += 20;
  else if (!rowScope.branchId) score += 2;
  else if (targetBranchId) score -= 100;

  if (parseScopedSettingKey(rowScope.storedKey)) score += 3;
  return score;
};

export const getScopedSettingRow = async (
  db: any,
  schema: any,
  key: string,
  scope?: SettingScope | null,
) => {
  const rows = await db.select().from(schema.systemSettings).all();
  const logicalKey = String(key || '').trim();
  const matches = (rows || []).filter((row: any) => getLogicalSettingKey(String(row?.key || '')) === logicalKey && rowMatchesScope(row, scope));
  if (matches.length === 0) return null;
  return matches.sort((a: any, b: any) => scoreScopedRow(b, scope) - scoreScopedRow(a, scope))[0] || null;
};

export const loadNormalizedSettingsMap = async (db: any, schema: any, scope?: SettingScope | null) => {
  const rows = await db.select().from(schema.systemSettings).all();
  const map = new Map<string, any>();
  const rowMap = new Map<string, any[]>();
  for (const row of rows || []) {
    const logicalKey = getLogicalSettingKey(String((row as any)?.key || ''));
    if (!logicalKey || !rowMatchesScope(row, scope)) continue;
    const bucket = rowMap.get(logicalKey) || [];
    bucket.push(row);
    rowMap.set(logicalKey, bucket);
  }
  for (const [logicalKey, bucket] of rowMap.entries()) {
    const row = bucket.sort((a: any, b: any) => scoreScopedRow(b, scope) - scoreScopedRow(a, scope))[0];
    map.set(logicalKey, normalizeSettingValue(logicalKey, (row as any)?.value));
  }
  return map;
};

export const getInvoiceCorrectionPolicy = async (db: any, schema: any, scope?: SettingScope | null) => {
  const map = await loadNormalizedSettingsMap(db, schema, scope);
  const invoiceSettings = map.get('invoiceSettings') || invoiceSettingsSchema.parse({});
  return {
    allowPostedInvoiceCorrection: Boolean(invoiceSettings.allowPostedInvoiceCorrection),
    postedInvoiceCorrectionMode: String(invoiceSettings.postedInvoiceCorrectionMode || 'reverse_recreate'),
  };
};

export const repairPersistedSettingsRows = async (
  db: any,
  schema: any,
  eq: any,
  options?: { dryRun?: boolean }
) => {
  const rows = await db.select().from(schema.systemSettings).all();
  const result = {
    scanned: 0,
    updated: 0,
    changes: [] as Array<{ key: string; before: string; after: string }>,
    failures: [] as Array<{ key: string; error: string }>,
  };
  for (const row of rows || []) {
    const storedKey = String((row as any)?.key || '').trim();
    const key = getLogicalSettingKey(storedKey);
    if (!storedKey || !key) continue;
    result.scanned += 1;
    const before = typeof (row as any)?.value === 'string'
      ? String((row as any).value)
      : JSON.stringify((row as any)?.value ?? null);
    try {
      const normalized = normalizeSettingValue(key, (row as any)?.value);
      const after = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
      if (before === after) continue;
      result.updated += 1;
      result.changes.push({ key, before, after });
      if (!options?.dryRun) {
        await db.update(schema.systemSettings)
          .set({ value: after })
          .where(eq(schema.systemSettings.key, storedKey))
          .run();
      }
    } catch (error: any) {
      result.failures.push({
        key,
        error: error?.message || 'INVALID_SETTING_ROW',
      });
    }
  }
  return result;
};

export const upsertValidatedSetting = async (
  db: any,
  schema: any,
  eq: any,
  key: string,
  value: any,
  scope?: SettingScope | null,
) => {
  const normalizedValue = normalizeSettingValue(key, value);
  const storedValue = typeof normalizedValue === 'string' ? normalizedValue : JSON.stringify(normalizedValue);
  const rowKey = buildScopedSettingKey(key, scope);
  let existing = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, rowKey)).get();
  if (!existing && rowKey === String(key || '').trim()) {
    existing = await getScopedSettingRow(db, schema, key, scope);
  }
  return { normalizedValue, storedValue, existing, rowKey };
};
