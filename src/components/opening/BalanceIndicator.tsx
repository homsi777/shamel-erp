import React from 'react';

interface BalanceIndicatorProps {
  totalDebit: number;
  totalCredit: number;
}

const BalanceIndicator: React.FC<BalanceIndicatorProps> = ({ totalDebit, totalCredit }) => {
  const diff = Number((totalDebit - totalCredit).toFixed(2));

  return (
    <div className="rounded-2xl border p-4 md:p-5 shadow-sm bg-slate-50 border-slate-200">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-gray-800">ملخص المبالغ</h3>
          <p className="text-xs text-gray-500">سيتم موازنة القيد تلقائياً عند الترحيل</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-xl border px-3 py-2">
            <div className="text-[10px] text-gray-500 font-bold">إجمالي المدين</div>
            <div className="text-lg font-black text-gray-800 font-numeric">{totalDebit.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-xl border px-3 py-2">
            <div className="text-[10px] text-gray-500 font-bold">إجمالي الدائن</div>
            <div className="text-lg font-black text-gray-800 font-numeric">{totalCredit.toFixed(2)}</div>
          </div>
          {diff !== 0 && (
            <div className="rounded-xl px-3 py-2 border bg-slate-200 text-slate-700 border-slate-300">
              <div className="text-[10px] font-bold">الفرق</div>
              <div className="text-lg font-black font-numeric">{Math.abs(diff).toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 text-sm font-bold text-slate-600">
        {diff === 0 ? 'القيد متوازن' : 'سيتم إضافة سطر موازنة تلقائي'}
      </div>
    </div>
  );
};

export default BalanceIndicator;
