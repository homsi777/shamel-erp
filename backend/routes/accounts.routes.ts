import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError } from '../lib/errors';
import {
  assertEntityBelongsToAllowedBranch,
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
  hasBranchAccess,
  pickEffectiveBranchId,
  resolveEntityBranchId,
} from '../lib/tenantScope';
import {
  buildCompanyAccountStorageCode,
  getAccountLogicalCode,
} from '../accountingService';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const {
    db,
    schema,
    sql,
    eq,
    desc,
    getAccountBalance,
    createJournalEntry,
    postJournalEntry,
    reverseJournalEntry,
  } = ctx as any;

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const requireCompanyId = (req: any) => {
    const companyId = String(getAuthContext(req).companyId || '').trim();
    if (!companyId) {
      throw appError(401, 'NO_COMPANY_CONTEXT', 'Missing company context.');
    }
    return companyId;
  };

  const getRequestedBranchId = (req: any) => {
    const query = req.query as any;
    const rawBranchId = query?.branchId ?? query?.branch_id;
    const branchId = String(rawBranchId || '').trim();
    return branchId && branchId !== 'all' ? branchId : null;
  };

  const ensureBranchAccess = (req: any, branchId: string | null) => {
    if (!branchId) return null;
    const authContext = getAuthContext(req);
    if (!hasBranchAccess(authContext, branchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'Branch access denied.', {
        branch_id: branchId,
        allowed_branch_ids: authContext.allowedBranchIds || [],
      });
    }
    return branchId;
  };

  const scopeRows = (rows: any[], req: any, collection: string) => {
    const authContext = getAuthContext(req);
    const requestedBranchId = ensureBranchAccess(req, getRequestedBranchId(req));
    let scopedRows = filterRowsByTenantScope(rows, authContext, collection);
    if (requestedBranchId) {
      scopedRows = scopedRows.filter((row: any) => {
        const rowBranchId = resolveEntityBranchId(row);
        return !rowBranchId || rowBranchId === requestedBranchId;
      });
    }
    return scopedRows;
  };

  const toAccountResponse = (account: any) => ({
    ...account,
    code: getAccountLogicalCode(account),
    storageCode: account?.code || null,
  });

  const loadScopedAccounts = async (req: any) =>
    scopeRows(
      await db.select().from(schema.accounts).orderBy(schema.accounts.code).all(),
      req,
      'accounts',
    );

  const loadScopedJournalEntries = async (req: any) =>
    scopeRows(
      await db.select().from(schema.journalEntries).orderBy(desc(schema.journalEntries.entryDate)).all(),
      req,
      'journal-entries',
    );

  const loadScopedJournalLines = async (req: any) =>
    scopeRows(
      await db.select().from(schema.journalEntryLines).all(),
      req,
      'journal-entry-lines',
    );

  const resolveManualAccountBranchId = (req: any, payload: any) => {
    const candidate = String(payload?.branchId || payload?.branch_id || '').trim();
    if (!candidate) return null;
    return ensureBranchAccess(req, candidate);
  };

  const loadAccountsWithBalances = async (req: any, currencyFilter?: string) => {
    const accounts = await loadScopedAccounts(req);
    const entries = await loadScopedJournalEntries(req);
    const lines = await loadScopedJournalLines(req);
    const postedEntryIds = new Set(
      (entries || [])
        .filter((entry: any) => String(entry.status || '').toLowerCase() === 'posted')
        .map((entry: any) => Number(entry.id)),
    );

    const hasCurrencyFilter = currencyFilter && currencyFilter !== 'ALL';
    const useOriginalAmounts = Boolean(hasCurrencyFilter && currencyFilter !== 'USD');
    const balanceMap = new Map<number, { debit: number; credit: number; balance: number }>();

    for (const line of lines || []) {
      if (!postedEntryIds.has(Number(line.journalEntryId || 0))) continue;
      const lineCurrency = String(line.currencyCode || 'USD');
      if (hasCurrencyFilter && lineCurrency !== currencyFilter) continue;
      const debit = useOriginalAmounts
        ? (Number(line.debit || 0) > 0 ? Number(line.amountInCurrency || line.debit || 0) : 0)
        : Number(line.debit || 0);
      const credit = useOriginalAmounts
        ? (Number(line.credit || 0) > 0 ? Number(line.amountInCurrency || line.credit || 0) : 0)
        : Number(line.credit || 0);
      const previous = balanceMap.get(Number(line.accountId)) || { debit: 0, credit: 0, balance: 0 };
      previous.debit += debit;
      previous.credit += credit;
      previous.balance = previous.debit - previous.credit;
      balanceMap.set(Number(line.accountId), previous);
    }

    const usedCurrencies = Array.from(new Set(
      (lines || [])
        .filter((line: any) => postedEntryIds.has(Number(line.journalEntryId || 0)))
        .map((line: any) => String(line.currencyCode || 'USD')),
    ));

    const accountList = (accounts || []).map((account: any) => {
      const totals = balanceMap.get(Number(account.id));
      return {
        ...toAccountResponse(account),
        totalDebit: Number(totals?.debit || 0),
        totalCredit: Number(totals?.credit || 0),
        balance: Number(totals?.balance || 0),
      };
    });

    const accountById = new Map<number, any>(accountList.map((account: any) => [Number(account.id), account]));
    const maxLevel = Math.max(...accountList.map((account: any) => Number(account.level || 1)), 1);
    for (let level = maxLevel; level >= 1; level -= 1) {
      for (const account of accountList) {
        if (Number(account.level || 1) !== level) continue;
        if (!account.parentId) continue;
        const parent = accountById.get(Number(account.parentId));
        if (!parent) continue;
        parent.totalDebit = Number(parent.totalDebit || 0) + Number(account.totalDebit || 0);
        parent.totalCredit = Number(parent.totalCredit || 0) + Number(account.totalCredit || 0);
        parent.balance = Number(parent.balance || 0) + Number(account.balance || 0);
      }
    }

    return { accounts: accountList, usedCurrencies };
  };

  api.get('/accounts', async (req, reply) => {
    try {
      requireCompanyId(req);
      const currency = String((req.query as any)?.currency || 'ALL');
      return await loadAccountsWithBalances(req, currency);
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      console.error('Error loading accounts with balances:', error?.message || error);
      return reply.status(500).send({ error: error?.message || 'Failed to load accounts', accounts: [], usedCurrencies: [] });
    }
  });

  api.get('/accounts/balances-summary', async (req, reply) => {
    try {
      requireCompanyId(req);
      const accounts = await loadScopedAccounts(req);
      const lines = await loadScopedJournalLines(req);
      const entries = await loadScopedJournalEntries(req);
      const postedEntryIds = new Set(
        (entries || [])
          .filter((entry: any) => String(entry.status || '').toLowerCase() === 'posted')
          .map((entry: any) => Number(entry.id)),
      );

      const totalsByAccount = new Map<number, { debit: number; credit: number }>();
      for (const line of lines || []) {
        if (!postedEntryIds.has(Number(line.journalEntryId || 0))) continue;
        const previous = totalsByAccount.get(Number(line.accountId)) || { debit: 0, credit: 0 };
        previous.debit += Number(line.debit || 0);
        previous.credit += Number(line.credit || 0);
        totalsByAccount.set(Number(line.accountId), previous);
      }

      const accountMap = new Map<number, any>((accounts || []).map((account: any) => [Number(account.id), account]));
      const summary = Array.from(totalsByAccount.entries())
        .map(([accountId, totals]) => {
          const account = accountMap.get(Number(accountId));
          if (!account) return null;
          return {
            accountId: Number(accountId),
            code: getAccountLogicalCode(account),
            name: account?.nameAr || '?',
            type: account?.accountType || '?',
            debit: Number(totals.debit || 0),
            credit: Number(totals.credit || 0),
            balance: Number(totals.debit || 0) - Number(totals.credit || 0),
          };
        })
        .filter(Boolean)
        .filter((row: any) => row.debit > 0 || row.credit > 0)
        .sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));

      const totalDebit = summary.reduce((sum: number, row: any) => sum + Number(row.debit || 0), 0);
      const totalCredit = summary.reduce((sum: number, row: any) => sum + Number(row.credit || 0), 0);

      return {
        accounts: summary,
        totals: {
          debit: totalDebit,
          credit: totalCredit,
          balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        },
      };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(500).send({
        error: error?.message || 'failed',
        accounts: [],
        totals: { debit: 0, credit: 0, balanced: true },
      });
    }
  });

  api.get('/accounts/:id', async (req, reply) => {
    const accountId = Number((req.params as any)?.id);
    const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    try {
      assertEntityBelongsToCompany(account, requireCompanyId(req), 'Account not found');
      assertEntityBelongsToAllowedBranch(account, getAuthContext(req), 'Account not found');
      const balance = await getAccountBalance(accountId);
      return { ...toAccountResponse(account), balance };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(400).send({ error: error?.message || 'Failed to load account' });
    }
  });

  api.get('/accounts/:id/statement', async (req, reply) => {
    const accountId = Number((req.params as any)?.id);
    const currencyFilter = String((req.query as any)?.currency || 'ALL');
    const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    try {
      assertEntityBelongsToCompany(account, requireCompanyId(req), 'Account not found');
      assertEntityBelongsToAllowedBranch(account, getAuthContext(req), 'Account not found');

      const accounts = await loadScopedAccounts(req);
      const accountMap = new Map<number, any>((accounts || []).map((row: any) => [Number(row.id), row]));
      const targetAccountIds = new Set<number>([accountId]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const row of accounts || []) {
          const rowId = Number((row as any).id || 0);
          const parentId = Number((row as any).parentId || 0);
          if (parentId && targetAccountIds.has(parentId) && !targetAccountIds.has(rowId)) {
            targetAccountIds.add(rowId);
            expanded = true;
          }
        }
      }

      const entries = await loadScopedJournalEntries(req);
      const postedEntryById = new Map<number, any>(
        (entries || [])
          .filter((entry: any) => {
            const date = String(entry.entryDate || '');
            return String(entry.status || '').toLowerCase() === 'posted'
              && date >= String((req.query as any)?.from || (req.query as any)?.fromDate || '2000-01-01')
              && date <= String((req.query as any)?.to || (req.query as any)?.toDate || '2100-12-31');
          })
          .map((entry: any) => [Number(entry.id), entry]),
      );
      const lines = await loadScopedJournalLines(req);

      const statementRows = (lines || [])
        .filter((line: any) => targetAccountIds.has(Number(line.accountId || 0)))
        .filter((line: any) => postedEntryById.has(Number(line.journalEntryId || 0)))
        .filter((line: any) => currencyFilter === 'ALL' || String(line.currencyCode || 'USD') === currencyFilter)
        .map((line: any) => {
          const entry = postedEntryById.get(Number(line.journalEntryId || 0));
          return {
            accountId: Number(line.accountId || 0),
            accountCode: getAccountLogicalCode(accountMap.get(Number(line.accountId || 0))),
            entryId: entry.id,
            entryNumber: entry.entryNumber,
            entryDate: entry.entryDate,
            description: line.description || entry.description,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0),
            currencyCode: String(line.currencyCode || entry.currencyCode || 'USD'),
            amountInCurrency: Number(line.amountInCurrency || 0),
          };
        })
        .sort((a: any, b: any) => String(a.entryDate).localeCompare(String(b.entryDate)));

      let runningBalance = 0;
      for (const row of statementRows as any[]) {
        runningBalance += Number(row.debit || 0) - Number(row.credit || 0);
        row.runningBalance = runningBalance;
      }

      return {
        account: toAccountResponse(account),
        lines: statementRows,
        totalDebit: statementRows.reduce((sum: number, row: any) => sum + Number(row.debit || 0), 0),
        totalCredit: statementRows.reduce((sum: number, row: any) => sum + Number(row.credit || 0), 0),
        balance: runningBalance,
      };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(400).send({ error: error?.message || 'Failed to load account statement' });
    }
  });

  api.post('/accounts', async (req, reply) => {
    try {
      const companyId = requireCompanyId(req);
      const data = req.body as any;
      if (!data.code || !data.nameAr || !data.accountType || !data.accountNature) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const logicalCode = getAccountLogicalCode({ code: data.code, lookupCode: data.lookupCode });
      if (!logicalCode) {
        return reply.status(400).send({ error: 'Account code is required' });
      }

      if (data.parentId) {
        const parent = await db.select().from(schema.accounts).where(eq(schema.accounts.id, Number(data.parentId))).get();
        if (!parent) return reply.status(404).send({ error: 'Parent account not found' });
        assertEntityBelongsToCompany(parent, companyId, 'Parent account not found');
      }

      const duplicate = await db.select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(sql`
          ${schema.accounts.companyId} = ${companyId}
          AND (
            ${schema.accounts.lookupCode} = ${logicalCode}
            OR ${schema.accounts.code} = ${logicalCode}
            OR ${schema.accounts.code} = ${buildCompanyAccountStorageCode(companyId, logicalCode)}
          )
        `)
        .get();
      if (duplicate?.id) {
        return reply.status(409).send({ error: 'Account code already exists in this company' });
      }

      const branchId = resolveManualAccountBranchId(req, data);
      const payload = {
        companyId,
        code: buildCompanyAccountStorageCode(companyId, logicalCode),
        lookupCode: logicalCode,
        nameAr: String(data.nameAr).trim(),
        nameEn: data.nameEn || null,
        parentId: data.parentId ? Number(data.parentId) : null,
        level: Number(data.level || 1),
        accountType: String(data.accountType),
        accountNature: String(data.accountNature),
        isParent: Boolean(data.isParent),
        isActive: data.isActive !== false,
        isSystem: Boolean(data.isSystem),
        currencyCode: data.currencyCode || 'SYP',
        branchId,
        notes: data.notes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(schema.accounts).values(payload).run();
      return { success: true };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(500).send({ error: error?.message || 'Failed to create account' });
    }
  });

  api.put('/accounts/:id', async (req, reply) => {
    try {
      const companyId = requireCompanyId(req);
      const accountId = Number((req.params as any)?.id);
      const existing = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
      if (!existing) return reply.status(404).send({ error: 'Account not found' });
      assertEntityBelongsToCompany(existing, companyId, 'Account not found');

      const data = req.body as any;
      const logicalCode = data.code !== undefined || data.lookupCode !== undefined
        ? getAccountLogicalCode({ code: data.code, lookupCode: data.lookupCode })
        : getAccountLogicalCode(existing);
      if (!logicalCode) {
        return reply.status(400).send({ error: 'Account code is required' });
      }

      if (data.parentId) {
        const parent = await db.select().from(schema.accounts).where(eq(schema.accounts.id, Number(data.parentId))).get();
        if (!parent) return reply.status(404).send({ error: 'Parent account not found' });
        assertEntityBelongsToCompany(parent, companyId, 'Parent account not found');
      }

      const duplicate = await db.select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(sql`
          ${schema.accounts.companyId} = ${companyId}
          AND ${schema.accounts.id} <> ${accountId}
          AND (
            ${schema.accounts.lookupCode} = ${logicalCode}
            OR ${schema.accounts.code} = ${logicalCode}
            OR ${schema.accounts.code} = ${buildCompanyAccountStorageCode(companyId, logicalCode)}
          )
        `)
        .get();
      if (duplicate?.id) {
        return reply.status(409).send({ error: 'Account code already exists in this company' });
      }

      const branchId = data.branchId !== undefined || data.branch_id !== undefined
        ? resolveManualAccountBranchId(req, data)
        : existing.branchId || null;

      await db.update(schema.accounts).set({
        companyId,
        code: buildCompanyAccountStorageCode(companyId, logicalCode),
        lookupCode: logicalCode,
        nameAr: data.nameAr ?? existing.nameAr,
        nameEn: data.nameEn ?? existing.nameEn,
        parentId: data.parentId !== undefined ? (data.parentId ? Number(data.parentId) : null) : existing.parentId,
        level: data.level !== undefined ? Number(data.level) : existing.level,
        accountType: data.accountType ?? existing.accountType,
        accountNature: data.accountNature ?? existing.accountNature,
        isParent: data.isParent ?? existing.isParent,
        isActive: data.isActive ?? existing.isActive,
        branchId,
        notes: data.notes ?? existing.notes,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.accounts.id, accountId)).run();

      return { success: true };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(500).send({ error: error?.message || 'Failed to update account' });
    }
  });

  api.delete('/accounts/:id', async (req, reply) => {
    try {
      const companyId = requireCompanyId(req);
      const accountId = Number((req.params as any)?.id);
      const existing = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
      if (!existing) return reply.status(404).send({ error: 'Account not found' });
      assertEntityBelongsToCompany(existing, companyId, 'Account not found');
      if (existing.isSystem) return reply.status(403).send({ error: 'System account cannot be deleted' });

      const children = await db.select().from(schema.accounts).where(eq(schema.accounts.parentId, accountId)).all();
      if (children.some((child: any) => String(child.companyId || '') === companyId)) {
        return reply.status(400).send({ error: 'Account has children' });
      }

      const hasLines = await db.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.accountId, accountId)).get();
      if (hasLines) return reply.status(400).send({ error: 'Account has journal activity' });

      await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run();
      return { success: true };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(500).send({ error: error?.message || 'Failed to delete account' });
    }
  });

  api.get('/journal-entries', async (req, reply) => {
    try {
      requireCompanyId(req);
      const query = req.query as any;
      const fromDate = query?.from || query?.fromDate;
      const toDate = query?.to || query?.toDate;
      const entries = await loadScopedJournalEntries(req);
      return (entries || []).filter((entry: any) => {
        const date = String(entry.entryDate || '');
        if (fromDate && date < String(fromDate)) return false;
        if (toDate && date > String(toDate)) return false;
        return true;
      });
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(500).send({ error: error?.message || 'Failed to load journal entries' });
    }
  });

  api.post('/journal-entries', async (req, reply) => {
    try {
      const companyId = requireCompanyId(req);
      const authContext = getAuthContext(req);
      const data = req.body as any;
      const branchId = ensureBranchAccess(
        req,
        pickEffectiveBranchId(data.branchId ?? data.branch_id, authContext) || null,
      );
      const entry = await createJournalEntry({
        description: data.description,
        referenceType: data.referenceType || 'manual',
        referenceId: data.referenceId || null,
        lines: data.lines || [],
        branchId,
        companyId,
        currencyCode: data.currencyCode || 'SYP',
        entryDate: data.entryDate,
        createdBy: data.createdBy || null,
      });
      return { success: true, entry };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(400).send({ error: error?.message || 'Failed to create entry' });
    }
  });

  api.get('/journal-entries/:id', async (req, reply) => {
    const entryId = Number((req.params as any)?.id);
    const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
    if (!entry) return reply.status(404).send({ error: 'Entry not found' });

    try {
      assertEntityBelongsToCompany(entry, requireCompanyId(req), 'Entry not found');
      assertEntityBelongsToAllowedBranch(entry, getAuthContext(req), 'Entry not found');
      const lines = (await db.select().from(schema.journalEntryLines).where(eq(schema.journalEntryLines.journalEntryId, entryId)).all())
        .filter((line: any) => String(line.companyId || '') === String(entry.companyId || ''));
      return { ...entry, lines };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(400).send({ error: error?.message || 'Failed to load entry' });
    }
  });

  api.post('/journal-entries/:id/post', async (req, reply) => {
    try {
      const entryId = Number((req.params as any)?.id);
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
      if (!entry) return reply.status(404).send({ error: 'Entry not found' });
      assertEntityBelongsToCompany(entry, requireCompanyId(req), 'Entry not found');
      assertEntityBelongsToAllowedBranch(entry, getAuthContext(req), 'Entry not found');
      await postJournalEntry(entryId);
      return { success: true };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(400).send({ error: error?.message || 'Failed to post entry' });
    }
  });

  api.post('/journal-entries/:id/reverse', async (req, reply) => {
    try {
      const entryId = Number((req.params as any)?.id);
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
      if (!entry) return reply.status(404).send({ error: 'Entry not found' });
      assertEntityBelongsToCompany(entry, requireCompanyId(req), 'Entry not found');
      assertEntityBelongsToAllowedBranch(entry, getAuthContext(req), 'Entry not found');
      const reversed = await reverseJournalEntry(entryId, (req.body as any)?.reason || '');
      return { success: true, reversed };
    } catch (error: any) {
      if (error?.statusCode) return reply.status(error.statusCode).send(error.payload || { error: error.message });
      return reply.status(400).send({ error: error?.message || 'Failed to reverse entry' });
    }
  });
}
