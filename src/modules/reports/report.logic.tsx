﻿﻿
import React from 'react';
import { InventoryItem, Invoice, Client, Warehouse, CashBox, Voucher, LabelSettings, formatDate, formatNumber, Partner, PartnerTransaction, Employee, SalaryTransaction } from '../../types';
import { ReportData, ReportFilterState } from './report.types';
// Fix: Added missing Info icon to the lucide-react import list
import { Scale, AlertCircle, CheckCircle2, Calculator, UserRound, Banknote, Info } from 'lucide-react';

interface DataContext {
    inventory: InventoryItem[];
    invoices: Invoice[];
    clients: Client[];
    warehouses: Warehouse[];
    cashBoxes: CashBox[];
    vouchers: Voucher[];
    stockTransfers?: any[];
    partners?: Partner[];
    partnerTransactions?: PartnerTransaction[];
    employees?: Employee[];
    salaryTransactions?: SalaryTransaction[];
    partyTransactions?: any[];
}

export const buildFinancialReportData = (
    reportId: string,
    payload: any,
    filters: ReportFilterState
): ReportData | null => {
    if (!payload) return null;

    if (reportId === 'trial_balance') {
        const rows = (payload || []).map((r: any) => ([
            r.code || '',
            r.nameAr || r.name || '',
            Number(r.debit || 0),
            Number(r.credit || 0),
            r.accountType || ''
        ]));
        const totalDebit = rows.reduce((sum: number, row: any[]) => sum + Number(row[2] || 0), 0);
        const totalCredit = rows.reduce((sum: number, row: any[]) => sum + Number(row[3] || 0), 0);

        return {
            title: 'ميزان المراجعة',
            subtitle: `حتى تاريخ: ${filters.dateTo}`,
            summary: [
                { title: 'إجمالي المدين', value: totalDebit, color: 'red' },
                { title: 'إجمالي الدائن', value: totalCredit, color: 'green' }
            ],
            tableHeaders: ['الكود', 'اسم الحساب', 'مدين', 'دائن', 'النوع'],
            tableRows: rows,
            raw: payload,
            meta: { asOfDate: filters.dateTo }
        };
    }

    if (reportId === 'account_statement') {
        const accountName = payload?.account?.nameAr || payload?.account?.name || 'الحساب';
        const lines = Array.isArray(payload?.lines) ? payload.lines : [];
        return {
            title: `كشف حساب: ${accountName}`,
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'إجمالي المدين', value: Number(payload?.totals?.debit || 0), color: 'red' },
                { title: 'إجمالي الدائن', value: Number(payload?.totals?.credit || 0), color: 'green' },
                { title: 'الرصيد', value: Number(payload?.totals?.balance || 0), color: 'blue' }
            ],
            tableHeaders: ['التاريخ', 'رقم القيد', 'البيان', 'مدين', 'دائن', 'الرصيد'],
            tableRows: lines.map((l: any) => ([
                l.date || l.entryDate || '',
                l.entryNumber || '',
                l.description || '',
                Number(l.debit || 0),
                Number(l.credit || 0),
                Number(l.balance || 0)
            ])),
            raw: payload,
            meta: { from: filters.dateFrom, to: filters.dateTo }
        };
    }

    if (reportId === 'journal_book') {
        const entries = Array.isArray(payload?.entries) ? payload.entries : [];
        const rows: (string | number)[][] = [];
        let totalDebit = 0;
        let totalCredit = 0;

        entries.forEach((entry: any) => {
            const lines = Array.isArray(entry.lines) ? entry.lines : [];
            lines.forEach((line: any, idx: number) => {
                const debit = Number(line.debit || 0);
                const credit = Number(line.credit || 0);
                totalDebit += debit;
                totalCredit += credit;
                rows.push([
                    idx === 0 ? entry.entryNumber : '',
                    idx === 0 ? (entry.entryDate || '') : '',
                    idx === 0 ? (entry.description || '') : '',
                    `${line.accountCode || ''} ${line.accountName || ''}`.trim(),
                    debit,
                    credit
                ]);
            });
        });

        return {
            title: 'دفتر اليومية',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'إجمالي المدين', value: totalDebit, color: 'red' },
                { title: 'إجمالي الدائن', value: totalCredit, color: 'green' }
            ],
            tableHeaders: ['رقم القيد', 'التاريخ', 'البيان', 'الحساب', 'مدين', 'دائن'],
            tableRows: rows,
            raw: payload,
            meta: { from: filters.dateFrom, to: filters.dateTo }
        };
    }

    if (reportId === 'income_statement') {
        const revenues = Array.isArray(payload?.revenues) ? payload.revenues : [];
        const expenses = Array.isArray(payload?.expenses) ? payload.expenses : [];

        const rows: (string | number)[][] = [
            ['الإيرادات', 0],
            ...revenues.map((r: any) => [`${r.code || ''} ${r.name || ''}`.trim(), Number(r.balance || 0)]),
            ['إجمالي الإيرادات', Number(payload?.totalRevenue || 0)],
            ['', ''],
            ['المصروفات', 0],
            ...expenses.map((r: any) => [`${r.code || ''} ${r.name || ''}`.trim(), Number(r.balance || 0)]),
            ['إجمالي المصروفات', Number(payload?.totalExpenses || 0)],
            ['صافي الربح', Number(payload?.netIncome || 0)]
        ];

        return {
            title: 'قائمة الدخل',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'إجمالي الإيرادات', value: Number(payload?.totalRevenue || 0), color: 'green' },
                { title: 'إجمالي المصروفات', value: Number(payload?.totalExpenses || 0), color: 'red' },
                { title: 'صافي الربح', value: Number(payload?.netIncome || 0), color: 'blue' }
            ],
            tableHeaders: ['البند', 'القيمة'],
            tableRows: rows,
            raw: payload,
            meta: { from: filters.dateFrom, to: filters.dateTo }
        };
    }

    if (reportId === 'balance_sheet') {
        const assets = Array.isArray(payload?.assets) ? payload.assets : [];
        const liabilities = Array.isArray(payload?.liabilities) ? payload.liabilities : [];
        const equity = Array.isArray(payload?.equity) ? payload.equity : [];

        const rows: (string | number)[][] = [
            ['الأصول', 0],
            ...assets.map((r: any) => [`${r.code || ''} ${r.name || ''}`.trim(), Number(r.balance || 0)]),
            ['إجمالي الأصول', Number(payload?.totals?.assets || 0)],
            ['', ''],
            ['الخصوم', 0],
            ...liabilities.map((r: any) => [`${r.code || ''} ${r.name || ''}`.trim(), Number(r.balance || 0)]),
            ['إجمالي الخصوم', Number(payload?.totals?.liabilities || 0)],
            ['', ''],
            ['حقوق الملكية', 0],
            ...equity.map((r: any) => [`${r.code || ''} ${r.name || ''}`.trim(), Number(r.balance || 0)]),
            ['صافي ربح العام', Number(payload?.totals?.netIncome || 0)],
            ['إجمالي حقوق الملكية', Number(payload?.totals?.equity || 0)]
        ];

        return {
            title: 'الميزانية العمومية',
            subtitle: `بتاريخ ${payload?.asOfDate || filters.dateTo}`,
            summary: [
                { title: 'إجمالي الأصول', value: Number(payload?.totals?.assets || 0), color: 'green' },
                { title: 'إجمالي الخصوم', value: Number(payload?.totals?.liabilities || 0), color: 'red' },
                { title: 'إجمالي حقوق الملكية', value: Number(payload?.totals?.equity || 0), color: 'blue' }
            ],
            tableHeaders: ['البند', 'القيمة'],
            tableRows: rows,
            raw: payload,
            meta: { asOfDate: payload?.asOfDate || filters.dateTo }
        };
    }

    return null;
};

