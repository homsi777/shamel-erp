import React from 'react';
import { Search } from 'lucide-react';
import type { MenuItemStatusFilter } from './types';

type QrMenuToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  categories: string[];
  status: MenuItemStatusFilter;
  onStatusChange: (value: MenuItemStatusFilter) => void;
};

const QrMenuToolbar: React.FC<QrMenuToolbarProps> = ({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  categories,
  status,
  onStatusChange,
}) => {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ابحث عن أصناف المنيو"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-9 pl-3 text-sm font-semibold text-slate-900"
          />
        </div>

        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
        >
          <option value="all">كل الفئات</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as MenuItemStatusFilter)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
        >
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="hidden">مخفي</option>
        </select>
      </div>
    </section>
  );
};

export default QrMenuToolbar;
