import { appError } from './errors';

export const DEFAULT_COMPANY_ID = 'org-main';
export const DEFAULT_BRANCH_ID = 'br-main';

export type TenantAuthContext = {
  userId?: string | null;
  companyId: string;
  allowedCompanyIds?: string[];
  branchScope?: 'restricted' | 'company_wide';
  allowedBranchIds: string[];
  defaultBranchId: string | null;
  currentBranchId: string | null;
  requiresBranchSelection: boolean;
};

export type CollectionScope = 'global' | 'company' | 'branch' | 'hybrid';

export const COLLECTION_SCOPE_MAP: Record<string, CollectionScope> = {
  companies: 'global',
  'system-events': 'company',
  'audit-logs': 'company',
  settings: 'company',
  'system-settings': 'company',
  users: 'company',
  'user-branch-access': 'company',
  branches: 'company',
  'remote-branches': 'company',
  accounts: 'company',
  'journal-entries': 'branch',
  'journal-entry-lines': 'company',
  parties: 'company',
  clients: 'company',
  partners: 'company',
  categories: 'company',
  'sub-categories': 'company',
  units: 'company',
  employees: 'company',
  'biometric-devices': 'branch',
  'attendance-records': 'branch',
  items: 'branch',
  inventory: 'branch',
  warehouses: 'branch',
  'item-groups': 'company',
  'item-group-items': 'company',
  'item-serials': 'branch',
  'item-barcodes': 'company',
  promotions: 'company',
  'textile-colors': 'company',
  'textile-stock-balances': 'branch',
  'warehouse-dispatch-notices': 'branch',
  'warehouse-dispatch-notice-lines': 'branch',
  'warehouse-dispatch-notice-line-decompositions': 'branch',
  agents: 'branch',
  'agent-inventory': 'branch',
  'agent-transfers': 'branch',
  'agent-transfer-lines': 'branch',
  'agent-inventory-movements': 'branch',
  invoices: 'branch',
  vouchers: 'branch',
  'cash-boxes': 'branch',
  expenses: 'branch',
  'delivery-notices': 'branch',
  'stock-transfers': 'branch',
  'party-transfers': 'branch',
  'party-transactions': 'hybrid',
  'partner-transactions': 'branch',
  'consignment-documents': 'branch',
  'consignment-document-lines': 'branch',
  'consignment-settlements': 'branch',
  'consignment-settlement-lines': 'branch',
  'manufacturing-orders': 'branch',
  recipes: 'company',
  'salary-transactions': 'branch',
  'payroll/transactions': 'branch',
  'inventory/transfers': 'branch',
  'parties/transfers': 'branch',
  'reconciliation-marks': 'branch',
  'restaurant-tables': 'branch',
  'restaurant-table-sessions': 'branch',
  'restaurant-menu-items': 'branch',
  'restaurant-table-requests': 'branch',
  'restaurant-table-request-items': 'branch',
};

export const BRANCH_REQUIRED_PREFIXES = [
  '/api/invoices',
  '/api/vouchers',
  '/api/receipts',
  '/api/payments',
  '/api/cash-boxes',
  '/api/expenses',
  '/api/delivery-notices',
  '/api/textile/dispatches',
  '/api/inventory/transfer',
  '/api/inventory/transfers',
  '/api/agent-inventory',
  '/api/agent-transfers',
  '/api/payroll',
  '/api/manufacturing',
  '/api/restaurant',
];

export const normalizeTenantId = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

export const normalizeTenantIdList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => normalizeTenantId(entry)).filter(Boolean) as string[]));
  }
  const normalized = normalizeTenantId(value);
  return normalized ? [normalized] : [];
};

const normalizePermissionList = (user: any) => {
  if (!user) return [];
  if (Array.isArray(user.permissions)) {
    return user.permissions.map((entry: any) => String(entry || '').trim()).filter(Boolean);
  }
  return String(user.permissions || '')
    .split(',')
    .map((entry: string) => String(entry || '').trim())
    .filter(Boolean);
};

export const hasMultiCompanyVisibilityCapability = (user: any) => {
  const role = String(user?.role || '').trim().toLowerCase();
  if (role === 'admin' || role === 'manager') return true;
  const permissions = normalizePermissionList(user);
  if (permissions.includes('*')) return true;
  return permissions.some((permission) => [
    'multi_company_view',
    'multi_company_manage',
    'manage_users',
    'manage_settings',
    'system.admin',
  ].includes(String(permission || '').trim().toLowerCase()));
};

