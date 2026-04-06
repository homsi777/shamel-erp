import React from 'react';
import TableOrderItemRow from './TableOrderItemRow';
import type { WorkspaceItemRow } from '../types';

type Props = {
  rows: WorkspaceItemRow[];
  formatMoney: (value: number) => string;
  onIncCashierLine: (key: string) => void;
  onDecCashierLine: (key: string) => void;
  onRemoveCashierLine: (key: string) => void;
};

const TableOrderItemsList: React.FC<Props> = ({ rows, formatMoney, onIncCashierLine, onDecCashierLine, onRemoveCashierLine }) => {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black tracking-wide text-slate-500">
        <div className="col-span-12 sm:col-span-5">الصنف</div>
        <div className="col-span-4 sm:col-span-2 text-center">سعر الوحدة</div>
        <div className="col-span-4 sm:col-span-2 text-center">الكمية</div>
        <div className="col-span-4 sm:col-span-2 text-center">إجمالي السطر</div>
        <div className="col-span-12 sm:col-span-1 text-left sm:text-center">إجراء</div>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm font-bold text-slate-500">لا توجد أصناف في هذا الطلب حتى الآن.</div>
      ) : (
        <div className="max-h-[52vh] overflow-auto">
          {rows.map((row) => (
            <TableOrderItemRow
              key={row.key}
              row={row}
              formatMoney={formatMoney}
              editable={row.source === 'cashier'}
              onInc={() => onIncCashierLine(row.key)}
              onDec={() => onDecCashierLine(row.key)}
              onRemove={() => onRemoveCashierLine(row.key)}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default TableOrderItemsList;

