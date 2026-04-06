import React, { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  currencyCode: string;
  value: number;
  readOnly?: boolean;
  onClose: () => void;
  onConfirm: (nextRate: number) => void;
};

const ExchangeRateDialog: React.FC<Props> = ({ open, currencyCode, value, readOnly, onClose, onConfirm }) => {
  const [input, setInput] = useState(String(value || 1));
  const parsed = Number(input);
  const valid = Number.isFinite(parsed) && parsed > 0;

  useEffect(() => {
    if (open) setInput(String(value || 1));
  }, [open, value]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" dir="rtl" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-lg font-black text-slate-900">سعر الصرف</h3>
        <p className="mt-1 text-xs font-semibold text-slate-500">1 USD = ? {currencyCode}</p>
        <input
          type="number"
          min="0.000001"
          step="0.000001"
          disabled={readOnly}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono font-bold"
        />
        {!valid ? <div className="mt-2 text-[11px] font-bold text-rose-700">سعر الصرف يجب أن يكون أكبر من الصفر.</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">إلغاء</button>
          <button
            type="button"
            disabled={readOnly || !valid}
            onClick={() => onConfirm(parsed)}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-60"
          >
            تطبيق
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExchangeRateDialog;
