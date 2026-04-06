import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Scissors } from 'lucide-react';
import Combobox from '../Combobox';
import { apiRequest } from '../../lib/api';
import type { InventoryItem, TextileColor, TextileInventoryBalance } from '../../types';
import AdaptiveModal from '../responsive/AdaptiveModal';
import SerialEntryModal from './SerialEntryModal';
import SerialSelectionModal from './SerialSelectionModal';
import {
  normalizeTextileDecompositionDraft,
  shouldAutoCreatePurchaseMaterialOnEnter,
  shouldShowTextileDecompositionButton,
  shouldUseTextileEntryLayout,
} from './textileInvoiceEntry.utils';

interface POSProps {
  entry: any;
  setEntry: (entry: any) => void;
  inventory: InventoryItem[];
  handleItemSelect: (id: string, name?: string) => void;
  handleAddToCart: (overrides?: any) => void;
  selectedWarehouseId: string;
  warehouses: any[];
  invoiceType: 'sale' | 'purchase' | 'opening_stock';
  textileModeEnabled?: boolean;
}

const InvoicePOSEntry: React.FC<POSProps> = ({
  entry,
  setEntry,
  inventory,
  handleItemSelect,
  handleAddToCart,
  selectedWarehouseId,
  warehouses,
  invoiceType,
  textileModeEnabled = false,
}) => {
  const [units, setUnits] = useState<any[]>([]);
  const [colors, setColors] = useState<TextileColor[]>([]);
  const [textileBalances, setTextileBalances] = useState<TextileInventoryBalance[]>([]);
  const [serialEntryOpen, setSerialEntryOpen] = useState(false);
  const [serialSelectionOpen, setSerialSelectionOpen] = useState(false);
  const [decompositionOpen, setDecompositionOpen] = useState(false);
  const [decompositionDraft, setDecompositionDraft] = useState<Array<{ sequence: number; lengthValue: string; unit: 'meter' | 'yard'; rollLabel?: string | null }>>([]);
  const decompositionRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    apiRequest('units').then(setUnits).catch(() => {});
    apiRequest('textile/colors').then(setColors).catch(() => {});
  }, [invoiceType, textileModeEnabled]);

  useEffect(() => {
    if (!textileModeEnabled || invoiceType !== 'sale') {
      setTextileBalances([]);
      return;
    }
    const query = selectedWarehouseId
      ? `textile/inventory?warehouseId=${encodeURIComponent(selectedWarehouseId)}`
      : 'textile/inventory';
    apiRequest(query).then(setTextileBalances).catch(() => setTextileBalances([]));
  }, [invoiceType, textileModeEnabled, selectedWarehouseId]);

  const filteredInventory = useMemo(() => {
    const activeInventory = inventory.filter((item) => !item.inactive && !item.merged);
    if (!selectedWarehouseId) return activeInventory;
    return activeInventory.filter((item) => item.warehouseId === selectedWarehouseId);
  }, [inventory, selectedWarehouseId]);

  const selectedItem = useMemo(
    () => filteredInventory.find((item) => String(item.id) === String(entry.itemId || '')) || null,
    [filteredInventory, entry.itemId],
  );

  const saleColorOptions = useMemo(() => {
    if (invoiceType !== 'sale' || !selectedItem) return [];

    const balancesForItem = textileBalances.filter((balance) => (
      String(balance.itemId || '') === String(selectedItem.id || '')
      && (!selectedWarehouseId || String(balance.warehouseId || '') === String(selectedWarehouseId))
      && (Number(balance.rollCount || 0) > 0 || Number(balance.totalLength || 0) > 0)
    ));

    const seen = new Set<string>();
    return balancesForItem.flatMap((balance) => {
      const colorId = String(balance.colorId || '').trim();
      if (!colorId || seen.has(colorId)) return [];
      seen.add(colorId);
      const masterColor = colors.find((color) => String(color.id) === colorId);
      const colorName = String(masterColor?.name || balance.colorName || '').trim();
      return [{
        id: colorId,
        label: colorName || 'لون غير محدد',
        subLabel: `${Number(balance.rollCount || 0)} رول | ${Number(balance.totalLength || 0).toFixed(2)} ${balance.baseUom === 'yard' ? 'يارد' : 'متر'}`,
      }];
    });
  }, [invoiceType, selectedItem, textileBalances, selectedWarehouseId, colors]);

  const showTextileLayout = shouldUseTextileEntryLayout(textileModeEnabled, invoiceType);
  const selectedItemIsTextile = textileModeEnabled && Boolean(selectedItem?.isTextile || (selectedItem as any)?.is_textile);
  const textileEntryActive = showTextileLayout && (invoiceType === 'purchase' || Boolean(entry.isTextile || selectedItemIsTextile));
  const textileBaseUom = entry.textileBaseUom || selectedItem?.textileBaseUom || (selectedItem as any)?.textile_base_uom || 'meter';
  const textileLength = Number(textileBaseUom === 'yard' ? (entry.yards || 0) : (entry.meters || 0));
  const textileRollCount = Number(entry.rolls || 0);
  const displayTotal = textileEntryActive
    ? textileLength * Number(entry.price || 0)
    : Number(entry.quantity || 0) * Number(entry.price || 0);
  const decompositionRows = Array.isArray(entry.textileDecompositionPayload) ? entry.textileDecompositionPayload : [];
  const decompositionComplete = decompositionRows.length === Math.round(textileRollCount)
    && decompositionRows.length > 0
    && decompositionRows.every((row: any) => Number(row?.lengthValue || 0) > 0);
  const decompositionTotal = decompositionRows.reduce((sum: number, row: any) => sum + Number(row?.lengthValue || 0), 0);
  const decompositionRunningTotal = decompositionDraft.reduce((sum, row) => sum + Number(row.lengthValue || 0), 0);
  const decompositionEnteredCount = decompositionDraft.filter((row) => Number(row.lengthValue || 0) > 0).length;
  const decompositionTargetCount = Math.max(0, Math.round(textileRollCount));
  const decompositionProgress = decompositionTargetCount > 0
    ? Math.min(100, (decompositionEnteredCount / decompositionTargetCount) * 100)
    : 0;
  const purchaseAutoCreateEnabled = shouldAutoCreatePurchaseMaterialOnEnter(invoiceType);
  const showDecompositionButton = shouldShowTextileDecompositionButton({
    textileModeEnabled,
    invoiceType,
    entryIsTextile: entry.isTextile,
    selectedItemIsTextile,
  });

  useEffect(() => {
    if (selectedItemIsTextile) {
      console.log('TEXTILE UI ACTIVATION CHECK:', { selectedItem, entry, textileBaseUom, showTextileLayout });
    }
    if (selectedItemIsTextile && !showTextileLayout) {
      console.error('TEXTILE UI NOT ACTIVATED');
    }
  }, [selectedItemIsTextile, selectedItem, entry, textileBaseUom, showTextileLayout]);

  useEffect(() => {
    if (!decompositionOpen) return;
    const timer = window.setTimeout(() => decompositionRefs.current[0]?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [decompositionOpen]);

  const handleSmartAdd = async (name: string) => {
    if (!selectedWarehouseId) {
      alert('يرجى اختيار المستودع أولاً من رأس الفاتورة.');
      return;
    }

    const code = `NEW-${Date.now().toString().slice(-4)}`;
    const warehouseName = warehouses.find((w: any) => w.id === selectedWarehouseId)?.name || 'رئيسي';
    const shouldCreateAsTextile = textileModeEnabled && invoiceType === 'purchase';

    const newItem = {
      id: `item-${Date.now()}`,
      name,
      code,
      quantity: 0,
      unitName: shouldCreateAsTextile ? textileBaseUom : (entry.unitName || 'قطعة'),
      salePrice: Number(entry.price) || 0,
      costPrice: 0,
      warehouseId: selectedWarehouseId,
      warehouseName,
      serialTracking: 'none',
      isTextile: shouldCreateAsTextile,
      textileBaseUom: shouldCreateAsTextile ? textileBaseUom : null,
      supportsColorDimension: shouldCreateAsTextile,
      lastUpdated: new Date().toISOString(),
    };

    try {
      const created = await apiRequest('inventory', { method: 'POST', body: JSON.stringify(newItem) });
      const createdId = String(created?.id || newItem.id);
      setEntry({
        ...entry,
        itemId: createdId,
        itemName: name,
        unitName: shouldCreateAsTextile ? textileBaseUom : (created?.unitName || newItem.unitName),
        isTextile: shouldCreateAsTextile,
        textileBaseUom: shouldCreateAsTextile ? textileBaseUom : (entry.textileBaseUom || 'meter'),
      });
    } catch (error) {
      console.error('Smart add error:', error);
      alert('فشلت الإضافة التلقائية للمادة. تأكد من الاتصال بالخادم.');
    }
  };

  const handleAddClick = () => {
    if (textileEntryActive) {
      handleAddToCart();
      return;
    }

    const quantity = Math.max(0, Math.round(Number(entry.quantity || 0)));
    const tracking = String((selectedItem as any)?.serialTracking || 'none');

    if (!selectedItem || tracking === 'none') {
      handleAddToCart();
      return;
    }

    if (!quantity) {
      alert('يرجى إدخال الكمية أولاً.');
      return;
    }

    if (invoiceType === 'purchase' || invoiceType === 'opening_stock') {
      setSerialEntryOpen(true);
      return;
    }

    setSerialSelectionOpen(true);
  };

  const openDecomposition = () => {
    if (!textileEntryActive || invoiceType !== 'sale') return;
    const rolls = Math.max(0, Math.round(Number(entry.rolls || 0)));
    if (!rolls) {
      alert('أدخل الكمية أولاً قبل التفكيك.');
      return;
    }
    const existing = Array.isArray(entry.textileDecompositionPayload) ? entry.textileDecompositionPayload : [];
    const nextDraft = Array.from({ length: rolls }, (_, index) => ({
      sequence: index + 1,
      lengthValue: String(existing[index]?.lengthValue ?? ''),
      unit: existing[index]?.unit || textileBaseUom,
      rollLabel: existing[index]?.rollLabel || '',
    }));
    setDecompositionDraft(nextDraft);
    setDecompositionOpen(true);
  };

  const updateDecompositionDraft = (index: number, value: string) => {
    setDecompositionDraft((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, lengthValue: value, unit: textileBaseUom } : row
    )));
  };

  const confirmDecomposition = () => {
    const normalized = normalizeTextileDecompositionDraft(decompositionDraft, textileBaseUom);
    if (!normalized.isComplete) {
      alert('أكمل أطوال جميع الرولات قبل الحفظ.');
      return;
    }
    const totalLength = normalized.totalLength;
    setEntry({
      ...entry,
      textileDecompositionPayload: normalized.rows,
      meters: textileBaseUom === 'meter' ? String(totalLength) : '',
      yards: textileBaseUom === 'yard' ? String(totalLength) : '',
      total: String(totalLength * Number(entry.price || 0)),
    });
    setDecompositionOpen(false);
  };

  const colorSelector = textileEntryActive ? (
    <Combobox
      items={invoiceType === 'sale'
        ? (saleColorOptions.length ? saleColorOptions : colors.map((color) => ({
            id: color.id,
            label: color.name,
            subLabel: color.code || undefined,
          })))
        : colors.map((color) => ({
            id: color.id,
            label: color.name,
            subLabel: color.code || undefined,
          }))}
      selectedId={entry.textileColorId}
      onSelect={(id: string, name?: string) => setEntry({
        ...entry,
        textileColorId: id,
        textileColorName: colors.find((color) => color.id === id)?.name || name || '',
      })}
      allowCustomValue={invoiceType !== 'sale'}
      placeholder={invoiceType === 'sale' ? 'اختر لونًا متاحًا بالمخزون' : 'اختر اللون'}
    />
  ) : (
    <div className="flex min-h-[44px] items-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-400">
      اختر مادة قماشية أولاً
    </div>
  );

  return (
    <div className="rounded-xl border-2 border-primary/10 bg-white p-4 shadow-lg animate-fadeIn">
      {showTextileLayout && (
        <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${
          invoiceType === 'purchase'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-rose-200 bg-rose-50 text-rose-900'
        }`}>
          {invoiceType === 'purchase'
            ? `وضع الأقمشة مفعل: أدخل المادة واللون والكمية ووحدة الطول والسعر، مع حفظ الطول الإجمالي بوحدة ${textileBaseUom === 'yard' ? 'الياردة' : 'المتر'}.`
            : 'وضع الأقمشة مفعل: أدخل الكمية ثم استخدم زر التفكيك لتثبيت أطوال الرولات قبل إضافة السطر.'}
        </div>
      )}

      <div className="flex flex-col items-start gap-3 lg:flex-row lg:flex-wrap">
        <div className="w-full min-w-[250px] flex-1">
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
            المادة
            {selectedWarehouseId && (
              <span className="rounded border border-teal-100 bg-teal-50 px-1.5 text-[10px] text-teal-700">
                البحث في: {warehouses.find((w) => w.id === selectedWarehouseId)?.name}
              </span>
            )}
          </label>
          <Combobox
            items={filteredInventory.map((item: any) => ({
              id: item.id,
              label: item.name,
              subLabel: `${item.code} | ${item.isTextile || item.is_textile ? 'قماش' : 'رصيد'}: ${item.quantity} ${item.unitName || item.textileBaseUom || ''}`,
            }))}
            selectedId={entry.itemId}
            onSelect={handleItemSelect}
            onAddNew={purchaseAutoCreateEnabled ? handleSmartAdd : undefined}
            allowCustomValue={!purchaseAutoCreateEnabled}
            clearSelectionOnType={invoiceType === 'sale'}
            placeholder={selectedWarehouseId ? 'ابحث عن المادة...' : 'اختر المستودع أولاً للبحث...'}
          />
        </div>

        {showTextileLayout ? (
          <>
            <div className="w-full min-w-[180px] lg:w-40">
              <label className="mb-1 block text-xs font-bold text-gray-500">اللون</label>
              {colorSelector}
            </div>

            <div className="w-full min-w-[110px] lg:w-28">
              <label className="mb-1 block text-xs font-bold text-gray-500">الكمية</label>
              <input
                type="number"
                min="0"
                step="1"
                className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 bg-blue-50/30 p-2 text-center text-lg font-bold font-numeric outline-none focus:border-primary"
                value={entry.rolls || ''}
                onChange={(e) => setEntry({
                  ...entry,
                  rolls: e.target.value,
                  textileDecompositionPayload: invoiceType === 'sale' ? [] : (entry.textileDecompositionPayload || []),
                })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
              />
              <div className="mt-1 text-[10px] font-bold text-gray-400">عدد الرولات</div>
            </div>

            {invoiceType === 'sale' && (
              <div className="w-full min-w-[135px] lg:w-36">
                <label className="mb-1 block text-xs font-bold text-gray-500">الأطوال</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 bg-indigo-50/40 p-2 text-center text-lg font-bold font-numeric outline-none focus:border-primary"
                  value={textileBaseUom === 'yard' ? (entry.yards || '') : (entry.meters || '')}
                  onChange={(e) => setEntry({
                    ...entry,
                    meters: textileBaseUom === 'meter' ? e.target.value : '',
                    yards: textileBaseUom === 'yard' ? e.target.value : '',
                  })}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
                />
                <div className="mt-1 text-[10px] font-bold text-gray-400">
                  {decompositionComplete ? 'تم احتسابها من التفكيك' : `بوحدة ${textileBaseUom === 'yard' ? 'ياردة' : 'متر'}`}
                </div>
              </div>
            )}

            {invoiceType === 'purchase' && (
              <div className="w-full min-w-[110px] lg:w-28">
                <label className="mb-1 block text-xs font-bold text-gray-500">الوحدة</label>
                <select
                  className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 bg-gray-50 p-2 text-center font-bold outline-none focus:border-primary"
                  value={textileBaseUom}
                  onChange={(e) => setEntry({
                    ...entry,
                    textileBaseUom: e.target.value,
                    unitName: e.target.value,
                    meters: e.target.value === 'meter' ? (entry.meters || entry.yards || '') : '',
                    yards: e.target.value === 'yard' ? (entry.yards || entry.meters || '') : '',
                  })}
                >
                  <option value="meter">متر</option>
                  <option value="yard">يارد</option>
                </select>
              </div>
            )}

            {invoiceType === 'purchase' && (
              <div className="w-full min-w-[135px] lg:w-36">
                <label className="mb-1 block text-xs font-bold text-gray-500">الطول الإجمالي</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 bg-indigo-50/40 p-2 text-center text-lg font-bold font-numeric outline-none focus:border-primary"
                  value={textileBaseUom === 'yard' ? (entry.yards || '') : (entry.meters || '')}
                  onChange={(e) => setEntry({
                    ...entry,
                    meters: textileBaseUom === 'meter' ? e.target.value : '',
                    yards: textileBaseUom === 'yard' ? e.target.value : '',
                  })}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
                />
                <div className="mt-1 text-[10px] font-bold text-gray-400">
                  {textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
                </div>
              </div>
            )}

            <div className="w-full min-w-[120px] lg:w-28">
              <label className="mb-1 block text-xs font-bold text-gray-500">السعر</label>
              <input
                type="number"
                min="0"
                step="0.0001"
                className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 p-2 text-center font-bold font-numeric outline-none focus:border-primary"
                value={entry.price}
                onChange={(e) => setEntry({ ...entry, price: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
              />
              <div className="mt-1 text-[10px] font-bold text-gray-400">
                لكل {textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-full min-w-[128px] lg:w-32">
              <label className="mb-1 block text-xs font-bold text-gray-500">الوحدة</label>
              <select
                className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 bg-gray-50 p-2 font-bold outline-none transition focus:border-primary"
                value={entry.unitName}
                onChange={(e) => setEntry({ ...entry, unitName: e.target.value })}
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.name}>
                    {unit.name}
                  </option>
                ))}
                {!units.find((unit) => unit.name === entry.unitName) && entry.unitName && (
                  <option value={entry.unitName}>{entry.unitName}</option>
                )}
              </select>
            </div>

            <div className="w-full min-w-[128px] lg:w-32">
              <label className="mb-1 block text-xs font-bold text-gray-500">الكمية</label>
              <input
                type="number"
                className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 bg-blue-50/30 p-2 text-center text-lg font-bold font-numeric outline-none focus:border-primary"
                value={entry.quantity || ''}
                onChange={(e) => setEntry({ ...entry, quantity: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
              />
            </div>

            <div className="w-full min-w-[120px] lg:w-28">
              <label className="mb-1 block text-xs font-bold text-gray-500">السعر ($)</label>
              <input
                type="number"
                className="min-h-[44px] w-full rounded-lg border-2 border-gray-100 p-2 text-center font-bold font-numeric outline-none focus:border-primary"
                value={entry.price}
                onChange={(e) => setEntry({ ...entry, price: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
              />
            </div>
          </>
        )}

        <div className="hidden w-full lg:block lg:w-28">
          <label className="mb-1 block text-xs font-bold text-gray-500">المجموع</label>
          <div className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-transparent bg-gray-100 p-2 text-center text-lg font-bold font-numeric">
            {displayTotal.toFixed(2)}
          </div>
        </div>

        {showDecompositionButton && (
          <div className="w-full lg:w-auto">
            <button
              type="button"
              onClick={openDecomposition}
              className="tap-feedback flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 font-bold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              <Scissors size={18} />
              Decomposition
            </button>
          </div>
        )}

        <div className="w-full lg:w-auto">
          <button
            onClick={handleAddClick}
            className="tap-feedback flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-green-600 py-2 font-bold text-white shadow-lg transition hover:bg-green-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 lg:w-28"
          >
            <Plus size={20} />
            Add
          </button>
        </div>
      </div>

      {showTextileLayout && textileEntryActive && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
          {entry.textileColorName && (
            <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">Color: {entry.textileColorName}</span>
          )}
          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">Quantity: {textileRollCount || 0}</span>
          {(invoiceType === 'sale' || textileLength > 0) && (
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
              Lengths: {textileLength.toFixed(2)} {textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
            Unit: {textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
          </span>
          {invoiceType === 'sale' && decompositionRows.length > 0 && (
            <span className={`rounded-full px-2 py-1 ${decompositionComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
              Decomposition: {decompositionRows.map((row: any) => `${row.sequence}:${row.lengthValue}`).join(' | ')}
            </span>
          )}
        </div>
      )}

      <AdaptiveModal
        open={decompositionOpen}
        onClose={() => setDecompositionOpen(false)}
        size="xl"
        panelClassName="lg:max-w-5xl"
      >
        <div className="flex h-full flex-col bg-gradient-to-b from-slate-50 via-white to-white">
          <div className="border-b border-slate-200 bg-white/90 px-5 py-5 backdrop-blur-sm sm:px-6">
            <div className="text-lg font-black text-gray-900">تفكيك الرولات</div>
            <div className="mt-1 text-sm font-bold text-gray-500">
              أدخل طول كل رول. سيتم تحديث إجمالي الأطوال داخل الفاتورة مباشرة.
            </div>
          </div>
          <div className="flex-1 overflow-auto px-4 py-4 sm:px-6">
            <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-800">ملخص الإدخال</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    أكمل أطوال جميع الرولات ثم احفظ التفكيك ليتم ترحيل الطول الإجمالي إلى سطر الفاتورة.
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-900 px-4 py-3 text-right text-white shadow-sm">
                  <div className="text-[11px] font-bold text-slate-300">الطول الجاري</div>
                  <div className="mt-1 text-2xl font-black font-numeric">
                    {decompositionRunningTotal.toFixed(2)}
                  </div>
                  <div className="text-[11px] font-bold text-slate-300">
                    {textileBaseUom === 'yard' ? 'يارد' : 'متر'}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-amber-50 px-4 py-3">
                  <div className="text-[11px] font-black text-amber-700">الرولات المطلوبة</div>
                  <div className="mt-1 text-xl font-black text-amber-900">{decompositionTargetCount}</div>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                  <div className="text-[11px] font-black text-emerald-700">الرولات المكتملة</div>
                  <div className="mt-1 text-xl font-black text-emerald-900">{decompositionEnteredCount}</div>
                </div>
                <div className={`rounded-2xl px-4 py-3 ${
                  decompositionEnteredCount === decompositionTargetCount && decompositionTargetCount > 0
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-800'
                }`}>
                  <div className="text-[11px] font-black opacity-80">الحالة</div>
                  <div className="mt-1 text-sm font-black">
                    {decompositionEnteredCount === decompositionTargetCount && decompositionTargetCount > 0
                      ? 'مكتمل'
                      : `متبقي ${Math.max(0, decompositionTargetCount - decompositionEnteredCount)} رول`}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-black text-slate-500">
                  <span>نسبة الإنجاز</span>
                  <span>{decompositionEnteredCount} / {decompositionTargetCount}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-300"
                    style={{ width: `${decompositionProgress}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="hidden">
              <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">الكمية: {textileRollCount}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                الإجمالي الحالي: {decompositionDraft.reduce((sum, row) => sum + Number(row.lengthValue || 0), 0).toFixed(2)} {textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
              </span>
            </div>
            <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              {decompositionDraft.map((row, index) => (
                <div
                  key={row.sequence}
                  className={`grid items-center gap-3 rounded-2xl border px-3 py-3 transition sm:grid-cols-[84px_minmax(0,1fr)_96px] sm:px-4 ${
                    Number(row.lengthValue || 0) > 0
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <div className="text-sm font-black text-gray-700">رول {row.sequence}</div>
                  <input
                    ref={(node) => { decompositionRefs.current[index] = node; }}
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.lengthValue}
                    onChange={(e) => updateDecompositionDraft(index, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        decompositionRefs.current[index + 1]?.focus();
                      }
                    }}
                    className="min-h-[54px] w-full rounded-xl border-2 border-white bg-white px-4 text-center text-xl font-black font-numeric text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <div className="hidden min-h-[54px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm font-black text-slate-700 sm:flex">
                    {textileBaseUom === 'yard' ? 'يارد' : 'متر'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-bold text-slate-500">
              الإجمالي النهائي: <span className="font-black text-emerald-700">{decompositionRunningTotal.toFixed(2)} {textileBaseUom === 'yard' ? 'ياردة' : 'متر'}</span>
            </div>
              <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setDecompositionOpen(false)}
                className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 transition hover:bg-slate-50"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={confirmDecomposition}
                className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white shadow-lg transition hover:bg-emerald-700"
              >
                حفظ التفكيك
              </button>
            </div>
          </div>
        </div>
        </div>
      </AdaptiveModal>

      <SerialEntryModal
        open={serialEntryOpen}
        itemName={entry.itemName || selectedItem?.name || 'المادة'}
        quantity={Math.max(0, Math.round(Number(entry.quantity || 0)))}
        onClose={() => setSerialEntryOpen(false)}
        onConfirm={(serialNumbers) => {
          setSerialEntryOpen(false);
          handleAddToCart({ serialNumbers });
        }}
      />

      <SerialSelectionModal
        open={serialSelectionOpen}
        itemId={selectedItem?.id || ''}
        itemName={entry.itemName || selectedItem?.name || 'المادة'}
        warehouseId={selectedWarehouseId}
        quantity={Math.max(0, Math.round(Number(entry.quantity || 0)))}
        required={String((selectedItem as any)?.serialTracking || 'none') === 'required'}
        onClose={() => setSerialSelectionOpen(false)}
        onConfirm={(serialNumbers) => {
          setSerialSelectionOpen(false);
          handleAddToCart({ serialNumbers });
        }}
      />
    </div>
  );
};

export default InvoicePOSEntry;
