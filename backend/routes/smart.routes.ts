import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';

type SmartEntityType =
  | 'ledgerRow'
  | 'invoice'
  | 'party'
  | 'product'
  | 'voucher'
  | 'cashBox'
  | 'deliveryNotice'
  | 'expense'
  | 'employee'
  | 'salaryTransaction'
  | 'partner';

type SmartKind = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface SmartBadge {
  label: string;
  value: string;
  kind: SmartKind;
}

interface SmartField {
  label: string;
  value: string | number | null;
  type?: 'text' | 'number' | 'currency' | 'date';
}

interface SmartSection {
  title: string;
  rows: SmartField[];
}

interface SmartQuickViewResponse {
  type: SmartEntityType;
  id: string;
  title: string;
  subtitle?: string;
  badges: SmartBadge[];
  fields: SmartField[];
  sections: SmartSection[];
  actions: {
    canOpen: boolean;
    canEdit: boolean;
    canExport: boolean;
    canPrint: boolean;
    disabledReason?: { edit?: string };
  };
}

const dash = '—';

const formatCurrency = (amount: number | null | undefined, currency?: string): string => {
  if (amount === null || amount === undefined) return dash;
  const num = Number(amount);
  if (Number.isNaN(num)) return dash;
  return `${num.toLocaleString('ar-SY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency || ''}`.trim();
};

const formatDate = (date: string | null | undefined): string => {
  if (!date) return dash;
  try {
    return new Date(date).toLocaleDateString('ar-SY');
  } catch {
    return String(date);
  }
};

