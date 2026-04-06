import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Printer, Loader2, RefreshCw, Filter } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Client, Warehouse } from '../../types';

type ReportId = 'summary' | 'party' | 'movements';

const reportOptions: { id: ReportId; label: string }[] = [
  { id: 'summary', label: 'ملخص الأمانة' },
  { id: 'party', label: 'كشف أمانة طرف' },
  { id: 'movements', label: 'حركات الأمانة' },
];

interface ConsignmentReportsProps {
  clients?: Client[];
  warehouses?: Warehouse[];
  setActiveTab?: (tab: string) => void;
  /** Called when user clicks a document row to drilldown — opens that document */
  onOpenDoc?: (docId: string, direction: 'OUT_CUSTOMER' | 'IN_SUPPLIER') => void;
}

const ConsignmentReports: React.FC<ConsignmentReportsProps> = ({
  clients = [],
  warehouses = [],
  setActiveTab,
  onOpenDoc,
}) => {
  const [reportId, setReportId] = useState<ReportId>('summary');
  const [partyId, setPartyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const docParams = new URLSearchParams();
      if (direction) docParams.set('direction', direction);
      if (status) docParams.set('status', status);
      if (partyId) docParams.set('partyId', partyId);
      if (fromDate) docParams.set('fromDate', fromDate);
      if (toDate) docParams.set('toDate', toDate);
      const [docRes, setRes] = await Promise.all([
        apiRequest(`consignments?${docParams.toString()}`),
        apiRequest('consignment-settlements'),
      ]);
      const docList = Array.isArray(docRes) ? docRes : [];
      setDocuments(docList);
      const setList = Array.isArray(setRes) ? setRes : [];
      const docIds = new Set(docList.map((d: any) => d.id));
      const filtered = setList.filter((s: any) => {
        if (!docIds.has(s.documentId)) return false;
        if (fromDate && (s.settlementDate || '').slice(0, 10) < fromDate) return false;
        if (toDate && (s.settlementDate || '').slice(0, 10) > toDate) return false;
        return true;
      });
      setSettlements(filtered);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'فشل تحميل البيانات');
      setDocuments([]);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [reportId, partyId, fromDate, toDate, status, direction]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const clearFilters = () => {
    setPartyId('');
    setFromDate('');
    setToDate('');
    setStatus('');
    setDirection('');
  };

  const partyName = (id: string) => clients.find((c) => c.id === id)?.name || id;
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  const draftCount = documents.filter((d) => d.status === 'DRAFT').length;
  const postedCount = documents.filter((d) => d.status === 'POSTED').length;
  const partialCount = documents.filter((d) => d.status === 'PARTIALLY_SETTLED').length;
  const fullCount = documents.filter((d) => d.status === 'FULLY_SETTLED').length;
  const totalOpenQty = documents.reduce((s, d) => s + Number(d.totalQty || 0), 0);
  const settlementCount = settlements.length;

  const handlePrint = () => window.print();
  const hasFilters = partyId || fromDate || toDate || status || direction;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-3">
        <label className="font-bold text-gray-700">نوع التقرير:</label>
        <select
          value={reportId}
          onChange={(e) => setReportId(e.target.value as ReportId)}
          className="px-3 py-2 border border-gray-200 rounded-xl bg-white min-w-[180px]"
        >
          {reportOptions.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-bold"
          >
            <Filter size={16} />
            مسح الفلاتر
          </button>
        )}
        <button
          type="button"
          onClick={() => fetchData()}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 text-sm font-bold"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          تحديث
        </button>
        <button type="button" onClick={handlePrint} className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-bold">
          <Printer size={16} />
          طباعة
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-gray-500">عدد السندات</div>
          <div className="text-xl font-black text-gray-900 font-numeric">{documents.length}</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 shadow-sm">
          <div className="text-xs font-bold text-blue-700">المرحّلة</div>
          <div className="text-xl font-black text-blue-900 font-numeric">{postedCount}</div>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 shadow-sm">
          <div className="text-xs font-bold text-orange-700">قيد التسوية</div>
          <div className="text-xl font-black text-orange-900 font-numeric">{partialCount}</div>
        </div>
        <div className="rounded-xl border border-green-100 bg-green-50/50 p-3 shadow-sm">
          <div className="text-xs font-bold text-green-700">المكتملة</div>
          <div className="text-xl font-black text-green-900 font-numeric">{fullCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-gray-500">إجمالي الكمية المفتوحة</div>
          <div className="text-xl font-black text-gray-900 font-numeric">{totalOpenQty}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-gray-500">عدد التسويات</div>
          <div className="text-xl font-black text-gray-900 font-numeric">{settlementCount}</div>
        </div>
      </div>

      <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur py-2 -mx-1 px-1 rounded-xl border border-gray-100 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gray-600">الفلاتر:</span>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm bg-white">
          <option value="">الاتجاه</option>
          <option value="OUT_CUSTOMER">أمانة عملاء</option>
          <option value="IN_SUPPLIER">أمانة موردين</option>
        </select>
        <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm bg-white min-w-[140px]">
          <option value="">الطرف</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm bg-white">
          <option value="">الحالة</option>
          <option value="DRAFT">مسودة</option>
          <option value="POSTED">مرحّل</option>
          <option value="PARTIALLY_SETTLED">تسوية جزئية</option>
          <option value="FULLY_SETTLED">مكتمل</option>
          <option value="CANCELLED">ملغى</option>
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm" />
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center justify-between">
          {error}
          <button type="button" onClick={() => { setError(null); fetchData(); }} className="text-sm underline">إعادة المحاولة</button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-teal-600" size={40} />
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="sticky top-0 bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="p-3 font-bold">رقم السند</th>
                  <th className="p-3 font-bold">النوع</th>
                  <th className="p-3 font-bold">التاريخ</th>
                  <th className="p-3 font-bold">الطرف</th>
                  <th className="p-3 font-bold">المستودع</th>
                  <th className="p-3 font-bold">الكمية</th>
                  <th className="p-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500">
                      لا توجد سندات تطابق الفلاتر المحددة.
                    </td>
                  </tr>
                ) : (
                  documents.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-gray-100 hover:bg-teal-50 cursor-pointer"
                      onClick={() => {
                        if (onOpenDoc) {
                          onOpenDoc(d.id, d.direction || 'OUT_CUSTOMER');
                        } else {
                          setActiveTab?.(d.direction === 'IN_SUPPLIER' ? 'suppliers' : 'customers');
                        }
                      }}
                      title="انقر لفتح السند"
                    >
                      <td className="p-3 font-numeric font-bold text-teal-700 underline underline-offset-2">{d.documentNumber}</td>
                      <td className="p-3 text-xs">
                        <span className={`px-1.5 py-0.5 rounded font-bold ${d.direction === 'IN_SUPPLIER' ? 'bg-amber-100 text-amber-800' : 'bg-teal-100 text-teal-800'}`}>
                          {d.direction === 'IN_SUPPLIER' ? 'موردين' : 'عملاء'}
                        </span>
                      </td>
                      <td className="p-3">{(d.issueDate || '').slice(0, 10)}</td>
                      <td className="p-3">{partyName(d.partyId)}</td>
                      <td className="p-3">{whName(d.consignmentWarehouseId)}</td>
                      <td className="p-3 font-numeric">{d.totalQty ?? '—'}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            d.status === 'DRAFT' ? 'bg-gray-100' : d.status === 'POSTED' ? 'bg-blue-100 text-blue-800' : d.status === 'FULLY_SETTLED' ? 'bg-green-100 text-green-800' : d.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
                          }`}
                        >
                          {d.status === 'DRAFT' ? 'مسودة' : d.status === 'POSTED' ? 'مرحّل' : d.status === 'FULLY_SETTLED' ? 'مكتمل' : d.status === 'CANCELLED' ? 'ملغى' : 'تسوية جزئية'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-sm text-gray-600 font-numeric">
            عدد الصفوف: {documents.length}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsignmentReports;
