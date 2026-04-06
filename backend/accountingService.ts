import { sql, eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { db as database } from './db';
import { DEFAULT_COMPANY_ID } from './lib/tenantScope';

export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';

export type PartyEvent =
  | 'sale_invoice'
  | 'purchase_invoice'
  | 'return'
  | 'exchange'
  | 'receipt'
  | 'payment'
  | 'refund'
  | 'refund_to_customer'
  | 'refund_from_supplier'
  | 'opening_balance'
  | 'transfer_in'
  | 'transfer_out';

export type PaymentTerm = 'cash' | 'credit';

const normalizeUpper = (value?: string) => String(value || '').trim().toUpperCase();

export const normalizePartyType = (value?: string): PartyType => {
  const v = normalizeUpper(value);
  if (v === 'SUPPLIER') return 'SUPPLIER';
  if (v === 'BOTH') return 'BOTH';
  return 'CUSTOMER';
};

export const normalizePaymentTerm = (value?: string): PaymentTerm => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'credit' || v === 'ajel' || v === 'آجل') return 'credit';
  return 'cash';
};

export const roundMoney = (value: number, decimals = 2) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

const normalizeTenantId = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

export const ledgerIdForRef = (refId?: string) => {
  if (!refId) return `pt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return `pt-${refId}`;
};

export const computePartyDelta = (params: {
  partyType?: string;
  event: PartyEvent;
  paymentTerm?: string;
  entryType?: string;
  totalOrAmount: number;
}): number => {
  const partyType = normalizePartyType(params.partyType);
  const amount = roundMoney(Math.abs(Number(params.totalOrAmount || 0)));
  if (!amount) return 0;

  const event = String(params.event || '').toLowerCase();
  const paymentTerm = normalizePaymentTerm(params.paymentTerm);
  const isCredit = paymentTerm === 'credit';
  let delta = 0;

  if (event === 'sale_invoice') delta = isCredit ? amount : 0;
  else if (event === 'purchase_invoice') delta = isCredit ? amount : 0;
  else if (event === 'return' || event === 'exchange') delta = isCredit ? -amount : 0;
  else if (event === 'transfer_out') delta = -amount;
  else if (event === 'transfer_in') delta = amount;
  else if (event === 'opening_balance') {
    const entryType = String(params.entryType || '').toLowerCase();
    const isDebit = entryType === 'debit';
    if (!entryType) return 0;
    delta = partyType === 'SUPPLIER'
      ? (isDebit ? -amount : amount)
      : (isDebit ? amount : -amount);
  } else if (event === 'receipt') {
    delta = partyType === 'SUPPLIER' ? amount : -amount;
  } else if (event === 'payment') {
    delta = partyType === 'SUPPLIER' ? -amount : amount;
  } else if (event === 'refund' || event === 'refund_to_customer') {
    delta = amount;
  } else if (event === 'refund_from_supplier') {
    delta = amount;
  }

  const guard = (condition: boolean, message: string) => {
    if (!condition) return;
    const details = { partyType, event, paymentTerm, amount, delta };
    console.error(`[ledger] ${message}`, details);
    throw new Error(message);
  };

  // Sanity assertions for sign conventions
  guard(partyType === 'SUPPLIER' && event === 'purchase_invoice' && isCredit && delta < 0, 'Invalid delta: supplier purchase credit must be positive.');
  guard(partyType === 'CUSTOMER' && event === 'sale_invoice' && isCredit && delta < 0, 'Invalid delta: customer sale credit must be positive.');
  guard(partyType === 'CUSTOMER' && event === 'receipt' && delta > 0, 'Invalid delta: customer receipt must be negative.');
  guard(partyType === 'SUPPLIER' && event === 'payment' && delta > 0, 'Invalid delta: supplier payment must be negative.');

  return delta;
};

export const applyPartyTransaction = async (
  tx: any,
  input: {
    id?: string;
    companyId?: string | null;
    branchId?: string | null;
    partyId: string;
    partyType?: string;
    kind: string;
    refId?: string;
    amount: number;
    delta: number;
    currency?: string | null;
    amountBase?: number;
    deltaBase?: number;
    amountTransaction?: number;
    deltaTransaction?: number;
    exchangeRate?: number;
    createdAt?: string;
    allowZero?: boolean;
  }
) => {
  if (!input.partyId) {
    throw new Error('Missing partyId for ledger entry.');
  }
  const party = await tx
    .select({
      id: schema.parties.id,
      companyId: schema.parties.companyId,
    })
    .from(schema.parties)
    .where(eq(schema.parties.id, input.partyId))
    .get();
  if (!party) {
    throw new Error('PARTY_NOT_FOUND_FOR_LEDGER_ENTRY');
  }
  const amountBase = roundMoney(Math.abs(Number(input.amountBase ?? input.amount ?? 0)));
  const amountTransaction = roundMoney(Math.abs(Number(input.amountTransaction ?? input.amount ?? 0)));
  const amount = amountBase;
  if (input.delta === null || input.delta === undefined || Number.isNaN(Number(input.delta))) {
    throw new Error('Missing delta for ledger entry.');
  }
  const deltaBase = roundMoney(Number(input.deltaBase ?? input.delta ?? 0));
  const deltaTransaction = roundMoney(Number(input.deltaTransaction ?? input.delta ?? 0));
  const delta = deltaBase;
  if (!Number.isFinite(delta)) {
    throw new Error('Invalid delta for ledger entry.');
  }
  const id = input.id || ledgerIdForRef(input.refId);
  const createdAt = input.createdAt || new Date().toISOString();
  const currency = String(input.currency || '').trim();
  const exchangeRate = Number(input.exchangeRate || 1) > 0 ? Number(input.exchangeRate || 1) : 1;
  if (!currency) {
    throw new Error('Missing currency for ledger entry.');
  }

  const existing = await tx
    .select()
    .from(schema.partyTransactions)
    .where(eq(schema.partyTransactions.id, id))
    .get();
  if (existing) return;

  await tx.insert(schema.partyTransactions)
    .values({
      id,
      companyId: input.companyId ?? party.companyId ?? null,
      branchId: input.branchId ?? null,
      partyId: input.partyId,
      partyType: input.partyType ? normalizePartyType(input.partyType) : null,
      kind: input.kind,
      refId: input.refId,
      amount,
      delta,
      currency,
      amountBase,
      deltaBase,
      amountTransaction,
      deltaTransaction,
      exchangeRate,
      createdAt,
    })
    .run();

  if (delta === 0 && amount !== 0 && !input.allowZero) {
    console.warn(`[ledger] zero-delta entry for party ${input.partyId}`, {
      id,
      kind: input.kind,
      refId: input.refId,
      amount,
      delta,
      currency,
    });
  }

  if (delta !== 0) {
    await tx.update(schema.parties)
      .set({ balance: sql`${schema.parties.balance} + ${delta}` })
      .where(eq(schema.parties.id, input.partyId))
      .run();
  }
};

export const deletePartyTransactionByRef = async (tx: any, refId?: string) => {
  if (!refId) return;
  await tx.delete(schema.partyTransactions)
    .where(eq(schema.partyTransactions.refId, refId))
    .run();
};

export const deletePartyTransactionById = async (tx: any, id?: string) => {
  if (!id) return;
  await tx.delete(schema.partyTransactions)
    .where(eq(schema.partyTransactions.id, id))
    .run();
};

export const recomputePartyBalance = async (tx: any, partyId: string) => {
  if (!partyId) return 0;
  const row = await tx
    .select({ sum: sql<number>`coalesce(sum(coalesce(${schema.partyTransactions.deltaBase}, ${schema.partyTransactions.delta})), 0)` })
    .from(schema.partyTransactions)
    .where(eq(schema.partyTransactions.partyId, partyId))
    .get();
  const sum = roundMoney(Number(row?.sum || 0));
  await tx.update(schema.parties).set({ balance: sum }).where(eq(schema.parties.id, partyId)).run();
  return sum;
};

// ----------------------------
// Journal Entry Engine
// ----------------------------



export const normalizeAccountLogicalCode = (value?: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const markerIndex = raw.indexOf('::');
  return markerIndex >= 0 ? raw.slice(markerIndex + 2).trim() : raw;
};

export const getAccountLogicalCode = (account: any) =>
  normalizeAccountLogicalCode(account?.lookupCode || account?.code || '');

export const buildCompanyAccountStorageCode = (companyId: string | null | undefined, code: string) => {
  const logicalCode = normalizeAccountLogicalCode(code);
  if (!logicalCode) return '';
  const normalizedCompanyId = normalizeTenantId(companyId);
  if (!normalizedCompanyId || normalizedCompanyId === DEFAULT_COMPANY_ID) {
    return logicalCode;
  }
  return `${normalizedCompanyId}::${logicalCode}`;
};

const accountCache = new Map<string, number>();

export const SYSTEM_ACCOUNTS = {
  CASH: '1110',
  BANK: '1120',
  RECEIVABLE: '1130',
  INVENTORY: '1140',
  ADVANCES: '1160',
  PAYABLE: '2110',
  TAX_PAYABLE: '2140',
  SALARY_PAYABLE: '2150',
  SOCIAL_INSURANCE: '2160',
  CAPITAL: '3100',
  RETAINED: '3200',
  OPENING_OFFSET: '3210', // حساب فروقات الأرصدة الافتتاحية
  SALES: '4100',
  SALES_DISCOUNT: '4400',
  SALES_RETURN: '4500',
  OTHER_REVENUE: '4300',
  COGS: '5100',
  SALARIES: '5200',
  MISC_EXPENSE: '5800',
  PURCHASE_DISCOUNT: '5900',
  // Temporary clearing account for landed costs (customs, freight, transport, labor, etc.)
  // Credited when inventory is received with extra costs; will be settled separately
  LANDED_COST_CLEARING: '2125',
  // FX difference accounts — posted as separate journal entries at settlement time
  FX_GAIN: '4310',   // أرباح فروقات العملة المحققة (realized at settlement)
  FX_LOSS: '5810',   // خسائر فروقات العملة المحققة (realized at settlement)
  FX_GAIN_UNREALIZED: '4315', // أرباح فروقات العملة غير المحققة (revaluation — auto-reversed)
  FX_LOSS_UNREALIZED: '5815', // خسائر فروقات العملة غير المحققة (revaluation — auto-reversed)
  RECON_GAIN: '4320',  // أرباح تسوية الحسابات — reconciliation write-off gain
  RECON_LOSS: '5820',  // خسائر تسوية الحسابات — reconciliation write-off loss
  // Period closing accounts
  CURRENT_YEAR_EARNINGS: '3300', // أرباح العام الحالي (interim; zeroed at period close)
} as const;

export async function createPartySubAccount(
  db: any,
  partyName: string,
  partyType: 'customer' | 'supplier',
  partyId: string,
  companyId?: string | null,
): Promise<number> {
  const partyCompany = !companyId && partyId
    ? await db.select({ companyId: schema.parties.companyId })
      .from(schema.parties)
      .where(eq(schema.parties.id, partyId))
      .get()
    : null;
  const resolvedCompanyId = normalizeTenantId(companyId) || normalizeTenantId(partyCompany?.companyId);
  if (!resolvedCompanyId) {
    throw new Error('PARTY_COMPANY_ID_REQUIRED');
  }
  const parentCode = partyType === 'customer' ? SYSTEM_ACCOUNTS.RECEIVABLE : SYSTEM_ACCOUNTS.PAYABLE;
  let parentAccountId: number;
  try {
    parentAccountId = await resolveAccountByCode(db, parentCode, resolvedCompanyId);
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (message.startsWith('ACCOUNT_CODE_NOT_FOUND:')) {
      const { seedAccountsForCompany } = await import('./db/companyAccountSeed');
      await seedAccountsForCompany(db, resolvedCompanyId);
      parentAccountId = await resolveAccountByCode(db, parentCode, resolvedCompanyId);
    } else {
      throw error;
    }
  }
  const parentAccount = await db.select().from(schema.accounts).where(eq(schema.accounts.id, parentAccountId)).get();
  if (!parentAccount) {
    throw new Error(`PARENT_ACCOUNT_NOT_FOUND:${parentCode}`);
  }

  const numericSuffix = String(partyId || '')
    .replace(/\D/g, '')
    .slice(-6)
    .padStart(3, '0');
  const subCode = `${parentCode}-${numericSuffix}`;
  const storageCode = buildCompanyAccountStorageCode(resolvedCompanyId, subCode);

  const existing = await db.select().from(schema.accounts)
    .where(sql`
      ${schema.accounts.companyId} = ${resolvedCompanyId}
      AND (
        ${schema.accounts.lookupCode} = ${subCode}
        OR ${schema.accounts.code} = ${subCode}
        OR ${schema.accounts.code} = ${storageCode}
      )
    `)
    .get();
  if (existing?.id) return Number(existing.id);

  await db.insert(schema.accounts).values({
    companyId: resolvedCompanyId,
    code: storageCode,
    lookupCode: subCode,
    nameAr: partyName || `حساب ${partyType === 'customer' ? 'عميل' : 'مورد'}`,
    nameEn: null,
    parentId: parentAccount.id,
    level: Number(parentAccount.level || 1) + 1,
    accountType: parentAccount.accountType,
    accountNature: parentAccount.accountNature,
    isParent: false,
    isActive: true,
    isSystem: false,
    currencyCode: 'SYP',
    notes: `Auto generated party account for ${partyId}`,
  }).run();

  if (!parentAccount.isParent) {
    await db.update(schema.accounts)
      .set({ isParent: true, updatedAt: new Date().toISOString() })
      .where(eq(schema.accounts.id, parentAccount.id))
      .run();
  }

  const created = await db.select().from(schema.accounts)
    .where(sql`
      ${schema.accounts.companyId} = ${resolvedCompanyId}
      AND (
        ${schema.accounts.lookupCode} = ${subCode}
        OR ${schema.accounts.code} = ${storageCode}
      )
    `)
    .get();
  const accountId = Number(created?.id || 0);
  if (!accountId) throw new Error('FAILED_TO_CREATE_PARTY_ACCOUNT');
  return accountId;
}

export async function resolveAccountByCode(db: any, code: string, companyId?: string | null): Promise<number> {
  const normalized = normalizeAccountLogicalCode(code);
  if (!normalized) throw new Error('ACCOUNT_CODE_EMPTY');
  const normalizedCompanyId = normalizeTenantId(companyId);
  const cacheKey = `${normalizedCompanyId || '*'}::${normalized}`;
  if (accountCache.has(cacheKey)) return accountCache.get(cacheKey)!;
  const storageCode = buildCompanyAccountStorageCode(normalizedCompanyId, normalized);
  const rows = await db.select({
      id: schema.accounts.id,
      companyId: schema.accounts.companyId,
    })
    .from(schema.accounts)
    .where(
      normalizedCompanyId
        ? sql`
            ${schema.accounts.companyId} = ${normalizedCompanyId}
            AND (
              ${schema.accounts.lookupCode} = ${normalized}
              OR ${schema.accounts.code} = ${normalized}
              OR ${schema.accounts.code} = ${storageCode}
            )
          `
        : sql`
            ${schema.accounts.lookupCode} = ${normalized}
            OR ${schema.accounts.code} = ${normalized}
          `
    )
    .all();
  if (!rows?.length) throw new Error(`ACCOUNT_CODE_NOT_FOUND:${normalized}`);
  if (!normalizedCompanyId) {
    const companyIds = Array.from(new Set(
      rows.map((row: any) => normalizeTenantId(row?.companyId)).filter(Boolean) as string[]
    ));
    if (companyIds.length > 1) {
      throw new Error(`ACCOUNT_CODE_AMBIGUOUS:${normalized}`);
    }
  }
  const row = rows[0];
  accountCache.set(cacheKey, row.id);
  return row.id;
}

const normalizeMoney = (value: number, decimals = 2) => roundMoney(value, decimals);

const ensureBalanced = (lines: { debit: number; credit: number }[]) => {
  const totalDebit = normalizeMoney(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCredit = normalizeMoney(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  if (totalDebit !== totalCredit) {
    throw new Error(`UNBALANCED_ENTRY: debit=${totalDebit} credit=${totalCredit}`);
  }
  return { totalDebit, totalCredit };
};

const ensureAccountsValid = async (tx: any, accountIds: number[], companyId?: string | null) => {
  const uniqueIds = Array.from(new Set(accountIds.filter(Boolean)));
  if (uniqueIds.length === 0) return normalizeTenantId(companyId);
  const rows = await tx
    .select({
      id: schema.accounts.id,
      companyId: schema.accounts.companyId,
      isParent: schema.accounts.isParent,
      isActive: schema.accounts.isActive
    })
    .from(schema.accounts)
    .where(sql`${schema.accounts.id} IN (${sql.join(uniqueIds, sql`, `)})`)
    .all();
  const byId = new Map<number, { id: number; companyId: string | null; isParent: boolean; isActive: boolean }>(
    rows.map((r: any) => [Number(r.id), {
      id: Number(r.id),
      companyId: normalizeTenantId(r.companyId),
      isParent: Boolean(r.isParent),
      isActive: Boolean(r.isActive),
    }])
  );
  const expectedCompanyId = normalizeTenantId(companyId);
  const discoveredCompanyIds = new Set<string>();
  for (const id of uniqueIds) {
    const acc = byId.get(id);
    if (!acc) throw new Error(`ACCOUNT_NOT_FOUND:${id}`);
    if (!acc.companyId) throw new Error(`ACCOUNT_WITHOUT_COMPANY:${id}`);
    discoveredCompanyIds.add(acc.companyId);
    if (expectedCompanyId && acc.companyId !== expectedCompanyId) {
      throw new Error(`ACCOUNT_OUTSIDE_COMPANY:${id}`);
    }
    if (acc.isParent) throw new Error(`ACCOUNT_IS_PARENT:${id}`);
    if (!acc.isActive) throw new Error(`ACCOUNT_INACTIVE:${id}`);
  }
  if (!expectedCompanyId && discoveredCompanyIds.size > 1) {
    throw new Error('CROSS_COMPANY_ACCOUNT_SET');
  }
  return expectedCompanyId || Array.from(discoveredCompanyIds)[0] || null;
};

const nextEntryNumber = (now = new Date()) => {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `JE-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
};

