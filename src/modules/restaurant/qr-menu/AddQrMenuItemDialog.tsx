import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { InventoryItem } from '../../../types';

type AddQrMenuItemDialogProps = {
  open: boolean;
  candidates: InventoryItem[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: (itemIds: string[]) => void | Promise<void>;
};

const AddQrMenuItemDialog: React.FC<AddQrMenuItemDialogProps> = ({ open, candidates, busy, onClose, onConfirm }) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates.slice(0, 500);
    return candidates
      .filter((it) => {
        const name = String(it.name || '').toLowerCase();
        const group = String(it.groupName || '').toLowerCase();
        const code = String(it.code || '').toLowerCase();
        return name.includes(q) || group.includes(q) || code.includes(q);
      })
      .slice(0, 500);
  }, [candidates, search]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      dir="rtl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-900">إضافة صنف للمنيو</h3>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">اختر أصنافًا موجودة في المخزون لإضافتها إلى منيو QR</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-60"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative mt-4">
          <Search size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث في أصناف المخزون"
            className="w-full rounded-xl border border-slate-200 py-2.5 pr-8 pl-3 text-sm font-semibold"
          />
        </div>

        <div className="mt-3 max-h-[45vh] space-y-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50/40 p-3">
          {visibleItems.length === 0 ? (
            <div className="py-8 text-center text-sm font-bold text-slate-500">لم يتم العثور على أصناف.</div>
          ) : (
            visibleItems.map((it) => {
              const id = String(it.id);
              const checked = selected.has(id);
              const price = Number(it.posPrice ?? it.salePrice ?? 0);
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-900">{it.name}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{it.groupName || 'عام'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-700">{price.toLocaleString('en-US')}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                        setSelected(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-500">تم تحديد {selected.size}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => onConfirm(Array.from(selected))}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
            >
              {busy ? 'جاري الإضافة...' : 'تأكيد وإضافة'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddQrMenuItemDialog;