const parseArray = (value: unknown): any[] => {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const renderFields = (fields: SmartField[]) =>
  fields
    .map(
      (field) =>
        `<div class="field"><span class="field-label">${field.label}</span><span class="field-value">${
          field.type === 'date' ? formatDate(String(field.value || '')) : field.value ?? dash
        }</span></div>`,
    )
    .join('');

const wrapHtml = (
  title: string,
  subtitle: string,
  badges: SmartBadge[],
  fields: SmartField[],
  sections: SmartSection[],
  format: string,
) => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 32px; direction: rtl; color: #222; }
    .header { border-bottom: 2px solid #ddd; padding-bottom: 16px; margin-bottom: 24px; }
    .badge { display: inline-block; margin-left: 8px; padding: 4px 10px; border-radius: 999px; font-size: 12px; background: #f3f4f6; }
    .badge.success { background: #dcfce7; color: #166534; }
    .badge.warning { background: #fef3c7; color: #92400e; }
    .badge.danger { background: #fee2e2; color: #991b1b; }
    .badge.info { background: #dbeafe; color: #1d4ed8; }
    .badge.muted { background: #f3f4f6; color: #6b7280; }
    .section { margin-bottom: 20px; }
    .section-title { font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
    .field { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid #f5f5f5; }
    .field-label { color: #666; }
    .field-value { text-align: left; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #eee; color: #777; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    <div>${subtitle || ''}</div>
    <div>${badges
      .map((badge) => `<span class="badge ${badge.kind}">${badge.label}: ${badge.value}</span>`)
      .join('')}</div>
  </div>
  <div class="section">
    <div class="section-title">المعلومات الأساسية</div>
    ${renderFields(fields)}
  </div>
  ${sections
    .map((section) => `<div class="section"><div class="section-title">${section.title}</div>${renderFields(section.rows)}</div>`)
    .join('')}
  <div class="footer">تم التصدير بتاريخ: ${new Date().toLocaleDateString('ar-SY')} من نظام Shamel ERP</div>
  ${format === 'print' ? '<script>window.onload = () => window.print();</script>' : ''}
</body>
</html>`;

const normalizeFields = (record: Record<string, unknown>): SmartField[] =>
  Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      label: key,
      value:
        value === null
          ? dash
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value),
    }));

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq } = ctx as any;

  const buildQuickView = async (
    type: SmartEntityType,
    id: string,
    query: Record<string, string>,
  ): Promise<SmartQuickViewResponse | null> => {
    if (type === 'invoice') {
      const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
      if (!invoice) return null;
      const party = invoice.clientId
        ? await db.select().from(schema.parties).where(eq(schema.parties.id, invoice.clientId)).get()
        : null;
      const invoiceType =
        invoice.type === 'sale'
          ? 'مبيعات'
          : invoice.type === 'purchase'
            ? 'مشتريات'
            : invoice.type === 'return'
              ? 'مرتجع'
              : String(invoice.type || '');
      const items = parseArray(invoice.items);
      return {
        type,
        id: invoice.id,
        title: `فاتورة ${invoiceType} #${invoice.invoiceNumber || invoice.id}`,
        subtitle: `${formatDate(invoice.date)}${party?.name ? ` — ${party.name}` : ''}`,
        badges: [
          { label: 'النوع', value: invoiceType, kind: invoice.type === 'sale' ? 'success' : 'warning' },
          { label: 'الدفع', value: invoice.paymentType === 'cash' ? 'نقدي' : 'آجل', kind: invoice.paymentType === 'cash' ? 'success' : 'warning' },
          { label: 'العملة', value: invoice.currency || 'USD', kind: 'muted' },
        ],
        fields: [
          { label: 'رقم الفاتورة', value: invoice.invoiceNumber || invoice.id },
          { label: 'التاريخ', value: invoice.date, type: 'date' },
          { label: 'العميل/المورد', value: party?.name || invoice.clientName || dash },
          { label: 'الإجمالي', value: formatCurrency(invoice.totalAmount, invoice.currency), type: 'currency' },
          { label: 'المدفوع', value: formatCurrency(invoice.paidAmount, invoice.currency), type: 'currency' },
          {
            label: 'المتبقي',
            value: formatCurrency((invoice.totalAmount || 0) - (invoice.paidAmount || 0), invoice.currency),
            type: 'currency',
          },
        ],
        sections: [
          { title: 'بنود الفاتورة', rows: [{ label: 'عدد البنود', value: items.length, type: 'number' }] },
          {
            title: 'معلومات إضافية',
            rows: [
              { label: 'المستودع', value: invoice.targetWarehouseName || dash },
              { label: 'ملاحظات', value: invoice.notes || dash },
            ],
          },
        ],
        actions: {
          canOpen: true,
          canEdit: invoice.paymentType !== 'cash',
          canExport: true,
          canPrint: true,
          disabledReason:
            invoice.paymentType === 'cash'
              ? { edit: 'لا يمكن تعديل الفاتورة النقدية من هنا.' }
              : undefined,
        },
      };
    }

    if (type === 'voucher') {
      const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id)).get();
      if (!voucher) return null;
      const party = voucher.clientId
        ? await db.select().from(schema.parties).where(eq(schema.parties.id, voucher.clientId)).get()
        : null;
      const jeId = Number(voucher.journalEntryId || 0);
      const lines = jeId
        ? await db
            .select()
            .from(schema.journalEntryLines)
            .where(eq(schema.journalEntryLines.journalEntryId, jeId))
            .all()
        : [];
      const totalDebit = lines.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0);
      const totalCredit = lines.reduce((sum: number, line: any) => sum + Number(line.credit || 0), 0);
      const voucherType = voucher.type === 'receipt' ? 'قبض' : voucher.type === 'payment' ? 'دفع' : String(voucher.type || '');
      return {
        type,
        id: voucher.id,
        title: `سند ${voucherType} #${voucher.referenceNumber || voucher.id}`,
        subtitle: `${formatDate(voucher.date)}${party?.name ? ` — ${party.name}` : ''}`,
        badges: [
          { label: 'النوع', value: `سند ${voucherType}`, kind: voucher.type === 'receipt' ? 'success' : 'danger' },
          {
            label: 'الحالة',
            value: String(voucher.status || 'DRAFT').toUpperCase() === 'POSTED' ? 'مرحل' : 'مسودة',
            kind: String(voucher.status || 'DRAFT').toUpperCase() === 'POSTED' ? 'success' : 'warning',
          },
          { label: 'العملة', value: voucher.currency || 'USD', kind: 'muted' },
        ],
        fields: [
          { label: 'رقم السند', value: voucher.referenceNumber || voucher.id },
          { label: 'التاريخ', value: voucher.date, type: 'date' },
          { label: 'الطرف', value: party?.name || voucher.clientName || dash },
          { label: 'المبلغ', value: formatCurrency(voucher.amount, voucher.currency), type: 'currency' },
          { label: 'الصندوق/الخزنة', value: voucher.cashBoxName || dash },
          { label: 'البيان', value: voucher.description || dash },
        ],
        sections: [
          {
            title: 'المبالغ',
            rows: [
              { label: 'المبلغ النهائي', value: formatCurrency(voucher.amount, voucher.currency), type: 'currency' },
              ...(voucher.originalAmount && voucher.originalAmount !== voucher.amount
                ? [{ label: 'المبلغ الأصلي', value: formatCurrency(voucher.originalAmount, voucher.currency), type: 'currency' as const }]
                : []),
              ...(voucher.exchangeRate && voucher.exchangeRate !== 1
                ? [{ label: 'سعر الصرف', value: voucher.exchangeRate, type: 'number' as const }]
                : []),
            ],
          },
          {
            title: 'القيود المحاسبية',
            rows: [
              { label: 'عدد السطور', value: lines.length, type: 'number' },
              { label: 'إجمالي المدين', value: formatCurrency(totalDebit, voucher.currency), type: 'currency' },
              { label: 'إجمالي الدائن', value: formatCurrency(totalCredit, voucher.currency), type: 'currency' },
            ],
          },
        ],
        actions: {
          canOpen: true,
          canEdit: String(voucher.status || 'DRAFT').toUpperCase() !== 'POSTED',
          canExport: true,
          canPrint: true,
          disabledReason:
            String(voucher.status || 'DRAFT').toUpperCase() === 'POSTED'
              ? { edit: 'لا يمكن تعديل سند مرحل. استخدم عكس/إلغاء حسب الصلاحيات.' }
              : undefined,
        },
      };
    }

    if (type === 'party') {
      const party = await db.select().from(schema.parties).where(eq(schema.parties.id, id)).get();
      if (!party) return null;
      const rows = await db.select().from(schema.partyTransactions).where(eq(schema.partyTransactions.partyId, party.id)).all();
      const totals: Record<string, number> = {};
      for (const row of rows) {
        const currency = row.currency || 'USD';
        totals[currency] = (totals[currency] || 0) + Number(row.delta || 0);
      }
      return {
        type,
        id: party.id,
        title: party.name,
        subtitle: party.type === 'CUSTOMER' ? 'عميل' : party.type === 'SUPPLIER' ? 'مورد' : 'عميل/مورد',
        badges: [{ label: 'الحالة', value: party.isActive ? 'نشط' : 'غير نشط', kind: party.isActive ? 'success' : 'muted' }],
        fields: [
          { label: 'الاسم', value: party.name },
          { label: 'الهاتف', value: party.phone || dash },
          { label: 'البريد', value: party.email || dash },
          { label: 'العنوان', value: party.address || dash },
        ],
        sections: [
          {
            title: 'الأرصدة',
            rows: Object.keys(totals).length
              ? Object.entries(totals).map(([currency, balance]) => ({
                  label: `الرصيد (${currency})`,
                  value: formatCurrency(balance, currency),
                  type: 'currency' as const,
                }))
              : [{ label: 'الرصيد', value: 'لا توجد معاملات' }],
          },
        ],
        actions: { canOpen: true, canEdit: true, canExport: true, canPrint: true },
      };
    }

    if (type === 'product') {
      const item = await db.select().from(schema.items).where(eq(schema.items.id, id)).get();
      if (!item) return null;
      return {
        type,
        id: item.id,
        title: item.name,
        subtitle: item.code || item.barcode || dash,
        badges: [
          { label: 'الوحدة', value: (item as any).unitName || (item as any).unit || 'قطعة', kind: 'info' },
          { label: 'المستودع', value: (item as any).warehouseName || dash, kind: 'muted' },
        ],
        fields: [
          { label: 'المادة', value: item.name },
          { label: 'الكود', value: item.code || dash },
          { label: 'الباركود', value: item.barcode || dash },
          { label: 'الكمية', value: Number(item.quantity || 0), type: 'number' },
          { label: 'سعر البيع', value: formatCurrency(item.salePrice, 'USD'), type: 'currency' },
          { label: 'سعر الكلفة', value: formatCurrency(item.costPrice, 'USD'), type: 'currency' },
        ],
        sections: [],
        actions: { canOpen: true, canEdit: true, canExport: true, canPrint: true },
      };
    }

    if (type === 'cashBox') {
      const box = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, id)).get();
      if (!box) return null;
      return {
        type,
        id: box.id,
        title: box.name,
        subtitle: 'صندوق مالي',
        badges: [{ label: 'العملة', value: box.currency || 'USD', kind: 'muted' }],
        fields: [
          { label: 'اسم الصندوق', value: box.name },
          { label: 'الرصيد', value: formatCurrency(box.balance, box.currency), type: 'currency' },
        ],
        sections: [],
        actions: { canOpen: true, canEdit: true, canExport: false, canPrint: false },
      };
    }

    if (type === 'expense') {
      const expense = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
      if (!expense) return null;
      return {
        type,
        id: expense.id,
        title: `مصروف #${expense.code || expense.id}`,
        subtitle: formatDate(expense.date),
        badges: [
          {
            label: 'الحالة',
            value: expense.status === 'POSTED' ? 'مرحل' : 'مسودة',
            kind: expense.status === 'POSTED' ? 'success' : 'warning',
          },
        ],
        fields: [
          { label: 'رقم السند', value: expense.code || expense.id },
          { label: 'التاريخ', value: expense.date, type: 'date' },
          { label: 'الوصف', value: expense.description || dash },
          { label: 'المبلغ', value: formatCurrency(expense.totalAmount, expense.currency), type: 'currency' },
        ],
        sections: [],
        actions: { canOpen: true, canEdit: expense.status !== 'POSTED', canExport: true, canPrint: true },
      };
    }

    if (type === 'employee') {
      const employee = await db.select().from(schema.employees).where(eq(schema.employees.id, id)).get();
      if (!employee) return null;
      return {
        type,
        id: employee.id,
        title: employee.name,
        subtitle: employee.position || 'موظف',
        badges: [{ label: 'الحالة', value: employee.status || 'active', kind: employee.status === 'active' ? 'success' : 'muted' }],
        fields: [
          { label: 'الاسم', value: employee.name },
          { label: 'المنصب', value: employee.position || dash },
          { label: 'الهاتف', value: employee.phone || dash },
          { label: 'الراتب الأساسي', value: formatCurrency(employee.baseSalary, employee.currency), type: 'currency' },
        ],
        sections: [],
        actions: { canOpen: true, canEdit: true, canExport: true, canPrint: true },
      };
    }

    if (type === 'salaryTransaction') {
      const tx = await db.select().from(schema.salaryTransactions).where(eq(schema.salaryTransactions.id, id)).get();
      if (!tx) return null;
      const employee = tx.employeeId
        ? await db.select().from(schema.employees).where(eq(schema.employees.id, tx.employeeId)).get()
        : null;
      return {
        type,
        id: tx.id,
        title: `حركة راتب — ${employee?.name || tx.employeeName || 'موظف'}`,
        subtitle: formatDate(tx.date),
        badges: [{ label: 'النوع', value: tx.type || dash, kind: 'info' }],
        fields: [
          { label: 'الموظف', value: employee?.name || tx.employeeName || dash },
          { label: 'التاريخ', value: tx.date, type: 'date' },
          { label: 'المبلغ', value: formatCurrency(tx.amount, tx.currency), type: 'currency' },
          { label: 'الفترة', value: tx.period || dash },
          { label: 'الملاحظات', value: tx.notes || dash },
        ],
        sections: [],
        actions: { canOpen: false, canEdit: false, canExport: true, canPrint: true },
      };
    }

    if (type === 'partner') {
      const partner = await db.select().from(schema.partners).where(eq(schema.partners.id, id)).get();
      if (!partner) return null;
      return {
        type,
        id: partner.id,
        title: partner.name,
        subtitle: 'شريك',
        badges: [
          { label: 'نسبة الشراكة', value: `${partner.percentage || 0}%`, kind: 'info' },
          { label: 'الحالة', value: partner.status || 'active', kind: partner.status === 'active' ? 'success' : 'muted' },
        ],
        fields: [
          { label: 'الاسم', value: partner.name },
          { label: 'النوع', value: partner.type || dash },
          { label: 'رأس المال', value: formatCurrency(partner.capitalAmount, 'USD'), type: 'currency' },
          { label: 'الرصيد الحالي', value: formatCurrency(partner.currentBalance, 'USD'), type: 'currency' },
          { label: 'تاريخ الانضمام', value: partner.joinDate || dash, type: 'date' },
        ],
        sections: [],
        actions: { canOpen: true, canEdit: true, canExport: true, canPrint: true },
      };
    }

    if (type === 'ledgerRow') {
      const forbiddenPrefixes = ['inv-', 'vch-', 'stmt-', 'legacy-'];
      const normalizedId = String(id || '');
      if (!normalizedId) return null;
      if (forbiddenPrefixes.some((prefix) => normalizedId.startsWith(prefix))) {
        throw new Error('INVALID_LEDGER_ROW_ID');
      }
      const tx = await db.select().from(schema.partyTransactions).where(eq(schema.partyTransactions.id, id)).get();
      if (!tx) return null;
      const partyId = String(query.partyId || tx.partyId || '');
      const party = partyId
        ? await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).get()
        : null;
      return {
        type,
        id: tx.id,
        title: 'حركة كشف حساب',
        subtitle: `${party?.name || tx.partyName || dash} — ${formatDate(tx.createdAt)}`,
        badges: [{ label: 'العملة', value: tx.currency || 'USD', kind: 'muted' }],
        fields: [
          { label: 'الجهة', value: party?.name || tx.partyName || dash },
          { label: 'التاريخ', value: tx.createdAt, type: 'date' },
          { label: 'المبلغ', value: formatCurrency(tx.amount, tx.currency), type: 'currency' },
          { label: 'الأثر على الرصيد', value: formatCurrency(tx.delta, tx.currency), type: 'currency' },
          { label: 'المرجع', value: tx.refId || dash },
        ],
        sections: [],
        actions: { canOpen: true, canEdit: false, canExport: true, canPrint: true },
      };
    }

    if (type === 'deliveryNotice') {
      const notice = await db
        .select()
        .from(schema.deliveryNotices)
        .where(eq(schema.deliveryNotices.id, id))
        .get();
      if (!notice) return null;
      const items = parseArray(notice.items);
      return {
        type,
        id: notice.id,
        title: `إشعار تسليم #${notice.noticeNumber || notice.id}`,
        subtitle: formatDate(notice.date),
        badges: [{ label: 'الحالة', value: notice.status || dash, kind: notice.status === 'delivered' ? 'success' : 'warning' }],
        fields: [
          { label: 'رقم الإشعار', value: notice.noticeNumber || notice.id },
          { label: 'التاريخ', value: notice.date, type: 'date' },
          { label: 'العميل', value: notice.customerName || dash },
          { label: 'المستودع', value: notice.warehouseName || dash },
        ],
        sections: [{ title: 'الأصناف', rows: [{ label: 'عدد البنود', value: items.length, type: 'number' }] }],
        actions: { canOpen: true, canEdit: false, canExport: true, canPrint: true },
      };
    }

    return null;
  };

  api.get('/smart/quickview/:type/:id', async (req, reply) => {
    const { type, id } = req.params as { type: SmartEntityType; id: string };
    const query = req.query as Record<string, string>;
    try {
      const response = await buildQuickView(type, id, query);
      if (!response) {
        return reply.status(404).send({ error: 'العنصر غير موجود أو النوع غير مدعوم' });
      }
      return response;
    } catch (error: any) {
      if (String(error?.message || '') === 'INVALID_LEDGER_ROW_ID') {
        return reply.status(400).send({ error: 'INVALID_LEDGER_ROW_ID' });
      }
      console.error('SmartView error:', error);
      return reply.status(500).send({ error: error.message || 'حدث خطأ أثناء بناء المعاينة' });
    }
  });

  api.get('/smart/export/:type/:id', async (req, reply) => {
    const { type, id } = req.params as { type: SmartEntityType; id: string };
    const query = req.query as Record<string, string>;
    const format = query.format || 'pdf';
    try {
      const quickView = await buildQuickView(type, id, query);
      if (!quickView) {
        return reply.status(404).send({ error: 'العنصر غير موجود أو النوع غير مدعوم' });
      }

      const html = wrapHtml(
        quickView.title,
        quickView.subtitle || '',
        quickView.badges,
        quickView.fields,
        quickView.sections,
        format,
      );

      reply.header('Content-Type', 'text/html; charset=utf-8');
      return html;
    } catch (error: any) {
      console.error('SmartExport error:', error);
      return reply.status(500).send({ error: error.message || 'حدث خطأ أثناء التصدير' });
    }
  });
}