export const normalizeCollectionName = (collection: string) => {
  const raw = String(collection || '').trim();
  if (raw === 'inventory') return 'items';
  if (raw === 'clients') return 'parties';
  if (raw === 'system-settings') return 'settings';
  return raw;
};

export const getCollectionScope = (collection: string): CollectionScope =>
  COLLECTION_SCOPE_MAP[normalizeCollectionName(collection)] || 'company';

export const requiresBranchForPath = (path: string, method: string) => {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (normalizedMethod === 'GET' && !String(path || '').startsWith('/api/reports')) return false;
  return BRANCH_REQUIRED_PREFIXES.some((prefix) => String(path || '').startsWith(prefix));
};

export const branchAccessSet = (authContext?: Partial<TenantAuthContext> | null) =>
  new Set(normalizeTenantIdList(authContext?.allowedBranchIds || []));

export const hasBranchAccess = (authContext: Partial<TenantAuthContext> | null | undefined, branchId: unknown) => {
  const normalizedBranchId = normalizeTenantId(branchId);
  if (!normalizedBranchId) return false;
  const scope = String(authContext?.branchScope || '').trim().toLowerCase();
  if (scope === 'company_wide') return true;
  return branchAccessSet(authContext).has(normalizedBranchId);
};

export const pickEffectiveBranchId = (
  requestedBranchId: unknown,
  authContext?: Partial<TenantAuthContext> | null,
) => {
  const requested = normalizeTenantId(requestedBranchId);
  if (requested) return requested;
  return normalizeTenantId(authContext?.currentBranchId) || normalizeTenantId(authContext?.defaultBranchId);
};

export const resolveEntityCompanyId = (row: any) =>
  normalizeTenantId(row?.companyId ?? row?.company_id);

export const resolveEntityBranchId = (row: any) =>
  normalizeTenantId(row?.branchId ?? row?.branch_id);

export const assertEntityBelongsToCompany = (
  row: any,
  companyId: string,
  notFoundMessage = 'العنصر غير موجود ضمن المؤسسة الحالية.',
) => {
  const entityCompanyId = resolveEntityCompanyId(row);
  if (!companyId || !entityCompanyId || entityCompanyId !== companyId) {
    throw appError(404, 'ENTITY_OUTSIDE_COMPANY', notFoundMessage, {
      company_id: companyId,
      entity_company_id: entityCompanyId,
    });
  }
};

export const assertEntityBelongsToAllowedBranch = (
  row: any,
  authContext: Partial<TenantAuthContext>,
  message = 'العنصر خارج الفروع المسموح بها لهذا المستخدم.',
) => {
  const entityBranchId = resolveEntityBranchId(row);
  if (!entityBranchId) return;
  if (!hasBranchAccess(authContext, entityBranchId)) {
    throw appError(403, 'BRANCH_ACCESS_DENIED', message, {
      branch_id: entityBranchId,
      allowed_branch_ids: normalizeTenantIdList(authContext?.allowedBranchIds || []),
    });
  }
};

export const filterRowsByTenantScope = (
  rows: any[],
  authContext: Partial<TenantAuthContext>,
  collection: string,
) => {
  const scope = getCollectionScope(collection);
  if (scope === 'global') return rows;
  const companyId = normalizeTenantId(authContext?.companyId);
  if (!companyId) return [];

  const allowedBranches = branchAccessSet(authContext);
  const companyWide = String(authContext?.branchScope || '').trim().toLowerCase() === 'company_wide';

  return (rows || []).filter((row) => {
    const rowCompanyId = resolveEntityCompanyId(row);
    const rowBranchId = resolveEntityBranchId(row);
    if (!rowCompanyId || rowCompanyId !== companyId) return false;
    if (scope === 'company') return true;
    if (!rowBranchId) return scope === 'hybrid';
    if (companyWide) return true;
    return allowedBranches.has(rowBranchId);
  });
};

