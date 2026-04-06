import { eq } from 'drizzle-orm';
import { databaseConfig, databaseDialect, pgPool } from '../db';
import { appError } from '../lib/errors';
import { ensureBackupDir as ensurePgBackupDir, parsePgUrl, resolvePgBinary, runCommand } from '../../scripts/_pgTools';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSEY_VALUES = new Set(['0', 'false', 'no', 'off']);

export const TESTING_RESET_CONFIRMATION_PHRASE = 'RESET CLEAN TESTING';

export const TESTING_RESET_TABLES = {
  preserve: [
    'companies',
    'branches',
    'users',
    'user_company_access',
    'user_branch_access',
    'accounts',
    'system_settings',
    'activation_codes',
    'activation_telegram_dedupe',
    'system_super_admins',
    'license_extensions',
    'print_templates',
    'printers',
    'fiscal_periods',
  ],
  conditionalPreserve: [
    'warehouses',
    'cash_boxes',
  ],
  reseed: [
    'user_company_access',
    'user_branch_access',
    'warehouses',
    'cash_boxes',
  ],
  wipe: [
    'invoice_movements',
    'invoices',
    'vouchers',
    'journal_entry_lines',
    'journal_entries',
    'account_balances',
    'party_transactions',
    'partner_transactions',
    'expenses',
    'stock_transfers',
    'party_transfers',
    'agent_transfer_lines',
    'agent_inventory_movements',
    'agent_transfers',
    'agent_inventory',
    'agents',
    'warehouse_dispatch_notice_line_decompositions',
    'warehouse_dispatch_notice_lines',
    'warehouse_dispatch_notices',
    'delivery_notices',
    'reconciliation_items',
    'reconciliation_sessions',
    'reconciliation_marks',
    'fx_revaluation_lines',
    'fx_revaluation_runs',
    'manufacturing_orders',
    'recipes',
    'salary_transactions',
    'attendance_records',
    'biometric_devices',
    'employees',
    'consignment_settlement_lines',
    'consignment_settlements',
    'consignment_document_lines',
    'consignment_documents',
    'consignment_commission_profiles',
    'customer_item_prices',
    'item_group_items',
    'item_groups',
    'item_barcodes',
    'item_serials',
    'inventory_movements',
    'textile_stock_movements',
    'textile_stock_balances',
    'textile_colors',
    'promotions',
    'restaurant_table_request_items',
    'restaurant_table_requests',
    'restaurant_table_sessions',
    'restaurant_menu_items',
    'restaurant_tables',
    'items',
    'partners',
    'parties',
    'categories',
    'sub_categories',
    'units',
    'remote_branches',
    'document_sequences',
    'queue_counters',
    'print_jobs',
    'system_events',
    'audit_logs',
    'warehouses',
    'cash_boxes',
  ],
};

export const TESTING_RESET_DELETE_ORDER = [...TESTING_RESET_TABLES.wipe];

const normalizePermissions = (value: unknown) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeEnvFlag = (value: unknown) => String(value || '').trim().toLowerCase();

export const isTestingResetEnabled = (serverConfig?: { isProduction?: boolean; strictMode?: boolean }) => {
  const envValue = normalizeEnvFlag(process.env.ERP_ENABLE_TESTING_RESET ?? process.env.ENABLE_TESTING_RESET);
  if (TRUTHY_VALUES.has(envValue)) return true;
  if (FALSEY_VALUES.has(envValue)) return false;
  return !(serverConfig?.isProduction || serverConfig?.strictMode);
};

export const shouldPreserveTestingResetUser = (user: any) => {
  const role = String(user?.role || '').trim().toLowerCase();
  const permissions = normalizePermissions(user?.permissions);
  return role === 'admin'
    || permissions.includes('*')
    || permissions.includes('manage_settings')
    || permissions.includes('manage_users');
};

