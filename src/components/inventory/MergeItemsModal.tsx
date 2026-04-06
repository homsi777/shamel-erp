import React, { useMemo, useState } from 'react';
import { AlertTriangle, Combine, RefreshCw, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';
import { confirmDialog } from '../../lib/confirm';
import type { InventoryItem, ItemGroupItem, ItemMergePreview, ItemMergeResult } from '../../types';
import { buildItemMergePreview } from '../../services/itemMergeService';

const MergeItemsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  items: InventoryItem[];
  itemGroupItems: ItemGroupItem[];
  onExecute: (payload: { sourceItemId: string; targetItemId: string }) => Promise<ItemMergeResult>;
}> = ({ open, onClose, items, itemGroupItems, onExecute }) => {
  const [sourceItemId, setSourceItemId] = useState('');
  const [targetItemId, setTargetItemId] = useState('');
  const [preview, setPreview] = useState<ItemMergePreview | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const activeItems = useMemo(
    () => items.filter((item) => !item.merged && !item.inactive),
    [items],
  );
  const sourceItem = activeItems.find((item) => String(item.id) === sourceItemId) || null;
  const targetItem = activeItems.find((item) => String(item.id) === targetItemId) || null;

  const handlePreview = async () => {
    if (!sourceItem || !targetItem) {
      alert('يجب اختيار المادة المصدر والمادة الهدف.');
      return;
    }
    setIsBusy(true);
    try {
      const nextPreview = await buildItemMergePreview(sourceItem, targetItem, itemGroupItems);
      setPreview(nextPreview);
    } finally {
      setIsBusy(false);
    }
  };

  const handleExecute = async () => {
    if (!preview || !sourceItem || !targetItem) {
      await handlePreview();
      return;
    }
    if (preview.warnings.some((warning) => warning.includes('مختلف') || warning.includes('غير صالحة') || warning.includes('بنفسها'))) {
      alert('المعاينة تحتوي على تحذير مانع. أصلح المشكلة قبل التنفيذ.');
      return;
    }
    const confirmed = await confirmDialog(`سيتم دمج "${preview.sourceItemName}" داخل "${preview.targetItemName}". هل تريد المتابعة؟`);
    if (!confirmed) return;
    setIsBusy(true);
    try {
      await onExecute({ sourceItemId, targetItemId });
      onClose();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AdaptiveModal open={open} onClose={onClose} size="xl" zIndex={230} panelClassName="flex h-full max-h-[92vh] flex-col">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-rose-700">
              <Combine size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-900">دمج مادتين</h3>
              <p className="text-[11px] font-bold text-gray-400">نقل الروابط الأساسية وتعليم المادة المصدر كمادة مدموجة وغير فعالة</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
            <XCircle size={18} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div>
              <label className="mb-1 block text-xs font-black text-gray-500">المادة المصدر</label>
              <select
                value={sourceItemId}
                onChange={(e) => {
                  setSourceItemId(e.target.value);
                  setPreview(null);
                }}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
              >
                <option value="">اختر المادة المصدر</option>
                {activeItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} - {item.code}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-black text-gray-500">المادة الهدف</label>
              <select
                value={targetItemId}
                onChange={(e) => {
                  setTargetItemId(e.target.value);
                  setPreview(null);
                }}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
              >
                <option value="">اختر المادة الهدف</option>
                {activeItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} - {item.code}</option>
                ))}
              </select>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">
              العملية حساسة: سيتم نقل الأرصدة والروابط الأساسية إلى المادة الهدف، ثم تعليم المادة المصدر كمادة مدموجة وغير فعالة.
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 text-sm font-black text-gray-800">المعاينة قبل التنفيذ</div>
              {!preview ? (
                <div className="p-5 text-sm font-bold text-gray-400">اضغط معاينة لعرض أثر الدمج قبل التنفيذ.</div>
              ) : (
                <div className="space-y-4 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs font-black text-gray-500">المادة المصدر</div>
                      <div className="mt-1 font-black text-gray-900">{preview.sourceItemName}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs font-black text-gray-500">المادة الهدف</div>
                      <div className="mt-1 font-black text-gray-900">{preview.targetItemName}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">الرصيد المنقول</div>
                      <div className="mt-1 font-mono text-lg font-black text-primary">{preview.quantityToTransfer}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">سطور الفواتير</div>
                      <div className="mt-1 font-mono text-lg font-black text-gray-900">{preview.affectedInvoiceLineCount}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">المناقلات</div>
                      <div className="mt-1 font-mono text-lg font-black text-gray-900">{preview.affectedTransferCount}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">إجمالي السجلات</div>
                      <div className="mt-1 font-mono text-lg font-black text-rose-700">{preview.affectedRecordsCount}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">فواتير متأثرة</div>
                      <div className="mt-1 font-mono font-black text-gray-900">{preview.affectedInvoiceCount}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">مخزون وكلاء</div>
                      <div className="mt-1 font-mono font-black text-gray-900">{preview.affectedAgentInventoryCount}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">إشعارات التسليم</div>
                      <div className="mt-1 font-mono font-black text-gray-900">{preview.affectedDeliveryNoticeCount}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="text-[11px] font-black text-gray-500">روابط المجموعات/الحركات</div>
                      <div className="mt-1 font-mono font-black text-gray-900">{preview.affectedItemGroupLinks + preview.affectedInventoryTransactionCount}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {preview.warnings.map((warning, index) => (
                      <div key={`${warning}-${index}`} className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
              <button type="button" onClick={onClose} className="rounded-xl px-5 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50">
                إلغاء
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={isBusy}
                className="rounded-xl border border-primary/20 bg-white px-5 py-3 text-sm font-black text-primary hover:bg-primary/5 disabled:opacity-50"
              >
                معاينة
              </button>
              <button
                type="button"
                onClick={handleExecute}
                disabled={isBusy}
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-black text-white shadow-lg disabled:opacity-50"
              >
                {isBusy ? <RefreshCw className="animate-spin" size={16} /> : <Combine size={16} />}
                تنفيذ الدمج
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default MergeItemsModal;
