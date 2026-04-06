import React from 'react';

interface BalancesHeaderProps {
  fiscalYear: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  onChange: (next: Partial<BalancesHeaderProps>) => void;
}

const BalancesHeader: React.FC<BalancesHeaderProps> = ({
  fiscalYear,
  entryNumber,
  entryDate,
  description,
  onChange
}) => {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-gray-800">بيانات قيد الأموال</h2>
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
          <label className="block text-xs font-bold text-gray-500 mb-2">رقم القيد</label>
          <input
            type="text"
            value={entryNumber}
            onChange={(e) => onChange({ entryNumber: e.target.value })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-2">التاريخ</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => onChange({ entryDate: e.target.value })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-2">الوصف</label>
          <input
            type="text"
            value={description}
            onChange={(e) => onChange({ description: e.target.value })}
            className="w-full border rounded-xl p-2 font-bold text-gray-800"
          />
        </div>
      </div>
    </div>
  );
};

export default BalancesHeader;
