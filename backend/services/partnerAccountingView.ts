import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db as database } from '../db';
import * as schema from '../db/schema';
import { getAccountLogicalCode, roundMoney, SYSTEM_ACCOUNTS } from '../accountingService';

export interface PartnerAccountingScope {
  companyId: string;
  branchId?: string | null;
}

export interface PartnerAccountingRange {
  from: string;
  to: string;
}

type CoverageLevel = 'full' | 'partial' | 'none';

type PartyAccountRole = 'receivable' | 'payable' | 'fallback';

interface PartnerAccountLink {
  role: PartyAccountRole;
  accountId: number;
  code: string;
  storageCode: string;
  nameAr: string;
  accountType: string;
  accountNature: string;
}

interface AccountingLedgerLine {
  journalEntryId: number;
  journalLineId: number;
  entryDate: string;
  entryNumber: string;
  referenceType: string;
  referenceId: number | null;
  description: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  role: PartyAccountRole;
  debit: number;
  credit: number;
  delta: number;
  runningBalance: number;
  journalPartyId: string | null;
  journalPartnerRefId: string | null;
  textLinked: boolean;
}

const db = database as any;

const normalizeNumericId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const dateKey = (value: unknown) => normalizeText(value).slice(0, 10);

const balanceDeltaForAccount = (account: any, debit: number, credit: number) => {
  const nature = normalizeText(account?.accountNature || '').toLowerCase();
  return nature === 'credit' ? roundMoney(credit - debit) : roundMoney(debit - credit);
};

const classifyCoverageLevel = (linked: number, total: number): CoverageLevel => {
  if (total <= 0 || linked <= 0) return 'none';
  if (linked >= total) return 'full';
  return 'partial';
};

const classifyAccountRole = (
  accountId: number,
  account: any,
  party: any,
): PartyAccountRole => {
  const arAccountId = normalizeNumericId(party?.arAccountId);
  const apAccountId = normalizeNumericId(party?.apAccountId);
  const genericAccountId = normalizeNumericId(party?.accountId);
  if (arAccountId && accountId === arAccountId) return 'receivable';
  if (apAccountId && accountId === apAccountId) return 'payable';
  const code = getAccountLogicalCode(account);
  if (code === SYSTEM_ACCOUNTS.RECEIVABLE || code.startsWith(`${SYSTEM_ACCOUNTS.RECEIVABLE}-`)) return 'receivable';
  if (code === SYSTEM_ACCOUNTS.PAYABLE || code.startsWith(`${SYSTEM_ACCOUNTS.PAYABLE}-`)) return 'payable';
  if (genericAccountId && accountId === genericAccountId) return 'fallback';
  return 'fallback';
};

const loadScopedParty = async (partyId: string, scope: PartnerAccountingScope) => {
  const party = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get();
  if (!party) return null;
  if (normalizeText((party as any).companyId) !== scope.companyId) return null;
  return party;
};

const loadPartyAccountLinks = async (party: any, companyId: string): Promise<PartnerAccountLink[]> => {
  const candidateIds = Array.from(new Set(
    [
      normalizeNumericId((party as any)?.accountId),
      normalizeNumericId((party as any)?.arAccountId),
      normalizeNumericId((party as any)?.apAccountId),
    ].filter((value): value is number => Number.isFinite(Number(value)) && Number(value) > 0),
  ));
  if (candidateIds.length === 0) return [];

  const accountRows = await db.select().from(schema.accounts).where(
    and(
      eq(schema.accounts.companyId, companyId),
      inArray(schema.accounts.id, candidateIds),
    ),
  ).all();

  return accountRows.map((account: any) => {
    const role = classifyAccountRole(Number(account.id), account, party);
    return {
      role,
      accountId: Number(account.id),
      code: getAccountLogicalCode(account),
      storageCode: String(account.code || ''),
      nameAr: String(account.nameAr || ''),
      accountType: String(account.accountType || ''),
      accountNature: String(account.accountNature || ''),
    };
  });
};

const loadPostedJournalDataForPartyAccounts = async (
  companyId: string,
  accountIds: number[],
  branchId?: string | null,
) => {
  if (accountIds.length === 0) {
    return { entriesById: new Map<number, any>(), lines: [] as any[] };
  }

  const entryRows = await db.select().from(schema.journalEntries).where(
    branchId
      ? and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.branchId, branchId),
          eq(schema.journalEntries.status, 'posted'),
        )
      : and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.status, 'posted'),
        ),
  ).all();
  const entriesById = new Map<number, any>(entryRows.map((entry: any) => [Number(entry.id), entry]));
  const lineRows = await db.select().from(schema.journalEntryLines).where(
    and(
      eq(schema.journalEntryLines.companyId, companyId),
      inArray(schema.journalEntryLines.accountId, accountIds),
    ),
  ).all();
  const lines = lineRows.filter((line: any) => entriesById.has(Number(line.journalEntryId)));
  return { entriesById, lines };
};

