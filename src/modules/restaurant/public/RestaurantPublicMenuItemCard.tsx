import React from 'react';
import type { PublicMenuItem } from './restaurantPublic.types';

export interface RestaurantPublicMenuItemCardProps {
  item: PublicMenuItem;
  onAdd: () => void;
  /** عند عدم وجود جلسة مفتوحة على الطاولة — الزر يبقى ظاهرًا ويشرح السبب */
  canOrder: boolean;
  onNeedSession?: () => void;
  highlight?: boolean;
}

const RestaurantPublicMenuItemCard: React.FC<RestaurantPublicMenuItemCardProps> = ({ item, onAdd, canOrder, onNeedSession, highlight }) => {
  return (
    <div
      className={`flex gap-3 rounded-2xl border bg-white p-3 shadow-sm ${highlight ? 'border-amber-500 ring-2 ring-amber-300' : 'border-stone-200'}`}
      dir="rtl"
    >
      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xs font-bold text-stone-400">
          بدون صورة
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-black text-stone-900">{item.name}</div>
        {item.description && <p className="mt-1 line-clamp-2 text-xs text-stone-500">{item.description}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-sm font-black text-emerald-700">{Number(item.basePrice).toFixed(2)}</span>
          <button
            type="button"
            onClick={() => {
              if (!canOrder) {
                onNeedSession?.();
                return;
              }
              onAdd();
            }}
            className={`rounded-xl px-3 py-1.5 text-xs font-black ${
              canOrder ? 'bg-stone-900 text-white active:opacity-90' : 'border border-amber-400 bg-amber-50 text-amber-950'
            }`}
          >
            {canOrder ? '+ إضافة' : 'بانتظار فتح الجلسة'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestaurantPublicMenuItemCard;
