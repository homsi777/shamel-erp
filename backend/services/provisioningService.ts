/**
 * Provisioning Service — Shamel ERP
 *
 * Handles:
 *   1. Provisioning validation before bootstrap
 *   2. Provisioning readiness checks (seeded accounts, settings, CoA)
 *   3. Duplicate bootstrap protection
 *   4. Provisioning audit trail
 *   5. Onboarding checklist (per-company state of each onboarding step)
 *
 * Design rules:
 *   - All provisioning reads are READ-ONLY; mutations live in activation.routes.ts
 *   - All checks scoped to companyId (required for company-scoped checks)
 *   - Each check returns { ok, code, message, details? }
 */

export interface ProvisioningCheck {
  ok: boolean;
  code: string;
  message: string;
  details?: any;
}

export interface ProvisioningReadiness {
  ready: boolean;
  companyId: string;
  checkedAt: string;
  checks: ProvisioningCheck[];
  blockers: ProvisioningCheck[];
  warnings: ProvisioningCheck[];
}

export interface OnboardingStep {
  step: number;
  key: string;
  label: string;
  status: 'complete' | 'incomplete' | 'partial' | 'not_applicable';
  count?: number;
  details?: string;
}

export interface OnboardingChecklist {
  companyId: string;
  checkedAt: string;
  totalSteps: number;
  completedSteps: number;
  readyForOperations: boolean;
  steps: OnboardingStep[];
}

// ─── Provisioning Validation ──────────────────────────────────────────────────

/**
 * Validate that a new company provisioning request is safe to proceed.
 * Called BEFORE creating company/branch/user records.
 */
export function validateProvisioningRequest(body: any): ProvisioningCheck[] {
  const errors: ProvisioningCheck[] = [];

  const username = String(body?.user?.username || '').trim();
  if (!username || username.length < 3) {
    errors.push({ ok: false, code: 'USERNAME_REQUIRED', message: 'اسم المستخدم مطلوب (3 أحرف كحد أدنى).' });
  }

  // Password: minimum 4 characters to match the frontend setup wizard requirement.
  // A minimum of 4 chars is enforced here; encourage longer passwords via UX, not hard validation.
  if (!body?.user?.password || String(body.user.password).length < 4) {
    errors.push({ ok: false, code: 'PASSWORD_TOO_SHORT', message: 'كلمة المرور مطلوبة (4 أحرف كحد أدنى).' });
  }

  // Username character validation: allow ASCII word chars, Arabic letters, dots, dashes, @ signs.
  // \p{L} covers all Unicode letters (Arabic, Latin, etc.) when used with the 'u' flag.
  if (username && !/^[\p{L}\p{N}\w\-.@]+$/u.test(username)) {
    errors.push({ ok: false, code: 'USERNAME_INVALID_CHARS', message: 'اسم المستخدم يحتوي على أحرف غير مسموحة (يُسمح بالأحرف والأرقام والنقطة والشرطة و@).' });
  }

  if (!body?.company?.name || String(body.company.name).trim().length < 2) {
    errors.push({ ok: false, code: 'COMPANY_NAME_REQUIRED', message: 'اسم المؤسسة مطلوب (حرفان كحد أدنى).' });
  }

  const currency = String(body?.settings?.primaryCurrency || body?.settings?.defaultCurrency || 'USD').trim();
  if (!currency || currency.length < 3) {
    errors.push({ ok: false, code: 'CURRENCY_REQUIRED', message: 'رمز العملة الأساسية مطلوب (مثال: USD أو IQD).' });
  }

  return errors;
}

// ─── Provisioning Readiness Check ────────────────────────────────────────────

/**
 * Check the state of a provisioned company — verifies all critical seeded records exist.
 * Called after setup to confirm nothing partial was left.
 */
