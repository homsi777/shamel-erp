import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Loader2, ReceiptText, Wallet, XCircle } from 'lucide-react';

export type RestaurantShiftSummary = {
  cashierName: string;
  startedAt: string;
  now: string;
  durationLabel: string;
  totalOrders: number;
  totalTablesServed: number;
  totalInvoices: number;
  totalSales: number;
  cashPayments: number;
  creditPayments: number;
  discounts: number;
  taxes: number;
  serviceCharges: number;
  netTotal: number;
  refundsCount: number;
  voidedCount: number;
  openTablesCount: number;
  pendingRequestsCount: number;
  unpaidInvoicesCount: number;
  currency: string;
};

type Props = {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  summary: RestaurantShiftSummary | null;
  onClose: () => void;
  onRefresh: () => void;
  onConfirm: (forceClose: boolean) => void;
};

const formatMoney = (amount: number, currency: string) =>
  `${(Number(amount || 0) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const RestaurantShiftCloseDialog: React.FC<Props> = ({
  open,
  loading,
  submitting,
  summary,
  onClose,
  onRefresh,
  onConfirm,
}) => {
  const [forceClose, setForceClose] = useState(false);

  const unresolvedIssues = useMemo(() => {
    if (!summary) return [];
    const issues: string[] = [];
    if (summary.openTablesCount > 0) issues.push(`توجد ${summary.openTablesCount} طاولات مفتوحة.`);
    if (summary.pendingRequestsCount > 0) issues.push(`توجد ${summary.pendingRequestsCount} طلبات قيد المعالجة.`);
    if (summary.unpaidInvoicesCount > 0) issues.push(`توجد ${summary.unpaidInvoicesCount} فواتير غير مسددة بالكامل.`);
    return issues;
  }, [summary]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" dir="rtl" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">إغلاق الوردية</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">مراجعة تشغيلية ومالية قبل إنهاء وردية الكاشير</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100" aria-label="إغلاق">
            <XCircle size={18} />
          </button>
        </div>

        {loading || !summary ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm font-bold text-slate-500">
            <Loader2 size={16} className="animate-spin" /> جاري تحميل ملخص الوردية...
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-black text-slate-700">معلومات الوردية</h3>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm font-bold text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-white px-3 py-2">الكاشير: {summary.cashierName || '—'}</div>
                <div className="rounded-xl bg-white px-3 py-2">بداية الوردية: {summary.startedAt.slice(0, 19).replace('T', ' ')}</div>
                <div className="rounded-xl bg-white px-3 py-2">الوقت الحالي: {summary.now.slice(0, 19).replace('T', ' ')}</div>
                <div className="rounded-xl bg-white px-3 py-2">المدة: {summary.durationLabel}</div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="inline-flex items-center gap-2 text-sm font-black text-slate-700"><ReceiptText size={14} /> ملخص التشغيل</h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-center"><div className="text-[11px] font-black text-slate-500">إجمالي الطلبات</div><div className="text-lg font-black text-slate-900">{summary.totalOrders}</div></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-center"><div className="text-[11px] font-black text-slate-500">الطاولات المخدومة</div><div className="text-lg font-black text-slate-900">{summary.totalTablesServed}</div></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-center"><div className="text-[11px] font-black text-slate-500">الفواتير</div><div className="text-lg font-black text-slate-900">{summary.totalInvoices}</div></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-rose-900">الإلغاءات: {summary.voidedCount}</div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">المرتجعات: {summary.refundsCount}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="inline-flex items-center gap-2 text-sm font-black text-slate-700"><Wallet size={14} /> الملخص المالي</h3>
                <div className="mt-3 space-y-2 text-sm font-bold text-slate-700">
                  <div className="flex items-center justify-between"><span>إجمالي المبيعات</span><span className="font-mono">{formatMoney(summary.totalSales, summary.currency)}</span></div>
                  <div className="flex items-center justify-between"><span>مدفوع نقدًا</span><span className="font-mono">{formatMoney(summary.cashPayments, summary.currency)}</span></div>
                  <div className="flex items-center justify-between"><span>مدفوع آجل</span><span className="font-mono">{formatMoney(summary.creditPayments, summary.currency)}</span></div>
                  <div className="flex items-center justify-between"><span>الخصومات</span><span className="font-mono">{formatMoney(summary.discounts, summary.currency)}</span></div>
                  <div className="flex items-center justify-between"><span>الضرائب</span><span className="font-mono">{formatMoney(summary.taxes, summary.currency)}</span></div>
                  <div className="flex items-center justify-between"><span>رسوم الخدمة</span><span className="font-mono">{formatMoney(summary.serviceCharges, summary.currency)}</span></div>
                  <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-base font-black text-emerald-900">
                    <div className="flex items-center justify-between">
                      <span>الصافي النهائي</span>
                      <span className="font-mono">{formatMoney(summary.netTotal, summary.currency)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {unresolvedIssues.length > 0 ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="inline-flex items-center gap-2 text-sm font-black text-amber-900"><AlertTriangle size={14} /> تنبيهات قبل الإغلاق</h3>
                <div className="mt-2 space-y-1 text-xs font-bold text-amber-950">
                  {unresolvedIssues.map((issue, index) => (
                    <div key={`${issue}-${index}`}>{issue}</div>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs font-black text-amber-900">
                  <input type="checkbox" checked={forceClose} onChange={(e) => setForceClose(e.target.checked)} />
                  إغلاق قسري مع العلم بوجود عناصر غير محسومة
                </label>
              </section>
            ) : (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-black text-emerald-900">
                لا توجد طاولات مفتوحة أو طلبات معلقة أو فواتير غير مسددة بالكامل.
              </section>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-4">
          <div className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
            <Clock3 size={12} /> يمكن تحديث الملخص قبل التأكيد النهائي.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={loading || submitting} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50">
              تحديث الملخص
            </button>
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50">
              إلغاء
            </button>
            <button
              type="button"
              onClick={() => onConfirm(forceClose)}
              disabled={loading || submitting || (unresolvedIssues.length > 0 && !forceClose)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {submitting ? 'جاري إغلاق الوردية...' : 'تأكيد إغلاق الوردية'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestaurantShiftCloseDialog;
