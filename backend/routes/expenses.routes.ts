import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';
import { appError, isAppError } from '../lib/errors';
import {
  assertCashBoxAccess,
  assertEntityBelongsToAllowedBranch,
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
    eq,
    desc,
    safeJsonParse,
    roundMoney,
    resolveSystemAccountId,
    SYSTEM_ACCOUNTS,
    createJournalEntry,
    postJournalEntry,
    createVoucherWithAccounting,
    buildDescription,
    reverseJournalEntry,
    systemEventLogger,
  } = ctx as any;

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const withScopedExpense = async (id: string, req: any) => {
    const expense = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
    if (!expense) return null;
    const authContext = getAuthContext(req);
    const companyId = String(authContext.companyId || '').trim();
    if (companyId) {
      assertEntityBelongsToCompany(expense, companyId, 'Expense not found.');
      assertEntityBelongsToAllowedBranch(expense, authContext, 'Expense not found.');
    }
    return expense;
  };

  const bindExpensePayloadToTenant = async (req: any, payload: Record<string, any>) => {
    const authContext = getAuthContext(req);
    const nextPayload = { ...payload };
    const scopedCompanyId = String(authContext.companyId || '').trim() || null;
    if (!scopedCompanyId) {
      throw appError(401, 'NO_COMPANY_CONTEXT', 'Company context is required.');
    }
    const warehouseId = String(nextPayload.warehouseId || '').trim();
    const cashBoxId = String(nextPayload.cashBoxId || '').trim();

    let branchId = pickEffectiveBranchId(undefined, authContext);
    if (warehouseId) {
      const warehouse = await resolveWarehouseForContext(db, schema, eq, warehouseId);
      assertWarehouseAccess(warehouse, authContext);
      nextPayload.warehouseId = warehouseId;
      nextPayload.warehouseName = nextPayload.warehouseName || warehouse?.name || null;
      nextPayload.companyId = scopedCompanyId;
      branchId = String(warehouse?.branchId || branchId || '').trim() || null;
    }

    if (cashBoxId) {
      const cashBox = await resolveCashBoxForContext(db, schema, eq, cashBoxId);
      assertCashBoxAccess(cashBox, authContext);
      nextPayload.cashBoxId = cashBoxId;
      nextPayload.cashBoxName = nextPayload.cashBoxName || cashBox?.name || null;
      nextPayload.companyId = scopedCompanyId;
      if (cashBox?.branchId) {
        const hasExplicitBranchConstraint = Boolean(warehouseId);
        if (hasExplicitBranchConstraint && branchId && String(branchId) !== String(cashBox.branchId)) {
          throw appError(409, 'EXPENSE_BRANCH_CONTEXT_MISMATCH', 'الصندوق والمستودع لا ينتميان إلى الفرع نفسه.');
        }
        branchId = String(cashBox.branchId);
      }
    }

    nextPayload.companyId = scopedCompanyId;
    nextPayload.branchId = String(branchId || '').trim() || null;
    return nextPayload;
  };

  api.get('/expenses', async (req) => {
    const rows = await db.select().from(schema.expenses).orderBy(desc(schema.expenses.date)).all();
    return filterRowsByTenantScope(rows, getAuthContext(req), 'expenses');
  });

  api.post('/expenses', async (req, reply) => {
    try {
      const data = await bindExpensePayloadToTenant(req, req.body as any);
      const id = data.id || `exp-${Date.now()}`;
      await db.insert(schema.expenses).values({
        id,
        companyId: data.companyId || null,
        branchId: data.branchId || null,
        code: data.code,
        date: data.date,
        description: data.description,
        totalAmount: Number(data.totalAmount || 0),
        currency: data.currency || 'USD',
        paymentType: data.paymentType || 'CASH',
        cashBoxId: data.cashBoxId,
        cashBoxName: data.cashBoxName,
        warehouseId: data.warehouseId,
        warehouseName: data.warehouseName,
        manufacturingOrderId: data.manufacturingOrderId,
        status: data.status || 'DRAFT',
        lines: JSON.stringify(data.lines || []),
        postedAt: data.postedAt,
        createdAt: data.createdAt,
      }).run();
      return { success: true, id };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  api.post('/expenses/:id/post', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const expense = await withScopedExpense(String(id || ''), req);
      if (!expense) return reply.status(404).send({ error: 'Expense not found.' });
      if ((expense as any).status === 'POSTED') return reply.status(400).send({ error: 'المصروف مرحّل مسبقاً' });

      const authContext = getAuthContext(req);
      const companyId = String((expense as any).companyId || authContext.companyId || '').trim() || null;
      const branchId = String((expense as any).branchId || authContext.branchId || '').trim() || null;
      const amount = roundMoney(Number(expense.totalAmount || 0));
      const isCash = String(expense.paymentType || 'CASH').toUpperCase() === 'CASH';
      const expLines = safeJsonParse((expense as any).lines, []);

      let journalEntryId: number | null = null;
      if (amount > 0) {
        const miscExpenseId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.MISC_EXPENSE, companyId);
        let creditAccountId: number | null = null;

        if (isCash && expense.cashBoxId) {
          const cashBox = await resolveCashBoxForContext(db, schema, eq, String(expense.cashBoxId));
          assertCashBoxAccess(cashBox, authContext);
          creditAccountId = cashBox?.accountId ? Number(cashBox.accountId) : await resolveSystemAccountId(SYSTEM_ACCOUNTS.CASH, companyId);
        } else {
          creditAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.PAYABLE, companyId);
        }

        const journalLines: any[] = [];
        if (Array.isArray(expLines) && expLines.length > 0) {
          for (const line of expLines) {
            const lineAmount = roundMoney(Number(line.amount || 0));
            if (lineAmount <= 0) continue;
            const lineAccountId = line.accountId ? Number(line.accountId) : miscExpenseId;
            journalLines.push({
              accountId: lineAccountId,
              debit: lineAmount,
              credit: 0,
              description: line.description || expense.description || 'مصروف',
              currencyCode: expense.currency || 'USD',
            });
          }
        }

        if (journalLines.length === 0) {
          journalLines.push({
            accountId: miscExpenseId,
            debit: amount,
            credit: 0,
            description: expense.description || 'مصروف',
            currencyCode: expense.currency || 'USD',
          });
        }

        const totalDebit = journalLines.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0);
        journalLines.push({
          accountId: creditAccountId,
          debit: 0,
          credit: roundMoney(totalDebit),
          description: isCash ? 'دفع نقدي للمصروف' : 'مصروف مستحق',
          currencyCode: expense.currency || 'USD',
        });

        const entry = await createJournalEntry({
          description: buildDescription('مصروف', ':', expense.description || expense.code),
          referenceType: 'expense',
          referenceId: null,
          currencyCode: expense.currency || 'USD',
          companyId,
          branchId,
          lines: journalLines,
        });
        await postJournalEntry(entry.id);
        journalEntryId = entry.id;
      }

      let voucherId: string | null = null;
      if (isCash && expense.cashBoxId && amount > 0) {
        try {
          const voucherData = {
            id: `v-exp-${id}`,
            type: 'payment',
            date: expense.date || new Date().toISOString(),
            amount,
            amountBase: amount,
            amountTransaction: amount,
            originalAmount: amount,
            currency: expense.currency || 'USD',
            exchangeRate: 1,
            cashBoxId: expense.cashBoxId,
            cashBoxName: (expense as any).cashBoxName || 'الصندوق',
            clientId: null,
            clientName: null,
            category: 'مصاريف',
            description: `مصروف: ${expense.description || expense.code}`,
            referenceNumber: expense.code,
            linkedInvoiceId: null,
            companyId,
            branchId,
          };
          const vResult = await createVoucherWithAccounting(voucherData);
          voucherId = vResult?.id || null;
        } catch (voucherError: any) {
          if (journalEntryId) {
            await reverseJournalEntry(Number(journalEntryId), 'تعويض فشل ترحيل المصروف');
          }
          throw voucherError;
        }
      }

      await db.update(schema.expenses)
        .set({ status: 'POSTED', postedAt: new Date().toISOString() })
        .where(eq(schema.expenses.id, id))
        .run();

      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.EXPENSE_POST,
        severity: 'info',
        sourceModule: 'expenses',
        action: 'post',
        status: 'success',
        affectedDocumentType: 'expense',
        affectedDocumentId: id,
        metadata: {
          companyId,
          branchId,
          journalEntryId,
          voucherId,
          paymentType: expense.paymentType || null,
          totalAmount: amount,
        },
      });
      return { success: true, journalEntryId, voucherId };
    } catch (error: any) {
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.EXPENSE_POST,
        severity: 'critical',
        sourceModule: 'expenses',
        action: 'post',
        status: 'failed',
        errorCode: String(error?.code || 'EXPENSE_POST_FAILED'),
        requiresManualReview: false,
        affectedDocumentType: 'expense',
        affectedDocumentId: String((req.params as any)?.id || ''),
        metadata: {
          message: error?.message || 'Expense posting failed.',
        },
      });
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });
}
