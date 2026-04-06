import React from 'react';
import { ClipboardList } from 'lucide-react';
import QrMenuItemCard from './QrMenuItemCard';
import type { MenuDisplayItem } from './types';

type QrMenuGridProps = {
  loading: boolean;
  items: MenuDisplayItem[];
  busyItemId?: string | null;
  onEdit: (item: MenuDisplayItem) => void;
  onRemove: (item: MenuDisplayItem) => void;
  onToggleVisibility: (item: MenuDisplayItem) => void;
  onAdd: () => void;
};

const QrMenuGrid: React.FC<QrMenuGridProps> = ({ loading, items, busyItemId, onEdit, onRemove, onToggleVisibility, onAdd }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, idx) => (
          <div key={idx} className="h-[320px] animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white py-16 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <ClipboardList size={24} />
        </div>
        <div className="text-lg font-black text-slate-900">لا توجد أصناف في منيو QR حتى الآن</div>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          أضف أصنافًا لتظهر للعميل عبر منيو QR
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
        >
          إضافة صنف للمنيو
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {items.map((item) => (
        <QrMenuItemCard
          key={item.itemId}
          item={item}
          busy={busyItemId === item.itemId}
          onEdit={onEdit}
          onRemove={onRemove}
          onToggleVisibility={onToggleVisibility}
        />
      ))}
    </div>
  );
};

export default QrMenuGrid;
