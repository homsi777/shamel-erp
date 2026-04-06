import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api';
import type { AppUser, InventoryItem } from '../../../types';
import { PERMISSIONS } from '../../../types';
import {
  getRestaurantMenuItems,
  upsertRestaurantMenuItem,
  type RestaurantMenuItemRow,
} from '../restaurant.api';
import AddQrMenuItemDialog from './AddQrMenuItemDialog';
import QrMenuGrid from './QrMenuGrid';
import QrMenuHeader from './QrMenuHeader';
import QrMenuToolbar from './QrMenuToolbar';
import type { MenuDisplayItem, MenuItemStatusFilter } from './types';

const PAGE_SIZE = 24;

const can = (user: AppUser | undefined, perm: string) =>
  !user ? false : user.role === 'admin' || user.permissions?.includes(perm);

type EditDraft = {
  itemId: string;
  displayNameOverride: string;
  categoryName: string;
  description: string;
  imageUrl: string;
  sortOrder: string;
  isAvailableNow: boolean;
};

const QrMenuPage: React.FC<{ currentUser?: AppUser }> = ({ currentUser }) => {
  const canView = can(currentUser, PERMISSIONS.VIEW_RESTAURANT_MODULE);
  const canManageTables = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_TABLES);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuRows, setMenuRows] = useState<(RestaurantMenuItemRow & { item: Record<string, unknown> | null })[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<MenuItemStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [menuRes, inv] = await Promise.all([
        getRestaurantMenuItems().catch(() => ({ menuItems: [] as (RestaurantMenuItemRow & { item: Record<string, unknown> | null })[] })),
        apiRequest('inventory') as Promise<InventoryItem[]>,
      ]);
      setMenuRows(menuRes.menuItems || []);
      setInventory(Array.isArray(inv) ? inv : []);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل منيو QR.');
      setMenuRows([]);
      setInventory([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const inventoryById = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    for (const it of inventory) m.set(String(it.id), it);
    return m;
  }, [inventory]);

  const displayItems = useMemo<MenuDisplayItem[]>(() => {
    return menuRows
      .map<MenuDisplayItem>((row) => {
        const inv = inventoryById.get(String(row.itemId)) || null;
        const fallbackItem = row.item || null;
        const invName =
          (inv?.name && String(inv.name).trim()) ||
          (fallbackItem && typeof fallbackItem.name === 'string' ? String(fallbackItem.name).trim() : '') ||
          'صنف بدون اسم';
        const name = String(row.displayNameOverride || '').trim() || invName;
        const categoryName =
          String(row.categoryName || '').trim() ||
          String(inv?.groupName || '').trim() ||
          'عام';
        const price = Number(inv?.posPrice ?? inv?.salePrice ?? 0) || 0;
        const imageUrl =
          String(row.imageUrl || '').trim() ||
          String(inv?.imageUrl || '').trim() ||
          null;
        return {
          row,
          inventoryItem: inv,
          itemId: String(row.itemId),
          name,
          category: categoryName,
          price,
          imageUrl,
          status: (row.isVisibleInQr ? 'active' : 'hidden') as 'active' | 'hidden',
          isAvailableNow: Boolean(row.isAvailableNow),
          description: row.description,
        };
      })
      .sort((a, b) => {
        const diff = Number(a.row.sortOrder || 0) - Number(b.row.sortOrder || 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'en');
      });
  }, [menuRows, inventoryById]);

  const categories = useMemo(() => {
    return Array.from(new Set(displayItems.map((item) => item.category))).sort((a, b) => a.localeCompare(b, 'en'));
  }, [displayItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayItems.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (status !== 'all' && item.status !== status) return false;
      if (q) {
        const target = `${item.name} ${item.category}`.toLowerCase();
        if (!target.includes(q)) return false;
      }
      return true;
    });
  }, [displayItems, search, category, status]);

  useEffect(() => {
    setPage(1);
  }, [search, category, status]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const menuItemIds = useMemo(() => new Set(menuRows.map((row) => String(row.itemId))), [menuRows]);
  const addableItems = useMemo(
    () => inventory.filter((it) => it && it.id && !it.inactive && !menuItemIds.has(String(it.id))),
    [inventory, menuItemIds],
  );

  const patchLocalRow = useCallback((itemId: string, patch: Partial<RestaurantMenuItemRow>) => {
    setMenuRows((prev) =>
      prev.map((row) => (String(row.itemId) === String(itemId) ? { ...row, ...patch } : row)),
    );
  }, []);

  const handleToggleVisibility = useCallback(
    async (item: MenuDisplayItem) => {
      if (!canManageTables) return;
      setBusyItemId(item.itemId);
      setError(null);
      try {
        await upsertRestaurantMenuItem({
          itemId: item.itemId,
          isVisibleInQr: item.status !== 'active',
        });
        patchLocalRow(item.itemId, { isVisibleInQr: item.status !== 'active' });
      } catch (e: any) {
        setError(e?.message || 'تعذر تحديث حالة ظهور الصنف.');
      } finally {
        setBusyItemId(null);
      }
    },
    [canManageTables, patchLocalRow],
  );

  const handleRemove = useCallback(
    async (item: MenuDisplayItem) => {
      if (!canManageTables) return;
      if (!window.confirm(`هل تريد إزالة "${item.name}" من منيو QR؟`)) return;
      setBusyItemId(item.itemId);
      setError(null);
      try {
        await upsertRestaurantMenuItem({
          itemId: item.itemId,
          isVisibleInQr: false,
          isAvailableNow: false,
        });
        patchLocalRow(item.itemId, { isVisibleInQr: false, isAvailableNow: false });
      } catch (e: any) {
        setError(e?.message || 'تعذر إزالة الصنف من منيو QR.');
      } finally {
        setBusyItemId(null);
      }
    },
    [canManageTables, patchLocalRow],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editDraft || !canManageTables) return;
    setBusyItemId(editDraft.itemId);
    setError(null);
    try {
      await upsertRestaurantMenuItem({
        itemId: editDraft.itemId,
        displayNameOverride: editDraft.displayNameOverride.trim() || null,
        categoryName: editDraft.categoryName.trim() || null,
        description: editDraft.description.trim() || null,
        imageUrl: editDraft.imageUrl.trim() || null,
        sortOrder: parseInt(editDraft.sortOrder, 10) || 0,
        isAvailableNow: editDraft.isAvailableNow,
      });
      patchLocalRow(editDraft.itemId, {
        displayNameOverride: editDraft.displayNameOverride.trim() || null,
        categoryName: editDraft.categoryName.trim() || null,
        description: editDraft.description.trim() || null,
        imageUrl: editDraft.imageUrl.trim() || null,
        sortOrder: parseInt(editDraft.sortOrder, 10) || 0,
        isAvailableNow: editDraft.isAvailableNow,
      });
      setEditDraft(null);
    } catch (e: any) {
      setError(e?.message || 'تعذر حفظ بيانات الصنف.');
    } finally {
      setBusyItemId(null);
    }
  }, [canManageTables, editDraft, patchLocalRow]);

  const handleAddItems = useCallback(
    async (itemIds: string[]) => {
      if (!canManageTables || itemIds.length === 0) return;
      setSaving(true);
      setError(null);
      try {
        const createdRows = await Promise.all(
          itemIds.map(async (itemId, idx) => {
            const inv = inventoryById.get(String(itemId));
            const res = await upsertRestaurantMenuItem({
              itemId: String(itemId),
              isVisibleInQr: true,
              isAvailableNow: true,
              categoryName: String(inv?.groupName || '').trim() || 'عام',
              sortOrder: menuRows.length + idx,
            });
            return {
              ...res.menuItem,
              item: inv ? (inv as unknown as Record<string, unknown>) : null,
            };
          }),
        );
        setMenuRows((prev) => {
          const byItemId = new Map(prev.map((row) => [String(row.itemId), row]));
          for (const row of createdRows) byItemId.set(String(row.itemId), row);
          return Array.from(byItemId.values());
        });
        setAddOpen(false);
      } catch (e: any) {
        setError(e?.message || 'تعذر إضافة الأصناف إلى منيو QR.');
      } finally {
        setSaving(false);
      }
    },
    [canManageTables, inventoryById, menuRows.length],
  );

  if (!canView) {
    return (
      <div className="min-h-full bg-gray-50 p-6 text-center text-sm font-bold text-gray-600" dir="rtl">
        لا تملك صلاحية عرض شاشة منيو QR.
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6" dir="rtl">
      <div className="mx-auto max-w-[1480px] space-y-4">
        <QrMenuHeader onAdd={() => setAddOpen(true)} disableAdd={!canManageTables} />
        <QrMenuToolbar
          search={search}
          onSearchChange={setSearch}
          category={category}
          onCategoryChange={setCategory}
          categories={categories}
          status={status}
          onStatusChange={setStatus}
        />

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div>
        ) : null}

        <QrMenuGrid
          loading={loading}
          items={pagedItems}
          busyItemId={busyItemId}
          onEdit={(item) =>
            setEditDraft({
              itemId: item.itemId,
              displayNameOverride: String(item.row.displayNameOverride || ''),
              categoryName: String(item.row.categoryName || item.category || ''),
              description: String(item.row.description || ''),
              imageUrl: String(item.row.imageUrl || item.imageUrl || ''),
              sortOrder: String(item.row.sortOrder || 0),
              isAvailableNow: Boolean(item.row.isAvailableNow),
            })
          }
          onRemove={handleRemove}
          onToggleVisibility={handleToggleVisibility}
          onAdd={() => setAddOpen(true)}
        />

        {filteredItems.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
            <span>
              عرض {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredItems.length)} من أصل {filteredItems.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-50"
              >
                السابق
              </button>
              <span className="text-xs font-black text-slate-500">
                صفحة {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-50"
              >
                التالي
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <AddQrMenuItemDialog
        open={addOpen}
        candidates={addableItems}
        busy={saving}
        onClose={() => setAddOpen(false)}
        onConfirm={handleAddItems}
      />

      {editDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900">تعديل صنف المنيو</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">تحديث بيانات العرض الخاصة بهذا الصنف في منيو QR</p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">
                اسم العرض
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  value={editDraft.displayNameOverride}
                  onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, displayNameOverride: e.target.value } : prev))}
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                الفئة
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  value={editDraft.categoryName}
                  onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, categoryName: e.target.value } : prev))}
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                رابط الصورة
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  value={editDraft.imageUrl}
                  onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, imageUrl: e.target.value } : prev))}
                />
              </label>
              <label className="text-xs font-bold text-slate-600">
                ترتيب الظهور
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  value={editDraft.sortOrder}
                  onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, sortOrder: e.target.value } : prev))}
                />
              </label>
              <label className="col-span-full text-xs font-bold text-slate-600">
                الوصف
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  value={editDraft.description}
                  onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                />
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={editDraft.isAvailableNow}
                onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, isAvailableNow: e.target.checked } : prev))}
                className="h-4 w-4 rounded border-slate-300"
              />
              متاح الآن
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditDraft(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={busyItemId === editDraft.itemId}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QrMenuPage;
