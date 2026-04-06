import React from 'react';
import { Trash2 } from 'lucide-react';
import Combobox from '../Combobox';
import { Currency, OpeningAccountType, OpeningBalanceLine } from '../../types';
import { confirmDialog } from '../../lib/confirm';

const ACCOUNT_TYPE_CONFIG: Record<OpeningAccountType, { label: string; bg: string; border: string }> = {
  customer: { label: '👤 عميل', bg: 'bg-blue-950/10', border: 'border-blue-200' },
  supplier: { label: '🏭 مورد', bg: 'bg-orange-950/10', border: 'border-orange-200' },
  cash_box: { label: '💵 صندوق نقدي', bg: 'bg-green-950/10', border: 'border-green-200' },
  account: { label: '📊 شجرة الحسابات', bg: 'bg-purple-950/10', border: 'border-purple-200' }
};

interface BalancesLinesTableProps {
  lines: OpeningBalanceLine[];
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  cashBoxes: { id: string; name: string }[];
  accounts: { id: string; name: string; code?: string }[];
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onUpdateLine: (id: string, field: keyof OpeningBalanceLine, value: any) => void;
}

const BalancesLinesTable: React.FC<BalancesLinesTableProps> = ({
  lines,
  customers,
  suppliers,
  cashBoxes,
  accounts,
  onAddLine,
  onRemoveLine,
  onUpdateLine
}) => {
  const MAX_LINES = 500;
  const FIELD_ORDER = ['account_type', 'account_id', 'debit', 'credit', 'currency', 'notes'] as const;

  const getList = (type: OpeningAccountType) => {
    switch (type) {
      case 'customer':
        return customers.map((c) => ({ id: String(c.id), label: c.name }));
      case 'supplier':
        return suppliers.map((c) => ({ id: String(c.id), label: c.name }));
      case 'cash_box':
        return cashBoxes.map((c) => ({ id: String(c.id), label: c.name }));
      case 'account':
        return accounts.map((c) => ({ id: String(c.id), label: c.name, subLabel: c.code ? `كود: ${c.code}` : undefined }));
      default:
        return [];
    }
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
        <h2 className="text-lg font-black text-gray-800">أسطر الأموال</h2>
        <button onClick={onAddLine} className="text-sm font-bold text-primary hover:text-teal-700">
          + إضافة سطر
        </button>
      </div>

      <div className="space-y-4">
        {lines.map((line, index) => {
          const config = ACCOUNT_TYPE_CONFIG[line.account_type];
          const hasDebit = Number(line.debit) > 0;
          const hasCredit = Number(line.credit) > 0;
          const invalid = (hasDebit && hasCredit) || (!hasDebit && !hasCredit);
          return (
            <div
              key={line.id}
              className={`border rounded-2xl p-4 md:p-5 ${config.bg} ${config.border} ${invalid ? 'border-rose-400' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-black text-gray-800">السطر #{index + 1}</div>
                <button
                  onClick={() => handleDelete(line.id)}
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1"
                >
                  <Trash2 size={14} /> حذف
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">نوع الحساب</label>
                  <select
                    value={line.account_type}
                    onChange={(e) => onUpdateLine(line.id, 'account_type', e.target.value as OpeningAccountType)}
                    onKeyDown={(e) => handleKeyDown(e, index, 'account_type', false)}
                    data-line-index={index}
                    data-field-index={0}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 bg-white"
                  >
                    {Object.entries(ACCOUNT_TYPE_CONFIG).map(([key, value]) => (
                      <option key={key} value={key}>
                        {value.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-xs font-bold text-gray-500 mb-2">الحساب</label>
                  <Combobox
                    items={getList(line.account_type)}
                    selectedId={line.account_id ? String(line.account_id) : ''}
                    onSelect={(id, name) => {
                      onUpdateLine(line.id, 'account_id', id || null);
                      onUpdateLine(line.id, 'account_name', name || '');
                    }}
                    onNext={() => focusField(index, 2)}
                    placeholder="اختر الحساب"
                    inputProps={{
                      'data-line-index': index,
                      'data-field-index': 1
                    }}
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">مدين</label>
                  <input
                    type="number"
                    value={line.debit || ''}
                    onChange={(e) => onUpdateLine(line.id, 'debit', Number(e.target.value || 0))}
                    onKeyDown={(e) => handleKeyDown(e, index, 'debit', false)}
                    data-line-index={index}
                    data-field-index={2}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">دائن</label>
                  <input
                    type="number"
                    value={line.credit || ''}
                    onChange={(e) => onUpdateLine(line.id, 'credit', Number(e.target.value || 0))}
                    onKeyDown={(e) => handleKeyDown(e, index, 'credit', false)}
                    data-line-index={index}
                    data-field-index={3}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                  />
                </div>

                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">العملة</label>
                  <select
                    value={line.currency}
                    onChange={(e) => onUpdateLine(line.id, 'currency', e.target.value as Currency)}
                    onKeyDown={(e) => handleKeyDown(e, index, 'currency', true)}
                    data-line-index={index}
                    data-field-index={4}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 bg-white"
                  >
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>

                <div className="lg:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 mb-2">ملاحظة</label>
                  <input
                    type="text"
                    value={line.notes}
                    onChange={(e) => onUpdateLine(line.id, 'notes', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, 'notes', true)}
                    data-line-index={index}
                    data-field-index={5}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800"
                  />
                </div>
              </div>
              {invalid && (
                <div className="mt-3 text-xs font-bold text-rose-600">
                  يجب إدخال مدين أو دائن فقط (لا يمكن تركهما فارغين أو إدخالهما معاً).
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BalancesLinesTable;
