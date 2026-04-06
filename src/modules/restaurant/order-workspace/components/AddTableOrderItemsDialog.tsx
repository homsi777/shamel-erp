import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { AddDialogDraftLine } from '../types';

type MenuOption = {
  itemId: string;
  name: string;
  category: string;
  unitPrice: number;
};

type Props = {
  open: boolean;
  options: MenuOption[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (rows: AddDialogDraftLine[]) => void | Promise<void>;
};

const AddTableOrderItemsDialog: React.FC<Props> = ({ open, options, busy, onClose, onSubmit }) => {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<AddDialogDraftLine[]>([]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options.slice(0, 500);
    return options.filter((x) => `${x.name} ${x.category}`.toLowerCase().includes(q)).slice(0, 500);
  }, [options, search]);

  if (!open) return null;

  const add = (opt: MenuOption) => {
    setDraft((prev) => {
      const ix = prev.findIndex((x) => x.itemId === opt.itemId);
      if (ix >= 0) {
        const next = [...prev];
        next[ix] = { ...next[ix], quantity: next[ix].quantity + 1 };
        return next;
      }
      return [...prev, { itemId: opt.itemId, name: opt.name, unitPrice: opt.unitPrice, quantity: 1, note: '', category: opt.category }];
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" dir="rtl" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-900">+ إضافة أصناف</h3>
            <p className="text-xs font-semibold text-slate-500">اختر الأصناف لإضافتها إلى نفس طلب الطاولة</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200">
            <div className="relative border-b border-slate-200 p-2">
              <Search size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن الأصناف" className="w-full rounded-lg border border-slate-200 py-2 pr-8 pl-3 text-sm font-semibold" />
            </div>
            <div className="max-h-[48vh] overflow-auto p-2">
              {visible.map((opt) => (
                <button key={opt.itemId} type="button" onClick={() => add(opt)} className="mb-2 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-right hover:bg-slate-50">
                  <div>
                    <div className="font-black text-slate-900">{opt.name}</div>
                    <div className="text-[11px] font-semibold text-slate-500">{opt.category}</div>
                  </div>
                  <div className="font-mono font-bold text-slate-700">{opt.unitPrice.toFixed(2)}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
            <div className="mb-2 text-xs font-black text-slate-500">الأصناف المحددة</div>
            <div className="max-h-[42vh] space-y-2 overflow-auto">
              {draft.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm font-bold text-slate-500">لم يتم تحديد أصناف بعد.</div> : draft.map((line) => (
                <div key={line.itemId} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-black text-slate-900">{line.name}</div>
                    <div className="font-mono text-xs font-bold text-slate-700">{(line.quantity * line.unitPrice).toFixed(2)}</div>
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <input type="number" min={1} value={line.quantity} onChange={(e) => setDraft((p) => p.map((x) => x.itemId === line.itemId ? { ...x, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : x))} className="col-span-3 rounded-md border border-slate-200 px-2 py-1 text-xs font-mono" />
                    <input value={line.note} onChange={(e) => setDraft((p) => p.map((x) => x.itemId === line.itemId ? { ...x, note: e.target.value } : x))} placeholder="ملاحظة" className="col-span-7 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold" />
                    <button type="button" onClick={() => setDraft((p) => p.filter((x) => x.itemId !== line.itemId))} className="col-span-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-black text-rose-700">حذف</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-500">تم تحديد {draft.length} سطر</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">إلغاء</button>
            <button type="button" disabled={busy || draft.length === 0} onClick={() => onSubmit(draft)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? 'جاري الإرسال...' : 'إرسال إلى طلب الطاولة'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddTableOrderItemsDialog;

