import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Save, Send, Loader2, FileText } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Client, ConsignmentDocument, InventoryItem } from '../../types';

interface OpenLine {
  id: string;
  documentId: string;
  itemId: string;
  itemName?: string;
  remainingQty: number;
  /** الكمية الأصلية من سند الأمانة */
  originalQty?: number;
  baseQty?: number;
  settledSoldQty?: number;
  settledReturnedQty?: number;
  unitId?: string;
  unitName?: string;
  unitPrice?: number;
  customSalePrice?: number;
  commissionAmount?: number;
  serialNumbers?: string[] | string;
}

interface SettlementFormProps {
  clients: Client[];
  preselectedDocumentId?: string;
  onClose: () => void;
  onSaved: () => void;
  /** When true, render as full-width page instead of modal */
  fullPage?: boolean;
  onBack?: () => void;
  /** Optional: resolve item names for open lines */
  items?: InventoryItem[];
}

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('shamel_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const SettlementForm: React.FC<SettlementFormProps> = ({
  clients,
  preselectedDocumentId,
  onClose,
  onSaved,
  fullPage = false,
  onBack,
  items = [],
}) => {
  const [documents, setDocuments] = useState<ConsignmentDocument[]>([]);
  const [documentId, setDocumentId] = useState(preselectedDocumentId || '');
  const [openLines, setOpenLines] = useState<OpenLine[]>([]);
  const [settlementNumber, setSettlementNumber] = useState('');
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineQtys, setLineQtys] = useState<Record<string, { sold: number; returned: number }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest('consignments?status=POSTED')
      .then((res: any) => setDocuments(Array.isArray(res) ? res : []))
      .catch(() => setDocuments([]));
  }, []);

  useEffect(() => {
    apiRequest('consignment-settlements/next-number')
      .then((res: any) => setSettlementNumber(String((res as any)?.number || '1')))
      .catch(() => setSettlementNumber('1'));
  }, []);

  useEffect(() => {
    if (preselectedDocumentId) setDocumentId(preselectedDocumentId);
  }, [preselectedDocumentId]);

  useEffect(() => {
    if (!documentId) {
      setOpenLines([]);
      setLineQtys({});
      return;
    }
    setLoading(true);
    apiRequest(`consignments/${documentId}/open-lines`)
      .then((res: any) => {
        const arr = Array.isArray(res) ? res : [];
        const withNames = arr.map((l: any) => ({
          ...l,
          itemName: l.itemName || items.find((i) => i.id === l.itemId)?.name || l.itemId,
          originalQty: l.originalQty ?? l.baseQty ?? l.remainingQty,
          settledSoldQty: l.settledSoldQty ?? 0,
          settledReturnedQty: l.settledReturnedQty ?? 0,
          unitPrice: l.unitPrice ?? l.customSalePrice,
          commissionAmount: l.commissionAmount ?? 0,
        }));
        setOpenLines(withNames);
        setLineQtys(
          withNames.reduce(
            (acc: Record<string, { sold: number; returned: number }>, l: OpenLine) => {
              acc[l.id] = { sold: 0, returned: 0 };
              return acc;
            },
            {}
          )
        );
      })
      .catch(() => setOpenLines([]))
      .finally(() => setLoading(false));
  }, [documentId, items]);

  const doc = documents.find((d) => d.id === documentId);
  const partyName = doc ? clients.find((c) => c.id === doc.partyId)?.name || doc.partyId : '';

  const setQty = useCallback((lineId: string, field: 'sold' | 'returned', value: number) => {
    setLineQtys((prev) => {
      const line = openLines.find((l) => l.id === lineId);
      const remaining = Number(line?.remainingQty ?? 0);
      const current = prev[lineId] || { sold: 0, returned: 0 };
      const other = field === 'sold' ? current.returned : current.sold;
      const clamped = Math.max(0, Math.min(remaining - other, value));
      return {
        ...prev,
        [lineId]: { ...prev[lineId], [field]: clamped },
      };
    });
  }, [openLines]);

  const buildLines = () => {
    const out: { documentLineId: string; actionType: 'SOLD' | 'RETURNED'; qty: number }[] = [];
    openLines.forEach((line) => {
      const q = lineQtys[line.id] || { sold: 0, returned: 0 };
      if (q.sold > 0) out.push({ documentLineId: line.id, actionType: 'SOLD', qty: q.sold });
      if (q.returned > 0) out.push({ documentLineId: line.id, actionType: 'RETURNED', qty: q.returned });
    });
    return out;
  };

  const handleSave = async (andPost: boolean) => {
    setError(null);
    if (!documentId || !settlementNumber || !settlementDate) {
      setError('السند ورقم التسوية والتاريخ مطلوبة.');
      return;
    }
    const lines = buildLines();
    if (lines.length === 0) {
      setError('أضف كمية مباع أو مرتجع في سطر واحد على الأقل.');
      return;
    }
    setSaving(true);
    try {
      const user = getStoredUser();
      const res: any = await apiRequest('consignment-settlements', {
        method: 'POST',
        body: JSON.stringify({
          settlementNumber,
          documentId,
          settlementDate,
          createdBy: user?.name || user?.username || 'user',
          lines,
        }),
      });
      const createdId = res?.id;
      if (andPost && createdId) {
        await apiRequest(`consignment-settlements/${createdId}/post`, {
          method: 'POST',
          body: JSON.stringify({ userId: user?.id || 'user' }),
        });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const totalSold = openLines.reduce((s, l) => s + (lineQtys[l.id]?.sold ?? 0), 0);
  const totalReturned = openLines.reduce((s, l) => s + (lineQtys[l.id]?.returned ?? 0), 0);
  const backOrClose = onBack || onClose;

  const content = (
    <div className={`flex flex-col ${fullPage ? 'min-h-0 flex-1' : ''}`} dir="rtl">
      <div className="flex items-center justify-between shrink-0 p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          {fullPage && (
            <button
              type="button"
              onClick={backOrClose}
              className="flex items-center gap-1 p-2 rounded-xl hover:bg-gray-100 text-gray-600 font-bold"
            >
              <ChevronRight size={22} />
              رجوع
            </button>
          )}
          <h2 className="text-xl font-bold text-gray-900">تسوية أمانة جديدة</h2>
          {!fullPage && (
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">{error}</div>
        )}

        {/* Header: document + settlement info */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-6">
          <h3 className="text-sm font-bold text-gray-500 mb-4">بيانات التسوية</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-2">سند الأمانة</label>
              <select
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
              >
                <option value="">— اختر السند —</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.documentNumber} — {clients.find((c) => c.id === d.partyId)?.name || d.partyId}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-2">الطرف (من السند)</label>
              <div className="px-4 py-3 bg-white rounded-xl border border-gray-200 font-bold text-gray-800">
                {partyName || '—'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-2">رقم التسوية</label>
              <input
                type="text"
                value={settlementNumber}
                onChange={(e) => setSettlementNumber(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-2">التاريخ</label>
              <input
                type="date"
                value={settlementDate}
                onChange={(e) => setSettlementDate(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
              />
            </div>
          </div>
        </div>

        {/* Parent document summary — accounting context */}
        {documentId && doc && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-bold text-gray-500 mb-3">السند المرتبط (سند الأمانة)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-gray-500">رقم السند</span>
                <div className="font-bold font-numeric text-teal-800">{doc.documentNumber}</div>
              </div>
              <div>
                <span className="text-gray-500">الطرف</span>
                <div className="font-bold text-gray-800">{partyName || '—'}</div>
              </div>
              <div>
                <span className="text-gray-500">التاريخ</span>
                <div className="font-numeric text-gray-800">{doc.issueDate ? doc.issueDate.slice(0, 10) : '—'}</div>
              </div>
              <div>
                <span className="text-gray-500">الحالة</span>
                <div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${doc.status === 'POSTED' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                    {doc.status === 'POSTED' ? 'مرحّل' : doc.status || '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-teal-600" size={36} />
          </div>
        )}

        {!loading && openLines.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-bold text-gray-800">الأسطر المفتوحة — إدخال المباع والمرتجع</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="p-2 font-bold text-gray-700 min-w-[160px]">المادة</th>
                    <th className="p-2 font-bold text-gray-700 w-20">الوحدة</th>
                    <th className="p-2 font-bold text-gray-700 w-20">الكمية الأصلية</th>
                    <th className="p-2 font-bold text-gray-700 w-20">المباع سابقاً</th>
                    <th className="p-2 font-bold text-gray-700 w-20">المرتجع سابقاً</th>
                    <th className="p-2 font-bold text-gray-700 w-20">المتبقي</th>
                    <th className="p-2 font-bold text-gray-700 w-24">المباع الآن</th>
                    <th className="p-2 font-bold text-gray-700 w-24">المرتجع الآن</th>
                    <th className="p-2 font-bold text-gray-700 w-20">سعر البيع</th>
                    <th className="p-2 font-bold text-gray-700 w-20">العمولة</th>
                    <th className="p-2 font-bold text-gray-700 min-w-[100px]">السيريالات</th>
                  </tr>
                </thead>
                <tbody>
                  {openLines.map((line) => (
                    <tr key={line.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="p-2 font-medium text-gray-800">{line.itemName || line.itemId}</td>
                      <td className="p-2 text-gray-600">{line.unitName || '—'}</td>
                      <td className="p-2 font-numeric">{line.originalQty ?? line.baseQty ?? '—'}</td>
                      <td className="p-2 font-numeric text-gray-600">{line.settledSoldQty ?? 0}</td>
                      <td className="p-2 font-numeric text-gray-600">{line.settledReturnedQty ?? 0}</td>
                      <td className="p-2">
                        <span className="inline-block px-2 py-1 rounded bg-amber-50 border border-amber-200 font-numeric font-bold text-amber-900">
                          {line.remainingQty}
                        </span>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          max={line.remainingQty}
                          value={lineQtys[line.id]?.sold ?? 0}
                          onChange={(e) => setQty(line.id, 'sold', Number(e.target.value) || 0)}
                          className="w-full min-w-[72px] px-2 py-1.5 border border-gray-200 rounded font-numeric"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          max={line.remainingQty}
                          value={lineQtys[line.id]?.returned ?? 0}
                          onChange={(e) => setQty(line.id, 'returned', Number(e.target.value) || 0)}
                          className="w-full min-w-[72px] px-2 py-1.5 border border-gray-200 rounded font-numeric"
                        />
                      </td>
                      <td className="p-2 font-numeric text-gray-700">{line.unitPrice ?? line.customSalePrice ?? '—'}</td>
                      <td className="p-2 font-numeric text-gray-700">{line.commissionAmount ?? '—'}</td>
                      <td className="p-2 text-gray-600 text-xs">
                        {Array.isArray(line.serialNumbers) ? line.serialNumbers.join(', ') : typeof line.serialNumbers === 'string' ? line.serialNumbers : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center gap-4 text-sm font-bold text-gray-800">
              <span className="font-numeric">إجمالي الكمية المباعة الآن: {totalSold}</span>
              <span className="font-numeric">إجمالي الكمية المرتجعة الآن: {totalReturned}</span>
            </div>
          </div>
        )}

        {!loading && documentId && openLines.length === 0 && (
          <div className="p-6 rounded-2xl border border-gray-200 bg-gray-50 text-center text-gray-600 font-bold">
            لا توجد أسطر مفتوحة لهذا السند (المتبقي = 0).
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-3 p-4 border-t border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? 'جاري الحفظ...' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          {saving ? 'جاري الترحيل...' : 'ترحيل'}
        </button>
        <button
          type="button"
          onClick={backOrClose}
          className="px-5 py-2.5 border border-gray-300 rounded-xl font-bold hover:bg-gray-50"
        >
          إلغاء
        </button>
      </div>
    </div>
  );

  if (fullPage) {
    return (
      <div className="w-full max-w-[95vw] xl:max-w-5xl mx-auto flex flex-col min-h-0 rounded-2xl border border-gray-200 bg-white shadow-lg">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[90vw] max-h-[90vh] flex flex-col min-h-[80vh] overflow-hidden">
        {content}
      </div>
    </div>
  );
};

export default SettlementForm;
