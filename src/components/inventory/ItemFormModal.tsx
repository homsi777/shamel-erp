import React, { useEffect, useRef, useState } from 'react';
import { Box, Check, DollarSign, Info, RefreshCw, ScanBarcode, Trash2, Upload, Image as ImageIcon, XCircle, ChevronDown, Plus } from 'lucide-react';

interface ItemFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  editingItem: any;
  isSaving: boolean;
  itemModalTab: 'basic' | 'pricing' | 'serials' | 'details';
  setItemModalTab: React.Dispatch<React.SetStateAction<'basic' | 'pricing' | 'serials' | 'details'>>;
  itemForm: any;
  setItemForm: React.Dispatch<React.SetStateAction<any>>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  categories: any[];
  availableSubCategories: any[];
  baseUnits: any[];
  warehouses: any[];
  itemBarcodeInputs: string[];
  setItemBarcodeInputs: React.Dispatch<React.SetStateAction<string[]>>;
  applyScaleLabelPreset: () => void;
  scaleDecimalsHint: string;
  scaleBarcodePreview: { valueSegment: string; displayValue: string; fullBarcode: string; groupedBarcode: string };
  scaleLabelPreset: { prefix: string };
  textileModeEnabled?: boolean;
}

const inp = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const sel = inp + " cursor-pointer";

const F: React.FC<{ label: string; required?: boolean; children: React.ReactNode; className?: string }> = ({ label, required, children, className }) => (
  <div className={className}>
    <label className="block text-[11px] font-bold text-gray-500 mb-1">
      {label}{required && <span className="text-red-400 mr-0.5">*</span>}
    </label>
    {children}
  </div>
);

