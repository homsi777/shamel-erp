import React from 'react';
import { Plus, Printer, Save, Send, Wallet } from 'lucide-react';

type Props = {
  disabled?: boolean;
  checkoutDisabled?: boolean;
  checkoutLabel?: string;
  onAddItem: () => void;
  onSave: () => void;
  onPrint: () => void;
  onSend: () => void;
  onCheckout: () => void;
};

const TableOrderActions: React.FC<Props> = ({
  disabled,
  checkoutDisabled,
  checkoutLabel,
  onAddItem,
  onSave,
  onPrint,
  onSend,
  onCheckout,
}) => {
  const checkoutBlocked = checkoutDisabled ?? disabled;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <button type="button" onClick={onAddItem} disabled={disabled} className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-60">
          <Plus size={14} /> إضافة صنف
        </button>
        <button type="button" onClick={onSave} disabled={disabled} className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60">
          <Save size={14} /> حفظ التعديلات
        </button>
        <button type="button" onClick={onSend} disabled={disabled} className="inline-flex items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800 disabled:opacity-60">
          <Send size={14} /> إرسال للمطبخ
        </button>
        <button type="button" onClick={onPrint} disabled={disabled} className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60">
          <Printer size={14} /> طباعة الفاتورة
        </button>
        <button type="button" onClick={onCheckout} disabled={checkoutBlocked} className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 disabled:opacity-60">
          <Wallet size={14} /> {checkoutLabel || 'إتمام البيع'}
        </button>
      </div>
    </section>
  );
};

export default TableOrderActions;

