import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, Save, Send, Loader2, ListOrdered, Trash2, Lock } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Client, Warehouse, InventoryItem, ConsignmentDocument, ConsignmentDocumentLine } from '../../types';
import Combobox from '../Combobox';
import SerialManagementModal, { removeDuplicateSerials } from './SerialManagementModal';

// ─── Pricing mode: mutual exclusion between Sale Price and Commission % ──────
type PricingMode = 'none' | 'manual' | 'commission';

export interface ConsignmentLineDraft {
  id: string;
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  qty: number;
  baseQty: number;
  /** سعر الأمانة per base unit */
  unitCost: number;
  /** سعر البيع per base unit (manual mode) */
  salePrice: number;
  /** عمولة % (commission mode — mutually exclusive with manual salePrice) */
  commissionPct: number;
  /** which pricing mode is active on this line */
  pricingMode: PricingMode;
  serialNumbers: string[];
  notes?: string;
}

interface ConsignmentDocumentFormProps {
  direction: 'OUT_CUSTOMER' | 'IN_SUPPLIER';
  clients: Client[];
  warehouses: Warehouse[];
  items: InventoryItem[];
  editDoc?: ConsignmentDocument;
  viewDoc?: ConsignmentDocument;
  onClose: () => void;
  onSaved: () => void;
  fullPage?: boolean;
  onBack?: () => void;
  refreshData?: () => Promise<void>;
}

const CURRENCIES = ['USD', 'SYP', 'TRY'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  FULLY_SETTLED: 'مسوّى',
  PARTIALLY_SETTLED: 'قيد التسوية',
  CANCELLED: 'ملغى',
};
const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  POSTED: 'bg-blue-100 text-blue-800',
  FULLY_SETTLED: 'bg-green-100 text-green-800',
  PARTIALLY_SETTLED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-red-100 text-red-700',
};

const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem('shamel_user') || 'null'); }
  catch { return null; }
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const fmt = (n: number, d = 2) => (n % 1 === 0 ? String(n) : n.toFixed(d));

