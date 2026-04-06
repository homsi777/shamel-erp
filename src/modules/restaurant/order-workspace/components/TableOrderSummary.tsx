import React from 'react';

type Props = {
  subtotal: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  grandTotal: number;
  paidAmount: number;
  currencyCode: string;
};

const money = (n: number, currencyCode: string) =>
  `${n.toFixed(2)} ${currencyCode}`;

const TableOrderSummary: React.FC<Props> = ({ subtotal, discount, tax, serviceCharge, grandTotal, paidAmount, currencyCode }) => {
  const remaining = Math.max(0, grandTotal - paidAmount);
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-black tracking-wide text-slate-500">ملخص الفاتورة</h3>
      <div className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between font-semibold text-slate-700"><span>المجموع الفرعي</span><span className="font-mono">{money(subtotal, currencyCode)}</span></div>
        <div className="flex items-center justify-between font-semibold text-slate-700"><span>الخصم</span><span className="font-mono">-{money(discount, currencyCode)}</span></div>
        <div className="flex items-center justify-between font-semibold text-slate-700"><span>الضريبة</span><span className="font-mono">{money(tax, currencyCode)}</span></div>
        <div className="flex items-center justify-between font-semibold text-slate-700"><span>رسوم الخدمة</span><span className="font-mono">{money(serviceCharge, currencyCode)}</span></div>
      </div>
      <div className="mt-3 rounded-xl bg-slate-900 px-3 py-3 text-white">
        <div className="text-xs font-bold tracking-wide text-slate-300">الإجمالي النهائي</div>
        <div className="mt-1 text-2xl font-black font-mono">{money(grandTotal, currencyCode)}</div>
      </div>
      <div className="mt-3 space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <div className="flex items-center justify-between font-semibold text-slate-700"><span>المدفوع</span><span className="font-mono">{money(paidAmount, currencyCode)}</span></div>
        <div className="flex items-center justify-between font-black text-slate-900"><span>المتبقي</span><span className="font-mono">{money(remaining, currencyCode)}</span></div>
      </div>
    </aside>
  );
};

export default TableOrderSummary;

