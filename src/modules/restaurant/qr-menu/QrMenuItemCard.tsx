import React from 'react';
import { Eye, EyeOff, Pencil, Trash2, UtensilsCrossed } from 'lucide-react';
import type { MenuDisplayItem } from './types';

type QrMenuItemCardProps = {
  item: MenuDisplayItem;
  busy?: boolean;
  onEdit: (item: MenuDisplayItem) => void;
  onRemove: (item: MenuDisplayItem) => void;
  onToggleVisibility: (item: MenuDisplayItem) => void;
};

const QrMenuItemCard: React.FC<QrMenuItemCardProps> = ({ item, busy, onEdit, onRemove, onToggleVisibility }) => {
  const hasImage = Boolean(item.imageUrl);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="aspect-[4/3] w-full bg-slate-100">
        {hasImage ? (
          <img src={item.imageUrl || ''} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300">
            <UtensilsCrossed size={28} />
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <div className="line-clamp-1 text-base font-black text-slate-900">{item.name}</div>
          <div className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{item.category}</div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-lg font-black text-slate-900">{Number(item.price || 0).toLocaleString('en-US')} </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-black ${
              item.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {item.status === 'active' ? 'نشط' : 'مخفي'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-black text-slate-700 disabled:opacity-60"
          >
            <Pencil size={13} /> تعديل
          </button>
          <button
            type="button"
            onClick={() => onToggleVisibility(item)}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-black text-amber-900 disabled:opacity-60"
          >
            {item.status === 'active' ? <EyeOff size={13} /> : <Eye size={13} />}
            {item.status === 'active' ? 'إخفاء' : 'إظهار'}
          </button>
          <button
            type="button"
            onClick={() => onRemove(item)}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-black text-rose-800 disabled:opacity-60"
            title="إزالة من منيو QR"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </article>
  );
};

export default QrMenuItemCard;
