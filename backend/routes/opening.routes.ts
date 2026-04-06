import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { getNextDocNumber } from './_common';
import { BASE_CURRENCY, normalizeCurrencyCode, normalizeExchangeRate, toBaseAmount } from '../lib/currency';
import { createInvoiceLifecycleService } from '../services/invoiceLifecycle';
import { ensurePartyAccountLinks, requirePartyAccountId } from '../services/partnerAccountEnforcement';
import { monitorPartnerPilotOperation } from '../services/partnerPilotService';
import { loadNormalizedSettingsMap } from '../lib/settings';
import { appError, isAppError } from '../lib/errors';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import {
  assertCashBoxAccess,
  assertEntityBelongsToCompany,
  assertWarehouseAccess,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveCashBoxForContext,
  resolveWarehouseForContext,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const {
    db,
    schema,
    sql,
    eq,
    safeJsonParse,
    resolveSystemAccountId,
    ACCOUNTING_LABELS,
    buildDescription,
    applyPartyTransaction,
    computePartyDelta,
    createJournalEntry,
    ledgerIdForRef,
    postJournalEntry,
    reverseJournalEntry,
    roundMoney,
    SYSTEM_ACCOUNTS,
    auditLogger,
    systemEventLogger,
  } = ctx as any;
  const invoiceLifecycle = createInvoiceLifecycleService(ctx as any);

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const loadScopedSettingsMap = async (companyId: string) => {
    return loadNormalizedSettingsMap(db, schema, { companyId });
  };

  const resolveScopedParty = async (partyId: string, req: any, notFoundMessage = 'الحساب غير موجود.') => {
    const party = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get();
    if (!party) return null;
    assertEntityBelongsToCompany(party, String(getAuthContext(req).companyId || ''), notFoundMessage);
    return party;
  };

  api.get('/opening-receivables', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const marks = filterRowsByTenantScope(
        await db.select().from(schema.reconciliationMarks).where(eq(schema.reconciliationMarks.reportType, 'opening_receivables')).all(),
        authContext,
        'reconciliation-marks',
      );

      const records = await Promise.all((marks || []).map(async (mark: any) => {
        const voucher = mark.rowRefId
          ? await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, mark.rowRefId)).get()
          : null;
        if (voucher) {
          assertEntityBelongsToCompany(voucher, String(authContext.companyId || ''), 'القيد الافتتاحي غير موجود.');
        }

        const party = mark.scopeType === 'parties' && mark.scopeId
          ? await db.select().from(schema.parties).where(eq(schema.parties.id, mark.scopeId)).get()
          : null;
        if (party) {
          assertEntityBelongsToCompany(party, String(authContext.companyId || ''), 'الحساب الافتتاحي غير موجود.');
        }

        const note = String(mark.note || '');
        const isAuto = note.includes('عند الإنشاء');
        const isCashBox = !!(voucher as any)?.cashBoxId;
        const partyName = isCashBox
          ? ((voucher as any)?.cashBoxName || '-')
          : (party?.name || (voucher as any)?.clientName || '-')
        const partyType = isCashBox ? 'CASH_BOX' : (party?.type || '-')
        const accountType = isCashBox ? 'cash_box' : (party?.type === 'SUPPLIER' ? 'supplier' : 'customer');
        return {
          id: mark.id,
          partyId: mark.scopeId,
          partyName,
          partyType,
          accountType,
          amount: Number((voucher as any)?.amount || 0),
          currency: (voucher as any)?.currency || 'USD',
          source: isAuto ? 'auto' : 'manual',
          isLocked: isAuto,
          postedAt: mark.markAt,
          voucherId: mark.rowRefId,
        };
      }));

      return records;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.post('/opening-stock/post', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const data = req.body as any;
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const fiscalYear = String(data.fiscalYear || new Date().getFullYear());
      const warehouseId = String(data.warehouseId || '');
      const currency = normalizeCurrencyCode(data.currency || BASE_CURRENCY);
      const exchangeRate = normalizeExchangeRate(currency, data.exchangeRate);
      const date = data.date || new Date().toISOString();

      if (!warehouseId) return reply.status(400).send({ error: 'المخزن مطلوب.' });
      if (lines.length === 0) return reply.status(400).send({ error: 'يجب إضافة صنف واحد على الأقل.' });

      const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
      assertWarehouseAccess(warehouse, authContext);
      const companyId = String(warehouse?.companyId || authContext.companyId || '').trim() || null;
      const branchId = String(warehouse?.branchId || pickEffectiveBranchId(undefined, authContext) || '').trim() || null;

      const validLines = lines.filter((l: any) => l.item_id && Number(l.quantity || 0) > 0 && Number(l.cost_price || 0) >= 0);
      if (validLines.length === 0) {
        return reply.status(400).send({ error: 'لا توجد أسطر صالحة — تحقق من الكميات.' });
      }

      const alreadyPosted = filterRowsByTenantScope(
        await db.select().from(schema.reconciliationMarks).all(),
        authContext,
        'reconciliation-marks',
      ).find((mark: any) =>
        ['opening_stock_new', 'opening_stock'].includes(String(mark.reportType || ''))
        && String(mark.scopeId || '') === warehouseId
        && String(mark.note || '').includes(fiscalYear),
      );

      if (alreadyPosted) {
        return reply.status(409).send({ error: `تم تسجيل مواد أول المدة لهذا المخزن في سنة ${fiscalYear} مسبقاً.` });
      }

      const totalAmountTransaction = roundMoney(
        validLines.reduce((s: number, l: any) => s + (Number(l.quantity || 0) * Number(l.cost_price || 0)), 0),
      );
      const totalAmountBase = currency === BASE_CURRENCY
        ? totalAmountTransaction
        : toBaseAmount(totalAmountTransaction, currency, exchangeRate);
      const normalizedLines = validLines.map((l: any) => {
        const qty = Number(l.quantity || 0);
        const unitPriceTransaction = Number(l.cost_price || 0);
        const unitPriceBase = currency === BASE_CURRENCY
          ? unitPriceTransaction
          : toBaseAmount(unitPriceTransaction, currency, exchangeRate);
        return {
          ...l,
          quantity: qty,
          unitPriceBase,
          unitPriceTransaction,
          lineTotalBase: roundMoney(unitPriceBase * qty),
          lineTotalTransaction: roundMoney(unitPriceTransaction * qty),
        };
      });

      const invoiceId = `inv-osn-${Date.now()}`;
      const invoiceNumber = await getNextDocNumber('opening_stock');
      const created = await invoiceLifecycle.createInvoice({
        id: invoiceId,
        invoiceNumber,
        type: 'opening_stock',
        companyId,
        branchId,
        date,
        items: normalizedLines.map((l: any) => ({
          itemId: l.item_id,
          itemName: l.item_name,
          itemCode: l.item_code,
          unitName: l.unit,
          quantity: Number(l.quantity || 0),
          baseQuantity: Number(l.quantity || 0),
          unitPrice: Number(l.unitPriceTransaction || 0),
          unitPriceTransaction: Number(l.unitPriceTransaction || 0),
          unitPriceBase: Number(l.unitPriceBase || 0),
          total: Number(l.lineTotalTransaction || 0),
          lineTotalTransaction: Number(l.lineTotalTransaction || 0),
          lineTotalBase: Number(l.lineTotalBase || 0),
          warehouseId: l.warehouse_id || warehouseId,
        })),
        paymentType: 'cash',
        applyStock: 1,
        currency,
        exchangeRate,
        targetWarehouseId: warehouseId,
        targetWarehouseName: warehouse?.name || null,
        notes: `مواد أول المدة — سنة ${fiscalYear}`,
        sourceDocumentType: 'opening_stock',
      }, authContext);

      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.OPENING_STOCK_POSTED,
        severity: 'info',
        sourceModule: 'opening',
        action: 'opening_stock.post',
        status: 'success',
        affectedDocumentType: 'opening_stock',
        affectedDocumentId: created.id || invoiceId,
        metadata: {
          invoiceNumber,
          warehouseId,
          totalAmountBase,
          totalAmountTransaction,
          linesPosted: validLines.length,
          fiscalYear,
        },
      });

      return {
        success: true,
        invoiceId: created.id || invoiceId,
        invoiceNumber,
        totalAmount: totalAmountBase,
        totalAmountBase,
        totalAmountTransaction,
        linesPosted: validLines.length,
        journalEntryId: null,
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.get('/opening-stock', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const marks = filterRowsByTenantScope(
        await db.select().from(schema.reconciliationMarks).all(),
        authContext,
        'reconciliation-marks',
      ).filter((mark: any) => ['opening_stock_new', 'opening_stock'].includes(String(mark.reportType || '')));

      const records = await Promise.all((marks || []).map(async (mark: any) => {
        const invoice = mark.rowRefId
          ? await db.select().from(schema.invoices).where(eq(schema.invoices.id, mark.rowRefId)).get()
          : null;
        if (invoice) {
          assertEntityBelongsToCompany(invoice, String(authContext.companyId || ''), 'قيد أول المدة غير موجود.');
        }

        return {
          id: mark.id,
          invoiceId: mark.rowRefId,
          invoiceNumber: (invoice as any)?.invoiceNumber || '-',
          warehouseId: mark.scopeId,
          totalAmount: (invoice as any)?.totalAmount || 0,
          currency: (invoice as any)?.currency || 'USD',
          date: mark.markAt,
          note: mark.note,
          status: 'posted',
        };
      }));

      return records;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.post('/opening-receivables/bulk', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim();
      if (!companyId) {
        throw appError(401, 'NO_COMPANY_CONTEXT', 'يجب تمرير سياق مؤسسة صالح مع هذا الطلب.');
      }

      const data = req.body as any;
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const fiscalYear = String(data.fiscalYear || new Date().getFullYear());
      const date = data.date || new Date().toISOString();

      if (lines.length === 0) return reply.status(400).send({ error: 'لا توجد أسطر.' });

      const settingsMap = await loadScopedSettingsMap(companyId);
      const ratesRaw = settingsMap.get('currencyRates');
      const currencyRates = (ratesRaw && typeof ratesRaw === 'object') ? ratesRaw : {};
      const explicitBaseRaw = settingsMap.get('defaultCurrency') ?? settingsMap.get('primaryCurrency') ?? settingsMap.get('baseCurrency');
      const inferredBaseFromRates = (['USD', 'SYP', 'TRY'] as const).find((code) => Number((currencyRates as any)?.[code]) === 1);
      const effectiveBaseCurrency = normalizeCurrencyCode(explicitBaseRaw || inferredBaseFromRates || BASE_CURRENCY);

      const resolveRate = (currencyCode: string, rawRate: unknown): number => {
        if (currencyCode === effectiveBaseCurrency) return 1;
        const provided = Number(rawRate ?? 0);
        if (Number.isFinite(provided) && provided > 0) return provided;
        const targetRate = Number((currencyRates as any)?.[currencyCode] || 0);
        const baseRate = Number((currencyRates as any)?.[effectiveBaseCurrency] || 1);
        if (targetRate > 0 && baseRate > 0) return targetRate / baseRate;
        return 0;
      };

      const results: any[] = [];
      const errors: any[] = [];
      const warnings: any[] = [];
      const journalRequests: Array<{
        kind: 'cash_box' | 'party';
        voucherId: string;
        amount: number;
        entryType: 'debit' | 'credit';
        currency: string;
        accountId?: number | null;
        cashBoxId?: string | null;
        cashBoxDelta?: number;
        partyId?: string;
        partyType?: string;
        partyName?: string;
        companyId: string;
        branchId: string | null;
      }> = [];
      const openingPartyAccountIds = new Map<string, number>();

      for (const rawLine of lines) {
        const accountId = String(rawLine.account_id || '').trim();
        const accountType = String(rawLine.account_type || 'customer').trim();
        if (!accountId || accountType === 'cash_box' || openingPartyAccountIds.has(accountId)) continue;
        try {
          const party = await db.select().from(schema.parties).where(eq(schema.parties.id, accountId)).get();
          if (!party) continue;
          assertEntityBelongsToCompany(party, companyId, 'Party not found.');
          const enforcedParty = await ensurePartyAccountLinks(db, party, companyId);
          const partyAccountId = await requirePartyAccountId(
            db,
            enforcedParty,
            String((enforcedParty as any).type || '').toUpperCase() === 'SUPPLIER' ? 'payable' : 'receivable',
            companyId,
          );
          if (partyAccountId) openingPartyAccountIds.set(accountId, partyAccountId);
        } catch {}
      }

      await db.transaction(async (tx: any) => {
        for (const line of lines) {
          const accountId = String(line.account_id || '').trim();
          const accountType = String(line.account_type || 'customer').trim();
          const debit = roundMoney(Number(line.debit || 0));
          const credit = roundMoney(Number(line.credit || 0));
          const amount = debit > 0 ? debit : credit;
          const entryType = debit > 0 ? 'debit' : 'credit';
          const currency = normalizeCurrencyCode(line.currency || data.currency || effectiveBaseCurrency);
          const exchangeRate = resolveRate(currency, line.exchangeRate ?? data.exchangeRate);
          const amountTransaction = amount;
          if (currency !== effectiveBaseCurrency && !(exchangeRate > 0)) {
            errors.push({ line, error: `سعر الصرف غير مضبوط (${currency}/${effectiveBaseCurrency})` });
            continue;
          }
          const amountBase = currency === effectiveBaseCurrency ? amountTransaction : roundMoney(amountTransaction / exchangeRate);

          if (!accountId) {
            errors.push({ line, error: 'account_id مفقود' });
            continue;
          }
          if (amountTransaction <= 0) {
            errors.push({ line, error: 'المبلغ يجب أن يكون أكبر من صفر' });
            continue;
          }

          if (accountType === 'cash_box') {
            const box = await tx.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, accountId)).get();
            if (!box) {
              errors.push({ line, error: `الصندوق ${accountId} غير موجود` });
              continue;
            }
            assertEntityBelongsToCompany(box, companyId, 'الصندوق غير موجود ضمن المؤسسة الحالية.');
            assertCashBoxAccess(box, authContext);

            const existingMarks = await tx.select().from(schema.reconciliationMarks).where(eq(schema.reconciliationMarks.scopeId, accountId)).all();
            const duplicate = (existingMarks || []).find((mark: any) =>
              String(mark.reportType || '') === 'opening_receivables'
              && String(mark.companyId || companyId) === companyId
              && String(mark.note || '').includes(fiscalYear),
            );
            if (duplicate) {
              warnings.push({
                accountId,
                name: box.name,
                warning: `تم تسجيل رصيد افتتاحي لهذا الصندوق في سنة ${fiscalYear} مسبقاً — تم تخطيه`,
              });
              continue;
            }

            const delta = entryType === 'debit' ? amountBase : -amountBase;
            const newBal = roundMoney(Number(box.balance || 0) + delta);
            await tx.update(schema.cashBoxes).set({ balance: newBal }).where(eq(schema.cashBoxes.id, box.id)).run();

            const branchId = String((box as any).branchId || pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
            const voucherId = `v-obcb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
            await tx.insert(schema.vouchers).values({
              id: voucherId,
              companyId,
              branchId,
              type: 'adjustment',
              date,
              amount: amountBase,
              amountBase,
              amountTransaction,
              originalAmount: amountTransaction,
              currency,
              exchangeRate,
              cashBoxId: box.id,
              cashBoxName: box.name,
              category: 'رصيد افتتاحي للصندوق',
              description: `رصيد افتتاحي للصندوق ${box.name} لعام ${fiscalYear}`,
            }).run();

            await tx.insert(schema.reconciliationMarks).values({
              id: `rm-obcb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              companyId,
              branchId,
              scopeType: 'cash_box',
              scopeId: box.id,
              reportType: 'opening_receivables',
              markAt: date,
              rowRefId: voucherId,
              note: `رصيد افتتاحي للصندوق ${box.name} لعام ${fiscalYear}`,
            }).run();

            results.push({
              accountId,
              accountType: 'cash_box',
              name: box.name,
              amount: amountTransaction,
              delta,
              currency,
            });
            journalRequests.push({
              kind: 'cash_box',
              voucherId,
              amount: amountBase,
              entryType: entryType as 'debit' | 'credit',
              currency,
              accountId: box.accountId ? Number(box.accountId) : null,
              cashBoxId: String(box.id || ''),
              cashBoxDelta: delta,
              partyName: box.name,
              companyId,
              branchId,
            });
            continue;
          }

          const party = tx.select().from(schema.parties).where(eq(schema.parties.id, accountId)).get();
          if (!party) {
            errors.push({ line, error: `الطرف ${accountId} غير موجود` });
            continue;
          }
          assertEntityBelongsToCompany(party, companyId, 'الحساب غير موجود ضمن المؤسسة الحالية.');

          const existingMarks = await tx.select().from(schema.reconciliationMarks).where(eq(schema.reconciliationMarks.scopeId, accountId)).all();
          const duplicate = (existingMarks || []).find((mark: any) =>
            String(mark.reportType || '') === 'opening_receivables'
            && String(mark.companyId || companyId) === companyId
            && String(mark.note || '').includes(fiscalYear),
          );
          if (duplicate) {
            warnings.push({
              accountId,
              name: party.name,
                warning: `تم تسجيل رصيد افتتاحي لهذا الطرف في سنة ${fiscalYear} مسبقاً — تم تخطيه`,
            });
            continue;
          }

          const partyAccountId = openingPartyAccountIds.get(String(party.id || '')) || null;
          if (!partyAccountId) {
            errors.push({ line, error: `لم يمكن تحديد حساب مدين/دائن للطرف ${party.name}` });
            continue;
          }

          const delta = computePartyDelta({
            partyType: party.type,
            event: 'opening_balance',
            entryType,
            totalOrAmount: amountBase,
          });
          if (delta === 0) {
            errors.push({ line, error: `delta = 0 للطرف ${party.name} — تحقق من نوع الحساب` });
            continue;
          }

          const branchId = String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
          const voucherId = `v-obp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          await applyPartyTransaction(tx, {
            id: ledgerIdForRef(voucherId),
            companyId,
            branchId,
            partyId: party.id,
            partyType: party.type,
            kind: 'opening_balance',
            refId: voucherId,
            amount: amountBase,
            amountBase,
            amountTransaction,
            delta,
            deltaBase: delta,
            deltaTransaction: currency === effectiveBaseCurrency ? delta : roundMoney(delta * exchangeRate),
            currency,
            exchangeRate,
            createdAt: date,
          });

          await tx.insert(schema.vouchers).values({
            id: voucherId,
            companyId,
            branchId,
            type: 'adjustment',
            date,
            amount: amountBase,
            amountBase,
            amountTransaction,
            originalAmount: amountTransaction,
            currency,
            exchangeRate,
            clientId: party.id,
            clientName: party.name,
            category: 'ذمم أول المدة',
            description: `رصيد افتتاحي — ${party.type === 'SUPPLIER' ? 'مورد' : 'عميل'}: ${party.name} — سنة ${fiscalYear}`,
            referenceNumber: `OB-${party.id}-${fiscalYear}`,
          }).run();

          await tx.insert(schema.reconciliationMarks).values({
            id: `rm-obp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            companyId,
            branchId,
            scopeType: 'parties',
            scopeId: party.id,
            reportType: 'opening_receivables',
            markAt: date,
            rowRefId: voucherId,
            note: `ذمم أول المدة — ${party.name} — سنة ${fiscalYear}`,
          }).run();

          results.push({
            accountId: party.id,
            accountType: party.type,
            name: party.name,
            amount: amountTransaction,
            delta,
            currency,
          });
          journalRequests.push({
            kind: 'party',
            voucherId,
            amount: amountBase,
            entryType: entryType as 'debit' | 'credit',
            currency,
            partyId: party.id,
            partyType: party.type,
            partyName: party.name,
            accountId: partyAccountId,
            companyId,
            branchId,
          });
        }
      });

      if (journalRequests.length > 0) {
        const postedJournalByVoucherId = new Map<string, number>();
        try {
          let openingOffsetAccountId: number | null = null;
          try {
            openingOffsetAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.OPENING_OFFSET, companyId);
          } catch {
            openingOffsetAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.RETAINED, companyId);
          }

          for (const reqItem of journalRequests) {
            const offsetAccountId = openingOffsetAccountId || await resolveSystemAccountId(SYSTEM_ACCOUNTS.RETAINED, companyId);
            let targetAccountId: number | null = null;
            if (reqItem.kind === 'cash_box') {
              targetAccountId = reqItem.accountId || null;
            } else if (reqItem.accountId) {
              targetAccountId = reqItem.accountId;
            }
            if (!targetAccountId) {
              throw new Error(`OPENING_TARGET_ACCOUNT_NOT_FOUND:${reqItem.voucherId}`);
            }

            const isDebit = reqItem.entryType === 'debit';
            const entry = await createJournalEntry({
              description: buildDescription(ACCOUNTING_LABELS.OPENING_BALANCE, 'â€”', reqItem.partyName || ''),
              referenceType: 'opening',
              referenceId: null,
              entryDate: date,
              currencyCode: reqItem.currency || 'SYP',
              companyId: reqItem.companyId,
              branchId: reqItem.branchId,
              lines: [
                {
                  accountId: targetAccountId,
                  debit: isDebit ? reqItem.amount : 0,
                  credit: isDebit ? 0 : reqItem.amount,
                  description: ACCOUNTING_LABELS.OPENING_BALANCE,
                  partyId: reqItem.kind === 'party' && reqItem.partyId ? Number(reqItem.partyId) : null,
                  partnerRefId: reqItem.kind === 'party' && reqItem.partyId ? String(reqItem.partyId) : null,
                },
                {
                  accountId: offsetAccountId,
                  debit: isDebit ? 0 : reqItem.amount,
                  credit: isDebit ? reqItem.amount : 0,
                  description: 'موازنة تلقائية - ذمم أول مدة',
                  partyId: null,
                },
              ],
            });
            await postJournalEntry(entry.id);
            postedJournalByVoucherId.set(reqItem.voucherId, Number(entry.id));
            await db.update(schema.vouchers)
              .set({ journalEntryId: String(entry.id), status: 'POSTED' })
              .where(eq(schema.vouchers.id, reqItem.voucherId))
              .run();
          }
        } catch (journalError: any) {
          await db.transaction(async (tx: any) => {
            for (const reqItem of journalRequests) {
              await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, reqItem.voucherId)).run();
              await tx.delete(schema.reconciliationMarks).where(eq(schema.reconciliationMarks.rowRefId, reqItem.voucherId)).run();
              await tx.delete(schema.partyTransactions).where(eq(schema.partyTransactions.refId, reqItem.voucherId)).run();
              if (reqItem.kind === 'cash_box' && reqItem.cashBoxId && Number(reqItem.cashBoxDelta || 0) !== 0) {
                const cashBox = await tx.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, String(reqItem.cashBoxId))).get();
                if (cashBox) {
                  await tx.update(schema.cashBoxes)
                    .set({ balance: roundMoney(Number(cashBox.balance || 0) - Number(reqItem.cashBoxDelta || 0)) })
                    .where(eq(schema.cashBoxes.id, String(reqItem.cashBoxId)))
                    .run();
                }
              }
            }
            const partyIds = Array.from(new Set(journalRequests.map((entry) => String(entry.partyId || '').trim()).filter(Boolean)));
            for (const partyId of partyIds) {
              const row = await tx.select({
                sum: sql<number>`coalesce(sum(coalesce(${schema.partyTransactions.deltaBase}, ${schema.partyTransactions.delta})), 0)`,
              }).from(schema.partyTransactions).where(eq(schema.partyTransactions.partyId, partyId)).get();
              await tx.update(schema.parties)
                .set({ balance: Number(row?.sum || 0) })
                .where(eq(schema.parties.id, partyId))
                .run();
            }
          });

          for (const entryId of postedJournalByVoucherId.values()) {
            try {
              await reverseJournalEntry(entryId, 'Opening receivables compensation rollback');
            } catch {}
          }

          throw appError(500, 'OPENING_RECEIVABLES_JOURNAL_FAILED', journalError?.message || 'Failed to post opening receivables journals atomically.', {
            processed_count: results.length,
            pending_voucher_count: journalRequests.length,
          });
        }
      }
      const severity = errors.length > 0 ? 'warning' : 'info';
      const status = errors.length > 0 ? 'partial' : 'success';
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.OPENING_BALANCE_POSTED,
        severity,
        sourceModule: 'opening',
        action: 'opening_receivables.bulk',
        status,
        requiresManualReview: errors.length > 0,
        affectedDocumentType: 'opening_receivables',
        affectedDocumentId: null,
        metadata: {
          processed: results.length,
          skipped: warnings.length,
          errors: errors.length,
          fiscalYear,
        },
      });
      return {
        success: true,
        processed: results.length,
        skipped: warnings.length,
        errors: errors.length,
        results,
        warnings,
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.post('/opening-balances/parties', async (req, reply) => {
    try {
      const authContext = getAuthContext(req);
      const companyId = String(authContext.companyId || '').trim();
      if (!companyId) {
        throw appError(401, 'NO_COMPANY_CONTEXT', 'يجب تمرير سياق مؤسسة صالح مع هذا الطلب.');
      }

      const data = req.body as any;
      const partyId = String(data.partyId || '').trim();
      const amountTransaction = roundMoney(Number(data.amount || 0));
      const entryType = String(data.entryType || data.type || 'debit').toLowerCase();
      const partyRole = String(data.partyRole || data.direction || '');
      const date = data.date || new Date().toISOString();
      const note = data.note || 'رصيد افتتاحي';
      if (!partyId || amountTransaction <= 0) {
        return reply.status(400).send({ error: 'بيانات الذمة الافتتاحية غير مكتملة.' });
      }

      const settingsMap = await loadScopedSettingsMap(companyId);
      const ratesRaw = settingsMap.get('currencyRates');
      const currencyRates = (ratesRaw && typeof ratesRaw === 'object') ? ratesRaw : {};
      const explicitBaseRaw = settingsMap.get('defaultCurrency') ?? settingsMap.get('primaryCurrency') ?? settingsMap.get('baseCurrency');
      const inferredBaseFromRates = (['USD', 'SYP', 'TRY'] as const).find((code) => Number((currencyRates as any)?.[code]) === 1);
      const effectiveBaseCurrency = normalizeCurrencyCode(explicitBaseRaw || inferredBaseFromRates || BASE_CURRENCY);
      const currency = normalizeCurrencyCode(data.currency || effectiveBaseCurrency);
      const providedRate = Number(data.exchangeRate ?? 0);
      let exchangeRate = currency === effectiveBaseCurrency ? 1 : (Number.isFinite(providedRate) && providedRate > 0 ? providedRate : 0);
      if (currency !== effectiveBaseCurrency && !(exchangeRate > 0)) {
        const targetRate = Number((currencyRates as any)?.[currency] || 0);
        const baseRate = Number((currencyRates as any)?.[effectiveBaseCurrency] || 1);
        if (targetRate > 0 && baseRate > 0) exchangeRate = targetRate / baseRate;
      }
      if (currency !== effectiveBaseCurrency && !(exchangeRate > 0)) {
        return reply.status(400).send({ error: `سعر صرف عملة الرصيد الافتتاحي غير مضبوط (${currency}/${effectiveBaseCurrency}).` });
      }

      const amountBase = currency === effectiveBaseCurrency ? amountTransaction : roundMoney(amountTransaction / exchangeRate);
      const party = await resolveScopedParty(partyId, req);
      if (!party) return reply.status(404).send({ error: 'الحساب غير موجود.' });

      const inferredRole = (() => {
        const pType = String((party as any).type || '').toUpperCase();
        if (partyRole) {
          const r = partyRole.toUpperCase();
          if (r === 'CUSTOMER' || r === 'SUPPLIER' || r === 'BOTH') return r;
          if (partyRole === 'customer') return 'CUSTOMER';
          if (partyRole === 'supplier') return 'SUPPLIER';
        }
        if (pType === 'SUPPLIER') return 'SUPPLIER';
        if (pType === 'CUSTOMER') return 'CUSTOMER';
        return 'CUSTOMER';
      })();

      const delta = computePartyDelta({
        partyType: inferredRole,
        event: 'opening_balance',
        entryType,
        totalOrAmount: amountBase,
      });
      if (delta === 0 && amountBase !== 0) {
        return reply.status(400).send({ error: 'Invalid opening balance entry type.' });
      }

      const branchId = String(pickEffectiveBranchId(undefined, authContext) || '').trim() || null;
      const voucherId = `v-obp-${Date.now()}`;

      const enforcedParty = await ensurePartyAccountLinks(db, party, companyId);
      const partyAccountId = await requirePartyAccountId(
        db,
        enforcedParty,
        inferredRole === 'SUPPLIER' ? 'payable' : 'receivable',
        companyId,
      );
      if (!partyAccountId) {
        throw appError(500, 'OPENING_PARTY_ACCOUNT_NOT_FOUND', 'Failed to resolve party account for opening balance.');
      }

      let offsetAccountId: number | null = null;
      try {
        offsetAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.OPENING_OFFSET, companyId);
      } catch {
        offsetAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.RETAINED, companyId);
      }
      if (!offsetAccountId) {
        throw appError(500, 'OPENING_OFFSET_ACCOUNT_NOT_FOUND', 'Failed to resolve opening offset account.');
      }

      const isDebit = entryType === 'debit';
      const entry = await createJournalEntry({
        description: `أرصدة افتتاحية — ${party.name}`,
        referenceType: 'opening',
        referenceId: null,
        entryDate: date,
        currencyCode: currency,
        companyId,
        branchId,
        lines: [
          {
            accountId: partyAccountId,
            debit: isDebit ? amountBase : 0,
            credit: isDebit ? 0 : amountBase,
            description: ACCOUNTING_LABELS.OPENING_BALANCE,
            partnerRefId: String(party.id || ''),
            currencyCode: currency,
            exchangeRate,
            amountInCurrency: amountTransaction,
          },
          {
            accountId: offsetAccountId,
            debit: isDebit ? 0 : amountBase,
            credit: isDebit ? amountBase : 0,
            description: 'موازنة تلقائية - ذمم أول مدة',
            currencyCode: currency,
            exchangeRate,
            amountInCurrency: amountTransaction,
          },
        ],
      });
      await postJournalEntry(entry.id);

      try {
        await db.transaction(async (tx: any) => {
          await applyPartyTransaction(tx, {
            id: ledgerIdForRef(voucherId),
            companyId,
            branchId,
            partyId,
            partyType: inferredRole,
            kind: 'opening_balance',
            refId: voucherId,
            amount: amountBase,
            amountBase,
            amountTransaction,
            delta,
            deltaBase: delta,
            deltaTransaction: currency === effectiveBaseCurrency ? delta : roundMoney(delta * exchangeRate),
            currency,
            exchangeRate,
            createdAt: date,
          });

          await tx.insert(schema.vouchers).values({
            id: voucherId,
            companyId,
            branchId,
            type: 'adjustment',
            date,
            amount: amountBase,
            amountBase,
            amountTransaction,
            originalAmount: amountTransaction,
            currency,
            exchangeRate,
            cashBoxId: null,
            cashBoxName: null,
            clientId: partyId,
            clientName: party.name,
            category: 'رصيد أول مدة ذمم',
            description: `${note} (${inferredRole === 'SUPPLIER' ? 'مورد' : 'عميل'})`,
            referenceNumber: data.referenceNumber,
            journalEntryId: String(entry.id),
            status: 'POSTED',
          }).run();

          await tx.insert(schema.reconciliationMarks).values({
            id: `rm-${Date.now()}`,
            companyId,
            branchId,
            scopeType: 'parties',
            scopeId: partyId,
            reportType: 'opening_ar_ap',
            markAt: new Date().toISOString(),
            rowRefId: voucherId,
            note,
          }).run();
        });
      } catch (persistError: any) {
        try {
          await reverseJournalEntry(entry.id, 'Opening party balance persistence rollback');
        } catch {
          // Compensation failure is surfaced by the main error envelope below.
        }
        throw appError(
          500,
          'OPENING_BALANCE_PERSISTENCE_FAILED',
          persistError?.message || 'Failed to persist opening balance after journal posting.',
          { voucherId, journalEntryId: entry.id },
        );
      }

      const result = { success: true, voucherId, journalEntryId: String(entry.id) };
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.OPENING_BALANCE_POSTED,
        severity: 'info',
        sourceModule: 'opening',
        action: 'opening_balance.post',
        status: 'success',
        affectedDocumentType: 'opening_balance',
        affectedDocumentId: voucherId,
        metadata: {
          partyId,
          partyName: party.name,
          amountBase,
          amountTransaction,
          currency,
          entryType,
        },
      });
      const pilotReview = await monitorPartnerPilotOperation({
        db,
        schema,
        scope: { companyId, branchId },
        partyId,
        documentType: 'opening_balance',
        documentId: voucherId,
        action: 'opening_balance.post',
        userId: String(authContext.userId || authContext.id || 'system'),
        companyId,
        branchId,
        metadata: {
          journalEntryId: String(entry.id),
          entryType,
          partyRole: inferredRole,
        },
        systemEventLogger,
        auditLogger,
      });
      return pilotReview ? { ...result, partnerPilotReview: pilotReview } : result;
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });
}

