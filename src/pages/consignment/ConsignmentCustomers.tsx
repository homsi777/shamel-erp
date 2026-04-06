import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Filter, Download, Eye, Pencil, Send, XCircle, FileCheck, Loader2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Client, Warehouse, InventoryItem, ConsignmentDocument } from '../../types';
import { AdaptiveTable } from '../../components/responsive';
import { confirmDialog } from '../../lib/confirm';
import ConsignmentDocumentForm from '../../components/consignment/ConsignmentDocumentForm.tsx';

interface ConsignmentCustomersProps {
  clients: Client[];
  warehouses: Warehouse[];
  items: InventoryItem[];
  refreshData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
  setConsignmentTab?: (tab: 'customers' | 'suppliers' | 'settlements' | 'warehouses' | 'reports' | 'settings') => void;
  openSettlementsForDoc?: (documentId: string) => void;
  direction: 'OUT_CUSTOMER' | 'IN_SUPPLIER';
  /** Deep-link from reports: open view for this docId */
  openViewDocId?: string;
  /** Called once the drill doc has been consumed / closed */
  onDrillConsumed?: () => void;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  POSTED: 'bg-blue-100 text-blue-800',
  PARTIALLY_SETTLED: 'bg-orange-100 text-orange-800',
  FULLY_SETTLED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  PARTIALLY_SETTLED: 'تسوية جزئية',
  FULLY_SETTLED: 'مسوّى بالكامل',
  CANCELLED: 'ملغى',
};

