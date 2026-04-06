import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { BASE_CURRENCY, normalizeExchangeRate, toTransactionAmount } from '../lib/currency';
import { appError, isAppError } from '../lib/errors';
import {
  assertEntityBelongsToCompany,
  filterRowsByTenantScope,
} from '../lib/tenantScope';
import { ensurePartyAccountLinks } from '../services/partnerAccountEnforcement';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, parseMultiCurrencyError, recomputePartyBalance, roundMoney } = ctx as any;

  const getAuthContext = (req: any) => (req as any).authContext || {};

  const ensureCompanyWideMutationScope = (req: any) => {
    const authContext = getAuthContext(req);
    if (String(authContext.branchScope || '').trim().toLowerCase() !== 'company_wide') {
      throw appError(
        403,
        'COMPANY_SCOPE_REQUIRED',
        'هذه العملية تعدل أرصدة الذمم على مستوى المؤسسة وتتطلب صلاحية مؤسسة كاملة أو صلاحية مدير.',
      );
    }
    return authContext;
  };

  const withScopedParty = async (partyId: string, req: any, notFoundMessage = 'Party not found.') => {
    const party = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get();
    if (!party) return null;
    const authContext = getAuthContext(req);
    assertEntityBelongsToCompany(party, String(authContext.companyId || ''), notFoundMessage);
    return party;
  };

  const hasManageClientsPermission = async (req: any) => {
    try {
      await req.jwtVerify();
    } catch {
      return { ok: false, status: 401, error: 'غير مصرح' };
    }

    const userId = req?.user?.id;
    if (!userId) return { ok: false, status: 401, error: 'غير مصرح' };
    const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return { ok: false, status: 401, error: 'غير مصرح' };
    if (user.role === 'admin') return { ok: true };

    const perms = String(user.permissions || '')
      .split(',')
      .map((v: string) => String(v || '').trim())
      .filter(Boolean);
    if (perms.includes('manage_clients') || perms.includes('*')) return { ok: true };
    return { ok: false, status: 403, error: 'صلاحيات غير كافية' };
  };

  const buildPartyStatementInternal = async (
    partyId: string,
    fromDate: string,
    toDate: string,
    authContext: any,
    currencyFilter?: string,
  ) => {
    const party = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get();
    if (!party) throw new Error('Party not found.');
    assertEntityBelongsToCompany(party, String(authContext.companyId || ''), 'Party not found.');

    const rows = filterRowsByTenantScope(
      await db.select().from(schema.partyTransactions).where(eq(schema.partyTransactions.partyId, partyId)).all(),
      authContext,
      'party-transactions',
    );
    const ptRefIds = new Set((rows || []).map((r: any) => r.refId).filter(Boolean));

    const partyInvoices = filterRowsByTenantScope(
      await db.select().from(schema.invoices).where(eq(schema.invoices.clientId, partyId)).all(),
      authContext,
      'invoices',
    );
    const partyVouchers = filterRowsByTenantScope(
      await db.select().from(schema.vouchers).where(eq(schema.vouchers.clientId, partyId)).all(),
      authContext,
      'vouchers',
    );
    const partyVoucherById = new Map<string, any>((partyVouchers || []).map((v: any) => [String(v.id), v]));
    const partyInvoiceById = new Map<string, any>((partyInvoices || []).map((inv: any) => [String(inv.id), inv]));
    const linkedVouchersByInvoiceId = new Map<string, any[]>();
    for (const voucher of partyVouchers || []) {
      const linkedId = String((voucher as any).linkedInvoiceId ?? (voucher as any).linked_invoice_id ?? '').trim();
      if (!linkedId) continue;
      const bucket = linkedVouchersByInvoiceId.get(linkedId);
      if (bucket) bucket.push(voucher);
      else linkedVouchersByInvoiceId.set(linkedId, [voucher]);
    }

    const allEntries: any[] = [];
    const isDateOnly = (value: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
    const toDateKey = (value: any) => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      if (isDateOnly(raw)) return raw;
      const dt = new Date(raw);
      if (Number.isFinite(dt.getTime())) return dt.toISOString().slice(0, 10);
      return raw.slice(0, 10);
    };
    const toSortTs = (value: any) => {
      const raw = String(value || '').trim();
      if (!raw) return 0;
      const asDate = isDateOnly(raw) ? `${raw}T12:00:00.000Z` : raw;
      const dt = new Date(asDate);
      return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
    };

    const invoiceBaseAmount = (inv: any) => Number((inv as any)?.totalAmountBase ?? (inv as any)?.totalAmount ?? 0);
    const invoiceTxnAmount = (inv: any) => {
      const explicit = Number((inv as any)?.totalAmountTransaction ?? (inv as any)?.originalAmount ?? 0);
      if (explicit > 0) return explicit;
      const base = invoiceBaseAmount(inv);
      const currency = String((inv as any)?.currency || BASE_CURRENCY).toUpperCase();
      const rate = normalizeExchangeRate(currency, (inv as any)?.exchangeRate);
      return currency === BASE_CURRENCY ? base : toTransactionAmount(base, currency, rate);
    };
    const approxEqual = (a: number, b: number, epsilon = 0.05) => Math.abs(Number(a || 0) - Number(b || 0)) <= epsilon;
    const normalizePaymentTerm = (value: any) => {
      const norm = String(value || '').trim().toLowerCase();
      return ['credit', 'ajel'].includes(norm) ? 'credit' : 'cash';
    };
    const isSupplier = String(party.type || '').toUpperCase() === 'SUPPLIER';
    const invoiceDirectionSign = (invType: string) => {
      const t = String(invType || '').toLowerCase();
      if (t === 'purchase') return isSupplier ? 1 : -1;
      if (t === 'sale') return isSupplier ? -1 : 1;
      return 0;
    };

    for (const r of rows || []) {
      const kind = String((r as any).kind || '');
      const refId = String((r as any).refId || '');
      const linkedVoucher = refId ? partyVoucherById.get(refId) : null;
      const fallbackVoucherTime = linkedVoucher ? ((linkedVoucher as any).createdAt || (linkedVoucher as any).date || null) : null;
      const rowCreatedAtRaw = (r as any).createdAt;
      const createdAt = kind.startsWith('voucher_') && isDateOnly(rowCreatedAtRaw) && fallbackVoucherTime
        ? fallbackVoucherTime
        : rowCreatedAtRaw;

      if ((kind === 'invoice_sale' || kind === 'invoice_purchase') && refId) {
        const inv = partyInvoiceById.get(refId);
        if (inv) {
          const invType = String((inv as any).type || '').toLowerCase();
          const sign = invoiceDirectionSign(invType);
          const paymentTerm = normalizePaymentTerm(
            (inv as any).paymentType || (Number((inv as any).remainingAmountBase ?? (inv as any).remainingAmount ?? 0) > 0 ? 'credit' : 'cash'),
          );
          const linkedVouchers = linkedVouchersByInvoiceId.get(refId) || [];
          const hasLinkedPaymentVoucher = linkedVouchers.some((v: any) => {
            const vt = String((v as any).type || '').toLowerCase();
            return (invType === 'purchase' && vt === 'payment') || (invType === 'sale' && vt === 'receipt');
          });

          const totalBase = invoiceBaseAmount(inv);
          const remainingBase = Number((inv as any).remainingAmountBase ?? (inv as any).remainingAmount ?? 0);
          const paidBaseRaw = Number((inv as any).paidAmountBase ?? (inv as any).paidAmount ?? 0);
          const paidBase = paidBaseRaw > 0 ? paidBaseRaw : Math.max(roundMoney(totalBase - remainingBase), 0);
          const rowDeltaBase = Number((r as any).deltaBase ?? r.delta ?? 0);
          const expectedLegacyDeltaBase = roundMoney(sign * remainingBase);
          const expectedCanonicalDeltaBase = roundMoney(sign * totalBase);
          const looksLegacyRemainingOnly =
            sign !== 0
            && paymentTerm === 'credit'
            && paidBase > 0
            && !hasLinkedPaymentVoucher
            && approxEqual(rowDeltaBase, expectedLegacyDeltaBase)
            && !approxEqual(rowDeltaBase, expectedCanonicalDeltaBase);

          if (looksLegacyRemainingOnly) {
            const totalTxn = invoiceTxnAmount(inv);
            const paidTxnRaw = Number((inv as any).paidAmountTransaction ?? (inv as any).paidAmountOriginal ?? 0);
            const remainingTxnRaw = Number((inv as any).remainingAmountTransaction ?? 0);
            const paidTxn = paidTxnRaw > 0
              ? paidTxnRaw
              : toTransactionAmount(paidBase, (inv as any).currency || BASE_CURRENCY, (inv as any).exchangeRate || 1);
            const remainingTxn = remainingTxnRaw > 0 ? remainingTxnRaw : Math.max(roundMoney(totalTxn - paidTxn), 0);
            const expectedLegacyDeltaTxn = roundMoney(sign * remainingTxn);
            const expectedCanonicalDeltaTxn = roundMoney(sign * totalTxn);
            const paidDeltaBase = roundMoney(expectedLegacyDeltaBase - expectedCanonicalDeltaBase);
            const paidDeltaTxn = roundMoney(expectedLegacyDeltaTxn - expectedCanonicalDeltaTxn);
            const adjustedCurrency = (inv as any).currency || r.currency || 'USD';
            const adjustedRate = Number((inv as any).exchangeRate || (r as any).exchangeRate || 1);

            allEntries.push({
              id: String(inv.id || ''),
              rowId: `legacy-invoice-${r.id}`,
              rowType: 'legacy',
              documentType: 'invoice',
              documentId: String(inv.id || ''),
              kind: r.kind,
              refId: r.refId,
              deltaBase: expectedCanonicalDeltaBase,
              deltaTransaction: expectedCanonicalDeltaTxn,
              createdAt,
              currency: adjustedCurrency,
              exchangeRate: adjustedRate,
              source: 'ledger_legacy_invoice_adjusted',
            });

            if (!approxEqual(paidDeltaBase, 0) || !approxEqual(paidDeltaTxn, 0)) {
              const baseTs = toSortTs(createdAt);
              const paidAt = baseTs > 0 ? new Date(baseTs + 1000).toISOString() : createdAt;
              allEntries.push({
                id: String(inv.id || ''),
                rowId: `legacy-paid-${r.id}`,
                rowType: 'legacy',
                documentType: 'invoice',
                documentId: String(inv.id || ''),
                kind: invType === 'purchase' ? 'voucher_payment' : 'voucher_receipt',
                refId: `legacy-paid-${refId}`,
                deltaBase: paidDeltaBase,
                deltaTransaction: paidDeltaTxn,
                createdAt: paidAt,
                currency: adjustedCurrency,
                exchangeRate: adjustedRate,
                source: 'ledger_legacy_paid_split',
              });
            }
            continue;
          }
        }
      }

      allEntries.push({
        id: String(r.id || ''),
        rowId: String(r.id || ''),
        rowType: 'transaction',
        documentType: 'transaction',
        documentId: String(r.id || ''),
        kind: r.kind,
        refId: r.refId,
        deltaBase: Number((r as any).deltaBase ?? r.delta ?? 0),
        deltaTransaction: Number((r as any).deltaTransaction ?? r.delta ?? 0),
        createdAt,
        currency: r.currency || 'USD',
        exchangeRate: Number((r as any).exchangeRate || 1),
        source: 'ledger',
      });
    }

    for (const inv of partyInvoices || []) {
      if (ptRefIds.has(inv.id)) continue;
      const invType = String((inv as any).type || '');
      if (!['sale', 'purchase', 'return', 'exchange'].includes(invType)) continue;
      const totalBase = invoiceBaseAmount(inv);
      const totalTransaction = invoiceTxnAmount(inv);
      if (totalBase === 0 && totalTransaction === 0) continue;
      let deltaBase = 0;
      if (invType === 'sale') deltaBase = isSupplier ? -totalBase : totalBase;
      else if (invType === 'purchase') deltaBase = isSupplier ? totalBase : -totalBase;
      else if (invType === 'return') deltaBase = isSupplier ? -totalBase : -totalBase;
      const deltaTransaction = totalBase === 0 ? 0 : roundMoney((deltaBase / totalBase) * totalTransaction);
      const retType = String((inv as any).returnType || (inv as any).return_type || '').toLowerCase();
      const returnKind = retType === 'sale' ? 'invoice_return_sale' : retType === 'purchase' ? 'invoice_return_purchase' : 'invoice_return';
      allEntries.push({
        id: String(inv.id || ''),
        rowId: `invoice-${inv.id}`,
        rowType: 'invoice',
        documentType: 'invoice',
        documentId: String(inv.id || ''),
        kind: invType === 'sale' ? 'invoice_sale' : invType === 'purchase' ? 'invoice_purchase' : returnKind,
        refId: inv.id,
        deltaBase,
        deltaTransaction,
        createdAt: (inv as any).createdAt || (inv as any).date,
        currency: (inv as any).currency || 'USD',
        exchangeRate: Number((inv as any).exchangeRate || 1),
        source: 'invoice',
      });
    }

    for (const v of partyVouchers || []) {
      if (ptRefIds.has(v.id)) continue;
      const vType = String(v.type || '');
      if (!['receipt', 'payment'].includes(vType)) continue;
      const vCurrency = String(v.currency || BASE_CURRENCY).toUpperCase();
      const voucherBase = Number((v as any).amountBase ?? v.amount ?? 0);
      const voucherTxn = Number((v as any).amountTransaction ?? (v as any).originalAmount ?? 0)
        || (vCurrency === BASE_CURRENCY ? voucherBase : toTransactionAmount(voucherBase, vCurrency, (v as any).exchangeRate || 1));
      if (voucherBase === 0 && voucherTxn === 0) continue;
      let deltaBase = 0;
      if (vType === 'receipt') deltaBase = isSupplier ? voucherBase : -voucherBase;
      else if (vType === 'payment') deltaBase = isSupplier ? -voucherBase : voucherBase;
      const deltaTransaction = voucherBase === 0 ? 0 : roundMoney((deltaBase / voucherBase) * voucherTxn);
      allEntries.push({
        id: String(v.id || ''),
        rowId: `voucher-${v.id}`,
        rowType: 'voucher',
        documentType: 'voucher',
        documentId: String(v.id || ''),
        kind: vType,
        refId: v.id,
        deltaBase,
        deltaTransaction,
        createdAt: (v as any).createdAt || v.date,
        currency: vCurrency,
        exchangeRate: Number((v as any).exchangeRate || 1),
        source: 'voucher',
      });
    }

    const dateFiltered = allEntries.filter((r: any) => {
      const d = toDateKey(r.createdAt);
      if (!d) return false;
      return d >= String(fromDate || '2000-01-01') && d <= String(toDate || '2100-12-31');
    });

    const filtered = (currencyFilter && currencyFilter !== 'ALL')
      ? dateFiltered.filter((r: any) => (r.currency || 'USD') === currencyFilter)
      : dateFiltered;

    filtered.sort((a: any, b: any) => {
      const diff = toSortTs(a.createdAt) - toSortTs(b.createdAt);
      if (diff !== 0) return diff;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });

    const labelForKind = (kind: string) => {
      const k = String(kind || '').toLowerCase();
      if (k.includes('return') && k.includes('sale')) return 'فاتورة مرتجع مبيعات';
      if (k.includes('return') && k.includes('purchase')) return 'فاتورة مرتجع مشتريات';
      if (k.includes('return')) return 'فاتورة مرتجع';
      if (k.includes('sale')) return 'فاتورة مبيعات';
      if (k.includes('purchase')) return 'فاتورة مشتريات';
      if (k.includes('receipt')) return 'سند قبض';
      if (k.includes('payment')) return 'سند دفع';
      if (k.includes('opening')) return 'رصيد افتتاحي';
      if (k.includes('transfer')) return 'تحويل';
      return 'حركة مالية';
    };

    const invoiceItemsMap = new Map<string, any[]>();
    for (const inv of partyInvoices || []) {
      try {
        const rawItems = (inv as any).items;
        if (rawItems) {
          const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
          if (Array.isArray(parsed) && parsed.length > 0) {
            invoiceItemsMap.set(inv.id, parsed.map((it: any) => ({
              name: it.itemName || it.name || '',
              qty: Number(it.quantity || it.qty || 0),
              price: Number(it.price || it.unitPrice || 0),
              total: Number(it.total || it.lineTotal || (it.quantity || it.qty || 0) * (it.price || it.unitPrice || 0)),
            })));
          }
        }
      } catch {}
    }

    let running = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const viewCurrency = currencyFilter && currencyFilter !== 'ALL' ? String(currencyFilter).toUpperCase() : BASE_CURRENCY;

    const lines = filtered.map((r: any) => {
      const rowId = String(r.rowId || r.id || '');
      const rowType = String(r.rowType || '');
      const documentType = String(r.documentType || (rowType ? rowType : 'transaction'));
      const documentId = String(r.documentId || r.id || '');
      const delta = viewCurrency === BASE_CURRENCY ? Number(r.deltaBase || 0) : Number(r.deltaTransaction || 0);
      let debit = 0;
      let credit = 0;
      if (isSupplier) {
        if (delta > 0) credit = delta;
        if (delta < 0) debit = Math.abs(delta);
      } else {
        if (delta > 0) debit = delta;
        if (delta < 0) credit = Math.abs(delta);
      }
      totalDebit += debit;
      totalCredit += credit;
      running += debit - credit;
      return {
        id: rowId,
        rowId,
        rowType: rowType || documentType,
        documentType: documentType || 'transaction',
        documentId,
        kind: r.kind,
        refId: r.refId,
        date: r.createdAt,
        description: labelForKind(r.kind),
        debit,
        credit,
        balance: running,
        currencyCode: r.currency || 'SYP',
        invoiceItems: documentType === 'invoice' && documentId ? (invoiceItemsMap.get(documentId) || null) : null,
      };
    });

    const perCurrencyTotals: Record<string, { debit: number; credit: number; balance: number }> = {};
    for (const r of dateFiltered) {
      const cur = r.currency || 'USD';
      if (!perCurrencyTotals[cur]) perCurrencyTotals[cur] = { debit: 0, credit: 0, balance: 0 };
      const delta = Number(r.deltaTransaction ?? r.deltaBase ?? 0);
      let debit = 0;
      let credit = 0;
      if (isSupplier) {
        if (delta > 0) credit = delta;
        if (delta < 0) debit = Math.abs(delta);
      } else {
        if (delta > 0) debit = delta;
        if (delta < 0) credit = Math.abs(delta);
      }
      perCurrencyTotals[cur].debit += debit;
      perCurrencyTotals[cur].credit += credit;
      perCurrencyTotals[cur].balance += debit - credit;
    }

    for (const cur of Object.keys(perCurrencyTotals)) {
      perCurrencyTotals[cur].debit = roundMoney(perCurrencyTotals[cur].debit);
      perCurrencyTotals[cur].credit = roundMoney(perCurrencyTotals[cur].credit);
      perCurrencyTotals[cur].balance = roundMoney(perCurrencyTotals[cur].balance);
    }

    return {
      party: { id: party.id, name: party.name, type: party.type },
      lines,
      totals: { debit: roundMoney(totalDebit), credit: roundMoney(totalCredit), balance: roundMoney(running) },
      perCurrencyTotals,
      currencyFilter: currencyFilter || 'ALL',
      currency: currencyFilter && currencyFilter !== 'ALL' ? currencyFilter : (lines[0]?.currencyCode || 'USD'),
    };
  };

  api.get('/parties/:id', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const party = await withScopedParty(String(id || ''), req, 'الطرف غير موجود.');
      if (!party) return reply.status(404).send({ error: 'الطرف غير موجود.' });
      return party;
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e?.message || 'PARTY_FETCH_FAILED' });
    }
  });

  api.get('/customers/:id/statement', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const q = req.query as any;
      const fromDate = q.from || q.fromDate || '2000-01-01';
      const toDate = q.to || q.toDate || '2100-12-31';
      const currency = q.currency || 'ALL';
      return await buildPartyStatementInternal(String(id), fromDate, toDate, getAuthContext(req), currency);
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  api.get('/suppliers/:id/statement', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const q = req.query as any;
      const fromDate = q.from || q.fromDate || '2000-01-01';
      const toDate = q.to || q.toDate || '2100-12-31';
      const currency = q.currency || 'ALL';
      return await buildPartyStatementInternal(String(id), fromDate, toDate, getAuthContext(req), currency);
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  api.get('/customers/:id/balance', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const party = await withScopedParty(String(id || ''), req);
      if (!party) return reply.status(404).send({ error: 'Party not found.' });
      return { balance: Number(party.balance || 0) };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  api.get('/suppliers/:id/balance', async (req, reply) => {
    try {
      const { id } = req.params as any;
      const party = await withScopedParty(String(id || ''), req);
      if (!party) return reply.status(404).send({ error: 'Party not found.' });
      return { balance: Number(party.balance || 0) };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  const handleUpdateParty = async (req: any, reply: any) => {
    try {
      const auth = await hasManageClientsPermission(req);
      if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

      const { id } = req.params as any;
      const body = (req.body || {}) as any;
      const existing = await withScopedParty(String(id || ''), req);
      if (!existing) return reply.status(404).send({ error: 'Party not found.' });

      const pick = (...keys: string[]) => {
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
        }
        return undefined;
      };

      const patch: any = {};
      const assignIfDefined = (key: string, value: any) => {
        if (value !== undefined) patch[key] = value;
      };

      assignIfDefined('name', pick('name'));
      assignIfDefined('phone', pick('phone'));
      assignIfDefined('address', pick('address'));
      assignIfDefined('notes', pick('notes'));
      assignIfDefined('type', pick('type'));
      assignIfDefined('isActive', pick('isActive', 'is_active'));
      assignIfDefined('accountId', pick('accountId', 'account_id'));
      assignIfDefined('arAccountId', pick('arAccountId', 'ar_account_id'));
      assignIfDefined('apAccountId', pick('apAccountId', 'ap_account_id'));
      assignIfDefined('geoLat', pick('geoLat', 'geo_lat'));
      assignIfDefined('geoLng', pick('geoLng', 'geo_lng'));
      assignIfDefined('geoLabel', pick('geoLabel', 'geo_label'));

      const nextName = String(patch.name ?? existing.name ?? '').trim();
      const nextType = String(patch.type ?? existing.type ?? '').toUpperCase();
      if (!nextName) return reply.status(400).send({ error: 'الاسم مطلوب.' });
      if (!['CUSTOMER', 'SUPPLIER', 'BOTH'].includes(nextType)) {
        return reply.status(400).send({ error: 'نوع الطرف غير صالح.' });
      }

      patch.name = nextName;
      patch.type = nextType;
      if (patch.isActive !== undefined) {
        const raw = patch.isActive;
        if (typeof raw === 'boolean') patch.isActive = raw;
        else {
          const norm = String(raw).trim().toLowerCase();
          patch.isActive = ['1', 'true', 'yes', 'on'].includes(norm);
        }
      }

      const cleanNullableNumber = (value: any) => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const cleanNullableString = (value: any) => {
        if (value === null || value === undefined || value === '') return null;
        return String(value).trim();
      };

      if (Object.prototype.hasOwnProperty.call(patch, 'accountId')) patch.accountId = cleanNullableNumber(patch.accountId);
      if (Object.prototype.hasOwnProperty.call(patch, 'arAccountId')) patch.arAccountId = cleanNullableString(patch.arAccountId);
      if (Object.prototype.hasOwnProperty.call(patch, 'apAccountId')) patch.apAccountId = cleanNullableString(patch.apAccountId);
      if (Object.prototype.hasOwnProperty.call(patch, 'geoLat')) patch.geoLat = cleanNullableNumber(patch.geoLat);
      if (Object.prototype.hasOwnProperty.call(patch, 'geoLng')) patch.geoLng = cleanNullableNumber(patch.geoLng);
      if (Object.prototype.hasOwnProperty.call(patch, 'geoLabel')) patch.geoLabel = cleanNullableString(patch.geoLabel);
      if (Object.prototype.hasOwnProperty.call(patch, 'notes')) patch.notes = cleanNullableString(patch.notes);
      if (Object.prototype.hasOwnProperty.call(patch, 'phone')) patch.phone = cleanNullableString(patch.phone);
      if (Object.prototype.hasOwnProperty.call(patch, 'address')) patch.address = cleanNullableString(patch.address);

      await db.update(schema.parties).set(patch).where(eq(schema.parties.id, id)).run();
      const updated = await ensurePartyAccountLinks(
        db,
        String(id),
        String(getAuthContext(req).companyId || existing.companyId || '').trim() || null,
      );
      const party = {
        ...updated,
        is_active: updated?.isActive,
        account_id: updated?.accountId,
        ar_account_id: updated?.arAccountId,
        ap_account_id: updated?.apAccountId,
        geo_lat: updated?.geoLat,
        geo_lng: updated?.geoLng,
        geo_label: updated?.geoLabel,
      };
      return { success: true, party };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  };

  api.patch('/parties/:id', handleUpdateParty);
  api.put('/parties/:id', handleUpdateParty);

  api.post('/parties/:id/recompute-balance', async (req, reply) => {
    try {
      ensureCompanyWideMutationScope(req);
      const { id } = req.params as any;
      if (!id) return reply.status(400).send({ error: 'Missing party id.' });
      const party = await withScopedParty(String(id || ''), req);
      if (!party) return reply.status(404).send({ error: 'Party not found.' });
      const balance = await db.transaction(async (tx: any) => await recomputePartyBalance(tx, String(id)));
      return { success: true, balance };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      const multi = parseMultiCurrencyError(e);
      if (multi) return reply.status(400).send({ error: 'Multiple currencies detected for party balance.', ...multi });
      return reply.status(500).send({ error: e.message });
    }
  });

  api.post('/parties/recompute-balances', async (req, reply) => {
    try {
      const authContext = ensureCompanyWideMutationScope(req);
      const parties = filterRowsByTenantScope(await db.select().from(schema.parties).all(), authContext, 'parties');
      await db.transaction(async (tx: any) => {
        for (const p of parties || []) await recomputePartyBalance(tx, p.id);
      });
      return { success: true, count: parties.length };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      const multi = parseMultiCurrencyError(e);
      if (multi) return reply.status(400).send({ error: 'Multiple currencies detected for party balance.', ...multi });
      return reply.status(500).send({ error: e.message });
    }
  });

  api.post('/admin/recompute-party-balances', async (req, reply) => {
    try {
      try {
        await (req as any).jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'غير مصرح' });
      }
      const userRole = (req as any).user?.role;
      if (userRole !== 'admin') return reply.status(403).send({ error: 'صلاحيات غير كافية' });

      const authContext = ensureCompanyWideMutationScope(req);
      const parties = filterRowsByTenantScope(await db.select().from(schema.parties).all(), authContext, 'parties');
      await db.transaction(async (tx: any) => {
        for (const p of parties || []) {
          await tx.update(schema.parties).set({ balance: 0 }).where(eq(schema.parties.id, p.id)).run();
        }
        for (const p of parties || []) await recomputePartyBalance(tx, p.id);
      });
      return { success: true, count: parties.length };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      const multi = parseMultiCurrencyError(e);
      if (multi) return reply.status(400).send({ error: 'Multiple currencies detected for party balance.', ...multi });
      return reply.status(500).send({ error: e.message });
    }
  });
}
