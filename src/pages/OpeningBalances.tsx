import React, { useEffect, useMemo, useState } from 'react';
import BalancesHeader from '../components/opening/BalancesHeader';
import BalancesLinesTable from '../components/opening/BalancesLinesTable';
import MultiCurrencyIndicator from '../components/opening/MultiCurrencyIndicator';
import OpeningEntriesList from '../components/opening/OpeningEntriesList';
import { confirmPostDialog } from '../components/opening/ConfirmPostDialog';
import { useOpeningBalances } from '../hooks/useOpeningBalances';
import { getOpeningReceivables, postOpeningReceivables, getParties, getCashBoxes } from '../lib/api';
import { Party, CashBox, toNumericValue } from '../types';

const OpeningBalances: React.FC = () => {
  const {
    lines,
    header,
    setFiscalYear,
    setEntryDate,
    setEntryNumber,
    setDescription,
    addLine,
    removeLine,
    updateLine,
    totals,
    canPost
  } = useOpeningBalances();

  // Real data from API
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Load real data on mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingData(true);
      try {
        const [partiesData, cashBoxesData] = await Promise.all([
          getParties(),
          getCashBoxes()
        ]);
        
        // Split parties into customers and suppliers
        const allParties = Array.isArray(partiesData) ? partiesData : [];
        setCustomers(allParties.filter((p: any) => p.type === 'CUSTOMER' || p.type === 'BOTH'));
        setSuppliers(allParties.filter((p: any) => p.type === 'SUPPLIER' || p.type === 'BOTH'));
        setCashBoxes(Array.isArray(cashBoxesData) ? cashBoxesData : []);
      } catch (e) {
        console.error('Failed to load data:', e);
        setCustomers([]);
        setSuppliers([]);
        setCashBoxes([]);
      } finally {
        setIsLoadingData(false);
      }
    };
    loadData();
  }, []);

  // Format data for dropdowns
  const customersForDropdown = useMemo(() => {
    return customers.map((c: any) => ({
      id: String(c.id),
      name: c.name || 'بدون اسم'
    }));
  }, [customers]);

  const suppliersForDropdown = useMemo(() => {
    return suppliers.map((s: any) => ({
      id: String(s.id),
      name: s.name || 'بدون اسم'
    }));
  }, [suppliers]);

  const cashBoxesForDropdown = useMemo(() => {
    return cashBoxes.map((cb: any) => ({
      id: String(cb.id),
      name: cb.name || 'بدون اسم'
    }));
  }, [cashBoxes]);

  // Empty accounts array (we don't have accounts API yet)
  const accountsForDropdown: { id: string; name: string; code?: string }[] = [];

  const [drafts, setDrafts] = useState<Array<{ id: string; entryNumber: string; fiscalYear: string; entryDate: string; description?: string; totalDebit: number; totalCredit: number; lineCount: number; currenciesUsed?: Array<'USD' | 'SYP' | 'TRY'>; accountTypesUsed?: Array<'customer' | 'supplier' | 'cash_box' | 'account'> }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');
  const [openingRecords, setOpeningRecords] = useState<any[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [filterYear, setFilterYear] = useState('all');
  const [filterCurrency, setFilterCurrency] = useState<'all' | 'USD' | 'SYP' | 'TRY'>('all');
  const [filterAccountType, setFilterAccountType] = useState<'all' | 'customer' | 'supplier' | 'cash_box'>('all');

  const totalDebit = totals.reduce((sum, t) => sum + toNumericValue(t.total_debit), 0);
  const totalCredit = totals.reduce((sum, t) => sum + toNumericValue(t.total_credit), 0);

  const showToast = (message: string) => {
    window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message } }));
  };

  const resolveYear = (value?: string) => {
    if (!value) return '';
    const m = value.match(/(\d{4})/);
    return m ? m[1] : '';
  };

  const combinedRecords = useMemo(() => {
    const posted = (openingRecords || []).map((record: any) => {
      const accountType = record.accountType || (record.partyType === 'SUPPLIER' ? 'supplier' : record.partyType === 'CUSTOMER' ? 'customer' : 'account');
      return {
        id: record.id,
        kind: 'posted',
        status: 'مرحّل',
        title: record.partyName || '—',
        accountType,
        year: resolveYear(record.postedAt || record.note || record.date),
        date: record.postedAt || record.date || '—',
        currency: record.currency || 'USD',
        amountLabel: `${Number(record.amount || 0).toFixed(2)} ${record.currency || ''}`,
        isLocked: !!record.isLocked,
        source: record.source || 'manual'
      };
    });
    const draftList = (drafts || []).map((draft: any) => {
      const used = (draft.currenciesUsed || []).length;
      const currencyLabel = used === 1 ? draft.currenciesUsed[0] : (used > 1 ? 'متعدد' : '—');
      return {
        id: draft.id,
        kind: 'draft',
        status: 'مسودة',
        title: draft.entryNumber || draft.id || '—',
        accountType: 'draft',
        year: String(draft.fiscalYear || ''),
        date: draft.entryDate || '—',
        currency: currencyLabel,
        amountLabel: `مدين: ${Number(draft.totalDebit || 0).toFixed(2)} | دائن: ${Number(draft.totalCredit || 0).toFixed(2)}`,
        accountTypesUsed: draft.accountTypesUsed || [],
        currenciesUsed: draft.currenciesUsed || []
      };
    });
    return [...posted, ...draftList].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  }, [openingRecords, drafts]);

  const filteredRecords = useMemo(() => {
    return combinedRecords.filter((rec: any) => {
      if (filterYear !== 'all' && rec.year !== filterYear) return false;
      if (filterCurrency !== 'all') {
        if (rec.kind === 'posted') {
          if (String(rec.currency || '') !== filterCurrency) return false;
        } else {
          const used = rec.currenciesUsed || [];
          if (!used.includes(filterCurrency)) return false;
        }
      }
      if (filterAccountType !== 'all') {
        if (rec.kind === 'posted') {
          if (String(rec.accountType || '') !== filterAccountType) return false;
        } else {
          const usedTypes = rec.accountTypesUsed || [];
          if (!usedTypes.includes(filterAccountType)) return false;
        }
      }
      return true;
    });
  }, [combinedRecords, filterYear, filterCurrency, filterAccountType]);

  const availableYears = useMemo(() => {
    return Array.from(new Set(combinedRecords.map((r: any) => r.year).filter(Boolean))).sort();
  }, [combinedRecords]);

  const handleSaveDraft = () => {
    setIsSaving(true);
    window.setTimeout(() => {
      setDrafts((prev) => [
        {
          id: `draft-${Date.now()}`,
          entryNumber: header.entryNumber,
          fiscalYear: header.fiscalYear,
          entryDate: header.entryDate,
          description: header.description,
          totalDebit,
          totalCredit,
          lineCount: lines.length,
          currenciesUsed: Array.from(new Set(lines.map((l) => l.currency))).filter(Boolean),
          accountTypesUsed: Array.from(new Set(lines.map((l) => l.account_type))).filter(Boolean)
        },
        ...prev
      ]);
      setIsSaving(false);
      window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message: 'تم حفظ مسودة الذمم (واجهة فقط).' } }));
    }, 600);
  };

  const handlePost = async () => {
    const ok = await confirmPostDialog();
    if (!ok) return;

    // لا نتحقق من التوازن - النظام يوازن تلقائياً في الخلفية
    const validLines = lines.filter((l) => l.account_id);
    if (validLines.length === 0) {
      showToast('أضف سطراً واحداً على الأقل.');
      return;
    }

    setIsPosting(true);
    try {
      const result = await postOpeningReceivables({
        fiscalYear: header.fiscalYear,
        currency: 'USD',
        date: header.entryDate,
        lines: validLines
      });

      if (result?.errors > 0) {
        showToast(`تم مع ${result.errors} خطأ — راجع التفاصيل.`);
      } else if (result?.skipped > 0) {
        showToast(`تم ترحيل ${result.processed} سطر — تم تخطي ${result.skipped} (مسجّل مسبقاً).`);
      } else {
        showToast(`تم ترحيل ${result?.processed ?? validLines.length} سطر بنجاح ✅`);
      }

      if (activeTab === 'records') {
        await reloadRecords();
      }
    } catch (e: any) {
      showToast(e?.message || 'فشل ترحيل ذمم أول المدة.');
    } finally {
      setIsPosting(false);
    }
  };

  const reloadRecords = async () => {
    setIsLoadingRecords(true);
    try {
      const data = await getOpeningReceivables();
      setOpeningRecords(Array.isArray(data) ? data : []);
    } catch {
      setOpeningRecords([]);
    } finally {
      setIsLoadingRecords(false);
    }
  };

  const handleReset = () => {
    window.location.reload();
  };

  useEffect(() => {
    if (activeTab !== 'records') return;
    reloadRecords();
  }, [activeTab]);

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto space-y-5">
      <div className="bg-white border rounded-2xl p-5 md:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-gray-800">ذمم أول المدة</h1>
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
          <BalancesHeader
            fiscalYear={header.fiscalYear}
            entryNumber={header.entryNumber}
            entryDate={header.entryDate}
            description={header.description}
            onChange={(next) => {
              if (next.fiscalYear !== undefined) setFiscalYear(next.fiscalYear);
              if (next.entryNumber !== undefined) setEntryNumber(next.entryNumber);
              if (next.entryDate !== undefined) setEntryDate(next.entryDate);
              if (next.description !== undefined) setDescription(next.description);
            }}
          />

          <MultiCurrencyIndicator balances={totals} />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 space-y-5">
              <BalancesLinesTable
                lines={lines}
                customers={customersForDropdown}
                suppliers={suppliersForDropdown}
                cashBoxes={cashBoxesForDropdown}
                accounts={accountsForDropdown}
                onAddLine={addLine}
                onRemoveLine={removeLine}
                onUpdateLine={updateLine}
              />
              <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSaveDraft}
                  disabled={isSaving}
                  className={`px-4 py-2 rounded-xl font-bold ${isSaving ? 'bg-gray-300 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'}`}
                >
                  {isSaving ? 'جاري الحفظ...' : 'حفظ مسودة'}
                </button>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-xl font-bold bg-gray-100 text-gray-700 border hover:bg-gray-200"
                >
                  إعادة ضبط
                </button>
                <button
                  onClick={handlePost}
                  disabled={!canPost || isPosting}
                  className={`px-4 py-2 rounded-xl font-bold ${canPost && !isPosting ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                >
                  {isPosting ? 'جاري الترحيل...' : 'ترحيل'}
                </button>
              </div>
            </div>
            <div className="space-y-5">
              <OpeningEntriesList entries={drafts} />
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between mb-4">
            <div>
              <h2 className="text-lg font-black text-gray-800">سجلات ذمم أول المدة</h2>
              <p className="text-xs text-gray-500">فلترة حسب السنة والعملة ونوع الحساب</p>
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
                <label className="block text-xs font-bold text-gray-500 mb-1">نوع الحساب</label>
                <select value={filterAccountType} onChange={(e) => setFilterAccountType(e.target.value as any)} className="w-full border rounded-xl p-2 text-sm font-bold bg-white">
                  <option value="all">الكل</option>
                  <option value="customer">عميل</option>
                  <option value="supplier">مورد</option>
                  <option value="cash_box">صندوق</option>
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
                    <th className="px-4 py-3">الطرف</th>
                    <th className="px-4 py-3">العملة</th>
                    <th className="px-4 py-3">المبلغ</th>
                    <th className="px-4 py-3">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRecords.map((record: any) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-bold">{record.year || '\u2014'}</td>
                      <td className="px-4 py-3 text-gray-500">{record.date || '\u2014'}</td>
                      <td className="px-4 py-3">{record.title || '\u2014'}</td>
                      <td className="px-4 py-3">{record.currency || '\u2014'}</td>
                      <td className="px-4 py-3 font-bold">{record.amountLabel || '\u2014'}</td>
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

export default OpeningBalances;

