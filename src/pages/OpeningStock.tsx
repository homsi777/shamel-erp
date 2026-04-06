import React, { useEffect, useMemo, useState } from 'react';
import StockHeader from '../components/opening/StockHeader';
import StockLinesTable from '../components/opening/StockLinesTable';
import StockSummaryBar from '../components/opening/StockSummaryBar';
import { useOpeningStock } from '../hooks/useOpeningStock';
import { getOpeningStock, getItems, getWarehouses } from '../lib/api';
import { InventoryItem, Warehouse } from '../types';

const OpeningStock: React.FC = () => {
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');
  const [records, setRecords] = useState<any[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  
  // Real data from API
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Format items for dropdown
  const itemsForDropdown = useMemo(() => {
    return items.map((item: any) => ({
      id: item.id,
      name: item.name || 'بدون اسم',
      code: item.code || '',
      unit: item.unitName || item.unit || 'وحدة'
    }));
  }, [items]);

  // Format warehouses for dropdown
  const warehousesForDropdown = useMemo(() => {
    return warehouses.map((wh: any) => ({
      id: wh.id,
      name: wh.name || 'بدون اسم'
    }));
  }, [warehouses]);

  // Load real data on mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingData(true);
      try {
        const [itemsData, warehousesData] = await Promise.all([
          getItems(),
          getWarehouses()
        ]);
        setItems(Array.isArray(itemsData) ? itemsData : []);
        setWarehouses(Array.isArray(warehousesData) ? warehousesData : []);
      } catch (e) {
        console.error('Failed to load data:', e);
        setItems([]);
        setWarehouses([]);
      } finally {
        setIsLoadingData(false);
      }
    };
    loadData();
  }, []);

  const {
    lines,
    fiscalYear,
    warehouseId,
    currency,
    date,
    setFiscalYear,
    setWarehouseId,
    setCurrency,
    setDate,
    addLine,
    removeLine,
    duplicateLine,
    updateLine,
    summary,
    handleConfirm,
    isPosting
  } = useOpeningStock({ items: itemsForDropdown });

  type StockDraft = {
    id: string;
    fiscalYear: string;
    date: string;
    totalItems: number;
    totalQuantity: number;
    totalByUSD: number;
    totalBySYP: number;
    totalByTRY: number;
    warehouseId?: string;
    currency?: string;
    totalsByCurrency?: { USD: number; SYP: number; TRY: number };
    currenciesUsed?: Array<'USD' | 'SYP' | 'TRY'>;
  };
  const [drafts, setDrafts] = useState<StockDraft[]>([]);
  const [filterYear, setFilterYear] = useState('all');
  const [filterCurrency, setFilterCurrency] = useState<'all' | 'USD' | 'SYP' | 'TRY'>('all');
  const [filterWarehouse, setFilterWarehouse] = useState('all');

  const resolveYear = (value?: string) => {
    if (!value) return '';
    const m1 = value.match(/OSN-(\d{4})/);
    if (m1) return m1[1];
    const m2 = value.match(/سنة\s*(\d{4})/);
    if (m2) return m2[1];
    const m3 = value.match(/(\d{4})/);
    return m3 ? m3[1] : '';
  };

  const combinedRecords = useMemo(() => {
    const posted = (records || []).map((record: any) => ({
      id: record.id,
      kind: 'posted',
      status: 'مرحّل',
      invoiceNumber: record.invoiceNumber || '—',
      date: record.date || '—',
      year: resolveYear(record.invoiceNumber || record.note || record.date),
      warehouseId: String(record.warehouseId || ''),
      currency: record.currency || 'USD',
      totalLabel: `${Number(record.totalAmount || 0).toFixed(2)} ${record.currency || ''}`
    }));
    const draftList = (drafts || []).map((draft: any) => {
      const totals = draft.totalsByCurrency || { USD: 0, SYP: 0, TRY: 0 };
      const parts: string[] = [];
      if (totals.USD) parts.push(`USD: ${Number(totals.USD).toFixed(2)}`);
      if (totals.SYP) parts.push(`SYP: ${Number(totals.SYP).toFixed(2)}`);
      if (totals.TRY) parts.push(`TRY: ${Number(totals.TRY).toFixed(2)}`);
      const usedCurrencies = (draft.currenciesUsed || []) as Array<'USD' | 'SYP' | 'TRY'>;
      const used = usedCurrencies.length;
      const currencyLabel = used === 1 ? usedCurrencies[0] : (used > 1 ? 'متعدد' : '—');
      return {
        id: draft.id,
        kind: 'draft',
        status: 'مسودة',
        invoiceNumber: draft.entryNumber || draft.id || '—',
        date: draft.date || '—',
        year: String(draft.fiscalYear || ''),
        warehouseId: String(draft.warehouseId || ''),
        currency: currencyLabel,
        totalLabel: parts.length ? parts.join(' | ') : '—',
        totalsByCurrency: totals
      };
    });
    return [...posted, ...draftList].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  }, [records, drafts]);

  const filteredRecords = useMemo(() => {
    return combinedRecords.filter((rec: any) => {
      if (filterYear !== 'all' && rec.year !== filterYear) return false;
      if (filterWarehouse !== 'all') {
        if (String(rec.warehouseId || '') !== String(filterWarehouse)) return false;
      }
      if (filterCurrency !== 'all') {
        if (rec.kind === 'posted') {
          if (String(rec.currency || '') !== filterCurrency) return false;
        } else {
          const totals: { USD: number; SYP: number; TRY: number } = rec.totalsByCurrency || { USD: 0, SYP: 0, TRY: 0 };
          if (Number(totals[filterCurrency] || 0) === 0) return false;
        }
      }
      return true;
    });
  }, [combinedRecords, filterYear, filterCurrency, filterWarehouse]);
  
  const availableYears = useMemo(() => {
    return Array.from(new Set(combinedRecords.map((r: any) => r.year).filter(Boolean))).sort();
  }, [combinedRecords]);

  const hasAnyItem = useMemo(() => lines.some((l) => l.item_id), [lines]);

  const handleSaveDraft = () => {
    setIsSaving(true);
    window.setTimeout(() => {
      setDrafts((prev) => [
        {
          id: `draft-${Date.now()}`,
          fiscalYear,
          date,
          totalItems: summary.totalItems,
          totalQuantity: summary.totalQuantity,
          totalByUSD: summary.totalByUSD,
          totalBySYP: summary.totalBySYP,
          totalByTRY: summary.totalByTRY,
          warehouseId: warehouseId ? String(warehouseId) : '',
          currency: currency,
          totalsByCurrency: { USD: summary.totalByUSD, SYP: summary.totalBySYP, TRY: summary.totalByTRY },
          currenciesUsed: (['USD', 'SYP', 'TRY'] as Array<'USD' | 'SYP' | 'TRY'>).filter((c) => (c === 'USD' ? summary.totalByUSD : c === 'SYP' ? summary.totalBySYP : summary.totalByTRY) > 0)
        },
        ...prev
      ]);
      setIsSaving(false);
      window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message: 'تم حفظ المسودة محلياً.' } }));
    }, 600);
  };

  const handlePreview = () => {
    setIsPreviewing(true);
    window.setTimeout(() => {
      setIsPreviewing(false);
      window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message: 'معاينة أول المدة جاهزة للعرض.' } }));
    }, 500);
  };

  const handleConfirmClick = () => {
    handleConfirm();
  };

  const handleReset = () => {
    window.location.reload();
  };

  useEffect(() => {
    if (activeTab !== 'records') return;
    let mounted = true;
    const loadRecords = async () => {
      setIsLoadingRecords(true);
      try {
        const data = await getOpeningStock();
        if (mounted) setRecords(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setRecords([]);
      } finally {
        if (mounted) setIsLoadingRecords(false);
      }
    };
    loadRecords();
    return () => { mounted = false; };
  }, [activeTab]);

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto space-y-5">
      <div className="bg-white border rounded-2xl p-5 md:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-gray-800">مواد أول المدة</h1>
            <p className="text-sm text-gray-500 mt-1">ربط كامل بالـ Backend</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('entry')}
              className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'entry' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              الإدخال
            </button>
            <button
              onClick={() => setActiveTab('records')}
              className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'records' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              السجلات
            </button>
          </div>
          {activeTab === 'entry' && (
            <button
              onClick={addLine}
              className="bg-primary text-white px-4 py-2 rounded-xl font-bold shadow hover:opacity-90"
            >
              + إضافة سطر
            </button>
          )}
        </div>
      </div>

      {activeTab === 'entry' ? (
        <>
          <StockHeader
            fiscalYear={fiscalYear}
            warehouseId={warehouseId}
            currency={currency}
            date={date}
            onChange={(next) => {
              if (next.fiscalYear !== undefined) setFiscalYear(next.fiscalYear);
              if (next.warehouseId !== undefined) setWarehouseId(next.warehouseId);
              if (next.currency !== undefined) setCurrency(next.currency);
              if (next.date !== undefined) setDate(next.date);
            }}
            warehouses={warehousesForDropdown}
          />

          <StockLinesTable
            lines={lines}
            items={itemsForDropdown}
            warehouses={warehousesForDropdown}
            onAddLine={addLine}
            onRemoveLine={removeLine}
            onDuplicateLine={duplicateLine}
            onUpdateLine={updateLine}
          />

          <StockSummaryBar
            totalItems={summary.totalItems}
            totalQuantity={summary.totalQuantity}
            totalByUSD={summary.totalByUSD}
            totalBySYP={summary.totalBySYP}
            totalByTRY={summary.totalByTRY}
          />

          <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5 flex flex-wrap items-center gap-3">
            <button
              onClick={handleReset}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl font-bold border hover:bg-gray-200"
            >
              مسح
            </button>
            <button
              onClick={handlePreview}
              disabled={isPreviewing}
              className={`px-4 py-2 rounded-xl font-bold border ${isPreviewing ? 'bg-gray-200 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {isPreviewing ? 'جاري المعاينة...' : 'معاينة'}
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={isSaving}
              className={`px-4 py-2 rounded-xl font-bold ${isSaving ? 'bg-gray-300 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'}`}
            >
              {isSaving ? 'جاري الحفظ...' : 'حفظ مسودة'}
            </button>
            <button
              onClick={handleConfirmClick}
              disabled={!hasAnyItem || isPosting}
              className={`px-4 py-2 rounded-xl font-bold ${hasAnyItem && !isPosting ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              {isPosting ? 'جاري الترحيل...' : 'تأكيد ✓'}
            </button>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between mb-4">
            <div>
              <h2 className="text-lg font-black text-gray-800">سجلات مواد أول المدة</h2>
              <p className="text-xs text-gray-500">فلترة حسب السنة والعملة والمخزن</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">السنة المالية</label>
                <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="w-full border rounded-xl p-2 text-sm font-bold bg-white">
                  <option value="all">كل السنوات</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">العملة</label>
                <select value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value as any)} className="w-full border rounded-xl p-2 text-sm font-bold bg-white">
                  <option value="all">كل العملات</option>
                  <option value="USD">USD</option>
                  <option value="SYP">SYP</option>
                  <option value="TRY">TRY</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">المخزن</label>
                <select value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)} className="w-full border rounded-xl p-2 text-sm font-bold bg-white">
                  <option value="all">كل المخازن</option>
                  {warehousesForDropdown.map((wh: any) => (
                    <option key={wh.id} value={String(wh.id)}>{wh.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {isLoadingRecords ? (
            <div className="border border-dashed rounded-xl p-6 text-center text-gray-400 font-bold">
              جاري تحميل السجلات...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="border border-dashed rounded-xl p-6 text-center text-gray-400 font-bold">
              لا توجد سجلات بعد
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 text-gray-500 font-black uppercase tracking-widest border-b">
                  <tr>
                    <th className="px-4 py-3">السنة</th>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">المخزن</th>
                    <th className="px-4 py-3">العملة</th>
                    <th className="px-4 py-3">الإجمالي</th>
                    <th className="px-4 py-3">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRecords.map((record: any) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-bold">{record.year || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{record.date || '—'}</td>
                      <td className="px-4 py-3">{record.warehouseId || '—'}</td>
                      <td className="px-4 py-3">{record.currency || '—'}</td>
                      <td className="px-4 py-3 font-bold">{record.totalLabel || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${record.kind === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {record.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OpeningStock;