export function checkProvisioningReadiness(
  db: any,
  companyId: string,
): ProvisioningReadiness {
  if (!companyId) {
    return {
      ready: false,
      companyId,
      checkedAt: new Date().toISOString(),
      checks: [],
      blockers: [{ ok: false, code: 'SCOPE_REQUIRED', message: 'معرف المؤسسة مطلوب.' }],
      warnings: [],
    };
  }

  const checks: ProvisioningCheck[] = [];

  // Company record exists
  const company = db.prepare(`SELECT id, name, is_active FROM companies WHERE id = ?`).get(companyId);
  checks.push(company
    ? { ok: true,  code: 'COMPANY_EXISTS',    message: 'سجل المؤسسة موجود.' }
    : { ok: false, code: 'COMPANY_MISSING',   message: 'سجل المؤسسة غير موجود في قاعدة البيانات.' }
  );
  if (company && !company.is_active) {
    checks.push({ ok: false, code: 'COMPANY_INACTIVE', message: 'المؤسسة موجودة لكنها غير نشطة.' });
  }

  // At least one branch
  const branchRow = db.prepare(`SELECT COUNT(*) AS cnt FROM branches WHERE company_id = ?`).get(companyId);
  const branchCount = Number(branchRow?.cnt || 0);
  checks.push(branchCount > 0
    ? { ok: true,  code: 'BRANCH_EXISTS',   message: `${branchCount} فرع موجود.`, details: { count: branchCount } }
    : { ok: false, code: 'BRANCH_MISSING',  message: 'لا يوجد فرع للمؤسسة.' }
  );

  // At least one admin user
  const userRow = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE company_id = ? AND role = 'admin'`).get(companyId);
  const adminCount = Number(userRow?.cnt || 0);
  checks.push(adminCount > 0
    ? { ok: true,  code: 'ADMIN_USER_EXISTS',  message: `${adminCount} مستخدم إداري موجود.` }
    : { ok: false, code: 'ADMIN_USER_MISSING', message: 'لا يوجد مستخدم بدور admin للمؤسسة.' }
  );

  // At least one warehouse
  const whRow = db.prepare(`SELECT COUNT(*) AS cnt FROM warehouses WHERE company_id = ?`).get(companyId);
  const whCount = Number(whRow?.cnt || 0);
  checks.push(whCount > 0
    ? { ok: true,  code: 'WAREHOUSE_EXISTS',  message: `${whCount} مستودع موجود.`, details: { count: whCount } }
    : { ok: false, code: 'WAREHOUSE_MISSING', message: 'لا يوجد مستودع للمؤسسة.' }
  );

  // At least one cashbox
  const cbRow = db.prepare(`SELECT COUNT(*) AS cnt FROM cash_boxes WHERE company_id = ?`).get(companyId);
  const cbCount = Number(cbRow?.cnt || 0);
  checks.push(cbCount > 0
    ? { ok: true,  code: 'CASHBOX_EXISTS',  message: `${cbCount} صندوق نقدي موجود.`, details: { count: cbCount } }
    : { ok: false, code: 'CASHBOX_MISSING', message: 'لا يوجد صندوق نقدي للمؤسسة.' }
  );

  // Currency settings
  const currencyRow = db.prepare(`
    SELECT value FROM system_settings
    WHERE (key = 'defaultCurrency' OR key = 'primaryCurrency')
      AND company_id = ?
    LIMIT 1
  `).get(companyId);
  checks.push(currencyRow
    ? { ok: true,  code: 'CURRENCY_SET',     message: 'العملة الأساسية مضبوطة.' }
    : { ok: false, code: 'CURRENCY_MISSING', message: 'إعداد العملة الأساسية غير موجود.' }
  );

  // Chart of accounts exists
  const coaRow = db.prepare(`SELECT COUNT(*) AS cnt FROM accounts WHERE company_id = ?`).get(companyId);
  const coaCount = Number(coaRow?.cnt || 0);
  checks.push(coaCount > 0
    ? { ok: true,  code: 'CHART_OF_ACCOUNTS_EXISTS',  message: `${coaCount} حساب موجود في دليل الحسابات.`, details: { count: coaCount } }
    : { ok: false, code: 'CHART_OF_ACCOUNTS_MISSING', message: 'دليل الحسابات فارغ — ابدأ بإنشاء الحسابات.' }
  );

  // Retained earnings account (critical for period close)
  const retainedRow = db.prepare(`
    SELECT id FROM accounts
    WHERE company_id = ? AND (code = '3200' OR lookup_code = '3200') AND is_active = 1
    LIMIT 1
  `).get(companyId);
  checks.push(retainedRow
    ? { ok: true,  code: 'RETAINED_EARNINGS_EXISTS',  message: 'حساب الأرباح المدورة (3200) موجود.' }
    : { ok: false, code: 'RETAINED_EARNINGS_MISSING', message: 'حساب الأرباح المدورة (3200) غير موجود — مطلوب لإقفال الفترات.' }
  );

  // Parties: at least a default cash customer
  const partyRow = db.prepare(`SELECT COUNT(*) AS cnt FROM parties WHERE company_id = ? OR company_id IS NULL`).get(companyId);
  const partyCount = Number(partyRow?.cnt || 0);
  checks.push(partyCount > 0
    ? { ok: true,  code: 'PARTIES_EXIST',    message: `${partyCount} طرف موجود.`, details: { count: partyCount } }
    : { ok: false, code: 'PARTIES_MISSING',  message: 'لا يوجد أي طرف (عميل/مورد) — يُنصح بإضافة عميل نقدي كحد أدنى.' }
  );

  const blockers = checks.filter(c => !c.ok && [
    'COMPANY_MISSING', 'COMPANY_INACTIVE', 'BRANCH_MISSING', 'ADMIN_USER_MISSING',
    'WAREHOUSE_MISSING', 'CASHBOX_MISSING', 'CURRENCY_MISSING',
  ].includes(c.code));

  const warnings = checks.filter(c => !c.ok && !blockers.includes(c));

  return {
    ready: blockers.length === 0,
    companyId,
    checkedAt: new Date().toISOString(),
    checks,
    blockers,
    warnings,
  };
}

// ─── Duplicate Bootstrap Protection ──────────────────────────────────────────

/**
 * Returns true if a company with the given id already has users — indicating
 * that bootstrap has already run for this company.
 */
export function isCompanyAlreadyBootstrapped(db: any, companyId: string): boolean {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE company_id = ?`).get(companyId);
    return Number(row?.cnt || 0) > 0;
  } catch {
    return false;
  }
}

