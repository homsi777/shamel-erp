import React from 'react';
import { CurrencyBalance } from '../../types';

interface MultiCurrencyIndicatorProps {
  balances: CurrencyBalance[];
}

const MultiCurrencyIndicator: React.FC<MultiCurrencyIndicatorProps> = ({ balances }) => {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-gray-800">ملخص العملات</h2>
        <span className="text-xs font-bold text-gray-500">USD / SYP / TRY</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {balances.map((balance) => {
          const used = balance.is_used;
          const bg = used ? 'bg-slate-50 border-slate-200' : 'bg-gray-50 border-gray-200';
          return (
            <div key={balance.currency} className={`rounded-2xl border p-4 ${bg}`}>
              <div className="text-xs text-gray-500 font-bold">العملة</div>
              <div className="text-lg font-black text-gray-800">{balance.currency}</div>
              {used ? (
                <div className="mt-2 text-xs font-bold">
                  <div>مدين: {balance.total_debit.toFixed(2)}</div>
                  <div>دائن: {balance.total_credit.toFixed(2)}</div>
                  {balance.difference !== 0 && (
                    <div className="text-slate-600">الفرق: {Math.abs(balance.difference).toFixed(2)}</div>
                  )}
                  <div className="mt-1 text-slate-600">
                    {balance.is_balanced ? 'متوازن' : 'موازنة تلقائية'}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs font-bold text-gray-500">غير مستخدمة</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MultiCurrencyIndicator;