const computeOperationalBalance = async (
  partyId: string,
  scope: PartnerAccountingScope,
) => {
  const rows = await db.select().from(schema.partyTransactions).where(
    scope.branchId
      ? and(
          eq(schema.partyTransactions.companyId, scope.companyId),
          eq(schema.partyTransactions.branchId, scope.branchId),
          eq(schema.partyTransactions.partyId, partyId),
        )
      : and(
          eq(schema.partyTransactions.companyId, scope.companyId),
          eq(schema.partyTransactions.partyId, partyId),
        ),
  ).all();
  return roundMoney(rows.reduce((sum: number, row: any) => sum + Number(row.deltaBase ?? row.delta ?? 0), 0));
};

const invoiceExposureBase = (invoice: any) => {
  const type = normalizeText((invoice as any)?.type).toLowerCase();
  if (type === 'purchase') {
    const goodsSubtotal = Number((invoice as any)?.goodsSubtotal ?? (invoice as any)?.goods_subtotal);
    if (Number.isFinite(goodsSubtotal) && goodsSubtotal >= 0) return roundMoney(goodsSubtotal);
  }
  return roundMoney(Number((invoice as any)?.totalAmountBase ?? (invoice as any)?.totalAmount ?? 0));
};

const expectedRolesForPartyType = (partyType: string): Array<'receivable' | 'payable'> => {
  const normalized = normalizeText(partyType).toUpperCase();
  if (normalized === 'SUPPLIER') return ['payable'];
  if (normalized === 'BOTH') return ['receivable', 'payable'];
  return ['receivable'];
};

const buildComparisonCategories = (row: {
  partyType: string;
  accountLinks: PartnerAccountLink[];
  snapshotDelta: number;
  accountingDelta: number;
  textLinkedAccountingDelta: number;
  coverageLevel: string;
  journalLinkIntegrity: { typedPartyLinkUsable: boolean };
}) => {
  const categories: string[] = [];
  if (row.accountLinks.length === 0) {
    categories.push('missing_account_link');
  } else {
    const availableRoles = new Set(row.accountLinks.map((entry) => entry.role));
    const missingExpectedRole = expectedRolesForPartyType(row.partyType).some((role) => !availableRoles.has(role));
    if (missingExpectedRole) categories.push('account_mismatch');
  }
  if (Math.abs(row.snapshotDelta) > 0.01) categories.push('snapshot_drift');
  if (Math.abs(row.accountingDelta) > 0.01) categories.push('accounting_drift');
  if (row.coverageLevel === 'none') categories.push('no_text_partner_coverage');
  if (row.coverageLevel === 'partial') categories.push('partial_text_partner_coverage');
  if (Math.abs(row.textLinkedAccountingDelta) > 0.01) categories.push('text_link_accounting_drift');
  if (row.journalLinkIntegrity.typedPartyLinkUsable === false) categories.push('typed_party_link_schema_mismatch');
  return categories;
};

const loadScopedParties = async (
  scope: PartnerAccountingScope,
  options?: { partyId?: string; limit?: number; activeOnly?: boolean; partyIds?: string[] },
) => {
  const limit = Math.max(1, Math.min(Number(options?.limit || 100), 1000));
  const filters: any[] = [eq(schema.parties.companyId, scope.companyId)];
  if (options?.activeOnly !== false) {
    filters.push(or(eq(schema.parties.isActive, true), isNull(schema.parties.isActive)));
  }
  if (options?.partyId) {
    filters.push(eq(schema.parties.id, String(options.partyId)));
  }
  if (options?.partyIds) {
    const filteredIds = Array.from(new Set(options.partyIds.map((value) => normalizeText(value)).filter(Boolean)));
    if (filteredIds.length === 0) return [];
    filters.push(inArray(schema.parties.id, filteredIds));
  }
  const baseQuery = filters.length === 1 ? filters[0] : and(...filters);
  return options?.partyId || options?.partyIds
    ? (await db.select().from(schema.parties).where(baseQuery).all())
    : (await db.select().from(schema.parties).where(baseQuery).limit(limit).all());
};

const isRangeMatch = (value: unknown, range: PartnerAccountingRange) => {
  const key = dateKey(value);
  return key >= range.from && key <= range.to;
};

