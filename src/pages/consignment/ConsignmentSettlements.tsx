import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Send, XCircle, FileText, Loader2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Client, Warehouse, InventoryItem, ConsignmentSettlement } from '../../types';
import { AdaptiveTable } from '../../components/responsive';
import { confirmDialog } from '../../lib/confirm';
import SettlementForm from '../../components/consignment/SettlementForm';

interface ConsignmentSettlementsProps {
  clients: Client[];
  warehouses: Warehouse[];
  items: InventoryItem[];
  refreshData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
  preselectedDocId?: string;
  clearPreselectedDocId?: () => void;
  preselectedSettlementId?: string;
  clearPreselectedSettlementId?: () => void;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  POSTED: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  CANCELLED: 'ملغى',
};

const ConsignmentSettlements: React.FC<ConsignmentSettlementsProps> = ({
  clients,
  warehouses,
  items,
  refreshData,
  setActiveTab,
  preselectedDocId: preselectedDocIdProp,
  clearPreselectedDocId,
  preselectedSettlementId,
  clearPreselectedSettlementId,
}) => {
  const [list, setList] = useState<ConsignmentSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [localDocId, setLocalDocId] = useState<string | undefined>(undefined);
  const preselectedDocId = preselectedDocIdProp ?? localDocId;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const res = await apiRequest(`consignment-settlements?${params.toString()}`);
      setList(Array.isArray(res) ? res : []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (preselectedDocIdProp) {
      setFormOpen(true);
      setLocalDocId(preselectedDocIdProp);
      clearPreselectedDocId?.();
    }
  }, [preselectedDocIdProp]);

  useEffect(() => {
    if (!preselectedSettlementId || list.length === 0) return;
    const row = list.find((r) => r.id === preselectedSettlementId);
    if (row?.documentId) {
      setLocalDocId(row.documentId);
      setFormOpen(true);
    }
    clearPreselectedSettlementId?.();
  }, [preselectedSettlementId, list, clearPreselectedSettlementId]);

  const handlePost = async (row: ConsignmentSettlement) => {
    if (row.status !== 'DRAFT') return;
    if (!(await confirmDialog('ترحيل التسوية؟'))) return;
    setActionLoading(row.id);
    try {
      await apiRequest(`consignment-settlements/${row.id}/post`, {
        method: 'POST',
        body: JSON.stringify({ userId: 'user' }),
      });
      setToast({ type: 'success', text: 'تم ترحيل التسوية' });
      fetchList();
    } catch (e: any) {
      setToast({ type: 'error', text: e?.response?.data?.error || 'فشل الترحيل' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (row: ConsignmentSettlement) => {
    if (row.status === 'CANCELLED') return;
    if (!(await confirmDialog('إلغاء التسوية؟'))) return;
    setActionLoading(row.id);
    try {
      await apiRequest(`consignment-settlements/${row.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      setToast({ type: 'success', text: 'تم الإلغاء' });
      fetchList();
    } catch (e: any) {
      setToast({ type: 'error', text: e?.response?.data?.error || 'فشل الإلغاء' });
    } finally {
      setActionLoading(null);
    }
  };

  const openInvoice = (linkedInvoiceId: string) => {
    try {
      localStorage.setItem('shamel_invoice_view_prefill', JSON.stringify({ id: linkedInvoiceId }));
      setActiveTab('invoices');
    } catch {}
  };

  const columns = [
    { id: 'settlementNumber', header: 'رقم التسوية', cell: (r: ConsignmentSettlement) => <span className="font-bold font-numeric">{r.settlementNumber}</span> },
    { id: 'documentId', header: 'رقم السند', cell: (r: ConsignmentSettlement) => r.documentId },
    { id: 'settlementDate', header: 'التاريخ', cell: (r: ConsignmentSettlement) => (r.settlementDate || '').slice(0, 10) },
    { id: 'totalSoldQty', header: 'المباع', cell: (r: ConsignmentSettlement) => <span className="font-numeric">{Number(r.totalSoldQty || 0)}</span> },
    { id: 'totalReturnedQty', header: 'المرتجع', cell: (r: ConsignmentSettlement) => <span className="font-numeric">{Number(r.totalReturnedQty || 0)}</span> },
    {
      id: 'status',
      header: 'الحالة',
      cell: (r: ConsignmentSettlement) => (
        <span className={`px-2 py-1 rounded text-xs font-bold ${statusColors[r.status] || 'bg-gray-100'}`}>
          {statusLabels[r.status] || r.status}
        </span>
      ),
    },
    {
      id: 'linkedInvoice',
      header: 'الفاتورة المرتبطة',
      cell: (r: ConsignmentSettlement) =>
        r.linkedInvoiceId ? (
          <button
            type="button"
            onClick={() => openInvoice(r.linkedInvoiceId!)}
            className="text-teal-600 font-bold hover:underline"
          >
            فتح الفاتورة
          </button>
        ) : (
          '—'
        ),
    },
    {
      id: 'actions',
      header: 'إجراءات',
      cell: (r: ConsignmentSettlement) => (
        <div className="flex items-center gap-1 flex-wrap">
          {r.status === 'DRAFT' && (
            <>
              <button
                type="button"
                onClick={() => handlePost(r)}
                disabled={!!actionLoading}
                className="p-2 rounded-lg hover:bg-blue-50 text-blue-600"
                title="ترحيل"
              >
                {actionLoading === r.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
              <button
                type="button"
                onClick={() => handleCancel(r)}
                disabled={!!actionLoading}
                className="p-2 rounded-lg hover:bg-red-50 text-red-600"
                title="إلغاء"
              >
                {actionLoading === r.id ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
              </button>
            </>
          )}
          {r.linkedInvoiceId && (
            <button
              type="button"
              onClick={() => openInvoice(r.linkedInvoiceId!)}
              className="p-2 rounded-lg hover:bg-teal-50 text-teal-600"
              title="فتح الفاتورة"
            >
              <FileText size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  if (formOpen) {
    return (
      <div className="flex flex-col min-h-0">
        <SettlementForm
          clients={clients}
          items={items}
          preselectedDocumentId={preselectedDocId}
          fullPage
          onBack={() => { setFormOpen(false); setLocalDocId(undefined); fetchList(); }}
          onClose={() => { setFormOpen(false); setLocalDocId(undefined); fetchList(); }}
          onSaved={() => { setFormOpen(false); setLocalDocId(undefined); fetchList(); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed bottom-4 left-4 z-50 px-4 py-2 rounded-lg shadow-lg ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
        >
          {toast.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { setLocalDocId(undefined); setFormOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700"
        >
          <Plus size={20} />
          تسوية جديدة
        </button>
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
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <AdaptiveTable
          rows={list}
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
              لا توجد تسويات. أنشئ تسوية من سند أمانة مرحّل.
            </div>
          }
        />
      </div>
    </div>
  );
};

export default ConsignmentSettlements;
