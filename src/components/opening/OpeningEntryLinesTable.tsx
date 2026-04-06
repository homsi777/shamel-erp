import React from 'react';
import { Trash2 } from 'lucide-react';
import Combobox from '../Combobox';

export type OpeningAccountType = 'customer' | 'supplier' | 'cash_box' | 'item' | 'account';

export interface OpeningLine {
  id: string;
  accountType: OpeningAccountType;
  accountId?: string;
  accountName?: string;
  accountCode?: string;
  debit: number;
  credit: number;
  notes?: string;
  itemId?: string;
  itemQuantity?: number;
  itemCost?: number;
  warehouseId?: string;
}

interface NamedItem {
  id: string;
  name: string;
  code?: string;
}

interface OpeningEntryLinesTableProps {
  lines: OpeningLine[];
  setLines: (next: OpeningLine[]) => void;
  customers: NamedItem[];
  suppliers: NamedItem[];
  cashBoxes: NamedItem[];
  items: NamedItem[];
  warehouses: NamedItem[];
  accounts: NamedItem[];
}

const OpeningEntryLinesTable: React.FC<OpeningEntryLinesTableProps> = ({
  lines,
  setLines,
  customers,
  suppliers,
  cashBoxes,
  items,
  warehouses,
  accounts
}) => {
  const accountTypeLabel: Record<OpeningAccountType, string> = {
    customer: 'عميل',
    supplier: 'مورد',
    cash_box: 'صندوق',
    item: 'مخزون',
    account: 'حساب عام'
  };

  const getListForType = (type: OpeningAccountType) => {
    switch (type) {
      case 'customer':
        return customers;
      case 'supplier':
        return suppliers;
      case 'cash_box':
        return cashBoxes;
      case 'item':
        return items;
      case 'account':
        return accounts;
      default:
        return [];
    }
  };

  const updateLine = (id: string, patch: Partial<OpeningLine>) => {
    setLines(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: string) => {
    setLines(lines.filter((line) => line.id !== id));
  };

  const resetAccountFields = (line: OpeningLine, type: OpeningAccountType) => {
    return {
      ...line,
      accountType: type,
      accountId: undefined,
      accountName: undefined,
      accountCode: undefined,
      itemId: undefined,
      itemQuantity: undefined,
      itemCost: undefined,
      warehouseId: undefined
    };
  };

  const isLineInvalid = (line: OpeningLine) => {
    const hasDebit = Number(line.debit) > 0;
    const hasCredit = Number(line.credit) > 0;
    if (hasDebit && hasCredit) return true;
    if (!hasDebit && !hasCredit) return true;
    return false;
  };

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-gray-800">أسطر القيد</h2>
        <span className="text-xs font-bold text-gray-500">كل سطر يمثل حسابًا واحدًا</span>
      </div>

      <div className="space-y-4">
        {lines.length === 0 && (
          <div className="border border-dashed rounded-xl p-6 text-center text-gray-400 font-bold">
            لا يوجد أسطر بعد — أضف أول سطر للبدء
          </div>
        )}

        {lines.map((line, index) => {
          const list = getListForType(line.accountType);
          const listItems = list.map((item) => ({
            id: item.id,
            label: item.name,
            subLabel: item.code ? `كود: ${item.code}` : undefined
          }));
          return (
            <div
              key={line.id}
              className={`border rounded-2xl p-4 md:p-5 ${isLineInvalid(line) ? 'border-rose-300 bg-rose-50/40' : 'border-gray-200'}`}
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                <div className="text-sm font-black text-gray-800">السطر #{index + 1}</div>
                <button
                  onClick={() => removeLine(line.id)}
                  className="text-rose-600 font-bold flex items-center gap-2 hover:text-rose-700"
                >
                  <Trash2 size={16} /> حذف السطر
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">نوع الحساب</label>
                  <select
                    value={line.accountType}
                    onChange={(e) => updateLine(line.id, resetAccountFields(line, e.target.value as OpeningAccountType))}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 bg-white"
                  >
                    {Object.entries(accountTypeLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-4">
                  <label className="block text-xs font-bold text-gray-500 mb-2">الحساب</label>
                  <Combobox
                    items={listItems}
                    selectedId={line.accountId || ''}
                    onSelect={(id, name) => {
                      const patch: Partial<OpeningLine> = { accountId: id, accountName: name };
                      if (line.accountType === 'item') patch.itemId = id;
                      updateLine(line.id, patch);
                    }}
                    placeholder={`اختر ${accountTypeLabel[line.accountType]}`}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">مدين</label>
                  <input
                    type="number"
                    value={line.debit || ''}
                    onChange={(e) => updateLine(line.id, { debit: Number(e.target.value || 0) })}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">دائن</label>
                  <input
                    type="number"
                    value={line.credit || ''}
                    onChange={(e) => updateLine(line.id, { credit: Number(e.target.value || 0) })}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-2">ملاحظات</label>
                  <input
                    type="text"
                    value={line.notes || ''}
                    onChange={(e) => updateLine(line.id, { notes: e.target.value })}
                    className="w-full border rounded-xl p-2 font-bold text-gray-800"
                    placeholder="اختياري"
                  />
                </div>
              </div>

              {line.accountType === 'item' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mt-4">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 mb-2">الكمية</label>
                    <input
                      type="number"
                      value={line.itemQuantity || ''}
                      onChange={(e) => updateLine(line.id, { itemQuantity: Number(e.target.value || 0) })}
                      className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 mb-2">تكلفة الوحدة</label>
                    <input
                      type="number"
                      value={line.itemCost || ''}
                      onChange={(e) => updateLine(line.id, { itemCost: Number(e.target.value || 0) })}
                      className="w-full border rounded-xl p-2 font-bold text-gray-800 font-numeric"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 mb-2">المخزن</label>
                    <select
                      value={line.warehouseId || ''}
                      onChange={(e) => updateLine(line.id, { warehouseId: e.target.value })}
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
                </div>
              )}

              <div className="mt-3 text-xs font-bold text-gray-500">
                النوع الحالي: {accountTypeLabel[line.accountType]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OpeningEntryLinesTable;