export const buildCanonicalReportData = (
    reportId: string,
    payload: any,
    filters: ReportFilterState
): ReportData | null => {
    if (!payload) return null;

    if (reportId === 'summary') {
        const totals = payload?.totals || {};
        return {
            title: 'Dashboard Summary',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'المبيعات', value: Number(totals.sales || 0), color: 'green' },
                { title: 'المشتريات', value: Number(totals.purchases || 0), color: 'blue' },
                { title: 'المقبوضات', value: Number(totals.receipts || 0), color: 'teal' },
                { title: 'المدفوعات', value: Number(totals.payments || 0), color: 'red' },
                { title: 'قيمة المخزون', value: Number(totals.inventoryValue || 0), color: 'purple' }
            ],
            tableHeaders: ['المؤشر', 'القيمة'],
            tableRows: [
                ['عدد الجهات', Number(totals.partiesCount || 0)],
                ['عدد الفواتير', Number(totals.invoicesCount || 0)],
                ['عدد السندات', Number(totals.vouchersCount || 0)]
            ],
            raw: payload
        };
    }

    if (reportId === 'invoices_report') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        return {
            title: 'تقرير الفواتير',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'عدد الفواتير', value: Number(payload?.totals?.count || 0), color: 'blue' },
                { title: 'الإجمالي', value: Number(payload?.totals?.amount || 0), color: 'green' }
            ],
            tableHeaders: ['التاريخ', 'رقم الفاتورة', 'النوع', 'الطرف', 'الإجمالي', 'المدفوع', 'المتبقي', 'العملة', 'ملاحظات'],
            tableRows: rows.map((r: any) => [
                formatDate(r.date),
                r.invoiceNumber || '',
                r.type || '',
                r.partyName || 'غير محدد',
                Number(r.totalAmount || 0),
                Number(r.paidAmount || 0),
                Number(r.remainingAmount || 0),
                r.currency || 'USD',
                r.notes || ''
            ]),
            meta: { entityRefs: rows.map((r: any) => r.ref || {}) },
            raw: payload
        };
    }

    if (reportId === 'party_statement') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        return {
            title: 'كشف حساب طرف',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'إجمالي مدين', value: Number(payload?.totals?.debit || 0), color: 'green' },
                { title: 'إجمالي دائن', value: Number(payload?.totals?.credit || 0), color: 'red' },
                { title: 'الصافي', value: Number(payload?.totals?.balance || 0), color: 'blue' }
            ],
            tableHeaders: ['التاريخ', 'الطرف', 'النوع', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد', 'العملة'],
            tableRows: rows.map((r: any) => [
                formatDate(r.date),
                r.partyName || '',
                r.partyType || '',
                r.refId || '',
                r.memo || '',
                Number(r.debit || 0),
                Number(r.credit || 0),
                Number(r.balance || 0),
                r.currency || 'USD'
            ]),
            meta: { entityRefs: rows.map((r: any) => r.ref || {}) },
            raw: payload
        };
    }

    if (reportId === 'inventory_report_core') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        if (filters.inventoryMode === 'stock_by_warehouse') {
            return {
                title: 'تقارير المخزون — رصيد المستودعات',
                summary: [
                    { title: 'إجمالي الكمية', value: Number(payload?.totals?.quantity || 0), color: 'blue' },
                    { title: 'إجمالي القيمة', value: Number(payload?.totals?.value || 0), color: 'green' }
                ],
                tableHeaders: ['المادة', 'الكود', 'المستودع', 'الكمية', 'تكلفة الوحدة', 'القيمة الإجمالية'],
                tableRows: rows.map((r: any) => [
                    r.itemName || '',
                    r.itemCode || '',
                    r.warehouseName || '',
                    Number(r.quantity || 0),
                    Number(r.costPrice || 0),
                    Number(r.totalValue || 0)
                ]),
                meta: { entityRefs: rows.map((r: any) => r.ref || {}) },
                raw: payload
            };
        }

        return {
            title: 'تقارير المخزون — حركة مادة',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'وارد', value: Number(payload?.totals?.inward || 0), color: 'green' },
                { title: 'صادر', value: Number(payload?.totals?.outward || 0), color: 'red' },
                { title: 'الصافي', value: Number(payload?.totals?.net || 0), color: 'blue' }
            ],
            tableHeaders: ['التاريخ', 'المرجع', 'المستودع', 'المادة', 'الحركة', 'الكمية', 'الوحدة', 'ملاحظات'],
            tableRows: rows.map((r: any) => [
                formatDate(r.date),
                r.refNumber || '',
                r.warehouseName || '',
                r.itemName || '',
                r.movementType || '',
                Number(r.quantity || 0),
                r.unitName || '',
                r.notes || ''
            ]),
            meta: { entityRefs: rows.map((r: any) => r.ref || {}) },
            raw: payload
        };
    }

    if (reportId === 'cashbox_report') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        return {
            title: 'تقرير الصندوق',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'المقبوضات', value: Number(payload?.totals?.receipts || 0), color: 'green' },
                { title: 'المدفوعات', value: Number(payload?.totals?.payments || 0), color: 'red' },
                { title: 'الرصيد', value: Number(payload?.totals?.balance || 0), color: 'blue' }
            ],
            tableHeaders: ['التاريخ', 'السند', 'النوع', 'الحالة', 'الطرف', 'البيان', 'مدين', 'دائن', 'الرصيد', 'العملة'],
            tableRows: rows.map((r: any) => [
                formatDate(r.date),
                r.voucherNumber || '',
                r.voucherType || '',
                r.status || 'DRAFT',
                r.partyName || '',
                r.description || '',
                Number(r.debit || 0),
                Number(r.credit || 0),
                Number(r.runningBalance || 0),
                r.currency || 'USD'
            ]),
            meta: { entityRefs: rows.map((r: any) => r.ref || {}) },
            raw: payload
        };
    }

    if (reportId === 'agents_sales') {
        const rows = Array.isArray(payload) ? payload : [];
        const totalInvoices = rows.reduce((sum: number, row: any) => sum + Number(row.count || 0), 0);
        const totalSales = rows.reduce((sum: number, row: any) => sum + Number(row.total || 0), 0);
        const totalPaid = rows.reduce((sum: number, row: any) => sum + Number(row.paid || 0), 0);
        const totalRemaining = rows.reduce((sum: number, row: any) => sum + Number(row.remaining || 0), 0);
        const totalQty = rows.reduce((sum: number, row: any) => sum + Number(row.soldQty || 0), 0);
        return {
            title: 'تقرير مبيعات المناديب',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'عدد الفواتير', value: totalInvoices, color: 'blue' },
                { title: 'إجمالي المبيعات', value: totalSales, color: 'green' },
                { title: 'المقبوض', value: totalPaid, color: 'teal' },
                { title: 'المتبقي', value: totalRemaining, color: 'red' },
                { title: 'إجمالي الكمية', value: totalQty, color: 'purple' }
            ],
            tableHeaders: ['المندوب', 'عدد الفواتير', 'الإجمالي', 'المدفوع', 'المتبقي', 'الكمية المباعة'],
            tableRows: rows.map((row: any) => ([
                row.agentName || row.agentId || '-',
                Number(row.count || 0),
                Number(row.total || 0),
                Number(row.paid || 0),
                Number(row.remaining || 0),
                Number(row.soldQty || 0),
            ])),
            raw: payload,
            meta: { from: filters.dateFrom, to: filters.dateTo }
        };
    }

    if (reportId === 'agents_stock') {
        const rows = Array.isArray(payload) ? payload : [];
        const totalQty = rows.reduce((sum: number, row: any) => sum + Number(row.totalQty || 0), 0);
        const totalItems = rows.reduce((sum: number, row: any) => sum + Number(row.itemCount || 0), 0);
        return {
            title: 'تقرير مخزون المناديب',
            subtitle: 'ملخص الكميات الحالية لدى المناديب',
            summary: [
                { title: 'إجمالي الكمية', value: totalQty, color: 'blue' },
                { title: 'عدد البنود', value: totalItems, color: 'purple' }
            ],
            tableHeaders: ['المندوب', 'إجمالي الكمية', 'عدد البنود'],
            tableRows: rows.map((row: any) => ([
                row.agentName || row.agentId || '-',
                Number(row.totalQty || 0),
                Number(row.itemCount || 0),
            ])),
            raw: payload
        };
    }

    if (reportId === 'agents_transfers') {
        const rows = Array.isArray(payload) ? payload : [];
        const totals = rows.reduce((acc: { count: number; qty: number }, row: any) => {
            acc.count += 1;
            const items = Array.isArray(row.items) ? row.items : [];
            const qty = items.reduce((sum: number, item: any) => sum + Number(item.quantity ?? item.qty ?? item.baseQty ?? 0), 0);
            acc.qty += qty;
            return acc;
        }, { count: 0, qty: 0 });
        return {
            title: 'تقرير تحويلات المناديب',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'عدد التحويلات', value: totals.count, color: 'blue' },
                { title: 'إجمالي الكمية', value: totals.qty, color: 'green' }
            ],
            tableHeaders: ['التاريخ', 'نوع التحويل', 'المندوب', 'عدد البنود', 'إجمالي الكمية', 'الحالة'],
            tableRows: rows.map((row: any) => {
                const items = Array.isArray(row.items) ? row.items : [];
                const qty = items.reduce((sum: number, item: any) => sum + Number(item.quantity ?? item.qty ?? item.baseQty ?? 0), 0);
                return [
                    String(row.createdAt || row.transferDate || row.date || ''),
                    row.transferType || row.type || '-',
                    row.agentName || row.agentId || '-',
                    items.length,
                    qty,
                    row.status || '-',
                ];
            }),
            raw: payload,
            meta: { from: filters.dateFrom, to: filters.dateTo }
        };
    }

    if (reportId === 'agents_activity') {
        const rows = Array.isArray(payload) ? payload : [];
        const activeCount = rows.filter((row: any) => Number(row.isActive ?? 1) !== 0).length;
        const onlineCount = rows.filter((row: any) => row.online === true).length;
        return {
            title: 'تقرير نشاط المناديب',
            subtitle: 'آخر ظهور وحالة الاتصال',
            summary: [
                { title: 'عدد المناديب النشطين', value: activeCount, color: 'green' },
                { title: 'المتصلون الآن', value: onlineCount, color: 'blue' }
            ],
            tableHeaders: ['المندوب', 'الحالة', 'الاتصال', 'آخر ظهور'],
            tableRows: rows.map((row: any) => ([
                row.name || row.id || '-',
                Number(row.isActive ?? 1) === 0 ? 'غير نشط' : 'نشط',
                row.online ? 'متصل' : 'غير متصل',
                row.lastSeenAt || '-',
            ])),
            raw: payload
        };
    }

    if (reportId === 'top_selling' || reportId === 'top_purchased') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const isTopSelling = reportId === 'top_selling';
        return {
            title: isTopSelling ? 'الأكثر مبيعاً' : 'الأكثر شراءً',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'عدد الأصناف', value: rows.length, color: 'blue' }
            ],
            tableHeaders: ['#', 'اسم المادة', 'الكمية', 'المبلغ الإجمالي', 'عدد الفواتير'],
            tableRows: rows.map((r: any) => [
                r.rank,
                r.itemName || '',
                Number(r.totalQty || 0),
                Number(r.totalAmount || 0),
                r.invoiceCount || 0
            ]),
            raw: payload
        };
    }

    if (reportId === 'stagnant_items') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        return {
            title: 'مواد راكدة',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'عدد المواد الراكدة', value: rows.length, color: 'red' },
                { title: 'قيمة المخزون الراكد', value: Number(payload?.totals?.totalValue || 0), color: 'orange' }
            ],
            tableHeaders: ['#', 'اسم المادة', 'الكود', 'المستودع', 'الكمية', 'سعر التكلفة', 'قيمة المخزون'],
            tableRows: rows.map((r: any) => [
                r.rank,
                r.itemName || '',
                r.code || '',
                r.warehouseName || '',
                Number(r.quantity || 0),
                Number(r.costPrice || 0),
                Number(r.stockValue || 0)
            ]),
            raw: payload
        };
    }

    if (reportId === 'top_customers') {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        return {
            title: 'أنشط العملاء',
            subtitle: `من ${filters.dateFrom} إلى ${filters.dateTo}`,
            summary: [
                { title: 'عدد العملاء', value: rows.length, color: 'blue' }
            ],
            tableHeaders: ['#', 'اسم العميل', 'المبلغ الإجمالي', 'عدد الفواتير'],
            tableRows: rows.map((r: any) => [
                r.rank,
                r.partyName || '',
                Number(r.totalAmount || 0),
                r.invoiceCount || 0
            ]),
            raw: payload
        };
    }

    return null;
};

