import React, { useState } from 'react';
import { ShoppingBag, Tag, Trash2, ChevronDown, Percent } from 'lucide-react';
import { formatNumber } from '../../types';
import { calculateExpensePerUnit, getAdditionalCostsTotal } from '../../modules/invoices/invoice.calculations';
import { AdaptiveTable } from '../responsive';

const COMMISSION_TYPES = [
  { value: 'NONE', label: 'بدون' },
  { value: 'PERCENT', label: '% نسبة' },
  { value: 'FIXED_PER_UNIT', label: 'ثابت/وحدة' },
  { value: 'FIXED_LINE', label: 'ثابت/سطر' },
];

function calcCommission(item: any): number {
  const ct = item.commissionType || 'NONE';
  const cv = Number(item.commissionValue || 0);
  const qty = Number(item.quantity || 0);
  const total = Number(item.total || 0);
  if (ct === 'PERCENT') return total * cv / 100;
  if (ct === 'FIXED_PER_UNIT') return cv * qty;
  if (ct === 'FIXED_LINE') return cv;
  return 0;
}

interface ToggleProps { label: string; active: boolean; onClick: () => void }
const ColToggle: React.FC<ToggleProps> = ({ label, active, onClick }) => (
  <button type="button" onClick={onClick}
    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${active ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
    {label}
  </button>
);

const InvoiceCartTable = ({ cart, setCart, invoiceType, purchaseCosts }: any) => {
  const totalQty = cart.reduce((sum: number, item: any) => sum + (Number(item?.quantity) || 0), 0);
  const totalExpenses = invoiceType === 'purchase' ? getAdditionalCostsTotal(purchaseCosts || {}) : 0;
  const extraPerUnit = invoiceType === 'purchase' && totalQty > 0 ? calculateExpensePerUnit(cart, purchaseCosts || {}) : 0;
  const showCostColumn = invoiceType === 'purchase' && (extraPerUnit > 0 || totalExpenses > 0);

  const [showCommission, setShowCommission] = useState(false);
  const [showLastPurchase, setShowLastPurchase] = useState(false);
  const [showAvailableQty, setShowAvailableQty] = useState(false);

  const removeRow = (index: number) => {
    setCart(cart.filter((_: any, rowIndex: number) => rowIndex !== index));
  };

  const updateCartItem = (index: number, updates: any) => {
    setCart(cart.map((item: any, i: number) => {
      if (i !== index) return item;
      const merged = { ...item, ...updates };
      merged.commissionAmount = calcCommission(merged);
      return merged;
    }));
  };

  const renderPriceBlock = (item: any) => (
    <div className="text-center">
      <div className="font-numeric font-bold text-gray-800">{formatNumber(item.unitPrice)} $</div>
      {Number(item.originalUnitPrice || 0) > Number(item.unitPrice || 0) && (
        <div className="text-[11px] font-bold text-gray-400 line-through">
          {formatNumber(item.originalUnitPrice)} $
        </div>
      )}
      {item.pricingSource && (
        <div className="text-[10px] font-bold text-blue-500 mt-0.5">{item.pricingSource}</div>
      )}
      {Number(item.promotionDiscountAmount || 0) > 0 && (
        <div className="mt-1 text-[11px] font-bold text-amber-700">
          توفير {formatNumber(item.promotionDiscountAmount)} $
        </div>
      )}
    </div>
  );

  const renderTextileMeta = (item: any) => {
    const backendTextileFlag = Boolean((item as any)?.is_textile);
    const effectiveIsTextile = Boolean(item?.isTextile || backendTextileFlag);
    if (effectiveIsTextile) {
      console.log('TEXTILE ITEM:', (item as any)?.is_textile, item);
    }
    if (effectiveIsTextile && !item?.isTextile) {
      console.error('TEXTILE UI NOT ACTIVATED');
    }
    if (!effectiveIsTextile) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
        {item.textileColorName && (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">لون: {item.textileColorName}</span>
        )}
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">رولات: {formatNumber(item.textileRollCount || 0)}</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
          طول: {formatNumber(item.textileTotalLength || item.quantity || 0)} {item.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
        </span>
        {Array.isArray(item.textileDecompositionPayload) && item.textileDecompositionPayload.length > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
            تفكيك: {item.textileDecompositionPayload.map((row: any) => `${row.sequence}:${formatNumber(row.lengthValue || 0)}`).join(' | ')}
          </span>
        )}
      </div>
    );
  };

  // Totals
  const totals = cart.reduce((acc: any, item: any) => {
    acc.qty += Number(item.quantity || 0);
    acc.total += Number(item.total || 0);
    acc.commission += calcCommission(item);
    acc.discount += Number(item.promotionDiscountAmount || 0);
    return acc;
  }, { qty: 0, total: 0, commission: 0, discount: 0 });

  const columns: any[] = [
    {
      id: 'itemName',
      header: 'المادة',
      cell: (item: any) => (
        <div>
          <div className="font-bold text-gray-800">{item.itemName}</div>
          {renderTextileMeta(item)}
          {item.promotionName && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              <Tag size={12} />
              {item.promotionName}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'unitName',
      header: 'الوحدة',
      cell: (item: any) => (
        <span className="text-lg font-bold text-blue-700 font-numeric">{item.unitName || 'قطعة'}</span>
      ),
      tdClassName: 'text-center',
    },
    {
      id: 'quantity',
      header: 'الكمية',
      cell: (item: any) => (
        <div className="text-center">
          <div className="text-lg font-bold text-blue-700 font-numeric">{item.quantity || 0}</div>
          {item?.isTextile && (
            <div className="text-[11px] font-bold text-gray-500">{formatNumber(item.textileRollCount || 0)} رول</div>
          )}
        </div>
      ),
      tdClassName: 'text-center',
    },
    {
      id: 'unitPrice',
      header: 'السعر',
      cell: renderPriceBlock,
      tdClassName: 'text-center',
    },
  ];

  if (showCostColumn) {
    columns.push({
      id: 'costPrice',
      header: 'سعر التكلفة',
      cell: (item: any) => (
        <span className="font-numeric text-gray-700">
          {formatNumber((Number(item.unitPrice) || 0) + extraPerUnit)} $
        </span>
      ),
      tdClassName: 'text-center',
    });
  }

  if (showLastPurchase) {
    columns.push({
      id: 'lastPurchasePrice',
      header: 'آخر شراء',
      cell: (item: any) => (
        <span className="font-numeric text-gray-500 text-sm">
          {item.lastPurchasePrice ? `${formatNumber(item.lastPurchasePrice)} $` : '—'}
        </span>
      ),
      tdClassName: 'text-center',
    });
  }

  if (showAvailableQty) {
    columns.push({
      id: 'availableQty',
      header: 'المتاح',
      cell: (item: any) => (
        <span className={`font-numeric text-sm font-bold ${Number(item.availableQty || 0) <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
          {item.availableQty != null ? formatNumber(item.availableQty) : '—'}
        </span>
      ),
      tdClassName: 'text-center',
    });
  }

  if (showCommission && invoiceType === 'sale') {
    columns.push({
      id: 'commission',
      header: 'العمولة',
      cell: (item: any, idx: number) => (
        <div className="flex items-center gap-1 justify-center min-w-[140px]">
          <select value={item.commissionType || 'NONE'}
            onChange={e => updateCartItem(idx, { commissionType: e.target.value })}
            className="rounded border border-gray-200 px-1 py-1 text-[11px] font-bold outline-none focus:border-primary w-16">
            {COMMISSION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {(item.commissionType && item.commissionType !== 'NONE') && (
            <input type="number" step="0.01" min="0"
              value={item.commissionValue || ''}
              onChange={e => updateCartItem(idx, { commissionValue: e.target.value })}
              className="w-16 rounded border border-gray-200 px-1 py-1 text-center text-xs font-bold font-numeric outline-none focus:border-primary" />
          )}
          {calcCommission(item) > 0 && (
            <span className="text-[10px] font-bold text-emerald-600">{formatNumber(calcCommission(item))}</span>
          )}
        </div>
      ),
      tdClassName: 'text-center',
    });
  }

  columns.push(
    {
      id: 'serials',
      header: 'السيريالات',
      cell: (item: any) => (
        <span className="text-xs font-bold text-gray-600">
          {Array.isArray(item.serialNumbers) && item.serialNumbers.length > 0
            ? `${item.serialNumbers.length} سيريال`
            : '—'}
        </span>
      ),
      tdClassName: 'text-center',
    },
    {
      id: 'total',
      header: 'المجموع',
      cell: (item: any) => (
        <span className="text-lg font-bold text-green-700 font-numeric">{formatNumber(item.total)}</span>
      ),
      tdClassName: 'text-center bg-green-50/30',
    },
    {
      id: 'actions',
      header: '',
      cell: (_item: any, idx: number) => (
        <div className="text-center">
          <button
            onClick={() => removeRow(idx)}
            className="min-h-[40px] min-w-[40px] rounded-lg p-2 text-red-500 transition hover:bg-red-50 tap-feedback"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
      tdClassName: 'text-center',
      hideOnMobile: true,
    },
  );

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow">
      {/* Optional column toggles */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50/50 flex-wrap">
        <span className="text-[11px] font-bold text-gray-400">أعمدة:</span>
        {invoiceType === 'sale' && (
          <ColToggle label="العمولة" active={showCommission} onClick={() => setShowCommission(p => !p)} />
        )}
        <ColToggle label="آخر شراء" active={showLastPurchase} onClick={() => setShowLastPurchase(p => !p)} />
        <ColToggle label="الرصيد المتاح" active={showAvailableQty} onClick={() => setShowAvailableQty(p => !p)} />
      </div>

      <AdaptiveTable
        rows={cart}
        keyExtractor={(_, idx) => `invoice-cart-${idx}`}
        emptyState={
          <div className="p-12 text-center text-gray-400 font-bold">
            <ShoppingBag size={48} className="mx-auto mb-4 opacity-20" />
            السلة فارغة
          </div>
        }
        columns={columns}
        mobileCardRender={(item: any, idx: number) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-gray-800">{item.itemName}</div>
                {renderTextileMeta(item)}
                <div className="mt-1 text-xs font-bold text-blue-700">{item.unitName || 'قطعة'}</div>
                {item.pricingSource && <div className="text-[10px] font-bold text-blue-500 mt-0.5">{item.pricingSource}</div>}
                {item.promotionName && (
                  <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                    <Tag size={12} />
                    {item.promotionName}
                  </div>
                )}
              </div>
              <button
                onClick={() => removeRow(idx)}
                className="min-h-[40px] min-w-[40px] rounded-lg p-2 text-red-500 transition hover:bg-red-50 tap-feedback"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-gray-50 p-3">
                <div className="text-[11px] font-bold text-gray-500">الكمية</div>
                <div className="mt-1 font-black text-blue-700 font-numeric">{item.quantity || 0}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <div className="text-[11px] font-bold text-gray-500">السعر</div>
                <div className="mt-1">{renderPriceBlock(item)}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <div className="text-[11px] font-bold text-gray-500">السيريالات</div>
                <div className="mt-1 font-black text-gray-700">
                  {Array.isArray(item.serialNumbers) && item.serialNumbers.length > 0
                    ? `${item.serialNumbers.length} سيريال`
                    : '—'}
                </div>
              </div>
              <div className="rounded-xl bg-green-50 p-3">
                <div className="text-[11px] font-bold text-green-700">المجموع</div>
                <div className="mt-1 text-lg font-black text-green-700 font-numeric">
                  {formatNumber(item.total)}
                </div>
              </div>
            </div>
          </div>
        )}
        desktopWrapperClassName="overflow-x-auto"
        tableClassName="min-w-full divide-y divide-gray-200"
        rowClassName={() => 'border-b hover:bg-gray-50'}
      />

      {/* Per-column totals strip */}
      {cart.length > 0 && (
        <div className="border-t bg-gray-50 px-4 py-2 flex items-center gap-6 flex-wrap text-xs font-black">
          <div className="text-gray-500">الإجمالي:</div>
          <div className="text-blue-700">الكمية: <span className="font-numeric">{formatNumber(totals.qty)}</span></div>
          <div className="text-green-700">المجموع: <span className="font-numeric">{formatNumber(totals.total)} $</span></div>
          {totals.discount > 0 && (
            <div className="text-amber-700">الخصم: <span className="font-numeric">{formatNumber(totals.discount)} $</span></div>
          )}
          {showCommission && totals.commission > 0 && (
            <div className="text-emerald-600">العمولة: <span className="font-numeric">{formatNumber(totals.commission)} $</span></div>
          )}
        </div>
      )}

      {showCostColumn && (
        <div className="border-t bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
          تم احتساب متوسط المصاريف الإضافية على الشراء بقيمة {formatNumber(extraPerUnit)} $ لكل وحدة.
        </div>
      )}
      {invoiceType === 'purchase' && totalExpenses > 0 && (
        <div className="border-t bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">
          إجمالي المصاريف الإضافية الموزعة: {formatNumber(totalExpenses)} $
        </div>
      )}
    </div>
  );
};

export default InvoiceCartTable;