const ConsignmentCustomers: React.FC<ConsignmentCustomersProps> = ({
  clients,
  warehouses,
  items,
  refreshData,
  setActiveTab,
  setConsignmentTab,
  openSettlementsForDoc,
  direction,
  openViewDocId,
  onDrillConsumed,
}) => {
  const openSettlements = (docId?: string) => {
    if (docId && openSettlementsForDoc) openSettlementsForDoc(docId);
    else setConsignmentTab?.('settlements');
  };
  const isCustomer = direction === 'OUT_CUSTOMER';
  const title = isCustomer ? 'أمانة العملاء' : 'أمانة الموردين';

  const [list, setList] = useState<ConsignmentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPartyId, setFilterPartyId] = useState('');
  const [filterWarehouseId, setFilterWarehouseId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [viewDoc, setViewDoc] = useState<ConsignmentDocument | null>(null);
  const [editDoc, setEditDoc] = useState<ConsignmentDocument | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchDebounced, setSearchDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Deep-link: when openViewDocId is provided, fetch that doc and open view mode
  useEffect(() => {
    if (!openViewDocId) return;
    apiRequest(`consignments/${openViewDocId}`)
      .then((doc: any) => {
        if (doc?.id) {
          setViewDoc(doc as ConsignmentDocument);
          setFormOpen(false);
          setEditDoc(null);
        }
      })
      .catch(() => {})
      .finally(() => onDrillConsumed?.());
  }, [openViewDocId]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      params.set('direction', direction);
      if (filterStatus) params.set('status', filterStatus);
      if (filterPartyId) params.set('partyId', filterPartyId);
      if (filterWarehouseId) params.set('warehouseId', filterWarehouseId);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      const res = await apiRequest(`consignments?${params.toString()}`);
      setList(Array.isArray(res) ? res : []);
    } catch (e: any) {
      setFetchError(e?.response?.data?.error || 'فشل تحميل القائمة');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [direction, filterStatus, filterPartyId, filterWarehouseId, fromDate, toDate]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const filtered = list.filter((doc) => {
    if (searchDebounced) {
      const q = searchDebounced.toLowerCase();
      const match =
        String(doc.documentNumber || '').toLowerCase().includes(q) ||
        String(doc.partyId || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const draftCount = list.filter((d) => d.status === 'DRAFT').length;
  const postedCount = list.filter((d) => d.status === 'POSTED').length;
  const partialCount = list.filter((d) => d.status === 'PARTIALLY_SETTLED').length;
  const fullCount = list.filter((d) => d.status === 'FULLY_SETTLED').length;
  const totalOpenQty = list.reduce((s, d) => s + Number(d.totalQty || 0), 0);
  const hasFilters = filterStatus || filterPartyId || filterWarehouseId || fromDate || toDate;
  const clearFilters = () => {
    setFilterStatus('');
    setFilterPartyId('');
    setFilterWarehouseId('');
    setFromDate('');
    setToDate('');
    setSearch('');
    setSearchDebounced('');
  };

  const handlePost = async (doc: ConsignmentDocument) => {
    if (doc.status !== 'DRAFT') return;
    if (!(await confirmDialog('ترحيل السند؟ لا يمكن التعديل بعد الترحيل.'))) return;
    setActionLoading(doc.id);
    try {
      await apiRequest(`consignments/${doc.id}/post`, { method: 'POST', body: JSON.stringify({}) });
      setToast({ type: 'success', text: 'تم ترحيل السند' });
      fetchList();
      setViewDoc(null);
      setEditDoc(null);
    } catch (e: any) {
      setToast({ type: 'error', text: e?.response?.data?.error || 'فشل الترحيل' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (doc: ConsignmentDocument) => {
    if (doc.status === 'CANCELLED') return;
    if (!(await confirmDialog('إلغاء السند؟ هذا الإجراء لا يُلغى.'))) return;
    setActionLoading(doc.id);
    try {
      await apiRequest(`consignments/${doc.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      setToast({ type: 'success', text: 'تم إلغاء السند' });
      fetchList();
      setViewDoc(null);
      setEditDoc(null);
    } catch (e: any) {
      setToast({ type: 'error', text: e?.response?.data?.error || 'فشل الإلغاء' });
    } finally {
      setActionLoading(null);
    }
  };

  const partyName = (partyId: string) => clients.find((c) => c.id === partyId)?.name || partyId;
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  const columns = [
    {
      id: 'documentNumber',
      header: 'رقم السند',
      cell: (r: ConsignmentDocument) => <span className="font-bold font-numeric">{r.documentNumber}</span>,
    },
    {
      id: 'issueDate',
      header: 'التاريخ',
      cell: (r: ConsignmentDocument) => (r.issueDate || '').slice(0, 10),
    },
    {
      id: 'party',
      header: isCustomer ? 'العميل' : 'المورد',
      cell: (r: ConsignmentDocument) => partyName(r.partyId),
    },
    {
      id: 'warehouse',
      header: 'مستودع الأمانة',
      cell: (r: ConsignmentDocument) => whName(r.consignmentWarehouseId || ''),
    },
    {
      id: 'totalQty',
      header: 'إجمالي الكمية',
      cell: (r: ConsignmentDocument) => <span className="font-numeric">{Number(r.totalQty || 0)}</span>,
    },
    {
      id: 'status',
      header: 'الحالة',
      cell: (r: ConsignmentDocument) => (
        <span className={`px-2 py-1 rounded text-xs font-bold ${statusColors[r.status] || 'bg-gray-100'}`}>
          {statusLabels[r.status] || r.status}
        </span>
      ),
    },
    {
      id: 'createdBy',
      header: 'المستخدم',
      cell: (r: ConsignmentDocument) => r.createdBy || '—',
    },
    {
      id: 'actions',
      header: 'إجراءات',
      cell: (r: ConsignmentDocument) => (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setViewDoc(r); }}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title="عرض"
          >
            <Eye size={16} />
          </button>
          {r.status === 'DRAFT' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditDoc(r); setFormOpen(true); }}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              title="تحرير"
            >
              <Pencil size={16} />
            </button>
          )}
          {r.status === 'DRAFT' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handlePost(r); }}
              disabled={!!actionLoading}
              className="p-2 rounded-lg hover:bg-blue-50 text-blue-600"
              title="ترحيل"
            >
              {actionLoading === r.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          )}
          {r.status !== 'CANCELLED' && r.status === 'DRAFT' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleCancel(r); }}
              disabled={!!actionLoading}
              className="p-2 rounded-lg hover:bg-red-50 text-red-600"
              title="إلغاء"
            >
              {actionLoading === r.id ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
            </button>
          )}
          {(r.status === 'POSTED' || r.status === 'PARTIALLY_SETTLED') && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openSettlements(r.id); }}
              className="p-2 rounded-lg hover:bg-teal-50 text-teal-600"
              title="فتح التسويات"
            >
              <FileCheck size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  if (formOpen || viewDoc) {
    return (
      <div className="flex flex-col min-h-0">
        <ConsignmentDocumentForm
          direction={direction}
          clients={clients}
          warehouses={warehouses}
          items={items}
          editDoc={formOpen ? (editDoc || undefined) : undefined}
          viewDoc={viewDoc && !formOpen ? viewDoc : undefined}
          fullPage
          onBack={() => {
            setFormOpen(false);
            setEditDoc(null);
            setViewDoc(null);
            fetchList();
          }}
          onClose={() => {
            setFormOpen(false);
            setEditDoc(null);
            setViewDoc(null);
            fetchList();
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditDoc(null);
            setViewDoc(null);
            fetchList();
          }}
          refreshData={refreshData}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed bottom-4 left-4 z-50 px-4 py-2 rounded-lg shadow-lg ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-gray-500">عدد السندات</div>
          <div className="text-xl font-black text-gray-900 font-numeric">{list.length}</div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
          <div className="text-xs font-bold text-gray-600">مسودات</div>
          <div className="text-xl font-black text-gray-800 font-numeric">{draftCount}</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3">
          <div className="text-xs font-bold text-blue-700">مرحّلة</div>
          <div className="text-xl font-black text-blue-900 font-numeric">{postedCount}</div>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3">
          <div className="text-xs font-bold text-orange-700">قيد التسوية</div>
          <div className="text-xl font-black text-orange-900 font-numeric">{partialCount}</div>
        </div>
        <div className="rounded-xl border border-green-100 bg-green-50/50 p-3">
          <div className="text-xs font-bold text-green-700">مكتملة</div>
          <div className="text-xl font-black text-green-900 font-numeric">{fullCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-gray-500">إجمالي الكمية</div>
          <div className="text-xl font-black text-gray-900 font-numeric">{totalOpenQty}</div>
        </div>
      </div>

      <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur py-2 -mx-1 px-1 rounded-xl border border-gray-100 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setEditDoc(null); setViewDoc(null); setFormOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700"
        >
          <Plus size={20} />
          سند أمانة جديد
        </button>
        <div className="flex-1 min-w-[180px] max-w-sm">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="بحث (رقم السند، الطرف)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-10 pl-3 py-2 border border-gray-200 rounded-xl text-right"
            />
          </div>
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="py-2 px-3 border border-gray-200 rounded-xl text-right bg-white"
        >
          <option value="">الحالة</option>
          {Object.entries(statusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterPartyId}
          onChange={(e) => setFilterPartyId(e.target.value)}
          className="py-2 px-3 border border-gray-200 rounded-xl text-right bg-white min-w-[140px]"
        >
          <option value="">{isCustomer ? 'العميل' : 'المورد'}</option>
          {clients
            .filter((c) => (isCustomer ? /CUSTOMER|BOTH/.test(String(c.type || '')) : /SUPPLIER|BOTH/.test(String(c.type || ''))))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>
        <select
          value={filterWarehouseId}
          onChange={(e) => setFilterWarehouseId(e.target.value)}
          className="py-2 px-3 border border-gray-200 rounded-xl text-right bg-white min-w-[140px]"
        >
          <option value="">المستودع</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="py-2 px-3 border border-gray-200 rounded-xl text-right"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="py-2 px-3 border border-gray-200 rounded-xl text-right"
        />
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-sm font-bold"
          >
            <Filter size={16} />
            مسح الفلاتر
          </button>
        )}
      </div>

      {fetchError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center justify-between">
          {fetchError}
          <button type="button" onClick={() => fetchList()} className="text-sm underline">إعادة المحاولة</button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <AdaptiveTable
          rows={filtered}
          columns={columns}
          keyExtractor={(r) => r.id}
          loading={loading}
          loadingState={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-teal-600" size={32} />
            </div>
          }
          emptyState={
            <div className="py-12 text-center text-gray-500">
              لا توجد سندات أمانة. انقر «سند أمانة جديد» للإضافة.
            </div>
          }
          rowClassName={(r) => {
            const s = r.status;
            if (s === 'CANCELLED') return 'bg-red-50/50';
            if (s === 'FULLY_SETTLED') return 'bg-green-50/30';
            if (s === 'PARTIALLY_SETTLED') return 'bg-orange-50/30';
            if (s === 'POSTED') return 'bg-blue-50/30';
            return '';
          }}
        />
      </div>

    </div>
  );
};

export default ConsignmentCustomers;
