import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Send, Save, Search, FileText, X, AlertTriangle, ScanBarcode, Printer } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import Combobox from '../components/Combobox';
import { DeliveryNotice, DeliveryNoticeItem, InventoryItem, Warehouse, AppUser, AppSettings, TextileColor, TextileInventoryBalance } from '../types';
import { printDeliveryNoticeBluetooth } from '../printing/printService';
import { isAndroidNative, scanBarcodeOnce } from '../lib/barcodeScanner';
import PrinterPicker from '../components/PrinterPicker';
import { AdaptiveModal } from '../components/responsive';
import { isRestrictedTextileWarehouseUser } from '../lib/userAccess';
import { isTextileModeEnabled } from '../lib/textileMode';

const DeliveryNotices: React.FC<{ settings?: AppSettings }> = ({ settings }) => {
  const [notices, setNotices] = useState<DeliveryNotice[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [textileColors, setTextileColors] = useState<TextileColor[]>([]);
  const [textileBalances, setTextileBalances] = useState<TextileInventoryBalance[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeStatus, setActiveStatus] = useState<'ALL' | DeliveryNotice['status']>('ALL');
  const statusLabels: Record<string, string> = {
    ALL: 'الكل',
    DRAFT: 'مسودة',
    SUBMITTED: 'مرسل',
    REJECTED: 'مرفوض',
    CONFIRMED: 'معتمد'
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<DeliveryNotice | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [printerPickerOpen, setPrinterPickerOpen] = useState(false);
  const [printerPickerResolve, setPrinterPickerResolve] = useState<((id: string | null) => void) | null>(null);
  const macRegex = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
  const [form, setForm] = useState<Partial<DeliveryNotice>>({
    warehouseId: '',
    receiverType: 'internal',
    receiverName: '',
    notes: '',
    date: new Date().toISOString().split('T')[0],
    items: []
  });
  const [lockedRows, setLockedRows] = useState<boolean[]>([]);
  const quantityRefs = useRef<Array<HTMLInputElement | null>>([]);

  const storedUser = localStorage.getItem('shamel_user');
  const currentUser: AppUser | null = storedUser ? JSON.parse(storedUser) : null;
  const textileModeEnabled = isTextileModeEnabled(settings || appSettings);
  const textileRestrictedUser = isRestrictedTextileWarehouseUser(currentUser);
  const canCreateNotice = !textileRestrictedUser;
  const canPrepareSubmittedNotices = textileRestrictedUser;
  const isAndroid = isAndroidNative();

  useEffect(() => {
    const saved = localStorage.getItem('shamel_settings');
    if (saved) setAppSettings(JSON.parse(saved));
  }, []);

  const updatePrinterSettings = (printerId: string) => {
    const nextId = printerId.trim();
    const stored = localStorage.getItem('shamel_settings');
    const base = appSettings || (stored ? JSON.parse(stored) : null) || {
      company: { name: 'ERP', address: '', phone1: '' },
      theme: { primaryColor: '#0f766e', backgroundColor: '#f3f4f6' },
      labels: {},
      print: { thermal: { enabled: true, printerId: '', paperSize: '80mm', autoPrintPos: true } },
      currencyRates: {}
    };
    const thermal = base.print?.thermal || { enabled: true, printerId: '', paperSize: '80mm', autoPrintPos: true };
    const next = {
      ...base,
      print: {
        ...base.print,
        thermal: { ...thermal, enabled: true, printerId: nextId }
      }
    };
    localStorage.setItem('shamel_settings', JSON.stringify(next));
    setAppSettings(next);
    return next;
  };

  const requestPrinterId = () => {
    const existing = appSettings?.print?.thermal?.printerId || '';
    if (existing.trim()) return Promise.resolve(existing.trim());
    return new Promise<string | null>((resolve) => {
      setPrinterPickerResolve(() => resolve);
      setPrinterPickerOpen(true);
    });
  };

  const handlePrinterSelect = (printer: { id: string }) => {
    const next = updatePrinterSettings(printer.id);
    setPrinterPickerOpen(false);
    printerPickerResolve?.(next.print.thermal.printerId);
    setPrinterPickerResolve(null);
  };

  const handlePrinterClose = () => {
    setPrinterPickerOpen(false);
    printerPickerResolve?.(null);
    setPrinterPickerResolve(null);
  };

  const loadBaseData = async () => {
    try {
      const [inv, wh, colors, balances] = await Promise.all([
        apiRequest('inventory'),
        apiRequest('warehouses'),
        apiRequest('textile/colors').catch(() => []),
        apiRequest('textile/inventory').catch(() => []),
      ]);
      setInventory(inv || []);
      setWarehouses(wh || []);
      setTextileColors(Array.isArray(colors) ? colors : []);
      setTextileBalances(Array.isArray(balances) ? balances : []);
    } catch (e) { alert('فشل تحميل بيانات المخزون'); }
  };

  const loadNotices = async () => {
    try {
      const query = textileRestrictedUser
        ? `delivery-notices?status=SUBMITTED${currentUser?.posWarehouseId ? `&warehouseId=${encodeURIComponent(currentUser.posWarehouseId)}` : ''}`
        : `delivery-notices?createdById=${currentUser?.id || ''}`;
      const data = await apiRequest(query);
      setNotices((data || []).filter((notice: DeliveryNotice) => (
        textileRestrictedUser
          ? (notice.items || []).some((item) => isTextileLine(item))
          : true
      )));
    } catch (e) { alert('فشل تحميل إشعارات التسليم'); }
  };

  useEffect(() => { loadBaseData(); }, []);
  useEffect(() => { loadNotices(); }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const query = textileRestrictedUser
          ? `delivery-notices?status=SUBMITTED${currentUser?.posWarehouseId ? `&warehouseId=${encodeURIComponent(currentUser.posWarehouseId)}` : ''}`
          : `delivery-notices?createdById=${currentUser?.id || ''}`;
        const latest = await apiRequest(query);
        const prevMap = new Map((notices || []).map(n => [n.id, n.status]));
        (latest || []).forEach((n: DeliveryNotice) => {
          const prev = prevMap.get(n.id);
          if (prev && prev !== n.status) {
            if (n.status === 'CONFIRMED') alert(`تم اعتماد إشعارك رقم ${n.id}`);
            if (n.status === 'REJECTED') alert(`تم رفض إشعارك رقم ${n.id}: ${n.rejectReason || ''}`);
          }
        });
        setNotices((latest || []).filter((notice: DeliveryNotice) => (
          textileRestrictedUser ? (notice.items || []).some((item) => isTextileLine(item)) : true
        )));
      } catch {}
    };
    const id = window.setInterval(poll, 15000);
    return () => window.clearInterval(id);
  }, [currentUser?.id, currentUser?.posWarehouseId, notices, textileRestrictedUser]);

  const filteredNotices = useMemo(() => {
    const q = (searchTerm || '').toLowerCase();
    return (notices || []).filter(n => {
      const statusMatch = activeStatus === 'ALL' || n.status === activeStatus;
      const matchText =
        (n.id || '').toLowerCase().includes(q) ||
        (n.receiverName || '').toLowerCase().includes(q) ||
        (n.warehouseName || '').toLowerCase().includes(q);
      return statusMatch && matchText;
    });
  }, [notices, activeStatus, searchTerm]);

  const activeWarehouse = warehouses.find(w => w.id === form.warehouseId);
  const warehouseInventory = useMemo(() => {
    if (!form.warehouseId) return [];
    return inventory.filter(i => i.warehouseId === form.warehouseId);
  }, [inventory, form.warehouseId]);
  const getItemById = (itemId: string) => inventory.find((item) => item.id === itemId);
  const isTextileLine = (item?: Partial<DeliveryNoticeItem> | null) => textileModeEnabled && Boolean(item?.isTextile);
  const getTextileBalance = (warehouseId: string, itemId: string, colorId?: string) =>
    textileBalances.find((balance) =>
      String(balance.warehouseId || '') === String(warehouseId || '')
      && String(balance.itemId || '') === String(itemId || '')
      && String(balance.colorId || '') === String(colorId || '')
    );
  const buildTextileDecompositionRows = (line: DeliveryNoticeItem) => {
    const rollCount = Number(line.textileRollCount || line.quantity || 0);
    const existing = Array.isArray(line.textileDecomposition) ? line.textileDecomposition : [];
    return Array.from({ length: Math.max(rollCount, 0) }, (_, index) => ({
      idx: index + 1,
      length: Number(existing[index]?.length || 0),
      unit: existing[index]?.unit || line.textileBaseUom || 'meter',
      rollLabel: existing[index]?.rollLabel || '',
    }));
  };

  const openNew = () => {
    setSelectedNotice(null);
    setForm({
      warehouseId: '',
      receiverType: 'internal',
      receiverName: '',
      notes: '',
      date: new Date().toISOString().split('T')[0],
      items: []
    });
    setLockedRows([]);
    setIsModalOpen(true);
  };

  const openEdit = (notice: DeliveryNotice) => {
    setSelectedNotice(notice);
    setForm({
      ...notice,
      items: notice.items || []
    });
    setLockedRows((notice.items || []).map(() => false));
    setIsModalOpen(true);
  };

  const openView = (notice: DeliveryNotice) => {
    setSelectedNotice(notice);
    setIsViewOpen(true);
  };

  const handlePrintNotice = async (notice: DeliveryNotice) => {
    const printerId = await requestPrinterId();
    if (!printerId) return;
    if (!macRegex.test(printerId)) { alert('معرف الطابعة غير صالح. استخدم صيغة MAC: 00:11:22:33:44:55'); return; }
    const nextSettings = updatePrinterSettings(printerId);
    try {
      await printDeliveryNoticeBluetooth({
        printerIdOrMac: printerId,
        paper: nextSettings.print.thermal.paperSize as any,
        data: {
          storeName: nextSettings.company.name,
          noticeNo: notice.id,
          dateText: notice.date,
          warehouseName: notice.warehouseName,
          receiverName: notice.receiverName,
          items: (notice.items || []).map((it) => ({
            name: [it.itemName || '\u0635\u0646\u0641', it.textileColorName ? `(${it.textileColorName})` : ''].filter(Boolean).join(' '),
            qty: Number(it.isTextile ? (it.textileRollCount || it.quantity || 0) : (it.quantity || 0)),
            unit: it.isTextile ? 'رول' : (it.unitName || '')
          })),
          totalQty: (notice.items || []).reduce((sum, it) => sum + Number(it.isTextile ? (it.textileRollCount || it.quantity || 0) : (it.quantity || 0)), 0),
          notes: notice.notes || ''
        }
      });
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.error || e?.message || '');
      alert(msg ? `فشل الطباعة: ${msg}` : 'فشل الطباعة عبر البلوتوث.');
    }
  };

  const addItemRow = () => {
    const items = (form.items || []) as DeliveryNoticeItem[];
    setForm(prev => ({ ...prev, items: [...items, { itemId: '', itemName: '', quantity: 1 }] }));
    setLockedRows(prev => [...prev, false]);
  };

  const recalcAvailability = (items: DeliveryNoticeItem[]) => {
    const baseById = new Map(warehouseInventory.map(i => [i.id, Number(i.quantity || 0)]));
    const totalsById = new Map<string, number>();
    const firstIndexById = new Map<string, number>();

    items.forEach((row, index) => {
      if (!row.itemId) return;
      const key = `${row.itemId}:${row.textileColorId || ''}`;
      if (!firstIndexById.has(key)) firstIndexById.set(key, index);
      totalsById.set(key, (totalsById.get(key) || 0) + Number(row.isTextile ? (row.textileRollCount || row.quantity || 0) : (row.quantity || 0)));
    });

    items.forEach((row) => {
      if (!row.itemId) return;
      row.availableQty = undefined;
    });

    totalsById.forEach((total, itemKey) => {
      const [itemId, colorId] = itemKey.split(':');
      const colorBalance = colorId ? getTextileBalance(String(form.warehouseId || ''), itemId, colorId) : null;
      const base = colorBalance ? Number(colorBalance.rollCount || 0) : (baseById.get(itemId) || 0);
      const remaining = Math.max(0, base - total);
      const firstIdx = firstIndexById.get(itemKey);
      if (firstIdx !== undefined) items[firstIdx].availableQty = remaining;
    });
  };

  const addSameItemRow = (idx: number) => {
    const items = [...((form.items || []) as DeliveryNoticeItem[])];
    const current = items[idx];
    if (!current?.itemId) return;
    const nextRow: DeliveryNoticeItem = {
      itemId: current.itemId,
      itemName: current.itemName,
      unitName: current.unitName,
      availableQty: current.availableQty,
      quantity: 0
    };
    const insertIndex = idx + 1;
    items.splice(insertIndex, 0, nextRow);
    recalcAvailability(items);
    setForm(prev => ({ ...prev, items }));
    setLockedRows(prev => {
      const next = [...prev];
      next.splice(insertIndex, 0, true);
      return next;
    });
    window.setTimeout(() => {
      quantityRefs.current[insertIndex]?.focus();
      quantityRefs.current[insertIndex]?.select();
    }, 0);
  };

  const updateItem = (idx: number, field: keyof DeliveryNoticeItem, value: any) => {
    const items = [...((form.items || []) as DeliveryNoticeItem[])];
    const item = { ...items[idx], [field]: value };
    if (field === 'itemId') {
      const inv = warehouseInventory.find(i => i.id === value);
      item.itemName = inv?.name || '';
      item.isTextile = textileModeEnabled && Boolean(inv?.isTextile);
      item.unitName = inv?.isTextile ? 'رول' : (inv?.unitName || '');
      item.textileBaseUom = inv?.textileBaseUom || 'meter';
      item.textileColorId = '';
      item.textileColorName = '';
      item.textileRollCount = item.isTextile ? Number(item.textileRollCount || item.quantity || 0) : undefined;
      item.textileTotalLength = item.isTextile ? Number(item.textileTotalLength || 0) : undefined;
      item.textileDecomposition = item.isTextile ? buildTextileDecompositionRows(item) : undefined;
    }
    if (field === 'quantity' && isTextileLine(item)) {
      item.textileRollCount = Number(value || 0);
      item.textileDecomposition = buildTextileDecompositionRows(item);
    }
    if (field === 'textileColorId') {
      const color = textileColors.find((entry) => entry.id === value);
      item.textileColorName = color?.name || item.textileColorName || '';
    }
    items[idx] = item;
    recalcAvailability(items);
    setForm(prev => ({ ...prev, items }));
  };

  const removeItem = (idx: number) => {
    const items = [...((form.items || []) as DeliveryNoticeItem[])];
    items.splice(idx, 1);
    recalcAvailability(items);
    setForm(prev => ({ ...prev, items }));
    setLockedRows(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  const totals = useMemo(() => {
    const items = (form.items || []) as DeliveryNoticeItem[];
    const baseById = new Map(warehouseInventory.map(i => [i.id, Number(i.quantity || 0)]));
    const summaryMap = new Map<string, { itemId: string; name: string; quantity: number }>();
    const linesById = new Map<string, number[]>();

    items.forEach((it) => {
      if (!it.itemId) return;
      const existing = summaryMap.get(it.itemId);
      const name = it.itemName || warehouseInventory.find(i => i.id === it.itemId)?.name || '';
      const qty = Number(it.quantity || 0);
      if (existing) {
        existing.quantity += qty;
      } else {
        summaryMap.set(it.itemId, { itemId: it.itemId, name, quantity: qty });
      }
      const lineList = linesById.get(it.itemId) || [];
      lineList.push(qty);
      linesById.set(it.itemId, lineList);
    });

    const summary = Array.from(summaryMap.values()).map((s) => {
      const base = baseById.get(s.itemId) || 0;
      return { ...s, available: base, remaining: Math.max(0, base - s.quantity), lines: linesById.get(s.itemId) || [] };
    });

    const totalQty = summary.reduce((sum, it) => sum + it.quantity, 0);
    const distinctItems = summary.length;
    const lineCount = items.length;
    const maxLines = summary.reduce((max, s) => Math.max(max, s.lines.length), 0);
    const overLimit = summary.some((s) => s.quantity > (baseById.get(s.itemId) || 0));
    return { totalQty, distinctItems, lineCount, summary, maxLines, overLimit };
  }, [form.items, warehouseInventory]);


  const validateForm = () => {
    if (!form.warehouseId) { alert('يرجى اختيار المستودع'); return false; }
    const items = (form.items || []) as DeliveryNoticeItem[];
    if (items.length === 0) { alert('يرجى إضافة مواد'); return false; }
    const totalsById = new Map<string, number>();
    const nameById = new Map<string, string>();
    const baseById = new Map(warehouseInventory.map(i => [i.id, Number(i.quantity || 0)]));
    for (const it of items) {
      const requestedQty = Number(it.isTextile ? (it.textileRollCount || it.quantity || 0) : (it.quantity || 0));
      if (!it.itemId || requestedQty <= 0) { alert('يرجى إدخال المادة والكمية بشكل صحيح'); return false; }
      if (isTextileLine(it) && !it.textileColorId && !it.textileColorName) { alert(`يرجى اختيار لون للصنف ${it.itemName || ''}`); return false; }
      const key = `${it.itemId}:${it.textileColorId || ''}`;
      totalsById.set(key, (totalsById.get(key) || 0) + requestedQty);
      if (it.itemName) nameById.set(key, it.itemName);
    }
    for (const [itemKey, total] of totalsById.entries()) {
      const [itemId, colorId] = itemKey.split(':');
      const colorBalance = colorId ? getTextileBalance(String(form.warehouseId || ''), itemId, colorId) : null;
      const base = colorBalance ? Number(colorBalance.rollCount || 0) : (baseById.get(itemId) || 0);
      if (total > base) {
        const name = nameById.get(itemKey) || 'الصنف';
        alert(`الكمية المطلوبة للصنف ${name} أكبر من المتاح.`);
        return false;
      }
    }
    return true;
  };

  const handleSave = async (submit: boolean) => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const payload: Partial<DeliveryNotice> = {
        ...form,
        warehouseName: activeWarehouse?.name,
        createdById: currentUser?.id,
        createdByName: currentUser?.name || currentUser?.username,
        date: form.date || new Date().toISOString().split('T')[0],
        items: ((form.items || []) as DeliveryNoticeItem[]).map((item) => ({
          ...item,
          quantity: Number(isTextileLine(item) ? (item.textileRollCount || item.quantity || 0) : (item.quantity || 0)),
          textileRollCount: isTextileLine(item) ? Number(item.textileRollCount || item.quantity || 0) : undefined,
          textileTotalLength: isTextileLine(item) ? Number(item.textileTotalLength || 0) : undefined,
          textileDecomposition: isTextileLine(item) ? (item.textileDecomposition || []) : undefined,
        }))
      };

      let noticeId = form.id;
      if (!noticeId) {
        const res = await apiRequest('delivery-notices', { method: 'POST', body: JSON.stringify(payload) });
        noticeId = res?.id;
      } else {
        await apiRequest(`delivery-notices/${noticeId}`, { method: 'PUT', body: JSON.stringify(payload) });
      }

      if (submit && noticeId) {
        await apiRequest(`delivery-notices/${noticeId}/submit`, {
          method: 'POST',
          body: JSON.stringify({
            submittedById: currentUser?.id,
            submittedByName: currentUser?.name || currentUser?.username
          })
        });
      }

      setIsModalOpen(false);
      await loadNotices();
    } catch (e: any) {
      alert(e.response?.data?.error || 'حدث خطأ أثناء الحفظ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateSelectedNoticeDecomposition = (lineIndex: number, rowIndex: number, rawValue: string) => {
    if (!selectedNotice) return;
    const items = [...(selectedNotice.items || [])];
    const line = { ...items[lineIndex] };
    const decomposition = buildTextileDecompositionRows(line);
    decomposition[rowIndex] = {
      ...decomposition[rowIndex],
      length: Number(rawValue || 0),
    };
    line.textileDecomposition = decomposition;
    line.textileTotalLength = decomposition.reduce((sum, entry) => sum + Number(entry.length || 0), 0);
    line.textilePreparationCompleted = decomposition.length > 0 && decomposition.every((entry) => Number(entry.length || 0) > 0);
    line.textilePreparedById = currentUser?.id;
    line.textilePreparedByName = currentUser?.name || currentUser?.username;
    line.textilePreparedAt = new Date().toISOString();
    items[lineIndex] = line;
    setSelectedNotice({ ...selectedNotice, items });
  };

  const submitWarehousePreparation = async () => {
    if (!selectedNotice) return;
    const hasIncompleteTextile = (selectedNotice.items || []).some((line) => (
      isTextileLine(line)
      && (!line.textilePreparationCompleted || !Array.isArray(line.textileDecomposition) || line.textileDecomposition.some((entry) => Number(entry.length || 0) <= 0))
    ));
    if (hasIncompleteTextile) {
      alert('يجب استكمال تفكيك جميع الرولات قبل الإرسال للاعتماد.');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest(`delivery-notices/${selectedNotice.id}/warehouse-prepare`, {
        method: 'POST',
        body: JSON.stringify({
          preparedById: currentUser?.id,
          preparedByName: currentUser?.name || currentUser?.username,
          items: selectedNotice.items || [],
        }),
      });
      setIsViewOpen(false);
      setSelectedNotice(null);
      await loadNotices();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'فشل حفظ تجهيز المستودع');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-50 text-indigo-600 p-3 rounded-2xl"><FileText size={24}/></div>
          <div>
            <h2 className="text-2xl font-black text-gray-900">{textileRestrictedUser ? 'تنفيذ تجهيز الأقمشة' : 'إشعارات تسليم المستودع'}</h2>
            <p className="text-xs text-gray-400 font-bold uppercase mt-1">{textileRestrictedUser ? 'تجهيز الرولات وإرسالها للاعتماد' : 'إدارة إشعارات التسليم'}</p>
          </div>
        </div>
        {canCreateNotice && (
          <button onClick={openNew} className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-black shadow-xl hover:bg-black transition flex items-center gap-2">
            <Plus size={18}/> إضافة إشعار
          </button>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex bg-white p-1.5 rounded-2xl border border-gray-200 shadow-sm">
          {['ALL', 'DRAFT', 'SUBMITTED', 'REJECTED', 'CONFIRMED'].map((s) => (
            <button
              key={s}
              onClick={() => setActiveStatus(s as any)}
              className={`px-5 py-2 rounded-xl text-xs font-black transition-all ${activeStatus === s ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-400 hover:bg-gray-50'}`}
            >
              {statusLabels[s] || s}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-4 top-3.5 text-gray-400" size={18}/>
          <input
            type="text"
            placeholder="ابحث بالرقم أو المستلم..."
            className="w-full pr-12 pl-4 py-3 bg-white border border-gray-200 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-primary/20 outline-none"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 text-right">الرقم</th>
              <th className="p-4 text-right">المستودع</th>
              <th className="p-4 text-right">المستلم</th>
              <th className="p-4 text-center">الأصناف</th>
              <th className="p-4 text-center">الحالة</th>
              <th className="p-4 text-center">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {filteredNotices.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-gray-400">لا توجد إشعارات</td></tr>
            ) : (
              filteredNotices.map((n) => (
                <tr key={n.id} className="border-t hover:bg-gray-50">
                  <td className="p-4 font-mono font-bold">{n.id}</td>
                  <td className="p-4">{n.warehouseName || '-'}</td>
                  <td className="p-4">{n.receiverName || '-'}</td>
                  <td className="p-4 text-center font-bold">{(n.items || []).length}</td>
                  <td className="p-4 text-center font-bold">{statusLabels[n.status] || n.status}</td>
                  <td className="p-4 text-center">
                    {canCreateNotice && ['DRAFT', 'REJECTED'].includes(n.status) ? (
                      <button onClick={() => openEdit(n)} className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition">تعديل</button>
                    ) : (
                      <button onClick={() => openView(n)} className="px-4 py-2 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-800 hover:text-white transition">
                        {canPrepareSubmittedNotices ? 'تجهيز' : 'عرض'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <AdaptiveModal open={isModalOpen} onClose={() => setIsModalOpen(false)} size="xl" zIndex={200} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-6 bg-gray-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base sm:text-lg">{selectedNotice ? 'تعديل إشعار تسليم' : 'إضافة إشعار جديد'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-white/10 rounded-full hover:bg-red-500 transition"><X size={20}/></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-gray-500">المستودع</label>
                  <select value={form.warehouseId} onChange={e => setForm(prev => ({ ...prev, warehouseId: e.target.value }))} className="w-full border rounded-lg p-2.5 bg-white font-bold">
                    <option value="">اختر المستودع</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">نوع المستلم</label>
                  <select value={form.receiverType} onChange={e => setForm(prev => ({ ...prev, receiverType: e.target.value }))} className="w-full border rounded-lg p-2.5 bg-white font-bold">
                    <option value="customer">عميل</option>
                    <option value="internal">داخلي</option>
                    <option value="driver">سائق</option>
                    <option value="sample">عينة</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">اسم المستلم</label>
                  <input value={form.receiverName || ''} onChange={e => setForm(prev => ({ ...prev, receiverName: e.target.value }))} className="w-full border rounded-lg p-2.5 font-bold" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-gray-500">ملاحظات</label>
                  <input value={form.notes || ''} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full border rounded-lg p-2.5" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">التاريخ</label>
                  <input type="date" value={form.date || ''} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} className="w-full border rounded-lg p-2.5 font-numeric" />
                </div>
              </div>

              <div className="bg-white border rounded-2xl overflow-hidden">
                <div className="p-3 sm:p-4 border-b flex items-center justify-between">
                  <h4 className="font-black text-gray-800">المواد</h4>
                  <button onClick={addItemRow} className="bg-primary text-white px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs font-bold">إضافة مادة</button>
                </div>
                <div className="px-3 sm:px-4 py-2 border-b bg-gray-50 text-[11px] sm:text-xs font-bold text-gray-600 flex flex-wrap items-center gap-3">
                  <span>عدد السطور: {totals.lineCount}</span>
                  <span>عدد الأصناف: {totals.distinctItems}</span>
                  <span>إجمالي الكمية: {totals.totalQty}</span>
                </div>
                {totals.summary.length > 0 && (
                  <div className="px-4 py-3 border-b bg-white text-xs font-bold text-gray-700">
                    <div className="mb-2 text-gray-800">تجميع المواد</div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs border-separate border-spacing-2">
                        <thead>
                          <tr>
                            {totals.summary.map((s) => (
                              <th key={s.itemId} className="text-center bg-gray-100 rounded px-2 py-1">{s.name || 'صنف'}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: totals.maxLines }).map((_, rowIdx) => (
                            <tr key={rowIdx}>
                              {totals.summary.map((s) => (
                                <td key={`${s.itemId}-${rowIdx}`} className="text-center bg-white border rounded px-2 py-1">{s.lines[rowIdx] ?? '-'}</td>
                              ))}
                            </tr>
                          ))}
                          <tr>
                            {totals.summary.map((s) => (
                              <td key={`${s.itemId}-total`} className="text-center font-bold bg-gray-50 rounded px-2 py-1">الإجمالي: {s.quantity}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 text-gray-900">الإجمالي الكلي: {totals.totalQty}</div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] text-xs sm:text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-3 text-right">المادة</th>
                      <th className="p-3 text-right">اللون</th>
                      <th className="p-3 text-center">المتاح</th>
                      <th className="p-3 text-center">الكمية / الرولات</th>
                      <th className="p-3 text-center">الوحدة</th>
                      <th className="p-3 text-right">ملاحظات</th>
                      <th className="p-3 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.items || []).length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا توجد مواد</td></tr>
                    ) : (
                      (form.items || []).map((it: DeliveryNoticeItem, idx: number) => (
                        <tr key={idx} className="border-t">
                          <td className="p-3">
                            {lockedRows[idx] ? (
                              <div className="font-bold text-gray-800">&nbsp;</div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <Combobox
                                    items={warehouseInventory.map(i => ({ id: i.id, label: i.name, subLabel: `${i.code || ''} | المتاح: ${i.quantity}` }))}
                                    selectedId={it.itemId}
                                    onSelect={(id) => updateItem(idx, 'itemId', id)}
                                    placeholder="ابحث عن مادة في المستودع..."
                                  />
                                </div>
                                {isAndroid && (
                                  <button
                                    onClick={async () => {
                                      const code = await scanBarcodeOnce();
                                      if (!code) return;
                                      const item = warehouseInventory.find(i => i.barcode === code || i.code === code);
                                      if (item) updateItem(idx, 'itemId', item.id);
                                    }}
                                    className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-200 transition"
                                    title="مسح باركود"
                                    type="button"
                                  >
                                    <ScanBarcode size={16} />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            {it.isTextile ? (
                              <Combobox
                                items={textileColors.map((color) => ({ id: color.id, label: color.name }))}
                                selectedId={it.textileColorId || ''}
                                onSelect={(id, name) => {
                                  updateItem(idx, 'textileColorId', id);
                                  updateItem(idx, 'textileColorName', textileColors.find((entry) => entry.id === id)?.name || name || '');
                                }}
                                allowCustomValue
                                placeholder="اختر اللون"
                              />
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center font-bold">{it.availableQty === undefined ? '' : it.availableQty}</td>
                          <td className="p-3 text-center">
                            <input
                              ref={(el) => { quantityRefs.current[idx] = el; }}
                              type="number"
                              min="0"
                              value={(it.isTextile ? (it.textileRollCount || it.quantity || 0) : it.quantity) === 0 ? '' : (it.isTextile ? (it.textileRollCount || it.quantity || 0) : it.quantity)}
                              onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addSameItemRow(idx);
                                }
                              }}
                              className="w-24 border rounded p-2 text-center font-bold"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <div>{it.unitName || '-'}</div>
                            {it.isTextile && <div className="mt-1 text-[10px] font-bold text-emerald-700">{it.textileBaseUom === 'yard' ? 'الوحدة النهائية: ياردة' : 'الوحدة النهائية: متر'}</div>}
                          </td>
                          <td className="p-3">
                            <input value={it.notes || ''} onChange={e => updateItem(idx, 'notes', e.target.value)} className="w-full border rounded p-2 text-sm" />
                          </td>
                          <td className="p-3 text-center">
                            <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">حذف</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button onClick={() => setIsModalOpen(false)} className="px-4 sm:px-6 py-2 font-bold text-gray-500">إغلاق</button>
                <button disabled={isSubmitting} onClick={() => handleSave(false)} className="bg-gray-800 text-white px-4 sm:px-6 py-2 rounded-lg font-bold flex items-center gap-2 text-xs sm:text-sm">
                  <Save size={16}/> حفظ مسودة</button>
                <button disabled={isSubmitting} onClick={async () => { if (await confirmDialog('هل تريد إرسال إشعار التسليم؟ لن يمكن تعديله بعد الإرسال.')) handleSave(true); }} className="bg-primary text-white px-4 sm:px-6 py-2 rounded-lg font-bold flex items-center gap-2 text-xs sm:text-sm">
                  <Send size={16}/> إرسال للموافقة</button>
              </div>

              {activeWarehouse && totals.overLimit && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs font-bold text-yellow-800 flex items-center gap-2">
                  <AlertTriangle size={16}/> يوجد أصناف مطلوبة أكبر من المتاح في المستودع.</div>
              )}
            </div>
          </div>
        </AdaptiveModal>
      )}

      {isViewOpen && selectedNotice && (
        <AdaptiveModal open={isViewOpen} onClose={() => setIsViewOpen(false)} size="lg" zIndex={200} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-6 bg-gray-900 text-white flex items-center justify-between">
              <h3 className="font-black text-lg">تفاصيل إشعار {selectedNotice.id}</h3>
              <div className="flex items-center gap-2">
                {isAndroid && (
                  <button
                    onClick={() => handlePrintNotice(selectedNotice)}
                    className="bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition"
                  >
                    <Printer size={16} /> طباعة البلوتوث
                  </button>
                )}
                <button onClick={() => setIsViewOpen(false)} className="p-2 bg-white/10 rounded-full hover:bg-red-500 transition"><X size={20}/></button>
              </div>
            </div>
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><div className="text-gray-500 font-bold text-xs">المستودع</div><div className="font-bold">{selectedNotice.warehouseName}</div></div>
                <div><div className="text-gray-500 font-bold text-xs">المستلم</div><div className="font-bold">{selectedNotice.receiverName || '-'}</div></div>
                <div><div className="text-gray-500 font-bold text-xs">التاريخ</div><div className="font-bold font-numeric">{selectedNotice.date}</div></div>
                <div><div className="text-gray-500 font-bold text-xs">الحالة</div><div className="font-bold">{statusLabels[selectedNotice.status] || selectedNotice.status}</div></div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[640px] text-xs sm:text-sm border rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-3 text-right">المادة</th>
                    <th className="p-3 text-center">اللون</th>
                    <th className="p-3 text-center">الرولات</th>
                    <th className="p-3 text-center">الطول</th>
                    <th className="p-3 text-right">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedNotice.items || []).map((it, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-3 font-bold">{it.itemName}</td>
                      <td className="p-3 text-center">{it.textileColorName || '-'}</td>
                      <td className="p-3 text-center font-bold">{it.isTextile ? (it.textileRollCount || it.quantity || 0) : it.quantity}</td>
                      <td className="p-3">
                        {it.isTextile ? (
                          <div className="space-y-2">
                            <div className="font-bold text-emerald-700">{Number(it.textileTotalLength || 0).toFixed(2)} {it.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {buildTextileDecompositionRows(it).map((entry, rowIdx) => (
                                <input
                                  key={`${idx}-${rowIdx}`}
                                  type="number"
                                  step="0.01"
                                  value={entry.length || ''}
                                  onChange={(e) => updateSelectedNoticeDecomposition(idx, rowIdx, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const next = document.getElementById(`dn-prep-${idx}-${rowIdx + 1}`) as HTMLInputElement | null;
                                      next?.focus();
                                    }
                                  }}
                                  id={`dn-prep-${idx}-${rowIdx}`}
                                  disabled={!canPrepareSubmittedNotices}
                                  className="w-full rounded border p-2 text-center font-bold"
                                  placeholder={`رول ${entry.idx}`}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center">{it.unitName || '-'}</div>
                        )}
                      </td>
                      <td className="p-3">{it.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
              {canPrepareSubmittedNotices && (
                <div className="flex justify-end pt-4">
                  <button
                    disabled={isSubmitting}
                    onClick={() => void submitWarehousePreparation()}
                    className="rounded-lg bg-primary px-5 py-2 font-bold text-white"
                  >
                    إرسال التجهيز للاعتماد
                  </button>
                </div>
              )}
            </div>
          </div>
        </AdaptiveModal>
      )}\n\n      <PrinterPicker
        open={printerPickerOpen}
        onClose={handlePrinterClose}
        onSelect={handlePrinterSelect}
      />
    </div>
  );
};

export default DeliveryNotices;
