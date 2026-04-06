import type { AppSettings, ProjectProfileId, ProjectProfileSettings } from '../types';

export type AppTabId =
  | 'dashboard'
  | 'branches_radar'
  | 'pos'
  | 'inventory'
  | 'inventory_promotions'
  | 'invoices'
  | 'manufacturing'
  | 'restaurant'
  | 'restaurant_tables'
  | 'restaurant_settings'
  | 'restaurant_qr'
  | 'restaurant_menu_qr'
  | 'restaurant_reports'
  | 'funds'
  | 'accounts'
  | 'expenses'
  | 'partners'
  | 'clients'
  | 'stocktaking'
  | 'reports'
  | 'settings'
  | 'agents'
  | 'opening_stock'
  | 'opening_balances'
  | 'delivery_notices'
  | 'delivery_approvals'
  | 'consignments'
  | 'system_monitoring';

export interface ProjectProfileDefinition {
  id: ProjectProfileId;
  label: string;
  arabicMeaning: string;
  description: string;
  includes: string[];
  hiddenByDefault: string[];
  focusLabel: string;
  landingTab: AppTabId;
  navOrder: AppTabId[];
  visibleTabs: AppTabId[];
  importantSubsections: string[];
  reminders: string[];
  legacyBusinessType: 'restaurants' | 'cafeteria' | 'food_distribution' | 'warehouses' | 'general_trade' | 'factories';
  activeModules: string[];
}

