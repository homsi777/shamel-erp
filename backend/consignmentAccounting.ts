import { sql } from 'drizzle-orm';
import * as schema from './db/schema';
import {
  createJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  resolveAccountByCode,
  SYSTEM_ACCOUNTS,
  roundMoney,
} from './accountingService';
import { getScopedSettingRow } from './lib/settings';

type ConsignmentDirection = 'OUT_CUSTOMER' | 'IN_SUPPLIER';

type MoneyContext = {
  currencyCode: string;
  exchangeRate: number;
};

type DispatchJournalParams = MoneyContext & {
  db: any;
  documentId: string;
  documentNumber: string;
  direction: ConsignmentDirection;
  totalCostBase: number;
  companyId?: string | null;
  branchId?: string | null;
};

type SupplierPolicy = 'REAL_LEDGER' | 'MEMO_ONLY';

type SupplierSettlementJournalParams = MoneyContext & {
  db: any;
  documentId: string;
  documentNumber: string;
  totalCostBase: number;
  policy: SupplierPolicy;
  companyId?: string | null;
  branchId?: string | null;
};

const parseConsignmentSettings = (raw: any) => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
};

const loadConsignmentSettings = async (db: any, companyId?: string | null, branchId?: string | null) => {
  const row = await getScopedSettingRow(db, schema, 'consignmentSettings', {
    companyId: companyId || null,
    branchId: branchId || null,
  });
  return parseConsignmentSettings(row?.value);
};

const resolveOrFallbackAccount = async (
  db: any,
  codeFromSettings: string | undefined,
  fallbackCode: string,
  companyId?: string | null,
): Promise<number> => {
  const code = (codeFromSettings || fallbackCode || '').trim();
  if (!code) throw new Error('MISSING_CONSIGNMENT_ACCOUNT_CODE');
  return resolveAccountByCode(db, code, companyId || null);
};

/**
 * Posting entry for consignment dispatch/receipt (no revenue recognition).
 * OUT_CUSTOMER:
 *   Dr Consignment Inventory with Customers
 *   Cr Main Inventory
 * IN_SUPPLIER (REAL_LEDGER policy):
 *   Dr Consignment Inventory from Suppliers
 *   Cr Consignment Liability to Suppliers
 */
export const postConsignmentDispatchJournal = async (params: DispatchJournalParams) => {
  const { db, documentId, documentNumber, direction, totalCostBase, currencyCode, exchangeRate, companyId, branchId } = params;
  const base = roundMoney(totalCostBase || 0);
  if (!base) return null;

  const settings = await loadConsignmentSettings(db, companyId, branchId);

  const consInvCustomersCode = settings.consignmentInventoryCustomersAccountCode ?? '1141';
  const consInvSuppliersCode = settings.consignmentInventorySuppliersAccountCode ?? '1142';
  const consLiabSuppliersCode = settings.consignmentLiabilitySuppliersAccountCode ?? '2115';

  const inventoryCode = SYSTEM_ACCOUNTS.INVENTORY;

  if (direction === 'OUT_CUSTOMER') {
    const consInvCustomersId = await resolveOrFallbackAccount(db, consInvCustomersCode, '1141', companyId);
    const inventoryId = await resolveOrFallbackAccount(db, inventoryCode, SYSTEM_ACCOUNTS.INVENTORY, companyId);

    const entry = await createJournalEntry({
      description: `تحويل بضاعة إلى أمانة عميل رقم ${documentNumber}`,
      referenceType: 'consignment_dispatch',
      referenceId: null,
      companyId: companyId || null,
      branchId: branchId || null,
      currencyCode,
      lines: [
        {
          accountId: consInvCustomersId,
          debit: base,
          credit: 0,
          description: 'مخزون أمانة لدى العملاء',
        },
        {
          accountId: inventoryId,
          debit: 0,
          credit: base,
          description: 'تحويل من مخزون مملوك',
        },
      ],
    });

    await postJournalEntry(entry.id);
    return entry.id;
  }

  // IN_SUPPLIER (REAL_LEDGER dispatch)
  if (direction === 'IN_SUPPLIER') {
    const consInvSuppliersId = await resolveOrFallbackAccount(db, consInvSuppliersCode, '1142', companyId);
    const consLiabSuppliersId = await resolveOrFallbackAccount(db, consLiabSuppliersCode, '2115', companyId);

    const entry = await createJournalEntry({
      description: `استلام بضاعة أمانة من مورد رقم ${documentNumber}`,
      referenceType: 'consignment_receipt',
      referenceId: null,
      companyId: companyId || null,
      branchId: branchId || null,
      currencyCode,
      lines: [
        {
          accountId: consInvSuppliersId,
          debit: base,
          credit: 0,
          description: 'مخزون أمانة من الموردين',
        },
        {
          accountId: consLiabSuppliersId,
          debit: 0,
          credit: base,
          description: 'التزام أمانة للموردين',
        },
      ],
    });

    await postJournalEntry(entry.id);
    return entry.id;
  }

  return null;
};

/**
 * Supplier consignment settlement: recognize cost / adjust liability according to policy.
 * REAL_LEDGER:
 *   Dr COGS (or inventory)
 *   Cr Consignment Inventory from Suppliers
 */
export const postSupplierConsignmentSettlementJournal = async (
  params: SupplierSettlementJournalParams
) => {
  const { db, documentId, documentNumber, totalCostBase, currencyCode, policy, companyId, branchId } = params;
  const base = roundMoney(totalCostBase || 0);
  if (!base) return null;

  if (policy === 'MEMO_ONLY') {
    // No financial impact under memo-only policy (reserved for future).
    return null;
  }

  const settings = await loadConsignmentSettings(db, companyId, branchId);
  const consInvSuppliersCode = settings.consignmentInventorySuppliersAccountCode ?? '1142';

  const cogsCode = SYSTEM_ACCOUNTS.COGS;

  const consInvSuppliersId = await resolveOrFallbackAccount(db, consInvSuppliersCode, '1142', companyId);
  const cogsId = await resolveOrFallbackAccount(db, cogsCode, SYSTEM_ACCOUNTS.COGS, companyId);

  const entry = await createJournalEntry({
    description: `تسوية استهلاك بضاعة أمانة من مورد رقم ${documentNumber}`,
    referenceType: 'consignment_settlement_supplier',
    referenceId: null,
    companyId: companyId || null,
    branchId: branchId || null,
    currencyCode,
    lines: [
      {
        accountId: cogsId,
        debit: base,
        credit: 0,
        description: 'تكلفة بضاعة أمانة مستهلكة',
      },
      {
        accountId: consInvSuppliersId,
        debit: 0,
        credit: base,
        description: 'تخفيض مخزون أمانة من الموردين',
      },
    ],
  });

  await postJournalEntry(entry.id);
  return entry.id;
};

export const reverseConsignmentJournal = async (entryId: number, reason: string) => {
  return reverseJournalEntry(entryId, reason || 'عكس حركة أمانة');
};