export const createJournalEntry = async (data: {
  description: string;
  referenceType: string;
  referenceId?: number | null;
  lines: Array<{
    accountId: number;
    debit: number;
    credit: number;
    description?: string;
    partyId?: number | null;
    partnerRefId?: string | null;
    currencyCode?: string;
    exchangeRate?: number;
    amountInCurrency?: number;
  }>;
  branchId?: string | null;
  companyId?: string | null;
  currencyCode?: string;
  entryDate?: string;
  createdBy?: number | null;
  /** Set true to bypass period-lock check (e.g. the closing entry itself) */
  bypassPeriodLock?: boolean;
}) => {
  const db = database as any;
  const lines = data.lines || [];
  const sanitizedLines = lines
    .map((l) => ({
      ...l,
      debit: normalizeMoney(Number(l.debit || 0)),
      credit: normalizeMoney(Number(l.credit || 0)),
    }))
    .filter((l) => !(l.debit === 0 && l.credit === 0));

  for (const line of sanitizedLines) {
    if (line.debit > 0 && line.credit > 0) {
      throw new Error(`INVALID_LINE_BOTH_DR_CR:${line.accountId}`);
    }
  }

  const { totalDebit, totalCredit } = ensureBalanced(sanitizedLines);
  const resolvedCompanyId = await ensureAccountsValid(db, sanitizedLines.map((l) => l.accountId), data.companyId);

  // Period-lock guard: reject posting to a closed fiscal period
  if (!data.bypassPeriodLock && data.referenceType !== 'period_closing' && data.referenceType !== 'carry_forward') {
    const entryDateStr = data.entryDate ? String(data.entryDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    try {
      const allPeriods = await db.select().from(schema.fiscalPeriods).all();
      for (const period of allPeriods) {
        if (resolvedCompanyId && String(period.companyId || '') !== String(resolvedCompanyId)) continue;
        if (period.status !== 'closed') continue;
        const start = String(period.startDate || '').slice(0, 10);
        const end = String(period.endDate || '').slice(0, 10);
        if (entryDateStr >= start && entryDateStr <= end) {
          throw new Error(`PERIOD_LOCKED: لا يمكن الترحيل في فترة مالية مغلقة "${period.name}" (${start} → ${end}). استخدم إعادة فتح الفترة إذا كنت تمتلك الصلاحية.`);
        }
      }
    } catch (err: any) {
      if (String(err?.message || '').startsWith('PERIOD_LOCKED')) throw err;
      // DB error reading periods — non-fatal, proceed
    }
  }
  const entryDate = data.entryDate || new Date().toISOString();
  const entryNumber = nextEntryNumber();

  return db.transaction(async (tx: any) => {
    const entry = await tx.insert(schema.journalEntries).values({
      companyId: resolvedCompanyId || null,
      entryNumber,
      entryDate,
      description: data.description,
      referenceType: data.referenceType,
      referenceId: data.referenceId || null,
      totalDebit,
      totalCredit,
      currencyCode: data.currencyCode || 'SYP',
      exchangeRate: 1,
      status: 'draft',
      branchId: data.branchId || null,
      createdBy: data.createdBy || null,
      createdAt: new Date().toISOString(),
    }).returning().get();

    for (const line of sanitizedLines) {
      await tx.insert(schema.journalEntryLines).values({
        companyId: resolvedCompanyId || null,
        journalEntryId: entry.id,
        accountId: line.accountId,
        debit: normalizeMoney(Number(line.debit || 0)),
        credit: normalizeMoney(Number(line.credit || 0)),
        currencyCode: line.currencyCode || data.currencyCode || 'SYP',
        exchangeRate: line.exchangeRate || 1,
        amountInCurrency: line.amountInCurrency !== undefined ? normalizeMoney(Number(line.amountInCurrency || 0)) : normalizeMoney(Number(line.debit || 0) + Number(line.credit || 0)),
        description: line.description || null,
        partyId: line.partyId || null,
        partnerRefId: line.partnerRefId ? String(line.partnerRefId) : null,
        costCenterId: null,
      }).run();
    }

    return entry;
  });
};

export const postJournalEntry = async (entryId: number) => {
  const db = database as any;
  return db.transaction(async (tx: any) => {
    const entry = await tx.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
    if (!entry) throw new Error('ENTRY_NOT_FOUND');
    if (entry.status === 'posted') return;

    const lines = await tx.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.journalEntryId, entryId)).all();
    const { totalDebit, totalCredit } = ensureBalanced(lines.map((l: any) => ({ debit: l.debit, credit: l.credit })));
    const resolvedCompanyId = normalizeTenantId(entry.companyId) || await ensureAccountsValid(tx, lines.map((l: any) => Number(l.accountId || 0)));
    if (totalDebit !== entry.totalDebit || totalCredit !== entry.totalCredit) {
      await tx.update(schema.journalEntries).set({ totalDebit, totalCredit }).where(eq(schema.journalEntries.id, entryId)).run();
    }

    // Update account balances (periodKey = YYYY-MM)
    const periodKey = String(entry.entryDate || '').slice(0, 7) || 'opening';
    for (const line of lines) {
      const debit = normalizeMoney(Number(line.debit || 0));
      const credit = normalizeMoney(Number(line.credit || 0));
      const lineCompanyId = normalizeTenantId(line.companyId) || normalizeTenantId(resolvedCompanyId as any);
      if (!lineCompanyId) {
        throw new Error(`ACCOUNT_BALANCE_COMPANY_REQUIRED:${entryId}`);
      }
      const existing = await tx.select().from(schema.accountBalances)
        .where(sql`
          ${schema.accountBalances.companyId} = ${lineCompanyId}
          AND ${schema.accountBalances.accountId} = ${line.accountId}
          AND ${schema.accountBalances.periodKey} = ${periodKey}
        `)
        .get();
      if (existing) {
        const newDebit = normalizeMoney(Number(existing.debitTotal || 0) + debit);
        const newCredit = normalizeMoney(Number(existing.creditTotal || 0) + credit);
        const newBalance = normalizeMoney(newDebit - newCredit);
        await tx.update(schema.accountBalances)
          .set({ debitTotal: newDebit, creditTotal: newCredit, balance: newBalance })
          .where(eq(schema.accountBalances.id, existing.id))
          .run();
      } else {
        await tx.insert(schema.accountBalances).values({
          companyId: lineCompanyId,
          accountId: line.accountId,
          periodKey,
          debitTotal: debit,
          creditTotal: credit,
          balance: normalizeMoney(debit - credit),
          currencyCode: line.currencyCode || 'SYP',
        }).run();
      }
    }

    await tx.update(schema.journalEntries)
      .set({ status: 'posted', postedAt: new Date().toISOString() })
      .where(eq(schema.journalEntries.id, entryId))
      .run();
  });
};