const createDbSnapshot = async (deps: any) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (databaseDialect === 'postgres') {
    const databaseUrl = databaseConfig.databaseUrl;
    if (!databaseUrl) return null;
    const backupDir = ensurePgBackupDir();
    const backupPath = deps.path.join(backupDir, `pre-testing-reset-${stamp}.dump`);
    const parsed = parsePgUrl(databaseUrl);
    const source = new URL(parsed.connectionString);
    await runCommand(
      resolvePgBinary('pg_dump'),
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--host', source.hostname,
        '--port', source.port || '5432',
        '--username', decodeURIComponent(source.username),
        '--dbname', parsed.dbName,
        '--file', backupPath,
      ],
      { PGPASSWORD: decodeURIComponent(source.password) },
    );
    return backupPath;
  }

  const dbFilePath = deps.getResolvedDbPath();
  const backupDir = deps.path.join(deps.path.dirname(dbFilePath), 'backups');
  deps.fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = deps.path.join(backupDir, `pre-testing-reset-${stamp}.db`);
  if (typeof deps.rawSqlite?.backup === 'function') {
    await deps.rawSqlite.backup(backupPath);
    return backupPath;
  }
  try { deps.rawSqlite?.pragma?.('wal_checkpoint(TRUNCATE)'); } catch {}
  deps.fs.copyFileSync(dbFilePath, backupPath);
  return backupPath;
};

const getExistingSqliteTables = (rawSqlite: any) => new Set<string>(
  rawSqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row: any) => String(row?.name || ''))
    .filter(Boolean),
);

const getExistingPostgresTables = async (client: any, tableNames: string[]) => {
  const existing = new Set<string>();
  for (const tableName of tableNames) {
    const row = await client.query<{ exists: string | null }>(
      'select to_regclass($1) as exists',
      [`public.${tableName}`],
    );
    if (row.rows[0]?.exists) existing.add(tableName);
  }
  return existing;
};

