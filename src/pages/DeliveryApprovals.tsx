import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, XCircle, Search, FileText, Filter, X, Printer } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import Combobox from '../components/Combobox';
import { AppUser, AppSettings, Client, DeliveryNotice, DeliveryNoticeItem, Warehouse } from '../types';
import { AdaptiveModal } from '../components/responsive';
import { isTextileModeEnabled } from '../lib/textileMode';

const DeliveryApprovals: React.FC<{ settings?: AppSettings }> = ({ settings }) => {
  const [pending, setPending] = useState<DeliveryNotice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [selected, setSelected] = useState<DeliveryNotice | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const storedUser = localStorage.getItem('shamel_user');
  const currentUser: AppUser | null = storedUser ? JSON.parse(storedUser) : null;
  const textileModeEnabled = isTextileModeEnabled(settings);

  const loadPending = async () => {
    try {
      const data = await apiRequest('delivery-notices?status=SUBMITTED');
      setPending(data || []);
    } catch (e) { alert('فشل تحميل إشعارات التسليم'); }
  };

  const loadWarehouses = async () => {
    try {
      const data = await apiRequest('warehouses');
      setWarehouses(data || []);
    } catch {}
  };

  const loadClients = async () => {
    try {
      const data = await apiRequest('clients');
      setClients(data || []);
    } catch {}
  };

  useEffect(() => { loadPending(); loadWarehouses(); loadClients(); }, []);

  useEffect(() => {
    let lastIds = new Set<string>((pending || []).map(n => String(n.id)));
    const poll = async () => {
      try {
        const data = await apiRequest('delivery-notices?status=SUBMITTED');
        const next = data || [];
        const nextIds = new Set<string>(next.map((n: DeliveryNotice) => String(n.id)));
        next.forEach((n: DeliveryNotice) => {
          if (!lastIds.has(n.id)) {
            alert(`إشعار تسليم جديد: ${n.warehouseName || ''} - ${n.createdByName || ''}`);
          }
        });
        lastIds = nextIds;
        setPending(next);
      } catch {}
    };
    const id = window.setInterval(poll, 15000);
    return () => window.clearInterval(id);
  }, [pending]);

  const filtered = useMemo(() => {
    const q = (searchTerm || '').toLowerCase();
    return (pending || []).filter(n => {
      const matchWarehouse = !filterWarehouse || n.warehouseId === filterWarehouse;
      const matchText =
        (n.id || '').toLowerCase().includes(q) ||
        (n.receiverName || '').toLowerCase().includes(q) ||
        (n.warehouseName || '').toLowerCase().includes(q);
      return matchWarehouse && matchText;
    });
  }, [pending, filterWarehouse, searchTerm]);

  const updateSelectedItem = (idx: number, field: keyof DeliveryNoticeItem, value: any) => {
    if (!selected) return;
    const items = [...(selected.items || [])];
    items[idx] = { ...items[idx], [field]: value };
    setSelected({ ...selected, items });
  };

  const selectedTotals = useMemo(() => {
    const items = (selected?.items || []) as DeliveryNoticeItem[];
    const summaryMap = new Map<string, { key: string; name: string; quantity: number; lines: number[] }>();
    items.forEach((it, idx) => {
      const key = it.itemId || it.itemName || `row-${idx}`;
      const name = it.itemName || 'بدون اسم';
      const qty = Number(it.quantity || 0);
      const existing = summaryMap.get(key);
      if (existing) {
        existing.quantity += qty;
        existing.lines.push(qty);
      } else {
        summaryMap.set(key, { key, name, quantity: qty, lines: [qty] });
      }
    });
    const summary = Array.from(summaryMap.values());
    const totalQty = summary.reduce((sum, it) => sum + it.quantity, 0);
    const distinctItems = summary.length;
    const lineCount = items.length;
    const maxLines = summary.reduce((max, s) => Math.max(max, s.lines.length), 0);
    return { summary, totalQty, distinctItems, lineCount, maxLines };
  }, [selected?.items]);

  const handleConfirm = async () => {
    if (!selected) return;
    const incompleteTextile = (selected.items || []).some((item) => (
      textileModeEnabled && item.isTextile
      && (
        !Array.isArray(item.textileDecomposition)
        || item.textileDecomposition.length !== Number(item.textileRollCount || item.quantity || 0)
        || item.textileDecomposition.some((entry) => Number(entry.length || 0) <= 0)
      )
    ));
    if (incompleteTextile) {
      alert('لا يمكن اعتماد إشعار الأقمشة قبل استكمال تفكيك الرولات.');
      return;
    }
    if (selected.convertToInvoice && !selected.receiverId) {
      alert('يرجى اختيار عميل قبل التحويل لفاتورة بيع');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest(`delivery-notices/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...selected,
          updatedById: currentUser?.id,
          updatedByName: currentUser?.name || currentUser?.username
        })
      });

      const res = await apiRequest(`delivery-notices/${selected.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          confirmedById: currentUser?.id,
          confirmedByName: currentUser?.name || currentUser?.username,
          managerNotes: selected.managerNotes,
          referenceNumber: selected.referenceNumber,
          operationType: selected.operationType,
          convertToInvoice: !!selected.convertToInvoice,
          receiverId: selected.receiverId,
          receiverName: selected.receiverName,
          invoiceNumber: selected.referenceNumber
        })
      });

      if (res?.linkedInvoiceId) alert(`تم إنشاء فاتورة بيع: ${res.linkedInvoiceId}`);
      setSelected(null);
      await loadPending();
    } catch (e: any) {
      const err = e.response?.data;
      if (err?.error === 'INSUFFICIENT_STOCK') {
        alert('لا توجد كمية كافية لبعض المواد.');
      } else {
        alert(err?.error || 'فشل الاعتماد');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selected || !rejectReason) return;
    setIsSubmitting(true);
    try {
      await apiRequest(`delivery-notices/${selected.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          rejectedById: currentUser?.id,
          rejectedByName: currentUser?.name || currentUser?.username,
          reason: rejectReason
        })
      });
      setIsRejectOpen(false);
      setRejectReason('');
      setSelected(null);
      await loadPending();
    } catch (e: any) {
      alert(e.response?.data?.error || 'فشل الرفض');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = (notice: DeliveryNotice) => {
    const itemsHtml = (notice.items || []).map(i =>
      `<tr><td>${i.itemName}</td><td>${i.textileColorName || '-'}</td><td>${i.isTextile ? (i.textileRollCount || i.quantity || 0) : i.quantity}</td><td>${i.isTextile ? `${i.textileTotalLength || 0} ${i.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}` : (i.unitName || '')}</td><td>${Array.isArray(i.textileDecomposition) ? i.textileDecomposition.map((entry) => `${entry.idx}. ${entry.length}`).join('<br/>') : '-'}</td><td>${i.notes || ''}</td></tr>`
    ).join('');
    const html = `
      <html><head><title>إشعار تسليم</title>
      <style>body{font-family:Arial;direction:rtl;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}</style>
      </head><body>
      <h2>إشعار تسليم</h2>
      <p>الرقم: ${notice.id}</p>
      <p>المستودع: ${notice.warehouseName || ''}</p>
      <p>المستلم: ${notice.receiverName || ''}</p>
      <table><thead><tr><th>الصنف</th><th>اللون</th><th>الرولات</th><th>الطول/الوحدة</th><th>التفكيك</th><th>ملاحظات</th></tr></thead>
      <tbody>${itemsHtml}</tbody></table>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.print();
    }
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 text-emerald-600 p-3 rounded-2xl"><FileText size={24}/></div>
          <div>
            <h2 className="text-2xl font-black text-gray-900">اعتماد إشعارات التسليم</h2>
            <p className="text-xs text-gray-400 font-bold uppercase mt-1">إشعارات بانتظار الاعتماد</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500 font-bold">
          <Filter size={16}/> إجمالي المعلقة: {pending.length}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-4 top-3.5 text-gray-400" size={18}/>
          <input
            type="text"
            placeholder="بحث بالرقم أو المستلم..."
            className="w-full pr-12 pl-4 py-3 bg-white border border-gray-200 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-primary/20 outline-none"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <select value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)} className="bg-white border rounded-2xl px-4 py-3 font-bold">
          <option value="">كل المستودعات</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 text-right">الرقم</th>
              <th className="p-4 text-right">المستودع</th>
              <th className="p-4 text-right">المستلم</th>
              <th className="p-4 text-center">الأصناف</th>
              <th className="p-4 text-center">أرسل بواسطة</th>
              <th className="p-4 text-center">فتح</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-gray-400">لا توجد إشعارات معلقة</td></tr>
            ) : (
              filtered.map(n => (
                <tr key={n.id} className="border-t hover:bg-gray-50">
                  <td className="p-4 font-mono font-bold">{n.id}</td>
                  <td className="p-4">{n.warehouseName}</td>
                  <td className="p-4">{n.receiverName || '-'}</td>
                  <td className="p-4 text-center font-bold">{(n.items || []).length}</td>
                  <td className="p-4 text-center">{n.createdByName || '-'}</td>
                  <td className="p-4 text-center">
                    <button onClick={() => setSelected(n)} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition">فتح</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <AdaptiveModal open={!!selected} onClose={() => setSelected(null)} size="xl" zIndex={200} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            <div className="p-6 bg-gray-900 text-white flex items-center justify-between">
              <h3 className="font-black text-lg">تفاصيل إشعار {selected.id}</h3>
              <button onClick={() => setSelected(null)} className="p-2 bg-white/10 rounded-full hover:bg-red-500 transition"><X size={20}/></button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500">المستودع</label>
                  <div className="font-bold bg-gray-50 p-2 rounded">{selected.warehouseName}</div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">المستلم</label>
                  <input value={selected.receiverName || ''} onChange={e => setSelected({ ...selected, receiverName: e.target.value })} className="w-full border rounded p-2 font-bold" />
                </div>
                {selected.convertToInvoice && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold text-gray-500">اختيار عميل (لتحويل الفاتورة)</label>
                    <Combobox
                      items={clients.filter(c => c.type === 'CUSTOMER' || c.type === 'BOTH').map(c => ({ id: c.id, label: c.name, subLabel: c.phone }))}
                      selectedId={selected.receiverId || ''}
                      onSelect={(id) => {
                        const c = clients.find(x => x.id === id);
                        setSelected({ ...selected, receiverId: id, receiverName: c?.name || selected.receiverName });
                      }}
                      placeholder="اختر عميل..."
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-gray-500">نوع العملية</label>
                  <select value={selected.operationType || ''} onChange={e => setSelected({ ...selected, operationType: e.target.value })} className="w-full border rounded p-2 font-bold">
                    <option value="">اختر</option>
                    <option value="customer_delivery">تسليم عميل</option>
                    <option value="internal_issue">صرف داخلي</option>
                    <option value="driver_delivery">تسليم مندوب</option>
                    <option value="sample">عينة</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">رقم مرجعي</label>
                  <input value={selected.referenceNumber || ''} onChange={e => setSelected({ ...selected, referenceNumber: e.target.value })} className="w-full border rounded p-2 font-bold" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-gray-500">ملاحظات المدير</label>
                  <input value={selected.managerNotes || ''} onChange={e => setSelected({ ...selected, managerNotes: e.target.value })} className="w-full border rounded p-2" />
                </div>
                <div className="md:col-span-2 flex items-center gap-3">
                  <input type="checkbox" checked={!!selected.convertToInvoice} onChange={e => setSelected({ ...selected, convertToInvoice: e.target.checked })} />
                  <span className="text-sm font-bold">تحويل إلى فاتورة بيع (اختياري)</span>
                </div>
              </div>

              <div className="bg-white border rounded-2xl overflow-hidden">
                <div className="p-4 border-b flex items-center justify-between">
                  <h4 className="font-black text-gray-800">الأصناف</h4>
                  <div className="text-xs font-bold text-gray-500">عدد الأصناف: {(selected.items || []).length}</div>
                </div>
                {selectedTotals.summary.length > 0 && (
                  <div className="px-4 py-3 border-b bg-white text-xs font-bold text-gray-700">
                    <div className="mb-2 text-gray-800">مجاميع المواد</div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs border-separate border-spacing-2">
                        <thead>
                          <tr>
                            {selectedTotals.summary.map((s) => (
                              <th key={s.key} className="text-center bg-gray-100 rounded px-2 py-1">{s.name || 'بدون اسم'}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: selectedTotals.maxLines }).map((_, rowIdx) => (
                            <tr key={rowIdx}>
                              {selectedTotals.summary.map((s) => (
                                <td key={`${s.key}-${rowIdx}`} className="text-center bg-white border rounded px-2 py-1">{s.lines[rowIdx] ?? '-'}</td>
                              ))}
                            </tr>
                          ))}
                          <tr>
                            {selectedTotals.summary.map((s) => (
                              <td key={`${s.key}-total`} className="text-center font-bold bg-gray-50 rounded px-2 py-1">إجمالي المادة: {s.quantity}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 text-gray-900">الإجمالي العام: {selectedTotals.totalQty}</div>
                  </div>
                )}
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-3 text-right">الصنف</th>
                      <th className="p-3 text-center">اللون</th>
                      <th className="p-3 text-center">الرولات</th>
                      <th className="p-3 text-center">الطول</th>
                      <th className="p-3 text-center">سعر الوحدة</th>
                      <th className="p-3 text-right">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.items || []).map((it, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-3 font-bold">{it.itemName}</td>
                        <td className="p-3 text-center">{it.textileColorName || '-'}</td>
                        <td className="p-3 text-center font-bold">{it.isTextile ? (it.textileRollCount || it.quantity || 0) : it.quantity}</td>
                        <td className="p-3 text-center">
                          {it.isTextile ? (
                            <div className="space-y-1">
                              <div className="font-bold text-emerald-700">{Number(it.textileTotalLength || 0).toFixed(2)} {it.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}</div>
                              <div className="text-[11px] text-gray-500">
                                {Array.isArray(it.textileDecomposition) ? it.textileDecomposition.map((entry) => `${entry.idx}. ${entry.length}`).join(' | ') : '-'}
                              </div>
                            </div>
                          ) : (
                            it.unitName || '-'
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <input type="number" value={it.unitPrice || ''} onChange={e => updateSelectedItem(idx, 'unitPrice', Number(e.target.value))} className="w-28 border rounded p-2 text-center font-bold" />
                        </td>
                        <td className="p-3">
                          <input value={it.notes || ''} onChange={e => updateSelectedItem(idx, 'notes', e.target.value)} className="w-full border rounded p-2 text-sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.audit && selected.audit.length > 0 && (
                <div className="bg-gray-50 border rounded-2xl p-4">
                  <h4 className="font-black text-gray-800 mb-3">سجل النشاط</h4>
                  <div className="space-y-2 text-xs">
                    {selected.audit.map((a, idx) => (
                      <div key={idx} className="flex items-center justify-between border-b pb-2">
                        <div className="font-bold">{a.action} - {a.byName || '-'}</div>
                        <div className="font-numeric text-gray-500">{a.at}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button onClick={() => handlePrint(selected)} className="bg-gray-800 text-white px-5 py-2 rounded-lg font-bold flex items-center gap-2"><Printer size={16}/> طباعة</button>
                <button disabled={isSubmitting} onClick={() => { setIsRejectOpen(true); }} className="bg-red-600 text-white px-5 py-2 rounded-lg font-bold flex items-center gap-2"><XCircle size={16}/> رفض</button>
                <button disabled={isSubmitting} onClick={async () => { if (await confirmDialog('تأكيد الإشعار نهائيًا؟')) handleConfirm(); }} className="bg-emerald-600 text-white px-5 py-2 rounded-lg font-bold flex items-center gap-2"><CheckCircle size={16}/> اعتماد</button>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {isRejectOpen && (
        <AdaptiveModal open={isRejectOpen} onClose={() => setIsRejectOpen(false)} size="md" zIndex={210} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-black text-lg">سبب الرفض</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border rounded p-3" rows={3} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsRejectOpen(false)} className="px-4 py-2 font-bold text-gray-500">إلغاء</button>
              <button disabled={!rejectReason || isSubmitting} onClick={handleReject} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold">رفض</button>
            </div>
          </div>
        </AdaptiveModal>
      )}
    </div>
  );
};

export default DeliveryApprovals;
