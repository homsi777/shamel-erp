import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, CalendarDays, Clock3, Eye, ImagePlus, MonitorPlay, Percent, Tag, Trash2, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';
import { apiRequest } from '../../lib/api';
import { buildPromotionsDisplayPayload, openPromotionsDisplayFallback, publishPromotionsDisplayState } from '../../lib/promotionsDisplay';
import type { InventoryItem, Promotion, PromotionDiscountType } from '../../types';

const DISCOUNT_LABELS: Record<PromotionDiscountType, string> = {
  percentage: 'خصم نسبة',
  amount: 'خصم مبلغ',
  special_price: 'سعر خاص',
  buy_quantity_discount: 'شراء كمية مع حسم',
};

const createOfferBarcode = () => {
  const digits = `${Date.now()}`.slice(-8);
  const random = `${Math.floor(Math.random() * 9000) + 1000}`;
  return `OFF-${digits}-${random}`;
};

const readImagesFromValue = (value: unknown) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  } catch {
    return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const emptyForm = {
  name: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date().toISOString().slice(0, 10),
  offerBarcode: createOfferBarcode(),
  description: '',
  discountType: 'percentage' as PromotionDiscountType,
  discountPercent: '0',
  discountValue: '0',
  specialPrice: '0',
  buyQuantity: '0',
  getDiscountPercent: '0',
  displayOrder: '1',
  displayDurationSeconds: '10',
  status: 'active' as 'active' | 'inactive',
  showOnDisplay: true,
  mainImageUrl: '',
};

const PromotionManagerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  items: InventoryItem[];
  promotions: Promotion[];
  onReload: () => Promise<void>;
}> = ({ open, onClose, items, promotions, onReload }) => {
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [extraImageUrls, setExtraImageUrls] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const mainImageInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    setEditingId(null);
    setSelectedItemIds([]);
    setExtraImageUrls([]);
    setSearch('');
  }, [open]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.name, item.code, item.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [items, search]);

  const openPromotionsDisplayWindow = async () => {
    let payload = buildPromotionsDisplayPayload(promotions, items);
    try {
      const rows = await apiRequest('promotions').catch(() => promotions);
      if (Array.isArray(rows)) {
        payload = buildPromotionsDisplayPayload(rows as Promotion[], items);
      }
    } catch {}
    publishPromotionsDisplayState(payload);
    try {
      if (window.electronAPI?.openPromotionsDisplay) {
        await window.electronAPI.openPromotionsDisplay();
        return;
      }
    } catch {}
    if (!openPromotionsDisplayFallback()) {
      alert('تعذر فتح شاشة العروض على هذا المتصفح.');
    }
  };

  const handleEdit = (promotion: Promotion) => {
    setEditingId(promotion.id);
    setSelectedItemIds(Array.isArray(promotion.itemIds) ? promotion.itemIds : []);
    setExtraImageUrls(readImagesFromValue(promotion.extraImageUrls));
    setForm({
      name: promotion.name || '',
      startDate: promotion.startDate || emptyForm.startDate,
      endDate: promotion.endDate || emptyForm.endDate,
      offerBarcode: promotion.offerBarcode || createOfferBarcode(),
      description: promotion.description || '',
      discountType: promotion.discountType || 'percentage',
      discountPercent: String(promotion.discountPercent ?? 0),
      discountValue: String(promotion.discountValue ?? 0),
      specialPrice: String(promotion.specialPrice ?? 0),
      buyQuantity: String(promotion.buyQuantity ?? 0),
      getDiscountPercent: String(promotion.getDiscountPercent ?? 0),
      displayOrder: String(promotion.displayOrder ?? 1),
      displayDurationSeconds: String(promotion.displayDurationSeconds ?? 10),
      status: promotion.status || 'active',
      showOnDisplay: promotion.showOnDisplay !== false,
      mainImageUrl: promotion.mainImageUrl || '',
    });
  };

  const handleMainImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const image = await fileToDataUrl(file);
    setForm((prev) => ({ ...prev, mainImageUrl: image }));
    event.target.value = '';
  };

  const handleGalleryUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const images = await Promise.all(files.map(fileToDataUrl));
    setExtraImageUrls((prev) => [...prev, ...images.filter(Boolean)]);
    event.target.value = '';
  };

  const validateBarcode = () => {
    const barcode = form.offerBarcode.trim();
    if (!barcode) {
      alert('باركود العرض مطلوب.');
      return false;
    }
    const promotionConflict = promotions.find((entry) =>
      entry.id !== editingId &&
      String(entry.offerBarcode || '').trim() === barcode,
    );
    if (promotionConflict) {
      alert('باركود العرض مستخدم في عرض آخر.');
      return false;
    }
    const itemConflict = items.find((item) => String(item.barcode || '').trim() === barcode);
    if (itemConflict) {
      alert('باركود العرض يتعارض مع باركود مادة موجودة.');
      return false;
    }
    return true;
  };

  const handleSave = async (openDisplayAfterSave = false) => {
    if (!form.name.trim()) {
      alert('اسم العرض مطلوب.');
      return;
    }
    if (!form.startDate || !form.endDate) {
      alert('تاريخ البداية والنهاية مطلوبان.');
      return;
    }
    if (selectedItemIds.length === 0) {
      alert('اختر مادة واحدة على الأقل ضمن العرض.');
      return;
    }
    if (!validateBarcode()) return;

    setIsSaving(true);
    try {
      const payload = {
        id: editingId || `promo-${Date.now()}`,
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        offerBarcode: form.offerBarcode.trim(),
        description: form.description.trim(),
        discountType: form.discountType,
        discountPercent: Number(form.discountPercent || 0),
        discountValue: Number(form.discountValue || 0),
        specialPrice: Number(form.specialPrice || 0),
        buyQuantity: Number(form.buyQuantity || 0),
        getDiscountPercent: Number(form.getDiscountPercent || 0),
        primaryItemId: selectedItemIds[0],
        itemIds: selectedItemIds,
        mainImageUrl: form.mainImageUrl || '',
        extraImageUrls,
        displayOrder: Number(form.displayOrder || 1),
        displayDurationSeconds: Math.max(5, Number(form.displayDurationSeconds || 10)),
        status: form.status,
        showOnDisplay: form.showOnDisplay,
      };

      await apiRequest(editingId ? `promotions/${editingId}` : 'promotions', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });

      await onReload();
      setForm({
        ...emptyForm,
        offerBarcode: createOfferBarcode(),
        displayOrder: String(promotions.length + 1),
      });
      setEditingId(null);
      setSelectedItemIds([]);
      setExtraImageUrls([]);

      if (openDisplayAfterSave) {
        window.setTimeout(() => {
          openPromotionsDisplayWindow();
        }, 250);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (promotionId: string) => {
    if (!window.confirm('سيتم حذف العرض المحدد. هل تريد المتابعة؟')) return;
    await apiRequest(`promotions/${promotionId}`, { method: 'DELETE' });
    await onReload();
    if (editingId === promotionId) {
      setEditingId(null);
      setForm({ ...emptyForm, offerBarcode: createOfferBarcode() });
      setSelectedItemIds([]);
      setExtraImageUrls([]);
    }
  };

  const selectedItemsPreview = useMemo(
    () => selectedItemIds.map((itemId) => items.find((item) => item.id === itemId)).filter(Boolean) as InventoryItem[],
    [items, selectedItemIds],
  );

  return (
    <AdaptiveModal open={open} onClose={onClose} size="xl" zIndex={240} panelClassName="flex h-full max-h-[92vh] flex-col">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Tag size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-900">العروض</h3>
              <p className="text-[11px] font-bold text-gray-500">إدارة العروض وتشغيل شاشة العروض المستقلة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openPromotionsDisplayWindow}
              className="rounded-xl border border-cyan-200 bg-white px-4 py-2 text-xs font-black text-cyan-700 hover:bg-cyan-50"
            >
              <span className="flex items-center gap-2"><MonitorPlay size={15} /> تشغيل شاشة العروض</span>
            </button>
            <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
              <XCircle size={18} />
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 xl:grid-cols-[470px_minmax(0,1fr)]">
          <div className="space-y-4 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-black text-gray-800">
                {editingId ? 'تعديل العرض' : 'إنشاء عرض جديد'}
              </div>

              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="اسم العرض"
                className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
              />

              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">باركود العرض</label>
                  <input
                    value={form.offerBarcode}
                    onChange={(e) => setForm((prev) => ({ ...prev, offerBarcode: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-mono font-black outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, offerBarcode: createOfferBarcode() }))}
                  className="mt-6 rounded-xl border border-gray-200 px-4 py-3 text-xs font-black text-gray-700 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2"><Barcode size={15} /> توليد</span>
                </button>
              </div>

              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="وصف دعائي مختصر يظهر على شاشة العروض"
                rows={3}
                className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">تاريخ البداية</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">تاريخ النهاية</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">ترتيب الظهور</label>
                  <input
                    type="number"
                    min="1"
                    value={form.displayOrder}
                    onChange={(e) => setForm((prev) => ({ ...prev, displayOrder: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-black outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">مدة الظهور بالثواني</label>
                  <input
                    type="number"
                    min="5"
                    value={form.displayDurationSeconds}
                    onChange={(e) => setForm((prev) => ({ ...prev, displayDurationSeconds: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-black outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">نوع الخصم</label>
                <select
                  value={form.discountType}
                  onChange={(e) => setForm((prev) => ({ ...prev, discountType: e.target.value as PromotionDiscountType }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                >
                  {Object.entries(DISCOUNT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {(form.discountType === 'percentage' || form.discountType === 'buy_quantity_discount') && (
                <div className="grid grid-cols-2 gap-3">
                  {form.discountType === 'buy_quantity_discount' && (
                    <div>
                      <label className="mb-1 block text-xs font-black text-gray-500">الكمية</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={form.buyQuantity}
                        onChange={(e) => setForm((prev) => ({ ...prev, buyQuantity: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                      />
                    </div>
                  )}
                  <div className={form.discountType === 'buy_quantity_discount' ? '' : 'col-span-2'}>
                    <label className="mb-1 block text-xs font-black text-gray-500">
                      {form.discountType === 'buy_quantity_discount' ? 'نسبة الخصم' : 'نسبة الخصم %'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.discountType === 'buy_quantity_discount' ? form.getDiscountPercent : form.discountPercent}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          [form.discountType === 'buy_quantity_discount' ? 'getDiscountPercent' : 'discountPercent']: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                    />
                  </div>
                </div>
              )}

              {form.discountType === 'amount' && (
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">قيمة الخصم</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discountValue}
                    onChange={(e) => setForm((prev) => ({ ...prev, discountValue: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                  />
                </div>
              )}

              {form.discountType === 'special_price' && (
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">السعر الخاص</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.specialPrice}
                    onChange={(e) => setForm((prev) => ({ ...prev, specialPrice: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">الحالة</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as 'active' | 'inactive' }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                  </select>
                </div>
                <label className="mt-6 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm font-black text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.showOnDisplay}
                    onChange={(e) => setForm((prev) => ({ ...prev, showOnDisplay: e.target.checked }))}
                  />
                  إظهار على شاشة العروض
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => mainImageInputRef.current?.click()}
                  className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-xs font-black text-gray-700 hover:bg-gray-50"
                >
                  <span className="flex items-center justify-center gap-2"><ImagePlus size={15} /> صورة رئيسية</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-xs font-black text-gray-700 hover:bg-gray-50"
                >
                  <span className="flex items-center justify-center gap-2"><ImagePlus size={15} /> صور إضافية</span>
                </button>
                <input ref={mainImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleMainImageUpload} />
                <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {form.mainImageUrl ? (
                  <div className="relative col-span-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                    <img src={form.mainImageUrl} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, mainImageUrl: '' }))}
                      className="absolute left-2 top-2 rounded-full bg-red-500 p-1 text-white"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="col-span-2 flex h-24 items-center justify-center rounded-xl border border-dashed border-gray-200 text-gray-300">
                    <ImagePlus size={24} />
                  </div>
                )}
                {extraImageUrls.slice(0, 2).map((image, index) => (
                  <div key={`${image}-${index}`} className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                    <img src={image} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setExtraImageUrls((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      className="absolute left-2 top-2 rounded-full bg-red-500 p-1 text-white"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => handleSave()} disabled={isSaving} className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                {editingId ? 'حفظ التعديلات' : 'إضافة العرض'}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSave(true);
                }}
                disabled={isSaving}
                className="w-full rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-black text-cyan-700 disabled:opacity-50"
              >
                <span className="flex items-center justify-center gap-2"><MonitorPlay size={15} /> حفظ وفتح شاشة العروض</span>
              </button>
            </div>

            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                <CalendarDays size={16} />
                العروض الحالية
              </div>
              <div className="space-y-2">
                {promotions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs font-bold text-gray-400">
                    لا توجد عروض مسجلة.
                  </div>
                )}
                {promotions
                  .slice()
                  .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0))
                  .map((promotion) => (
                    <div key={promotion.id} className="rounded-xl border border-gray-100 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-gray-800">{promotion.name}</div>
                          <div className="text-[11px] font-bold text-gray-400">
                            {promotion.startDate} - {promotion.endDate}
                          </div>
                          <div className="mt-1 text-[11px] font-black text-cyan-700">
                            ترتيب {promotion.displayOrder || 0} • {promotion.displayDurationSeconds || 10} ث
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => handleEdit(promotion)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50">
                            تعديل
                          </button>
                          <button type="button" onClick={() => handleDelete(promotion.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50">
                            حذف
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{DISCOUNT_LABELS[promotion.discountType]}</span>
                        {promotion.showOnDisplay !== false && <span className="rounded-full bg-cyan-50 px-2 py-1 text-cyan-700">يعرض على الشاشة</span>}
                        {promotion.offerBarcode && <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600">{promotion.offerBarcode}</span>}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2 text-sm font-black text-gray-800">
              <div className="flex items-center gap-2">
                <Percent size={16} />
                المواد المشمولة
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Eye size={14} />
                {selectedItemsPreview.length} مادة
              </div>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الكود أو الباركود"
              className="mb-3 w-full rounded-xl border border-gray-200 px-3 py-3 font-bold outline-none"
            />

            {selectedItemsPreview.length > 0 && (
              <div className="mb-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-black text-cyan-700">
                  <Clock3 size={14} />
                  معاينة سريعة للعناصر المختارة
                </div>
                <div className="space-y-2">
                  {selectedItemsPreview.slice(0, 3).map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                      <div className="h-12 w-12 overflow-hidden rounded-xl bg-gray-100">
                        {item.imageUrl ? <img src={item.imageUrl} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-black text-gray-800">{item.name}</div>
                        <div className="text-[11px] font-bold text-gray-400">{item.code}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {filteredItems.map((item) => {
                const checked = selectedItemIds.includes(item.id);
                return (
                  <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 px-3 py-3 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedItemIds((prev) =>
                          checked ? prev.filter((value) => value !== item.id) : [...prev, item.id],
                        )
                      }
                    />
                    <div className="h-14 w-14 overflow-hidden rounded-xl bg-gray-100">
                      {item.imageUrl ? <img src={item.imageUrl} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-gray-800">{item.name}</div>
                      <div className="text-[11px] font-bold text-gray-400">
                        {item.code} {item.barcode ? `| ${item.barcode}` : ''}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default PromotionManagerModal;
