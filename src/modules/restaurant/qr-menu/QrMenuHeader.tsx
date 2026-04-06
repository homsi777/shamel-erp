import React from 'react';
import { Eye, Plus } from 'lucide-react';

type QrMenuHeaderProps = {
  onAdd: () => void;
  disableAdd?: boolean;
};

const QrMenuHeader: React.FC<QrMenuHeaderProps> = ({ onAdd, disableAdd }) => {
  return (
    <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">منيو QR</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">إدارة الأصناف الظاهرة للعميل عبر رمز QR</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
          >
            <Eye size={14} /> معاينة
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={disableAdd}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
          >
            <Plus size={16} /> + إضافة صنف للمنيو
          </button>
        </div>
      </div>
    </header>
  );
};

export default QrMenuHeader;
