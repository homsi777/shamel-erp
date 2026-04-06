import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Plus, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';

const normalizeLines = (value: string) =>
  value
    .split(/\r?\n|,/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

const SerialEntryModal: React.FC<{
  open: boolean;
  itemName: string;
  quantity: number;
  onClose: () => void;
  onConfirm: (serialNumbers: string[]) => void;
}> = ({ open, itemName, quantity, onClose, onConfirm }) => {
  const [lines, setLines] = useState('');

  const serialNumbers = useMemo(() => normalizeLines(lines), [lines]);
  const duplicate = serialNumbers.find((value, index) => serialNumbers.indexOf(value) !== index);

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setLines(text);
    event.target.value = '';
  };

  const handleConfirm = () => {
    if (duplicate) {
      alert(`رقم السيريال مكرر داخل القائمة: ${duplicate}`);
      return;
    }
    if (serialNumbers.length !== quantity) {
      alert(`يجب إدخال ${quantity} رقم سيريال بالضبط.`);
      return;
    }
    onConfirm(serialNumbers);
  };

  return (
    <AdaptiveModal open={open} onClose={onClose} size="lg" zIndex={260} panelClassName="flex h-full max-h-[90vh] flex-col">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-blue-50 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-gray-900">إدخال أرقام السيريال</h3>
            <p className="text-[11px] font-bold text-gray-500">
              {itemName} - الكمية المطلوبة: {quantity}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
            <XCircle size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            يمكنك الإدخال اليدوي أو لصق قائمة أو استيراد ملف CSV. ضع كل سيريال في سطر مستقل أو افصل بين القيم بفاصلة.
          </div>

          <textarea
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            rows={14}
            className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-mono text-sm outline-none focus:border-blue-500"
            placeholder={`SN-1001\nSN-1002\nSN-1003`}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 hover:bg-gray-50">
              <FileSpreadsheet size={16} />
              استيراد CSV
              <input type="file" accept=".csv,.txt" onChange={handleCsvImport} className="hidden" />
            </label>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm font-bold text-gray-600">
              عدد السيريالات: {serialNumbers.length}
            </div>
            {duplicate && (
              <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                تكرار: {duplicate}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-4">
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-black text-gray-600">
            إلغاء
          </button>
          <button type="button" onClick={handleConfirm} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">
            <Plus size={16} />
            اعتماد السيريالات
          </button>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default SerialEntryModal;
