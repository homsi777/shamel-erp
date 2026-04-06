import React from 'react';
import { Receipt, CheckCircle, AlertCircle, RefreshCw, FileDigit, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { CashBox, Invoice, formatNumber, LabelSettings, CurrencyRates, DEFAULT_CURRENCY_RATES } from '../../types';
import { getAdditionalCostsTotal } from '../../modules/invoices/invoice.calculations';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', TRY: '\u20BA', SYP: '\u0644.\u0633' };

interface InvoiceSummaryProps {
  cart: any[];
  invoiceType: string;
  purchaseCosts: any;
  setPurchaseCosts: any;
  showExpenses: boolean;
  setShowExpenses: any;
  discount: string;
  setDiscount: any;
  activeMode: string;
  paymentType: 'cash' | 'credit';
  setPaymentType: any;
  selectedCashBoxId: string;
  setSelectedCashBoxId: any;
  cashBoxes: CashBox[];
  paidSplit: { USD: string; SYP: string; TRY: string };
  setPaidSplit: (value: { USD: string; SYP: string; TRY: string }) => void;
  statusMsg: { type: 'success' | 'error' | 'warning', text: string } | null;
  lastSavedInvoice: Invoice | null;
  setPrintInvoice: any;
  handleCreateInvoice: any;
  isSubmitting: boolean;
  calculateGrandTotal: () => number;
  labels: LabelSettings;
  currency?: 'USD' | 'TRY' | 'SYP';
  currencyRates?: CurrencyRates;
}

const InvoiceSummary: React.FC<InvoiceSummaryProps> = ({
  cart,
  invoiceType,
  purchaseCosts,
  setPurchaseCosts,
  showExpenses,
  setShowExpenses,
  activeMode,
  discount,
  setDiscount,
  paymentType,
  setPaymentType,
  selectedCashBoxId,
  setSelectedCashBoxId,
  cashBoxes,
  paidSplit,
  setPaidSplit,
  statusMsg,
  lastSavedInvoice,
  setPrintInvoice,
  handleCreateInvoice,
  isSubmitting,
  calculateGrandTotal,
  labels,
  currency = 'USD',
  currencyRates,
}) => {
  const layout = useResponsiveLayout();
  const totalExpenses = getAdditionalCostsTotal(purchaseCosts);
  const totalQty = cart.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
  const weightedPurchase = cart.reduce((sum, item) => sum + ((Number(item?.unitPrice) || 0) * (Number(item?.quantity) || 0)), 0);
  const avgPurchaseUnit = totalQty > 0 ? (weightedPurchase / totalQty) : 0;
  const extraPerUnit = totalQty > 0 ? (totalExpenses / totalQty) : 0;
  const estimatedCostUnit = avgPurchaseUnit + extraPerUnit;

  const rates = currencyRates || DEFAULT_CURRENCY_RATES;
  const exchangeRate = currency === 'USD' ? 1 : Number(rates[currency] || 1);
  const sym = CURRENCY_SYMBOLS[currency] || '$';
  const grandTotal = calculateGrandTotal();
  const splitCurrencies: Array<'USD' | 'SYP' | 'TRY'> = ['USD', 'SYP', 'TRY'];
  const paidBaseTotal = splitCurrencies.reduce((sum, cur) => {
    const raw = Number((paidSplit as any)?.[cur] || 0);
    if (!Number.isFinite(raw) || raw <= 0) return sum;
    const rate = cur === 'USD' ? 1 : Number(rates[cur] || 1);
    const base = rate > 0 ? raw / rate : raw;
    return sum + base;
  }, 0);
  const paidInvoiceTotal = currency === 'USD' ? paidBaseTotal : (exchangeRate ? paidBaseTotal * exchangeRate : paidBaseTotal);
  const settlementTotal = invoiceType === 'purchase' ? Math.max(0, grandTotal - totalExpenses) : grandTotal;
  const remaining = Math.max(0, settlementTotal - paidInvoiceTotal);
  const remainingBase = currency === 'USD' ? remaining : (exchangeRate ? remaining / exchangeRate : remaining);
  const grandTotalUSD = currency === 'USD' ? grandTotal : (exchangeRate ? grandTotal / exchangeRate : grandTotal);
  const inputHeightClass = layout.isMobile ? 'min-h-[44px]' : '';

  return (
    <div className="space-y-4 lg:col-span-1">
      <div className={`rounded-2xl bg-white p-4 shadow sm:p-5 ${layout.isMobile ? '' : 'lg:sticky lg:top-4'}`}>
        <h3 className="mb-4 border-b pb-2 text-lg font-bold text-gray-800">ملخص الفاتورة</h3>

        <div className="mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm text-gray-600">
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-[11px] text-gray-500">عدد المواد</div>
              <div className="mt-1 font-numeric text-lg font-black text-gray-800">{cart.length}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-[11px] text-gray-500">إجمالي الكمية</div>
              <div className="mt-1 font-numeric text-lg font-black text-gray-800">{formatNumber(totalQty)}</div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
            <span>{invoiceType === 'purchase' ? 'حسم مكتسب' : 'حسم ممنوح'}</span>
            <input
              type="number"
              min="0"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-right font-numeric font-bold outline-none focus:ring-1 focus:ring-primary sm:w-32 ${inputHeightClass}`.trim()}
              placeholder="0.00"
            />
          </div>

          {invoiceType === 'purchase' && totalExpenses > 0 && activeMode === 'invoice' ? (
            <div className="space-y-2">
              <div className="flex justify-between rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                <span className="font-bold text-blue-700">قيمة البضاعة على المورد</span>
                <span className="font-numeric font-bold text-blue-900">{formatNumber(Math.max(0, grandTotal - totalExpenses))} {sym}</span>
              </div>
              <div className="flex justify-between rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
                <span className="font-bold text-amber-700">مصاريف إضافية</span>
                <span className="font-numeric font-bold text-amber-900">{formatNumber(totalExpenses)} {sym}</span>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="text-sm font-bold text-gray-700">التكلفة النهائية للمخزون</div>
                <div className="mt-2 font-numeric text-3xl font-black text-emerald-600">
                  {formatNumber(grandTotal)} {sym}
                </div>
                <div className="mt-1 text-[10px] text-gray-500">المورد يُدان بقيمة البضاعة فقط — المصاريف تُضاف للتكلفة منفصلة</div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="text-sm font-bold text-gray-700">المجموع الكلي</div>
              <div className="mt-2 font-numeric text-3xl font-black text-emerald-600">
                {formatNumber(grandTotal)} {sym}
              </div>
            </div>
          )}

          {currency !== 'USD' && (
            <div className="flex justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <span>المعادل بالدولار</span>
              <span className="font-numeric font-bold">{formatNumber(grandTotalUSD)} $</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-blue-50 p-3 text-sm text-gray-600">
              <div className="text-[11px] text-blue-700">نوع الدفع</div>
              <div className="mt-1 font-bold text-gray-800">{paymentType === 'cash' ? 'نقدي' : 'آجل'}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              <div className="text-[11px] text-gray-500">المدفوع الآن</div>
              <div className="mt-1 font-numeric font-bold text-gray-800">{formatNumber(paidInvoiceTotal)} {sym}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              <div className="text-[11px] text-gray-500">المتبقي</div>
              <div className="mt-1 font-numeric font-bold text-gray-800">{formatNumber(remaining)} {sym}</div>
            </div>
          </div>
          <div className="flex justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <span>إجمالي المدفوع بالدولار</span>
            <span className="font-numeric font-bold">{formatNumber(paidBaseTotal)} $</span>
          </div>
          <div className="flex justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <span>المتبقي بالدولار</span>
            <span className="font-numeric font-bold">{formatNumber(remainingBase)} $</span>
          </div>
        </div>

        {invoiceType === 'purchase' && activeMode === 'invoice' && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-indigo-100 bg-indigo-50 text-sm animate-fadeIn">
            <button
              type="button"
              onClick={() => setShowExpenses((prev: boolean) => !prev)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-indigo-800">
                <Receipt size={14} />
                مصاريف إضافية توزع على الكلفة
              </span>
              {showExpenses ? <ChevronUp size={16} className="text-indigo-700" /> : <ChevronDown size={16} className="text-indigo-700" />}
            </button>

            {showExpenses && (
              <div className="space-y-3 border-t border-indigo-100 px-4 py-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[10px] font-bold text-gray-600">جمارك</label>
                    <input type="number" value={purchaseCosts.customs} onChange={(e) => setPurchaseCosts({ ...purchaseCosts, customs: e.target.value })} className="h-9 w-full rounded-lg border p-2 text-center text-xs font-bold font-numeric outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-bold text-gray-600">شحن خارجي</label>
                    <input type="number" value={purchaseCosts.shipping} onChange={(e) => setPurchaseCosts({ ...purchaseCosts, shipping: e.target.value })} className="h-9 w-full rounded-lg border p-2 text-center text-xs font-bold font-numeric outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-bold text-gray-600">نقل داخلي</label>
                    <input type="number" value={purchaseCosts.transport} onChange={(e) => setPurchaseCosts({ ...purchaseCosts, transport: e.target.value })} className="h-9 w-full rounded-lg border p-2 text-center text-xs font-bold font-numeric outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-bold text-gray-600">أجور عمال</label>
                    <input type="number" value={purchaseCosts.labor} onChange={(e) => setPurchaseCosts({ ...purchaseCosts, labor: e.target.value })} className="h-9 w-full rounded-lg border p-2 text-center text-xs font-bold font-numeric outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-0.5 block text-[10px] font-bold text-gray-600">مصاريف أخرى</label>
                    <input type="number" value={purchaseCosts.others} onChange={(e) => setPurchaseCosts({ ...purchaseCosts, others: e.target.value })} className="h-9 w-full rounded-lg border p-2 text-center text-xs font-bold font-numeric outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                </div>

                {totalExpenses > 0 && (
                  <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-100/50 px-3 py-2">
                    <span className="text-xs font-bold text-indigo-700">إجمالي المصاريف</span>
                    <span className="font-numeric font-bold text-indigo-900">{formatNumber(totalExpenses)} $</span>
                  </div>
                )}

                {totalQty > 0 && (
                  <div className="space-y-1 rounded-xl border border-indigo-100 bg-white/70 p-3">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-bold text-indigo-700">توزيع المصاريف لكل وحدة</span>
                      <span className="font-numeric font-bold text-indigo-900">{formatNumber(extraPerUnit)} $ / وحدة</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-600">متوسط سعر الشراء</span>
                      <span className="font-numeric font-bold">{formatNumber(avgPurchaseUnit)} $</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="font-bold text-gray-800">سعر التكلفة التقديري</span>
                      <span className="font-numeric font-bold text-green-700">{formatNumber(estimatedCostUnit)} $</span>
                    </div>
                    <div className="text-[10px] text-gray-500">ملاحظة: سعر التكلفة لكل سطر = سعر الشراء + التوزيع لكل وحدة.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeMode !== 'opening_stock' && (
          <div className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50 p-3">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1">
              <button type="button" onClick={() => setPaymentType('cash')} className={`min-h-[44px] rounded-lg text-xs font-bold tap-feedback ${paymentType === 'cash' ? 'bg-green-100 text-green-700' : 'text-gray-500'}`}>نقدي</button>
              <button type="button" onClick={() => setPaymentType('credit')} className={`min-h-[44px] rounded-lg text-xs font-bold tap-feedback ${paymentType === 'credit' ? 'bg-red-100 text-red-700' : 'text-gray-500'}`}>آجل</button>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold text-gray-500">الصندوق للدفع أو الدفعة المقدمة</label>
              <select value={selectedCashBoxId} onChange={(e) => setSelectedCashBoxId(e.target.value)} className={`w-full rounded-xl border bg-white p-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 ${inputHeightClass}`.trim()}>
                {cashBoxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="mb-1 block text-xs font-bold text-gray-500">دفعة متعددة العملات</label>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2">
                  <span className="w-20 text-xs font-bold text-gray-500">USD</span>
                  <input
                    type="number"
                    value={paidSplit.USD}
                    onChange={(e) => setPaidSplit({ ...paidSplit, USD: e.target.value })}
                    className="w-full text-right font-numeric font-bold outline-none"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2">
                  <span className="w-20 text-xs font-bold text-gray-500">SYP</span>
                  <input
                    type="number"
                    value={paidSplit.SYP}
                    onChange={(e) => setPaidSplit({ ...paidSplit, SYP: e.target.value })}
                    className="w-full text-right font-numeric font-bold outline-none"
                    placeholder="0"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2">
                  <span className="w-20 text-xs font-bold text-gray-500">TRY</span>
                  <input
                    type="number"
                    value={paidSplit.TRY}
                    onChange={(e) => setPaidSplit({ ...paidSplit, TRY: e.target.value })}
                    className="w-full text-right font-numeric font-bold outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {statusMsg && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-xl p-3 text-sm font-bold animate-fadeIn ${
              statusMsg.type === 'success'
                ? 'bg-green-100 text-green-700'
                : statusMsg.type === 'warning'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-red-100 text-red-700'
            }`}
          >
            {statusMsg.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {statusMsg.text}
          </div>
        )}

        {lastSavedInvoice && (
          <button
            type="button"
            onClick={() => setPrintInvoice(lastSavedInvoice)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-800 py-3 font-bold text-white transition hover:bg-black tap-feedback"
          >
            <Printer size={16} />
            طباعة الفاتورة السابقة
          </button>
        )}

        {lastSavedInvoice && (
          <div className="mt-2 rounded-xl border bg-white p-3 text-sm">
            <div className="mb-2 font-bold text-gray-800">ملخص آخر فاتورة</div>
            <div className="flex justify-between text-gray-600"><span>الإجمالي</span><span className="font-numeric font-bold">{formatNumber(lastSavedInvoice.totalAmount)}</span></div>
            <div className="flex justify-between text-gray-600"><span>المدفوع</span><span className="font-numeric font-bold">{formatNumber(lastSavedInvoice.paidAmount)}</span></div>
            <div className="flex justify-between text-gray-600"><span>المتبقي</span><span className="font-numeric font-bold">{formatNumber(lastSavedInvoice.remainingAmount)}</span></div>
          </div>
        )}

        <div className={layout.isMobile ? 'android-sticky-actions' : ''}>
          <button
            type="button"
            onClick={handleCreateInvoice}
            disabled={isSubmitting}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold text-white shadow-lg transition hover:shadow-xl tap-feedback ${isSubmitting ? 'cursor-not-allowed bg-gray-400' : 'bg-gray-900 hover:bg-black'}`}
          >
            {isSubmitting ? <RefreshCw className="animate-spin" size={20} /> : <FileDigit size={20} />}
            {isSubmitting ? 'جاري المعالجة...' : labels.invoice.save_btn}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceSummary;