const PROFILE_DEFINITIONS: Record<ProjectProfileId, ProjectProfileDefinition> = {
  COMPREHENSIVE_GENERAL: {
    id: 'COMPREHENSIVE_GENERAL',
    label: 'Comprehensive General',
    arabicMeaning: 'شامل عام',
    description: 'يعرض النظام الكامل بكامل مجالاته التجارية والمطاعم والتصنيع والتقارير والإدارة.',
    includes: ['المحاسبة والمالية', 'المخزون والمستودعات', 'المبيعات والمشتريات', 'نقطة البيع', 'المطعم', 'التصنيع', 'المناديب والتوزيع', 'التقارير', 'الإدارة والإعدادات'],
    hiddenByDefault: ['المطبخ', 'التصنيع', 'الشركاء', 'رادار الفروع', 'مركز المراقبة', 'أدوات التسليم والعروض داخل المخزون'],
    focusLabel: 'تجربة ERP كاملة مع إبقاء الأقسام الإضافية تحت تحكم السوبر أدمن.',
    landingTab: 'dashboard',
    navOrder: ['dashboard', 'pos', 'inventory', 'invoices', 'restaurant', 'manufacturing', 'funds', 'accounts', 'expenses', 'partners', 'clients', 'stocktaking', 'reports', 'agents', 'branches_radar', 'settings'],
    visibleTabs: ['dashboard', 'pos', 'inventory', 'invoices', 'funds', 'accounts', 'expenses', 'clients', 'stocktaking', 'reports', 'settings', 'agents', 'opening_stock', 'opening_balances', 'consignments'],
    importantSubsections: ['الطاولات و QR', 'التصنيع والوصفات', 'إشعارات التسليم', 'الجرد الافتتاحي والأرصدة الافتتاحية'],
    reminders: ['راجع صلاحيات المستخدمين بعد الإعداد الأولي.', 'أدخل الأرصدة الافتتاحية والمخزون الافتتاحي إن كانت لديك بيانات سابقة.', 'اضبط الطابعات الحرارية و A4 حسب العمليات التي ستعمل عليها مباشرة.'],
    legacyBusinessType: 'general_trade',
    activeModules: ['inventory', 'sales', 'finance', 'restaurant', 'manufacturing', 'agents', 'reports'],
  },
  COMPREHENSIVE_COMMERCIAL: {
    id: 'COMPREHENSIVE_COMMERCIAL',
    label: 'Comprehensive Commercial',
    arabicMeaning: 'شامل تجاري',
    description: 'يركز على التجارة العامة: المخزون والفواتير والمحاسبة والعملاء والموردين ونقطة البيع والتقارير.',
    includes: ['المحاسبة والمالية', 'المخزون والمستودعات', 'المبيعات والمشتريات', 'نقطة البيع', 'العملاء والموردون', 'التقارير', 'الإدارة والإعدادات'],
    hiddenByDefault: ['المطعم', 'التصنيع', 'الشركاء', 'رادار الفروع', 'مركز المراقبة', 'إشعارات واعتمادات التسليم', 'العروض'],
    focusLabel: 'تجربة تجارية متوازنة بدون المطعم أو التصنيع أو المناديب في الواجهة الرئيسية.',
    landingTab: 'dashboard',
    navOrder: ['dashboard', 'pos', 'inventory', 'invoices', 'clients', 'funds', 'accounts', 'expenses', 'partners', 'stocktaking', 'reports', 'branches_radar', 'settings'],
    visibleTabs: ['dashboard', 'pos', 'inventory', 'invoices', 'funds', 'accounts', 'expenses', 'clients', 'stocktaking', 'reports', 'settings', 'opening_stock', 'opening_balances', 'consignments'],
    importantSubsections: ['الفواتير والمشتريات', 'العملاء والموردون', 'الصناديق والسندات', 'التقارير التجارية'],
    reminders: ['أضف الموردين والعملاء الأساسيين بعد الدخول.', 'راجع سياسات التسعير والعملات قبل إصدار أول فاتورة.', 'أكمل الأرصدة الافتتاحية والمخزون الافتتاحي إن كنت تنتقل من نظام سابق.'],
    legacyBusinessType: 'general_trade',
    activeModules: ['inventory', 'sales', 'finance', 'reports'],
  },
  COMPREHENSIVE_RESTAURANT: {
    id: 'COMPREHENSIVE_RESTAURANT',
    label: 'Comprehensive Restaurant',
    arabicMeaning: 'شامل مطاعم',
    description: 'يجعل المطعم ونقطة البيع والطاولات والطباعة الحرارية في الواجهة الأساسية مع المحاسبة والمخزون والتقارير.',
    includes: ['المطعم', 'QR والطاولات والجلسات', 'نقطة البيع', 'المخزون', 'المحاسبة', 'التقارير', 'الطباعة والكاشير'],
    hiddenByDefault: ['المطبخ', 'التصنيع', 'مركز المراقبة', 'الأقسام الإضافية غير الأساسية'],
    focusLabel: 'يمكن للسوبر أدمن فقط إعادة فتح واجهات المطعم عند الحاجة.',
    landingTab: 'dashboard',
    navOrder: ['restaurant', 'pos', 'inventory', 'invoices', 'funds', 'reports', 'clients', 'accounts', 'expenses', 'settings', 'dashboard'],
    visibleTabs: ['dashboard', 'pos', 'inventory', 'invoices', 'funds', 'accounts', 'expenses', 'clients', 'reports', 'settings', 'opening_stock', 'opening_balances', 'consignments'],
    importantSubsections: ['الطاولات والجلسات', 'طباعة المطبخ', 'QR Menu', 'تقارير المطعم'],
    reminders: ['أضف الطاولات والحالات التشغيلية قبل بدء الخدمة.', 'راجع طابعات المطبخ وطابعة الزبون والطباعة الحرارية.', 'أدخل الأصناف والوصفات والمواد الخام المرتبطة بالمطعم إن كانت مطلوبة.'],
    legacyBusinessType: 'restaurants',
    activeModules: ['restaurant', 'sales', 'inventory', 'finance', 'reports'],
  },
  COMPREHENSIVE_MANUFACTURING: {
    id: 'COMPREHENSIVE_MANUFACTURING',
    label: 'Comprehensive Manufacturing',
    arabicMeaning: 'شامل تصنيع',
    description: 'يُظهر التصنيع والمواد الخام والوصفات والإنتاج والمخزون والمحاسبة بشكل أساسي.',
    includes: ['التصنيع', 'الوصفات / BOM', 'المواد الخام والمنتهية', 'المخزون', 'المحاسبة', 'التقارير'],
    hiddenByDefault: ['المطعم', 'التصنيع', 'إشعارات واعتمادات التسليم', 'مركز المراقبة', 'واجهات البيع السريع غير الأساسية'],
    focusLabel: 'التصنيع يبقى تحت تحكم السوبر أدمن قبل فتحه للعميل.',
    landingTab: 'dashboard',
    navOrder: ['manufacturing', 'inventory', 'reports', 'funds', 'accounts', 'expenses', 'invoices', 'clients', 'settings', 'dashboard'],
    visibleTabs: ['dashboard', 'inventory', 'invoices', 'funds', 'accounts', 'expenses', 'clients', 'reports', 'settings', 'stocktaking', 'opening_stock', 'opening_balances', 'consignments'],
    importantSubsections: ['الوصفات', 'أوامر الإنتاج', 'المخزون الخام والمنتهي', 'تقارير التصنيع'],
    reminders: ['أدخل الوصفات/التركيبات قبل أول أمر تصنيع.', 'راجع المستودعات الخاصة بالمواد الخام والمنتجات النهائية.', 'أدخل المخزون الافتتاحي للمواد الخام والمنتجات إذا كانت المنشأة قائمة.'],
    legacyBusinessType: 'factories',
    activeModules: ['manufacturing', 'inventory', 'finance', 'reports'],
  },
  COMPREHENSIVE_DISTRIBUTION: {
    id: 'COMPREHENSIVE_DISTRIBUTION',
    label: 'Comprehensive Distribution',
    arabicMeaning: 'شامل مناديب / توزيع',
    description: 'يركز على المناديب والمبيعات الميدانية والمخزون والحسابات والعملاء والتقارير.',
    includes: ['المناديب / الوكلاء', 'المخزون', 'المبيعات', 'المحاسبة', 'العملاء والموردون', 'التقارير'],
    hiddenByDefault: ['المطعم', 'التصنيع', 'رادار الفروع', 'مركز المراقبة', 'إشعارات واعتمادات التسليم'],
    focusLabel: 'الأولوية للمندوبين وحركة البضاعة والمبيعات الميدانية.',
    landingTab: 'agents',
    navOrder: ['agents', 'branches_radar', 'invoices', 'inventory', 'clients', 'funds', 'reports', 'accounts', 'expenses', 'settings', 'dashboard'],
    visibleTabs: ['dashboard', 'inventory', 'invoices', 'funds', 'accounts', 'expenses', 'clients', 'reports', 'settings', 'agents', 'stocktaking', 'opening_stock', 'opening_balances', 'consignments'],
    importantSubsections: ['المناديب', 'حركة المخزون', 'الفواتير الميدانية', 'التقارير البيعية'],
    reminders: ['أضف المناديب ومساراتهم أو مستودعاتهم قبل التشغيل.', 'راجع سياسة التسعير والعمولات الخاصة بالتوزيع.', 'أدخل المخزون الافتتاحي ونقاط التسليم أو الفروع إذا كانت مستخدمة.'],
    legacyBusinessType: 'food_distribution',
    activeModules: ['agents', 'sales', 'inventory', 'finance', 'reports'],
  },
};

