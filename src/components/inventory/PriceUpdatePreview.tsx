import React from 'react';
import type { PriceFieldKey, PriceUpdatePreviewResult } from '../../types';

const FIELD_LABELS: Record<PriceFieldKey, string> = {
  sale_price: 'سعر المبيع',
  purchase_price: 'سعر الشراء',
  wholesale_price: 'سعر الجملة',
  pos_price: 'سعر POS',
};

const formatValue = (value: number) =>
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const PriceUpdatePreview: React.FC<{
  preview: PriceUpdatePreviewResult | null;
}> = ({ preview }) => {
  if (!preview) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-bold text-gray-400">
        اضغط معاينة لعرض أثر التعديل قبل التنفيذ.
      </div>
    );
  }

  const hasLargeDifference = preview.rows.some((row) => row.hasLargeDifference);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div className="text-sm font-black text-gray-800">معاينة التعديل</div>
        <div className="text-xs font-bold text-gray-500">{preview.affectedCount} مادة متأثرة</div>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-gray-100">
              <th className="px-3 py-2 text-right">المادة</th>
              <th className="px-3 py-2 text-right">الحقل</th>
              <th className="px-3 py-2 text-center">القديم</th>
              <th className="px-3 py-2 text-center">الجديد</th>
              <th className="px-3 py-2 text-center">الفرق</th>
              <th className="px-3 py-2 text-center">نسبة الفرق</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.itemId} className="border-b border-gray-50">
                <td className="px-3 py-2">
                  <div className="font-bold text-gray-800">{row.itemName}</div>
                  <div className="text-[11px] text-gray-400">{row.itemCode}</div>
                </td>
                <td className="px-3 py-2 font-bold text-gray-600">{FIELD_LABELS[row.targetField]}</td>
                <td className="px-3 py-2 text-center font-mono text-gray-600">
                  {formatValue(row.oldValue)} {row.priceCurrency}
                </td>
                <td className="px-3 py-2 text-center font-mono font-black text-emerald-700">
                  {formatValue(row.newValue)} {row.priceCurrency}
                </td>
                <td className={`px-3 py-2 text-center font-mono font-bold ${row.delta >= 0 ? 'text-blue-700' : 'text-rose-700'}`}>
                  {formatValue(row.delta)}
                </td>
                <td className={`px-3 py-2 text-center font-mono font-bold ${row.hasLargeDifference ? 'text-amber-700' : 'text-gray-500'}`}>
                  {formatValue(row.differencePercent)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasLargeDifference && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
          تحذير: توجد مواد يتجاوز فيها فرق السعر 30% بعد التعديل. راجع المعاينة قبل التنفيذ.
        </div>
      )}
      {preview.skippedIds.length > 0 && (
        <div className="border-t border-gray-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          تم تجاوز {preview.skippedIds.length} مادة لأن السعر لم يتغير أو لأن القيم الناتجة غير صالحة.
        </div>
      )}
    </div>
  );
};

export default PriceUpdatePreview;