const classifyHistoricalGap = (entry: any, line: any, partyId: string): 'safe_to_auto_link' | 'needs_manual_review' | 'cannot_infer_safely' => {
  const referenceType = normalizeText(entry?.referenceType).toLowerCase();
  const numericPartyId = normalizeText(line?.partyId);
  if (numericPartyId && numericPartyId === normalizeText(partyId)) {
    return 'safe_to_auto_link';
  }
  if (['fx_revaluation', 'fx_revaluation_reversal'].includes(referenceType)) {
    return 'needs_manual_review';
  }
  if (['reverse', 'opening', 'fx_settlement'].includes(referenceType)) {
    return 'needs_manual_review';
  }
  return 'cannot_infer_safely';
};

const listShadowBlockingReasons = (input: {
  accountLinkCount: number;
  coverageLevel: CoverageLevel;
  shadowDelta: number;
  settlementMismatchCount: number;
  gapCounts: { needs_manual_review: number; cannot_infer_safely: number };
}) => {
  const reasons: string[] = [];
  if (input.accountLinkCount <= 0) reasons.push('missing_account_link');
  if (input.coverageLevel === 'none') reasons.push('no_text_partner_coverage');
  else if (input.coverageLevel === 'partial') reasons.push('partial_text_partner_coverage');
  if (Math.abs(input.shadowDelta) > 0.01) reasons.push('text_link_accounting_drift');
  if (input.settlementMismatchCount > 0) reasons.push('settlement_mismatch');
  if (input.gapCounts.needs_manual_review > 0) reasons.push('needs_manual_review_gap');
  if (input.gapCounts.cannot_infer_safely > 0) reasons.push('cannot_infer_safely_gap');
  return reasons;
};

const buildMismatchClassification = (input: {
  blockingReasons: string[];
  settlementRows: any[];
}) => Array.from(new Set([
  ...input.blockingReasons,
  ...input.settlementRows.flatMap((row: any) => Array.isArray(row?.mismatchCategories) ? row.mismatchCategories : []),
]));

