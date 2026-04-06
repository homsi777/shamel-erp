#!/usr/bin/env node
/* Automated E2E API tests for Shamel ERP */
const BASE = process.env.BASE_URL || 'http://localhost:3333';

let pass = 0;
let fail = 0;
const results = [];

const logPass = (name, extra='') => {
  pass += 1;
  const line = `✅ ${name}${extra ? ` — ${extra}` : ''}`;
  results.push(line);
  console.log(line);
};
const logFail = (name, reason) => {
  fail += 1;
  const line = `❌ ${name} — ${reason}`;
  results.push(line);
  console.log(line);
};

const req = async (method, path, body) => {
  const url = `${BASE}${path}`;
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) {
    return { ok: false, status: 0, text: String(e?.message || e), json: null };
  }
};

const today = new Date().toISOString().slice(0, 10);
const stamp = Date.now();

(async () => {
  console.log('============================================================');
  console.log(`Shamel ERP E2E API Tests — ${new Date().toISOString()}`);
  console.log(`BASE=${BASE}`);
  console.log('============================================================');

  const pre = await req('GET', '/api/accounts');
  if (!pre.ok) {
    console.log('❌ Server not available. Start it first with: npm run dev');
    process.exit(1);
  }
  logPass('Server availability', `HTTP ${pre.status}`);

  const accounts = Array.isArray(pre.json) ? pre.json : [];
  if (accounts.length > 10) logPass('Chart of accounts loaded', `${accounts.length} accounts`);
  else logFail('Chart of accounts loaded', `found ${accounts.length}`);

  const byCode = new Map(accounts.map((a) => [String(a.code), a]));
  const cash1110 = byCode.get('1110');
  const bank1120 = byCode.get('1120');
  if (cash1110) logPass('Core account 1110 exists'); else logFail('Core account 1110 exists', 'missing');
  if (bank1120) logPass('Core account 1120 exists'); else logFail('Core account 1120 exists', 'missing');

  // Cash boxes setup
  const boxesRes = await req('GET', '/api/cash-boxes');
  let boxes = Array.isArray(boxesRes.json) ? boxesRes.json : [];

  const ensureBox = async (id, name, accountId, balance) => {
    let box = boxes.find((b) => String(b.id) === String(id));
    if (!box) {
      const create = await req('POST', '/api/cash-boxes', { id, name, balance, currency: 'SYP', accountId });
      if (create.ok) {
        logPass(`Cash box created: ${name}`);
      } else {
        logFail(`Cash box created: ${name}`, `HTTP ${create.status} ${create.text}`);
      }
      const refreshed = await req('GET', '/api/cash-boxes');
      boxes = Array.isArray(refreshed.json) ? refreshed.json : boxes;
      box = boxes.find((b) => String(b.id) === String(id));
    }
    if (box) {
      const upd = await req('PUT', `/api/cash-boxes/${box.id}`, { ...box, balance, accountId, currency: 'SYP' });
      if (upd.ok) logPass(`Cash box prepared: ${name}`);
      else logFail(`Cash box prepared: ${name}`, `HTTP ${upd.status}`);
      return { ...box, accountId, balance };
    }
    return null;
  };

  const cashBox = await ensureBox(`e2e-cash-${stamp}`, 'الصندوق الرئيسي E2E', Number(cash1110?.id || 0), 500000);
  const bankBox = await ensureBox(`e2e-bank-${stamp}`, 'البنك E2E', Number(bank1120?.id || 0), 100000);

  // Create customer
  const customerId = `p-e2e-cust-${stamp}`;
  const custName = 'شركة النور للتجارة — E2E';
  const cRes = await req('POST', '/api/parties', {
    id: customerId,
    name: custName,
    type: 'CUSTOMER',
    phone: '0911111111'
  });
  if (cRes.ok) logPass('Create customer'); else logFail('Create customer', `HTTP ${cRes.status} ${cRes.text}`);

  // Create supplier
  const supplierId = `p-e2e-supp-${stamp}`;
  const suppName = 'مصنع الأمل للبلاستيك — E2E';
  const sRes = await req('POST', '/api/parties', {
    id: supplierId,
    name: suppName,
    type: 'SUPPLIER',
    phone: '0922222222'
  });
  if (sRes.ok) logPass('Create supplier'); else logFail('Create supplier', `HTTP ${sRes.status} ${sRes.text}`);

  // Fetch parties and verify sub-accounts
  const partiesRes = await req('GET', '/api/parties');
  const parties = Array.isArray(partiesRes.json) ? partiesRes.json : [];
  const customer = parties.find((p) => p.id === customerId);
  const supplier = parties.find((p) => p.id === supplierId);
  const customerAccountId = Number(customer?.accountId || 0);
  const supplierAccountId = Number(supplier?.accountId || 0);
  if (customerAccountId > 0) logPass('Customer auto sub-account linked', `accountId=${customerAccountId}`);
  else logFail('Customer auto sub-account linked', JSON.stringify(customer || {}));
  if (supplierAccountId > 0) logPass('Supplier auto sub-account linked', `accountId=${supplierAccountId}`);
  else logFail('Supplier auto sub-account linked', JSON.stringify(supplier || {}));

  const accAfter = await req('GET', '/api/accounts');
  const accText = JSON.stringify(accAfter.json || '');
  if (accText.includes('شركة النور')) logPass('Customer sub-account exists in accounts list');
  else logFail('Customer sub-account exists in accounts list', 'name not found');
  if (accText.includes('مصنع الأمل')) logPass('Supplier sub-account exists in accounts list');
  else logFail('Supplier sub-account exists in accounts list', 'name not found');

  // Sale invoice (credit)
  const invoiceId = `inv-e2e-${stamp}`;
  const invoiceNumber = `INV-E2E-${stamp}`;
  const invRes = await req('POST', '/api/invoices', {
    id: invoiceId,
    invoiceNumber,
    type: 'sale',
    clientId: customerId,
    clientName: custName,
    date: today,
    items: [],
    totalAmount: 50000,
    paidAmount: 0,
    remainingAmount: 50000,
    paymentType: 'credit',
    applyStock: 0,
    currency: 'SYP',
    notes: 'E2E sale credit'
  });
  if (invRes.ok) logPass('Create sale invoice (credit)'); else logFail('Create sale invoice (credit)', `HTTP ${invRes.status} ${invRes.text}`);

  const invJournal = await req('GET', `/api/invoices/${invoiceId}/journal`);
  const journalId = Number(invJournal?.json?.entry?.id || 0);
  const journalLines = Array.isArray(invJournal?.json?.lines) ? invJournal.json.lines : [];
  if (journalId > 0) logPass('Invoice journal created', `journalEntryId=${journalId}`);
  else logFail('Invoice journal created', invJournal.text || 'no journal');
  if (journalLines.length >= 2) logPass('Invoice journal lines exist', `${journalLines.length} lines`);
  else logFail('Invoice journal lines exist', `${journalLines.length} lines`);

  // Receipt voucher
  let receiptVoucherId = '';
  const rRes = await req('POST', '/api/receipts', {
    id: `v-e2e-rcpt-${stamp}`,
    date: today,
    amount: 30000,
    currency: 'SYP',
    exchangeRate: 1,
    cashBoxId: cashBox?.id,
    cashBoxName: cashBox?.name,
    clientId: customerId,
    clientName: custName,
    description: 'سند قبض E2E'
  });
  if (rRes.ok) {
    logPass('Create receipt voucher');
    receiptVoucherId = rRes.json?.id || `v-e2e-rcpt-${stamp}`;
  } else {
    logFail('Create receipt voucher', `HTTP ${rRes.status} ${rRes.text}`);
  }

  // Purchase invoice (credit)
  const pinvId = `inv-e2e-p-${stamp}`;
  const pinvRes = await req('POST', '/api/invoices', {
    id: pinvId,
    invoiceNumber: `PINV-E2E-${stamp}`,
    type: 'purchase',
    clientId: supplierId,
    clientName: suppName,
    date: today,
    items: [],
    totalAmount: 20000,
    paidAmount: 0,
    remainingAmount: 20000,
    paymentType: 'credit',
    applyStock: 0,
    currency: 'SYP',
    notes: 'E2E purchase credit'
  });
  if (pinvRes.ok) logPass('Create purchase invoice (credit)'); else logFail('Create purchase invoice (credit)', `HTTP ${pinvRes.status} ${pinvRes.text}`);

  // Expense + post
  const expenseId = `exp-e2e-${stamp}`;
  const expenseRes = await req('POST', '/api/expenses', {
    id: expenseId,
    code: `EXP-E2E-${stamp}`,
    date: today,
    description: 'إيجار المحل — E2E',
    totalAmount: 15000,
    currency: 'SYP',
    paymentType: 'CASH',
    cashBoxId: cashBox?.id,
    cashBoxName: cashBox?.name,
    status: 'DRAFT',
    lines: []
  });
  if (expenseRes.ok) logPass('Create expense'); else logFail('Create expense', `HTTP ${expenseRes.status} ${expenseRes.text}`);
  const expensePost = await req('POST', `/api/expenses/${expenseId}/post`, {});
  if (expensePost.ok) logPass('Post expense'); else logFail('Post expense', `HTTP ${expensePost.status} ${expensePost.text}`);

  // Funds transfer
  const transferRes = await req('POST', '/api/funds/transfer', {
    fromBoxId: cashBox?.id,
    toBoxId: bankBox?.id,
    amount: 10000,
    notes: 'تحويل E2E'
  });
  if (transferRes.ok) logPass('Funds transfer with journal'); else logFail('Funds transfer with journal', `HTTP ${transferRes.status} ${transferRes.text}`);

  // Employee + payroll
  const employeeId = `emp-e2e-${stamp}`;
  const empRes = await req('POST', '/api/employees', {
    id: employeeId,
    name: 'موظف اختبار E2E',
    position: 'محاسب',
    baseSalary: 25000,
    currency: 'SYP',
    salaryFrequency: 'monthly'
  });
  if (empRes.ok) logPass('Create employee'); else logFail('Create employee', `HTTP ${empRes.status} ${empRes.text}`);

  const payrollRes = await req('POST', '/api/payroll/process', {
    employeeId,
    employeeName: 'موظف اختبار E2E',
    amount: 25000,
    currency: 'SYP',
    type: 'full_salary',
    cashBoxId: cashBox?.id,
    date: today,
    notes: 'صرف راتب E2E',
    taxDeductions: 2000,
    socialInsurance: 0,
    advanceDeductions: 0,
    pendingAmount: 0,
    processMode: 'direct'
  });
  const payrollJe = Number(payrollRes?.json?.journalEntryId || 0);
  if (payrollRes.ok) logPass('Payroll process'); else logFail('Payroll process', `HTTP ${payrollRes.status} ${payrollRes.text}`);
  if (payrollJe > 0) logPass('Payroll journal created', `journalEntryId=${payrollJe}`);
  else logFail('Payroll journal created', JSON.stringify(payrollRes.json || payrollRes.text));

  // Reports
  const tb = await req('GET', `/api/reports/trial-balance?asOfDate=${today}`);
  if (tb.ok && Array.isArray(tb.json)) logPass('Trial balance API', `${tb.json.length} rows`);
  else logFail('Trial balance API', `HTTP ${tb.status}`);

  const cashId = Number(cash1110?.id || 0);
  const stmt = await req('GET', `/api/reports/account-statement/${cashId}?from=2020-01-01&to=${today}`);
  if (stmt.ok && stmt.json?.lines !== undefined) logPass('Account statement API');
  else logFail('Account statement API', `HTTP ${stmt.status}`);

  const is = await req('GET', `/api/reports/income-statement?from=2020-01-01&to=${today}`);
  if (is.ok && is.json && is.json.netIncome !== undefined) logPass('Income statement API');
  else logFail('Income statement API', `HTTP ${is.status}`);

  const bs = await req('GET', `/api/reports/balance-sheet?asOfDate=${today}`);
  if (bs.ok && bs.json?.totals) logPass('Balance sheet API');
  else logFail('Balance sheet API', `HTTP ${bs.status}`);

  const jb = await req('GET', `/api/reports/journal-book?from=2020-01-01&to=${today}`);
  if (jb.ok && Array.isArray(jb.json?.entries)) logPass('Journal book API');
  else logFail('Journal book API', `HTTP ${jb.status}`);

  const cstmt = await req('GET', `/api/customers/${customerId}/statement?from=2020-01-01&to=${today}`);
  if (cstmt.ok) logPass('Customer statement API');
  else logFail('Customer statement API', `HTTP ${cstmt.status}`);

  // Deletion protections
  if (customerAccountId > 0) {
    const delCustAcc = await req('DELETE', `/api/accounts/${customerAccountId}`);
    if (delCustAcc.status !== 200) {
      logPass('Protect account with entries from deletion', `HTTP ${delCustAcc.status}`);
    } else {
      logFail('Protect account with entries from deletion', `HTTP ${delCustAcc.status} ${delCustAcc.text}`);
    }
  }

  if (cashId > 0) {
    const delSysAcc = await req('DELETE', `/api/accounts/${cashId}`);
    if ([400, 403, 409, 422].includes(delSysAcc.status)) {
      logPass('Protect system account from deletion', `HTTP ${delSysAcc.status}`);
    } else {
      logFail('Protect system account from deletion', `HTTP ${delSysAcc.status} ${delSysAcc.text}`);
    }
  }

  console.log('\n============================================================');
  console.log('RESULTS');
  console.log('============================================================');
  results.forEach((r) => console.log(r));
  console.log('------------------------------------------------------------');
  console.log(`PASSED: ${pass} | FAILED: ${fail} | TOTAL: ${pass + fail}`);
  console.log('============================================================');

  process.exit(fail > 0 ? 1 : 0);
})();