const ItemFormModal: React.FC<ItemFormModalProps> = ({
  open, onClose, onSubmit, editingItem, isSaving,
  itemForm, setItemForm, fileInputRef, handleImageUpload,
  categories, availableSubCategories, baseUnits, warehouses,
  itemBarcodeInputs, setItemBarcodeInputs,
  applyScaleLabelPreset, scaleDecimalsHint, scaleBarcodePreview, scaleLabelPreset,
  textileModeEnabled = false,
}) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.preventDefault();
    const all = Array.from(
      formRef.current?.querySelectorAll('input:not([disabled]):not([type="file"]), select:not([disabled])') ?? []
    ) as HTMLElement[];
    const idx = all.indexOf(document.activeElement as HTMLElement);
    if (idx >= 0 && idx < all.length - 1) all[idx + 1].focus();
  };

  if (!open) return null;

  return (
    <div className="flex flex-col min-h-full bg-gray-50">

      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 z-20 flex items-center gap-3 px-5 py-3 bg-primary text-white shadow-md shrink-0">
        <Box size={18} />
        <h2 className="text-sm font-black flex-1">
          {editingItem ? 'تعديل بيانات المادة' : 'إضافة مادة جديدة للمخزون'}
        </h2>
        <span className="text-xs text-white/60 hidden md:block">
          <kbd className="bg-white/20 rounded px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> للانتقال ·
          <kbd className="bg-white/20 rounded px-1.5 py-0.5 font-mono text-[10px] mr-1">Esc</kbd> للإغلاق
        </span>
        <button type="button" onClick={onClose}
          className="p-1.5 rounded-full hover:bg-white/10 transition">
          <XCircle size={18} />
        </button>
      </div>

      {/* ── Form body ── */}
      <form ref={formRef} onSubmit={onSubmit} onKeyDown={handleEnter} className="flex-1">
        <div className="max-w-6xl mx-auto px-5 py-5">

          {/* ════ Main 2-col grid ════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* ── Left: Identity ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
                <div className="w-1 h-4 rounded-full bg-primary shrink-0" />
                <span className="text-xs font-black text-gray-600 flex items-center gap-1">
                  <Box size={12} className="text-primary"/> البيانات الأساسية
                </span>
              </div>

              {/* Name – full width */}
              <F label="اسم المادة" required>
                <input autoFocus required type="text" value={itemForm.name}
                  onChange={e => setItemForm({ ...itemForm, name: e.target.value })}
                  className={inp + " text-base"} placeholder="اسم المادة..." />
              </F>

              {/* Code + Barcode */}
              <div className="grid grid-cols-2 gap-3">
                <F label="الكود الداخلي" required>
                  <input required type="text" value={itemForm.code}
                    onChange={e => setItemForm({ ...itemForm, code: e.target.value })}
                    className={inp + " font-mono"} placeholder="CODE-001" />
                </F>
                <F label="الباركود الرئيسي">
                  <input type="text" value={itemForm.barcode}
                    onChange={e => setItemForm({ ...itemForm, barcode: e.target.value })}
                    className={inp + " font-mono"} placeholder="7210..." />
                </F>
              </div>

              {/* Unit + Warehouse */}
              <div className="grid grid-cols-2 gap-3">
                <F label="وحدة القياس" required>
                  <select required value={itemForm.unitId}
                    onChange={e => setItemForm({ ...itemForm, unitId: e.target.value })}
                    className={sel}>
                    <option value="">-- الوحدة --</option>
                    {baseUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </F>
                <F label="المستودع" required>
                  <select required value={itemForm.warehouseId}
                    onChange={e => setItemForm({ ...itemForm, warehouseId: e.target.value })}
                    className={sel}>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </F>
              </div>

              {/* Category + SubCategory */}
              <div className="grid grid-cols-2 gap-3">
                <F label="الفئة الرئيسية" required>
                  <select required value={itemForm.categoryId}
                    onChange={e => setItemForm({ ...itemForm, categoryId: e.target.value, subCategoryId: '' })}
                    className={sel}>
                    <option value="">-- الفئة --</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </F>
                <F label="الفئة الفرعية">
                  <select value={itemForm.subCategoryId}
                    onChange={e => setItemForm({ ...itemForm, subCategoryId: e.target.value })}
                    disabled={!itemForm.categoryId}
                    className={sel + (!itemForm.categoryId ? ' opacity-40 cursor-not-allowed' : '')}>
                    <option value="">-- فرعية --</option>
                    {availableSubCategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </F>
              </div>

              {/* Serial tracking + Item type */}
              <div className="grid grid-cols-2 gap-3">
                <F label="تتبع السيريال">
                  <select value={itemForm.serialTracking}
                    onChange={e => setItemForm({ ...itemForm, serialTracking: e.target.value })}
                    className={sel}>
                    <option value="none">بدون سيريال</option>
                    <option value="optional">اختياري</option>
                    <option value="required">إجباري</option>
                  </select>
                </F>
                <F label="نوع المادة">
                  <select value={itemForm.itemType || 'STOCK'}
                    onChange={e => setItemForm({ ...itemForm, itemType: e.target.value })}
                    className={sel}>
                    <option value="STOCK">مادة مخزنية</option>
                    <option value="SERVICE">خدمية (لا تدخل المستودع)</option>
                    <option value="NON_STOCK">غير مخزنية</option>
                  </select>
                </F>
              </div>
              {textileModeEnabled && (
              <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 space-y-3">
                <label className="flex items-center gap-2 text-xs font-black text-amber-900">
                  <input
                    type="checkbox"
                    checked={Boolean(itemForm.isTextile)}
                    onChange={e => setItemForm({ ...itemForm, isTextile: e.target.checked, supportsColorDimension: e.target.checked })}
                  />
                  خصائص الأقمشة
                </label>
                {itemForm.isTextile && (
                  <div className="grid grid-cols-2 gap-3">
                    <F label="الوحدة الأساسية" required>
                      <select
                        value={itemForm.textileBaseUom || 'meter'}
                        onChange={e => setItemForm({ ...itemForm, textileBaseUom: e.target.value, supportsColorDimension: true })}
                        className={sel}
                      >
                        <option value="meter">meter</option>
                        <option value="yard">yard</option>
                      </select>
                    </F>
                    <F label="دعم اللون">
                      <input value="مفعّل" disabled className={inp + " opacity-70"} />
                    </F>
                  </div>
                )}
              </div>
              )}
              {textileModeEnabled && itemForm.isTextile && (
                <div className="rounded-xl border border-amber-200 bg-white p-3 space-y-2">
                  <div className="text-xs font-black text-amber-800">ألوان القماش</div>
                  <input
                    type="text"
                    value={itemForm.color || ''}
                    onChange={e => setItemForm({ ...itemForm, color: e.target.value, supportsColorDimension: true })}
                    className={inp}
                    placeholder="مثال: أحمر، أزرق، أسود"
                  />
                  <div className="text-[11px] font-bold text-amber-700">
                    هذا الحقل ظاهر ومخصص للأقمشة داخل نفس شاشة المادة.
                  </div>
                </div>
              )}
              {(itemForm.itemType === 'SERVICE' || itemForm.itemType === 'NON_STOCK') && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] font-bold text-amber-700">
                  هذه المادة خدمية ومخصصة للبيع المباشر ولا تدخل إلى المستودع ولا تؤثر على رصيد المخزون
                </div>
              )}

              {/* Barcodes */}
              <div>
                <div className="flex items-center gap-2 py-1 mb-2 border-t border-gray-100">
                  <div className="w-1 h-3 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-xs font-black text-gray-500 flex items-center gap-1">
                    باركودات إضافية
                  </span>
                </div>
                <div className="space-y-2">
                  {itemBarcodeInputs.map((bc, i) => (
                    <div key={`bc-${i}`} className="flex items-center gap-2">
                      <input type="text" value={bc}
                        onChange={e => setItemBarcodeInputs(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                        className={inp + " font-mono flex-1 text-xs"}
                        placeholder={i === 0 ? 'الباركود الرئيسي' : `باركود إضافي ${i + 1}`} />
                      <button type="button"
                        onClick={() => setItemBarcodeInputs(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [''])}
                        className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg border border-red-100 transition">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setItemBarcodeInputs(prev => [...prev, ''])}
                    className="flex items-center gap-1 text-xs font-bold text-amber-600 hover:text-amber-800 transition">
                    <Plus size={12}/> إضافة باركود آخر
                  </button>
                </div>
              </div>
            </div>

            {/* ── Right: Pricing + Stock ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
                <div className="w-1 h-4 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-xs font-black text-gray-600 flex items-center gap-1">
                  <DollarSign size={12} className="text-emerald-600"/> التسعير والمخزون
                </span>
              </div>

              {/* Price tiers grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'costPrice',              label: 'سعر التكلفة',      bg: 'bg-blue-50',    border: 'border-blue-100',    lbl: 'text-blue-700',    numCls: 'border-blue-200 text-blue-900 focus:border-blue-400'  },
                  { key: 'salePrice',              label: 'سعر المفرق',       bg: 'bg-green-50',   border: 'border-green-100',   lbl: 'text-green-700',   numCls: 'border-green-200 text-green-900 focus:border-green-400' },
                  { key: 'wholesalePrice',         label: 'سعر الجملة',       bg: 'bg-orange-50',  border: 'border-orange-100',  lbl: 'text-orange-700',  numCls: 'border-orange-200 text-orange-900 focus:border-orange-400' },
                  { key: 'wholesaleWholesalePrice', label: 'سعر جملة الجملة', bg: 'bg-amber-50',   border: 'border-amber-100',   lbl: 'text-amber-700',   numCls: 'border-amber-200 text-amber-900 focus:border-amber-400' },
                  { key: 'distributionPrice',      label: 'سعر التوزيع',      bg: 'bg-purple-50',  border: 'border-purple-100',  lbl: 'text-purple-700',  numCls: 'border-purple-200 text-purple-900 focus:border-purple-400' },
                  { key: 'delegatePrice',          label: 'سعر المندوب',      bg: 'bg-pink-50',    border: 'border-pink-100',    lbl: 'text-pink-700',    numCls: 'border-pink-200 text-pink-900 focus:border-pink-400' },
                  { key: 'posPrice',               label: 'سعر POS',          bg: 'bg-emerald-50', border: 'border-emerald-100', lbl: 'text-emerald-700', numCls: 'border-emerald-200 text-emerald-900 focus:border-emerald-400' },
                ].map(({ key, label, bg, border, lbl, numCls }) => (
                  <div key={key} className={`rounded-xl ${border} ${bg} p-3`}>
                    <div className={`text-[10px] font-black ${lbl} mb-1.5`}>{label}</div>
                    <input type="number" step="0.001" min="0"
                      value={itemForm[key] || ''}
                      onChange={e => setItemForm({ ...itemForm, [key]: e.target.value })}
                      className={`w-full rounded-lg border ${numCls} bg-white px-2 py-2 text-center text-lg font-black font-numeric outline-none transition`} />
                  </div>
                ))}
              </div>

              {/* Quantity + Min stock */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="text-[10px] font-black text-gray-600 mb-1.5">
                    {editingItem ? 'الرصيد الحالي (تسوية يدوية)' : 'الكمية الافتتاحية'}
                  </div>
                  <input type="number" value={itemForm.quantity}
                    onChange={e => setItemForm({ ...itemForm, quantity: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-center text-lg font-black font-numeric text-gray-900 outline-none focus:border-primary transition"
                    placeholder="0" />
                  {editingItem && (
                    <p className="mt-1 text-[10px] font-bold text-red-400">يُعدّ تسوية يدوية</p>
                  )}
                </div>
                <div className="rounded-xl border border-red-100 bg-red-50 p-3">
                  <div className="text-[10px] font-black text-red-700 mb-1.5">حد التنبيه (نواقص)</div>
                  <input type="number" value={itemForm.minStockAlert}
                    onChange={e => setItemForm({ ...itemForm, minStockAlert: e.target.value })}
                    className="w-full rounded-lg border border-red-100 bg-white px-2 py-2 text-center text-lg font-black font-numeric text-red-900 outline-none focus:border-red-400 transition" />
                </div>
              </div>

              {/* Currency price sync */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                <div className="text-[10px] font-black text-indigo-700 mb-2 flex items-center gap-1">
                  مزامنة أسعار العملات
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <F label="عملة الأسعار">
                    <select value={itemForm.priceCurrency || 'USD'}
                      onChange={e => setItemForm({ ...itemForm, priceCurrency: e.target.value })}
                      className={sel + " text-xs"}>
                      <option value="USD">USD</option>
                      <option value="SYP">SYP</option>
                      <option value="TRY">TRY</option>
                    </select>
                  </F>
                  <F label="سعر الصرف">
                    <input type="number" step="0.01" min="0"
                      value={itemForm._syncExchangeRate || ''}
                      onChange={e => setItemForm({ ...itemForm, _syncExchangeRate: e.target.value })}
                      className={inp + " font-mono text-xs"} placeholder="15000" />
                  </F>
                  <div className="flex items-end">
                    <button type="button"
                      onClick={() => {
                        const rate = Number(itemForm._syncExchangeRate || 0);
                        if (rate <= 0) return;
                        const base = (cur: string) => Number(itemForm[cur] || 0);
                        const sync = (cur: string) => rate > 0 ? (base(cur) * rate).toFixed(2) : '';
                        setItemForm((p: any) => ({
                          ...p,
                          costPriceBase: base('costPrice'),
                          salePriceBase: sync('salePrice') ? Number(sync('salePrice')) : p.salePriceBase,
                          wholesalePriceBase: sync('wholesalePrice') ? Number(sync('wholesalePrice')) : p.wholesalePriceBase,
                          posPriceBase: sync('posPrice') ? Number(sync('posPrice')) : p.posPriceBase,
                        }));
                      }}
                      className="w-full px-2 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition">
                      مزامنة
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-indigo-600 font-bold mt-1.5">
                  أدخل سعر الصرف ثم اضغط "مزامنة" لتحديث الأسعار الأساسية (Base) تلقائياً
                </p>
              </div>

              {/* Notes */}
              <F label="ملاحظات">
                <textarea rows={3} value={itemForm.notes}
                  onChange={e => setItemForm({ ...itemForm, notes: e.target.value })}
                  className={inp + " resize-none"} placeholder="أي تفاصيل إضافية..." />
              </F>
            </div>
          </div>

          {/* ════ Details collapsible ════ */}
          <div className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button type="button" onClick={() => setShowDetails(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-gray-300 shrink-0" />
                <span className="text-xs font-black text-gray-500 flex items-center gap-1.5">
                  <Info size={12} className="text-gray-400"/>
                  تفاصيل إضافية
                </span>
                <span className="text-[10px] text-gray-400">صورة المادة · مواصفات · مادة الميزان</span>
              </div>
              <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`} />
            </button>

            {showDetails && (
              <div className="p-4 border-t border-gray-100 space-y-4">

                {/* Image + specs 2 col */}
                <div className="grid grid-cols-1 xl:grid-cols-[220px_1fr] gap-4">
                  {/* Image */}
                  <div>
                    <div className="text-[11px] font-bold text-gray-500 mb-1.5">صورة المادة</div>
                    <div onClick={() => fileInputRef.current?.click()}
                      className="group relative flex aspect-video cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:border-primary hover:bg-primary/5 transition">
                      {itemForm.imageUrl ? (
                        <>
                          <img src={itemForm.imageUrl} className="max-h-full max-w-full object-contain p-2" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition">
                            <Upload className="text-white" size={20} />
                          </div>
                          <button type="button" onClick={e => { e.stopPropagation(); setItemForm((p: any) => ({ ...p, imageUrl: '' })); }}
                            className="absolute left-2 top-2 rounded-full bg-red-500 p-1 text-white shadow">
                            <Trash2 size={11} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="rounded-full border bg-white p-3 text-gray-300 shadow group-hover:text-primary transition"><ImageIcon size={24} /></div>
                          <p className="text-[10px] font-bold text-gray-400 mt-1 group-hover:text-primary">انقر لرفع صورة</p>
                        </>
                      )}
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </div>

                  {/* Specs */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <F label="الرقم التسلسلي (SN)">
                      <input type="text" value={itemForm.serialNumber} onChange={e => setItemForm({ ...itemForm, serialNumber: e.target.value })} className={inp + " font-mono"} placeholder="SN-..." />
                    </F>
                    <F label="الموديل">
                      <input type="text" value={itemForm.model} onChange={e => setItemForm({ ...itemForm, model: e.target.value })} className={inp} />
                    </F>
                    <F label="القياس">
                      <input type="text" value={itemForm.dimensions} onChange={e => setItemForm({ ...itemForm, dimensions: e.target.value })} className={inp} />
                    </F>
                    <F label="اللون">
                      <input type="text" value={itemForm.color} onChange={e => setItemForm({ ...itemForm, color: e.target.value })} className={inp} />
                    </F>
                    <F label="المنشأ">
                      <input type="text" value={itemForm.origin} onChange={e => setItemForm({ ...itemForm, origin: e.target.value })} className={inp} />
                    </F>
                    <F label="الشركة المصنعة">
                      <input type="text" value={itemForm.manufacturer} onChange={e => setItemForm({ ...itemForm, manufacturer: e.target.value })} className={inp} />
                    </F>
                    <F label="الوزن القائم">
                      <input type="number" step="0.01" value={itemForm.grossWeight} onChange={e => setItemForm({ ...itemForm, grossWeight: e.target.value })} className={inp + " font-mono"} placeholder="0.00" />
                    </F>
                    <F label="الوزن الصافي">
                      <input type="number" step="0.01" value={itemForm.netWeight} onChange={e => setItemForm({ ...itemForm, netWeight: e.target.value })} className={inp + " font-mono"} placeholder="0.00" />
                    </F>
                  </div>
                </div>

                {/* Scale item */}
                <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 text-cyan-900 text-sm font-black">
                      <ScanBarcode size={14}/> مادة ميزان
                      <span className="text-[10px] text-cyan-600 font-bold">9 + 6 PLU + 5 وزن + تحقق</span>
                    </div>
                    <button type="button"
                      onClick={() => { if (itemForm.isScaleItem) setItemForm((p: any) => ({ ...p, isScaleItem: false })); else applyScaleLabelPreset(); }}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-black transition ${itemForm.isScaleItem ? 'bg-cyan-600 border-cyan-700 text-white' : 'bg-white border-cyan-200 text-cyan-800 hover:bg-cyan-100'}`}>
                      {itemForm.isScaleItem ? 'مفعّل ✓' : 'غير مفعّل'}
                    </button>
                  </div>
                  {itemForm.isScaleItem && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                      <F label="كود الميزان (PLU)"><input type="text" value={itemForm.scalePluCode} onChange={e => setItemForm({ ...itemForm, scalePluCode: e.target.value })} className={inp + " font-mono"} placeholder="900018" /></F>
                      <F label="بادئة الباركود"><input type="text" value={itemForm.scaleBarcodePrefix} onChange={e => setItemForm({ ...itemForm, scaleBarcodePrefix: e.target.value })} className={inp + " font-mono"} placeholder="9" /></F>
                      <F label="نوع الباركود"><select value={itemForm.scaleBarcodeMode} onChange={e => setItemForm({ ...itemForm, scaleBarcodeMode: e.target.value })} className={sel}><option value="weight">يحمل الوزن</option><option value="price">يحمل السعر</option></select></F>
                      <F label="وحدة الوزن"><select value={itemForm.scaleUnit} onChange={e => setItemForm({ ...itemForm, scaleUnit: e.target.value })} className={sel}><option value="gram">غرام</option><option value="kilogram">كيلوغرام</option></select></F>
                      <F label="سعر الكيلو"><input type="number" step="0.01" value={itemForm.scalePricePerKg} onChange={e => setItemForm({ ...itemForm, scalePricePerKg: e.target.value })} className={inp + " font-mono"} placeholder="12500" /></F>
                      <F label="خانات الكود"><input type="number" min={1} value={itemForm.scaleItemCodeLength} onChange={e => setItemForm({ ...itemForm, scaleItemCodeLength: e.target.value })} className={inp + " font-mono"} placeholder="6" /></F>
                      <F label="خانات الوزن"><input type="number" min={1} value={itemForm.scaleValueLength} onChange={e => setItemForm({ ...itemForm, scaleValueLength: e.target.value })} className={inp + " font-mono"} placeholder="5" /></F>
                      <F label="المنازل العشرية">
                        <input type="number" min={0} max={5} value={itemForm.scaleDecimals} onChange={e => setItemForm({ ...itemForm, scaleDecimals: e.target.value })} className={inp + " font-mono"} placeholder="3" />
                        <p className="text-[10px] text-cyan-700 font-bold mt-1">{scaleDecimalsHint}</p>
                      </F>
                      <div className="col-span-2 md:col-span-4 grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-cyan-200 bg-white p-2.5"><div className="text-[10px] font-black text-cyan-600 mb-1">مقطع الوزن</div><div className="font-black font-mono text-cyan-900">{scaleBarcodePreview.valueSegment}</div><div className="text-[10px] text-cyan-700">{scaleBarcodePreview.displayValue}</div></div>
                        <div className="rounded-lg border border-cyan-200 bg-white p-2.5"><div className="text-[10px] font-black text-cyan-600 mb-1">الباركود الكامل</div><div className="font-black font-mono text-cyan-900 break-all text-sm">{scaleBarcodePreview.fullBarcode}</div></div>
                        <div className="rounded-lg border border-cyan-200 bg-white p-2.5"><div className="text-[10px] font-black text-cyan-600 mb-1">التفسير</div><div className="text-[10px] leading-5 text-cyan-800">البادئة {itemForm.scaleBarcodePrefix || scaleLabelPreset.prefix} ثم الكود ثم الوزن، والأخير للتحقق.</div></div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>

          {/* bottom padding before sticky footer */}
          <div className="h-20" />
        </div>
      </form>

      {/* ── Sticky footer ── */}
      <div className="sticky bottom-0 z-20 border-t bg-white px-5 py-3 flex items-center justify-between gap-3 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] shrink-0">
        <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 font-mono text-[10px]">Enter</kbd> للانتقال ·
          <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 font-mono text-[10px]">Esc</kbd> للإغلاق
        </div>
        <div className="flex items-center gap-3 mr-auto">
          <button type="button" onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 transition text-sm">
            إلغاء
          </button>
          <button type="button" onClick={() => formRef.current?.requestSubmit()} disabled={isSaving}
            className="flex items-center gap-2 px-8 py-2 rounded-xl bg-primary text-white font-bold shadow hover:bg-teal-800 disabled:bg-gray-400 transition text-sm">
            {isSaving ? <RefreshCw className="animate-spin" size={16} /> : <Check size={16} />}
            {editingItem ? 'حفظ التغييرات' : 'إضافة للمخزون'}
          </button>
        </div>
      </div>

    </div>
  );
};

export default ItemFormModal;