export const enforcePayloadTenantScope = (
  payload: Record<string, any>,
  authContext: Partial<TenantAuthContext>,
  collection: string,
) => {
  const scope = getCollectionScope(collection);
  const companyId = normalizeTenantId(authContext?.companyId);
  if (!companyId) {
    throw appError(401, 'NO_COMPANY_CONTEXT', 'يجب تمرير سياق مؤسسة صالح مع هذا الطلب.');
  }

  payload.companyId = companyId;
  let effectiveBranchId = pickEffectiveBranchId(payload.branchId ?? payload.branch_id, authContext);

  // Company-wide admins with no explicit branch in context fall back to DEFAULT_BRANCH_ID
  if (!effectiveBranchId && authContext?.branchScope === 'company_wide') {
    effectiveBranchId = DEFAULT_BRANCH_ID;
  }

  if (scope === 'branch') {
    if (!effectiveBranchId) {
      throw appError(400, 'BRANCH_REQUIRED', 'يجب اختيار فرع صالح قبل متابعة العملية.', {
        requires_branch_selection: authContext?.requiresBranchSelection ?? false,
      });
    }
    if (!hasBranchAccess(authContext, effectiveBranchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'هذا الفرع غير مسموح للمستخدم الحالي.', {
        branch_id: effectiveBranchId,
      });
    }
    payload.branchId = effectiveBranchId;
  } else if (scope === 'hybrid' && effectiveBranchId) {
    if (!hasBranchAccess(authContext, effectiveBranchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'هذا الفرع غير مسموح للمستخدم الحالي.', {
        branch_id: effectiveBranchId,
      });
    }
    payload.branchId = effectiveBranchId;
  } else if (scope === 'company') {
    payload.branchId = payload.branchId ?? null;
  }

  return payload;
};

export const resolveCompanyAccessForUser = async (
  db: any,
  schema: any,
  eq: any,
  user: any,
) => {
  const userId = normalizeTenantId(user?.id);
  const fallbackCompanyId = normalizeTenantId(user?.companyId);
  let membershipRows: any[] = [];
  try {
    membershipRows = await db.select().from(schema.userCompanyAccess)
      .where(eq(schema.userCompanyAccess.userId, String(userId || '')))
      .all();
  } catch {
    membershipRows = [];
  }

  const allowedCompanyIds = Array.from(new Set(
    (membershipRows || [])
      .filter((row: any) => row?.isActive !== false && Number(row?.isActive ?? 1) !== 0)
      .map((row: any) => normalizeTenantId(row?.companyId))
      .filter(Boolean) as string[]
  ));

  if (fallbackCompanyId && !allowedCompanyIds.includes(fallbackCompanyId)) {
    allowedCompanyIds.push(fallbackCompanyId);
  }

  let companies: any[] = [];
  try {
    companies = await db.select().from(schema.companies).all();
  } catch {
    companies = [];
  }
  const companyMap = new Map(
    (companies || [])
      .filter((row: any) => row?.isActive !== false && Number(row?.isActive ?? 1) !== 0)
      .map((row: any) => [String(row.id), row])
  );

  const scopedCompanies = allowedCompanyIds
    .map((companyId) => companyMap.get(companyId))
    .filter(Boolean);

  const hasMultiCompanyCapability = hasMultiCompanyVisibilityCapability(user);
  const requestedDefaultCompanyId =
    normalizeTenantId((membershipRows || []).find((row: any) => Number(row?.isDefault ?? 0) === 1)?.companyId)
    || fallbackCompanyId
    || normalizeTenantId(scopedCompanies[0]?.id);

  const enforcedCompanyId = hasMultiCompanyCapability
    ? requestedDefaultCompanyId
    : (
      fallbackCompanyId
      || requestedDefaultCompanyId
      || normalizeTenantId(scopedCompanies[0]?.id)
    );

  const effectiveCompanies = hasMultiCompanyCapability
    ? scopedCompanies
    : scopedCompanies.filter((company: any) => String(company?.id || '') === String(enforcedCompanyId || ''));

  const defaultCompanyId =
    normalizeTenantId(enforcedCompanyId)
    || normalizeTenantId(effectiveCompanies[0]?.id);

  return {
    allowedCompanyIds: effectiveCompanies.map((company: any) => String(company.id)),
    defaultCompanyId,
    companies: effectiveCompanies,
    hasMultiCompanyCapability,
    visibilityMode: hasMultiCompanyCapability ? 'allowed_multi' : 'single',
  };
};

