import { ensureDefaultTemplates } from './printServiceBackend';
import { normalizeSettingValue, upsertValidatedSetting } from '../lib/settings';
import { buildCompanyAccountStorageCode, seedAccountsForCompany } from '../db/companyAccountSeed';
import { appError } from '../lib/errors';

type ProvisionInput = {
  companyId?: string;
  companyCode?: string;
  companyName: string;
  branchId?: string;
  branchCode?: string;
  branchName?: string;
  warehouseId?: string;
  warehouseName?: string;
  cashBoxId?: string;
  cashBoxName?: string;
  primaryCurrency?: string;
  secondaryCurrency?: string | null;
  secondaryCurrencyRate?: number | null;
  companySettings?: Record<string, any>;
  printSettings?: Record<string, any>;
  adminUserId: string;
  adminName?: string | null;
};

const slugify = (value: string, fallback: string) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

const uniqueId = (prefix: string, seed: string) => `${prefix}-${slugify(seed, prefix)}`;

export const createCompanyProvisioningService = (deps: {
  db: any;
  schema: any;
  eq: any;
}) => {
  const { db, schema, eq } = deps;

  const saveSetting = async (executor: any, key: string, value: any, companyId: string) => {
    const { storedValue, existing, rowKey } = await upsertValidatedSetting(executor, schema, eq, key, value, { companyId });
    if (existing) {
      await executor.update(schema.systemSettings)
        .set({ companyId, branchId: null, value: storedValue })
        .where(eq(schema.systemSettings.key, rowKey))
        .run();
    } else {
      await executor.insert(schema.systemSettings).values({
        key: rowKey,
        companyId,
        branchId: null,
        value: storedValue,
      }).run();
    }
  };

  const ensureCashBoxAccount = async (
    executor: any,
    companyId: string,
    cashBoxId: string,
    cashBoxName: string,
    currencyCode: string,
  ) => {
    const lookupCode = `1110-${slugify(cashBoxId, 'cash').replace(/-/g, '').slice(0, 8)}`;
    const storageCode = buildCompanyAccountStorageCode(companyId, lookupCode);
    const existing = await executor.select().from(schema.accounts).where(eq(schema.accounts.code, storageCode)).get();
    if (existing?.id) return Number(existing.id);

    const parentStorageCode = buildCompanyAccountStorageCode(companyId, '1110');
    const parent = await executor.select().from(schema.accounts).where(eq(schema.accounts.code, parentStorageCode)).get();
    const created = await executor.insert(schema.accounts).values({
      companyId,
      code: storageCode,
      lookupCode,
      nameAr: cashBoxName,
      nameEn: null,
      parentId: parent?.id ?? null,
      level: Number(parent?.level || 1) + 1,
      accountType: parent?.accountType || 'assets',
      accountNature: parent?.accountNature || 'debit',
      isParent: false,
      isActive: true,
      isSystem: false,
      currencyCode,
      notes: `Auto-created cash box account for ${cashBoxId}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning().get();

    if (parent?.id && !parent?.isParent) {
      await executor.update(schema.accounts)
        .set({ isParent: true, updatedAt: new Date().toISOString() })
        .where(eq(schema.accounts.id, parent.id))
        .run();
    }

    return Number(created?.id || 0) || null;
  };

  const ensureRecordAbsent = async (
    table: any,
    column: any,
    value: string,
    statusCode: number,
    code: string,
    message: string,
  ) => {
    const existing = await db.select().from(table).where(eq(column, value)).get();
    if (existing) throw appError(statusCode, code, message);
  };

  const cleanupProvisionedCompany = async (companyId: string, branchId: string) => {
    const cleanupSteps: Array<() => Promise<unknown>> = [
      async () => { if (schema.printJobs) await db.delete(schema.printJobs).where(eq(schema.printJobs.companyId, companyId)).run(); },
      async () => { if (schema.queueCounters) await db.delete(schema.queueCounters).where(eq(schema.queueCounters.companyId, companyId)).run(); },
      async () => { if (schema.printers) await db.delete(schema.printers).where(eq(schema.printers.companyId, companyId)).run(); },
      async () => { if (schema.printTemplates) await db.delete(schema.printTemplates).where(eq(schema.printTemplates.companyId, companyId)).run(); },
      async () => { if (schema.accountBalances) await db.delete(schema.accountBalances).where(eq(schema.accountBalances.companyId, companyId)).run(); },
      async () => { await db.delete(schema.systemSettings).where(eq(schema.systemSettings.companyId, companyId)).run(); },
      async () => { await db.delete(schema.userBranchAccess).where(eq(schema.userBranchAccess.branchId, branchId)).run(); },
      async () => { await db.delete(schema.userCompanyAccess).where(eq(schema.userCompanyAccess.companyId, companyId)).run(); },
      async () => { await db.delete(schema.cashBoxes).where(eq(schema.cashBoxes.companyId, companyId)).run(); },
      async () => { await db.delete(schema.warehouses).where(eq(schema.warehouses.companyId, companyId)).run(); },
      async () => { await db.delete(schema.accounts).where(eq(schema.accounts.companyId, companyId)).run(); },
      async () => { await db.delete(schema.branches).where(eq(schema.branches.companyId, companyId)).run(); },
      async () => { await db.delete(schema.companies).where(eq(schema.companies.id, companyId)).run(); },
    ];

    const errors: string[] = [];
    for (const step of cleanupSteps) {
      try {
        await step();
      } catch (error: any) {
        errors.push(String(error?.message || error || 'cleanup_failed'));
      }
    }
    if (errors.length > 0) {
      console.error(`[company-provisioning] cleanup failed for ${companyId}:`, errors.join(' | '));
    }
  };

  const provisionCompany = async (input: ProvisionInput) => {
    const companyName = String(input.companyName || '').trim();
    if (!companyName) throw appError(400, 'COMPANY_NAME_REQUIRED', 'Company name is required.');

    const companyId = String(input.companyId || uniqueId('org', companyName)).trim();
    const branchId = String(input.branchId || uniqueId('br', companyId)).trim();
    const warehouseId = String(input.warehouseId || uniqueId('wh', companyId)).trim();
    const cashBoxId = String(input.cashBoxId || uniqueId('cb', companyId)).trim();
    const companyCode = String(input.companyCode || slugify(companyId, 'org')).toUpperCase().slice(0, 24) || companyId.toUpperCase().slice(0, 24);
    const branchCode = String(input.branchCode || slugify(branchId, 'branch')).toUpperCase().slice(0, 24) || branchId.toUpperCase().slice(0, 24);
    const branchName = String(input.branchName || 'Main Branch').trim();
    const warehouseName = String(input.warehouseName || 'Main Warehouse').trim();
    const cashBoxName = String(input.cashBoxName || 'Main Cash Box').trim();
    const primaryCurrency = String(input.primaryCurrency || 'USD').trim().toUpperCase() || 'USD';
    const now = new Date().toISOString();
    const adminUserId = String(input.adminUserId || '').trim();
    if (!adminUserId) throw appError(401, 'AUTH_CONTEXT_INVALID', 'Provisioning requires an authenticated administrator.');

    await ensureRecordAbsent(schema.companies, schema.companies.id, companyId, 409, 'COMPANY_ALREADY_EXISTS', 'Company id already exists.');
    await ensureRecordAbsent(schema.companies, schema.companies.code, companyCode, 409, 'COMPANY_CODE_ALREADY_EXISTS', 'Company code already exists.');
    await ensureRecordAbsent(schema.branches, schema.branches.id, branchId, 409, 'BRANCH_ALREADY_EXISTS', 'Branch id already exists.');
    await ensureRecordAbsent(schema.warehouses, schema.warehouses.id, warehouseId, 409, 'WAREHOUSE_ALREADY_EXISTS', 'Warehouse id already exists.');
    await ensureRecordAbsent(schema.cashBoxes, schema.cashBoxes.id, cashBoxId, 409, 'CASH_BOX_ALREADY_EXISTS', 'Cash box id already exists.');

    const adminUser = await db.select().from(schema.users).where(eq(schema.users.id, adminUserId)).get();
    if (!adminUser) {
      throw appError(404, 'ADMIN_USER_NOT_FOUND', 'Provisioning admin user was not found.');
    }
    const adminDisplayName = String(input.adminName || adminUser.name || adminUser.username || '').trim() || null;

    const normalizedCompanySetting = normalizeSettingValue('company', {
      name: companyName,
      ...(input.companySettings || {}),
    });
    const normalizedDefaultCurrency = normalizeSettingValue('defaultCurrency', primaryCurrency);
    const normalizedPrimaryCurrency = normalizeSettingValue('primaryCurrency', primaryCurrency);
    const normalizedSecondaryCurrency = input.secondaryCurrency
      ? normalizeSettingValue('defaultCurrency', input.secondaryCurrency)
      : null;
    const normalizedCurrencyRates = normalizedSecondaryCurrency && normalizedSecondaryCurrency !== normalizedPrimaryCurrency
      ? normalizeSettingValue('currencyRates', {
          [normalizedPrimaryCurrency]: 1,
          [normalizedSecondaryCurrency]: Number(input.secondaryCurrencyRate || 1),
        })
      : null;
    const normalizedPrintSettings = normalizeSettingValue('print', input.printSettings || {});

    const stagedResult = await db.transaction(async (tx: any) => {
      await tx.insert(schema.companies).values({
        id: companyId,
        name: companyName,
        code: companyCode,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }).run();

      await tx.insert(schema.branches).values({
        id: branchId,
        companyId,
        name: branchName,
        code: branchCode,
        isMain: true,
        isActive: true,
        location: '',
        manager: input.adminName || '',
        phone: '',
        notes: '',
        createdAt: now,
        updatedAt: now,
      }).run();

      await seedAccountsForCompany(tx, companyId);
      const cashBoxAccountId = await ensureCashBoxAccount(tx, companyId, cashBoxId, cashBoxName, normalizedPrimaryCurrency);

      await tx.insert(schema.warehouses).values({
        id: warehouseId,
        companyId,
        branchId,
        name: warehouseName,
        code: warehouseId.toUpperCase().slice(0, 24),
        isActive: true,
        location: '',
        manager: adminDisplayName || '',
      }).run();

      await tx.insert(schema.cashBoxes).values({
        id: cashBoxId,
        companyId,
        branchId,
        name: cashBoxName,
        balance: 0,
        currency: normalizedPrimaryCurrency,
        accountId: cashBoxAccountId,
        isActive: true,
      }).run();

      await tx.insert(schema.userCompanyAccess).values({
        id: `uca-${adminUserId}-${companyId}`,
        userId: adminUserId,
        companyId,
        isDefault: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().run();

      await tx.insert(schema.userBranchAccess).values({
        id: `uba-${adminUserId}-${branchId}`,
        userId: adminUserId,
        branchId,
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().run();

      await saveSetting(tx, 'company', normalizedCompanySetting, companyId);
      await saveSetting(tx, 'defaultCurrency', normalizedDefaultCurrency, companyId);
      await saveSetting(tx, 'primaryCurrency', normalizedPrimaryCurrency, companyId);
      if (normalizedCurrencyRates) {
        await saveSetting(tx, 'currencyRates', normalizedCurrencyRates, companyId);
      }
      await saveSetting(tx, 'print', normalizedPrintSettings, companyId);

      return {
        companyId,
        branchId,
        warehouseId,
        cashBoxId,
        primaryCurrency: normalizedPrimaryCurrency,
      };
    });

    try {
      await ensureDefaultTemplates(companyId);
      return stagedResult;
    } catch (error) {
      await cleanupProvisionedCompany(companyId, branchId);
      throw error;
    }
  };

  return {
    provisionCompany,
  };
};