export const reverseJournalEntry = async (entryId: number, reason: string) => {
  const db = database as any;
  const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
  if (!entry) throw new Error('ENTRY_NOT_FOUND');

  const lines = await db.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.journalEntryId, entryId)).all();
  const reversedLines = lines.map((l: any) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    description: `عكس قيد: ${reason || ''}`.trim(),
    partyId: l.partyId || null,
    partnerRefId: l.partnerRefId ? String(l.partnerRefId) : null,
    currencyCode: l.currencyCode || entry.currencyCode || 'SYP',
    exchangeRate: l.exchangeRate || 1,
  }));

  const reversed = await createJournalEntry({
    description: `قيد عكسي للقيد رقم ${entry.entryNumber}`,
    referenceType: 'reverse',
    referenceId: entryId,
    lines: reversedLines,
    branchId: entry.branchId || null,
    companyId: entry.companyId || null,
    currencyCode: entry.currencyCode || 'SYP',
  });
  await postJournalEntry(reversed.id);
  return reversed;
};

export const getAccountBalance = async (accountId: number, fromDate?: string, toDate?: string) => {
  const db = database as any;
  const account = await db.select({ id: schema.accounts.id, companyId: schema.accounts.companyId })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();
  const companyId = normalizeTenantId(account?.companyId);
  if (!companyId) throw new Error(`ACCOUNT_WITHOUT_COMPANY:${accountId}`);
  if (!fromDate && !toDate) {
    const rows = await db.select().from(schema.accountBalances)
      .where(sql`${schema.accountBalances.companyId} = ${companyId} AND ${schema.accountBalances.accountId} = ${accountId}`)
      .all();
    const debit = normalizeMoney(rows.reduce((s: number, r: any) => s + Number(r.debitTotal || 0), 0));
    const credit = normalizeMoney(rows.reduce((s: number, r: any) => s + Number(r.creditTotal || 0), 0));
    return { accountId, debitTotal: debit, creditTotal: credit, balance: normalizeMoney(debit - credit) };
  }

  const lines = await db.select().from(schema.journalEntryLines)
    .where(eq(schema.journalEntryLines.accountId, accountId))
    .all();

  const filtered: any[] = [];
  for (const line of lines) {
    const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, line.journalEntryId)).get();
    if (!entry) continue;
    if (String(entry.companyId || '') !== companyId) continue;
    const d = String(entry.entryDate || '');
    if (fromDate && d < fromDate) continue;
    if (toDate && d > toDate) continue;
    if (entry.status !== 'posted') continue;
    filtered.push(line);
  }

  const debit = normalizeMoney(filtered.reduce((s: number, r: any) => s + Number(r.debit || 0), 0));
  const credit = normalizeMoney(filtered.reduce((s: number, r: any) => s + Number(r.credit || 0), 0));
  return { accountId, debitTotal: debit, creditTotal: credit, balance: normalizeMoney(debit - credit) };
};

