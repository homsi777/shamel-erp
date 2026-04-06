import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Invoice, formatNumber, formatDate } from '../../types';
import { apiRequest } from '../../lib/api';
import { confirmDialog } from '../../lib/confirm';
import { SmartLink } from '../smart';
import { AdaptiveTable } from '../responsive';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';
import InvoiceRowActions from './InvoiceRowActions';
import {
  BASE_CURRENCY,
  invoiceAmountBase,
  invoiceAmountTransaction,
  invoiceCurrencyCode,
  lineTotalTransaction,
  lineUnitTransaction,
} from '../../lib/currencySemantics';

interface InvoiceHistoryProps {
  invoices: Invoice[];
  setViewInvoice: (inv: Invoice) => void;
  setPrintInvoice: (inv: Invoice) => void;
  setExportInvoice?: (inv: Invoice) => void;
  onRefresh?: () => Promise<void>;
  onDelete?: (inv: Invoice) => Promise<void>;
}

const InvoiceHistory: React.FC<InvoiceHistoryProps> = ({ invoices, setViewInvoice, setPrintInvoice, setExportInvoice, onRefresh, onDelete }) => {
  const layout = useResponsiveLayout();
  const [historyFilter, setHistoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'LOCKED'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'sale' | 'pos' | 'purchase' | 'return' | 'exchange'>('all');
  const [payFilter, setPayFilter] = useState<'all' | 'cash' | 'credit'>('all');
  const [statusOverrides, setStatusOverrides] = useState<Record<string, 'ACTIVE' | 'LOCKED'>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const normalizeInvoiceItems = (items: unknown): any[] => {
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const handleDelete = async (inv: Invoice) => {
    if (!(await confirmDialog('حذف الفاتورة سيؤدي إلى عكس الرصيد والمخزون المرتبط بها. هل أنت متأكد؟'))) return;
    try {
      if (onDelete) await onDelete(inv);
      else {
        await apiRequest(`invoices/${inv.id}`, { method: 'DELETE' });
        if (onRefresh) await onRefresh();
      }
    } catch {
      alert('فشل حذف الفاتورة');
    }
  };

  const isPosInvoice = (inv: Invoice) => {
    const num = Number(inv.invoiceNumber);
    return (!Number.isNaN(num) && num >= 100000 && num <= 999999) || (inv.invoiceNumber || '').startsWith('POS');
  };

  const filteredInvoices = useMemo(() => {
    const safeFilter = (historyFilter || '').toLowerCase();
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59);

    return (invoices || []).filter((inv) => {
      const invoiceNo = (inv?.invoiceNumber || '').toLowerCase();
      const id = (inv?.id || '').toLowerCase();
      const clientName = (inv?.clientName || '').toLowerCase();
      const inSearch = invoiceNo.includes(safeFilter) || id.includes(safeFilter) || clientName.includes(safeFilter);
      const d = new Date(inv.date);
      const inDate = d >= from && d <= to;
      const status = statusOverrides[inv.id] || (inv.type === 'purchase' ? (Number((inv as any).applyStock ?? 1) === 1 ? 'ACTIVE' : 'LOCKED') : undefined);
      const inStatus = statusFilter === 'all' ? true : status === statusFilter;

      let inType = true;
      if (typeFilter === 'sale') inType = inv.type === 'sale' && !isPosInvoice(inv);
      else if (typeFilter === 'pos') inType = inv.type === 'sale' && isPosInvoice(inv);
      else if (typeFilter === 'purchase') inType = inv.type === 'purchase';
      else if (typeFilter === 'return') inType = inv.type === 'return';
      else if (typeFilter === 'exchange') inType = inv.type === 'exchange';

      const inPay = payFilter === 'all' ? true : inv.paymentType === payFilter;
      return inSearch && inDate && inStatus && inType && inPay;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, historyFilter, dateFrom, dateTo, statusFilter, statusOverrides, typeFilter, payFilter]);

  const getStockStatus = (inv: Invoice) => statusOverrides[inv.id] || (Number((inv as any).applyStock ?? 1) === 1 ? 'ACTIVE' : 'LOCKED');

  const renderTypeBadge = (inv: Invoice) => (
    <span className={`px-2 py-1 rounded-full text-[10px] font-black ${
      inv.type === 'sale' ? 'bg-green-50 text-green-700 border border-green-200' :
      inv.type === 'purchase' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
      inv.type === 'return' && inv.returnType === 'purchase' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
      inv.type === 'return' ? 'bg-red-50 text-red-700 border border-red-200' :
      inv.type === 'exchange' && inv.returnType === 'purchase' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
      inv.type === 'exchange' ? 'bg-sky-50 text-sky-700 border border-sky-200' :
      'bg-gray-50 text-gray-600 border border-gray-200'
    }`}>
      {inv.type === 'sale' ? 'بيع' : inv.type === 'purchase' ? 'شراء' : inv.type === 'return' ? (inv.returnType === 'purchase' ? 'مرتجع مشتريات' : 'مرتجع مبيعات') : inv.type === 'exchange' ? (inv.returnType === 'purchase' ? 'تبديل مشتريات' : 'تبديل مبيعات') : inv.type}
    </span>
  );

  const renderStatusBadge = (inv: Invoice) => {
    if (inv.type !== 'purchase') {
      return <span className="px-3 py-1 rounded-full text-[11px] font-black bg-gray-50 text-gray-500 border border-gray-200">—</span>;
    }

    const status = getStockStatus(inv);
    return (
      <span className={`px-3 py-1 rounded-full text-[11px] font-black ${status === 'ACTIVE' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
        {status === 'ACTIVE' ? 'مفعّل' : 'مقفول'}
      </span>
    );
  };

  const handleToggleStock = async (inv: Invoice) => {
    const isActive = getStockStatus(inv) === 'ACTIVE';
    const nextAction = isActive ? 'lock' : 'activate';
    const reason = window.prompt(`أدخل سبب ${isActive ? 'قفل' : 'تفعيل'} الفاتورة (اختياري):`, '') || '';
    try {
      await apiRequest(`invoices/${inv.id}/stock-toggle`, { method: 'POST', body: JSON.stringify({ action: nextAction, reason }) });
      setStatusOverrides((prev) => ({ ...prev, [inv.id]: nextAction === 'activate' ? 'ACTIVE' : 'LOCKED' }));
      if (onRefresh) await onRefresh();
    } catch {
      alert('فشلت العملية');
    }
  };

  const toggleExpanded = (invoiceId: string) => {
    setExpanded((prev) => ({ ...prev, [invoiceId]: !prev[invoiceId] }));
  };

  const renderInvoiceActions = (inv: Invoice, mode: 'buttons' | 'menu' = 'buttons') => (
    <InvoiceRowActions
      mode={mode}
      showPdf={Boolean(setExportInvoice)}
      showItemsToggle={normalizeInvoiceItems(inv.items).length > 0}
      itemsExpanded={Boolean(expanded[inv.id])}
      showStockToggle={inv.type === 'purchase'}
      stockActive={getStockStatus(inv) === 'ACTIVE'}
      onView={() => setViewInvoice(inv)}
      onPrint={() => setPrintInvoice(inv)}
      onPdf={setExportInvoice ? () => setExportInvoice(inv) : undefined}
      onDelete={() => handleDelete(inv)}
      onToggleItems={() => toggleExpanded(inv.id)}
      onToggleStock={() => handleToggleStock(inv)}
    />
  );

  return (
    <div className="bg-white rounded-xl shadow p-4 md:p-6 animate-fadeIn">
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-2.5 text-gray-400" size={20} />
            <input type="text" placeholder="بحث في الأرشيف..." className="w-full border rounded-lg pr-10 pl-4 py-2 font-numeric" value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:w-auto">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded-lg p-2 font-numeric text-sm" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded-lg p-2 font-numeric text-sm" />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-500 font-bold">نوع الفاتورة:</span>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className="border rounded-lg px-3 py-1.5 text-sm font-bold bg-white">
              <option value="all">الكل</option>
              <option value="sale">فواتير البيع</option>
              <option value="pos">نقطة البيع</option>
              <option value="purchase">فواتير الشراء</option>
              <option value="return">المرتجعات</option>
              <option value="exchange">التبديل</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-500 font-bold">طريقة الدفع:</span>
            <select value={payFilter} onChange={e => setPayFilter(e.target.value as any)} className="border rounded-lg px-3 py-1.5 text-sm font-bold bg-white">
              <option value="all">الكل</option>
              <option value="cash">نقدي</option>
              <option value="credit">آجل</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-500 font-bold">الحالة:</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="border rounded-lg px-3 py-1.5 text-sm font-bold bg-white">
              <option value="all">كل الحالات</option>
              <option value="ACTIVE">مفعّل</option>
              <option value="LOCKED">مقفول</option>
            </select>
          </div>
          <span className="text-xs text-gray-400 font-bold lg:mr-auto">{filteredInvoices.length} فاتورة</span>
        </div>
      </div>

      <AdaptiveTable
        rows={filteredInvoices}
        keyExtractor={(inv) => inv.id}
        emptyState={<div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400 font-bold">لا توجد فواتير مطابقة</div>}
        enableStickyActions
        tabletColumnVisibility={
          layout.isTabletPortrait
            ? ['invoiceNumber', 'clientName', 'total', 'status', 'actions']
            : ['invoiceNumber', 'clientName', 'total', 'date', 'status', 'actions']
        }
        columns={[
          {
            id: 'invoiceNumber',
            header: 'رقم الفاتورة',
            cell: (inv) => (
              <SmartLink type="invoice" id={inv.id} inheritStyle tooltip="انقر لعرض تفاصيل الفاتورة">
                <span className="font-bold text-blue-700 font-numeric text-lg">{inv.invoiceNumber || inv.id.slice(-6)}</span>
              </SmartLink>
            ),
          },
          {
            id: 'clientName',
            header: 'العميل',
            cell: (inv) => <span className="font-semibold leading-5">{inv.clientName || 'غير محدد'}</span>,
          },
          {
            id: 'type',
            header: 'النوع',
            cell: (inv) => <div className="text-center">{renderTypeBadge(inv)}</div>,
            tdClassName: 'text-center',
          },
          {
            id: 'total',
            header: 'الإجمالي',
            cell: (inv) => (
              <div className="text-center font-bold font-numeric">
                {formatNumber(invoiceAmountTransaction(inv, 'total'))} <span className="text-[10px] text-gray-500">{invoiceCurrencyCode(inv)}</span>
                {invoiceCurrencyCode(inv) !== BASE_CURRENCY ? (
                  <div className="text-[10px] text-gray-400 font-normal">{formatNumber(invoiceAmountBase(inv, 'total'))} {BASE_CURRENCY}</div>
                ) : null}
              </div>
            ),
            tdClassName: 'text-center',
          },
          {
            id: 'date',
            header: 'التاريخ',
            cell: (inv) => <div className="text-center font-numeric text-gray-600">{formatDate(inv.date)}</div>,
            tdClassName: 'text-center',
          },
          {
            id: 'status',
            header: 'الحالة',
            cell: (inv) => <div className="text-center">{renderStatusBadge(inv)}</div>,
            tdClassName: 'text-center',
          },
          {
            id: 'actions',
            header: 'خيارات',
            cell: (inv) => renderInvoiceActions(inv, layout.isTablet ? 'menu' : 'buttons'),
            tdClassName: 'text-center',
          },
        ]}
        rowClassName={(_, index) => `${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b hover:bg-gray-50`}
        mobileCardRender={(inv) => {
          const items = normalizeInvoiceItems(inv.items);
          return (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SmartLink type="invoice" id={inv.id} inheritStyle tooltip="عرض الفاتورة">
                    <div className="font-bold text-blue-700 font-numeric text-lg">{inv.invoiceNumber || inv.id.slice(-6)}</div>
                  </SmartLink>
                  <div className="text-sm font-bold text-gray-800 mt-1">{inv.clientName || 'غير محدد'}</div>
                  <div className="text-[11px] text-gray-500 font-numeric mt-1">{formatDate(inv.date)}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {renderTypeBadge(inv)}
                  {renderStatusBadge(inv)}
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 p-3">
                <div className="text-[11px] text-gray-500 font-bold">الإجمالي</div>
                <div className="mt-1 font-black font-numeric text-primary">
                  {formatNumber(invoiceAmountTransaction(inv, 'total'))} {invoiceCurrencyCode(inv)}
                </div>
                {invoiceCurrencyCode(inv) !== BASE_CURRENCY ? (
                  <div className="text-[11px] text-gray-500 font-numeric mt-1">
                    {formatNumber(invoiceAmountBase(inv, 'total'))} {BASE_CURRENCY}
                  </div>
                ) : null}
              </div>

              {renderInvoiceActions(inv, 'buttons')}

              {items.length > 0 && expanded[inv.id] ? (
                <div className="grid grid-cols-1 gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                  {items.map((item, index) => (
                    <div key={`${inv.id}-line-${index}`} className="rounded-xl bg-white p-3 border border-gray-100">
                      <div className="font-bold text-gray-800">{item.fabricName || item.itemName || item.itemId}</div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <div className="text-gray-500">الكمية</div>
                          <div className="font-black font-numeric">{formatNumber(Number(item.quantity || 0))}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">السعر</div>
                          <div className="font-black font-numeric">{formatNumber(lineUnitTransaction(item, inv))} {invoiceCurrencyCode(inv)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">الإجمالي</div>
                          <div className="font-black font-numeric text-primary">{formatNumber(lineTotalTransaction(item, inv))} {invoiceCurrencyCode(inv)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }}
      />
    </div>
  );
};

export default InvoiceHistory;

