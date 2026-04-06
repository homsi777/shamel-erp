import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { DEFAULT_COMPANY_ID } from '../lib/tenantScope';

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
  { code: '3300', nameAr: 'أرباح العام الحالي', accountType: 'equity', accountNature: 'credit', parentCode: '3000', isSystem: true },
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
  { code: '2125', nameAr: 'مقاصة تكاليف الاستيراد', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  { code: '4320', nameAr: 'أرباح تسوية الحسابات (مطابقة)', accountType: 'revenue', accountNature: 'credit', parentCode: '4300', isSystem: true },
  { code: '5820', nameAr: 'خسائر تسوية الحسابات (مطابقة)', accountType: 'expenses', accountNature: 'debit', parentCode: '5800', isSystem: true },
  { code: '4310', nameAr: 'أرباح فروقات العملة المحققة', accountType: 'revenue', accountNature: 'credit', parentCode: '4300', isSystem: true },
  { code: '5810', nameAr: 'خسائر فروقات العملة المحققة', accountType: 'expenses', accountNature: 'debit', parentCode: '5800', isSystem: true },
  { code: '4315', nameAr: 'أرباح فروقات العملة غير المحققة', accountType: 'revenue', accountNature: 'credit', parentCode: '4300', isSystem: true },
  { code: '5815', nameAr: 'خسائر فروقات العملة غير المحققة', accountType: 'expenses', accountNature: 'debit', parentCode: '5800', isSystem: true },
  { code: '1141', nameAr: 'مخزون أمانة لدى العملاء', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '1142', nameAr: 'مخزون أمانة من الموردين', accountType: 'assets', accountNature: 'debit', parentCode: '1100', isSystem: true },
  { code: '2115', nameAr: 'التزامات أمانة للموردين', accountType: 'liabilities', accountNature: 'credit', parentCode: '2100', isSystem: true },
  { code: '4105', nameAr: 'إيرادات أمانة (تسويات)', accountType: 'revenue', accountNature: 'credit', parentCode: '4000' },
  { code: '5205', nameAr: 'عمولات أمانة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
  { code: '5805', nameAr: 'تسويات فروقات الأمانة', accountType: 'expenses', accountNature: 'debit', parentCode: '5000' },
];

const UNIQUE_SEED_ACCOUNTS: SeedNode[] = Array.from(
  new Map(SEED_ACCOUNTS.map((node) => [node.code, node])).values(),
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