export const getAccountStatement = async (accountId: number, fromDate: string, toDate: string) => {
  const db = database as any;
  const account = await db.select({ id: schema.accounts.id, companyId: schema.accounts.companyId })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();
  const companyId = normalizeTenantId(account?.companyId);
  if (!companyId) throw new Error(`ACCOUNT_WITHOUT_COMPANY:${accountId}`);
  const lines = await db.select().from(schema.journalEntryLines)
    .where(eq(schema.journalEntryLines.accountId, accountId))
    .all();
  const result = [];
  for (const line of lines) {
    const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, line.journalEntryId)).get();
    if (!entry) continue;
    if (String(entry.companyId || '') !== companyId) continue;
    const d = String(entry.entryDate || '');
    if (d < fromDate || d > toDate) continue;
    if (entry.status !== 'posted') continue;
    result.push({
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      description: entry.description,
      debit: line.debit,
      credit: line.credit,
      balanceDelta: normalizeMoney(Number(line.debit || 0) - Number(line.credit || 0)),
    });
  }
  return result;
};

export const getTrialBalance = async (asOfDate: string, companyId?: string | null) => {
  const db = database as any;
  const normalizedCompanyId = normalizeTenantId(companyId);
  const entries = await db.select().from(schema.journalEntries).all();
  const postedIds = new Set(entries
    .filter((e: any) =>
      e.status === 'posted'
      && String(e.entryDate || '') <= asOfDate
      && (!normalizedCompanyId || String(e.companyId || '') === normalizedCompanyId)
    )
    .map((e: any) => e.id));
  const lines = await db.select().from(schema.journalEntryLines).all();
  const byAccount = new Map<number, { debit: number; credit: number }>();
  for (const line of lines) {
    if (!postedIds.has(line.journalEntryId)) continue;
    const prev = byAccount.get(line.accountId) || { debit: 0, credit: 0 };
    prev.debit += Number(line.debit || 0);
    prev.credit += Number(line.credit || 0);
    byAccount.set(line.accountId, prev);
  }
  const accounts = (await db.select().from(schema.accounts).all())
    .filter((a: any) => !normalizedCompanyId || String(a.companyId || '') === normalizedCompanyId);
  return accounts.map((a: any) => {
    const totals = byAccount.get(a.id) || { debit: 0, credit: 0 };
    return {
      accountId: a.id,
      code: getAccountLogicalCode(a),
      nameAr: a.nameAr,
      accountType: a.accountType,
      debit: normalizeMoney(totals.debit),
      credit: normalizeMoney(totals.credit),
      balance: normalizeMoney(totals.debit - totals.credit),
    };
  });
};
