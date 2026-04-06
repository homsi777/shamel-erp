import React, { useEffect, useState } from 'react';
import { Search, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';
import { apiRequest } from '../../lib/api';
import type { ItemSerial } from '../../types';

const SerialSelectionModal: React.FC<{
  open: boolean;
  itemId: string;
  itemName: string;
  warehouseId?: string;
  quantity: number;
  required: boolean;
  onClose: () => void;
  onConfirm: (serialNumbers: string[]) => void;
}> = ({ open, itemId, itemName, warehouseId, quantity, required, onClose, onConfirm }) => {
  const [rows, setRows] = useState<ItemSerial[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setSearch('');
    setPage(1);
  }, [open, itemId]);

  useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          itemId,
          status: 'available',
          page: String(page),
          pageSize: '50',
          search,
        });
        if (warehouseId) query.set('warehouseId', warehouseId);
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
  }, [open, itemId, warehouseId, page, search]);

  const toggle = (serialNumber: string) => {
    setSelected((prev) => {
      const exists = prev.includes(serialNumber);
      if (exists) return prev.filter((value) => value !== serialNumber);
      if (prev.length >= quantity) return prev;
      return [...prev, serialNumber];
    });
  };

  const handleConfirm = () => {
    if (required && selected.length !== quantity) {
      alert(`يجب اختيار ${quantity} رقم سيريال.`);
      return;
    }
    onConfirm(selected);
  };

  return (
    <AdaptiveModal open={open} onClose={onClose} size="lg" zIndex={260} panelClassName="flex h-full max-h-[90vh] flex-col">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-emerald-50 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-gray-900">اختيار رقم السيريال</h3>
            <p className="text-[11px] font-bold text-gray-500">
              {itemName} - المطلوب: {quantity}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
            <XCircle size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-3 text-gray-300" size={16} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ابحث برقم السيريال"
              className="w-full rounded-xl border border-gray-200 px-3 py-3 pl-8 font-bold outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-2">
            {rows.map((row) => {
              const checked = selected.includes(row.serialNumber);
              return (
                <label key={row.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 px-3 py-3 hover:bg-gray-50">
                  <input type="checkbox" checked={checked} onChange={() => toggle(row.serialNumber)} />
                  <div className="font-mono text-sm font-bold text-gray-800">{row.serialNumber}</div>
                </label>
              );
            })}

            {!loading && rows.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm font-bold text-gray-400">
                لا توجد سيريالات متاحة.
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm font-bold text-gray-600">
              تم اختيار {selected.length} من {quantity}
            </div>
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

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-4">
          {!required && (
            <button type="button" onClick={() => onConfirm([])} className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-black text-gray-600">
              متابعة بدون سيريال
            </button>
          )}
          <button type="button" onClick={handleConfirm} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">
            اعتماد الاختيار
          </button>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default SerialSelectionModal;
