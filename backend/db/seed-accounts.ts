/**
 * LEGACY SQLITE-ONLY MODULE
 * Disabled in PostgreSQL runtime.
 * Kept for archival/reference only.
 */
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { rawSqlite } from './index';
import { DEFAULT_BRANCH_ID, DEFAULT_COMPANY_ID } from '../lib/tenantScope';

if (process.env.DB_DIALECT !== 'sqlite') {
  throw new Error('seed-accounts.ts is SQLite-only and must not run under PostgreSQL');
}

type SeedNode = {
  code: string;
  nameAr: string;
  nameEn?: string;
  accountType: 'assets' | 'liabilities' | 'equity' | 'revenue' | 'expenses';
  accountNature: 'debit' | 'credit';
  parentCode?: string;
  isSystem?: boolean;
};

const SEED_ACCOUNTS: SeedNode[] = [
  { code: '1000', nameAr: 'الأصول', accountType: 'assets', accountNature: 'debit', isSystem: true },
  { code: '1100', nameAr: 'الأصول المتداولة', accountType: 'assets', accountNature: 'debit', parentCode: '1000', isSystem: true },
  { code: '1110', nameAr: 'الصندوق (النقدية)', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '1120', nameAr: 'البنوك', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '1130', nameAr: 'الذمم المدينة (العملاء)', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '1140', nameAr: 'المخزون', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '1150', nameAr: 'أوراق القبض', accountType: 'assets', accountNature: 'debit', parentCode: '1100' },
  { code: '1160', nameAr: 'سلف ومقدمات', accountType: 'assets', accountNature: 'debit', parentCode: '1100' },
  { code: '1200', nameAr: 'الأصول الثابتة', accountType: 'assets', accountNature: 'debit', parentCode: '1000' },
  { code: '1210', nameAr: 'المباني', accountType: 'assets', accountNature: 'debit', parentCode: '1200' },
  { code: '1220', nameAr: 'المعدات والآلات', accountType: 'assets', accountNature: 'debit', parentCode: '1200' },
  { code: '1230', nameAr: 'الأثاث والتجهيزات', accountType: 'assets', accountNature: 'debit', parentCode: '1200' },
  { code: '1240', nameAr: 'السيارات', accountType: 'assets', accountNature: 'debit', parentCode: '1200' },
  { code: '1250', nameAr: 'مجمع الإهلاك (-)', accountType: 'assets', accountNature: 'credit', parentCode: '1200' },

  { code: '2000', nameAr: 'الخصوم', accountType: 'liabilities', accountNature: 'credit', isSystem: true },
  { code: '2100', nameAr: 'الخصوم المتداولة', accountType: 'liabilities', accountNature: 'credit', parentCode: '2000', isSystem: true },
  { code: '2110', nameAr: 'الذمم الدائنة (الموردين)', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  { code: '2120', nameAr: 'أوراق الدفع', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100' },
  { code: '2130', nameAr: 'مصاريف مستحقة', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100' },
  { code: '2140', nameAr: 'ضرائب مستحقة', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  { code: '2150', nameAr: 'رواتب مستحقة', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  { code: '2200', nameAr: 'خصوم طويلة الأجل', accountType: 'liabilities', accountNature: 'credit', parentCode: '2000' },
  { code: '2210', nameAr: 'قروض طويلة الأجل', accountType: 'liabilities', accountNature: 'credit', parentCode: '2200' },

  { code: '3000', nameAr: 'حقوق الملكية', accountType: 'equity', accountNature: 'credit', isSystem: true },
  { code: '3100', nameAr: 'رأس المال', accountType: 'equity', accountNature: 'credit', parentCode: '3000' },
  { code: '3200', nameAr: 'أرباح مدورة', accountType: 'equity', accountNature: 'credit', parentCode: '3000' },
  { code: '3210', nameAr: 'فروقات الأرصدة الافتتاحية', accountType: 'equity', accountNature: 'credit', parentCode: '3000', isSystem: true },
  { code: '3300', nameAr: 'أرباح العام الحالي', accountType: 'equity', accountNature: 'credit', parentCode: '3000' },
  { code: '3400', nameAr: 'احتياطيات', accountType: 'equity', accountNature: 'credit', parentCode: '3000' },

  { code: '4000', nameAr: 'الإيرادات', accountType: 'revenue', accountNature: 'credit', isSystem: true },
  { code: '4100', nameAr: 'إيرادات المبيعات', accountType: 'revenue', accountNature: 'credit', parentCode: '4000', isSystem: true },
  { code: '4200', nameAr: 'إيرادات الخدمات', accountType: 'revenue', accountNature: 'credit', parentCode: '4000' },
  { code: '4300', nameAr: 'إيرادات أخرى', accountType: 'revenue', accountNature: 'credit', parentCode: '4000' },
  { code: '4400', nameAr: 'خصم مسموح به (-)', accountType: 'revenue', accountNature: 'debit', parentCode: '4000' },
  { code: '4500', nameAr: 'مردودات المبيعات (-)', accountType: 'revenue', accountNature: 'debit', parentCode: '4000', isSystem: true },

  { code: '5000', nameAr: 'المصروفات', accountType: 'expenses', accountNature: 'debit', isSystem: true },
  { code: '5100', nameAr: 'تكلفة البضاعة المباعة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000', isSystem: true },
  { code: '5200', nameAr: 'رواتب وأجور', accountType: 'expenses', accountNature: 'debit', parentCode: '5000', isSystem: true },
  { code: '5300', nameAr: 'إيجارات', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5400', nameAr: 'مصاريف إدارية', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5500', nameAr: 'مصاريف تسويق', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5600', nameAr: 'مصاريف صيانة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5700', nameAr: 'إهلاك', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5800', nameAr: 'مصاريف متنوعة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5900', nameAr: 'خصم مكتسب (-)', accountType: 'expenses', accountNature: 'credit', parentCode: '5000' },
  // Landed cost clearing account — credited when extra purchase costs (customs, freight, etc.) are recorded
  // and debited when settled with actual cost invoices
  { code: '2125', nameAr: 'مقاصة تكاليف الاستيراد', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  // Reconciliation write-off accounts (small differences within tolerance)
  { code: '4320', nameAr: 'أرباح تسوية الحسابات (مطابقة)', accountType: 'revenue', accountNature: 'credit', parentCode: '4300', isSystem: true },
  { code: '5820', nameAr: 'خسائر تسوية الحسابات (مطابقة)', accountType: 'expenses', accountNature: 'debit', parentCode: '5800', isSystem: true },
  // FX realized difference accounts (at settlement time)
  { code: '4310', nameAr: 'أرباح فروقات العملة المحققة', accountType: 'revenue', accountNature: 'credit', parentCode: '4300', isSystem: true },
  { code: '5810', nameAr: 'خسائر فروقات العملة المحققة', accountType: 'expenses', accountNature: 'debit', parentCode: '5800', isSystem: true },
  // FX unrealized revaluation accounts (SAP F.05 — mark-to-market, auto-reversed)
  { code: '4315', nameAr: 'أرباح فروقات العملة غير المحققة', accountType: 'revenue', accountNature: 'credit', parentCode: '4300', isSystem: true },
  { code: '5815', nameAr: 'خسائر فروقات العملة غير المحققة', accountType: 'expenses', accountNature: 'debit', parentCode: '5800', isSystem: true },
  // Period closing accounts
  { code: '3300', nameAr: 'أرباح العام الحالي', accountType: 'equity', accountNature: 'credit', parentCode: '3000', isSystem: true },
  // Consignment-related system accounts
  { code: '1141', nameAr: 'مخزون أمانة لدى العملاء', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '1142', nameAr: 'مخزون أمانة من الموردين', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '2115', nameAr: 'التزامات أمانة للموردين', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  { code: '4105', nameAr: 'إيرادات أمانة (تسويات)', accountType: 'revenue', accountNature: 'credit', parentCode: '4000' },
  { code: '5205', nameAr: 'عمولات أمانة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5805', nameAr: 'تسويات فروقات الأمانة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
];

const UNIQUE_SEED_ACCOUNTS: SeedNode[] = Array.from(
  new Map(SEED_ACCOUNTS.map((node) => [node.code, node])).values()
);

export const buildCompanyAccountStorageCode = (companyId: string, lookupCode: string) => {
  const normalizedCompanyId = String(companyId || '').trim() || DEFAULT_COMPANY_ID;
  const normalizedLookupCode = String(lookupCode || '').trim();
  if (!normalizedLookupCode) return '';
  if (normalizedCompanyId === DEFAULT_COMPANY_ID) return normalizedLookupCode;
  return `${normalizedCompanyId}::${normalizedLookupCode}`;
};

export const seedAccountsForCompany = async (db: any, companyId: string) => {
  const normalizedCompanyId = String(companyId || '').trim() || DEFAULT_COMPANY_ID;
  const existingRows = await db.select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.companyId, normalizedCompanyId))
    .all();
  if ((existingRows || []).length > 0) return { seeded: false };

  const codeToId = new Map<string, number>();
  const levels = [...UNIQUE_SEED_ACCOUNTS];
  const levelOf = (node: SeedNode) => {
    let lvl = 1;
    let current = node.parentCode;
    while (current) {
      const parent = UNIQUE_SEED_ACCOUNTS.find((n) => n.code === current);
      if (!parent) break;
      lvl += 1;
      current = parent.parentCode;
    }
    return lvl;
  };
  levels.sort((a, b) => levelOf(a) - levelOf(b));

  for (const node of levels) {
    const parentId = node.parentCode ? codeToId.get(node.parentCode) : null;
    const isParent = UNIQUE_SEED_ACCOUNTS.some((n) => n.parentCode === node.code);
    const storageCode = buildCompanyAccountStorageCode(normalizedCompanyId, node.code);
    const inserted = await db.insert(schema.accounts).values({
      companyId: normalizedCompanyId,
      code: storageCode,
      lookupCode: node.code,
      nameAr: node.nameAr,
      nameEn: node.nameEn || null,
      parentId: parentId || null,
      level: levelOf(node),
      accountType: node.accountType,
      accountNature: node.accountNature,
      isParent,
      isActive: true,
      isSystem: !!node.isSystem,
      currencyCode: 'SYP',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning({ id: schema.accounts.id }).get();
    if (inserted?.id) codeToId.set(node.code, inserted.id);
  }

  return { seeded: true };
};

export const seedAccounts = async (db: any) => {
  // Use raw SQL count — drizzle ORM can silently fail on schema mismatch
  const { cnt } = rawSqlite.prepare('SELECT COUNT(*) AS cnt FROM accounts').get() as { cnt: number };
  if (cnt > 0) return { seeded: false };

  const codeToId = new Map<string, number>();
  const levels = [...UNIQUE_SEED_ACCOUNTS];
  const levelOf = (node: SeedNode) => {
    let lvl = 1;
    let current = node.parentCode;
    while (current) {
      const parent = UNIQUE_SEED_ACCOUNTS.find(n => n.code === current);
      if (!parent) break;
      lvl += 1;
      current = parent.parentCode;
    }
    return lvl;
  };
  levels.sort((a, b) => levelOf(a) - levelOf(b));

  for (const node of levels) {
    const parentId = node.parentCode ? codeToId.get(node.parentCode) : null;
    const isParent = UNIQUE_SEED_ACCOUNTS.some(n => n.parentCode === node.code);
    const inserted = await db.insert(schema.accounts).values({
      companyId: DEFAULT_COMPANY_ID,
      code: node.code,
      lookupCode: node.code,
      nameAr: node.nameAr,
      nameEn: node.nameEn || null,
      parentId: parentId || null,
      level: levelOf(node),
      accountType: node.accountType,
      accountNature: node.accountNature,
      isParent,
      isActive: true,
      isSystem: !!node.isSystem,
      currencyCode: 'SYP',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning({ id: schema.accounts.id }).get();
    if (inserted?.id) codeToId.set(node.code, inserted.id);
  }

  return { seeded: true };
};

const CONSIGNMENT_ACCOUNT_CODES = ['1141', '1142', '2115'];
const LANDED_COST_ACCOUNT_CODES = ['2125'];
const FX_ACCOUNT_CODES = ['4310', '5810', '4315', '5815', '4320', '5820'];
const DEFAULT_COMPANY_NAME = 'المؤسسة الرئيسية';
const DEFAULT_COMPANY_CODE = 'MAIN';
const DEFAULT_BRANCH_NAME = 'الفرع الرئيسي';
const DEFAULT_BRANCH_CODE = 'MAIN';
/** Ensure consignment accounts exist (for DBs seeded before they were in SEED_ACCOUNTS). */
export const ensureConsignmentAccounts = async (db: any) => {
  for (const code of CONSIGNMENT_ACCOUNT_CODES) {
    const existing = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.code, code)).get();
    if (existing?.id) continue;
    const node = SEED_ACCOUNTS.find((n) => n.code === code);
    if (!node) continue;
    const parentRow = node.parentCode
      ? await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.code, node.parentCode)).get()
      : null;
    const parentId = parentRow?.id ?? null;
    const levelOf = (c: string): number => {
      const n = SEED_ACCOUNTS.find((x) => x.code === c);
      if (!n?.parentCode) return 1;
      return 1 + levelOf(n.parentCode);
    };
    await db.insert(schema.accounts).values({
      companyId: DEFAULT_COMPANY_ID,
      code: node.code,
      lookupCode: node.code,
      nameAr: node.nameAr,
      nameEn: node.nameEn || null,
      parentId,
      level: levelOf(node.code),
      accountType: node.accountType,
      accountNature: node.accountNature,
      isParent: false,
      isActive: true,
      isSystem: !!node.isSystem,
      currencyCode: 'SYP',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  }
};

/** Ensure landed cost clearing account exists (for DBs seeded before it was added). */
export const ensureLandedCostAccounts = async (db: any) => {
  for (const code of LANDED_COST_ACCOUNT_CODES) {
    const existing = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.code, code)).get();
    if (existing?.id) continue;
    const node = SEED_ACCOUNTS.find((n) => n.code === code);
    if (!node) continue;
    const parentRow = node.parentCode
      ? await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.code, node.parentCode)).get()
      : null;
    const parentId = parentRow?.id ?? null;
    const levelOf = (c: string): number => {
      const n = SEED_ACCOUNTS.find((x) => x.code === c);
      if (!n?.parentCode) return 1;
      return 1 + levelOf(n.parentCode);
    };
    await db.insert(schema.accounts).values({
      companyId: DEFAULT_COMPANY_ID,
      code: node.code,
      lookupCode: node.code,
      nameAr: node.nameAr,
      nameEn: node.nameEn || null,
      parentId,
      level: levelOf(node.code),
      accountType: node.accountType,
      accountNature: node.accountNature,
      isParent: false,
      isActive: true,
      isSystem: !!node.isSystem,
      currencyCode: 'SYP',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  }
};

/** Ensure FX gain/loss accounts exist (for DBs seeded before FX handling was added). */
export const ensureFxAccounts = async (db: any) => {
  for (const code of FX_ACCOUNT_CODES) {
    const existing = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.code, code)).get();
    if (existing?.id) continue;
    const node = SEED_ACCOUNTS.find((n) => n.code === code);
    if (!node) continue;
    const parentRow = node.parentCode
      ? await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.code, node.parentCode)).get()
      : null;
    const parentId = parentRow?.id ?? null;
    const levelOf = (c: string): number => {
      const n = SEED_ACCOUNTS.find((x) => x.code === c);
      if (!n?.parentCode) return 1;
      return 1 + levelOf(n.parentCode);
    };
    await db.insert(schema.accounts).values({
      companyId: DEFAULT_COMPANY_ID,
      code: node.code,
      lookupCode: node.code,
      nameAr: node.nameAr,
      nameEn: node.nameEn || null,
      parentId,
      level: levelOf(node.code),
      accountType: node.accountType,
      accountNature: node.accountNature,
      isParent: false,
      isActive: true,
      isSystem: !!node.isSystem,
      currencyCode: 'SYP',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    // Mark parent as isParent if not already
    if (parentId) {
      await db.update(schema.accounts)
        .set({ isParent: true, updatedAt: new Date().toISOString() })
        .where(eq(schema.accounts.id, parentId))
        .run();
    }
  }
};

export const seedDefaultCashBox = async (db: any) => {
  const { cnt } = rawSqlite.prepare('SELECT COUNT(*) AS cnt FROM cash_boxes').get() as { cnt: number };
  if (cnt > 0) return { seeded: false };

  await db.insert(schema.cashBoxes).values({
    id: 'cb-default',
    companyId: DEFAULT_COMPANY_ID,
    branchId: DEFAULT_BRANCH_ID,
    name: 'الصندوق العام',
    balance: 0,
    currency: 'USD',
    isActive: true,
  }).run();

  return { seeded: true };
};

export const seedDefaultParties = async (db: any) => {
  const existing = rawSqlite.prepare("SELECT id FROM parties WHERE id IN ('party-cash-customer','party-cash-supplier')").all() as { id: string }[];
  const existingIds = new Set(existing.map((r: any) => r.id));
  let count = 0;

  if (!existingIds.has('party-cash-customer')) {
    await db.insert(schema.parties).values({
      id: 'party-cash-customer',
      companyId: DEFAULT_COMPANY_ID,
      name: 'زبون نقدي',
      type: 'CUSTOMER',
      phone: '',
      email: '',
      address: '',
      notes: 'طرف افتراضي للمبيعات النقدية',
      balance: 0,
      isActive: true,
    }).run();
    count++;
  }

  if (!existingIds.has('party-cash-supplier')) {
    await db.insert(schema.parties).values({
      id: 'party-cash-supplier',
      companyId: DEFAULT_COMPANY_ID,
      name: 'مورد نقدي',
      type: 'SUPPLIER',
      phone: '',
      email: '',
      address: '',
      notes: 'طرف افتراضي للمشتريات النقدية',
      balance: 0,
      isActive: true,
    }).run();
    count++;
  }

  return { seeded: count > 0, count };
};

export const seedDefaultWarehouse = async (db: any) => {
  const { cnt } = rawSqlite.prepare('SELECT COUNT(*) AS cnt FROM warehouses').get() as { cnt: number };
  if (cnt > 0) return { seeded: false };

  await db.insert(schema.warehouses).values({
    id: 'wh-main',
    companyId: DEFAULT_COMPANY_ID,
    name: 'المستودع الرئيسي',
    code: 'WH-MAIN',
    location: '',
    manager: '',
    branchId: DEFAULT_BRANCH_ID,
    isActive: true,
  }).run();

  return { seeded: true };
};

/**
 * Ensure all required database columns exist.
 * This runs on every startup to fix schema mismatches.
 */
export const ensureDatabaseColumns = async (_db: any) => {
  const rawDb = rawSqlite; // Use the real better-sqlite3 instance
  const fixes: string[] = [];

  // Helper to check if column exists
  const columnExists = (tableName: string, columnName: string): boolean => {
    try {
      const info = rawDb.prepare(`PRAGMA table_info(${tableName})`).all();
      return info.some((col: any) => col.name === columnName);
    } catch {
      return false;
    }
  };

  const tableExists = (tableName: string): boolean => {
    try {
      const row = rawDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName) as any;
      return Boolean(row?.name);
    } catch {
      return false;
    }
  };

  // Helper to add column if missing
  const addColumnIfMissing = (tableName: string, columnName: string, columnDef: string) => {
    if (!tableExists(tableName)) return;
    if (!columnExists(tableName, columnName)) {
      try {
        rawDb.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run();
        fixes.push(`Added ${tableName}.${columnName}`);
      } catch (e: any) {
        console.warn(`Could not add ${tableName}.${columnName}:`, e.message);
      }
    }
  };

  const createIndexIfMissing = (indexName: string, statement: string) => {
    try {
      rawDb.prepare(statement).run();
      fixes.push(`Ensured index ${indexName}`);
    } catch (e: any) {
      console.warn(`Could not ensure index ${indexName}:`, e.message);
    }
  };

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure companies table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT,
        is_main INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        location TEXT,
        manager TEXT,
        phone TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure branches table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS user_branch_access (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        role_override TEXT,
        permission_override TEXT,
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing(
      'idx_user_branch_access_user_branch',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_branch_access_user_branch ON user_branch_access(user_id, branch_id)'
    );
  } catch (e: any) {
    console.warn('Could not ensure user_branch_access table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS user_company_access (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        role_override TEXT,
        permission_override TEXT,
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing(
      'idx_user_company_access_user_company',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_company_access_user_company ON user_company_access(user_id, company_id)'
    );
  } catch (e: any) {
    console.warn('Could not ensure user_company_access table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS queue_counters (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        scope_key TEXT NOT NULL UNIQUE,
        last_value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure queue_counters table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS document_sequences (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        sequence_key TEXT NOT NULL UNIQUE,
        document_type TEXT NOT NULL,
        last_value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure document_sequences table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        invoice_id TEXT,
        print_type TEXT NOT NULL,
        printer_id TEXT,
        printer_name TEXT,
        template_id TEXT,
        status TEXT NOT NULL,
        copies INTEGER DEFAULT 1,
        queue_number TEXT,
        payload_summary TEXT,
        error_message TEXT,
        triggered_by_id TEXT,
        triggered_by_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure print_jobs table:', e.message);
  }
  addColumnIfMissing('print_jobs', 'document_type', 'TEXT');
  addColumnIfMissing('print_jobs', 'template_id', 'TEXT');
  addColumnIfMissing('print_jobs', 'payload_summary', 'TEXT');
  addColumnIfMissing('print_jobs', 'printer_address', 'TEXT');
  addColumnIfMissing('print_jobs', 'printer_connection_type', 'TEXT');
  addColumnIfMissing('print_jobs', 'invoice_number', 'TEXT');
  addColumnIfMissing('print_jobs', 'printed_at', 'TEXT');
  addColumnIfMissing('print_jobs', 'source', 'TEXT');
  addColumnIfMissing('print_jobs', 'created_by_id', 'TEXT');
  addColumnIfMissing('print_jobs', 'created_by_name', 'TEXT');

  const companyOnlyTables = [
    'users',
    'parties',
    'accounts',
    'journal_entries',
    'journal_entry_lines',
    'item_barcodes',
    'customer_item_prices',
    'item_groups',
    'item_group_items',
    'categories',
    'sub_categories',
    'units',
    'partners',
    'recipes',
    'consignment_commission_profiles',
    'system_settings',
    'audit_logs',
    'system_events',
    'remote_branches',
  ];
  const branchScopedTables = [
    'employees',
    'salary_transactions',
    'biometric_devices',
    'attendance_records',
    'party_transactions',
    'items',
    'item_serials',
    'promotions',
    'warehouses',
    'agents',
        'agent_inventory',
        'agent_transfers',
        'agent_transfer_lines',
        'agent_inventory_movements',
    'stock_transfers',
    'party_transfers',
    'delivery_notices',
    'cash_boxes',
    'vouchers',
    'invoices',
    'invoice_movements',
    'reconciliation_marks',
    'partner_transactions',
    'manufacturing_orders',
    'expenses',
    'consignment_documents',
    'consignment_document_lines',
    'consignment_settlements',
    'consignment_settlement_lines',
    'inventory_movements',
  ];

  for (const tableName of companyOnlyTables) {
    addColumnIfMissing(tableName, 'company_id', 'TEXT');
  }
  for (const tableName of branchScopedTables) {
    addColumnIfMissing(tableName, 'company_id', 'TEXT');
    addColumnIfMissing(tableName, 'branch_id', 'TEXT');
  }

  addColumnIfMissing('users', 'default_branch_id', 'TEXT');
  addColumnIfMissing('users', 'branch_scope', 'TEXT DEFAULT \'restricted\'');
  addColumnIfMissing('accounts', 'lookup_code', 'TEXT');
  addColumnIfMissing('account_balances', 'company_id', 'TEXT');
  addColumnIfMissing('warehouses', 'code', 'TEXT');
  addColumnIfMissing('warehouses', 'is_active', 'INTEGER DEFAULT 1');
  addColumnIfMissing('branches', 'company_id', 'TEXT');
  addColumnIfMissing('branches', 'code', 'TEXT');
  addColumnIfMissing('branches', 'is_main', 'INTEGER DEFAULT 0');
  addColumnIfMissing('branches', 'is_active', 'INTEGER DEFAULT 1');
  addColumnIfMissing('branches', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('cash_boxes', 'branch_id', 'TEXT');
  addColumnIfMissing('cash_boxes', 'company_id', 'TEXT');
  addColumnIfMissing('cash_boxes', 'is_active', 'INTEGER DEFAULT 1');
  addColumnIfMissing('system_settings', 'branch_id', 'TEXT');
  addColumnIfMissing('remote_branches', 'branch_id', 'TEXT');
  addColumnIfMissing('remote_branches', 'client_id', 'TEXT');
  addColumnIfMissing('remote_branches', 'client_name', 'TEXT');
  addColumnIfMissing('remote_branches', 'user_id', 'TEXT');
  addColumnIfMissing('remote_branches', 'user_name', 'TEXT');
  addColumnIfMissing('remote_branches', 'device_label', 'TEXT');
  addColumnIfMissing('remote_branches', 'platform', 'TEXT');
  addColumnIfMissing('remote_branches', 'app_version', 'TEXT');
  addColumnIfMissing('remote_branches', 'user_agent', 'TEXT');
  addColumnIfMissing('remote_branches', 'session_id', 'TEXT');
  addColumnIfMissing('remote_branches', 'last_seen', 'TEXT');
  addColumnIfMissing('agents', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('agent_inventory', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('agent_transfers', 'transfer_type', 'TEXT DEFAULT \'transfer\'');
  addColumnIfMissing('agent_transfers', 'status', 'TEXT DEFAULT \'posted\'');
  addColumnIfMissing('agent_transfers', 'created_by_id', 'TEXT');
  addColumnIfMissing('agent_transfers', 'created_by_name', 'TEXT');
  addColumnIfMissing('agent_transfers', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('invoices', 'agent_id', 'TEXT');
  addColumnIfMissing('invoices', 'agent_name', 'TEXT');
  addColumnIfMissing('invoices', 'agent_user_id', 'TEXT');
  addColumnIfMissing('stock_transfers', 'from_branch_id', 'TEXT');
  addColumnIfMissing('stock_transfers', 'to_branch_id', 'TEXT');
  addColumnIfMissing('partners', 'company_id', 'TEXT');
  addColumnIfMissing('recipes', 'company_id', 'TEXT');
  addColumnIfMissing('recipes', 'code', 'TEXT');
  addColumnIfMissing('recipes', 'output_qty', 'REAL DEFAULT 1');
  addColumnIfMissing('recipes', 'unit_name', 'TEXT');
  addColumnIfMissing('recipes', 'notes', 'TEXT');
  addColumnIfMissing('salary_transactions', 'journal_entry_id', 'INTEGER');
  addColumnIfMissing('salary_transactions', 'journal_entry_number', 'TEXT');

  // Parties table columns
  addColumnIfMissing('parties', 'account_id', 'INTEGER');
  addColumnIfMissing('parties', 'ar_account_id', 'TEXT');
  addColumnIfMissing('parties', 'ap_account_id', 'TEXT');
  addColumnIfMissing('parties', 'geo_lat', 'REAL');
  addColumnIfMissing('parties', 'geo_lng', 'REAL');
  addColumnIfMissing('parties', 'geo_label', 'TEXT');
  addColumnIfMissing('parties', 'notes', 'TEXT');
  addColumnIfMissing('parties', 'default_consignment_allowed', 'INTEGER DEFAULT 0');
  addColumnIfMissing('parties', 'default_commission_profile_id', 'TEXT');
  addColumnIfMissing('parties', 'default_consignment_warehouse_id', 'TEXT');
  addColumnIfMissing('parties', 'default_consignment_pricing_policy', 'TEXT');
  addColumnIfMissing('parties', 'default_pricing_mode', 'TEXT DEFAULT \'retail\'');
  addColumnIfMissing('parties', 'allow_last_price_override', 'INTEGER DEFAULT 1');
  addColumnIfMissing('parties', 'allow_customer_item_special_prices', 'INTEGER DEFAULT 1');
  addColumnIfMissing('parties', 'allow_manual_price_edit', 'INTEGER DEFAULT 1');
  addColumnIfMissing('parties', 'preferred_currency_for_sales', 'TEXT');

  // Items table columns
  addColumnIfMissing('items', 'wholesale_wholesale_price', 'REAL DEFAULT 0');
  addColumnIfMissing('items', 'wholesale_wholesale_price_base', 'REAL');
  addColumnIfMissing('items', 'distribution_price', 'REAL DEFAULT 0');
  addColumnIfMissing('items', 'distribution_price_base', 'REAL');
  addColumnIfMissing('items', 'delegate_price', 'REAL DEFAULT 0');
  addColumnIfMissing('items', 'delegate_price_base', 'REAL');
  addColumnIfMissing('items', 'item_type', 'TEXT DEFAULT \'STOCK\'');
  addColumnIfMissing('items', 'group_id', 'TEXT');
  addColumnIfMissing('items', 'group_name', 'TEXT');
  addColumnIfMissing('items', 'merged', 'INTEGER DEFAULT 0');
  addColumnIfMissing('items', 'inactive', 'INTEGER DEFAULT 0');
  addColumnIfMissing('items', 'merged_into_item_id', 'TEXT');
  addColumnIfMissing('items', 'price_currency', 'TEXT DEFAULT "USD"');
  addColumnIfMissing('items', 'cost_price_base', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('items', 'sale_price_base', 'REAL');
  addColumnIfMissing('items', 'wholesale_price_base', 'REAL');
  addColumnIfMissing('items', 'pos_price', 'REAL DEFAULT 0');
  addColumnIfMissing('items', 'pos_price_base', 'REAL');
  addColumnIfMissing('items', 'last_purchase_price_transaction', 'REAL');
  addColumnIfMissing('items', 'last_purchase_currency', 'TEXT');
  addColumnIfMissing('items', 'last_purchase_exchange_rate', 'REAL');
  addColumnIfMissing('items', 'last_purchase_at', 'TEXT');
  addColumnIfMissing('items', 'is_scale_item', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('items', 'scale_plu_code', 'TEXT');
  addColumnIfMissing('items', 'scale_barcode_prefix', 'TEXT');
  addColumnIfMissing('items', 'scale_barcode_mode', 'TEXT');
  addColumnIfMissing('items', 'scale_unit', 'TEXT');
  addColumnIfMissing('items', 'scale_price_per_kg', 'REAL');
  addColumnIfMissing('items', 'scale_item_code_length', 'INTEGER');
  addColumnIfMissing('items', 'scale_value_length', 'INTEGER');
  addColumnIfMissing('items', 'scale_decimals', 'INTEGER');
  addColumnIfMissing('items', 'is_textile', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('items', 'textile_base_uom', 'TEXT');
  addColumnIfMissing('items', 'supports_color_dimension', 'INTEGER NOT NULL DEFAULT 0');

  addColumnIfMissing('inventory_movements', 'textile_color_id', 'TEXT');
  addColumnIfMissing('inventory_movements', 'textile_roll_delta', 'REAL DEFAULT 0');
  addColumnIfMissing('inventory_movements', 'textile_length_delta', 'REAL DEFAULT 0');
  addColumnIfMissing('inventory_movements', 'textile_base_uom', 'TEXT');

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS textile_colors (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        code TEXT,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure textile_colors table:', e.message);
  }
  addColumnIfMissing('textile_colors', 'company_id', 'TEXT');
  addColumnIfMissing('textile_colors', 'code', 'TEXT');
  addColumnIfMissing('textile_colors', 'name', 'TEXT');
  addColumnIfMissing('textile_colors', 'normalized_name', 'TEXT');
  addColumnIfMissing('textile_colors', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('textile_colors', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('textile_colors', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS textile_stock_balances (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT,
        item_id TEXT NOT NULL,
        color_id TEXT NOT NULL,
        base_uom TEXT NOT NULL,
        roll_count REAL NOT NULL DEFAULT 0,
        total_length REAL NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure textile_stock_balances table:', e.message);
  }
  addColumnIfMissing('textile_stock_balances', 'company_id', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'branch_id', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'warehouse_id', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'warehouse_name', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'item_id', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'color_id', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'base_uom', 'TEXT');
  addColumnIfMissing('textile_stock_balances', 'roll_count', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('textile_stock_balances', 'total_length', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('textile_stock_balances', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  createIndexIfMissing(
    'textile_stock_balances_scope_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS textile_stock_balances_scope_unique ON textile_stock_balances(company_id, branch_id, warehouse_id, item_id, color_id, base_uom)'
  );

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS textile_stock_movements (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT,
        item_id TEXT NOT NULL,
        color_id TEXT NOT NULL,
        base_uom TEXT NOT NULL,
        roll_delta REAL NOT NULL DEFAULT 0,
        length_delta REAL NOT NULL DEFAULT 0,
        document_type TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_number TEXT,
        document_line_id TEXT,
        movement_type TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure textile_stock_movements table:', e.message);
  }
  addColumnIfMissing('textile_stock_movements', 'company_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'branch_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'warehouse_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'warehouse_name', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'item_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'color_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'base_uom', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'roll_delta', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('textile_stock_movements', 'length_delta', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('textile_stock_movements', 'document_type', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'document_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'document_number', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'document_line_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'movement_type', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'user_id', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'user_name', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'notes', 'TEXT');
  addColumnIfMissing('textile_stock_movements', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS warehouse_dispatch_notices (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT,
        customer_id TEXT,
        customer_name TEXT,
        source_document_type TEXT,
        source_document_id TEXT,
        dispatch_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        requested_by TEXT,
        requested_by_name TEXT,
        prepared_by TEXT,
        prepared_by_name TEXT,
        approved_by TEXT,
        approved_by_name TEXT,
        rejected_by TEXT,
        rejected_by_name TEXT,
        converted_by TEXT,
        converted_by_name TEXT,
        requested_at TEXT,
        prepared_at TEXT,
        approved_at TEXT,
        rejected_at TEXT,
        converted_at TEXT,
        rejected_reason TEXT,
        notes TEXT,
        print_meta TEXT,
        linked_invoice_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure warehouse_dispatch_notices table:', e.message);
  }
  addColumnIfMissing('warehouse_dispatch_notices', 'company_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'branch_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'warehouse_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'warehouse_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'customer_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'customer_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'source_document_type', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'source_document_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'dispatch_number', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'status', 'TEXT NOT NULL DEFAULT \'draft\'');
  addColumnIfMissing('warehouse_dispatch_notices', 'requested_by', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'requested_by_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'prepared_by', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'prepared_by_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'approved_by', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'approved_by_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'rejected_by', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'rejected_by_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'converted_by', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'converted_by_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'requested_at', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'prepared_at', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'approved_at', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'rejected_at', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'converted_at', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'rejected_reason', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'notes', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'print_meta', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'linked_invoice_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notices', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('warehouse_dispatch_notices', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS warehouse_dispatch_notice_lines (
        id TEXT PRIMARY KEY,
        notice_id TEXT NOT NULL,
        company_id TEXT,
        branch_id TEXT,
        warehouse_id TEXT,
        item_id TEXT NOT NULL,
        item_name TEXT,
        color_id TEXT NOT NULL,
        color_name TEXT,
        requested_roll_count REAL NOT NULL DEFAULT 0,
        fulfilled_roll_count REAL NOT NULL DEFAULT 0,
        fulfilled_total_length REAL NOT NULL DEFAULT 0,
        base_uom TEXT NOT NULL,
        textile_unit_price_per_length REAL,
        line_status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        source_invoice_line_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure warehouse_dispatch_notice_lines table:', e.message);
  }
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'notice_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'company_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'branch_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'warehouse_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'item_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'item_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'color_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'color_name', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'requested_roll_count', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'fulfilled_roll_count', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'fulfilled_total_length', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'base_uom', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'textile_unit_price_per_length', 'REAL');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'line_status', 'TEXT NOT NULL DEFAULT \'draft\'');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'notes', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'source_invoice_line_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('warehouse_dispatch_notice_lines', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS warehouse_dispatch_notice_line_decompositions (
        id TEXT PRIMARY KEY,
        notice_id TEXT NOT NULL,
        line_id TEXT NOT NULL,
        company_id TEXT,
        branch_id TEXT,
        sequence INTEGER NOT NULL,
        length_value REAL NOT NULL,
        unit TEXT NOT NULL,
        roll_label TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure warehouse_dispatch_notice_line_decompositions table:', e.message);
  }
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'notice_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'line_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'company_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'branch_id', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'sequence', 'INTEGER');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'length_value', 'REAL');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'unit', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'roll_label', 'TEXT');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('warehouse_dispatch_notice_line_decompositions', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  // Warehouses table columns
  addColumnIfMissing('warehouses', 'warehouse_kind', 'TEXT DEFAULT "NORMAL"');
  addColumnIfMissing('warehouses', 'owner_party_id', 'TEXT');
  addColumnIfMissing('warehouses', 'owner_party_type', 'TEXT');

  // Item serials consignment extensions
  addColumnIfMissing('item_serials', 'consignment_document_id', 'TEXT');
  addColumnIfMissing('item_serials', 'consignment_settlement_id', 'TEXT');
  addColumnIfMissing('item_serials', 'location_type', 'TEXT');
  addColumnIfMissing('consignment_document_lines', 'serial_numbers', 'TEXT');
  addColumnIfMissing('consignment_settlement_lines', 'serial_numbers', 'TEXT');

  // Create consignment tables if missing (for older DBs)
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS consignment_documents (
        id TEXT PRIMARY KEY,
        document_number TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        party_type TEXT NOT NULL,
        party_id TEXT NOT NULL,
        source_warehouse_id TEXT,
        consignment_warehouse_id TEXT NOT NULL,
        issue_date TEXT NOT NULL,
        notes TEXT,
        currency_id TEXT,
        exchange_rate REAL DEFAULT 1,
        pricing_policy TEXT,
        commission_type TEXT,
        commission_value REAL DEFAULT 0,
        total_qty REAL DEFAULT 0,
        total_amount_reference REAL,
        created_by TEXT NOT NULL,
        posted_by TEXT,
        posted_at TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        journal_entry_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    addColumnIfMissing('consignment_documents', 'journal_entry_id', 'INTEGER');
  } catch (e: any) {
    console.warn('Could not ensure consignment_documents table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS consignment_document_lines (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unit_id TEXT,
        unit_name TEXT,
        unit_factor REAL,
        qty REAL NOT NULL,
        base_qty REAL NOT NULL,
        serial_numbers TEXT,
        unit_cost REAL NOT NULL DEFAULT 0,
        reference_price REAL,
        custom_sale_price REAL,
        commission_type TEXT,
        commission_value REAL DEFAULT 0,
        notes TEXT,
        settled_sold_qty REAL DEFAULT 0,
        settled_returned_qty REAL DEFAULT 0,
        remaining_qty REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure consignment_document_lines table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS consignment_settlements (
        id TEXT PRIMARY KEY,
        settlement_number TEXT NOT NULL,
        document_id TEXT NOT NULL,
        settlement_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        notes TEXT,
        total_sold_qty REAL DEFAULT 0,
        total_returned_qty REAL DEFAULT 0,
        gross_sales_amount REAL DEFAULT 0,
        gross_purchase_amount REAL DEFAULT 0,
        total_commission REAL DEFAULT 0,
        net_amount REAL DEFAULT 0,
        created_by TEXT NOT NULL,
        posted_by TEXT,
        posted_at TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        linked_invoice_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    addColumnIfMissing('consignment_settlements', 'linked_invoice_id', 'TEXT');
  } catch (e: any) {
    console.warn('Could not ensure consignment_settlements table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS consignment_settlement_lines (
        id TEXT PRIMARY KEY,
        settlement_id TEXT NOT NULL,
        document_line_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        unit_id TEXT,
        unit_name TEXT,
        unit_factor REAL,
        qty REAL NOT NULL,
        base_qty REAL NOT NULL,
        serial_numbers TEXT,
        unit_price REAL,
        unit_cost REAL,
        commission_type TEXT,
        commission_value REAL DEFAULT 0,
        line_gross_amount REAL DEFAULT 0,
        line_commission_amount REAL DEFAULT 0,
        line_net_amount REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure consignment_settlement_lines table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS consignment_commission_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applies_to TEXT NOT NULL,
        commission_type TEXT NOT NULL,
        commission_value REAL NOT NULL,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure consignment_commission_profiles table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT,
        document_type TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_number TEXT,
        document_line_id TEXT,
        movement_type TEXT NOT NULL,
        unit_id TEXT,
        unit_name TEXT,
        qty REAL NOT NULL,
        base_qty REAL NOT NULL,
        user_id TEXT,
        user_name TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure inventory_movements table:', e.message);
  }

  // Cash boxes table columns
  addColumnIfMissing('cash_boxes', 'account_id', 'INTEGER');
  addColumnIfMissing('cash_boxes', 'currency', 'TEXT DEFAULT "USD"');

  // Journal entries
  addColumnIfMissing('journal_entries', 'reference_id', 'TEXT');
  addColumnIfMissing('journal_entries', 'reference_type', 'TEXT');
  addColumnIfMissing('journal_entries', 'currency_code', 'TEXT DEFAULT "SYP"');

  // Journal entry lines
  addColumnIfMissing('journal_entry_lines', 'party_id', 'INTEGER');
  addColumnIfMissing('journal_entry_lines', 'partner_ref_id', 'TEXT');
  addColumnIfMissing('journal_entry_lines', 'currency_code', 'TEXT');
  addColumnIfMissing('journal_entry_lines', 'exchange_rate', 'REAL DEFAULT 1');

  // Vouchers
  addColumnIfMissing('vouchers', 'amount_base', 'REAL');
  addColumnIfMissing('vouchers', 'amount_transaction', 'REAL');
  addColumnIfMissing('vouchers', 'original_amount', 'REAL');
  addColumnIfMissing('vouchers', 'exchange_rate', 'REAL DEFAULT 1');
  addColumnIfMissing('vouchers', 'status', 'TEXT DEFAULT "DRAFT"');
  // FX settlement fields on vouchers
  addColumnIfMissing('vouchers', 'settlement_exchange_rate', 'REAL');
  addColumnIfMissing('vouchers', 'fx_difference_amount', 'REAL');
  addColumnIfMissing('vouchers', 'fx_difference_type', 'TEXT');
  addColumnIfMissing('vouchers', 'fx_journal_entry_id', 'INTEGER');

  // Invoices - explicit transaction/base amount semantics
  addColumnIfMissing('invoices', 'total_amount_base', 'REAL');
  addColumnIfMissing('invoices', 'total_amount_transaction', 'REAL');
  addColumnIfMissing('invoices', 'discount_base', 'REAL');
  addColumnIfMissing('invoices', 'discount_transaction', 'REAL');
  addColumnIfMissing('invoices', 'paid_amount_base', 'REAL');
  addColumnIfMissing('invoices', 'paid_amount_transaction', 'REAL');
  addColumnIfMissing('invoices', 'remaining_amount_base', 'REAL');
  addColumnIfMissing('invoices', 'remaining_amount_transaction', 'REAL');
  addColumnIfMissing('invoices', 'source_document_type', 'TEXT');
  addColumnIfMissing('invoices', 'source_document_id', 'TEXT');
  addColumnIfMissing('invoices', 'correction_audit', 'TEXT');
  // Landed cost separation columns — added to stop AP inflation from extra purchase costs
  addColumnIfMissing('invoices', 'goods_subtotal', 'REAL');
  addColumnIfMissing('invoices', 'additional_costs_total', 'REAL DEFAULT 0');
  addColumnIfMissing('invoices', 'queue_number', 'TEXT');
  addColumnIfMissing('invoices', 'queue_scope', 'TEXT');
  addColumnIfMissing('invoices', 'queue_date', 'TEXT');
  addColumnIfMissing('invoices', 'kitchen_printed_at', 'TEXT');
  addColumnIfMissing('invoices', 'customer_printed_at', 'TEXT');

  // Party transactions - keep base and original transaction values side by side
  addColumnIfMissing('party_transactions', 'amount_base', 'REAL');
  addColumnIfMissing('party_transactions', 'delta_base', 'REAL');
  addColumnIfMissing('party_transactions', 'amount_transaction', 'REAL');
  addColumnIfMissing('party_transactions', 'delta_transaction', 'REAL');
  addColumnIfMissing('party_transactions', 'exchange_rate', 'REAL DEFAULT 1');

  // Deterministic vouchers.status backfill:
  // POSTED only when a posted journal entry exists with reference_type='voucher'
  // and reference_id == voucher.id; otherwise DRAFT.
  try {
    rawDb.prepare(`
      UPDATE vouchers
      SET status = 'POSTED'
      WHERE EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE LOWER(COALESCE(je.reference_type, '')) = 'voucher'
          AND CAST(COALESCE(je.reference_id, '') AS TEXT) = CAST(vouchers.id AS TEXT)
          AND UPPER(COALESCE(je.status, '')) = 'POSTED'
      )
    `).run();

    rawDb.prepare(`
      UPDATE vouchers
      SET status = 'DRAFT'
      WHERE NOT EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE LOWER(COALESCE(je.reference_type, '')) = 'voucher'
          AND CAST(COALESCE(je.reference_id, '') AS TEXT) = CAST(vouchers.id AS TEXT)
          AND UPPER(COALESCE(je.status, '')) = 'POSTED'
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not backfill vouchers.status:', e.message);
  }

  // Items/Inventory
  addColumnIfMissing('items', 'model', 'TEXT');
  addColumnIfMissing('items', 'dimensions', 'TEXT');
  addColumnIfMissing('items', 'color', 'TEXT');
  addColumnIfMissing('items', 'origin', 'TEXT');
  addColumnIfMissing('items', 'manufacturer', 'TEXT');
  addColumnIfMissing('items', 'gross_weight', 'TEXT');
  addColumnIfMissing('items', 'net_weight', 'TEXT');
  addColumnIfMissing('promotions', 'offer_barcode', 'TEXT');
  addColumnIfMissing('promotions', 'description', 'TEXT');
  addColumnIfMissing('promotions', 'primary_item_id', 'TEXT');
  addColumnIfMissing('promotions', 'main_image_url', 'TEXT');
  addColumnIfMissing('promotions', 'extra_image_urls', 'TEXT');
  addColumnIfMissing('promotions', 'display_order', 'INTEGER DEFAULT 0');
  addColumnIfMissing('promotions', 'display_duration_seconds', 'INTEGER DEFAULT 10');
  addColumnIfMissing('promotions', 'show_on_display', 'INTEGER DEFAULT 1');

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        user_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        affected_items TEXT NOT NULL,
        old_values TEXT,
        new_values TEXT,
        meta TEXT,
        timestamp TEXT NOT NULL
      )
    `).run();
    addColumnIfMissing('audit_logs', 'company_id', 'TEXT');
    addColumnIfMissing('audit_logs', 'branch_id', 'TEXT');
  } catch (e: any) {
    console.warn('Could not ensure audit_logs table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS system_events (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        source_module TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        requires_manual_review INTEGER NOT NULL DEFAULT 0,
        affected_document_type TEXT,
        affected_document_id TEXT,
        compensation_status TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        resolved_at TEXT,
        resolved_by TEXT,
        resolution_note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    addColumnIfMissing('system_events', 'company_id', 'TEXT');
    addColumnIfMissing('system_events', 'branch_id', 'TEXT');
    addColumnIfMissing('system_events', 'event_type', 'TEXT');
    addColumnIfMissing('system_events', 'severity', 'TEXT NOT NULL DEFAULT \'info\'');
    addColumnIfMissing('system_events', 'source_module', 'TEXT');
    addColumnIfMissing('system_events', 'action', 'TEXT');
    addColumnIfMissing('system_events', 'status', 'TEXT');
    addColumnIfMissing('system_events', 'error_code', 'TEXT');
    addColumnIfMissing('system_events', 'requires_manual_review', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('system_events', 'affected_document_type', 'TEXT');
    addColumnIfMissing('system_events', 'affected_document_id', 'TEXT');
    addColumnIfMissing('system_events', 'compensation_status', 'TEXT');
    addColumnIfMissing('system_events', 'metadata', 'TEXT NOT NULL DEFAULT \'{}\'');
    addColumnIfMissing('system_events', 'resolved_at', 'TEXT');
    addColumnIfMissing('system_events', 'resolved_by', 'TEXT');
    addColumnIfMissing('system_events', 'resolution_note', 'TEXT');
    addColumnIfMissing('system_events', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    createIndexIfMissing('idx_system_events_created_at', 'CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at)');
    createIndexIfMissing('idx_system_events_severity', 'CREATE INDEX IF NOT EXISTS idx_system_events_severity ON system_events(severity)');
    createIndexIfMissing('idx_system_events_event_type', 'CREATE INDEX IF NOT EXISTS idx_system_events_event_type ON system_events(event_type)');
    createIndexIfMissing('idx_system_events_manual_review', 'CREATE INDEX IF NOT EXISTS idx_system_events_manual_review ON system_events(requires_manual_review)');
  } catch (e: any) {
    console.warn('Could not ensure system_events table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS item_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure item_groups table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS item_group_items (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        item_id TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure item_group_items table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS item_serials (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        serial_number TEXT NOT NULL UNIQUE,
        warehouse_id TEXT,
        status TEXT NOT NULL DEFAULT 'available',
        purchase_invoice_id TEXT,
        sales_invoice_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure item_serials table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS item_barcodes (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        barcode TEXT NOT NULL UNIQUE,
        unit_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure item_barcodes table:', e.message);
  }

  // customer_item_prices: full schema (CREATE TABLE IF NOT EXISTS — no drop, no delete)
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS customer_item_prices (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unit_id TEXT,
        currency_id TEXT,
        price REAL NOT NULL,
        min_qty REAL,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure customer_item_prices table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS promotions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        offer_barcode TEXT,
        description TEXT,
        discount_type TEXT NOT NULL,
        discount_percent REAL DEFAULT 0,
        discount_value REAL DEFAULT 0,
        special_price REAL DEFAULT 0,
        buy_quantity REAL DEFAULT 0,
        get_discount_percent REAL DEFAULT 0,
        primary_item_id TEXT,
        item_ids TEXT,
        main_image_url TEXT,
        extra_image_urls TEXT,
        display_order INTEGER DEFAULT 0,
        display_duration_seconds INTEGER DEFAULT 10,
        show_on_display INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e: any) {
    console.warn('Could not ensure promotions table:', e.message);
  }

  try {
    rawDb.prepare(`
      INSERT INTO companies (id, name, code, is_active, created_at, updated_at)
      SELECT ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM companies WHERE id = ?)
    `).run(DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_CODE, DEFAULT_COMPANY_ID);

    rawDb.prepare(`
      UPDATE branches
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        code = COALESCE(NULLIF(code, ''), id),
        is_main = COALESCE(is_main, CASE WHEN id = ? THEN 1 ELSE 0 END),
        is_active = COALESCE(is_active, 1),
        updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      INSERT INTO branches (id, company_id, name, code, is_main, is_active, location, manager, phone, notes, created_at, updated_at)
      SELECT ?, ?, ?, ?, 1, 1, '', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id = ?)
    `).run(DEFAULT_BRANCH_ID, DEFAULT_COMPANY_ID, DEFAULT_BRANCH_NAME, DEFAULT_BRANCH_CODE, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE users
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        default_branch_id = COALESCE(NULLIF(default_branch_id, ''), ?),
        branch_scope = CASE
          WHEN LOWER(COALESCE(role, '')) = 'admin' AND COALESCE(NULLIF(branch_scope, ''), '') = '' THEN 'company_wide'
          ELSE COALESCE(NULLIF(branch_scope, ''), 'restricted')
        END
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE accounts
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        lookup_code = COALESCE(NULLIF(lookup_code, ''), code)
    `).run(DEFAULT_COMPANY_ID);

    rawDb.prepare(`
      UPDATE account_balances
      SET company_id = COALESCE(
        NULLIF(company_id, ''),
        (SELECT a.company_id FROM accounts a WHERE a.id = account_balances.account_id),
        ?
      )
    `).run(DEFAULT_COMPANY_ID);

    rawDb.prepare(`
      UPDATE warehouses
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(NULLIF(branch_id, ''), ?),
        code = COALESCE(NULLIF(code, ''), id),
        is_active = COALESCE(is_active, 1)
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE items
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(
          NULLIF(branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = items.warehouse_id),
          ?
        )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE item_serials
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(
          NULLIF(branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = item_serials.warehouse_id),
          (SELECT i.branch_id FROM items i WHERE i.id = item_serials.item_id),
          ?
        )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE cash_boxes
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(NULLIF(branch_id, ''), ?),
        is_active = COALESCE(is_active, 1)
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE invoices
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(
          NULLIF(branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = invoices.target_warehouse_id),
          ?
        )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE vouchers
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(
          NULLIF(branch_id, ''),
          (SELECT cb.branch_id FROM cash_boxes cb WHERE cb.id = vouchers.cash_box_id),
          (SELECT inv.branch_id FROM invoices inv WHERE inv.id = vouchers.linked_invoice_id),
          ?
        )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE delivery_notices
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(
          NULLIF(branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = delivery_notices.warehouse_id),
          ?
        )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE expenses
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(
          NULLIF(branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = expenses.warehouse_id),
          (SELECT cb.branch_id FROM cash_boxes cb WHERE cb.id = expenses.cash_box_id),
          ?
        )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      UPDATE employees
      SET
        company_id = COALESCE(NULLIF(company_id, ''), ?),
        branch_id = COALESCE(NULLIF(branch_id, ''), ?)
    `).run(DEFAULT_COMPANY_ID, DEFAULT_BRANCH_ID);

    for (const tableName of [
      'salary_transactions',
      'biometric_devices',
      'attendance_records',
      'parties',
      'party_transactions',
      'accounts',
      'journal_entries',
      'journal_entry_lines',
      'item_barcodes',
      'customer_item_prices',
      'promotions',
      'audit_logs',
      'system_events',
      'item_groups',
      'item_group_items',
      'agents',
      'agent_inventory',
      'agent_transfers',
      'agent_transfer_lines',
      'agent_inventory_movements',
      'stock_transfers',
      'party_transfers',
      'categories',
      'sub_categories',
      'units',
      'invoice_movements',
      'system_settings',
      'reconciliation_marks',
        'remote_branches',
        'partners',
        'partner_transactions',
        'recipes',
        'manufacturing_orders',
        'consignment_documents',
        'consignment_document_lines',
        'consignment_settlements',
        'consignment_settlement_lines',
        'consignment_commission_profiles',
        'inventory_movements',
        'agent_transfer_lines',
        'agent_inventory_movements'
      ]) {
      rawDb.prepare(`UPDATE ${tableName} SET company_id = COALESCE(NULLIF(company_id, ''), ?)` ).run(DEFAULT_COMPANY_ID);
    }

    for (const tableName of [
      'salary_transactions',
      'biometric_devices',
      'attendance_records',
      'party_transactions',
      'journal_entries',
      'promotions',
      'agents',
      'agent_inventory',
      'agent_transfers',
      'stock_transfers',
      'party_transfers',
      'invoice_movements',
      'partner_transactions',
      'manufacturing_orders',
      'consignment_documents',
      'consignment_document_lines',
      'consignment_settlements',
      'consignment_settlement_lines',
      'inventory_movements',
      'reconciliation_marks',
      'system_events',
      'audit_logs'
    ]) {
      rawDb.prepare(`UPDATE ${tableName} SET branch_id = COALESCE(NULLIF(branch_id, ''), ?)` ).run(DEFAULT_BRANCH_ID);
    }

    rawDb.prepare(`
      UPDATE stock_transfers
      SET
        from_branch_id = COALESCE(
          NULLIF(from_branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = stock_transfers.from_warehouse_id),
          ?
        ),
        to_branch_id = COALESCE(
          NULLIF(to_branch_id, ''),
          (SELECT w.branch_id FROM warehouses w WHERE w.id = stock_transfers.to_warehouse_id),
          ?
        ),
        branch_id = COALESCE(NULLIF(branch_id, ''), (SELECT w.branch_id FROM warehouses w WHERE w.id = stock_transfers.from_warehouse_id), ?)
    `).run(DEFAULT_BRANCH_ID, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      INSERT INTO user_branch_access (id, user_id, branch_id, is_default, is_active, created_at, updated_at)
      SELECT
        'uba-' || users.id || '-' || COALESCE(NULLIF(users.default_branch_id, ''), ?),
        users.id,
        COALESCE(NULLIF(users.default_branch_id, ''), ?),
        1,
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM users
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_branch_access uba
        WHERE uba.user_id = users.id
          AND uba.branch_id = COALESCE(NULLIF(users.default_branch_id, ''), ?)
      )
    `).run(DEFAULT_BRANCH_ID, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_ID);

    rawDb.prepare(`
      INSERT INTO user_company_access (id, user_id, company_id, is_default, is_active, created_at, updated_at)
      SELECT
        'uca-' || users.id || '-' || COALESCE(NULLIF(users.company_id, ''), ?),
        users.id,
        COALESCE(NULLIF(users.company_id, ''), ?),
        1,
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM users
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_company_access uca
        WHERE uca.user_id = users.id
          AND uca.company_id = COALESCE(NULLIF(users.company_id, ''), ?)
      )
    `).run(DEFAULT_COMPANY_ID, DEFAULT_COMPANY_ID, DEFAULT_COMPANY_ID);

    createIndexIfMissing('idx_users_company_id', 'CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)');
    createIndexIfMissing('idx_accounts_company_lookup', 'CREATE INDEX IF NOT EXISTS idx_accounts_company_lookup ON accounts(company_id, lookup_code)');
    createIndexIfMissing('idx_account_balances_company_period', 'CREATE INDEX IF NOT EXISTS idx_account_balances_company_period ON account_balances(company_id, period_key)');
    createIndexIfMissing('idx_branches_company_id', 'CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches(company_id)');
    createIndexIfMissing('idx_warehouses_company_branch', 'CREATE INDEX IF NOT EXISTS idx_warehouses_company_branch ON warehouses(company_id, branch_id)');
    createIndexIfMissing('idx_invoices_company_branch', 'CREATE INDEX IF NOT EXISTS idx_invoices_company_branch ON invoices(company_id, branch_id)');
    createIndexIfMissing('idx_vouchers_company_branch', 'CREATE INDEX IF NOT EXISTS idx_vouchers_company_branch ON vouchers(company_id, branch_id)');
    createIndexIfMissing('idx_items_company_branch', 'CREATE INDEX IF NOT EXISTS idx_items_company_branch ON items(company_id, branch_id)');
    createIndexIfMissing('idx_expenses_company_branch', 'CREATE INDEX IF NOT EXISTS idx_expenses_company_branch ON expenses(company_id, branch_id)');
    createIndexIfMissing('idx_delivery_company_branch', 'CREATE INDEX IF NOT EXISTS idx_delivery_company_branch ON delivery_notices(company_id, branch_id)');
    createIndexIfMissing('idx_system_events_company_branch', 'CREATE INDEX IF NOT EXISTS idx_system_events_company_branch ON system_events(company_id, branch_id)');
    createIndexIfMissing('idx_journal_entries_scope_status_date', 'CREATE INDEX IF NOT EXISTS idx_journal_entries_scope_status_date ON journal_entries(company_id, branch_id, status, entry_date)');
    createIndexIfMissing('idx_journal_entries_scope_ref', 'CREATE INDEX IF NOT EXISTS idx_journal_entries_scope_ref ON journal_entries(company_id, reference_type, reference_id)');
    createIndexIfMissing('idx_journal_lines_entry_account', 'CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_account ON journal_entry_lines(journal_entry_id, account_id)');
    createIndexIfMissing('idx_journal_lines_account_entry', 'CREATE INDEX IF NOT EXISTS idx_journal_lines_account_entry ON journal_entry_lines(account_id, journal_entry_id)');
    createIndexIfMissing('idx_journal_lines_partner_ref', 'CREATE INDEX IF NOT EXISTS idx_journal_lines_partner_ref ON journal_entry_lines(company_id, partner_ref_id, journal_entry_id)');
    createIndexIfMissing('idx_inventory_movements_scope_time', 'CREATE INDEX IF NOT EXISTS idx_inventory_movements_scope_time ON inventory_movements(company_id, branch_id, created_at)');
    createIndexIfMissing('idx_inventory_movements_item_time', 'CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_time ON inventory_movements(item_id, created_at)');
    createIndexIfMissing('idx_inventory_movements_doc_ref', 'CREATE INDEX IF NOT EXISTS idx_inventory_movements_doc_ref ON inventory_movements(document_type, document_id)');
    createIndexIfMissing('idx_inventory_movements_wh_item_time', 'CREATE INDEX IF NOT EXISTS idx_inventory_movements_wh_item_time ON inventory_movements(warehouse_id, item_id, created_at)');
    createIndexIfMissing('idx_party_transactions_scope_party_date', 'CREATE INDEX IF NOT EXISTS idx_party_transactions_scope_party_date ON party_transactions(company_id, branch_id, party_id, created_at)');
    createIndexIfMissing('idx_party_transactions_ref', 'CREATE INDEX IF NOT EXISTS idx_party_transactions_ref ON party_transactions(ref_id)');
    createIndexIfMissing('idx_invoices_scope_type_date', 'CREATE INDEX IF NOT EXISTS idx_invoices_scope_type_date ON invoices(company_id, branch_id, type, date)');
    createIndexIfMissing('idx_invoices_scope_party_date', 'CREATE INDEX IF NOT EXISTS idx_invoices_scope_party_date ON invoices(company_id, client_id, date)');
    createIndexIfMissing('idx_invoices_scope_payment_date', 'CREATE INDEX IF NOT EXISTS idx_invoices_scope_payment_date ON invoices(company_id, branch_id, payment_type, date)');
    createIndexIfMissing('idx_invoices_journal_link', 'CREATE INDEX IF NOT EXISTS idx_invoices_journal_link ON invoices(journal_entry_id)');
    createIndexIfMissing('idx_vouchers_scope_type_status_date', 'CREATE INDEX IF NOT EXISTS idx_vouchers_scope_type_status_date ON vouchers(company_id, branch_id, type, status, date)');
    createIndexIfMissing('idx_vouchers_scope_party_date', 'CREATE INDEX IF NOT EXISTS idx_vouchers_scope_party_date ON vouchers(company_id, client_id, date)');
    createIndexIfMissing('idx_vouchers_cashbox_date', 'CREATE INDEX IF NOT EXISTS idx_vouchers_cashbox_date ON vouchers(cash_box_id, date)');
    createIndexIfMissing('idx_vouchers_journal_link', 'CREATE INDEX IF NOT EXISTS idx_vouchers_journal_link ON vouchers(journal_entry_id)');
    createIndexIfMissing('idx_system_events_scope_severity_time', 'CREATE INDEX IF NOT EXISTS idx_system_events_scope_severity_time ON system_events(company_id, branch_id, severity, created_at)');
    createIndexIfMissing('idx_system_events_scope_type_time', 'CREATE INDEX IF NOT EXISTS idx_system_events_scope_type_time ON system_events(company_id, branch_id, event_type, created_at)');
    createIndexIfMissing('idx_system_events_manual_unresolved', 'CREATE INDEX IF NOT EXISTS idx_system_events_manual_unresolved ON system_events(requires_manual_review, resolved_at, created_at)');
    createIndexIfMissing('idx_audit_logs_scope_time', 'CREATE INDEX IF NOT EXISTS idx_audit_logs_scope_time ON audit_logs(company_id, branch_id, timestamp)');
    createIndexIfMissing('idx_audit_logs_operation_time', 'CREATE INDEX IF NOT EXISTS idx_audit_logs_operation_time ON audit_logs(operation_type, timestamp)');
    createIndexIfMissing('idx_audit_logs_user_time', 'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs(user_id, timestamp)');
  } catch (e: any) {
    console.warn('Could not backfill tenant scope columns:', e.message);
  }

  // Backfill canonical amount columns for existing rows (idempotent)
  try {
    rawDb.prepare(`
      UPDATE invoices
      SET
        total_amount_base = COALESCE(
          total_amount_base,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(total_amount, 0)
            WHEN COALESCE(original_amount, 0) > 0 AND COALESCE(total_amount, 0) < COALESCE(original_amount, 0) THEN COALESCE(total_amount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 THEN
              COALESCE(CASE WHEN COALESCE(original_amount, 0) > 0 THEN original_amount ELSE total_amount END, 0) / exchange_rate
            ELSE COALESCE(total_amount, 0)
          END
        ),
        total_amount_transaction = COALESCE(
          total_amount_transaction,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(original_amount, total_amount, 0)
            WHEN COALESCE(original_amount, 0) > 0 THEN original_amount
            WHEN COALESCE(exchange_rate, 0) > 0 THEN COALESCE(total_amount, 0) * exchange_rate
            ELSE COALESCE(total_amount, 0)
          END
        ),
        paid_amount_base = COALESCE(
          paid_amount_base,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(paid_amount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 AND COALESCE(total_amount_base, total_amount, 0) > 0 AND COALESCE(paid_amount, 0) > COALESCE(total_amount_base, total_amount, 0)
              THEN COALESCE(paid_amount, 0) / exchange_rate
            ELSE COALESCE(paid_amount, 0)
          END
        ),
        remaining_amount_base = COALESCE(
          remaining_amount_base,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(remaining_amount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 AND COALESCE(total_amount_base, total_amount, 0) > 0 AND COALESCE(remaining_amount, 0) > COALESCE(total_amount_base, total_amount, 0)
              THEN COALESCE(remaining_amount, 0) / exchange_rate
            ELSE COALESCE(remaining_amount, 0)
          END
        ),
        discount_base = COALESCE(
          discount_base,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(discount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 THEN COALESCE(discount, 0) / exchange_rate
            ELSE COALESCE(discount, 0)
          END
        )
    `).run();

    rawDb.prepare(`
      UPDATE invoices
      SET
        paid_amount_transaction = COALESCE(
          paid_amount_transaction,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(paid_amount_base, paid_amount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 THEN COALESCE(paid_amount_base, paid_amount, 0) * exchange_rate
            ELSE COALESCE(paid_amount, 0)
          END
        ),
        remaining_amount_transaction = COALESCE(
          remaining_amount_transaction,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(remaining_amount_base, remaining_amount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 THEN COALESCE(remaining_amount_base, remaining_amount, 0) * exchange_rate
            ELSE COALESCE(remaining_amount, 0)
          END
        ),
        discount_transaction = COALESCE(
          discount_transaction,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(discount_base, discount, 0)
            WHEN COALESCE(exchange_rate, 0) > 0 THEN COALESCE(discount_base, discount, 0) * exchange_rate
            ELSE COALESCE(discount, 0)
          END
        )
    `).run();

    rawDb.prepare(`
      UPDATE items
      SET
        cost_price_base = COALESCE(cost_price_base, cost_price, 0),
        sale_price_base = COALESCE(sale_price_base, sale_price, 0),
        wholesale_price_base = COALESCE(wholesale_price_base, wholesale_price, 0)
    `).run();

    rawDb.prepare(`
      UPDATE vouchers
      SET
        amount_base = COALESCE(amount_base, amount, 0),
        amount_transaction = COALESCE(
          amount_transaction,
          CASE
            WHEN UPPER(COALESCE(currency, 'USD')) = 'USD' THEN COALESCE(original_amount, amount, 0)
            WHEN COALESCE(original_amount, 0) > 0 THEN original_amount
            WHEN COALESCE(exchange_rate, 0) > 0 THEN COALESCE(amount, 0) * exchange_rate
            ELSE COALESCE(amount, 0)
          END
        )
    `).run();

    rawDb.prepare(`
      UPDATE party_transactions
      SET
        amount_base = COALESCE(amount_base, amount, 0),
        delta_base = COALESCE(delta_base, delta, 0),
        amount_transaction = COALESCE(amount_transaction, amount, 0),
        delta_transaction = COALESCE(delta_transaction, delta, 0),
        exchange_rate = COALESCE(exchange_rate, 1)
    `).run();
  } catch (e: any) {
    console.warn('Could not backfill multi-currency canonical columns:', e.message);
  }

  // Print templates
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS print_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        template_type TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'A4',
        name TEXT NOT NULL,
        template_json TEXT,
        template_html TEXT,
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        show_logo INTEGER DEFAULT 1,
        show_company_name INTEGER DEFAULT 1,
        show_address INTEGER DEFAULT 1,
        show_phone INTEGER DEFAULT 1,
        show_tax_number INTEGER DEFAULT 0,
        show_qr_code INTEGER DEFAULT 0,
        show_discount INTEGER DEFAULT 1,
        show_tax_breakdown INTEGER DEFAULT 0,
        show_footer INTEGER DEFAULT 1,
        show_signature_line INTEGER DEFAULT 0,
        header_title TEXT,
        header_subtitle TEXT,
        footer_text TEXT,
        font_size TEXT DEFAULT 'md',
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_print_templates_company', 'CREATE INDEX IF NOT EXISTS idx_print_templates_company ON print_templates(company_id, template_type, is_default)');
  } catch (e: any) {
    console.warn('Could not ensure print_templates table:', e.message);
  }

  // Printers
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS printers (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'standard',
        connection_type TEXT NOT NULL DEFAULT 'windows',
        address TEXT,
        paper_size TEXT NOT NULL DEFAULT 'A4',
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        codepage TEXT DEFAULT 'UTF8',
        document_types TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_printers_company', 'CREATE INDEX IF NOT EXISTS idx_printers_company ON printers(company_id, is_default)');
  } catch (e: any) {
    console.warn('Could not ensure printers table:', e.message);
  }

  try {
    createIndexIfMissing('idx_print_jobs_company_branch', 'CREATE INDEX IF NOT EXISTS idx_print_jobs_company_branch ON print_jobs(company_id, branch_id, invoice_id, created_at)');
    createIndexIfMissing('idx_queue_counters_scope_key', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_counters_scope_key ON queue_counters(scope_key)');
  } catch (e: any) {
    console.warn('Could not ensure print job indexes:', e.message);
  }

  // Reconciliation sessions & items
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS reconciliation_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        type TEXT NOT NULL,
        party_id TEXT,
        party_name TEXT,
        from_date TEXT,
        to_date TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        total_debit_matched REAL DEFAULT 0,
        total_credit_matched REAL DEFAULT 0,
        difference_amount REAL DEFAULT 0,
        write_off_journal_entry_id INTEGER,
        tolerance_amount REAL DEFAULT 0,
        confirmed_by TEXT,
        confirmed_at TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_recon_sessions_party', 'CREATE INDEX IF NOT EXISTS idx_recon_sessions_party ON reconciliation_sessions(company_id, party_id, status)');
  } catch (e: any) {
    console.warn('Could not ensure reconciliation_sessions table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS reconciliation_items (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        session_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        side TEXT NOT NULL,
        ref_id TEXT,
        ref_number TEXT,
        ref_date TEXT,
        party_id TEXT,
        party_name TEXT,
        currency TEXT DEFAULT 'USD',
        amount_foreign REAL DEFAULT 0,
        amount_base REAL NOT NULL,
        allocated_base REAL DEFAULT 0,
        remaining_base REAL DEFAULT 0,
        match_group_id TEXT,
        match_status TEXT NOT NULL DEFAULT 'unmatched',
        match_method TEXT,
        match_difference REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_recon_items_session', 'CREATE INDEX IF NOT EXISTS idx_recon_items_session ON reconciliation_items(session_id)');
    createIndexIfMissing('idx_recon_items_match', 'CREATE INDEX IF NOT EXISTS idx_recon_items_match ON reconciliation_items(match_group_id)');
    createIndexIfMissing('idx_recon_items_ref', 'CREATE INDEX IF NOT EXISTS idx_recon_items_ref ON reconciliation_items(ref_id, company_id)');
  } catch (e: any) {
    console.warn('Could not ensure reconciliation_items table:', e.message);
  }

  // FX Revaluation runs
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        valuation_date TEXT NOT NULL,
        reversal_date TEXT NOT NULL,
        rate_syp REAL NOT NULL,
        rate_try REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        total_unrealized_gain REAL DEFAULT 0,
        total_unrealized_loss REAL DEFAULT 0,
        net_unrealized REAL DEFAULT 0,
        items_evaluated INTEGER DEFAULT 0,
        revaluation_journal_entry_id INTEGER,
        reversal_journal_entry_id INTEGER,
        executed_by TEXT,
        executed_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_fx_reval_runs_company', 'CREATE INDEX IF NOT EXISTS idx_fx_reval_runs_company ON fx_revaluation_runs(company_id, valuation_date)');
  } catch (e: any) {
    console.warn('Could not ensure fx_revaluation_runs table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS fx_revaluation_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        run_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        party_id TEXT,
        party_name TEXT,
        invoice_id TEXT,
        invoice_number TEXT,
        currency TEXT NOT NULL,
        outstanding_foreign REAL NOT NULL,
        original_rate REAL NOT NULL,
        book_value_base REAL NOT NULL,
        revaluation_rate REAL NOT NULL,
        revalued_base REAL NOT NULL,
        unrealized_diff REAL NOT NULL,
        diff_type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_fx_reval_lines_run', 'CREATE INDEX IF NOT EXISTS idx_fx_reval_lines_run ON fx_revaluation_lines(run_id)');
  } catch (e: any) {
    console.warn('Could not ensure fx_revaluation_lines table:', e.message);
  }

  // Fiscal Periods (period closing)
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS fiscal_periods (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        closing_journal_entry_id INTEGER,
        net_pnl REAL,
        total_revenue REAL,
        total_expenses REAL,
        closed_by TEXT,
        closed_at TEXT,
        reopened_by TEXT,
        reopened_at TEXT,
        reopen_reason TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing('idx_fiscal_periods_company', 'CREATE INDEX IF NOT EXISTS idx_fiscal_periods_company ON fiscal_periods(company_id)');
    createIndexIfMissing('idx_fiscal_periods_status', 'CREATE INDEX IF NOT EXISTS idx_fiscal_periods_status ON fiscal_periods(company_id, status)');
  } catch (e: any) {
    console.warn('Could not ensure fiscal_periods table:', e.message);
  }

  // --- RESTAURANT: operational tables ---
  // These tables are required for the restaurant module endpoints to work.
  // On fresh DBs (after user deletes the sqlite file) migrations may not run,
  // so we make the restaurant schema self-healing like other critical tables.
  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        zone_name TEXT,
        capacity INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        public_qr_token TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing(
      'idx_restaurant_tables_company_branch',
      'CREATE INDEX IF NOT EXISTS idx_restaurant_tables_company_branch ON restaurant_tables(company_id, branch_id)',
    );
  } catch (e: any) {
    console.warn('Could not ensure restaurant_tables table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        opened_by_user_id TEXT NOT NULL,
        closed_by_user_id TEXT,
        session_status TEXT NOT NULL DEFAULT 'open',
        guest_count INTEGER,
        opened_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        closed_at TEXT,
        preliminary_total REAL NOT NULL DEFAULT 0,
        notes TEXT,
        source TEXT NOT NULL DEFAULT 'cashier',
        unread_request_count INTEGER NOT NULL DEFAULT 0,
        final_invoice_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (table_id) REFERENCES restaurant_tables(id)
      )
    `).run();
    createIndexIfMissing(
      'idx_restaurant_table_sessions_company_branch_status',
      'CREATE INDEX IF NOT EXISTS idx_restaurant_table_sessions_company_branch_status ON restaurant_table_sessions(company_id, branch_id, session_status)',
    );
  } catch (e: any) {
    console.warn('Could not ensure restaurant_table_sessions table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS restaurant_menu_items (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        is_visible_in_qr INTEGER NOT NULL DEFAULT 1,
        display_name_override TEXT,
        description TEXT,
        image_url TEXT,
        category_name TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_available_now INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    createIndexIfMissing(
      'idx_restaurant_menu_items_company_branch',
      'CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_company_branch ON restaurant_menu_items(company_id, branch_id)',
    );
  } catch (e: any) {
    console.warn('Could not ensure restaurant_menu_items table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS restaurant_table_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        public_qr_token_snapshot TEXT,
        request_status TEXT NOT NULL DEFAULT 'new',
        request_source TEXT NOT NULL DEFAULT 'qr',
        customer_session_token TEXT,
        submitted_at TEXT NOT NULL,
        seen_at TEXT,
        accepted_at TEXT,
        rejected_at TEXT,
        archived_at TEXT,
        notes TEXT,
        client_request_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (table_id) REFERENCES restaurant_tables(id),
        FOREIGN KEY (session_id) REFERENCES restaurant_table_sessions(id)
      )
    `).run();
    createIndexIfMissing(
      'idx_restaurant_table_requests_company_branch_session',
      'CREATE INDEX IF NOT EXISTS idx_restaurant_table_requests_company_branch_session ON restaurant_table_requests(company_id, branch_id, session_id)',
    );
  } catch (e: any) {
    console.warn('Could not ensure restaurant_table_requests table:', e.message);
  }

  try {
    rawDb.prepare(`
      CREATE TABLE IF NOT EXISTS restaurant_table_request_items (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_name_snapshot TEXT NOT NULL,
        item_code_snapshot TEXT,
        unit_name_snapshot TEXT,
        quantity REAL NOT NULL,
        base_unit_price REAL NOT NULL,
        line_subtotal REAL NOT NULL,
        customer_note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES restaurant_table_requests(id)
      )
    `).run();
    createIndexIfMissing(
      'idx_restaurant_table_request_items_request',
      'CREATE INDEX IF NOT EXISTS idx_restaurant_table_request_items_request ON restaurant_table_request_items(request_id)',
    );
  } catch (e: any) {
    console.warn('Could not ensure restaurant_table_request_items table:', e.message);
  }

  if (fixes.length > 0) {
    console.log('📦 Database schema fixes applied:', fixes.join(', '));
  }

  return { fixes };
};

/**
 * Fix existing parties that have opening balances but missing journal entries.
 * This creates journal entries for parties that have party_transactions 
 * with kind='opening_balance' but no corresponding journal entry.
 */
export const fixPartyOpeningBalanceJournalEntries = async (_db: any) => {
  const rawDb = rawSqlite; // Use the real better-sqlite3 instance
  const fixed: string[] = [];

  try {
    // Get opening balance settings code
    const OPENING_OFFSET_CODE = '3210';
    const RETAINED_CODE = '3200';

    // Get offset account ID
    let offsetAccountId: number | null = null;
    const offsetAccount = rawDb.prepare(`SELECT id FROM accounts WHERE code = ?`).get(OPENING_OFFSET_CODE) as { id: number } | undefined;
    if (offsetAccount?.id) {
      offsetAccountId = offsetAccount.id;
    } else {
      const retainedAccount = rawDb.prepare(`SELECT id FROM accounts WHERE code = ?`).get(RETAINED_CODE) as { id: number } | undefined;
      offsetAccountId = retainedAccount?.id || null;
    }

    if (!offsetAccountId) {
      console.warn('Cannot fix opening balances: no offset account found');
      return { fixed: [] };
    }

    // Find parties with opening balance transactions but no journal entries
    const partiesWithOpeningBalance = rawDb.prepare(`
      SELECT DISTINCT 
        p.id, 
        p.name, 
        p.type, 
        p.account_id,
        pt.amount,
        pt.delta,
        pt.currency
      FROM parties p
      JOIN party_transactions pt ON pt.party_id = p.id AND pt.kind = 'opening_balance'
      WHERE p.account_id IS NOT NULL
    `).all() as Array<{ id: number; name: string; type: string; account_id: number | null; amount: number; delta: number; currency: string }>;

    for (const party of partiesWithOpeningBalance) {
      if (!party.account_id) continue;

      // Check if journal entry already exists for this party's opening balance
      // Use account_id + reference_type to be name-change proof
      const existingJournal = rawDb.prepare(`
        SELECT je.id 
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        WHERE je.reference_type = 'opening' AND jel.account_id = ?
        LIMIT 1
      `).get(party.account_id);

      if (existingJournal) continue; // Already has journal entry

      const amount = Math.abs(Number(party.amount) || 0);
      if (amount <= 0) continue;

      // Determine debit/credit based on party type and delta
      const isPositiveDelta = Number(party.delta) > 0;
      const isCustomer = party.type === 'CUSTOMER' || party.type === 'BOTH';
      
      // For customers: positive delta = they owe us = debit their account
      // For suppliers: positive delta = we owe them = credit their account
      const isDebit = isCustomer ? isPositiveDelta : !isPositiveDelta;

      try {
        const entryNumber = `JE-fix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date().toISOString();

        // Create journal entry
        rawDb.prepare(`
          INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, total_debit, total_credit, status, currency_code, exchange_rate, created_at)
          VALUES (?, ?, ?, 'opening', ?, ?, 'posted', ?, 1, ?)
        `).run(entryNumber, now, `رصيد افتتاحي — ${party.name}`, amount, amount, party.currency || 'USD', now);

        const journalEntryId = (rawDb.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

        // Insert lines - party account
        rawDb.prepare(`
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, currency_code, exchange_rate, amount_in_currency)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(journalEntryId, party.account_id, isDebit ? amount : 0, isDebit ? 0 : amount, 'رصيد افتتاحي', party.currency || 'USD', amount);

        // Insert lines - offset account (opposite)
        rawDb.prepare(`
          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, currency_code, exchange_rate, amount_in_currency)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(journalEntryId, offsetAccountId, isDebit ? 0 : amount, isDebit ? amount : 0, 'موازنة تلقائية - رصيد افتتاحي', party.currency || 'USD', amount);

        fixed.push(`${party.name} (${amount} ${party.currency})`);
      } catch (e: any) {
        console.error(`Failed to create journal entry for party ${party.name}:`, e.message);
      }
    }

    if (fixed.length > 0) {
      console.log('📋 Fixed opening balance journal entries for:', fixed.join(', '));
    }
  } catch (e: any) {
    console.error('Error fixing party opening balance journal entries:', e.message);
  }

  return { fixed };
};

/**
 * Backfill invoice clientName from clientId where clientName is null/empty
 */
export const backfillInvoiceClientNames = async (_db: any) => {
  try {
    const rawDb = rawSqlite; // Use the real better-sqlite3 instance
    
    // Find invoices with clientId but missing clientName
    const invoicesNeedingFix = rawDb.prepare(`
      SELECT i.id, i.client_id, p.name as party_name
      FROM invoices i
      LEFT JOIN parties p ON i.client_id = p.id
      WHERE (i.client_name IS NULL OR i.client_name = '')
        AND i.client_id IS NOT NULL
        AND p.name IS NOT NULL
    `).all() as Array<{ id: number; client_id: number; party_name: string }>;
    
    if (invoicesNeedingFix.length === 0) {
      return { fixed: [] };
    }
    
    const fixed: string[] = [];
    for (const inv of invoicesNeedingFix) {
      try {
        rawDb.prepare(`UPDATE invoices SET client_name = ? WHERE id = ?`).run(inv.party_name, inv.id);
        fixed.push(String(inv.id));
      } catch (e: any) {
        console.error(`Failed to update clientName for invoice ${inv.id}:`, e.message);
      }
    }
    
    if (fixed.length > 0) {
      console.log('📋 Backfilled clientName for invoices:', fixed.length);
    }
    
    return { fixed };
  } catch (e: any) {
    console.warn('backfillInvoiceClientNames warning:', e.message);
    return { fixed: [] };
  }
};

const chooseAutoSaleMargin = (costBase: number) => {
  const cost = Number(costBase || 0);
  if (!Number.isFinite(cost) || cost <= 0) return 0.12;
  if (cost <= 2) return 0.18;
  if (cost <= 5) return 0.16;
  if (cost <= 10) return 0.14;
  if (cost <= 25) return 0.12;
  return 0.10;
};

const roundBackfillMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const buildAutoPriceMatrix = (costBase: number) => {
  const baseCost = Number(costBase || 0);
  const retailMargin = chooseAutoSaleMargin(baseCost);
  const wholesaleMargin = Math.max(0.08, retailMargin - 0.03);
  const bulkMargin = Math.max(0.06, retailMargin - 0.05);
  const salePrice = roundBackfillMoney(baseCost * (1 + retailMargin));
  const wholesalePrice = roundBackfillMoney(baseCost * (1 + wholesaleMargin));
  const bulkPrice = roundBackfillMoney(baseCost * (1 + bulkMargin));

  return {
    salePrice,
    salePriceBase: salePrice,
    posPrice: salePrice,
    posPriceBase: salePrice,
    wholesalePrice,
    wholesalePriceBase: wholesalePrice,
    wholesaleWholesalePrice: bulkPrice,
    wholesaleWholesalePriceBase: bulkPrice,
    distributionPrice: bulkPrice,
    distributionPriceBase: bulkPrice,
    delegatePrice: wholesalePrice,
    delegatePriceBase: wholesalePrice,
  };
};

export const backfillPurchaseDerivedItemPricing = async (_db: any) => {
  const rawDb = rawSqlite;
  const fixedItems: string[] = [];
  const createdUnits: string[] = [];

  try {
    const invoiceRows = rawDb.prepare(`
      SELECT id, company_id AS companyId, branch_id AS branchId, items
      FROM invoices
      WHERE type IN ('purchase', 'opening_stock')
        AND items IS NOT NULL
        AND trim(items) <> ''
      ORDER BY created_at ASC, rowid ASC
    `).all() as Array<{ id: string; companyId: string | null; branchId: string | null; items: string }>;

    const findUnitByName = rawDb.prepare(`
      SELECT id, name
      FROM units
      WHERE lower(trim(name)) = lower(trim(?))
        AND (
          (company_id = ?)
          OR (? IS NULL AND company_id IS NULL)
        )
      LIMIT 1
    `);
    const insertUnit = rawDb.prepare(`
      INSERT INTO units (id, company_id, name, is_base, base_unit_id, factor, multiplier)
      VALUES (?, ?, ?, 1, NULL, 1, 1)
    `);
    const findItem = rawDb.prepare(`
      SELECT *
      FROM items
      WHERE id = ?
      LIMIT 1
    `);
    const findItemsByName = rawDb.prepare(`
      SELECT *
      FROM items
      WHERE lower(trim(name)) = lower(trim(?))
        AND (
          (company_id = ?)
          OR (? IS NULL AND company_id IS NULL)
        )
      ORDER BY last_updated DESC, rowid DESC
    `);
    const updateItem = rawDb.prepare(`
      UPDATE items
      SET
        unit_id = coalesce(?, unit_id),
        unit_name = coalesce(?, unit_name),
        sale_price = ?,
        sale_price_base = ?,
        pos_price = ?,
        pos_price_base = ?,
        wholesale_price = ?,
        wholesale_price_base = ?,
        wholesale_wholesale_price = ?,
        wholesale_wholesale_price_base = ?,
        distribution_price = ?,
        distribution_price_base = ?,
        delegate_price = ?,
        delegate_price_base = ?,
        last_updated = ?
      WHERE id = ?
    `);

    for (const invoice of invoiceRows) {
      let parsedItems: any[] = [];
      try {
        parsedItems = JSON.parse(invoice.items || '[]');
      } catch {
        continue;
      }

      for (const line of parsedItems) {
        const itemId = String(line?.itemId || '').trim();
        const itemName = String(line?.itemName || '').trim();
        let resolvedItemId = itemId;
        let itemRow = (!itemId || itemId.startsWith('NEW-')
          ? undefined
          : findItem.get(itemId)) as Record<string, any> | undefined;
        if (!itemRow && itemName) {
          const nameMatches = findItemsByName.all(
            itemName,
            invoice.companyId || null,
            invoice.companyId || null,
          ) as Array<Record<string, any>>;
          if (nameMatches.length === 1) {
            itemRow = nameMatches[0];
            resolvedItemId = String(nameMatches[0]?.id || '').trim();
          } else if (nameMatches.length > 1) {
            continue;
          }
        }
        if (!itemRow) continue;

        const unitName = String(line?.unitName || itemRow.unit_name || '').trim();
        let resolvedUnitId = String(itemRow.unit_id || '').trim() || null;
        if (!resolvedUnitId && unitName) {
          const unitRow = findUnitByName.get(unitName, invoice.companyId || null, invoice.companyId || null) as { id: string; name: string } | undefined;
          if (unitRow?.id) {
            resolvedUnitId = String(unitRow.id);
          } else {
            resolvedUnitId = `unit-bf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            insertUnit.run(resolvedUnitId, invoice.companyId || null, unitName);
            createdUnits.push(unitName);
          }
        }

        const existingSalePrice = Number(itemRow.sale_price || 0);
        const existingPosPrice = Number(itemRow.pos_price || 0);
        const existingWholesalePrice = Number(itemRow.wholesale_price || 0);
        const existingWholesaleWholesalePrice = Number(itemRow.wholesale_wholesale_price || 0);
        const existingDistributionPrice = Number(itemRow.distribution_price || 0);
        const existingDelegatePrice = Number(itemRow.delegate_price || 0);

        const needsUnitBackfill = !String(itemRow.unit_id || '').trim() && !!resolvedUnitId;
        const needsPriceBackfill =
          existingSalePrice <= 0 ||
          existingPosPrice <= 0 ||
          existingWholesalePrice <= 0 ||
          existingWholesaleWholesalePrice <= 0 ||
          existingDistributionPrice <= 0 ||
          existingDelegatePrice <= 0;

        if (!needsUnitBackfill && !needsPriceBackfill) continue;

        const baseCost = Number(itemRow.cost_price_base || itemRow.cost_price || line?.unitPriceBase || line?.unitPrice || 0);
        if (!Number.isFinite(baseCost) || baseCost <= 0) continue;
        const autoPrices = buildAutoPriceMatrix(baseCost);
        const nowIso = new Date().toISOString();

        updateItem.run(
          resolvedUnitId,
          unitName || null,
          existingSalePrice > 0 ? existingSalePrice : autoPrices.salePrice,
          Number(itemRow.sale_price_base || 0) > 0 ? Number(itemRow.sale_price_base) : autoPrices.salePriceBase,
          existingPosPrice > 0 ? existingPosPrice : autoPrices.posPrice,
          Number(itemRow.pos_price_base || 0) > 0 ? Number(itemRow.pos_price_base) : autoPrices.posPriceBase,
          existingWholesalePrice > 0 ? existingWholesalePrice : autoPrices.wholesalePrice,
          Number(itemRow.wholesale_price_base || 0) > 0 ? Number(itemRow.wholesale_price_base) : autoPrices.wholesalePriceBase,
          existingWholesaleWholesalePrice > 0 ? existingWholesaleWholesalePrice : autoPrices.wholesaleWholesalePrice,
          Number(itemRow.wholesale_wholesale_price_base || 0) > 0 ? Number(itemRow.wholesale_wholesale_price_base) : autoPrices.wholesaleWholesalePriceBase,
          existingDistributionPrice > 0 ? existingDistributionPrice : autoPrices.distributionPrice,
          Number(itemRow.distribution_price_base || 0) > 0 ? Number(itemRow.distribution_price_base) : autoPrices.distributionPriceBase,
          existingDelegatePrice > 0 ? existingDelegatePrice : autoPrices.delegatePrice,
          Number(itemRow.delegate_price_base || 0) > 0 ? Number(itemRow.delegate_price_base) : autoPrices.delegatePriceBase,
          nowIso,
          resolvedItemId,
        );
        fixedItems.push(resolvedItemId);
      }
    }
  } catch (e: any) {
    console.warn('backfillPurchaseDerivedItemPricing warning:', e.message);
  }

  return {
    fixedItems: Array.from(new Set(fixedItems)),
    createdUnits: Array.from(new Set(createdUnits)),
  };
};

export const backfillJournalLinePartnerRefs = async (_db: any) => {
  const dbAny = _db as any;
  const fixedJournalEntries = new Set<number>();
  const fixedLineIds = new Set<number>();
  const skipped: string[] = [];

  try {
    const invoiceRows = await dbAny.select({
      id: schema.invoices.id,
      journalEntryId: schema.invoices.journalEntryId,
      clientId: schema.invoices.clientId,
      companyId: schema.invoices.companyId,
    }).from(schema.invoices).all();

    for (const row of invoiceRows || []) {
      const entryId = Number((row as any).journalEntryId || 0);
      const partnerRefId = String((row as any).clientId || '').trim();
      const companyId = String((row as any).companyId || '').trim() || null;
      if (!(entryId > 0) || !partnerRefId) continue;
      const lines = await dbAny.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.journalEntryId, entryId)).all();
      const pending = (lines || []).filter((line: any) => !String(line.partnerRefId || '').trim());
      if (pending.length === 0) continue;
      await dbAny.update(schema.journalEntryLines)
        .set({ partnerRefId })
        .where(eq(schema.journalEntryLines.journalEntryId, entryId))
        .run();
      fixedJournalEntries.add(entryId);
      if (companyId) {
        await dbAny.update(schema.journalEntryLines)
          .set({ companyId })
          .where(eq(schema.journalEntryLines.journalEntryId, entryId))
          .run();
      }
    }

    const voucherRows = await dbAny.select({
      id: schema.vouchers.id,
      journalEntryId: schema.vouchers.journalEntryId,
      fxJournalEntryId: schema.vouchers.fxJournalEntryId,
      clientId: schema.vouchers.clientId,
      companyId: schema.vouchers.companyId,
    }).from(schema.vouchers).all();

    for (const row of voucherRows || []) {
      const partnerRefId = String((row as any).clientId || '').trim();
      const companyId = String((row as any).companyId || '').trim() || null;
      if (!partnerRefId) continue;
      for (const candidate of [Number((row as any).journalEntryId || 0), Number((row as any).fxJournalEntryId || 0)]) {
        if (!(candidate > 0)) continue;
        const lines = await dbAny.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.journalEntryId, candidate)).all();
        const pending = (lines || []).filter((line: any) => !String(line.partnerRefId || '').trim());
        if (pending.length === 0) continue;
        await dbAny.update(schema.journalEntryLines)
          .set({ partnerRefId })
          .where(eq(schema.journalEntryLines.journalEntryId, candidate))
          .run();
        fixedJournalEntries.add(candidate);
        if (companyId) {
          await dbAny.update(schema.journalEntryLines)
            .set({ companyId })
            .where(eq(schema.journalEntryLines.journalEntryId, candidate))
            .run();
        }
      }
    }

    const parties = await dbAny.select({
      id: schema.parties.id,
      companyId: schema.parties.companyId,
      accountId: schema.parties.accountId,
      arAccountId: schema.parties.arAccountId,
      apAccountId: schema.parties.apAccountId,
    }).from(schema.parties).all();

    const accountOwners = new Map<string, Set<string>>();
    for (const party of parties || []) {
      const companyId = String((party as any).companyId || '').trim();
      const partyId = String((party as any).id || '').trim();
      if (!companyId || !partyId) continue;
      for (const rawAccountId of [(party as any).accountId, (party as any).arAccountId, (party as any).apAccountId]) {
        const accountId = Number(rawAccountId || 0);
        if (!(accountId > 0)) continue;
        const key = `${companyId}::${accountId}`;
        const owners = accountOwners.get(key) || new Set<string>();
        owners.add(partyId);
        accountOwners.set(key, owners);
      }
    }

    const uniqueOwnerKeys = Array.from(accountOwners.entries())
      .filter(([, owners]) => owners.size === 1)
      .map(([key]) => key);

    if (uniqueOwnerKeys.length > 0) {
      const candidateLines = await dbAny.select({
        id: schema.journalEntryLines.id,
        journalEntryId: schema.journalEntryLines.journalEntryId,
        companyId: schema.journalEntryLines.companyId,
        accountId: schema.journalEntryLines.accountId,
        partnerRefId: schema.journalEntryLines.partnerRefId,
      }).from(schema.journalEntryLines).all();

      for (const line of candidateLines || []) {
        if (String((line as any).partnerRefId || '').trim()) continue;
        const companyId = String((line as any).companyId || '').trim();
        const accountId = Number((line as any).accountId || 0);
        if (!companyId || !(accountId > 0)) continue;
        const ownerKey = `${companyId}::${accountId}`;
        const owners = accountOwners.get(ownerKey);
        if (!owners || owners.size !== 1) continue;
        const partnerRefId = Array.from(owners)[0];
        await dbAny.update(schema.journalEntryLines)
          .set({ partnerRefId })
          .where(eq(schema.journalEntryLines.id, Number((line as any).id || 0)))
          .run();
        fixedLineIds.add(Number((line as any).id || 0));
        if (Number((line as any).journalEntryId || 0) > 0) {
          fixedJournalEntries.add(Number((line as any).journalEntryId || 0));
        }
      }
    }
  } catch (error: any) {
    skipped.push(String(error?.message || error || 'Unknown partner_ref backfill failure'));
  }

  return {
    fixedJournalEntryIds: Array.from(fixedJournalEntries.values()),
    fixedLineIds: Array.from(fixedLineIds.values()),
    skipped,
  };
};

// --- Activation Codes Seeding ---
// 100 أكواد محلي مستقل (standalone)
const LOCAL_CODES = [
  'ALM-7K3M-Q9X2', 'ALM-4P8N-W1Y6', 'ALM-2R5T-H3Z9', 'ALM-9L6J-D4V7', 'ALM-1F8G-B5C3',
  'ALM-6W2X-N7M4', 'ALM-3Y9Z-K8P1', 'ALM-5H4J-T6R2', 'ALM-8D1F-V9L5', 'ALM-7B3C-G2W8',
  'ALM-4N6P-X1Q9', 'ALM-2M8K-Z5Y3', 'ALM-9J1L-R7H6', 'ALM-6G4F-C3D8', 'ALM-3V2W-P9B1',
  'ALM-5T7R-M4N5', 'ALM-8Q9X-J6K2', 'ALM-1Z3Y-F8G7', 'ALM-7C5D-L1H4', 'ALM-4W8B-N3V9',
  'ALM-2P6Q-K7X1', 'ALM-9M1N-Y4Z5', 'ALM-6R3T-G8J2', 'ALM-3H5F-D9L6', 'ALM-5J2K-B4C8',
  'ALM-8X7Q-W1P3', 'ALM-1Y9Z-V5M7', 'ALM-7N4P-R2T6', 'ALM-4G6F-H3J9', 'ALM-2L8K-C5D1',
  'ALM-9B1W-X7Q4', 'ALM-6V3M-Z8Y2', 'ALM-3T5R-N9P6', 'ALM-5F7G-K1L3', 'ALM-8D2J-H4C8',
  'ALM-1Q9X-W6B5', 'ALM-7Z3Y-P7V1', 'ALM-4M5N-R2T9', 'ALM-2K8L-G4F6', 'ALM-9H1J-D3C7',
  'ALM-6C5B-X8W2', 'ALM-3P7Q-Z1Y4', 'ALM-5N9M-V6R3', 'ALM-8T2K-L5J8', 'ALM-1G4F-H7D1',
  'ALM-7W6X-B3Q9', 'ALM-4Y8Z-C2P5', 'ALM-2V1M-N4T7', 'ALM-9R3K-J6L2', 'ALM-6F5G-D8H4',
  'ALM-3B7C-W1X9', 'ALM-5Q9P-Y6Z3', 'ALM-8M2N-R5V8', 'ALM-1T4K-G7J1', 'ALM-7L6H-F3D5',
  'ALM-4X8W-B9Q2', 'ALM-2Z1Y-C4P7', 'ALM-9N3M-V6T9', 'ALM-6K5L-J8R1', 'ALM-3G7F-H2D6',
  'ALM-5C9B-W4X3', 'ALM-8P2Q-Y7Z8', 'ALM-1M4N-R1V5', 'ALM-7K6T-G9J2', 'ALM-4L8H-F3D7',
  'ALM-2X1W-B5Q4', 'ALM-9Y3Z-C8P9', 'ALM-6N5M-V2T6', 'ALM-3R7K-J1L3', 'ALM-5G9F-H4D8',
  'ALM-8B2C-W7X1', 'ALM-1P4Q-Y9Z5', 'ALM-7M6N-R3V7', 'ALM-4T8K-G2J4', 'ALM-2H1L-F6D9',
  'ALM-9W3X-B8Q2', 'ALM-6Z5Y-C1P6', 'ALM-3V7M-N4T3', 'ALM-5K9R-J2L8', 'ALM-8F2G-H5D1',
  'ALM-1C4B-W9X7', 'ALM-7Q6P-Y3Z4', 'ALM-4N8M-R6V2', 'ALM-2T1K-G5J9', 'ALM-9L3H-F8D3',
  'ALM-6X5W-B2Q6', 'ALM-3Y7Z-C4P8', 'ALM-5M9N-V1T5', 'ALM-8R2K-J7L9', 'ALM-1G4F-H6D2',
  'ALM-7B6C-W3X8', 'ALM-4P8Q-Y5Z1', 'ALM-2N1M-R9V4', 'ALM-9T3K-G2J7', 'ALM-6H5L-F4D6',
  'ALM-3W7X-B8Q3', 'ALM-5Z9Y-C1P9', 'ALM-8V2M-N5T2', 'ALM-1K4R-J8L6', 'ALM-7F6G-H9D4',
];

// أكواد المضيف المحلي للشبكة
const LOCAL_NETWORK_HOST_CODES = [
  'ALM-HST-7K3M-Q9X2',
  'ALM-HST-4P8N-W1Y6',
  'ALM-HST-2R5T-H3Z9',
  'ALM-HST-9L6J-D4V7',
  'ALM-HST-1F8G-B5C3',
];

// أكواد الطرفيات المحلية
const LOCAL_NETWORK_TERMINAL_CODES = [
  'ALM-TRM-6W2X-N7M4',
  'ALM-TRM-3Y9Z-K8P1',
  'ALM-TRM-5H4J-T6R2',
  'ALM-TRM-8D1F-V9L5',
  'ALM-TRM-7B3C-G2W8',
  // legacy compatibility
  'BRN-4N6P-X1Q9',
  'BR-2M8K-Z5Y3',
];

// 100 أكواد سحابية مؤجلة (placeholder only)
const CLOUD_CODES = [
  'CLD-8R4T-M2X7', 'CLD-3N9P-K5W1', 'CLD-6J1L-Q8Y4', 'CLD-2F7G-V3Z9', 'CLD-5B4C-H6D2',
  'CLD-9X1W-N8M5', 'CLD-7Y3Z-P4Q6', 'CLD-1T6R-J9K3', 'CLD-4D8F-L2G7', 'CLD-6C5B-W1X9',
  'CLD-3M7N-R4V8', 'CLD-8K2L-Y6Z1', 'CLD-5H9J-Q3P5', 'CLD-2G4F-T7W2', 'CLD-9D1C-X8B6',
  'CLD-7N3M-K5L9', 'CLD-4P8Q-Z2Y4', 'CLD-1R6T-V7J3', 'CLD-6F2G-H9D8', 'CLD-3W5X-B4C1',
  'CLD-8Y7Z-N3M6', 'CLD-5Q1P-K8L2', 'CLD-2T4R-J6G9', 'CLD-9V3W-X1F5', 'CLD-7B8C-H4D7',
  'CLD-4M2N-Y9Z3', 'CLD-1K5L-Q6P8', 'CLD-6J9R-T3V1', 'CLD-3G7F-W2X4', 'CLD-8D4C-B5H9',
  'CLD-5N1M-Z8Y6', 'CLD-2P3Q-K7L2', 'CLD-9R6T-J4G5', 'CLD-7W8X-V1F3', 'CLD-4B2C-H9D7',
  'CLD-1Y5Z-N6M4', 'CLD-6Q3P-K8L1', 'CLD-3T7R-J2G9', 'CLD-8V4W-X5F6', 'CLD-5D1C-B3H8',
  'CLD-2M9N-Z7Y2', 'CLD-9K3L-Q4P5', 'CLD-7R6T-J1G8', 'CLD-4X2W-V9F3', 'CLD-1C5B-H6D7',
  'CLD-6N8M-Z3Y4', 'CLD-3P1Q-K2L9', 'CLD-8T4R-J7G6', 'CLD-5W9X-V3F1', 'CLD-2B6C-H8D5',
  'CLD-9Y1Z-N4M7', 'CLD-7Q5P-K6L3', 'CLD-4R8T-J9G2', 'CLD-1X3W-V5F8', 'CLD-6D7C-B2H4',
  'CLD-3N9M-Z1Y6', 'CLD-8K2L-Q5P3', 'CLD-5T6R-J3G9', 'CLD-2W4X-V8F7', 'CLD-9C1B-H5D2',
  'CLD-7M6N-Z4Y8', 'CLD-4Q3P-K9L1', 'CLD-1R5T-J6G4', 'CLD-6X8W-V2F9', 'CLD-3B7C-H3D5',
  'CLD-8N2M-Z9Y1', 'CLD-5K4L-Q7P6', 'CLD-2R8T-J1G3', 'CLD-9X5W-V4F8', 'CLD-7D3C-B6H2',
  'CLD-4Y1Z-N8M9', 'CLD-1Q6P-K3L5', 'CLD-6T2R-J9G7', 'CLD-3W7X-V1F4', 'CLD-8B5C-H8D6',
  'CLD-5M3N-Z2Y9', 'CLD-2K8L-Q4P1', 'CLD-9R1T-J5G6', 'CLD-7X4W-V7F3', 'CLD-4C9B-H2D8',
  'CLD-1N6M-Z5Y7', 'CLD-6P2Q-K1L4', 'CLD-3T9R-J8G3', 'CLD-8W3X-V6F9', 'CLD-5D7C-B4H1',
  'CLD-2Y8Z-N1M5', 'CLD-9Q4P-K6L7', 'CLD-7R2T-J3G2', 'CLD-4X6W-V9F5', 'CLD-1B3C-H7D4',
  'CLD-6M5N-Z8Y2', 'CLD-3K9L-Q1P6', 'CLD-8T3R-J4G8', 'CLD-5W1X-V2F7', 'CLD-2C6B-H5D9',
  'CLD-9N4M-Z3Y1', 'CLD-7P7Q-K8L5', 'CLD-4R1T-J6G9', 'CLD-1W5X-V4F2', 'CLD-6B8C-H1D3',
];

// 5 أكواد تجارب (trial)
const TRIAL_CODES = ['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5'];
const SUPER_ADMIN_USERNAME = 'homsi700';
const SUPER_ADMIN_PASSWORD_HASH = '$2a$12$fCJkGBg83mnBs7gDeyJM6efjChIQkgjxM8qdmmzncTJoUMdpS9NBC';

export const seedActivationCodes = async (_db: any) => {
  try {
    const rawDb = rawSqlite;

    // Ensure table exists
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS activation_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        activation_type TEXT NOT NULL DEFAULT 'local',
        license_mission TEXT NOT NULL DEFAULT 'LOCAL_STANDALONE',
        is_used INTEGER DEFAULT 0,
        used_at TEXT,
        computer_name TEXT,
        app_version TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS activation_telegram_dedupe (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS system_super_admins (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        is_bootstrap INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS license_extensions (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        extension_type TEXT NOT NULL,
        label TEXT NOT NULL,
        payload TEXT NOT NULL,
        applied_by TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add activation_type column if missing (upgrade from old schema)
    try {
      rawDb.exec(`ALTER TABLE activation_codes ADD COLUMN activation_type TEXT NOT NULL DEFAULT 'local'`);
    } catch { /* column already exists */ }
    try {
      rawDb.exec(`ALTER TABLE activation_codes ADD COLUMN license_mission TEXT NOT NULL DEFAULT 'LOCAL_STANDALONE'`);
    } catch { /* column already exists */ }

    // Check if all code types are seeded (handle upgrade from old versions)
    const count = rawDb.prepare('SELECT COUNT(*) as cnt FROM activation_codes').get() as { cnt: number };
    const trialCount = rawDb.prepare("SELECT COUNT(*) as cnt FROM activation_codes WHERE activation_type = 'trial'").get() as { cnt: number };
    const cloudCount = rawDb.prepare("SELECT COUNT(*) as cnt FROM activation_codes WHERE activation_type = 'cloud'").get() as { cnt: number };
    const hostCount = rawDb.prepare("SELECT COUNT(*) as cnt FROM activation_codes WHERE license_mission = 'LOCAL_NETWORK_HOST'").get() as { cnt: number };
    const terminalCount = rawDb.prepare("SELECT COUNT(*) as cnt FROM activation_codes WHERE license_mission = 'LOCAL_NETWORK_TERMINAL'").get() as { cnt: number };
    const existingSuperAdmin = rawDb.prepare('SELECT id FROM system_super_admins WHERE username = ?').get(SUPER_ADMIN_USERNAME) as { id?: string } | undefined;
    if (!existingSuperAdmin?.id) {
      rawDb.prepare(`
        INSERT INTO system_super_admins (id, username, password_hash, display_name, must_change_password, is_bootstrap)
        VALUES (?, ?, ?, ?, 0, 1)
      `).run('sysadmin-bootstrap', SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD_HASH, 'System Super Admin');
    }
    if (
      count.cnt > 0 &&
      trialCount.cnt >= TRIAL_CODES.length &&
      cloudCount.cnt >= CLOUD_CODES.length &&
      hostCount.cnt >= LOCAL_NETWORK_HOST_CODES.length &&
      terminalCount.cnt >= LOCAL_NETWORK_TERMINAL_CODES.length
    ) {
      return { seeded: false, existing: count.cnt };
    }

    // Insert all codes with their types (INSERT OR IGNORE handles existing codes)
    const insert = rawDb.prepare('INSERT OR IGNORE INTO activation_codes (code, activation_type, license_mission) VALUES (?, ?, ?)');
    const insertAll = rawDb.transaction(() => {
      for (const code of LOCAL_CODES) insert.run(code, 'local', 'LOCAL_STANDALONE');
      for (const code of LOCAL_NETWORK_HOST_CODES) insert.run(code, 'local', 'LOCAL_NETWORK_HOST');
      for (const code of LOCAL_NETWORK_TERMINAL_CODES) insert.run(code, 'local', 'LOCAL_NETWORK_TERMINAL');
      for (const code of CLOUD_CODES) insert.run(code, 'cloud', 'CLOUD_PLACEHOLDER');
      for (const code of TRIAL_CODES) insert.run(code, 'trial', 'TRIAL');
    });
    insertAll();

    const total =
      LOCAL_CODES.length +
      LOCAL_NETWORK_HOST_CODES.length +
      LOCAL_NETWORK_TERMINAL_CODES.length +
      CLOUD_CODES.length +
      TRIAL_CODES.length;
    return { seeded: true, count: total };
  } catch (e: any) {
    console.warn('seedActivationCodes warning:', e.message);
    return { seeded: false };
  }
};
