import React, { useEffect, useMemo, useState } from 'react';
import { FolderTree, Plus, RefreshCw, Tags, Trash2, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';
import { apiRequest } from '../../lib/api';
import { confirmDialog } from '../../lib/confirm';
import type { InventoryItem, ItemGroup, ItemGroupItem } from '../../types';

const ItemGroupsManager: React.FC<{
  open: boolean;
  onClose: () => void;
  items: InventoryItem[];
  groups: ItemGroup[];
  assignments: ItemGroupItem[];
  selectedItemIds: string[];
  currentUserId: string;
  onReload: () => Promise<void>;
}> = ({ open, onClose, items, groups, assignments, selectedItemIds, currentUserId, onReload }) => {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [assignmentItemIds, setAssignmentItemIds] = useState<string[]>(selectedItemIds);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAssignmentItemIds(selectedItemIds);
  }, [open, selectedItemIds]);

  const selectedItems = useMemo(
    () => items.filter((item) => assignmentItemIds.includes(String(item.id))),
    [assignmentItemIds, items],
  );

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of assignments) {
      counts.set(String(row.groupId), (counts.get(String(row.groupId)) || 0) + 1);
    }
    return counts;
  }, [assignments]);

  const resetForm = () => {
    setEditingGroupId(null);
    setName('');
    setNotes('');
  };

  const handleSaveGroup = async () => {
    if (!name.trim()) {
      alert('اسم المجموعة مطلوب.');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        action: editingGroupId ? 'update' : 'create',
        groupId: editingGroupId || `igroup-${Date.now()}`,
        name: name.trim(),
        notes: notes.trim(),
        userId: currentUserId,
      };
      await apiRequest('item-groups/manage', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await onReload();
      resetForm();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGroup = async (group: ItemGroup) => {
    const confirmed = await confirmDialog(`سيتم حذف المجموعة "${group.name}" وإلغاء ربط موادها. هل تريد المتابعة؟`);
    if (!confirmed) return;
    setIsSaving(true);
    try {
      await apiRequest('item-groups/manage', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete',
          groupId: group.id,
          userId: currentUserId,
        }),
      });
      if (selectedGroupId === group.id) setSelectedGroupId('');
      await onReload();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssign = async (groupId: string | null) => {
    if (assignmentItemIds.length === 0) {
      alert('حدد مادة واحدة على الأقل قبل الربط.');
      return;
    }
    const targetGroup = groups.find((group) => String(group.id) === String(groupId || ''));
    const confirmed = await confirmDialog(
      groupId
        ? `سيتم ربط ${assignmentItemIds.length} مادة بالمجموعة "${targetGroup?.name || ''}". هل تريد المتابعة؟`
        : `سيتم فك ارتباط ${assignmentItemIds.length} مادة من أي مجموعة. هل تريد المتابعة؟`,
    );
    if (!confirmed) return;

    setIsSaving(true);
    try {
      await apiRequest('item-groups/manage', {
        method: 'POST',
        body: JSON.stringify({
          action: groupId ? 'assign' : 'unassign',
          groupId: groupId || selectedGroupId || null,
          itemIds: assignmentItemIds,
          userId: currentUserId,
        }),
      });
      await onReload();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdaptiveModal open={open} onClose={onClose} size="xl" zIndex={220} panelClassName="flex h-full max-h-[92vh] flex-col">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
              <FolderTree size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-900">مجموعات المواد</h3>
              <p className="text-[11px] font-bold text-gray-400">إدارة المجموعات اليدوية وربط المواد</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
            <XCircle size={18} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-3 text-sm font-black text-gray-800">
                {editingGroupId ? 'تعديل المجموعة' : 'إنشاء مجموعة جديدة'}
              </div>
              <div className="space-y-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="اسم المجموعة"
                  className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                />
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات المجموعة"
                  className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveGroup}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                  >
                    {isSaving ? <RefreshCw className="animate-spin" size={16} /> : <Plus size={16} />}
                    {editingGroupId ? 'حفظ التعديل' : 'إضافة مجموعة'}
                  </button>
                  {editingGroupId && (
                    <button type="button" onClick={resetForm} className="rounded-xl px-4 py-3 text-sm font-bold text-gray-500 hover:bg-white">
                      إلغاء
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="mb-2 text-sm font-black text-gray-800">المجموعات الحالية</div>
              <div className="space-y-2">
                {groups.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs font-bold text-gray-400">
                    لا توجد مجموعات مواد حتى الآن.
                  </div>
                )}
                {groups.map((group) => (
                  <div key={group.id} className="rounded-xl border border-gray-100 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-black text-gray-800">{group.name}</div>
                        <div className="text-[11px] font-bold text-gray-400">
                          {groupCounts.get(String(group.id)) || 0} مادة
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroupId(group.id);
                            setName(group.name || '');
                            setNotes(group.notes || '');
                          }}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(group)}
                          className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {group.notes && <div className="mt-2 text-xs font-bold text-gray-500">{group.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <Tags size={16} />
                ربط المواد بالمجموعة
              </div>
              <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                >
                  <option value="">اختر المجموعة</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleAssign(selectedGroupId || null)}
                  disabled={isSaving || !selectedGroupId}
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  ربط المحدد
                </button>
                <button
                  type="button"
                  onClick={() => handleAssign(null)}
                  disabled={isSaving || assignmentItemIds.length === 0}
                  className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-600 disabled:opacity-50"
                >
                  فك الارتباط
                </button>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 text-xs font-black text-gray-500">المواد المحددة للربط</div>
                <div className="max-h-72 space-y-2 overflow-auto">
                  {items.map((item) => {
                    const checked = assignmentItemIds.includes(String(item.id));
                    return (
                      <label key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm font-bold text-gray-700">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAssignmentItemIds((prev) => (
                              checked ? prev.filter((id) => id !== String(item.id)) : [...prev, String(item.id)]
                            ))}
                          />
                          <span>{item.name}</span>
                        </div>
                        <span className="text-[11px] text-gray-400">{item.groupName || 'بدون مجموعة'}</span>
                      </label>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-4 text-xs font-bold text-gray-400">
                      لا توجد مواد متاحة للربط.
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 text-xs font-bold text-gray-500">
                المواد المختارة الآن: {selectedItems.length}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default ItemGroupsManager;