export const buildHubReportData = (
    reportId: string,
    payload: any,
    filters: ReportFilterState
): ReportData | null => {
    if (!payload) return null;

    const summary = Array.isArray(payload.summary) ? payload.summary : [];
    const tableHeaders = Array.isArray(payload.tableHeaders) ? payload.tableHeaders : [];
    const tableRows = Array.isArray(payload.tableRows) ? payload.tableRows : [];
    const status = String(payload.status || 'ok');
    const note = String(payload.note || '');
    const completeness = String(payload?.meta?.completeness || (status === 'requires_dataset' ? 'requires_dataset' : 'complete'));
    const canonicalLevel = String(payload?.meta?.canonicalLevel || payload?.meta?.audit?.canonicalLevel || 'accounting_canonical');
    const missingDataset = String(payload?.meta?.missingDataset || '');

    let extraInfo: React.ReactNode | undefined;
    if (status === 'requires_dataset' || completeness === 'requires_dataset') {
        extraInfo = (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {missingDataset || note || 'هذا التقرير يتطلب بيانات إضافية غير متوفرة حاليًا في قاعدة البيانات.'}
            </div>
        );
    } else if (canonicalLevel === 'operational_estimate' && note) {
        extraInfo = (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                {note}
            </div>
        );
    }

    return {
        title: payload.title || `تقرير: ${reportId}`,
        subtitle: payload.subtitle || `من ${filters.dateFrom} إلى ${filters.dateTo}`,
        summary: summary.map((s: any) => ({
            title: String(s?.title || ''),
            value: typeof s?.value === 'number' ? s.value : (s?.value ?? ''),
            color: s?.color,
            subValue: s?.subValue,
            suffix: s?.suffix
        })),
        tableHeaders: tableHeaders.map((h: any) => String(h ?? '')),
        tableRows: tableRows.map((row: any) =>
            Array.isArray(row) ? row.map((cell: any) => (typeof cell === 'number' ? cell : String(cell ?? ''))) : []
        ),
        extraInfo,
        raw: payload.raw ?? payload,
        meta: {
            ...(payload.meta || {}),
            mode: payload.mode || reportId,
            status,
            note,
            completeness,
            canonicalLevel,
            missingDataset,
            generatedAt: payload.generatedAt || new Date().toISOString(),
            filters: payload.filters || {
                from: filters.dateFrom,
                to: filters.dateTo,
                branchId: filters.selectedBranchId,
                warehouseId: filters.selectedWarehouseId,
                currency: filters.selectedCurrency || 'all'
            }
        }
    };
};

export const generateReportData = (
    reportId: string | null,
    _filters: ReportFilterState,
    _data: any,
    _labels: LabelSettings,
    _setActualValueInput: (val: string) => void
): ReportData | null => {
    if (!reportId) return null;
        return {
        title: 'This report must be loaded from the backend',
        subtitle: 'Frontend generation has been disabled. Configure backend.kind for this report.',
            summary: [],
            tableHeaders: [],
        tableRows: [],
    };
};