export async function buildPartnerAccountingLedgerPreview(
  scope: PartnerAccountingScope,
  partyId: string,
  range: PartnerAccountingRange,
) {
  const party = await loadScopedParty(partyId, scope);
  if (!party) return null;

  const accountLinks = await loadPartyAccountLinks(party, scope.companyId);
  const accountIds = accountLinks.map((entry) => entry.accountId);
  const accountLinkById = new Map<number, PartnerAccountLink>(accountLinks.map((entry) => [entry.accountId, entry]));
  const { entriesById, lines } = await loadPostedJournalDataForPartyAccounts(scope.companyId, accountIds, scope.branchId || null);

  const normalizedPartyId = normalizeText((party as any).id);
  const numericPartyId = normalizeNumericId(normalizedPartyId);
  const textPartnerLinkedLineCount = lines.filter((line: any) => normalizeText((line as any).partnerRefId) === normalizedPartyId).length;
  const typedPartyLinkedLineCount = lines.filter((line: any) => {
    if (line.partyId === null || line.partyId === undefined) return false;
    if (numericPartyId === null) return false;
    return Number(line.partyId) === numericPartyId;
  }).length;

  const transformed = lines.map((line: any) => {
    const entry = entriesById.get(Number(line.journalEntryId));
    const account = accountLinkById.get(Number(line.accountId));
    const debit = roundMoney(Number(line.debit || 0));
    const credit = roundMoney(Number(line.credit || 0));
    return {
      journalEntryId: Number(line.journalEntryId),
      journalLineId: Number(line.id),
      entryDate: String(entry?.entryDate || ''),
      entryNumber: String(entry?.entryNumber || ''),
      referenceType: String(entry?.referenceType || ''),
      referenceId: entry?.referenceId != null ? Number(entry.referenceId) : null,
      description: String(line.description || entry?.description || ''),
      accountId: Number(line.accountId),
      accountCode: String(account?.code || ''),
      accountName: String(account?.nameAr || ''),
      role: (account?.role || 'fallback') as PartyAccountRole,
      debit,
      credit,
      delta: balanceDeltaForAccount(account, debit, credit),
      journalPartyId: line.partyId == null ? null : String(line.partyId),
      journalPartnerRefId: normalizeText((line as any).partnerRefId) || null,
      textLinked: normalizeText((line as any).partnerRefId) === normalizedPartyId,
    };
  }).sort((a, b) => {
    const dateDiff = a.entryDate.localeCompare(b.entryDate);
    if (dateDiff !== 0) return dateDiff;
    const entryDiff = a.journalEntryId - b.journalEntryId;
    if (entryDiff !== 0) return entryDiff;
    return a.journalLineId - b.journalLineId;
  });

  const openingBalance = roundMoney(
    transformed
      .filter((line) => dateKey(line.entryDate) < range.from)
      .reduce((sum, line) => sum + line.delta, 0),
  );
  const openingBalanceTextLinked = roundMoney(
    transformed
      .filter((line) => line.textLinked && dateKey(line.entryDate) < range.from)
      .reduce((sum, line) => sum + line.delta, 0),
  );

  let running = openingBalance;
  let runningTextLinked = openingBalanceTextLinked;
  let totalDebit = 0;
  let totalCredit = 0;
  let totalDebitTextLinked = 0;
  let totalCreditTextLinked = 0;
  let candidateRangedLineCount = 0;
  let textPartnerLinkedRangedLineCount = 0;
  const rangedLines: AccountingLedgerLine[] = [];
  for (const line of transformed) {
    const lineDate = dateKey(line.entryDate);
    if (lineDate < range.from || lineDate > range.to) continue;
    candidateRangedLineCount += 1;
    totalDebit = roundMoney(totalDebit + line.debit);
    totalCredit = roundMoney(totalCredit + line.credit);
    running = roundMoney(running + line.delta);
    if (line.textLinked) {
      textPartnerLinkedRangedLineCount += 1;
      totalDebitTextLinked = roundMoney(totalDebitTextLinked + line.debit);
      totalCreditTextLinked = roundMoney(totalCreditTextLinked + line.credit);
      runningTextLinked = roundMoney(runningTextLinked + line.delta);
    }
    rangedLines.push({
      ...line,
      runningBalance: running,
    });
  }

  const operationalBalance = await computeOperationalBalance(partyId, scope);
  const snapshotBalance = roundMoney(Number((party as any).balance || 0));

  return {
    preview: true,
    source: 'journal_entry_lines',
    derivationMode: 'party_subaccounts_only',
    limitations: [
      'Journal preview derives partner balances from party-linked receivable/payable accounts.',
      'journal_entry_lines.partner_ref_id provides a text-safe partner dual-link when populated.',
      'journal_entry_lines.party_id remains non-canonical because parties.id is text while journal_entry_lines.party_id is integer.',
    ],
    party: {
      id: normalizedPartyId,
      name: String((party as any).name || ''),
      type: String((party as any).type || ''),
      companyId: String((party as any).companyId || ''),
    },
    accountLinks,
    journalLinkIntegrity: {
      partiesIdType: 'TEXT',
      journalEntryLinesPartyIdType: 'INTEGER',
      journalEntryLinesPartnerRefIdType: 'TEXT',
      typedPartyLinkUsable: numericPartyId !== null,
      typedPartyLinkedLineCount,
      textPartnerLinkedLineCount,
      candidateScopedLineCount: lines.length,
      textPartnerCoverageLevel: classifyCoverageLevel(textPartnerLinkedLineCount, lines.length),
      candidateRangedLineCount,
      textPartnerLinkedRangedLineCount,
      textPartnerCoverageLevelInRange: classifyCoverageLevel(textPartnerLinkedRangedLineCount, candidateRangedLineCount),
    },
    openingBalance,
    totalDebit: roundMoney(totalDebit),
    totalCredit: roundMoney(totalCredit),
    closingBalance: roundMoney(running),
    lines: rangedLines,
    comparison: {
      snapshotBalance,
      operationalBalance,
      accountingBalance: roundMoney(openingBalance + rangedLines.reduce((sum, line) => sum + line.delta, 0)),
      accountingBalanceTextLinked: roundMoney(runningTextLinked),
      textLinkedDebit: roundMoney(totalDebitTextLinked),
      textLinkedCredit: roundMoney(totalCreditTextLinked),
      deltaOperationalVsAccounting: roundMoney(operationalBalance - running),
      deltaOperationalVsTextLinkedAccounting: roundMoney(operationalBalance - runningTextLinked),
      deltaSnapshotVsOperational: roundMoney(snapshotBalance - operationalBalance),
    },
  };
}

