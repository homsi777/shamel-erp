import React from 'react';
import { Currency } from '../../types';

interface StockHeaderProps {
  fiscalYear: string;
  warehouseId: string | null;
  currency: Currency;
  date: string;
  onChange: (next: Partial<{ fiscalYear: string; warehouseId: string | null; currency: Currency; date: string }>) => void;
  warehouses: { id: string; name: string }[];
}

const StockHeader: React.FC<StockHeaderProps> = ({
  fiscalYear,
  warehouseId,
  currency,
  date,
  onChange,
  warehouses
}) => {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-gray-800">إعدادات أول المدة</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-2">السنة المالية</label>
          <input
            type="text"
            value={fiscalYear}
            onChange={(e) => onChange({ fiscalYear: e.target.value })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-2">المخزن</label>
          <select
            value={warehouseId ?? ''}
            onChange={(e) => onChange({ warehouseId: e.target.value || null })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800 bg-white"
          >
            <option value="">اختر مخزن</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-2">العملة الافتراضية</label>
          <select
            value={currency}
            onChange={(e) => onChange({ currency: e.target.value as Currency })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800 bg-white"
          >
            <option value="USD">USD</option>
            <option value="SYP">SYP</option>
            <option value="TRY">TRY</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-2">التاريخ</label>
          <input
            type="date"
            value={date}
            onChange={(e) => onChange({ date: e.target.value })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800"
          />
        </div>
      </div>
    </div>
  );
};

export default StockHeader;
