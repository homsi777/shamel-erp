import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceItemRow } from '../types';

type Props = {
  row: WorkspaceItemRow;
  editable?: boolean;
  formatMoney: (value: number) => string;
  onInc?: () => void;
  onDec?: () => void;
  onRemove?: () => void;
};

const TableOrderItemRow: React.FC<Props> = ({ row, editable, formatMoney, onInc, onDec, onRemove }) => {
  return (
    <div className="grid grid-cols-12 items-center gap-2 border-b border-slate-100 px-3 py-3 text-sm">
      <div className="col-span-12 min-w-0 sm:col-span-5">
        <div className="truncate font-black text-slate-900">{row.name}</div>
        {row.note ? <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{row.note}</div> : null}
      </div>
      <div className="col-span-4 text-center font-mono font-bold text-slate-700 sm:col-span-2">{formatMoney(row.unitPrice)}</div>
      <div className="col-span-4 flex items-center justify-center gap-1 sm:col-span-2">
        {editable ? (
          <>
            <button type="button" onClick={onDec} className="rounded-md border border-slate-200 p-1 text-slate-700"><Minus size={12} /></button>
            <span className="w-7 text-center font-mono font-bold text-slate-800">{row.quantity}</span>
            <button type="button" onClick={onInc} className="rounded-md border border-slate-200 p-1 text-slate-700"><Plus size={12} /></button>
          </>
        ) : (
          <span className="font-mono font-bold text-slate-800">{row.quantity}</span>
        )}
      </div>
      <div className="col-span-4 text-left font-mono font-black text-slate-900 sm:col-span-2 sm:text-center">{formatMoney(row.lineTotal)}</div>
      <div className="col-span-12 flex justify-end sm:col-span-1">
        {editable ? (
          <button type="button" onClick={onRemove} className="rounded-md border border-rose-200 bg-rose-50 p-1.5 text-rose-700">
            <Trash2 size={12} />
          </button>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">ضيف</span>
        )}
      </div>
    </div>
  );
};

export default TableOrderItemRow;