export async function buildPartnerAccountingComparison(
  scope: PartnerAccountingScope,
  options?: { partyId?: string; limit?: number; range?: PartnerAccountingRange },
) {
  const parties = await loadScopedParties(scope, options);
  const range = options?.range || { from: '2000-01-01', to: '2100-12-31' };

  const rows = [];
  for (const party of parties) {
    const ledger = await buildPartnerAccountingLedgerPreview(scope, String((party as any).id || ''), {
      from: range.from,
      to: range.to,
    });
    if (!ledger) continue;
    const mismatchCategories = buildComparisonCategories({
      partyType: ledger.party.type,
      accountLinks: ledger.accountLinks,
      snapshotDelta: ledger.comparison.deltaSnapshotVsOperational,
      accountingDelta: ledger.comparison.deltaOperationalVsAccounting,
      textLinkedAccountingDelta: ledger.comparison.deltaOperationalVsTextLinkedAccounting,
      coverageLevel: ledger.journalLinkIntegrity.textPartnerCoverageLevelInRange,
      journalLinkIntegrity: ledger.journalLinkIntegrity,
    });
    rows.push({
      partyId: ledger.party.id,
      partyName: ledger.party.name,
      partyType: ledger.party.type,
      accountLinks: ledger.accountLinks,
      journalLinkIntegrity: ledger.journalLinkIntegrity,
      balanceSources: {
        snapshot: ledger.comparison.snapshotBalance,
        operational: ledger.comparison.operationalBalance,
        accounting: ledger.comparison.accountingBalance,
      },
      deltas: {
        snapshotVsOperational: ledger.comparison.deltaSnapshotVsOperational,
        operationalVsAccounting: ledger.comparison.deltaOperationalVsAccounting,
        operationalVsTextLinkedAccounting: ledger.comparison.deltaOperationalVsTextLinkedAccounting,
      },
      coverage: {
        candidateScopedLineCount: ledger.journalLinkIntegrity.candidateScopedLineCount,
        textPartnerLinkedLineCount: ledger.journalLinkIntegrity.textPartnerLinkedLineCount,
        candidateRangedLineCount: ledger.journalLinkIntegrity.candidateRangedLineCount,
        textPartnerLinkedRangedLineCount: ledger.journalLinkIntegrity.textPartnerLinkedRangedLineCount,
        level: ledger.journalLinkIntegrity.textPartnerCoverageLevelInRange,
      },
      mismatchCategories,
      mismatchFlags: {
        snapshotDrift: mismatchCategories.includes('snapshot_drift'),
        accountingDrift: mismatchCategories.includes('accounting_drift'),
        textLinkAccountingDrift: mismatchCategories.includes('text_link_accounting_drift'),
        missingAccountLink: mismatchCategories.includes('missing_account_link'),
        accountMismatch: mismatchCategories.includes('account_mismatch'),
        noTextPartnerCoverage: mismatchCategories.includes('no_text_partner_coverage'),
        partialTextPartnerCoverage: mismatchCategories.includes('partial_text_partner_coverage'),
        unusableTypedJournalPartyLink: mismatchCategories.includes('typed_party_link_schema_mismatch'),
      },
    });
  }

  return {
    preview: true,
    source: 'party_transactions_vs_parties_vs_journal_entry_lines',
    rows,
    summary: {
      partiesScanned: rows.length,
      mismatchCount: rows.filter((row: any) => row.mismatchCategories.length > 0).length,
      snapshotDriftCount: rows.filter((row: any) => row.mismatchFlags.snapshotDrift).length,
      accountingDriftCount: rows.filter((row: any) => row.mismatchFlags.accountingDrift).length,
      textLinkAccountingDriftCount: rows.filter((row: any) => row.mismatchFlags.textLinkAccountingDrift).length,
      missingAccountLinkCount: rows.filter((row: any) => row.mismatchFlags.missingAccountLink).length,
      accountMismatchCount: rows.filter((row: any) => row.mismatchFlags.accountMismatch).length,
      noTextPartnerCoverageCount: rows.filter((row: any) => row.mismatchFlags.noTextPartnerCoverage).length,
      partialTextPartnerCoverageCount: rows.filter((row: any) => row.mismatchFlags.partialTextPartnerCoverage).length,
      fullTextPartnerCoverageCount: rows.filter((row: any) => row.coverage.level === 'full').length,
      unusableTypedJournalPartyLinkCount: rows.filter((row: any) => row.mismatchFlags.unusableTypedJournalPartyLink).length,
    },
  };
}

