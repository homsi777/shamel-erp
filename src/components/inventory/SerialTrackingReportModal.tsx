import React, { useEffect, useMemo, useState } from 'react';
import { Search, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';
import { apiRequest } from '../../lib/api';
import type { InventoryItem, ItemSerial, Warehouse } from '../../types';

type SerialStatus = 'all' | 'available' | 'reserved' | 'sold' | 'returned' | 'damaged';

const STATUS_LABELS: Record<SerialStatus, string> = {
  all: 'كل الحالات',
  available: 'متاح',
  reserved: 'محجوز',
  sold: 'مباع',
  returned: 'مرتجع',
  damaged: 'تالف',
};

const SerialTrackingReportModal: React.FC<{
  open: boolean;
  onClose: () => void;
  items: InventoryItem[];
  warehouses: Warehouse[];
}> = ({ open, onClose, items, warehouses }) => {
  const [rows, setRows] = useState<ItemSerial[]>([]);
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<SerialStatus>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const trackedItems = useMemo(
    () => items.filter((item) => String(item.serialTracking || 'none') !== 'none' && !item.inactive && !item.merged),
    [items],
  );

  useEffect(() => {
    if (!open) return;
    setPage(1);
  }, [open, itemId, warehouseId, status, search]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: '50',
          search,
        });
        if (itemId) query.set('itemId', itemId);
        if (warehouseId) query.set('warehouseId', warehouseId);
        if (status !== 'all') query.set('status', status);
        const result = await apiRequest(`inventory/serials?${query.toString()}`);
        if (!cancelled) {
          setRows(Array.isArray(result?.rows) ? result.rows : []);
          setHasMore(Boolean(result?.hasMore));
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, itemId, warehouseId, status, search, page]);

  const itemMap = useMemo(() => new Map(items.map((item) => [String(item.id), item])), [items]);
  const warehouseMap = useMemo(() => new Map(warehouses.map((warehouse) => [String(warehouse.id), warehouse])), [warehouses]);

  const statusCounts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status in acc) {
          (acc as any)[row.status] += 1;
        }
        return acc;
      },
      { total: 0, available: 0, reserved: 0, sold: 0, returned: 0, damaged: 0 },
    );
  }, [rows]);

  return (
    <AdaptiveModal open={open} onClose={onClose} size="xl" zIndex={240} panelClassName="flex h-full max-h-[92vh] flex-col">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-slate-50 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-gray-900">تقرير تتبع السيريال</h3>
            <p className="text-[11px] font-bold text-gray-500">استعراض السيريالات حسب المادة والمستودع والحالة</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
            <XCircle size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 md:grid-cols-4">
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
            >
              <option value="">كل المواد المتتبعة</option>
              {trackedItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
            >
              <option value="">كل المستودعات</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SerialStatus)}
              className="rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 text-gray-300" size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم السيريال"
                className="w-full rounded-xl border border-gray-200 px-3 py-3 pl-8 font-bold outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-3 text-center">
              <div className="text-[11px] font-black text-gray-500">الإجمالي</div>
              <div className="mt-1 text-xl font-black text-gray-900">{statusCounts.total}</div>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-center">
              <div className="text-[11px] font-black text-emerald-700">متاح</div>
              <div className="mt-1 text-xl font-black text-emerald-800">{statusCounts.available}</div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-center">
              <div className="text-[11px] font-black text-amber-700">محجوز</div>
              <div className="mt-1 text-xl font-black text-amber-800">{statusCounts.reserved}</div>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-center">
              <div className="text-[11px] font-black text-blue-700">مباع</div>
              <div className="mt-1 text-xl font-black text-blue-800">{statusCounts.sold}</div>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-center">
              <div className="text-[11px] font-black text-violet-700">مرتجع</div>
              <div className="mt-1 text-xl font-black text-violet-800">{statusCounts.returned}</div>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3 text-center">
              <div className="text-[11px] font-black text-rose-700">تالف</div>
              <div className="mt-1 text-xl font-black text-rose-800">{statusCounts.damaged}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr className="text-right text-xs font-black text-gray-500">
                    <th className="px-4 py-3">السيريال</th>
                    <th className="px-4 py-3">المادة</th>
                    <th className="px-4 py-3">المستودع</th>
                    <th className="px-4 py-3">الحالة</th>
                    <th className="px-4 py-3">فاتورة الشراء</th>
                    <th className="px-4 py-3">فاتورة البيع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm font-bold text-gray-400">
                        لا توجد بيانات مطابقة للفلاتر الحالية.
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.id} className="text-sm">
                      <td className="px-4 py-3 font-mono font-bold text-gray-800">{row.serialNumber}</td>
                      <td className="px-4 py-3 font-bold text-gray-700">{itemMap.get(String(row.itemId))?.name || row.itemId}</td>
                      <td className="px-4 py-3 font-bold text-gray-600">{warehouseMap.get(String(row.warehouseId || ''))?.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-black text-gray-700">
                          {STATUS_LABELS[(row.status as SerialStatus) || 'available'] || row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-numeric text-gray-500">{row.purchaseInvoiceId || '—'}</td>
                      <td className="px-4 py-3 font-numeric text-gray-500">{row.salesInvoiceId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-600">صفحة {page}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-black text-gray-600 disabled:opacity-50"
              >
                السابق
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!hasMore}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-black text-gray-600 disabled:opacity-50"
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default SerialTrackingReportModal;