const ConsignmentDocumentForm: React.FC<ConsignmentDocumentFormProps> = ({
  direction, clients, warehouses, items, editDoc, viewDoc,
  onClose, onSaved, fullPage = false, onBack, refreshData,
}) => {
  const isView = !!viewDoc && !editDoc;
  const isCustomer = direction === 'OUT_CUSTOMER';
  const currentDoc = viewDoc || editDoc;
  const docStatus = currentDoc?.status;

  // ─── Header state ──────────────────────────────────────────────────────────
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [consignmentWarehouseId, setConsignmentWarehouseId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');

  // ─── Line state ────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<ConsignmentLineDraft[]>([]);
  const [serialModalIdx, setSerialModalIdx] = useState<number | null>(null);

  // ─── System data ───────────────────────────────────────────────────────────
  const [units, setUnits] = useState<{ id: string; name: string; factor: number; isBase?: boolean; baseUnitId?: string }[]>([]);
  const [addedItems, setAddedItems] = useState<{ id: string; label: string; subLabel?: string }[]>([]);

  // ─── UI state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveAndPost, setSaveAndPost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Refs for keyboard navigation ─────────────────────────────────────────
  const lineRefs = React.useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const focusCell = (row: number, col: string) => {
    const el = lineRefs.current[`${row}-${col}`];
    if (el) { el.focus(); if ('select' in el) (el as HTMLInputElement).select?.(); }
  };

  // ─── Load units ────────────────────────────────────────────────────────────
  useEffect(() => {
    apiRequest('units').then((r: any) => setUnits(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const getUnitFactor = (uid: string) => {
    if (!uid) return 1;
    const u = units.find(x => x.id === uid);
    return u && Number(u.factor) > 0 ? Number(u.factor) : 1;
  };

  const getUnitHelper = (uid: string) => {
    if (!uid) return '';
    const u = units.find(x => x.id === uid);
    if (!u || Number(u.factor) === 1) return '';
    const base = u.baseUnitId ? units.find(x => x.id === u.baseUnitId) : null;
    return `1 ${u.name} = ${u.factor} ${base?.name || 'وحدة'}`;
  };

  // ─── Options ───────────────────────────────────────────────────────────────
  const itemOptions = useMemo(() => [
    ...items.map(i => ({ id: i.id, label: i.name, subLabel: [i.code, (i as any).barcode].filter(Boolean).join(' · ') })),
    ...addedItems,
  ], [items, addedItems]);

  const partyFilter = (c: Client) => isCustomer
    ? /CUSTOMER|BOTH/.test(String(c.type || ''))
    : /SUPPLIER|BOTH/.test(String(c.type || ''));
  const partyOptions = clients.filter(partyFilter).map(c => ({ id: c.id, label: c.name, subLabel: '' }));
  const whOptions = warehouses.map(w => ({ id: w.id, label: w.name, subLabel: '' }));

  // ─── Load header data ──────────────────────────────────────────────────────
  const fetchNextNumber = useCallback(async () => {
    try { setDocumentNumber(String((await apiRequest('consignments/next-number') as any)?.number || Date.now().toString().slice(-6))); }
    catch { setDocumentNumber(Date.now().toString().slice(-6)); }
  }, []);

  useEffect(() => {
    if (currentDoc) {
      setPartyId(currentDoc.partyId || '');
      setConsignmentWarehouseId(currentDoc.consignmentWarehouseId || '');
      setSourceWarehouseId(currentDoc.sourceWarehouseId || '');
      setSupplierReference((currentDoc as any).supplierReference || '');
      setCurrency((currentDoc as any).currency || (currentDoc as any).currencyCode || 'USD');
      setIssueDate((currentDoc.issueDate || '').slice(0, 10));
      setNotes(currentDoc.notes || '');
      setDocumentNumber(currentDoc.documentNumber || '');
      const party = clients.find(c => c.id === currentDoc.partyId);
      if (party) setPartyName(party.name);
    } else {
      fetchNextNumber();
    }
  }, [currentDoc?.id, clients, fetchNextNumber]);

  // ─── Load lines ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentDoc?.id) return;
    apiRequest(`consignments/${currentDoc.id}/lines`)
      .then((res: any) => {
        const arr = Array.isArray(res) ? res : [];
        setLines(arr.map((l: ConsignmentDocumentLine & Record<string, any>) => {
          const unitCost = Number(l.unitCost || 0);
          const salePrice = Number(l.customSalePrice ?? l.salePrice ?? unitCost);
          const commissionPct = Number(l.commissionPct ?? l.commissionPercent ?? 0);
          let pricingMode: PricingMode = 'none';
          if (commissionPct > 0) pricingMode = 'commission';
          else if (salePrice !== unitCost) pricingMode = 'manual';
          return {
            id: l.id,
            itemId: l.itemId,
            itemName: items.find(i => i.id === l.itemId)?.name || l.itemId,
            unitId: l.unitId || '',
            unitName: l.unitName || '',
            qty: Number(l.qty || 0),
            baseQty: Number(l.baseQty || 0),
            unitCost,
            salePrice,
            commissionPct,
            pricingMode,
            serialNumbers: l.serialNumbers
              ? (typeof l.serialNumbers === 'string' ? JSON.parse(l.serialNumbers || '[]') : l.serialNumbers)
              : [],
            notes: l.notes || '',
          };
        }));
      })
      .catch(() => setLines([]));
  }, [currentDoc?.id, items]);

  // ─── Line operations ───────────────────────────────────────────────────────
  const blankLine = (): ConsignmentLineDraft => ({
    id: `line-${Date.now()}-${Math.random()}`,
    itemId: '', itemName: '', unitId: '', unitName: '',
    qty: 0, baseQty: 0, unitCost: 0, salePrice: 0, commissionPct: 0,
    pricingMode: 'none', serialNumbers: [],
  });

  const addLine = () => setLines(prev => [...prev, blankLine()]);

  const updateLine = (index: number, patch: Partial<ConsignmentLineDraft>) => {
    setLines(prev => {
      const next = [...prev];
      const row = { ...next[index] };

      // ── Item selection: inherit defaults from master ──────────────────────
      if (patch.itemId !== undefined) {
        const master = items.find(i => i.id === patch.itemId);
        const added = addedItems.find(a => a.id === patch.itemId);
        row.itemId = patch.itemId;
        row.itemName = master?.name || added?.label || '';
        row.unitId = patch.unitId ?? master?.unitId ?? '';
        row.unitName = patch.unitName ?? master?.unitName ?? '';
        row.unitCost = patch.unitCost ?? Number(master?.costPrice ?? master?.costPriceBase ?? 0);
        row.salePrice = patch.salePrice ?? Number((master as any)?.salePrice ?? (master as any)?.salePriceBase ?? row.salePrice);
      }

      if (patch.unitId !== undefined) { row.unitId = patch.unitId; row.unitName = patch.unitName ?? row.unitName; }
      if (patch.unitName !== undefined) row.unitName = patch.unitName;
      if (patch.qty !== undefined) row.qty = patch.qty;
      if (patch.unitCost !== undefined) row.unitCost = patch.unitCost;
      if (patch.notes !== undefined) row.notes = patch.notes;
      if (patch.serialNumbers !== undefined) row.serialNumbers = patch.serialNumbers;

      // ── Pricing mutual exclusion ──────────────────────────────────────────
      if (patch.pricingMode !== undefined) row.pricingMode = patch.pricingMode;

      if (patch.salePrice !== undefined) {
        row.salePrice = patch.salePrice;
        row.pricingMode = 'manual';
        row.commissionPct = 0;
      }
      if (patch.commissionPct !== undefined) {
        row.commissionPct = patch.commissionPct;
        row.pricingMode = 'commission';
        // auto-calc salePrice
        row.salePrice = round4(row.unitCost * (1 + patch.commissionPct / 100));
      }
      // Re-calc salePrice if unitCost changed while in commission mode
      if (patch.unitCost !== undefined && row.pricingMode === 'commission') {
        row.salePrice = round4(patch.unitCost * (1 + row.commissionPct / 100));
      }

      // ── Base quantity ─────────────────────────────────────────────────────
      const qty = patch.qty ?? row.qty;
      row.baseQty = round4(qty * getUnitFactor(row.unitId));

      next[index] = row;
      return next;
    });
  };

  const removeLine = (i: number) => setLines(prev => prev.filter((_, j) => j !== i));

  // ─── Quick-create item ─────────────────────────────────────────────────────
  const handleAddNewItem = useCallback(async (name: string, lineIndex: number) => {
    const whId = consignmentWarehouseId || sourceWarehouseId;
    if (!whId) { setError('اختر مستودع الأمانة أولاً قبل إضافة مادة جديدة.'); return; }
    const code = `NEW-${Date.now().toString().slice(-5)}`;
    const whName = warehouses.find(w => w.id === whId)?.name || '';
    const newId = `item-${Date.now()}`;
    const newItem = { id: newId, name: name.trim(), code, quantity: 0, unitName: 'قطعة', salePrice: 0, costPrice: 0, warehouseId: whId, warehouseName: whName, serialTracking: 'none', lastUpdated: new Date().toISOString() };
    try {
      await apiRequest('inventory', { method: 'POST', body: JSON.stringify(newItem) });
      setAddedItems(prev => [...prev, { id: newId, label: newItem.name, subLabel: code }]);
      updateLine(lineIndex, { itemId: newId });
      setError(null);
      refreshData?.();
      setTimeout(() => focusCell(lineIndex, 'unit'), 120);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'فشل إضافة المادة');
    }
  }, [consignmentWarehouseId, sourceWarehouseId, warehouses, refreshData]);

  // ─── Serial helpers ────────────────────────────────────────────────────────
  const isSerialTracked = (itemId: string) => {
    const t = items.find(i => i.id === itemId)?.serialTracking || 'none';
    return t === 'required' || t === 'optional';
  };
  const getSerialStatus = (line: ConsignmentLineDraft) => {
    if (!isSerialTracked(line.itemId)) return 'لا يتطلب';
    const req = Math.max(0, Math.floor(line.baseQty));
    if (req === 0) return 'لا يتطلب';
    const list = line.serialNumbers || [];
    const unique = removeDuplicateSerials(list);
    if (!list.length) return 'لا يوجد';
    if (unique.length !== list.length) return 'فيه تكرار';
    if (unique.length < req) return 'ناقص';
    return 'مكتمل';
  };

  // ─── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (andPost: boolean) => {
    setError(null);
    if (!partyId || !consignmentWarehouseId || !issueDate) {
      setError(isCustomer ? 'العميل ومستودع الأمانة والتاريخ مطلوبة.' : 'المورد ومستودع الأمانة والتاريخ مطلوبة.');
      return;
    }
    if (isCustomer && !sourceWarehouseId) { setError('المستودع المصدر (مستودعنا) مطلوب في أمانة العملاء.'); return; }
    const valid = lines.filter(l => l.itemId && l.qty > 0);
    if (!valid.length) { setError('أضف مادة واحدة على الأقل بكمية أكبر من صفر.'); return; }
    for (let i = 0; i < valid.length; i++) {
      const l = valid[i];
      const tracking = items.find(it => it.id === l.itemId)?.serialTracking;
      if (tracking === 'required') {
        const req = Math.max(0, Math.floor(l.baseQty));
        const uniq = removeDuplicateSerials(l.serialNumbers || []);
        if (uniq.length !== req) { setError(`سطر ${i + 1}: مطلوب ${req} سيريال، تم إدخال ${uniq.length}.`); return; }
        if ((l.serialNumbers || []).length !== uniq.length) { setError(`سطر ${i + 1}: يوجد سيريال مكرر.`); return; }
      }
    }
    setSaving(true); setSaveAndPost(andPost);
    try {
      const user = getStoredUser();
      const linePayload = valid.map(l => ({
        itemId: l.itemId,
        qty: round4(l.qty),
        baseQty: round4(l.baseQty),
        unitId: l.unitId || undefined,
        unitName: l.unitName || undefined,
        unitFactor: getUnitFactor(l.unitId),
        unitCost: round4(l.unitCost || 0),
        customSalePrice: round4(l.salePrice || 0),
        commissionPct: round4(l.commissionPct || 0),
        commissionAmount: round4(l.pricingMode === 'commission'
          ? l.baseQty * l.unitCost * (l.commissionPct / 100)
          : l.baseQty * (l.salePrice - l.unitCost)),
        serialNumbers: l.serialNumbers.length ? l.serialNumbers : undefined,
        notes: l.notes,
        warehouseId: consignmentWarehouseId,
        // inventory sync fields
        sourceWarehouseId: isCustomer ? sourceWarehouseId : undefined,
        stockType: isCustomer ? 'customer_consignment' : 'supplier_consignment',
      }));
      const base = {
        partyId,
        consignmentWarehouseId,
        currency: currency || 'USD',
        currencyCode: currency || 'USD',
        issueDate,
        notes: notes || null,
        lines: linePayload,
      };
      let savedId: string;
      if (editDoc) {
        await apiRequest(`consignments/${editDoc.id}`, { method: 'PUT', body: JSON.stringify({
          ...base,
          sourceWarehouseId: isCustomer ? (sourceWarehouseId || null) : null,
          supplierReference: !isCustomer ? (supplierReference || null) : null,
        }) });
        savedId = editDoc.id;
      } else {
        // Generate ID once and reuse it — avoids fetching the list and accidentally
        // picking a previously-posted document as the "savedId".
        const newId = `cs-${Date.now()}`;
        await apiRequest('consignments', { method: 'POST', body: JSON.stringify({
          id: newId,
          documentNumber: documentNumber || Date.now().toString().slice(-6),
          direction,
          ...base,
          sourceWarehouseId: isCustomer ? (sourceWarehouseId || undefined) : undefined,
          supplierReference: !isCustomer ? (supplierReference || undefined) : undefined,
          createdBy: user?.name || user?.username || 'user',
        }) });
        savedId = newId;
      }
      if (andPost) {
        if (savedId) await apiRequest(`consignments/${savedId}/post`, { method: 'POST', body: JSON.stringify({}) });
      }
      // Refresh global items list so inventory screen shows updated quantities/prices
      if (refreshData) await refreshData();
      onSaved(); onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  // ─── Derived totals ────────────────────────────────────────────────────────
  const totalQty    = lines.reduce((s, l) => s + l.baseQty, 0);
  const totalCost   = lines.reduce((s, l) => s + round4(l.baseQty * l.unitCost), 0);
  const totalSale   = lines.reduce((s, l) => s + round4(l.baseQty * l.salePrice), 0);
  const totalMargin = totalSale - totalCost;

  const backOrClose = onBack || onClose;

  // ─── Render ────────────────────────────────────────────────────────────────
  const topBar = (
    <div className="flex items-center justify-between shrink-0 h-14 px-4 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        {(fullPage || onBack) && (
          <button type="button" onClick={backOrClose}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 font-bold text-sm">
            <ChevronRight size={18} /> رجوع
          </button>
        )}
        <h2 className="text-base md:text-lg font-bold text-gray-900">
          {viewDoc ? 'عرض سند أمانة' : editDoc ? 'تحرير سند أمانة' : 'سند أمانة جديد'}
        </h2>
        <span className={`hidden sm:inline px-2 py-0.5 rounded text-xs font-bold ${isCustomer ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'}`}>
          {isCustomer ? 'أمانة عملاء' : 'أمانة موردين'}
        </span>
        {docStatus && (
          <span className={`hidden sm:inline px-2 py-0.5 rounded text-xs font-bold ${STATUS_CLASS[docStatus] || 'bg-gray-100'}`}>
            {STATUS_LABEL[docStatus] || docStatus}
          </span>
        )}
      </div>
      {!isView && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => handleSave(false)} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-white rounded-lg font-bold text-sm hover:bg-gray-900 disabled:opacity-50">
            {saving && !saveAndPost ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            حفظ
          </button>
          <button type="button" onClick={() => handleSave(true)} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg font-bold text-sm hover:bg-teal-700 disabled:opacity-50">
            {saving && saveAndPost ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            حفظ وترحيل
          </button>
          <button type="button" onClick={backOrClose}
            className="px-3 py-1.5 border border-gray-300 rounded-lg font-bold text-sm hover:bg-gray-50">
            إلغاء
          </button>
        </div>
      )}
      {isView && (
        <button type="button" onClick={backOrClose}
          className="px-3 py-1.5 border border-gray-300 rounded-lg font-bold text-sm hover:bg-gray-50">
          إغلاق
        </button>
      )}
    </div>
  );

  const headerSection = (
    <div className="shrink-0 border-b border-gray-100">
      {error && <div className="mx-4 mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 font-bold text-sm">{error}</div>}
      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Document number */}
          {currentDoc && (
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">رقم السند</label>
              <div className="px-2.5 py-2 bg-gray-50 rounded-lg border text-sm font-numeric font-bold">{documentNumber}</div>
            </div>
          )}
          {/* Party */}
          <div className="col-span-2">
            <label className="block text-xs font-bold text-gray-500 mb-1">{isCustomer ? 'العميل ★' : 'المورد ★'}</label>
            {isView ? (
              <div className="px-2.5 py-2 bg-gray-50 rounded-lg border text-sm">{partyName || '—'}</div>
            ) : (
              <Combobox items={partyOptions} selectedId={partyId}
                onSelect={(id, name) => { setPartyId(id); setPartyName(name || ''); }}
                placeholder={isCustomer ? 'اختر العميل...' : 'اختر المورد...'} />
            )}
          </div>
          {/* Consignment warehouse */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">مستودع الأمانة ★</label>
            {isView ? (
              <div className="px-2.5 py-2 bg-gray-50 rounded-lg border text-sm">{whOptions.find(w => w.id === consignmentWarehouseId)?.label || '—'}</div>
            ) : (
              <Combobox items={whOptions} selectedId={consignmentWarehouseId} onSelect={setConsignmentWarehouseId} placeholder="اختر المستودع..." />
            )}
          </div>
          {/* Source WH (customer) or supplier ref (supplier) */}
          {isCustomer ? (
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">المستودع المصدر ★</label>
              {isView ? (
                <div className="px-2.5 py-2 bg-gray-50 rounded-lg border text-sm">{whOptions.find(w => w.id === sourceWarehouseId)?.label || '—'}</div>
              ) : (
                <Combobox items={whOptions} selectedId={sourceWarehouseId} onSelect={setSourceWarehouseId} placeholder="مستودعنا..." />
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">مرجع المورد الخارجي</label>
              {isView ? (
                <div className="px-2.5 py-2 bg-gray-50 rounded-lg border text-sm">{supplierReference || '—'}</div>
              ) : (
                <input type="text" value={supplierReference} onChange={e => setSupplierReference(e.target.value)}
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  placeholder="رقم الإشعار أو مرجع المورد..." />
              )}
            </div>
          )}
          {/* Currency */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">العملة ★</label>
            {isView ? (
              <div className="px-2.5 py-2 bg-gray-50 rounded-lg border text-sm font-bold">{currency}</div>
            ) : (
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm font-bold bg-white">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
          {/* Date */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">التاريخ ★</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
              disabled={isView}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white disabled:bg-gray-50" />
          </div>
          {/* Notes */}
          <div className="col-span-2 lg:col-span-3">
            <label className="block text-xs font-bold text-gray-500 mb-1">ملاحظات</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              disabled={isView} placeholder="اختياري"
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white disabled:bg-gray-50" />
          </div>
        </div>
      </div>
    </div>
  );

  const linesGrid = (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Lines toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50/80 shrink-0">
        <span className="text-sm font-bold text-gray-700">البنود</span>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            سعر البيع ↔ عمولة % متضادان
          </span>
          {!isView && (
            <button type="button" onClick={addLine}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-lg font-bold text-sm hover:bg-teal-700">
              + إضافة سطر
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-right border-collapse text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-[2]">
            <tr>
              <th className="p-2 font-bold text-gray-700 text-xs text-right" style={{ minWidth: 240 }}>المادة</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-28">الوحدة</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-20">الكمية</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-24 bg-gray-100">الكمية الأساسية</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-24">سعر الأمانة</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-24">سعر البيع</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-20">عمولة %</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right" style={{ minWidth: 170 }}>السيريالات</th>
              <th className="p-2 font-bold text-gray-700 text-xs text-right w-28">ملاحظات</th>
              {!isView && <th className="p-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={isView ? 9 : 10} className="p-8 text-center text-gray-400 text-sm">
                  {isView ? 'لا توجد بنود.' : 'اضغط «إضافة سطر» أو ابدأ بكتابة اسم المادة.'}
                </td>
              </tr>
            )}
            {lines.map((line, idx) => {
              const serialStatus = getSerialStatus(line);
              const serialBadgeClass = serialStatus === 'مكتمل' ? 'bg-green-100 text-green-800'
                : serialStatus === 'ناقص' ? 'bg-amber-100 text-amber-800'
                : serialStatus === 'فيه تكرار' ? 'bg-orange-100 text-orange-800'
                : 'bg-gray-100 text-gray-500';
              const manualLocked = line.pricingMode === 'manual';
              const commLocked = line.pricingMode === 'commission';
              return (
                <tr key={line.id}
                  className="border-b border-gray-100 hover:bg-blue-50/20 transition-colors">
                  {/* ── Item ── */}
                  <td className="p-1.5 align-middle" style={{ overflow: 'visible', minWidth: 240 }}>
                    {isView ? (
                      <span className="font-medium">{line.itemName || '—'}</span>
                    ) : (
                      <div style={{ position: 'relative', zIndex: 100 - idx }}>
                        <Combobox
                          items={itemOptions}
                          selectedId={line.itemId}
                          onSelect={id => updateLine(idx, { itemId: id })}
                          onAddNew={name => handleAddNewItem(name, idx)}
                          onNext={() => focusCell(idx, 'unit')}
                          placeholder="اسم أو رمز أو باركود..."
                        />
                      </div>
                    )}
                  </td>

                  {/* ── Unit ── */}
                  <td className="p-1.5 align-middle">
                    {isView ? (
                      <div>
                        <div className="font-medium">{line.unitName || '—'}</div>
                        {getUnitHelper(line.unitId) && <div className="text-xs text-gray-400">{getUnitHelper(line.unitId)}</div>}
                      </div>
                    ) : (
                      <div>
                        <select
                          ref={el => { lineRefs.current[`${idx}-unit`] = el; }}
                          value={line.unitId}
                          onChange={e => {
                            const u = units.find(x => x.id === e.target.value);
                            updateLine(idx, { unitId: u?.id || '', unitName: u?.name || '' });
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusCell(idx, 'qty'); } }}
                          className="w-full px-1.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
                        >
                          <option value="">—</option>
                          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                        {getUnitHelper(line.unitId) && <div className="text-xs text-gray-400 mt-0.5 leading-tight">{getUnitHelper(line.unitId)}</div>}
                      </div>
                    )}
                  </td>

                  {/* ── Qty ── */}
                  <td className="p-1.5 align-middle">
                    {isView ? (
                      <span className="font-numeric">{fmt(line.qty, 4)}</span>
                    ) : (
                      <input
                        ref={el => { lineRefs.current[`${idx}-qty`] = el; }}
                        type="number" min={0} step="0.0001"
                        value={line.qty || ''}
                        onChange={e => updateLine(idx, { qty: Number(e.target.value) || 0 })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusCell(idx, 'unitCost'); } }}
                        className="w-full px-1.5 py-1.5 border border-gray-200 rounded font-numeric text-sm"
                      />
                    )}
                  </td>

                  {/* ── Base qty (readonly) ── */}
                  <td className="p-1.5 align-middle bg-gray-50/60">
                    <span className="inline-block px-2 py-1 rounded bg-gray-100 border border-gray-200 font-numeric text-sm font-bold text-gray-800" title="محسوب تلقائياً">
                      {fmt(line.baseQty, 4)}
                    </span>
                  </td>

                  {/* ── Consignment price ── */}
                  <td className="p-1.5 align-middle">
                    {isView ? (
                      <span className="font-numeric">{fmt(line.unitCost)}</span>
                    ) : (
                      <input
                        ref={el => { lineRefs.current[`${idx}-unitCost`] = el; }}
                        type="number" min={0} step="0.0001"
                        value={line.unitCost || ''}
                        onChange={e => updateLine(idx, { unitCost: Number(e.target.value) || 0 })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusCell(idx, 'salePrice'); } }}
                        className="w-full px-1.5 py-1.5 border border-gray-200 rounded font-numeric text-sm"
                        placeholder="0"
                      />
                    )}
                  </td>

                  {/* ── Sale Price (manual mode) ── */}
                  <td className="p-1.5 align-middle">
                    {isView ? (
                      <span className="font-numeric">{fmt(line.salePrice)}</span>
                    ) : (
                      <div className="relative">
                        <input
                          ref={el => { lineRefs.current[`${idx}-salePrice`] = el; }}
                          type="number" min={0} step="0.0001"
                          value={line.pricingMode === 'commission' ? fmt(line.salePrice) : (line.salePrice || '')}
                          readOnly={commLocked}
                          onChange={e => !commLocked && updateLine(idx, { salePrice: Number(e.target.value) || 0 })}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusCell(idx, 'commPct'); } }}
                          className={`w-full px-1.5 py-1.5 border rounded font-numeric text-sm ${commLocked ? 'border-gray-100 bg-gray-100 text-gray-500 cursor-not-allowed' : 'border-gray-200'}`}
                          placeholder="0"
                          title={commLocked ? 'محسوب تلقائياً من العمولة' : 'أدخل سعر البيع (يقفل حقل العمولة)'}
                        />
                        {commLocked && <Lock size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400" />}
                      </div>
                    )}
                  </td>

                  {/* ── Commission % (commission mode) ── */}
                  <td className="p-1.5 align-middle">
                    {isView ? (
                      <span className="font-numeric">{fmt(line.commissionPct)}%</span>
                    ) : (
                      <div className="relative">
                        <input
                          ref={el => { lineRefs.current[`${idx}-commPct`] = el; }}
                          type="number" min={0} max={100} step="0.01"
                          value={manualLocked ? '' : (line.commissionPct || '')}
                          readOnly={manualLocked}
                          onChange={e => !manualLocked && updateLine(idx, { commissionPct: Number(e.target.value) || 0 })}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusCell(idx, 'notes'); } }}
                          className={`w-full px-1.5 py-1.5 border rounded font-numeric text-sm ${manualLocked ? 'border-gray-100 bg-gray-100 text-gray-500 cursor-not-allowed' : 'border-gray-200'}`}
                          placeholder="%"
                          title={manualLocked ? 'سعر البيع مدخل يدوياً — عمولة % معطلة' : 'أدخل عمولة % (يحسب سعر البيع تلقائياً)'}
                        />
                        {manualLocked && <Lock size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400" />}
                      </div>
                    )}
                  </td>

                  {/* ── Serials ── */}
                  <td className="p-1.5 align-middle">
                    {isSerialTracked(line.itemId) ? (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${serialBadgeClass}`}>
                          {line.serialNumbers?.length ?? 0}/{Math.max(0, Math.floor(line.baseQty))} — {serialStatus}
                        </span>
                        <button type="button" onClick={() => setSerialModalIdx(idx)}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold">
                          <ListOrdered size={11} /> سيريالات
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  {/* ── Notes ── */}
                  <td className="p-1.5 align-middle">
                    {isView ? (
                      <span className="text-sm text-gray-600">{line.notes || '—'}</span>
                    ) : (
                      <input
                        ref={el => { lineRefs.current[`${idx}-notes`] = el; }}
                        type="text" value={line.notes || ''}
                        onChange={e => updateLine(idx, { notes: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addLine();
                            setTimeout(() => focusCell(lines.length, 'unit'), 80);
                          }
                        }}
                        className="w-full px-1.5 py-1.5 border border-gray-200 rounded text-sm"
                        placeholder="—"
                      />
                    )}
                  </td>

                  {/* ── Remove ── */}
                  {!isView && (
                    <td className="p-1.5 align-middle text-center">
                      <button type="button" onClick={() => removeLine(idx)}
                        className="p-1 rounded hover:bg-red-50 text-red-500" title="حذف السطر">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals strip */}
      <div className="shrink-0 px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex flex-wrap gap-4 text-sm font-bold text-gray-800">
        <span>البنود: {lines.length}</span>
        <span className="font-numeric">الكمية الإجمالية: {fmt(totalQty, 3)}</span>
        <span className="font-numeric text-gray-600">تكلفة الأمانة ({currency}): {totalCost.toFixed(2)}</span>
        <span className="font-numeric text-teal-700">قيمة البيع ({currency}): {totalSale.toFixed(2)}</span>
        <span className={`font-numeric ${totalMargin >= 0 ? 'text-green-700' : 'text-red-700'}`}>
          هامش الربح ({currency}): {totalMargin.toFixed(2)}
        </span>
      </div>
    </div>
  );

  const body = (
    <div className="flex flex-col h-full overflow-hidden" dir="rtl">
      {topBar}
      {headerSection}
      {linesGrid}
    </div>
  );

  if (serialModalIdx !== null && lines[serialModalIdx]) {
    const serialLine = lines[serialModalIdx];
  }

  return (
    <>
      {fullPage ? (
        <div className="w-full bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden flex flex-col"
          style={{ height: 'calc(100vh - 8rem)', minHeight: 640 }}>
          {body}
        </div>
      ) : (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 bg-black/50" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ width: '96vw', height: '94vh' }}>
            {body}
          </div>
        </div>
      )}

      {serialModalIdx !== null && lines[serialModalIdx] && (
        <SerialManagementModal
          title="إدارة السيريالات"
          itemName={lines[serialModalIdx].itemName}
          requiredCount={lines[serialModalIdx].baseQty}
          serials={lines[serialModalIdx].serialNumbers || []}
          onChange={serials => updateLine(serialModalIdx, { serialNumbers: serials })}
          onClose={() => setSerialModalIdx(null)}
          readonly={isView}
        />
      )}
    </>
  );
};

export default ConsignmentDocumentForm;