export async function analyzePartnerSettlementConsistency(
  scope: PartnerAccountingScope,
  options?: { partyId?: string; limit?: number; range?: PartnerAccountingRange },
) {
  const limit = Math.max(1, Math.min(Number(options?.limit || 200), 500));
  const range = options?.range;
  const invoices = await db.select().from(schema.invoices).where(
    scope.branchId
      ? and(
          eq(schema.invoices.companyId, scope.companyId),
          eq(schema.invoices.branchId, scope.branchId),
        )
      : eq(schema.invoices.companyId, scope.companyId),
  ).all();

  const vouchers = await db.select().from(schema.vouchers).where(
    scope.branchId
      ? and(
          eq(schema.vouchers.companyId, scope.companyId),
          eq(schema.vouchers.branchId, scope.branchId),
        )
      : eq(schema.vouchers.companyId, scope.companyId),
  ).all();

  const voucherBuckets = new Map<string, any[]>();
  for (const voucher of vouchers) {
    const linkedInvoiceId = normalizeText((voucher as any).linkedInvoiceId ?? (voucher as any).linked_invoice_id);
    if (!linkedInvoiceId) continue;
    const bucket = voucherBuckets.get(linkedInvoiceId);
    if (bucket) bucket.push(voucher);
    else voucherBuckets.set(linkedInvoiceId, [voucher]);
  }

  const relevantInvoices = invoices
    .filter((invoice: any) => {
      if (options?.partyId && String((invoice as any).clientId || '') !== String(options.partyId)) return false;
      if (range && !isRangeMatch((invoice as any).date, range)) return false;
      const type = normalizeText((invoice as any).type).toLowerCase();
      if (!['sale', 'purchase'].includes(type)) return false;
      const paymentType = normalizeText((invoice as any).paymentType).toLowerCase();
      return paymentType === 'credit';
    })
    .slice(0, limit);

  const rows = relevantInvoices.map((invoice: any) => {
    const type = normalizeText((invoice as any).type).toLowerCase();
    const exposureBase = invoiceExposureBase(invoice);
    const linked = (voucherBuckets.get(String((invoice as any).id || '')) || []).filter((voucher: any) => {
      const status = normalizeText((voucher as any).status).toUpperCase();
      if (status && status !== 'POSTED') return false;
      const voucherType = normalizeText((voucher as any).type).toLowerCase();
      return type === 'sale' ? voucherType === 'receipt' : voucherType === 'payment';
    });
    const settledBase = roundMoney(linked.reduce((sum: number, voucher: any) => sum + Number((voucher as any).amountBase ?? (voucher as any).amount ?? 0), 0));
    const expectedRemainingBase = roundMoney(Math.max(exposureBase - settledBase, 0));
    const storedRemainingBase = roundMoney(Number((invoice as any).remainingAmountBase ?? (invoice as any).remainingAmount ?? 0));
    const storedPaidBase = roundMoney(Number((invoice as any).paidAmountBase ?? (invoice as any).paidAmount ?? 0));
    const expectedPaidBase = roundMoney(Math.max(exposureBase - expectedRemainingBase, 0));
    const ledgerEntry = db.select().from(schema.partyTransactions).where(eq(schema.partyTransactions.refId, String((invoice as any).id || ''))).get();
    const ledgerDeltaBase = roundMoney(Number((ledgerEntry as any)?.deltaBase ?? (ledgerEntry as any)?.delta ?? 0));
    const expectedLedgerDeltaBase = type === 'purchase' ? exposureBase : exposureBase;

    const mismatchCategories: string[] = [];
    const reasons: string[] = [];
    if (linked.length === 0 && (storedPaidBase > 0.01 || storedRemainingBase < exposureBase - 0.01)) {
      mismatchCategories.push('missing_voucher_linkage');
      reasons.push('stored invoice settlement changed without linked posted voucher records.');
    }
    if (Math.abs(storedRemainingBase - expectedRemainingBase) > 0.01) {
      mismatchCategories.push('incorrect_invoice_residual');
      reasons.push('invoice.remainingAmountBase does not match linked posted voucher settlements.');
    }
    if (Math.abs(storedPaidBase - expectedPaidBase) > 0.01) {
      if (!mismatchCategories.includes('incorrect_invoice_residual')) mismatchCategories.push('incorrect_invoice_residual');
      reasons.push('invoice.paidAmountBase does not match linked posted voucher settlements.');
    }
    if (type === 'purchase' && Math.abs(exposureBase - roundMoney(Number((invoice as any).totalAmountBase ?? (invoice as any).totalAmount ?? 0))) > 0.01) {
      mismatchCategories.push('purchase_exposure_basis_difference');
      reasons.push('purchase partner exposure uses goodsSubtotal while invoice totals include extra costs.');
    }
    if (!ledgerEntry) {
      mismatchCategories.push('missing_party_transaction');
      reasons.push('invoice has no party_transactions anchor row.');
    } else if (Math.abs(Math.abs(ledgerDeltaBase) - expectedLedgerDeltaBase) > 0.01) {
      mismatchCategories.push('account_mismatch');
      reasons.push('party_transactions delta does not match expected invoice exposure base.');
    }

    return {
      invoiceId: String((invoice as any).id || ''),
      invoiceNumber: String((invoice as any).invoiceNumber || ''),
      invoiceType: type,
      partyId: String((invoice as any).clientId || ''),
      partyName: String((invoice as any).clientName || ''),
      storedPaidBase,
      storedRemainingBase,
      exposureBase,
      settledBase,
      expectedPaidBase,
      expectedRemainingBase,
      linkedVoucherIds: linked.map((voucher: any) => String((voucher as any).id || '')),
      ledgerDeltaBase,
      mismatchCategories,
      mismatch: reasons.length > 0,
      reasons,
    };
  });

  return {
    preview: true,
    source: 'invoices_vs_vouchers_vs_party_transactions',
    rows,
    summary: {
      invoicesScanned: rows.length,
      mismatchCount: rows.filter((row: any) => row.mismatch).length,
    },
  };
}

