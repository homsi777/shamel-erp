import React from 'react';
import { Copy, Trash2 } from 'lucide-react';
import Combobox from '../Combobox';
import { Currency, OpeningStockLine } from '../../types';
import { confirmDialog } from '../../lib/confirm';

interface StockLinesTableProps {
  lines: OpeningStockLine[];
  items: { id: string; name: string; code: string; unit: string }[];
  warehouses: { id: string; name: string }[];
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onDuplicateLine: (id: string) => void;
  onUpdateLine: (id: string, field: keyof OpeningStockLine, value: any) => void;
}

const StockLinesTable: React.FC<StockLinesTableProps> = ({
  lines,
  items,
  warehouses,
  onAddLine,
  onRemoveLine,
  onDuplicateLine,
  onUpdateLine
}) => {
  const MAX_LINES = 500;
  const FIELD_ORDER = ['item_id', 'quantity', 'cost_price', 'currency', 'warehouse_id', 'notes'] as const;

  const duplicateKey = (line: OpeningStockLine) => `${line.item_id || 'x'}-${line.warehouse_id || 'x'}`;
  const duplicateMap = new Map<string, number>();
  lines.forEach((line) => {
    if (!line.item_id || !line.warehouse_id) return;
    const key = duplicateKey(line);
    duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
  });

  const hasDuplicate = (line: OpeningStockLine) => {
    if (!line.item_id || !line.warehouse_id) return false;
    return (duplicateMap.get(duplicateKey(line)) || 0) > 1;
  };

  const validateLine = (line: OpeningStockLine) => {
    const errors: string[] = [];
    if (!line.item_id) errors.push('يرجى اختيار صنف');
    if (!line.warehouse_id) errors.push('يرجى اختيار مخزن');
    if (!line.quantity || line.quantity <= 0) errors.push('الكمية مطلوبة');
    if (!line.cost_price || line.cost_price <= 0) errors.push('التكلفة مطلوبة');
    return errors;
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: 'تأكيد الحذف',
      message: 'هل تريد حذف هذا السطر؟',
      confirmText: 'حذف',
      cancelText: 'إلغاء'
    });
    if (ok) onRemoveLine(id);
  };

  const showToast = (message: string) => {
    window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message } }));
  };

  const getNextFieldIndex = (field: string) => {
    const idx = FIELD_ORDER.indexOf(field as any);
    return idx < 0 ? 0 : Math.min(idx + 1, FIELD_ORDER.length - 1);
  };

  const focusField = (lineIndex: number, fieldIndex: number) => {
    const nextField = document.querySelector(
      `[data-line-index="${lineIndex}"][data-field-index="${fieldIndex}"]`
    ) as HTMLElement | null;
    nextField?.focus();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    lineIndex: number,
    fieldName: string,
    isLastField: boolean
  ) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    if (isLastField) {
      if (lines.length >= MAX_LINES) {
        showToast('تم الوصول إلى الحد الأقصى للأسطر (500).');
        return;
      }
      onAddLine();
      setTimeout(() => focusField(lineIndex + 1, 0), 50);
      return;
    }

    const nextIndex = getNextFieldIndex(fieldName);
    focusField(lineIndex, nextIndex);
  };

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-gray-800">جدول الأصناف</h2>
        <button
          onClick={onAddLine}
          className="text-sm font-bold text-primary hover:text-teal-700"
        >
          + إضافة سطر
        </button>
      </div>

      <div className="space-y-4">
        {lines.map((line, index) => {
          const errors = validateLine(line);
          const duplicate = hasDuplicate(line);
          return (
            <div
              key={line.id}
              className={`border rounded-2xl p-4 md:p-5 ${errors.length ? 'border-rose-300 bg-rose-50/30' : 'border-gray-200'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-black text-gray-800">السطر #{index + 1}</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onDuplicateLine(line.id)}
                    className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1"
                  >
                    <Copy size={14} /> نسخ
                  </button>
                  <button
                    onClick={() => handleDelete(line.id)}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1"
                  >
                    <Trash2 size={14} /> حذف
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-3">
                  <label className="block text-xs font-bold text-gray-500 mb-2">الصنف</label>
                  <Combobox
                    items={items.map((item) => ({ id: String(item.id), label: item.name, subLabel: item.code }))}
                    selectedId={line.item_id ? String(line.item_id) : ''}
                    onSelect={(id, name) => onUpdateLine(line.id, 'item_id', id || null)}
                    onNext={() => focusField(index, 1)}
                    placeholder="اختر الصنف"
                    inputProps={{
                      'data-line-index': index,
                      'data-field-index': 0
                    }}
                  />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">الوحدة</label>
                  <input
                    type="text"
                    value={line.unit}
                    readOnly
                    className="w-full border rounded-xl p-2 font-bold text-gray-500 bg-gray-50"
                  />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">الكمية</label>
                  <input
                    type="number"
                    value={line.quantity || ''}
                    onChange={(e) => onUpdateLine(line.id, 'quantity', Number(e.target.value || 0))}
                    onKeyDown={(e) => handleKeyDown(e, index, 'quantity', false)}
                    data-line-index={index}
                    data-field-index={1}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">سعر التكلفة</label>
                  <input
                    type="number"
                    value={line.cost_price || ''}
                    onChange={(e) => onUpdateLine(line.id, 'cost_price', Number(e.target.value || 0))}
                    onKeyDown={(e) => handleKeyDown(e, index, 'cost_price', false)}
                    data-line-index={index}
                    data-field-index={2}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                  />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">العملة</label>
                  <select
                    value={line.currency}
                    onChange={(e) => onUpdateLine(line.id, 'currency', e.target.value as Currency)}
                    onKeyDown={(e) => handleKeyDown(e, index, 'currency', false)}
                    data-line-index={index}
                    data-field-index={3}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 bg-white"
                  >
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">المخزن</label>
                  <select
                    value={line.warehouse_id ?? ''}
                    onChange={(e) => onUpdateLine(line.id, 'warehouse_id', e.target.value || null)}
                    onKeyDown={(e) => handleKeyDown(e, index, 'warehouse_id', true)}
                    data-line-index={index}
                    data-field-index={4}
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
                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">الإجمالي</label>
                  <input
                    type="text"
                    value={line.total.toFixed(2)}
                    readOnly
                    className="w-full border rounded-xl p-2 font-bold text-gray-500 bg-gray-50"
                  />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">ملاحظة</label>
                  <input
                    type="text"
                    value={line.notes}
                    onChange={(e) => onUpdateLine(line.id, 'notes', e.target.value)}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800"
                    onKeyDown={(e) => handleKeyDown(e, index, 'notes', true)}
                    data-line-index={index}
                    data-field-index={5}
                  />
                </div>
              </div>

              {duplicate && (
                <div className="mt-3 text-xs font-bold text-amber-600">
                  تحذير: لا يُسمح بتكرار نفس الصنف في نفس المخزن.
                </div>
              )}

              {errors.length > 0 && (
                <div className="mt-3 text-xs font-bold text-rose-600">
                  {errors.join(' — ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StockLinesTable;
