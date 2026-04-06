import React from 'react';
import { Clock3, Pencil, ReceiptText, X } from 'lucide-react';
import type { RestaurantTable } from '../../restaurant.types';
import { sessionBadgeClass, sessionStatusLabel } from '../../restaurant.helpers';

type Props = {
  table: RestaurantTable | null;
  sessionStatus?: string;
  sessionId?: string | null;
  openedAt?: string | null;
  lastActivityAt?: string | null;
  currencyCode: string;
  currencyOptions: string[];
  exchangeRate: number;
  onCurrencyChange: (code: string) => void;
  onEditRate: () => void;
  onClose: () => void;
};

const fmt = (value?: string | null) => {
  const v = String(value || '').trim();
  if (!v) return '—';
  return v.slice(0, 19).replace('T', ' ');
};

const TableOrderHeader: React.FC<Props> = ({
  table,
  sessionStatus,
  sessionId,
  openedAt,
  lastActivityAt,
  currencyCode,
  currencyOptions,
  exchangeRate,
  onCurrencyChange,
  onEditRate,
  onClose,
}) => {
  const status = String(sessionStatus || 'open');
  const showCurrencySelector = currencyOptions.length > 1;
  const showRateShortcut = currencyCode !== 'USD';
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black tracking-wide text-slate-400">طلب الطاولة النشط</div>
          <h2 className="mt-1 text-xl font-black text-slate-900">
            {table ? `${table.code} - ${table.name}` : 'مساحة عمل طلب الطاولة'}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
            <span className={`rounded-full px-2 py-0.5 font-black ${sessionBadgeClass(status)}`}>{sessionStatusLabel(status)}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
              <ReceiptText size={12} /> المرجع: {sessionId ? `RS-${String(sessionId).slice(-6).toUpperCase()}` : 'مسودة'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
              <Clock3 size={12} /> وقت الفتح: {fmt(openedAt)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">آخر تحديث: {fmt(lastActivityAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showCurrencySelector ? (
            <select
              value={currencyCode}
              onChange={(e) => onCurrencyChange(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-black text-slate-700"
            >
              {currencyOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-black text-slate-700">{currencyCode}</div>
          )}

          {showRateShortcut ? (
            <button
              type="button"
              onClick={onEditRate}
              className="inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-black text-amber-900"
              title="تعديل سعر الصرف"
            >
              1 USD = {exchangeRate.toLocaleString()} {currencyCode}
              <Pencil size={11} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TableOrderHeader;