export async function buildPartnerTransitionAudit(
  scope: PartnerAccountingScope,
  range: PartnerAccountingRange,
  options?: { partyId?: string; limit?: number },
) {
  const parties = await loadScopedParties(scope, { ...options, activeOnly: true });
  const settlementReport = await analyzePartnerSettlementConsistency(scope, {
    partyId: options?.partyId,
    limit: Math.max(1, Math.min(Number(options?.limit || 500), 1000)),
    range,
  });
  const settlementByParty = new Map<string, any[]>();
  for (const row of settlementReport.rows || []) {
    const bucket = settlementByParty.get(String((row as any).partyId || '')) || [];
    bucket.push(row);
    settlementByParty.set(String((row as any).partyId || ''), bucket);
  }

  const auditRows = [];
  const historicalGapRows: any[] = [];
  for (const party of parties) {
    const partyId = String((party as any).id || '');
    const settlementRows = settlementByParty.get(partyId) || [];
    const ledger = await buildPartnerAccountingLedgerPreview(scope, partyId, range);
    if (!ledger) continue;
    const rangedActivityCount = Number(ledger.journalLinkIntegrity.candidateRangedLineCount || 0);
    const hasRecentActivity = rangedActivityCount > 0 || settlementRows.length > 0;
    if (!hasRecentActivity) continue;

    const accountIds = ledger.accountLinks.map((entry: any) => Number(entry.accountId));
    const lines = accountIds.length > 0
      ? await db.select().from(schema.journalEntryLines).where(
          and(
            eq(schema.journalEntryLines.companyId, scope.companyId),
            inArray(schema.journalEntryLines.accountId, accountIds),
          ),
        ).all()
      : [];
    const entryIds = Array.from(new Set((lines || []).map((line: any) => Number(line.journalEntryId || 0)).filter((value: number) => value > 0)));
    const entries = entryIds.length > 0
      ? await db.select().from(schema.journalEntries).where(inArray(schema.journalEntries.id, entryIds)).all()
      : [];
    const entriesById = new Map<number, any>((entries || []).map((entry: any) => [Number(entry.id), entry]));

    const rangedGapLines = (lines || []).filter((line: any) => {
      if (normalizeText((line as any).partnerRefId)) return false;
      const entry = entriesById.get(Number((line as any).journalEntryId || 0));
      if (!entry || String(entry.status || '').toLowerCase() !== 'posted') return false;
      return isRangeMatch((entry as any).entryDate, range);
    });

    const gapCounts = {
      safe_to_auto_link: 0,
      needs_manual_review: 0,
      cannot_infer_safely: 0,
    };
    for (const line of rangedGapLines) {
      const entry = entriesById.get(Number((line as any).journalEntryId || 0));
      const classification = classifyHistoricalGap(entry, line, partyId);
      gapCounts[classification] += 1;
      historicalGapRows.push({
        partyId,
        partyName: String((party as any).name || ''),
        journalEntryId: Number((line as any).journalEntryId || 0),
        journalLineId: Number((line as any).id || 0),
        entryDate: String((entry as any)?.entryDate || ''),
        referenceType: String((entry as any)?.referenceType || ''),
        accountId: Number((line as any).accountId || 0),
        classification,
        });
    }

    const settlementMismatchReasons = Array.from(new Set(
      settlementRows
        .filter((row: any) => Boolean(row?.mismatch))
        .flatMap((row: any) => Array.isArray(row?.reasons) ? row.reasons : []),
    ));
    const shadowDelta = roundMoney(Number(ledger.comparison.deltaOperationalVsTextLinkedAccounting || 0));
    const coverageLevel = String(ledger.journalLinkIntegrity.textPartnerCoverageLevelInRange || 'none') as CoverageLevel;
    const blockingReasons = listShadowBlockingReasons({
      accountLinkCount: ledger.accountLinks.length,
      coverageLevel,
      shadowDelta,
      settlementMismatchCount: settlementRows.filter((row: any) => Boolean(row?.mismatch)).length,
      gapCounts: {
        needs_manual_review: gapCounts.needs_manual_review,
        cannot_infer_safely: gapCounts.cannot_infer_safely,
      },
    });
    const mismatchClassification = buildMismatchClassification({ blockingReasons, settlementRows });
    const readyForShadowTrust = (
      coverageLevel === 'full'
      && Math.abs(shadowDelta) <= 0.01
      && settlementMismatchReasons.length === 0
      && gapCounts.needs_manual_review === 0
      && gapCounts.cannot_infer_safely === 0
      && ledger.accountLinks.length > 0
    );

    auditRows.push({
      partyId,
      partyName: String((party as any).name || ''),
      partyType: String((party as any).type || ''),
      activeInRange: hasRecentActivity,
      activity: {
        journalLineCountInRange: rangedActivityCount,
        settlementDocumentCountInRange: settlementRows.length,
      },
      coverage: {
        level: coverageLevel,
        candidateScopedLineCount: Number(ledger.journalLinkIntegrity.candidateScopedLineCount || 0),
        textPartnerLinkedLineCount: Number(ledger.journalLinkIntegrity.textPartnerLinkedLineCount || 0),
        candidateRangedLineCount: rangedActivityCount,
        textPartnerLinkedRangedLineCount: Number(ledger.journalLinkIntegrity.textPartnerLinkedRangedLineCount || 0),
      },
      balances: {
        operational: Number(ledger.comparison.operationalBalance || 0),
        accountingTextLinked: Number(ledger.comparison.accountingBalanceTextLinked || 0),
        delta: shadowDelta,
      },
      settlementMismatchCount: settlementRows.filter((row: any) => Boolean(row?.mismatch)).length,
      settlementMismatchReasons,
      historicalGaps: gapCounts,
      blockingReasons,
      mismatchClassification,
      readyForShadowTrust,
    });
  }

  const readyRows = auditRows.filter((row: any) => row.readyForShadowTrust);
  const blockedRows = auditRows.filter((row: any) => !row.readyForShadowTrust);
  const recurringMismatchPatternMap = new Map<string, number>();
  for (const row of blockedRows) {
    for (const pattern of Array.isArray((row as any).mismatchClassification) ? (row as any).mismatchClassification : []) {
      recurringMismatchPatternMap.set(String(pattern), Number(recurringMismatchPatternMap.get(String(pattern)) || 0) + 1);
    }
  }
  const recurringMismatchPatterns = Array.from(recurringMismatchPatternMap.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
  return {
    preview: true,
    source: 'partner_transition_shadow_audit',
    range,
    rows: auditRows,
    historicalGapRows,
    reviewBuckets: {
      readyForShadowTrust: readyRows.map((row: any) => ({
        partyId: row.partyId,
        partyName: row.partyName,
        coverageLevel: row.coverage.level,
        delta: row.balances.delta,
        readyForShadowTrust: true,
      })),
      blocked: blockedRows.map((row: any) => ({
        partyId: row.partyId,
        partyName: row.partyName,
        coverageLevel: row.coverage.level,
        delta: row.balances.delta,
        blockingReasons: row.blockingReasons,
        mismatchClassification: row.mismatchClassification,
        readyForShadowTrust: false,
      })),
    },
    summary: {
      partiesScanned: parties.length,
      activePartnersReviewed: auditRows.length,
      readyForShadowTrustCount: readyRows.length,
      blockedPartnerCount: blockedRows.length,
      partnersWithDriftCount: auditRows.filter((row: any) => Math.abs(Number(row?.balances?.delta || 0)) > 0.01).length,
      partnersNeedingManualReviewCount: auditRows.filter((row: any) => Number(row?.historicalGaps?.needs_manual_review || 0) > 0).length,
      fullCoverageCount: auditRows.filter((row: any) => row.coverage.level === 'full').length,
      partialCoverageCount: auditRows.filter((row: any) => row.coverage.level === 'partial').length,
      noCoverageCount: auditRows.filter((row: any) => row.coverage.level === 'none').length,
      settlementMismatchPartyCount: auditRows.filter((row: any) => row.settlementMismatchCount > 0).length,
      safeToAutoLinkGapCount: historicalGapRows.filter((row: any) => row.classification === 'safe_to_auto_link').length,
      needsManualReviewGapCount: historicalGapRows.filter((row: any) => row.classification === 'needs_manual_review').length,
      cannotInferSafelyGapCount: historicalGapRows.filter((row: any) => row.classification === 'cannot_infer_safely').length,
      recurringMismatchPatterns,
    },
  };
}
