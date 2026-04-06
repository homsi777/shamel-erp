import React from 'react';

interface DraftEntry {
  id: string;
  entryNumber: string;
  fiscalYear: string;
  entryDate: string;
  description?: string;
  totalDebit: number;
  totalCredit: number;
  lineCount: number;
}

interface OpeningEntriesListProps {
  entries: DraftEntry[];
}

const OpeningEntriesList: React.FC<OpeningEntriesListProps> = ({ entries }) => {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-gray-800">قائمة القيود (مسودات)</h2>
        <span className="text-xs font-bold text-gray-500">عرض محلي داخل الواجهة</span>
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed rounded-xl p-6 text-center text-gray-400 font-bold">
          لا توجد مسودات محفوظة بعد
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="border rounded-xl p-3 hover:bg-gray-50 transition">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-gray-800">{entry.entryNumber}</div>
                  <div className="text-xs text-gray-500">{entry.fiscalYear} • {entry.entryDate}</div>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${entry.totalDebit === entry.totalCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {entry.totalDebit === entry.totalCredit ? 'متوازن' : 'غير متوازن'}
                </span>
              </div>
              <div className="mt-2 text-xs text-gray-600">{entry.description || 'بدون وصف'}</div>
              <div className="mt-2 flex items-center gap-3 text-xs font-bold text-gray-700">
                <span>المدين: {entry.totalDebit.toFixed(2)}</span>
                <span>الدائن: {entry.totalCredit.toFixed(2)}</span>
                <span>عدد الأسطر: {entry.lineCount}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OpeningEntriesList;
