import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FilePlus2, Printer, RefreshCw, Send, XCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AppUser, Client, InventoryItem, TextileColor, TextileDispatchLine, TextileDispatchNotice, Warehouse } from '../types';
import Combobox from '../components/Combobox';
import { AdaptiveModal, AdaptiveTable, ResponsivePage } from '../components/responsive';
import { getStoredUser } from '../lib/companySession';
import {
  canApproveTextileDispatch,
  canConfirmTextileDispatchPreparation,
  canConvertTextileDispatchToInvoice,
  canCreateTextileDispatchRequest,
  canOpenTextileDispatchDocument,
  canPrepareTextileDispatch,
  canPrintTextileDispatchDocument,
} from '../lib/userAccess';

interface TextileDispatchesProps {
  items: InventoryItem[];
  clients: Client[];
  warehouses: Warehouse[];
  approvalMode?: boolean;
}

type DraftLine = {
  tempId: string;
  itemId: string;
  colorId: string;
  colorName: string;
  requestedRollCount: string;
  textileUnitPricePerLength: string;
};

const statusOptions = [
  { value: '', label: 'الكل' },
  { value: 'draft', label: 'مسودة' },
  { value: 'sent_to_warehouse', label: 'مرسل للمستودع' },
  { value: 'in_preparation', label: 'قيد التحضير' },
  { value: 'awaiting_approval', label: 'بانتظار الاعتماد' },
  { value: 'approved', label: 'معتمد' },
  { value: 'converted_to_invoice', label: 'محوّل لفاتورة' },
  { value: 'rejected', label: 'مرفوض' },
];

const emptyDraftLine = (): DraftLine => ({
  tempId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  itemId: '',
  colorId: '',
  colorName: '',
  requestedRollCount: '',
  textileUnitPricePerLength: '',
});