// ─── Onboarding Checklist ─────────────────────────────────────────────────────

/**
 * Returns the full onboarding checklist for a company.
 * Each step is checked against the live database.
 * This is READ-ONLY — never mutates data.
 */
export function buildOnboardingChecklist(
  db: any,
  companyId: string,
): OnboardingChecklist {
  const steps: OnboardingStep[] = [];

  // Step 1: Company created & active
  const company = db.prepare(`SELECT id, name, is_active FROM companies WHERE id = ?`).get(companyId);
  steps.push({
    step: 1,
    key: 'company_created',
    label: 'إنشاء المؤسسة',
    status: company && company.is_active ? 'complete' : (!company ? 'incomplete' : 'partial'),
    details: company ? `${company.name}` : 'المؤسسة غير موجودة',
  });

  // Step 2: Branches created
  const branches: any[] = db.prepare(`SELECT id, name, is_active FROM branches WHERE company_id = ?`).all(companyId);
  const activeBranches = branches.filter((b: any) => b.is_active);
  steps.push({
    step: 2,
    key: 'branches_created',
    label: 'إنشاء الفروع',
    count: activeBranches.length,
    status: activeBranches.length > 0 ? 'complete' : 'incomplete',
    details: activeBranches.length > 0 ? `${activeBranches.length} فرع نشط` : 'لا يوجد فرع',
  });

  // Step 3: Warehouses created
  const whRow = db.prepare(`SELECT COUNT(*) AS cnt FROM warehouses WHERE company_id = ?`).get(companyId);
  const whCount = Number(whRow?.cnt || 0);
  steps.push({
    step: 3,
    key: 'warehouses_created',
    label: 'إنشاء المستودعات',
    count: whCount,
    status: whCount > 0 ? 'complete' : 'incomplete',
    details: whCount > 0 ? `${whCount} مستودع` : 'لا يوجد مستودع',
  });

  // Step 4: Cash boxes created
  const cbRow = db.prepare(`SELECT COUNT(*) AS cnt FROM cash_boxes WHERE company_id = ?`).get(companyId);
  const cbCount = Number(cbRow?.cnt || 0);
  steps.push({
    step: 4,
    key: 'cashboxes_created',
    label: 'إنشاء الصناديق النقدية',
    count: cbCount,
    status: cbCount > 0 ? 'complete' : 'incomplete',
    details: cbCount > 0 ? `${cbCount} صندوق` : 'لا يوجد صندوق نقدي',
  });

  // Step 5: Chart of Accounts
  const coaRow = db.prepare(`SELECT COUNT(*) AS cnt FROM accounts WHERE company_id = ? AND is_active = 1`).get(companyId);
  const coaCount = Number(coaRow?.cnt || 0);
  const retainedRow = db.prepare(`
    SELECT id FROM accounts WHERE company_id = ? AND (code = '3200' OR lookup_code = '3200') AND is_active = 1 LIMIT 1
  `).get(companyId);
  steps.push({
    step: 5,
    key: 'chart_of_accounts',
    label: 'دليل الحسابات',
    count: coaCount,
    status: coaCount > 50 && retainedRow ? 'complete' : coaCount > 0 ? 'partial' : 'incomplete',
    details: coaCount > 0
      ? `${coaCount} حساب${retainedRow ? '، حساب الأرباح المدورة موجود' : '، حساب 3200 مفقود'}`
      : 'دليل الحسابات فارغ',
  });

  // Step 6: Users and roles
  const usersRow = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE company_id = ?`).get(companyId);
  const usersCount = Number(usersRow?.cnt || 0);
  const adminRow = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE company_id = ? AND role = 'admin'`).get(companyId);
  const adminCount = Number(adminRow?.cnt || 0);
  steps.push({
    step: 6,
    key: 'users_roles',
    label: 'المستخدمون والأدوار',
    count: usersCount,
    status: usersCount > 0 && adminCount > 0 ? 'complete' : usersCount > 0 ? 'partial' : 'incomplete',
    details: `${usersCount} مستخدم (${adminCount} مدير)`,
  });

  // Step 7: Opening balances (party transactions)
  const openingRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM party_transactions
    WHERE company_id = ?
  `).get(companyId);
  const openingCount = Number(openingRow?.cnt || 0);
  steps.push({
    step: 7,
    key: 'opening_balances',
    label: 'أرصدة الافتتاح (ذمم)',
    count: openingCount,
    status: openingCount > 0 ? 'complete' : 'not_applicable',
    details: openingCount > 0 ? `${openingCount} معاملة افتتاحية` : 'لم تُدخل أرصدة افتتاح (اختياري)',
  });

  // Step 8: Opening stock (inventory movements of type opening)
  const openStockRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM inventory_movements
    WHERE company_id = ?
      AND (movement_type = 'opening_stock' OR reference_type = 'opening_stock')
  `).get(companyId);
  const openStockCount = Number(openStockRow?.cnt || 0);
  steps.push({
    step: 8,
    key: 'opening_stock',
    label: 'مخزون الافتتاح',
    count: openStockCount,
    status: openStockCount > 0 ? 'complete' : 'not_applicable',
    details: openStockCount > 0 ? `${openStockCount} حركة افتتاحية` : 'لم يُدخل مخزون افتتاح (اختياري)',
  });

  // Step 9: Printers setup
  const printerRow = db.prepare(`SELECT COUNT(*) AS cnt FROM printers WHERE company_id = ?`).get(companyId);
  const printerCount = Number(printerRow?.cnt || 0);
  const printSettingRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'print' AND company_id = ? LIMIT 1`).get(companyId);
  steps.push({
    step: 9,
    key: 'printer_setup',
    label: 'إعداد الطباعة',
    count: printerCount,
    status: printerCount > 0 || printSettingRow ? 'complete' : 'not_applicable',
    details: printerCount > 0 ? `${printerCount} طابعة` : 'لم تُضبط الطابعة (اختياري)',
  });

  // Step 10: Fiscal period exists (for close readiness)
  const periodRow = db.prepare(`SELECT COUNT(*) AS cnt FROM fiscal_periods WHERE company_id = ? AND status = 'open'`).get(companyId);
  const periodCount = Number(periodRow?.cnt || 0);
  steps.push({
    step: 10,
    key: 'fiscal_period',
    label: 'الفترة المالية',
    count: periodCount,
    status: periodCount > 0 ? 'complete' : 'incomplete',
    details: periodCount > 0 ? `${periodCount} فترة مفتوحة` : 'لم تُنشأ فترة مالية — مطلوبة للإقفال الشهري',
  });

  // Step 11: Reporting verification — trial balance has data
  const tbRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.company_id = ? AND je.status = 'posted'
  `).get(companyId);
  const tbCount = Number(tbRow?.cnt || 0);
  steps.push({
    step: 11,
    key: 'reporting_verification',
    label: 'التحقق من التقارير',
    count: tbCount,
    status: tbCount > 0 ? 'complete' : 'not_applicable',
    details: tbCount > 0 ? `${tbCount} سطر محاسبي مرحّل — ميزان المراجعة جاهز` : 'لا توجد قيود مرحّلة بعد',
  });

  // Step 12: First close readiness
  const draftVRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM vouchers WHERE company_id = ? AND UPPER(COALESCE(status, 'DRAFT')) = 'DRAFT'
  `).get(companyId);
  const draftVCount = Number(draftVRow?.cnt || 0);
  steps.push({
    step: 12,
    key: 'close_readiness',
    label: 'جاهزية الإقفال الأول',
    status: draftVCount === 0 && periodCount > 0 ? 'complete' : draftVCount > 0 ? 'partial' : 'incomplete',
    details: draftVCount > 0
      ? `${draftVCount} سند غير مرحّل — يجب معالجته قبل الإقفال`
      : periodCount > 0 ? 'جاهز للإقفال' : 'يتطلب إنشاء فترة مالية أولاً',
  });

  const completedSteps = steps.filter(s => s.status === 'complete').length;
  const criticalSteps = steps.filter(s => ['company_created', 'branches_created', 'warehouses_created',
    'cashboxes_created', 'chart_of_accounts', 'users_roles', 'fiscal_period'].includes(s.key));
  const readyForOperations = criticalSteps.every(s => s.status === 'complete');

  return {
    companyId,
    checkedAt: new Date().toISOString(),
    totalSteps: steps.length,
    completedSteps,
    readyForOperations,
    steps,
  };
}

// ─── Provisioning Stuck State Recovery ───────────────────────────────────────

/**
 * Returns diagnostic info about any potentially stuck provisioning state.
 * A "stuck" state is one where company exists but is missing critical records.
 */
export function diagnoseProvisioningState(
  db: any,
  companyId: string,
): { stuck: boolean; reason: string | null; readiness: ProvisioningReadiness } {
  const readiness = checkProvisioningReadiness(db, companyId);
  const company = db.prepare(`SELECT id FROM companies WHERE id = ?`).get(companyId);

  if (!company) {
    return { stuck: false, reason: null, readiness };
  }

  if (readiness.blockers.length > 0) {
    return {
      stuck: true,
      reason: `مؤسسة موجودة لكن تفتقر لـ: ${readiness.blockers.map(b => b.code).join(', ')}`,
      readiness,
    };
  }

  return { stuck: false, reason: null, readiness };
}