const ensurePrimaryCompanyAndBranch = async (deps: any, preservedUsers: any[], authContext: any) => {
  const companies = await deps.db.select().from(deps.schema.companies).all();
  let primaryCompany = companies.find((row: any) => Number(row?.isActive ?? 1) !== 0)
    || companies[0]
    || null;
  const requestedCompanyId = String(authContext?.companyId || preservedUsers[0]?.companyId || '').trim();

  if (!primaryCompany) {
    const companyId = requestedCompanyId || 'org-main';
    await deps.db.insert(deps.schema.companies).values({
      id: companyId,
      name: 'Main Company',
      code: String(companyId).toUpperCase().slice(0, 10) || 'ORGMAIN',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    primaryCompany = await deps.db.select().from(deps.schema.companies).where(eq(deps.schema.companies.id, companyId)).get();
  }

  const branches = await deps.db.select().from(deps.schema.branches).all();
  let primaryBranch = branches.find((row: any) => String(row?.companyId || '') === String(primaryCompany?.id || '') && Number(row?.isMain ?? 0) !== 0)
    || branches.find((row: any) => String(row?.companyId || '') === String(primaryCompany?.id || ''))
    || branches[0]
    || null;

  if (!primaryBranch) {
    await deps.db.insert(deps.schema.branches).values({
      id: 'br-main',
      companyId: String(primaryCompany?.id || 'org-main'),
      name: 'Main Branch',
      code: 'MAIN',
      isMain: true,
      isActive: true,
      location: '',
      manager: '',
      phone: '',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    primaryBranch = await deps.db.select().from(deps.schema.branches).where(eq(deps.schema.branches.id, 'br-main')).get();
  }

  return { primaryCompany, primaryBranch };
};

const reseedOperationalFoundations = async (deps: any, primaryCompany: any, primaryBranch: any) => {
  const companyId = String(primaryCompany?.id || 'org-main');
  const branchId = String(primaryBranch?.id || 'br-main');

  const existingWarehouse = await deps.db.select().from(deps.schema.warehouses)
    .where(eq(deps.schema.warehouses.branchId, branchId))
    .get();
  if (!existingWarehouse) {
    await deps.db.insert(deps.schema.warehouses).values({
      id: 'wh-main',
      companyId,
      branchId,
      name: 'Main Warehouse',
      code: 'MAIN',
      isActive: true,
      location: '',
      manager: '',
    }).run();
  }

  const existingCashBox = await deps.db.select().from(deps.schema.cashBoxes)
    .where(eq(deps.schema.cashBoxes.branchId, branchId))
    .get();
  if (!existingCashBox) {
    await deps.db.insert(deps.schema.cashBoxes).values({
      id: 'cb-main',
      companyId,
      branchId,
      name: 'Main Cash Box',
      balance: 0,
      currency: 'USD',
      isActive: true,
    }).run();
  }
};

const restorePreservedUserAccess = async (
  deps: any,
  preservedUsers: any[],
  preservedCompanyAccess: any[],
  preservedBranchAccess: any[],
  primaryCompany: any,
  primaryBranch: any,
) => {
  await deps.db.delete(deps.schema.userBranchAccess).run();
  await deps.db.delete(deps.schema.userCompanyAccess).run();

  for (const user of preservedUsers) {
    await deps.db.update(deps.schema.users).set({
      companyId: String(user?.companyId || primaryCompany?.id || 'org-main'),
      defaultBranchId: String(user?.defaultBranchId || primaryBranch?.id || 'br-main'),
      branchScope: String(user?.role || '').toLowerCase() === 'admin'
        ? 'company_wide'
        : String(user?.branchScope || 'restricted'),
      isActive: true,
    }).where(eq(deps.schema.users.id, String(user.id))).run();
  }

  for (const row of preservedCompanyAccess) {
    await deps.db.insert(deps.schema.userCompanyAccess).values(row).onConflictDoNothing().run();
  }
  for (const row of preservedBranchAccess) {
    await deps.db.insert(deps.schema.userBranchAccess).values(row).onConflictDoNothing().run();
  }

  for (const user of preservedUsers) {
    const companyId = String(user?.companyId || primaryCompany?.id || 'org-main');
    const branchId = String(user?.defaultBranchId || primaryBranch?.id || 'br-main');
    const hasCompanyAccess = preservedCompanyAccess.some((row: any) => String(row?.userId || '') === String(user.id) && String(row?.companyId || '') === companyId);
    const hasBranchAccess = preservedBranchAccess.some((row: any) => String(row?.userId || '') === String(user.id) && String(row?.branchId || '') === branchId);

    if (!hasCompanyAccess) {
      await deps.db.insert(deps.schema.userCompanyAccess).values({
        id: `uca-${user.id}-${companyId}`,
        userId: String(user.id),
        companyId,
        isDefault: true,
        isActive: true,
      }).onConflictDoNothing().run();
    }

    if (!hasBranchAccess) {
      await deps.db.insert(deps.schema.userBranchAccess).values({
        id: `uba-${user.id}-${branchId}`,
        userId: String(user.id),
        branchId,
        isDefault: true,
        isActive: true,
      }).onConflictDoNothing().run();
    }
  }
};

export const runCleanTestingReset = async (deps: any, options: {
  authContext: any;
  currentUserId: string;
  confirmationText: string;
}) => {
  if (!isTestingResetEnabled(deps.serverConfig)) {
    throw appError(403, 'TESTING_RESET_DISABLED', 'Clean testing reset is disabled.');
  }

  if (String(options.confirmationText || '').trim() !== TESTING_RESET_CONFIRMATION_PHRASE) {
    throw appError(400, 'TESTING_RESET_CONFIRMATION_REQUIRED', 'Confirmation phrase is invalid.');
  }

  const allUsers = await deps.db.select().from(deps.schema.users).all();
  const preservedUsers = (allUsers || []).filter((user: any) => shouldPreserveTestingResetUser(user));
  if (preservedUsers.length === 0) {
    throw appError(409, 'TESTING_RESET_NO_PRESERVED_USERS', 'No admin or founder-capable users can be preserved.');
  }

  const preservedUserIds = new Set(preservedUsers.map((user: any) => String(user.id)));
  const preservedCompanyAccess = (await deps.db.select().from(deps.schema.userCompanyAccess).all())
    .filter((row: any) => preservedUserIds.has(String(row?.userId || '')));
  const preservedBranchAccess = (await deps.db.select().from(deps.schema.userBranchAccess).all())
    .filter((row: any) => preservedUserIds.has(String(row?.userId || '')));

  let backupPath: string | null = null;
  try {
    backupPath = await createDbSnapshot(deps);
  } catch {
    backupPath = null;
  }

  if (databaseDialect === 'postgres' && pgPool) {
    const client = await pgPool.connect();
    try {
      const existingTables = await getExistingPostgresTables(client, TESTING_RESET_DELETE_ORDER);
      const tablesToTruncate = TESTING_RESET_DELETE_ORDER.filter((tableName) => existingTables.has(tableName));
      await client.query('BEGIN');
      if (tablesToTruncate.length > 0) {
        await client.query(`TRUNCATE TABLE ${tablesToTruncate.map((name) => `"${name}"`).join(', ')} RESTART IDENTITY CASCADE`);
      }
      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw appError(500, 'TESTING_RESET_TRUNCATE_FAILED', error?.message || 'Failed to truncate operational tables.');
    } finally {
      client.release();
    }
  } else if (deps.rawSqlite) {
    const existingTables = getExistingSqliteTables(deps.rawSqlite);
    const tablesToDelete = TESTING_RESET_DELETE_ORDER.filter((tableName) => existingTables.has(tableName));
    deps.rawSqlite.pragma('foreign_keys = OFF');
    deps.rawSqlite.exec('BEGIN IMMEDIATE');
    try {
      for (const tableName of tablesToDelete) {
        deps.rawSqlite.prepare(`DELETE FROM "${tableName}"`).run();
      }
      try {
        deps.rawSqlite.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${tablesToDelete.map(() => '?').join(',')})`).run(...tablesToDelete);
      } catch {}
      deps.rawSqlite.exec('COMMIT');
    } catch (error: any) {
      try { deps.rawSqlite.exec('ROLLBACK'); } catch {}
      throw appError(500, 'TESTING_RESET_SQLITE_DELETE_FAILED', error?.message || 'Failed to delete operational tables.');
    } finally {
      deps.rawSqlite.pragma('foreign_keys = ON');
    }
    try { deps.rawSqlite.exec('VACUUM'); } catch {}
  }

  for (const user of allUsers) {
    if (preservedUserIds.has(String(user?.id || ''))) continue;
    await deps.db.delete(deps.schema.users).where(eq(deps.schema.users.id, String(user.id))).run();
  }

  const { primaryCompany, primaryBranch } = await ensurePrimaryCompanyAndBranch(deps, preservedUsers, options.authContext);
  await restorePreservedUserAccess(deps, preservedUsers, preservedCompanyAccess, preservedBranchAccess, primaryCompany, primaryBranch);
  await reseedOperationalFoundations(deps, primaryCompany, primaryBranch);

  return {
    success: true,
    backupPath,
    preservedUserIds: Array.from(preservedUserIds),
    preservedTables: TESTING_RESET_TABLES.preserve,
    conditionalPreserveTables: TESTING_RESET_TABLES.conditionalPreserve,
    wipedTables: TESTING_RESET_TABLES.wipe,
    reseededTables: TESTING_RESET_TABLES.reseed,
    resetOrder: TESTING_RESET_DELETE_ORDER,
    featureFlagEnabled: true,
    primaryCompanyId: String(primaryCompany?.id || ''),
    primaryBranchId: String(primaryBranch?.id || ''),
  };
};