const TextileDispatches: React.FC<TextileDispatchesProps> = ({ items, clients, warehouses, approvalMode = false }) => {
  const [currentUser] = useState<AppUser | null>(() => getStoredUser());
  const [dispatches, setDispatches] = useState<TextileDispatchNotice[]>([]);
  const [colors, setColors] = useState<TextileColor[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(approvalMode ? 'awaiting_approval' : '');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [selectedDispatch, setSelectedDispatch] = useState<TextileDispatchNotice | null>(null);
  const [draftCustomerId, setDraftCustomerId] = useState('');
  const [draftWarehouseId, setDraftWarehouseId] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyDraftLine()]);
  const [prepLines, setPrepLines] = useState<Array<{ lineId: string; decomposition: Array<{ sequence: number; lengthValue: string; unit: 'meter' | 'yard'; rollLabel?: string }> }>>([]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const textileItems = useMemo(() => items.filter((item) => item.isTextile), [items]);
  const canCreateDispatch = canCreateTextileDispatchRequest(currentUser);
  const canOpenDispatch = canOpenTextileDispatchDocument(currentUser);
  const canPrepareDispatch = canPrepareTextileDispatch(currentUser);
  const canConfirmPreparation = canConfirmTextileDispatchPreparation(currentUser);
  const canApproveDispatches = canApproveTextileDispatch(currentUser);
  const canConvertDispatches = canConvertTextileDispatchToInvoice(currentUser);
  const canPrintDispatches = canPrintTextileDispatchDocument(currentUser);

  const loadDispatches = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (statusFilter) query.set('status', statusFilter);
      const [dispatchRows, colorRows] = await Promise.all([
        apiRequest(`textile/dispatches${query.toString() ? `?${query.toString()}` : ''}`),
        apiRequest('textile/colors'),
      ]);
      setDispatches(Array.isArray(dispatchRows) ? dispatchRows : []);
      setColors(Array.isArray(colorRows) ? colorRows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDispatches();
  }, [statusFilter]);

  const filteredDispatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return dispatches;
    return dispatches.filter((row) =>
      [row.dispatchNumber, row.customerName, row.warehouseName, row.status]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(term)),
    );
  }, [dispatches, search]);

  const resetDraft = () => {
    setDraftCustomerId('');
    setDraftWarehouseId(warehouses[0]?.id || '');
    setDraftNotes('');
    setDraftLines([emptyDraftLine()]);
  };

  const openPrepare = async (noticeId: string) => {
    const payload = await apiRequest(`textile/dispatches/${noticeId}`);
    setSelectedDispatch(payload);
    const decompositionsByLine = new Map<string, any[]>();
    for (const entry of Array.isArray(payload.decompositions) ? payload.decompositions : []) {
      const lineId = String(entry.lineId || '');
      const list = decompositionsByLine.get(lineId) || [];
      list.push(entry);
      decompositionsByLine.set(lineId, list);
    }
    setPrepLines((payload.lines || []).map((line: TextileDispatchLine) => {
      const existingRows = decompositionsByLine.get(String(line.id)) || [];
      const existing = existingRows.length
        ? existingRows
        : Array.from({ length: Number(line.requestedRollCount || 0) }, (_, index) => ({
            sequence: index + 1,
            lengthValue: '',
            unit: line.baseUom,
            rollLabel: '',
          }));
      return {
        lineId: String(line.id),
        decomposition: existing.map((entry: any, index: number) => ({
          sequence: Number(entry.sequence || index + 1),
          lengthValue: String(entry.lengthValue ?? ''),
          unit: entry.unit || line.baseUom,
          rollLabel: entry.rollLabel || '',
        })),
      };
    }));
    setPrepareOpen(true);
  };

  const updateDraftLine = (tempId: string, patch: Partial<DraftLine>) => {
    setDraftLines((current) => current.map((line) => (line.tempId === tempId ? { ...line, ...patch } : line)));
  };

  const addDraftLine = () => setDraftLines((current) => [...current, emptyDraftLine()]);
  const removeDraftLine = (tempId: string) => setDraftLines((current) => current.filter((line) => line.tempId !== tempId));

  const submitCreate = async () => {
    const warehouse = warehouses.find((entry) => entry.id === draftWarehouseId);
    const customer = clients.find((entry) => entry.id === draftCustomerId);
    const lines = draftLines
      .filter((line) => line.itemId && line.colorName && Number(line.requestedRollCount || 0) > 0)
      .map((line) => {
        const item = textileItems.find((entry) => entry.id === line.itemId);
        return {
          itemId: line.itemId,
          itemName: item?.name,
          colorId: line.colorId || undefined,
          colorName: line.colorName,
          requestedRollCount: Number(line.requestedRollCount || 0),
          baseUom: item?.textileBaseUom || 'meter',
          textileUnitPricePerLength: Number(line.textileUnitPricePerLength || 0),
        };
      });
    if (!warehouse || !customer || !lines.length) {
      alert('أكمل بيانات العميل والمستودع وخط واحد على الأقل.');
      return;
    }
    await apiRequest('textile/dispatches', {
      method: 'POST',
      body: JSON.stringify({
        customerId: customer.id,
        customerName: customer.name,
        warehouseId: warehouse.id,
        notes: draftNotes,
        lines,
      }),
    });
    setCreateOpen(false);
    resetDraft();
    await loadDispatches();
  };

  const sendDispatch = async (id: string) => {
    await apiRequest(`textile/dispatches/${id}/send`, { method: 'POST' });
    await loadDispatches();
  };

  const approveDispatch = async (id: string) => {
    await apiRequest(`textile/dispatches/${id}/approve`, { method: 'POST' });
    await loadDispatches();
  };

  const rejectDispatch = async (id: string) => {
    const reason = window.prompt('سبب الرفض');
    if (!reason) return;
    await apiRequest(`textile/dispatches/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
    await loadDispatches();
  };

  const convertDispatch = async (id: string) => {
    const result = await apiRequest(`textile/dispatches/${id}/convert-to-invoice`, { method: 'POST', body: JSON.stringify({ paymentType: 'cash' }) });
    alert(`تم إنشاء فاتورة البيع رقم ${result?.invoiceNumber || ''}`);
    await loadDispatches();
  };

  const printDispatch = async (id: string) => {
    const payload = await apiRequest(`textile/dispatches/${id}/print-payload`);
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    const lineRows = (payload?.lines || []).map((line: any) => `
      <tr>
        <td>${line.itemName || ''}</td>
        <td>${line.colorName || ''}</td>
        <td>${line.requestedRollCount || 0}</td>
        <td>${line.fulfilledRollCount || 0}</td>
        <td>${line.fulfilledTotalLength || 0} ${line.baseUom === 'yard' ? 'ياردة' : 'متر'}</td>
        <td>${(line.decomposition || []).map((entry: any) => `${entry.sequence}. ${entry.lengthValue} ${entry.unit === 'yard' ? 'ياردة' : 'متر'}`).join('<br/>')}</td>
      </tr>
    `).join('');
    printWindow.document.write(`
      <html dir="rtl"><head><title>سند تحضير قماشي</title><style>
      body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #ccc;padding:8px;text-align:right;vertical-align:top}
      h1{margin:0 0 8px}
      </style></head><body>
      <h1>سند تحضير قماشي ${payload.dispatchNumber || ''}</h1>
      <div>العميل: ${payload.customerName || '-'}</div>
      <div>المستودع: ${payload.warehouseName || '-'}</div>
      <div>الحالة: ${payload.status || '-'}</div>
      <div>المحضّر: ${payload.preparedByName || '-'}</div>
      <table><thead><tr><th>الصنف</th><th>اللون</th><th>المطلوب</th><th>المحضّر</th><th>الطول</th><th>تفكيك الرولات</th></tr></thead><tbody>${lineRows}</tbody></table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const submitPreparation = async () => {
    if (!selectedDispatch) return;
    await apiRequest(`textile/dispatches/${selectedDispatch.id}/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        lines: prepLines.map((line) => ({
          lineId: line.lineId,
          decomposition: line.decomposition.map((entry) => ({
            sequence: entry.sequence,
            lengthValue: Number(entry.lengthValue || 0),
            unit: entry.unit,
            rollLabel: entry.rollLabel || undefined,
          })),
        })),
      }),
    });
    setPrepareOpen(false);
    setSelectedDispatch(null);
    await loadDispatches();
  };

  const prepSummary = (lineId: string) => {
    const line = prepLines.find((entry) => entry.lineId === lineId);
    const count = line?.decomposition.filter((entry) => Number(entry.lengthValue || 0) > 0).length || 0;
    const total = line?.decomposition.reduce((sum, entry) => sum + Number(entry.lengthValue || 0), 0) || 0;
    return { count, total };
  };

  const setPrepValue = (lineId: string, index: number, value: string) => {
    setPrepLines((current) => current.map((line) => (
      line.lineId !== lineId
        ? line
        : {
            ...line,
            decomposition: line.decomposition.map((entry, entryIndex) => (
              entryIndex === index ? { ...entry, lengthValue: value } : entry
            )),
          }
    )));
  };

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="max-w-[1550px] py-4 md:py-6">
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900">{approvalMode ? 'اعتماد تحضير الأقمشة' : 'سندات تحضير الأقمشة'}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {approvalMode ? 'مراجعة التفكيك الفعلي للرولات قبل تحويله إلى فاتورة بيع.' : 'حلقة الربط بين المبيعات المكتبية وإطلاق الرولات من المستودع.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!approvalMode && canCreateDispatch && (
                <button onClick={() => { resetDraft(); setCreateOpen(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">
                  <FilePlus2 size={16} />
                  سند جديد
                </button>
              )}
              <button onClick={() => void loadDispatches()} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                تحديث
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم السند أو العميل أو المستودع"
              className="min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-primary"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-primary"
            >
              {statusOptions
                .filter((option) => !approvalMode || ['', 'awaiting_approval', 'approved', 'rejected', 'converted_to_invoice'].includes(option.value))
                .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600">
              {filteredDispatches.length} سند
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <AdaptiveTable
            rows={filteredDispatches}
            keyExtractor={(row) => row.id}
            emptyState={<div className="p-10 text-center font-bold text-slate-400">لا توجد سندات مطابقة.</div>}
            columns={[
              { id: 'number', header: 'السند', cell: (row: TextileDispatchNotice) => <span className="font-black text-slate-900">{row.dispatchNumber}</span> },
              { id: 'customer', header: 'العميل', cell: (row: TextileDispatchNotice) => <span className="font-bold">{row.customerName || '-'}</span> },
              { id: 'warehouse', header: 'المستودع', cell: (row: TextileDispatchNotice) => <span className="font-semibold">{row.warehouseName || '-'}</span> },
              { id: 'status', header: 'الحالة', cell: (row: TextileDispatchNotice) => <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{row.status}</span> },
              {
                id: 'actions',
                header: 'إجراءات',
                cell: (row: TextileDispatchNotice) => (
                  <div className="flex flex-wrap gap-2">
                    {!approvalMode && canConfirmPreparation && row.status === 'draft' && (
                      <button onClick={() => void sendDispatch(row.id)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">
                        <Send size={14} className="inline ml-1" /> إرسال
                      </button>
                    )}
                    {!approvalMode && canOpenDispatch && canPrepareDispatch && ['sent_to_warehouse', 'in_preparation', 'rejected'].includes(row.status) && (
                      <button onClick={() => void openPrepare(row.id)} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white">تحضير</button>
                    )}
                    {canApproveDispatches && ['awaiting_approval', 'prepared'].includes(row.status) && (
                      <>
                        <button onClick={() => void approveDispatch(row.id)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
                          <CheckCircle2 size={14} className="inline ml-1" /> اعتماد
                        </button>
                        <button onClick={() => void rejectDispatch(row.id)} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white">
                          <XCircle size={14} className="inline ml-1" /> رفض
                        </button>
                      </>
                    )}
                    {canConvertDispatches && row.status === 'approved' && (
                      <button onClick={() => void convertDispatch(row.id)} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">تحويل لفاتورة</button>
                    )}
                    {canPrintDispatches && (
                      <button onClick={() => void printDispatch(row.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                      <Printer size={14} className="inline ml-1" /> طباعة
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            mobileCardRender={(row: TextileDispatchNotice) => (
              <div className="space-y-3">
                <div>
                  <div className="font-black text-slate-900">{row.dispatchNumber}</div>
                  <div className="text-sm font-bold text-slate-600">{row.customerName || '-'}</div>
                  <div className="text-xs font-semibold text-slate-500">{row.warehouseName || '-'}</div>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-2 text-center text-xs font-bold">{row.status}</div>
                <div className="flex flex-wrap gap-2">
                  {!approvalMode && canConfirmPreparation && row.status === 'draft' && (
                    <button onClick={() => void sendDispatch(row.id)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">إرسال</button>
                  )}
                  {!approvalMode && canOpenDispatch && canPrepareDispatch && ['sent_to_warehouse', 'in_preparation', 'rejected'].includes(row.status) && (
                    <button onClick={() => void openPrepare(row.id)} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white">تحضير</button>
                  )}
                  {canApproveDispatches && ['awaiting_approval', 'prepared'].includes(row.status) && (
                    <>
                      <button onClick={() => void approveDispatch(row.id)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">اعتماد</button>
                      <button onClick={() => void rejectDispatch(row.id)} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white">رفض</button>
                    </>
                  )}
                  {canConvertDispatches && row.status === 'approved' && (
                    <button onClick={() => void convertDispatch(row.id)} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">تحويل</button>
                  )}
                  {canPrintDispatches && (
                    <button onClick={() => void printDispatch(row.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">طباعة</button>
                  )}
                </div>
              </div>
            )}
          />
        </div>
      </div>

      <AdaptiveModal open={createOpen && canCreateDispatch} onClose={() => setCreateOpen(false)} size="xl" panelClassName="flex h-full max-h-[92vh] flex-col">
        <div className="flex h-full flex-col bg-white p-5">
          <h3 className="text-xl font-black text-slate-900">إنشاء سند تحضير قماشي</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">العميل</label>
              <Combobox items={clients.map((client) => ({ id: client.id, label: client.name }))} selectedId={draftCustomerId} onSelect={setDraftCustomerId} placeholder="اختر العميل" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">المستودع</label>
              <select value={draftWarehouseId} onChange={(e) => setDraftWarehouseId(e.target.value)} className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-primary">
                <option value="">اختر المستودع</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </div>
          </div>
          <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="ملاحظات" className="mt-3 min-h-[90px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-bold outline-none focus:border-primary" />

          <div className="mt-4 flex-1 space-y-3 overflow-auto">
            {draftLines.map((line) => {
              const selectedItem = textileItems.find((item) => item.id === line.itemId);
              return (
                <div key={line.tempId} className="rounded-2xl border border-slate-200 p-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-500">الصنف</label>
                      <Combobox
                        items={textileItems.map((item) => ({ id: item.id, label: item.name, subLabel: item.code }))}
                        selectedId={line.itemId}
                        onSelect={(id) => updateDraftLine(line.tempId, { itemId: id })}
                        placeholder="صنف قماشي"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-500">اللون</label>
                      <Combobox
                        items={colors.map((color) => ({ id: color.id, label: color.name }))}
                        selectedId={line.colorId}
                        onSelect={(id, name) => updateDraftLine(line.tempId, { colorId: id, colorName: colors.find((entry) => entry.id === id)?.name || name || '' })}
                        allowCustomValue
                        placeholder="لون"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-500">الرولات المطلوبة</label>
                      <input value={line.requestedRollCount} onChange={(e) => updateDraftLine(line.tempId, { requestedRollCount: e.target.value })} type="number" className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-500">سعر {selectedItem?.textileBaseUom === 'yard' ? 'الياردة' : 'المتر'}</label>
                      <input value={line.textileUnitPricePerLength} onChange={(e) => updateDraftLine(line.tempId, { textileUnitPricePerLength: e.target.value })} type="number" step="0.0001" className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div className="mt-3 flex justify-between">
                    <div className="text-xs font-bold text-slate-500">وحدة الطول: {selectedItem?.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}</div>
                    {draftLines.length > 1 && <button onClick={() => removeDraftLine(line.tempId)} className="text-xs font-bold text-rose-600">حذف السطر</button>}
                  </div>
                </div>
              );
            })}
            <button onClick={addDraftLine} className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-bold text-slate-700">إضافة سطر</button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className="rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-700">إغلاق</button>
            <button onClick={() => void submitCreate()} className="rounded-2xl bg-slate-900 px-4 py-3 font-bold text-white">حفظ السند</button>
          </div>
        </div>
      </AdaptiveModal>

      <AdaptiveModal open={prepareOpen && canOpenDispatch && canPrepareDispatch} onClose={() => setPrepareOpen(false)} size="xl" panelClassName="flex h-full max-h-[94vh] flex-col">
        <div className="flex h-full flex-col bg-white p-5">
          <h3 className="text-xl font-black text-slate-900">تحضير الرولات</h3>
          <div className="mt-4 flex-1 space-y-4 overflow-auto">
            {(selectedDispatch?.lines || []).map((line) => {
              const prep = prepLines.find((entry) => entry.lineId === String(line.id));
              const summary = prepSummary(String(line.id));
              return (
                <div key={line.id} className="rounded-3xl border border-slate-200 p-4">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-black text-slate-900">{line.itemName}</div>
                      <div className="text-sm font-bold text-sky-700">{line.colorName}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">المطلوب: {line.requestedRollCount} رول</span>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">مدخل: {summary.count}/{line.requestedRollCount}</span>
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">المجموع: {summary.total.toFixed(2)} {line.baseUom === 'yard' ? 'ياردة' : 'متر'}</span>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(prep?.decomposition || []).map((entry, index) => {
                      const refKey = `${line.id}-${index}`;
                      return (
                        <div key={refKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="mb-2 text-xs font-bold text-slate-500">رول {index + 1}</div>
                          <input
                            ref={(node) => { inputRefs.current[refKey] = node; }}
                            value={entry.lengthValue}
                            onChange={(e) => setPrepValue(String(line.id), index, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                inputRefs.current[`${line.id}-${index + 1}`]?.focus();
                              }
                            }}
                            type="number"
                            step="0.01"
                            className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-center text-lg font-black font-numeric outline-none focus:border-primary"
                            placeholder={`الطول بـ${line.baseUom === 'yard' ? 'الياردة' : 'المتر'}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setPrepareOpen(false)} className="rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-700">إغلاق</button>
            {canPrepareDispatch && (
              <button onClick={() => void submitPreparation()} className="rounded-2xl bg-amber-600 px-4 py-3 font-bold text-white">تأكيد التحضير</button>
            )}
          </div>
        </div>
      </AdaptiveModal>
    </ResponsivePage>
  );
};

export default TextileDispatches;
