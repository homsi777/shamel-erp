import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError, isAppError } from '../lib/errors';
import {
  assertCashBoxAccess,
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
  pickEffectiveBranchId,
  resolveCashBoxForContext,
} from '../lib/tenantScope';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const {
    db,
    schema,
    eq,
    roundMoney,
    resolveSystemAccountId,
    ACCOUNTING_LABELS,
    buildDescription,
    createJournalEntry,
    postJournalEntry,
    createVoucherWithAccounting,
    SYSTEM_ACCOUNTS,
  } = ctx as any;

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const withScopedEmployee = async (employeeId: string, req: any, notFoundMessage = 'Employee not found.') => {
    const employee = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId)).get();
    if (!employee) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(employee, String(authContext.companyId || ''), notFoundMessage);
    assertEntityBelongsToAllowedBranch(employee, authContext, notFoundMessage);
    return employee;
  };

  api.get('/payroll/transactions', async (req) => {
    try {
      const rows = await db.select().from(schema.salaryTransactions).all();
      return filterRowsByTenantScope(rows, getAuthContext(req), 'payroll/transactions');
    } catch {
      return [];
    }
  });

  api.post('/payroll/process', async (req, reply) => {
    try {
      const data = req.body as any;
      const authContext = getAuthContext(req);
      const affectCashBox = data.affectCashBox !== false;
      const processMode = String(data.processMode || 'direct').toLowerCase();
      if (!data.employeeId || !data.amount || !data.date) {
        return reply.status(400).send({ error: 'Missing required payroll fields.' });
      }
      if (processMode !== 'accrue' && affectCashBox && !data.cashBoxId) {
        return reply.status(400).send({ error: 'Missing cash box for payroll payment.' });
      }

      const employee = await withScopedEmployee(String(data.employeeId || ''), req);
      if (!employee) return reply.status(404).send({ error: 'Employee not found.' });

      let cashBox: any = null;
      if (processMode !== 'accrue' && affectCashBox && data.cashBoxId) {
        cashBox = await resolveCashBoxForContext(db, schema, eq, String(data.cashBoxId || ''));
        assertCashBoxAccess(cashBox, authContext);
      }

      const employeeBranchId = String((employee as any).branchId || '').trim() || null;
      const cashBoxBranchId = String(cashBox?.branchId || '').trim() || null;
      if (employeeBranchId && cashBoxBranchId && employeeBranchId !== cashBoxBranchId) {
        throw appError(409, 'PAYROLL_BRANCH_CONTEXT_MISMATCH', 'الموظف والصندوق لا ينتميان إلى نفس الفرع.');
      }

      const companyId = String((employee as any).companyId || cashBox?.companyId || authContext.companyId || '').trim() || null;
      const branchId = String(
        cashBoxBranchId
        || employeeBranchId
        || pickEffectiveBranchId(data.branchId, authContext)
        || '',
      ).trim() || null;

      let employeeName = data.employeeName || (employee as any)?.name;
      const id = `sal-${Date.now()}`;
      const txType = String(data.type || 'full_salary');
      const amount = roundMoney(Number(data.amount || 0));
      const taxDeductions = roundMoney(Number(data.taxDeductions || 0));
      const socialInsurance = roundMoney(Number(data.socialInsurance || 0));
      const advanceDeductions = roundMoney(Number(data.advanceDeductions || 0));
      const pendingAmount = roundMoney(Number(data.pendingAmount || 0));

      let journalEntryId: number | null = null;
      let journalEntryNumber: string | null = null;
      const shouldPostEntry = amount > 0 && ['full_salary', 'bonus', 'advance', 'deduction'].includes(txType);
      if (shouldPostEntry) {
        const salaryAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SALARIES, companyId);
        const salaryPayableAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SALARY_PAYABLE, companyId);
        const lines: any[] = [];

        if (processMode === 'accrue') {
          lines.push(
            { accountId: salaryAccountId, debit: amount, credit: 0, description: ACCOUNTING_LABELS.SALARY_ACCRUAL },
            { accountId: salaryPayableAccountId, debit: 0, credit: amount, description: ACCOUNTING_LABELS.SALARY_PAYABLE },
          );
        } else if (processMode === 'settle') {
          let settleCreditAccountId: number | null = null;
          if (affectCashBox && cashBox) {
            settleCreditAccountId = cashBox?.accountId ? Number(cashBox.accountId) : await resolveSystemAccountId(SYSTEM_ACCOUNTS.CASH, companyId);
          } else {
            settleCreditAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.CASH, companyId);
          }
          lines.push(
            { accountId: salaryPayableAccountId, debit: amount, credit: 0, description: ACCOUNTING_LABELS.SALARY_SETTLEMENT },
            { accountId: settleCreditAccountId, debit: 0, credit: amount, description: ACCOUNTING_LABELS.NET_SALARY_PAID },
          );
        } else {
          let creditAccountId: number | null = null;
          if (affectCashBox && cashBox) {
            creditAccountId = cashBox?.accountId ? Number(cashBox.accountId) : await resolveSystemAccountId(SYSTEM_ACCOUNTS.CASH, companyId);
          } else {
            creditAccountId = salaryPayableAccountId;
          }

          lines.push({ accountId: salaryAccountId, debit: amount, credit: 0, description: ACCOUNTING_LABELS.SALARY_EXPENSE });
          lines.push({ accountId: creditAccountId, debit: 0, credit: amount, description: ACCOUNTING_LABELS.NET_SALARY_PAID });

          if (taxDeductions > 0) {
            const taxAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.TAX_PAYABLE, companyId);
            lines.push({ accountId: taxAccountId, debit: 0, credit: taxDeductions, description: ACCOUNTING_LABELS.TAX_DEDUCTION });
            lines.push({ accountId: creditAccountId, debit: taxDeductions, credit: 0, description: ACCOUNTING_LABELS.TAX_RECLASS });
          }

          if (socialInsurance > 0) {
            const insuranceAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.SOCIAL_INSURANCE, companyId);
            lines.push({ accountId: insuranceAccountId, debit: 0, credit: socialInsurance, description: ACCOUNTING_LABELS.INSURANCE_DEDUCTION });
            lines.push({ accountId: creditAccountId, debit: socialInsurance, credit: 0, description: ACCOUNTING_LABELS.INSURANCE_RECLASS });
          }

          if (advanceDeductions > 0) {
            const advancesAccountId = await resolveSystemAccountId(SYSTEM_ACCOUNTS.ADVANCES, companyId);
            lines.push({ accountId: advancesAccountId, debit: 0, credit: advanceDeductions, description: ACCOUNTING_LABELS.ADVANCE_RECOVERY });
            lines.push({ accountId: creditAccountId, debit: advanceDeductions, credit: 0, description: ACCOUNTING_LABELS.ADVANCE_RECLASS });
          }

          if (pendingAmount > 0) {
            lines.push({ accountId: salaryPayableAccountId, debit: 0, credit: pendingAmount, description: ACCOUNTING_LABELS.PENDING_SALARY });
            lines.push({ accountId: creditAccountId, debit: pendingAmount, credit: 0, description: ACCOUNTING_LABELS.PENDING_RECLASS });
          }
        }

        const mergedMap = new Map<string, any>();
        for (const line of lines) {
          const key = `${line.accountId}|${line.description || ''}`;
          if (!mergedMap.has(key)) mergedMap.set(key, { ...line });
          else {
            const prev = mergedMap.get(key);
            prev.debit = roundMoney(Number(prev.debit || 0) + Number(line.debit || 0));
            prev.credit = roundMoney(Number(prev.credit || 0) + Number(line.credit || 0));
          }
        }

        const mergedLines = Array.from(mergedMap.values()).filter((l: any) => Number(l.debit || 0) || Number(l.credit || 0));
        try {
          const entry = await createJournalEntry({
            description: buildDescription(ACCOUNTING_LABELS.MONTHLY_PAYROLL, ':', employeeName || data.employeeId),
            referenceType: 'payroll',
            referenceId: null,
            entryDate: data.date,
            currencyCode: data.currency || 'SYP',
            companyId,
            branchId,
            lines: mergedLines,
          });
          await postJournalEntry(entry.id);
          journalEntryId = entry.id;
          journalEntryNumber = entry.entryNumber;
        } catch (error: any) {
          throw appError(500, 'PAYROLL_JOURNAL_FAILED', 'فشل ترحيل القيد المحاسبي للرواتب.', {
            employee_id: data.employeeId,
            company_id: companyId,
            branch_id: branchId,
            cause: error?.message || String(error || ''),
          });
        }
      }

      let voucherId: string | null = null;
      if (processMode !== 'accrue' && affectCashBox && cashBox && amount > 0) {
        const categoryMap: Record<string, string> = {
          full_salary: 'صرف راتب',
          advance: 'صرف سلفة',
          bonus: 'صرف مكافأة',
          deduction: 'خصم من الراتب',
        };
        try {
          const voucherData = {
            id: `v-sal-${id}`,
            type: 'payment',
            date: data.date || new Date().toISOString(),
            amount,
            originalAmount: amount,
            currency: data.currency || 'USD',
            exchangeRate: 1,
            cashBoxId: data.cashBoxId,
            cashBoxName: cashBox?.name || 'الصندوق',
            clientId: null,
            clientName: null,
            category: categoryMap[txType] || 'رواتب وأجور',
            description: `${categoryMap[txType] || 'رواتب'} - ${employeeName || data.employeeId}`,
            referenceNumber: id,
            linkedInvoiceId: null,
            companyId,
            branchId,
          };
          const vResult = await createVoucherWithAccounting(voucherData);
          voucherId = vResult?.id || null;
        } catch (error: any) {
          throw appError(500, 'PAYROLL_VOUCHER_FAILED', 'فشل إنشاء سند صرف الرواتب.', {
            employee_id: data.employeeId,
            cash_box_id: data.cashBoxId,
            company_id: companyId,
            branch_id: branchId,
            cause: error?.message || String(error || ''),
          });
        }
      }

      await db.insert(schema.salaryTransactions).values({
        id,
        companyId,
        branchId,
        employeeId: data.employeeId,
        employeeName,
        amount,
        currency: data.currency || 'USD',
        type: txType,
        period: data.period,
        cashBoxId: data.cashBoxId || null,
        journalEntryId,
        journalEntryNumber,
        date: data.date,
        notes: data.notes,
      }).run();

      return { success: true, journalEntryId, journalEntryNumber, voucherId };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
      }
      return reply.status(500).send({ error: error.message });
    }
  });
}