const LEGACY_PROFILE_BY_BUSINESS_TYPE: Record<string, ProjectProfileId> = {
  restaurants: 'COMPREHENSIVE_RESTAURANT',
  cafeteria: 'COMPREHENSIVE_RESTAURANT',
  food_distribution: 'COMPREHENSIVE_DISTRIBUTION',
  warehouses: 'COMPREHENSIVE_COMMERCIAL',
  general_trade: 'COMPREHENSIVE_COMMERCIAL',
  factories: 'COMPREHENSIVE_MANUFACTURING',
};

export const DEFAULT_PROJECT_PROFILE_ID: ProjectProfileId = 'COMPREHENSIVE_GENERAL';

export const PROJECT_PROFILES = Object.values(PROFILE_DEFINITIONS);

export const getProjectProfileDefinition = (profileId?: ProjectProfileId | null): ProjectProfileDefinition => {
  return PROFILE_DEFINITIONS[profileId || DEFAULT_PROJECT_PROFILE_ID] || PROFILE_DEFINITIONS[DEFAULT_PROJECT_PROFILE_ID];
};

export const getProjectProfileLabel = (profileId?: ProjectProfileId | null): string => {
  const profile = getProjectProfileDefinition(profileId);
  return `${profile.arabicMeaning} (${profile.label})`;
};

export const getLegacyBusinessTypeForProfile = (profileId?: ProjectProfileId | null) => {
  return getProjectProfileDefinition(profileId).legacyBusinessType;
};

export const getActiveModulesForProfile = (profileId?: ProjectProfileId | null): string[] => {
  return [...getProjectProfileDefinition(profileId).activeModules];
};

export const normalizeProjectProfile = (input?: Partial<ProjectProfileSettings> | ProjectProfileId | null): ProjectProfileSettings => {
  const rawId = typeof input === 'string' ? input : input?.id;
  const id = (String(rawId || '').trim().toUpperCase() as ProjectProfileId) || DEFAULT_PROJECT_PROFILE_ID;
  const normalizedId = PROFILE_DEFINITIONS[id] ? id : DEFAULT_PROJECT_PROFILE_ID;
  return {
    id: normalizedId,
    source: typeof input === 'object' ? input?.source : undefined,
    configuredAt: typeof input === 'object' ? input?.configuredAt : undefined,
  };
};

export const inferProjectProfileFromLegacy = (value?: unknown): ProjectProfileSettings => {
  const raw = String(value || '').trim();
  const inferred = LEGACY_PROFILE_BY_BUSINESS_TYPE[raw] || DEFAULT_PROJECT_PROFILE_ID;
  return {
    id: inferred,
    source: raw ? 'legacy_inference' : undefined,
  };
};

export const resolveProjectProfile = (settings?: Partial<AppSettings> | null): ProjectProfileSettings => {
  if (settings?.projectProfile?.id) return normalizeProjectProfile(settings.projectProfile);
  const company = settings?.company as Record<string, unknown> | undefined;
  const legacy = company?.businessType || company?.type;
  return inferProjectProfileFromLegacy(legacy);
};

export const getVisibleTabsForProfile = (profileId?: ProjectProfileId | null): Set<string> => {
  return new Set(getProjectProfileDefinition(profileId).visibleTabs);
};

export const isTabVisibleForProfile = (tabId: string, profileId?: ProjectProfileId | null): boolean => {
  return getVisibleTabsForProfile(profileId).has(tabId);
};

export const getProfileLandingTab = (profileId?: ProjectProfileId | null): AppTabId => {
  return getProjectProfileDefinition(profileId).landingTab;
};

export const getProfileNavOrder = (profileId?: ProjectProfileId | null): AppTabId[] => {
  return [...getProjectProfileDefinition(profileId).navOrder];
};
