import React, { useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { InventoryItem, TextileColor, TextileInventoryBalance, Warehouse } from '../types';
import Combobox from '../components/Combobox';
import { AdaptiveTable, ResponsivePage } from '../components/responsive';

interface TextileInventoryProps {
  items: InventoryItem[];
  warehouses: Warehouse[];
}

const TextileInventory: React.FC<TextileInventoryProps> = ({ items, warehouses }) => {
  const [balances, setBalances] = useState<TextileInventoryBalance[]>([]);
  const [colors, setColors] = useState<TextileColor[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedColorId, setSelectedColorId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [loading, setLoading] = useState(false);

  const textileItems = useMemo(() => items.filter((item) => item.isTextile), [items]);

  const loadData = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (selectedItemId) query.set('itemId', selectedItemId);
      if (selectedColorId) query.set('colorId', selectedColorId);
      if (selectedWarehouseId) query.set('warehouseId', selectedWarehouseId);
      const [inventoryRows, colorRows] = await Promise.all([
        apiRequest(`textile/inventory${query.toString() ? `?${query.toString()}` : ''}`),
        apiRequest('textile/colors'),
      ]);
      setBalances(Array.isArray(inventoryRows) ? inventoryRows : []);
      setColors(Array.isArray(colorRows) ? colorRows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [selectedItemId, selectedColorId, selectedWarehouseId]);

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="max-w-[1500px] py-4 md:py-6">
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900">مخزون الأقمشة</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">الرصيد القماشي يظهر بالرولات والطول الإجمالي مع بُعد اللون.</p>
            </div>
            <button
              onClick={() => void loadData()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الصنف القماشي</label>
              <Combobox
                items={textileItems.map((item) => ({ id: item.id, label: item.name, subLabel: item.code }))}
                selectedId={selectedItemId}
                onSelect={(id) => setSelectedItemId(id)}
                placeholder="كل الأصناف"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">اللون</label>
              <Combobox
                items={colors.map((color) => ({ id: color.id, label: color.name, subLabel: color.code || undefined }))}
                selectedId={selectedColorId}
                onSelect={(id) => setSelectedColorId(id)}
                placeholder="كل الألوان"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">المستودع</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-primary"
              >
                <option value="">كل المستودعات</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs font-bold text-emerald-700">إجمالي الرولات</div>
            <div className="mt-2 text-3xl font-black text-emerald-900">
              {balances.reduce((sum, row) => sum + Number(row.rollCount || 0), 0)}
            </div>
          </div>
          <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4">
            <div className="text-xs font-bold text-sky-700">إجمالي الأطوال</div>
            <div className="mt-2 text-3xl font-black text-sky-900">
              {balances.reduce((sum, row) => sum + Number(row.totalLength || 0), 0).toFixed(2)}
            </div>
          </div>
          <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4">
            <div className="text-xs font-bold text-violet-700">سجلات الألوان</div>
            <div className="mt-2 text-3xl font-black text-violet-900">{balances.length}</div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
            <Filter size={16} />
            أرصدة المخزون القماشي
          </div>
          <AdaptiveTable
            rows={balances}
            keyExtractor={(row) => row.id}
            emptyState={<div className="p-10 text-center font-bold text-slate-400">لا توجد أرصدة مطابقة.</div>}
            columns={[
              {
                id: 'item',
                header: 'الصنف',
                cell: (row: TextileInventoryBalance) => (
                  <div>
                    <div className="font-bold text-slate-900">{row.itemName || row.itemId}</div>
                    <div className="text-xs font-semibold text-slate-500">{row.itemCode || row.itemId}</div>
                  </div>
                ),
              },
              {
                id: 'color',
                header: 'اللون',
                cell: (row: TextileInventoryBalance) => <span className="font-bold text-sky-700">{row.colorName || row.colorId}</span>,
              },
              {
                id: 'warehouse',
                header: 'المستودع',
                cell: (row: TextileInventoryBalance) => <span className="font-semibold">{row.warehouseName || row.warehouseId}</span>,
              },
              {
                id: 'rolls',
                header: 'الرولات',
                cell: (row: TextileInventoryBalance) => <span className="font-numeric font-black">{row.rollCount}</span>,
                tdClassName: 'text-center',
              },
              {
                id: 'length',
                header: 'الطول',
                cell: (row: TextileInventoryBalance) => (
                  <span className="font-numeric font-black text-emerald-700">
                    {Number(row.totalLength || 0).toFixed(2)} {row.baseUom === 'yard' ? 'ياردة' : 'متر'}
                  </span>
                ),
                tdClassName: 'text-center',
              },
            ]}
            mobileCardRender={(row: TextileInventoryBalance) => (
              <div className="space-y-3">
                <div>
                  <div className="font-black text-slate-900">{row.itemName || row.itemId}</div>
                  <div className="text-sm font-bold text-sky-700">{row.colorName || row.colorId}</div>
                  <div className="text-xs font-semibold text-slate-500">{row.warehouseName || row.warehouseId}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-amber-50 p-3 text-center">
                    <div className="text-xs font-bold text-amber-700">الرولات</div>
                    <div className="mt-1 font-numeric text-xl font-black text-amber-900">{row.rollCount}</div>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-3 text-center">
                    <div className="text-xs font-bold text-emerald-700">الطول</div>
                    <div className="mt-1 font-numeric text-xl font-black text-emerald-900">
                      {Number(row.totalLength || 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          />
        </div>
      </div>
    </ResponsivePage>
  );
};

export default TextileInventory;