export const resolveBranchAccessForUser = async (
  db: any,
  schema: any,
  eq: any,
  user: any,
  companyId: string,
) => {
  const companyAccess = await resolveCompanyAccessForUser(db, schema, eq, user);
  if (!companyAccess.allowedCompanyIds.includes(companyId)) {
    throw appError(403, 'COMPANY_ACCESS_DENIED', 'المستخدم لا ينتمي إلى المؤسسة المحددة.', {
      company_id: companyId,
      allowed_company_ids: companyAccess.allowedCompanyIds,
    });
  }
  const role = String(user?.role || '').trim().toLowerCase();
  const branchScope = (role === 'admin'
    || String(user?.branchScope || 'restricted').trim().toLowerCase() === 'company_wide')
    ? 'company_wide'
    : 'restricted';
  let companyBranches: any[] = [];
  try {
    companyBranches = await db.select().from(schema.branches)
      .where(eq(schema.branches.companyId, companyId))
      .all();
  } catch {
    companyBranches = [];
  }
  const activeCompanyBranches = (companyBranches || []).filter((branch: any) => branch?.isActive !== false && Number(branch?.isActive ?? 1) !== 0);
  const activeCompanyBranchIdSet = new Set(activeCompanyBranches.map((branch: any) => String(branch.id)));
  let branchRows: any[] = [];
  try {
    branchRows = await db.select().from(schema.userBranchAccess)
      .where(eq(schema.userBranchAccess.userId, String(user?.id || '')))
      .all();
  } catch {
    branchRows = [];
  }
  const branchIdsFromRows = Array.from(new Set(
    (branchRows || [])
      .filter((row: any) => row?.isActive !== false && Number(row?.isActive ?? 1) !== 0)
      .map((row: any) => normalizeTenantId(row?.branchId))
      .filter(Boolean) as string[]
  )).filter((branchId) => activeCompanyBranchIdSet.has(String(branchId)));
  const defaultBranchFromUser = normalizeTenantId(user?.defaultBranchId);
  if (defaultBranchFromUser && activeCompanyBranchIdSet.has(defaultBranchFromUser) && !branchIdsFromRows.includes(defaultBranchFromUser)) {
    branchIdsFromRows.push(defaultBranchFromUser);
  }
  const allowedBranchIds = branchScope === 'company_wide'
    ? activeCompanyBranches.map((branch: any) => String(branch.id))
    : (branchIdsFromRows.length > 0
      ? branchIdsFromRows
      : (activeCompanyBranches.length === 1 ? [String(activeCompanyBranches[0].id)] : []));
  const defaultBranchId =
    normalizeTenantId((branchRows || []).find((row: any) => Number(row?.isDefault ?? 0) === 1)?.branchId)
    || defaultBranchFromUser
    || (allowedBranchIds.length === 1 ? allowedBranchIds[0] : null);
  const currentBranchId = allowedBranchIds.length === 1 ? allowedBranchIds[0] : defaultBranchId;
  return {
    branchScope: branchScope as 'restricted' | 'company_wide',
    allowedBranchIds,
    defaultBranchId,
    currentBranchId,
    requiresBranchSelection: allowedBranchIds.length > 1 && !currentBranchId,
    companyBranches: activeCompanyBranches,
  };
};

export const resolveWarehouseForContext = async (
  db: any,
  schema: any,
  eq: any,
  warehouseId: string,
) => {
  if (!normalizeTenantId(warehouseId)) return null;
  return db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get();
};

export const resolveCashBoxForContext = async (
  db: any,
  schema: any,
  eq: any,
  cashBoxId: string,
) => {
  if (!normalizeTenantId(cashBoxId)) return null;
  return db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, cashBoxId)).get();
};

export const assertWarehouseAccess = (
  warehouse: any,
  authContext: Partial<TenantAuthContext>,
) => {
  if (!warehouse) {
    throw appError(404, 'WAREHOUSE_NOT_FOUND', 'المستودع غير موجود.');
  }
  assertEntityBelongsToCompany(warehouse, String(authContext.companyId || ''));
  assertEntityBelongsToAllowedBranch(warehouse, authContext, 'المستودع خارج الفروع المسموح بها.');
};

export const assertCashBoxAccess = (
  cashBox: any,
  authContext: Partial<TenantAuthContext>,
) => {
  if (!cashBox) {
    throw appError(404, 'CASH_BOX_NOT_FOUND', 'الصندوق غير موجود.');
  }
  assertEntityBelongsToCompany(cashBox, String(authContext.companyId || ''));
  assertEntityBelongsToAllowedBranch(cashBox, authContext, 'الصندوق خارج الفروع المسموح بها.');
};
