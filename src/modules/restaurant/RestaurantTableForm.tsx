import React, { useEffect, useState } from 'react';
import type { RestaurantTable } from './restaurant.types';
import { createTable, updateTable } from './restaurant.api';

export interface RestaurantTableFormProps {
  mode: 'create' | 'edit';
  initial?: RestaurantTable | null;
  onSaved: () => void;
  onCancel: () => void;
}

const RestaurantTableForm: React.FC<RestaurantTableFormProps> = ({ mode, initial, onSaved, onCancel }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [capacity, setCapacity] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('0');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'edit' && initial) {
      setCode(initial.code || '');
      setName(initial.name || '');
      setZoneName(initial.zoneName || '');
      setCapacity(initial.capacity != null ? String(initial.capacity) : '');
      setSortOrder(String(initial.sortOrder ?? 0));
      setNotes(initial.notes || '');
      setIsActive(initial.isActive !== false);
    } else {
      setCode('');
      setName('');
      setZoneName('');
      setCapacity('');
      setSortOrder('0');
      setNotes('');
      setIsActive(true);
    }
  }, [mode, initial]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      if (mode === 'create') {
        await createTable({
          code: code.trim(),
          name: name.trim(),
          zoneName: zoneName.trim() || null,
          capacity: capacity.trim() === '' ? null : Math.max(0, parseInt(capacity, 10) || 0),
          sortOrder: parseInt(sortOrder, 10) || 0,
          notes: notes.trim() || null,
        });
      } else if (initial?.id) {
        await updateTable(initial.id, {
          name: name.trim(),
          zoneName: zoneName.trim() || null,
          capacity: capacity.trim() === '' ? null : Math.max(0, parseInt(capacity, 10) || 0),
          sortOrder: parseInt(sortOrder, 10) || 0,
          notes: notes.trim() || null,
          isActive,
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" dir="rtl">
      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{err}</div>}
      {mode === 'create' && (
        <div>
          <label className="block text-xs font-bold text-gray-500">رمز الطاولة</label>
          <input
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
      )}
      <div>
        <label className="block text-xs font-bold text-gray-500">الاسم</label>
        <input
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500">المنطقة (اختياري)</label>
        <input
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          value={zoneName}
          onChange={(e) => setZoneName(e.target.value)}
          placeholder="صالة / VIP / خارجي"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-gray-500">السعة</label>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500">ترتيب العرض</label>
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500">ملاحظات</label>
        <textarea
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {mode === 'edit' && (
        <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          طاولة نشطة
        </label>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700">
          إلغاء
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-black text-white disabled:opacity-60"
        >
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
};

export default RestaurantTableForm;
