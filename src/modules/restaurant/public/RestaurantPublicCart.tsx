import React from 'react';

export type CartLine = { itemId: string; name: string; unitPrice: number; quantity: number; note?: string };

export interface RestaurantPublicCartProps {
  lines: CartLine[];
  onChangeQty: (itemId: string, qty: number) => void;
  onRemove: (itemId: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  requestNote: string;
  onRequestNote: (v: string) => void;
  hideTitle?: boolean;
}

const RestaurantPublicCart: React.FC<RestaurantPublicCartProps> = ({
  lines,
  onChangeQty,
  onRemove,
  onSubmit,
  submitting,
  disabled,
  requestNote,
  onRequestNote,
  hideTitle = false,
}) => {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return (
    <div
      className={`rounded-2xl p-4 shadow-sm ${hideTitle ? 'border-0 bg-transparent' : 'border border-amber-200 bg-amber-50/80'}`}
      dir="rtl"
    >
      {!hideTitle ? <h3 className="text-sm font-black text-amber-950">سلة الطلب</h3> : null}
      {lines.length === 0 ? (
        <p className={`text-xs font-bold text-amber-900/70 ${hideTitle ? 'mt-0' : 'mt-2'}`}>
          اختر أصنافًا من القائمة ثم اضغط أيقونة السلة لمراجعة الطلب.
        </p>
      ) : (
        <ul className={`space-y-2 ${hideTitle ? 'mt-2' : 'mt-3'}`}>
          {lines.map((l) => (
            <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/90 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1 font-bold text-stone-800">
                {l.name}
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={l.quantity}
                    onChange={(e) => onChangeQty(l.itemId, Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-16 rounded-lg border border-stone-200 px-2 py-1 text-center text-xs font-mono"
                  />
                  <button type="button" onClick={() => onRemove(l.itemId)} className="text-xs font-bold text-rose-600">
                    حذف
                  </button>
                </div>
              </div>
              <span className="font-mono text-xs font-black text-stone-700">{(l.unitPrice * l.quantity).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 block text-xs font-bold text-amber-900">
        ملاحظة على الطلبية
        <textarea
          value={requestNote}
          onChange={(e) => onRequestNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
          placeholder="اختياري"
        />
      </label>
      <div className="mt-3 flex items-center justify-between border-t border-amber-200/80 pt-3 text-sm font-black text-amber-950">
        <span>إجمالي تقديري</span>
        <span className="font-mono">{subtotal.toFixed(2)}</span>
      </div>
      <button
        type="button"
        disabled={disabled || lines.length === 0 || submitting}
        onClick={onSubmit}
        className="mt-3 w-full rounded-2xl bg-amber-600 py-3 text-sm font-black text-white disabled:opacity-40"
      >
        {submitting ? 'جاري الإرسال…' : 'إرسال الطلب للصالة'}
      </button>
    </div>
  );
};

export default RestaurantPublicCart;
