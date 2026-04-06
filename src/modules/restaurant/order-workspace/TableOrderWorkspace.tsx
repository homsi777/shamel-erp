import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RestaurantTable, SessionStatus } from '../restaurant.types';
import { useRestaurantCashierSocket } from '../../../hooks/useRestaurantCashierSocket';
import { apiRequest, getCurrentBranchId, getCurrentOrgId } from '../../../lib/api';
import {
  acceptRequest,
  closeSession,
  getRestaurantMenuItems,
  getSession,
  getSessionRequests,
  markRequestSeen,
  openSession,
  rejectRequest,
  emitRestaurantMonitorEvent,
  updateSession,
  type RestaurantSessionRequestRow,
} from '../restaurant.api';
import { formatRelativeTimeShort } from '../restaurant.helpers';
import { printSaleInvoice } from '../../../printing/printService';
import { onPosSaleCompletedPrint, printKitchenTicketTcp, type KitchenTicketPayload } from '../../../lib/printEngine';
import { submitPublicRequest } from '../public/restaurantPublic.api';
import type { AddDialogDraftLine, WorkspaceItemRow } from './types';
import AddTableOrderItemsDialog from './components/AddTableOrderItemsDialog';
import ExchangeRateDialog from './components/ExchangeRateDialog';
import TableOrderActions from './components/TableOrderActions';
import TableOrderHeader from './components/TableOrderHeader';
import TableOrderItemsList from './components/TableOrderItemsList';
import TableOrderSummary from './components/TableOrderSummary';

export interface TableOrderWorkspaceProps {
  sessionId: string | null;
  table?: RestaurantTable | null;
  canManageSessions: boolean;
  canManageTables?: boolean;
  variant?: 'drawer' | 'side' | 'modal';
  onClosePanel: () => void;
  onSessionsChanged: () => void;
}

type CashierDraftLine = {
  key: string;
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  note: string;
  category: string;
};

type MenuOption = {
  itemId: string;
  name: string;
  category: string;
  unitPrice: number;
};

const BASE_CURRENCY = 'USD';
const createRequestId = () => `cashier-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const parseCurrencyCode = (value: unknown) => String(value || '').trim().toUpperCase();
const parseRate = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const parseSettingValue = (raw: unknown) => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
const toMoney = (value: string) => Math.max(0, Number(String(value || '').replace(/,/g, '')) || 0);
const roundCurrency = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const getCashierName = () => {
  try {
    const raw = localStorage.getItem('shamel_user');
    if (!raw) return '';
    const user = JSON.parse(raw) as Record<string, unknown>;
    return String(user?.name || user?.username || '').trim();
  } catch {
    return '';
  }
};
const notifyUser = (message: string) => {
  try {
    window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message } }));
  } catch {
    // ignore
  }
};

type CashBoxOption = { id: string; name: string };
type ClientOption = { id: string; name: string };
type InventoryOption = { id: string; name: string; unitName?: string; warehouseId?: string | null; quantity?: number };
const requestStatusLabel = (status: string) => {
  const key = String(status || '').toLowerCase();
  if (key === 'new') return 'جديد';
  if (key === 'seen') return 'تمت المشاهدة';
  if (key === 'accepted') return 'مقبول';
  if (key === 'rejected') return 'مرفوض';
  if (key === 'archived') return 'مؤرشف';
  return status || '—';
};

const TableOrderWorkspace: React.FC<TableOrderWorkspaceProps> = ({
  sessionId,
  table = null,
  canManageSessions,
  variant = 'modal',
  onClosePanel,
  onSessionsChanged,
}) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof getSession>> | null>(null);
  const [requests, setRequests] = useState<RestaurantSessionRequestRow[]>([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqBusyId, setReqBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);

  const [guestCount, setGuestCount] = useState('');
  const [notes, setNotes] = useState('');

  const [discountBase, setDiscountBase] = useState(0);
  const [taxBase, setTaxBase] = useState(0);
  const [serviceBase, setServiceBase] = useState(0);
  const [paidBase, setPaidBase] = useState(0);

  const [discountInput, setDiscountInput] = useState('0');
  const [taxInput, setTaxInput] = useState('0');
  const [serviceInput, setServiceInput] = useState('0');
  const [paidInput, setPaidInput] = useState('0');

  const [currencyOptions, setCurrencyOptions] = useState<string[]>([BASE_CURRENCY]);
  const [rateByCurrency, setRateByCurrency] = useState<Record<string, number>>({ [BASE_CURRENCY]: 1 });
  const [invoiceCurrency, setInvoiceCurrency] = useState(BASE_CURRENCY);
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<any>(null);
  const [cashBoxes, setCashBoxes] = useState<CashBoxOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [inventoryById, setInventoryById] = useState<Record<string, InventoryOption>>({});
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [selectedCashBoxId, setSelectedCashBoxId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);

  const [menuOptions, setMenuOptions] = useState<MenuOption[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [draftLines, setDraftLines] = useState<CashierDraftLine[]>([]);
  const [sendingDraft, setSendingDraft] = useState(false);

  const activeTable = table || payload?.table || null;
  const session = payload?.session || null;
  const closed = session ? String(session.sessionStatus || '') === 'closed' : false;

  const exchangeRate = useMemo(() => {
    if (invoiceCurrency === BASE_CURRENCY) return 1;
    const r = Number(rateByCurrency[invoiceCurrency] || 0);
    return r > 0 ? r : 1;
  }, [invoiceCurrency, rateByCurrency]);

  const toDisplay = useCallback((baseAmount: number) => {
    if (invoiceCurrency === BASE_CURRENCY) return baseAmount;
    return baseAmount * exchangeRate;
  }, [invoiceCurrency, exchangeRate]);

  const fromDisplay = useCallback((displayAmount: number) => {
    if (invoiceCurrency === BASE_CURRENCY) return displayAmount;
    return exchangeRate > 0 ? displayAmount / exchangeRate : displayAmount;
  }, [invoiceCurrency, exchangeRate]);

  const syncMoneyInputsFromBase = useCallback(() => {
    setDiscountInput(toDisplay(discountBase).toFixed(2));
    setTaxInput(toDisplay(taxBase).toFixed(2));
    setServiceInput(toDisplay(serviceBase).toFixed(2));
    setPaidInput(toDisplay(paidBase).toFixed(2));
  }, [discountBase, taxBase, serviceBase, paidBase, toDisplay]);

  useEffect(() => {
    syncMoneyInputsFromBase();
  }, [syncMoneyInputsFromBase]);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setErr(null);
    try {
      const p = await getSession(sessionId);
      setPayload(p);
      setGuestCount(p.session.guestCount != null ? String(p.session.guestCount) : '');
      setNotes(String(p.session.notes || ''));
      setReqLoading(true);
      try {
        const rq = await getSessionRequests(sessionId);
        setRequests(rq.requests || []);
      } finally {
        setReqLoading(false);
      }
    } catch (e: any) {
      setErr(e?.message || 'تعذر تحميل الجلسة.');
      setPayload(null);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (sessionId) return;
    setPayload(null);
    setRequests([]);
    setGuestCount('');
    setNotes('');
    setErr(null);
  }, [sessionId]);

  useEffect(() => {
    const applyCurrencyConfig = (defaultCurrencyRaw: unknown, ratesRaw: unknown, allowedRaw?: unknown) => {
      const defaultCurrency = parseCurrencyCode(defaultCurrencyRaw || BASE_CURRENCY) || BASE_CURRENCY;
      const rawRates = (ratesRaw && typeof ratesRaw === 'object') ? (ratesRaw as Record<string, unknown>) : {};
      const nextRates: Record<string, number> = { [BASE_CURRENCY]: 1 };
      const allowedFromConfig = Array.isArray(allowedRaw)
        ? allowedRaw.map(parseCurrencyCode).filter(Boolean)
        : [];
      const allowed: string[] = allowedFromConfig.length > 0 ? [...new Set(allowedFromConfig)] : [BASE_CURRENCY];

      for (const [k, v] of Object.entries(rawRates)) {
        const code = parseCurrencyCode(k);
        const rate = parseRate(v);
        if (!code || !rate) continue;
        nextRates[code] = code === BASE_CURRENCY ? 1 : rate;
        if (allowedFromConfig.length === 0 && !allowed.includes(code)) allowed.push(code);
      }

      if (!allowed.includes(defaultCurrency)) {
        allowed.push(defaultCurrency);
        nextRates[defaultCurrency] = defaultCurrency === BASE_CURRENCY ? 1 : (nextRates[defaultCurrency] || 1);
      }

      setRateByCurrency(nextRates);
      setCurrencyOptions(allowed);
      setInvoiceCurrency((prev) => (allowed.includes(prev) ? prev : defaultCurrency));
    };

    const load = async () => {
      try {
        const localRaw = localStorage.getItem('shamel_settings');
        if (localRaw) {
          const parsed = JSON.parse(localRaw);
          applyCurrencyConfig(parsed?.defaultCurrency, parsed?.currencyRates, parsed?.allowedCompanyCurrencies || parsed?.projectCurrencies);
          setAppSettings((prev: any) => ({ ...(prev || {}), ...(parsed || {}) }));
        }
      } catch {
        // ignore local parse errors
      }

      try {
        const rows = await apiRequest('settings');
        if (!Array.isArray(rows)) return;
        const map = new Map(rows.map((r: any) => [String(r.key || ''), parseSettingValue(r.value)]));
        applyCurrencyConfig(
          map.get('defaultCurrency') ?? map.get('primaryCurrency'),
          map.get('currencyRates'),
          map.get('allowedCompanyCurrencies') ?? map.get('projectCurrencies'),
        );
        setAppSettings((prev: any) => ({
          ...(prev || {}),
          defaultCurrency: map.get('defaultCurrency') ?? map.get('primaryCurrency') ?? prev?.defaultCurrency ?? BASE_CURRENCY,
          currencyRates: map.get('currencyRates') ?? prev?.currencyRates ?? { [BASE_CURRENCY]: 1 },
          company: map.get('company') ?? prev?.company ?? null,
          print: map.get('print') ?? prev?.print ?? null,
        }));
      } catch {
        // fallback to local only
      }
    };

    void load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCheckoutDependencies = async () => {
      try {
        const [cashBoxRows, clientRows, inventoryRows] = await Promise.all([
          apiRequest('cash-boxes').catch(() => []),
          apiRequest('clients').catch(() => []),
          apiRequest('inventory').catch(() => []),
        ]);
        if (cancelled) return;

        const parsedCashBoxes = Array.isArray(cashBoxRows)
          ? cashBoxRows
            .map((row: any) => ({ id: String(row?.id || ''), name: String(row?.name || '').trim() }))
            .filter((row: CashBoxOption) => row.id && row.name)
          : [];
        const parsedClients = Array.isArray(clientRows)
          ? clientRows
            .map((row: any) => ({ id: String(row?.id || ''), name: String(row?.name || '').trim() }))
            .filter((row: ClientOption) => row.id && row.name)
          : [];
        const parsedInventory = Array.isArray(inventoryRows)
          ? inventoryRows.reduce((acc: Record<string, InventoryOption>, row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return acc;
            acc[id] = {
              id,
              name: String(row?.name || '').trim() || id,
              unitName: String(row?.unitName || '').trim() || undefined,
              warehouseId: row?.warehouseId || null,
            };
            return acc;
          }, {})
          : {};

        setCashBoxes(parsedCashBoxes);
        setClients(parsedClients);
        setInventoryById(parsedInventory);
      } catch {
        if (cancelled) return;
        setCashBoxes([]);
        setClients([]);
        setInventoryById({});
      }
    };
    void loadCheckoutDependencies();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (invoiceCurrency === BASE_CURRENCY) {
      setRateByCurrency((prev) => ({ ...prev, [BASE_CURRENCY]: 1 }));
    }
  }, [invoiceCurrency]);

  useEffect(() => {
    if (!currencyOptions.includes(invoiceCurrency)) {
      setInvoiceCurrency(currencyOptions[0] || BASE_CURRENCY);
    }
  }, [currencyOptions, invoiceCurrency]);

  useEffect(() => {
    if (selectedCashBoxId && !cashBoxes.some((box) => box.id === selectedCashBoxId)) {
      setSelectedCashBoxId(cashBoxes[0]?.id || '');
    }
  }, [cashBoxes, selectedCashBoxId]);

  useEffect(() => {
    if (selectedClientId && !clients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(clients[0]?.id || '');
    }
  }, [clients, selectedClientId]);

  useEffect(() => {
    let cancelled = false;
    const loadMenu = async () => {
      try {
        const r = await getRestaurantMenuItems();
        const rows = (r.menuItems || [])
          .filter((x: any) => Boolean(x?.isVisibleInQr) && Boolean(x?.isAvailableNow))
          .map((x: any) => {
            const item = (x.item || {}) as any;
            return {
              itemId: String(x.itemId || ''),
              name: String(x.displayNameOverride || item.name || '').trim(),
              category: String(x.categoryName || item.groupName || 'عام').trim() || 'عام',
              unitPrice: Number(item.posPrice ?? item.salePrice ?? 0) || 0,
            };
          })
          .filter((x: MenuOption) => x.itemId && x.name);
        if (!cancelled) setMenuOptions(rows);
      } catch {
        if (!cancelled) setMenuOptions([]);
      }
    };
    void loadMenu();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useRestaurantCashierSocket(Boolean(sessionId) && !closed, {
    onConnect: () => {
      if (sessionId) void reloadRef.current();
    },
    onSessionUpdated: (p) => {
      if (sessionId && String((p as { sessionId?: string })?.sessionId || '') === sessionId) void reloadRef.current();
    },
    onRequestNew: () => {
      if (sessionId) void reloadRef.current();
    },
    onSessionClosed: (p) => {
      if (sessionId && String((p as { sessionId?: string })?.sessionId || '') === sessionId) void reloadRef.current();
    },
  });

  const requestRowsBase = useMemo<WorkspaceItemRow[]>(() => {
    return requests
      .filter((r) => {
        const st = String(r.requestStatus || '');
        return st !== 'rejected' && st !== 'archived';
      })
      .flatMap((r) =>
        (r.items || []).map((line, idx) => {
          const qty = Math.max(1, Number(line.quantity || 0));
          const total = Number(line.lineSubtotal || 0);
          const unit = qty > 0 ? total / qty : total;
          return {
            key: `req-${r.id}-${idx}`,
            itemId: String((line as any).itemId || (line as any).inventoryItemId || (line as any).item_id || '').trim() || undefined,
            name: String(line.itemNameSnapshot || 'صنف'),
            quantity: qty,
            unitPrice: unit,
            lineTotal: total,
            note: line.customerNote || null,
            source: 'request' as const,
            requestId: r.id,
          };
        }),
      );
  }, [requests]);

  const draftRowsBase = useMemo<WorkspaceItemRow[]>(() => {
    return draftLines.map((line) => ({
      key: line.key,
      itemId: line.itemId,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.quantity * line.unitPrice,
      note: line.note,
      source: 'cashier' as const,
    }));
  }, [draftLines]);

  const allRowsBase = useMemo(() => [...requestRowsBase, ...draftRowsBase], [requestRowsBase, draftRowsBase]);

  const allRowsDisplay = useMemo<WorkspaceItemRow[]>(() => {
    return allRowsBase.map((row) => ({
      ...row,
      unitPrice: toDisplay(row.unitPrice),
      lineTotal: toDisplay(row.lineTotal),
    }));
  }, [allRowsBase, toDisplay]);

  const subtotalBase = useMemo(() => allRowsBase.reduce((s, x) => s + Number(x.lineTotal || 0), 0), [allRowsBase]);
  const grandBase = Math.max(0, subtotalBase - discountBase + taxBase + serviceBase);

  useEffect(() => {
    if (paymentType === 'cash') {
      setPaidBase(grandBase);
    } else {
      setPaidBase(0);
    }
  }, [grandBase, paymentType]);

  useEffect(() => {
    if (!selectedCashBoxId && cashBoxes.length > 0) {
      setSelectedCashBoxId(cashBoxes[0].id);
    }
  }, [cashBoxes, selectedCashBoxId]);

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  const formatMoney = useCallback((amountDisplay: number) => `${amountDisplay.toFixed(2)} ${invoiceCurrency}`, [invoiceCurrency]);

  const patchDraft = (key: string, mut: (line: CashierDraftLine) => CashierDraftLine | null) => {
    setDraftLines((prev) => prev.flatMap((line) => {
      if (line.key !== key) return [line];
      const next = mut(line);
      return next ? [next] : [];
    }));
  };

  const emitMonitor = useCallback(async (payload: {
    eventType: string;
    action: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
    status?: 'success' | 'failed' | 'partial' | 'compensated';
    errorCode?: string | null;
    requiresManualReview?: boolean;
    affectedDocumentType?: string | null;
    affectedDocumentId?: string | null;
    metadata?: Record<string, unknown>;
  }) => {
    try {
      await emitRestaurantMonitorEvent({
        ...payload,
        metadata: {
          tableId: activeTable?.id || null,
          tableCode: activeTable?.code || null,
          sessionId: session?.id || sessionId || null,
          ...payload.metadata,
        },
      });
    } catch {
      // fail-safe: monitoring must not block business flow
    }
  }, [activeTable?.code, activeTable?.id, session?.id, sessionId]);

  const buildKitchenTicket = useCallback((items: Array<{ name: string; qty: number; note?: string | null }>, kind: 'new' | 'incremental') => {
    if (!session && !sessionId) return null;
    const filteredItems = items
      .map((line) => ({
        name: String(line.name || '').trim(),
        qty: Math.max(1, Number(line.qty || 0)),
        note: String(line.note || '').trim() || undefined,
      }))
      .filter((line) => line.name && line.qty > 0);
    if (filteredItems.length === 0) return null;

    const storeName = String(appSettings?.company?.name || '').trim() || 'Restaurant';
    const tableCode = String(activeTable?.code || 'T');
    const sessionRef = String((session?.id || sessionId || '').toString()).slice(-6).toUpperCase() || String(Date.now()).slice(-6);
    const cashierName = getCashierName();
    const orderTypeBase = kind === 'new' ? 'طلب جديد' : 'إضافة على الطلب';
    const orderType = cashierName ? `${orderTypeBase} • كاشير: ${cashierName}` : orderTypeBase;

    const payload: KitchenTicketPayload = {
      storeName,
      queueNumber: `${tableCode}-${sessionRef}`,
      invoiceNo: `RS-${sessionRef}`,
      dateText: new Date().toLocaleString('ar-EG'),
      branchName: String(activeTable?.zoneName || '').trim() || undefined,
      orderType,
      items: filteredItems,
    };
    return payload;
  }, [activeTable?.code, activeTable?.zoneName, appSettings?.company?.name, session, sessionId]);

  const tryPrintKitchenTicket = useCallback(async (
    ticket: KitchenTicketPayload | null,
    source: string,
    payloadSummary: string,
  ) => {
    if (!ticket) return;
    const restaurantPrintSettings = appSettings?.print?.restaurant;
    if (!restaurantPrintSettings?.kitchenEnabled) return;
    if (!String(restaurantPrintSettings.kitchenHost || '').trim()) return;
    await emitMonitor({
      eventType: 'RESTAURANT_KITCHEN_TICKET_PRINT_STARTED',
      action: 'kitchen.print.start',
      status: 'success',
      metadata: { source, payloadSummary, printerHost: restaurantPrintSettings.kitchenHost, printerPort: restaurantPrintSettings.kitchenPort },
    });
    const result = await printKitchenTicketTcp({
      kitchen: restaurantPrintSettings,
      companyId: getCurrentOrgId() || undefined,
      branchId: getCurrentBranchId() || undefined,
      kitchenTicket: ticket,
      format: restaurantPrintSettings.kitchenPaperSize === '58mm' ? '58mm' : '80mm',
      logMeta: {
        companyId: getCurrentOrgId() || undefined,
        branchId: getCurrentBranchId() || undefined,
        invoiceId: String(session?.finalInvoiceId || session?.id || sessionId || ''),
        invoiceNumber: ticket.invoiceNo,
        queueNumber: ticket.queueNumber,
        payloadSummary,
        templateId: restaurantPrintSettings.kitchenTemplateId,
        source,
      },
    });
    if (!result.success) {
      await emitMonitor({
        eventType: 'RESTAURANT_KITCHEN_TICKET_PRINT_FAILED',
        action: 'kitchen.print.failed',
        severity: 'warning',
        status: 'failed',
        errorCode: result.error || 'KITCHEN_PRINT_FAILED',
        metadata: { source, payloadSummary, printerHost: restaurantPrintSettings.kitchenHost, printerPort: restaurantPrintSettings.kitchenPort },
      });
      setErr(`تم تنفيذ العملية، لكن تعذرت طباعة تذكرة المطبخ: ${result.error || 'فشل الطباعة'}`);
      return;
    }
    await emitMonitor({
      eventType: 'RESTAURANT_KITCHEN_TICKET_PRINT_SUCCEEDED',
      action: 'kitchen.print.success',
      status: 'success',
      metadata: { source, payloadSummary, printerHost: restaurantPrintSettings.kitchenHost, printerPort: restaurantPrintSettings.kitchenPort },
    });
  }, [appSettings?.print?.restaurant, emitMonitor, session?.finalInvoiceId, session?.id, sessionId]);

  const openSessionForTable = async () => {
    if (!activeTable?.id || !canManageSessions) return;
    setOpening(true);
    setErr(null);
    try {
      await openSession(activeTable.id, {
        guestCount: guestCount.trim() === '' ? null : Math.max(0, parseInt(guestCount, 10) || 0),
        notes: notes.trim() || null,
      });
      onSessionsChanged();
    } catch (e: any) {
      setErr(e?.message || 'تعذر فتح الجلسة.');
    } finally {
      setOpening(false);
    }
  };

  const saveMeta = async () => {
    if (!sessionId || !canManageSessions || closed) return;
    setSaving(true);
    setErr(null);
    try {
      await updateSession(sessionId, {
        guestCount: guestCount.trim() === '' ? null : Math.max(0, parseInt(guestCount, 10) || 0),
        notes: notes.trim() || null,
        preliminaryTotal: subtotalBase,
      });
      await emitMonitor({
        eventType: 'RESTAURANT_CASHIER_ORDER_SAVED',
        action: 'cashier.order.save',
        status: 'success',
        metadata: { guestCount: guestCount.trim(), hasNotes: Boolean(notes.trim()), preliminaryTotal: subtotalBase },
      });
      await reload();
      onSessionsChanged();
    } catch (e: any) {
      await emitMonitor({
        eventType: 'RESTAURANT_CASHIER_ORDER_SAVED',
        action: 'cashier.order.save',
        severity: 'error',
        status: 'failed',
        errorCode: e?.code || 'RESTAURANT_ORDER_SAVE_FAILED',
        metadata: { message: e?.message || 'save failed' },
      });
      setErr(e?.message || 'تعذر حفظ التعديلات.');
    } finally {
      setSaving(false);
    }
  };

  const sendDraftToTable = async () => {
    if (!sessionId || !activeTable?.publicQrToken || draftLines.length === 0 || closed) return;
    setSendingDraft(true);
    setErr(null);
    const draftSnapshot = draftLines.map((line) => ({
      name: line.name,
      qty: line.quantity,
      note: line.note,
    }));
    try {
      await emitMonitor({
        eventType: 'RESTAURANT_KITCHEN_SEND_STARTED',
        action: 'cashier.order.send_to_kitchen.start',
        status: 'success',
        metadata: { linesCount: draftSnapshot.length },
      });
      const publicToken = String(activeTable.publicQrToken || '').trim();
      const response = await submitPublicRequest(publicToken, {
        clientRequestId: createRequestId(),
        note: notes.trim() || null,
        items: draftLines.map((line) => ({ itemId: line.itemId, quantity: line.quantity, note: line.note.trim() || null })),
      });
      if (response?.requestId) {
        await markRequestSeen(response.requestId);
        await acceptRequest(response.requestId);
      }
      setDraftLines([]);
      await reload();
      onSessionsChanged();
      const kitchenTicket = buildKitchenTicket(draftSnapshot, 'incremental');
      await tryPrintKitchenTicket(
        kitchenTicket,
        'restaurant_send_to_kitchen',
        `session:${sessionId}|table:${activeTable.code || ''}|incremental`,
      );
      await emitMonitor({
        eventType: 'RESTAURANT_KITCHEN_SEND_COMPLETED',
        action: 'cashier.order.send_to_kitchen.complete',
        status: 'success',
        metadata: { requestId: response?.requestId || null, linesCount: draftSnapshot.length },
      });
    } catch (e: any) {
      await emitMonitor({
        eventType: 'RESTAURANT_KITCHEN_SEND_FAILED',
        action: 'cashier.order.send_to_kitchen.failed',
        severity: 'error',
        status: 'failed',
        errorCode: e?.code || 'RESTAURANT_SEND_TO_KITCHEN_FAILED',
        metadata: { message: e?.message || 'send failed', linesCount: draftSnapshot.length },
      });
      setErr(e?.message || 'تعذر إرسال البنود للطاولة.');
    } finally {
      setSendingDraft(false);
    }
  };

  const checkoutAsPosSale = async () => {
    if (!sessionId || !session || !canManageSessions || closed) return;
    if (checkingOut) return;

    const hasBillableItems = allRowsBase.some((row) => Number(row.quantity || 0) > 0 && Number(row.lineTotal || 0) > 0);
    if (!hasBillableItems) {
      void emitMonitor({ eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED', action: 'checkout.validate', severity: 'warning', status: 'failed', errorCode: 'RESTAURANT_CHECKOUT_NO_BILLABLE_ITEMS' });
      setErr('لا يمكن إتمام البيع بدون أصناف قابلة للفوترة.');
      return;
    }

    if (!currencyOptions.includes(invoiceCurrency)) {
      void emitMonitor({ eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED', action: 'checkout.validate', severity: 'warning', status: 'failed', errorCode: 'RESTAURANT_CHECKOUT_INVALID_CURRENCY', metadata: { invoiceCurrency } });
      setErr('العملة المحددة غير متاحة ضمن عملات المشروع.');
      return;
    }
    if (invoiceCurrency !== BASE_CURRENCY && exchangeRate <= 0) {
      void emitMonitor({ eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED', action: 'checkout.validate', severity: 'warning', status: 'failed', errorCode: 'RESTAURANT_CHECKOUT_INVALID_RATE', metadata: { invoiceCurrency, exchangeRate } });
      setErr('سعر الصرف غير صالح.');
      return;
    }

    const rowsMissingItemId = allRowsBase.filter((row) => !String(row.itemId || '').trim());
    if (rowsMissingItemId.length > 0) {
      void emitMonitor({ eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED', action: 'checkout.validate', severity: 'warning', status: 'failed', errorCode: 'RESTAURANT_CHECKOUT_MISSING_ITEM_ID', metadata: { count: rowsMissingItemId.length } });
      setErr('بعض البنود لا تحمل معرف منتج صالح. راجع الطلبات قبل إتمام الفاتورة.');
      return;
    }
    const stockDeficits = allRowsBase
      .map((row) => {
        const itemId = String(row.itemId || '').trim();
        if (!itemId) return null;
        const item = inventoryById[itemId];
        const requested = Math.max(0, Number(row.quantity || 0));
        const available = Number(item?.quantity ?? NaN);
        if (!Number.isFinite(available)) return null;
        if (available + 1e-9 >= requested) return null;
        return {
          itemId,
          name: String(row.name || item?.name || itemId),
          requested,
          available,
          missing: roundCurrency(Math.max(0, requested - available)),
        };
      })
      .filter(Boolean) as Array<{ itemId: string; name: string; requested: number; available: number; missing: number }>;
    if (stockDeficits.length > 0) {
      void emitMonitor({
        eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED',
        action: 'checkout.validate',
        severity: 'warning',
        status: 'failed',
        errorCode: 'INSUFFICIENT_STOCK',
        metadata: {
          count: stockDeficits.length,
          items: stockDeficits.slice(0, 8).map((x) => ({ itemId: x.itemId, name: x.name, requested: x.requested, available: x.available })),
        },
      });
      const preview = stockDeficits
        .slice(0, 3)
        .map((x) => `${x.name} (المتاح ${x.available} / المطلوب ${x.requested})`)
        .join('، ');
      setErr(stockDeficits.length > 3
        ? `لا يمكن إتمام البيع: المخزون غير كافٍ لبعض الأصناف (${stockDeficits.length} أصناف). أمثلة: ${preview}.`
        : `لا يمكن إتمام البيع: المخزون غير كافٍ. ${preview}.`);
      return;
    }

    const selectedCashBox = cashBoxes.find((x) => x.id === selectedCashBoxId) || null;
    const selectedClient = clients.find((x) => x.id === selectedClientId) || null;

    if (paymentType === 'cash' && !selectedCashBox) {
      void emitMonitor({ eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED', action: 'checkout.validate', severity: 'warning', status: 'failed', errorCode: 'RESTAURANT_CHECKOUT_MISSING_CASHBOX' });
      setErr('الرجاء اختيار صندوق نقدي صالح.');
      return;
    }
    if (paymentType === 'credit' && !selectedClient) {
      void emitMonitor({ eventType: 'RESTAURANT_CHECKOUT_VALIDATION_FAILED', action: 'checkout.validate', severity: 'warning', status: 'failed', errorCode: 'RESTAURANT_CHECKOUT_MISSING_CLIENT' });
      setErr('الرجاء اختيار عميل للبيع الآجل.');
      return;
    }

    setCheckingOut(true);
    setErr(null);
    let settledInvoiceId: string | null = null;
    let settledInvoiceNumber: string | null = null;
    let saleFinalized = false;
    try {
      await emitMonitor({
        eventType: 'RESTAURANT_CHECKOUT_STARTED',
        action: 'checkout.start',
        status: 'success',
        metadata: { paymentType, currency: invoiceCurrency, exchangeRate, rowsCount: allRowsBase.length },
      });
      let invoiceNo = '';
      try {
        const next = await apiRequest('next-number/pos');
        invoiceNo = String(next?.number || '').trim();
      } catch {
        invoiceNo = '';
      }
      if (!invoiceNo) invoiceNo = String(Date.now()).slice(-6);

      const exchange = invoiceCurrency === BASE_CURRENCY ? 1 : exchangeRate;
      const createdAtIso = new Date().toISOString();
      const invoiceId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const invoiceItems = allRowsBase.map((row) => {
        const item = row.itemId ? inventoryById[String(row.itemId)] : undefined;
        const quantity = Math.max(1, Number(row.quantity || 0));
        const unitPriceBase = roundCurrency(Number(row.unitPrice || 0));
        const lineTotalBase = roundCurrency(Number(row.lineTotal || 0));
        const unitPriceTransaction = invoiceCurrency === BASE_CURRENCY ? unitPriceBase : roundCurrency(unitPriceBase * exchange);
        const lineTotalTransaction = invoiceCurrency === BASE_CURRENCY ? lineTotalBase : roundCurrency(lineTotalBase * exchange);
        return {
          itemId: String(row.itemId || ''),
          itemName: row.name,
          quantity,
          baseQuantity: quantity,
          unitPrice: unitPriceTransaction,
          unitPriceTransaction,
          unitPriceBase,
          total: lineTotalTransaction,
          lineTotalTransaction,
          lineTotalBase,
          unitName: item?.unitName || 'وحدة',
          currency: invoiceCurrency,
          exchangeRate: exchange,
          warehouseId: item?.warehouseId || null,
        };
      });

      const totalAmountBase = roundCurrency(grandBase);
      const totalAmountTransaction = invoiceCurrency === BASE_CURRENCY ? totalAmountBase : roundCurrency(totalAmountBase * exchange);
      const discountBaseValue = roundCurrency(discountBase);
      const discountTransaction = invoiceCurrency === BASE_CURRENCY ? discountBaseValue : roundCurrency(discountBaseValue * exchange);
      const paidAmountBase = paymentType === 'cash' ? totalAmountBase : 0;
      const paidAmountTransaction = paymentType === 'cash' ? totalAmountTransaction : 0;
      const remainingAmountBase = paymentType === 'credit' ? totalAmountBase : 0;
      const remainingAmountTransaction = invoiceCurrency === BASE_CURRENCY ? remainingAmountBase : roundCurrency(remainingAmountBase * exchange);
      const creditClient = selectedClient || null;
      const targetWarehouseId = invoiceItems.find((x) => String(x.warehouseId || '').trim())?.warehouseId || null;

      const invoicePayload = {
        id: invoiceId,
        invoiceNumber: invoiceNo,
        type: 'sale',
        currency: invoiceCurrency,
        exchangeRate: exchange,
        paymentType,
        cashBoxId: paymentType === 'cash' ? selectedCashBox?.id || null : null,
        cashBoxName: paymentType === 'cash' ? selectedCashBox?.name || null : null,
        clientId: paymentType === 'credit' ? creditClient?.id || null : null,
        clientName: paymentType === 'credit' ? (creditClient?.name || 'عميل') : 'عميل نقدي',
        date: new Date().toISOString().split('T')[0],
        createdAt: createdAtIso,
        items: invoiceItems,
        totalAmount: totalAmountBase,
        totalAmountBase,
        totalAmountTransaction,
        discount: discountBaseValue,
        discountBase: discountBaseValue,
        discountTransaction,
        originalAmount: totalAmountTransaction,
        paidAmount: paidAmountBase,
        paidAmountBase,
        paidAmountTransaction,
        paidAmountOriginal: paidAmountTransaction,
        remainingAmount: remainingAmountBase,
        remainingAmountBase,
        remainingAmountTransaction,
        notes: [notes.trim(), `الطاولة: ${activeTable?.code || ''} ${activeTable?.name || ''}`].filter(Boolean).join(' | '),
        targetWarehouseId,
        posSale: true,
        sourceDocumentType: 'restaurant_session',
        sourceDocumentId: String(sessionId),
      } as any;

      await emitMonitor({
        eventType: 'RESTAURANT_CHECKOUT_INVOICE_CREATE_STARTED',
        action: 'checkout.invoice.create.start',
        status: 'success',
        metadata: { totalAmountBase, paymentType, currency: invoiceCurrency },
      });
      const createdInvoice = await apiRequest('invoices', { method: 'POST', body: JSON.stringify(invoicePayload) });
      const createdInvoiceId = String(createdInvoice?.id || '').trim();
      if (!createdInvoiceId) {
        await emitMonitor({
          eventType: 'RESTAURANT_CHECKOUT_INVOICE_CREATE_FAILED',
          action: 'checkout.invoice.create.failed',
          severity: 'error',
          status: 'failed',
          errorCode: 'RESTAURANT_INVOICE_ID_MISSING',
        });
        throw new Error('تعذر تأكيد إنشاء الفاتورة رسميًا.');
      }
      settledInvoiceId = createdInvoiceId;
      settledInvoiceNumber = String(createdInvoice?.invoiceNumber || invoiceNo || '').trim() || null;
      await emitMonitor({
        eventType: 'RESTAURANT_CHECKOUT_INVOICE_CREATED',
        action: 'checkout.invoice.create.success',
        status: 'success',
        affectedDocumentType: 'invoice',
        affectedDocumentId: createdInvoiceId,
        metadata: {
          invoiceNumber: String(createdInvoice?.invoiceNumber || invoiceNo),
          duplicate: Boolean(createdInvoice?.duplicate),
        },
      });
      await apiRequest(`invoices/${encodeURIComponent(createdInvoiceId)}`);
      await emitMonitor({
        eventType: 'RESTAURANT_INVOICE_VERIFIED_IN_REGISTER',
        action: 'checkout.invoice.verify',
        status: 'success',
        affectedDocumentType: 'invoice',
        affectedDocumentId: createdInvoiceId,
      });
      saleFinalized = true;
      const queueFromServer = createdInvoice?.queueNumber != null ? String(createdInvoice.queueNumber) : undefined;
      const receiptData: any = {
        storeName: String(appSettings?.company?.name || '').trim() || 'ERP',
        storePhone: String(appSettings?.company?.phone1 || '').trim() || undefined,
        invoiceNo,
        dateText: new Date().toLocaleString('ar-EG'),
        customerName: invoicePayload.clientName || 'عميل نقدي',
        items: invoiceItems.map((line) => ({
          name: String(line.itemName || '').trim() || 'صنف',
          qty: Number(line.quantity || 0),
          price: Number(line.unitPriceTransaction || 0),
        })),
        discount: discountTransaction || undefined,
        paid: paymentType === 'cash' ? totalAmountTransaction : 0,
        currencyLabel: invoiceCurrency,
        ...(queueFromServer && (appSettings?.print?.restaurant?.showQueueOnCustomer !== false)
          ? { queueNumber: queueFromServer }
          : {}),
      };

      const thermalPaper = appSettings?.print?.thermal?.paperSize === '58mm' ? '58mm' : '80mm';
      let printWarning: string | null = null;
      try {
        await emitMonitor({
          eventType: 'RESTAURANT_CHECKOUT_PRINT_STARTED',
          action: 'checkout.print.start',
          status: 'success',
          affectedDocumentType: 'invoice',
          affectedDocumentId: createdInvoiceId,
        });
        const printResult = await onPosSaleCompletedPrint({
          receiptData,
          companyId: getCurrentOrgId() || undefined,
          branchId: getCurrentBranchId() || undefined,
          format: thermalPaper,
          kitchenFormat: appSettings?.print?.restaurant?.kitchenPaperSize === '58mm' ? '58mm' : '80mm',
          printSettings: appSettings?.print,
          invoiceId: String(createdInvoice?.id || invoiceId),
          invoiceNumber: String(createdInvoice?.invoiceNumber || invoiceNo),
        });
        if (!printResult.success) {
          try {
            await printSaleInvoice(receiptData, { paperSize: thermalPaper });
          } catch {
            // keep non-blocking
          }
          const code = String(printResult.error || '').trim().toUpperCase();
          printWarning = code === 'NO_PRINTER'
            ? 'تم إتمام البيع رسميًا، لكن فشلت طباعة الفاتورة: لا توجد طابعة POS مهيأة لهذه الشركة/الفرع.'
            : `تم إتمام البيع رسميًا، لكن فشلت طباعة الفاتورة: ${printResult.error || 'Print failed'}`;
          await emitMonitor({
            eventType: 'RESTAURANT_CHECKOUT_PRINT_FAILED',
            action: 'checkout.print.failed',
            severity: 'warning',
            status: 'partial',
            errorCode: code || 'POS_PRINTER_NOT_RESOLVED',
            affectedDocumentType: 'invoice',
            affectedDocumentId: createdInvoiceId,
            metadata: { reason: printResult.error || 'fallback_print' },
          });
        } else {
          await emitMonitor({
            eventType: 'RESTAURANT_CHECKOUT_PRINT_SUCCEEDED',
            action: 'checkout.print.success',
            status: 'success',
            affectedDocumentType: 'invoice',
            affectedDocumentId: createdInvoiceId,
          });
        }
      } catch (printError: any) {
        printWarning = `تم إتمام البيع رسميًا، لكن حصل خطأ أثناء الطباعة: ${printError?.message || 'Print exception'}`;
        await emitMonitor({
          eventType: 'RESTAURANT_CHECKOUT_PRINT_FAILED',
          action: 'checkout.print.failed',
          severity: 'warning',
          status: 'partial',
          errorCode: String(printError?.code || 'CHECKOUT_PRINT_EXCEPTION'),
          affectedDocumentType: 'invoice',
          affectedDocumentId: createdInvoiceId,
          metadata: { message: printError?.message || 'print exception' },
        });
      }

      await emitMonitor({
        eventType: paymentType === 'cash' ? 'RESTAURANT_CASH_PAYMENT_RECORDED' : 'RESTAURANT_CREDIT_SALE_RECORDED',
        action: paymentType === 'cash' ? 'checkout.payment.cash' : 'checkout.payment.credit',
        status: 'success',
        affectedDocumentType: 'invoice',
        affectedDocumentId: createdInvoiceId,
        metadata: { cashBoxId: selectedCashBox?.id || null, clientId: selectedClient?.id || null },
      });
      try {
        await closeSession(sessionId);
      } catch (closeError: any) {
        const closeCode = String(closeError?.code || 'SESSION_CLOSE_FAILED_AFTER_SUCCESSFUL_SALE');
        await emitMonitor({
          eventType: 'RESTAURANT_CHECKOUT_FAILED',
          action: 'checkout.failed',
          severity: closeCode === 'RESTAURANT_SESSION_HAS_UNREAD_REQUESTS' ? 'warning' : 'error',
          status: 'partial',
          errorCode: closeCode,
          affectedDocumentType: 'invoice',
          affectedDocumentId: createdInvoiceId,
          metadata: {
            message: closeError?.message || 'session close failed after successful sale',
            invoiceNumber: String(createdInvoice?.invoiceNumber || invoiceNo),
            paymentType,
          },
        });
        throw {
          code: closeCode,
          message: closeError?.message || 'تعذر إغلاق جلسة الطاولة بعد إتمام البيع.',
          details: {
            invoiceId: createdInvoiceId,
            invoiceNumber: String(createdInvoice?.invoiceNumber || invoiceNo),
          },
        };
      }
      await emitMonitor({
        eventType: 'RESTAURANT_CHECKOUT_COMPLETED',
        action: 'checkout.complete',
        status: 'success',
        affectedDocumentType: 'invoice',
        affectedDocumentId: createdInvoiceId,
      });
      if (printWarning) notifyUser(`${printWarning} (الفاتورة: ${String(createdInvoice?.invoiceNumber || invoiceNo)})`);
      onSessionsChanged();
      onClosePanel();
    } catch (e: any) {
      if (!saleFinalized) {
        await emitMonitor({
          eventType: paymentType === 'cash' ? 'RESTAURANT_CASH_PAYMENT_RECORD_FAILED' : 'RESTAURANT_CREDIT_SALE_RECORD_FAILED',
          action: paymentType === 'cash' ? 'checkout.payment.cash' : 'checkout.payment.credit',
          severity: 'error',
          status: 'failed',
          errorCode: e?.code || 'RESTAURANT_PAYMENT_RECORD_FAILED',
          metadata: { message: e?.message || 'payment posting failed' },
        });
      }
      await emitMonitor({
        eventType: 'RESTAURANT_CHECKOUT_FAILED',
        action: 'checkout.failed',
        severity: e?.code === 'RESTAURANT_SESSION_HAS_UNREAD_REQUESTS' || e?.code === 'SESSION_CLOSE_FAILED_AFTER_SUCCESSFUL_SALE' ? 'warning' : 'error',
        status: e?.code === 'RESTAURANT_SESSION_HAS_UNREAD_REQUESTS' || e?.code === 'SESSION_CLOSE_FAILED_AFTER_SUCCESSFUL_SALE' ? 'partial' : 'failed',
        errorCode: e?.code || 'RESTAURANT_CHECKOUT_FAILED',
        affectedDocumentType: settledInvoiceId ? 'invoice' : null,
        affectedDocumentId: settledInvoiceId || null,
        metadata: {
          message: e?.message || 'checkout failed',
          paymentType,
          invoiceId: settledInvoiceId,
          invoiceNumber: settledInvoiceNumber,
          saleFinalized,
        },
      });
      if (e?.code === 'RESTAURANT_SESSION_HAS_UNREAD_REQUESTS') {
        setErr('تم تسجيل الفاتورة رسميًا، لكن ظهرت طلبات جديدة غير معالجة قبل الإغلاق. راجع الطلبات ثم أغلق الجلسة.');
      } else if (e?.code === 'SESSION_CLOSE_FAILED_AFTER_SUCCESSFUL_SALE') {
        const ref = String(e?.details?.invoiceNumber || settledInvoiceNumber || e?.details?.invoiceId || settledInvoiceId || '').trim();
        setErr(ref ? `تم إتمام البيع رسميًا بالفاتورة ${ref}، لكن تعذر إغلاق جلسة الطاولة. راجع الجلسة وأغلقها يدويًا.` : 'تم إتمام البيع رسميًا، لكن تعذر إغلاق جلسة الطاولة. راجع الجلسة وأغلقها يدويًا.');
      } else if (e?.code === 'RESTAURANT_SESSION_ALREADY_INVOICED') {
        const existingInvoiceId = String(e?.details?.existingInvoiceId || '').trim();
        const ref = String(e?.details?.existingInvoiceNumber || existingInvoiceId || '').trim();
        try {
          await closeSession(sessionId);
          await emitMonitor({
            eventType: 'RESTAURANT_CHECKOUT_COMPLETED',
            action: 'checkout.complete',
            severity: 'warning',
            status: 'partial',
            errorCode: 'RESTAURANT_SESSION_ALREADY_INVOICED',
            affectedDocumentType: existingInvoiceId ? 'invoice' : null,
            affectedDocumentId: existingInvoiceId || null,
            metadata: {
              message: 'Session already invoiced; table session was closed safely without creating a duplicate invoice.',
              invoiceNumber: ref || null,
            },
          });
          onSessionsChanged();
          onClosePanel();
          notifyUser(ref ? `تم العثور على فاتورة سابقة للجلسة (${ref}) وتم إغلاق الطاولة بدون إنشاء فاتورة مكررة.` : 'هذه الجلسة مفوترة مسبقًا وتم إغلاق الطاولة بدون إنشاء فاتورة مكررة.');
          return;
        } catch {
          setErr(ref ? `هذه الجلسة لديها فاتورة رسمية مسبقًا: ${ref}` : 'هذه الجلسة لديها فاتورة رسمية مسبقًا.');
        }
      } else if (e?.code === 'CASH_BOX_REQUIRED') {
        setErr('لا يمكن إتمام البيع النقدي: يجب اختيار صندوق نقدي صالح.');
      } else if (e?.code === 'INSUFFICIENT_STOCK' || e?.code === 'STOCK_LEDGER_INVARIANT_BROKEN') {
        setErr('لا يمكن إتمام البيع: الكمية المطلوبة غير متاحة في المخزون. حدّث الكميات أو عدّل بنود الطلب ثم أعد المحاولة.');
      } else if (e?.code === 'SOURCE_DOCUMENT_CONFLICT') {
        setErr('لا يمكن إتمام البيع: مرجع المستند المصدر مستخدم مسبقًا لفاتورة أخرى.');
      } else if (e?.code === 'INVOICE_POST_CONFLICT') {
        setErr('لا يمكن إتمام البيع: حصل تعارض أثناء إنشاء الفاتورة الرسمية. أعد التحميل ثم حاول مرة أخرى.');
      } else if (Number(e?.status || 0) === 409) {
        const backendCode = String(e?.code || '').trim();
        const backendMsg = String(e?.message || 'تعارض في إنشاء الفاتورة').trim();
        setErr(backendCode ? `تعذر إتمام البيع بسبب تعارض: ${backendMsg} [${backendCode}]` : `تعذر إتمام البيع بسبب تعارض: ${backendMsg}`);
      } else if (e?.code === 'INVOICE_SCOPE_BRANCH_MISMATCH' || e?.code === 'BRANCH_SCOPE_MISMATCH') {
        setErr('تعذر إتمام البيع: يوجد تعارض في نطاق الفرع/المستودع. راجع الفرع النشط ثم أعد المحاولة.');
      } else if (e?.code === 'INVOICE_SCOPE_COMPANY_MISMATCH') {
        setErr('تعذر إتمام البيع: سياق الشركة غير مطابق لبيانات الفاتورة.');
      } else if (e?.code === 'CREDIT_CLIENT_REQUIRED' || e?.code === 'CLIENT_REQUIRED') {
        setErr('لا يمكن إتمام البيع الآجل بدون عميل صالح.');
      } else {
        setErr(`${e?.message || 'تعذر إتمام عملية الدفع.'}${e?.code ? ` [${e.code}]` : ''}`);
      }
    } finally {
      setCheckingOut(false);
    }
  };

  const printBill = async () => {
    if (!session) return;
    try {
      const invoiceNo = `RS-${String(session.id || '').slice(-6).toUpperCase()}`;
      const customerName = activeTable ? `${activeTable.code} - ${activeTable.name}` : 'طاولة';
      const printItems = allRowsDisplay.map((row) => ({ name: row.name, qty: row.quantity, price: row.unitPrice }));
      const receiptData: any = {
        storeName: String(appSettings?.company?.name || '').trim() || 'Restaurant',
        storePhone: String(appSettings?.company?.phone1 || '').trim() || undefined,
        invoiceNo,
        dateText: new Date().toLocaleString('ar-EG'),
        customerName,
        items: printItems,
        discount: toDisplay(discountBase),
        paid: toDisplay(paidBase),
        currencyLabel: invoiceCurrency,
      };
      const format = appSettings?.print?.thermal?.paperSize === '58mm' ? '58mm' : '80mm';
      const printResult = await onPosSaleCompletedPrint({
        receiptData,
        companyId: getCurrentOrgId() || undefined,
        branchId: getCurrentBranchId() || undefined,
        format,
        kitchenFormat: appSettings?.print?.restaurant?.kitchenPaperSize === '58mm' ? '58mm' : '80mm',
        printSettings: appSettings?.print,
        invoiceId: String(session.id || ''),
        invoiceNumber: invoiceNo,
      });
      if (!printResult.success) {
        await printSaleInvoice(receiptData, { paperSize: format });
      }
    } catch (e: any) {
      setErr(e?.message || 'تعذر الطباعة.');
    }
  };

  const requestStatusAction = async (
    requestId: string,
    fn: (id: string) => Promise<unknown>,
    opts?: { printKitchenOnAccept?: boolean; request?: RestaurantSessionRequestRow; monitorEventType?: string; monitorAction?: string },
  ) => {
    setReqBusyId(requestId);
    setErr(null);
    try {
      await fn(requestId);
      await emitMonitor({
        eventType: opts?.monitorEventType || 'RESTAURANT_QR_REQUEST_SEEN',
        action: opts?.monitorAction || 'qr.request.update',
        status: 'success',
        affectedDocumentType: 'restaurant_request',
        affectedDocumentId: requestId,
      });
      await reload();
      onSessionsChanged();
      if (opts?.printKitchenOnAccept && opts.request) {
        const requestRows = (opts.request.items || []).map((line) => ({
          name: String(line.itemNameSnapshot || '').trim(),
          qty: Math.max(1, Number(line.quantity || 0)),
          note: line.customerNote || null,
        }));
        const kitchenTicket = buildKitchenTicket(requestRows, 'new');
        await tryPrintKitchenTicket(
          kitchenTicket,
          'restaurant_accept_request',
          `session:${sessionId || ''}|request:${requestId}|accepted`,
        );
      }
    } catch (e: any) {
      await emitMonitor({
        eventType: opts?.monitorEventType || 'RESTAURANT_QR_REQUEST_SEEN',
        action: opts?.monitorAction || 'qr.request.update',
        severity: 'error',
        status: 'failed',
        errorCode: e?.code || 'RESTAURANT_QR_REQUEST_ACTION_FAILED',
        affectedDocumentType: 'restaurant_request',
        affectedDocumentId: requestId,
        metadata: { message: e?.message || 'request update failed' },
      });
      setErr(e?.message || 'تعذر تحديث حالة الطلب.');
    } finally {
      setReqBusyId(null);
    }
  };

  const canRender = Boolean(sessionId || activeTable);
  if (!canRender) return null;

  const isOverlay = variant === 'drawer' || variant === 'modal';

  return (
    <div
      className={
        variant === 'drawer'
          ? 'fixed inset-0 z-50 flex justify-end bg-black/40 p-0 sm:p-4'
          : variant === 'modal'
            ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4'
            : 'relative z-0 h-full w-full rounded-2xl border border-slate-200 bg-white shadow-sm'
      }
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onMouseDown={isOverlay ? (e) => { if (e.target === e.currentTarget) onClosePanel(); } : undefined}
    >
      <div
        className={
          variant === 'drawer'
            ? 'flex h-full w-full max-w-6xl flex-col bg-slate-50 sm:rounded-2xl sm:shadow-2xl'
            : variant === 'modal'
              ? 'flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl'
              : 'flex h-full w-full flex-col bg-slate-50'
        }
      >
        <TableOrderHeader
          table={activeTable}
          sessionStatus={session?.sessionStatus || 'open'}
          sessionId={session?.id || null}
          openedAt={session?.openedAt || null}
          lastActivityAt={session?.lastActivityAt || null}
          currencyCode={invoiceCurrency}
          currencyOptions={currencyOptions}
          exchangeRate={exchangeRate}
          onCurrencyChange={(code) => {
            if (!currencyOptions.includes(code)) return;
            setInvoiceCurrency(code);
          }}
          onEditRate={() => setRateDialogOpen(true)}
          onClose={onClosePanel}
        />

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
          {loading ? <div className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-500">جاري التحميل...</div> : null}
          {err ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{err}</div> : null}

          {!session && activeTable ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-bold text-slate-500">لا يوجد طلب نشط لهذه الطاولة حتى الآن.</div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">عدد الضيوف
                  <input type="number" min={0} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-bold text-slate-600">ملاحظات
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>
              <button type="button" disabled={!canManageSessions || opening} onClick={() => void openSessionForTable()} className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">{opening ? 'جاري الفتح...' : 'فتح طلب الطاولة'}</button>
            </div>
          ) : null}

          {session ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <div className="space-y-4 xl:col-span-8">
                <TableOrderActions
                  disabled={!canManageSessions || closed || saving || sendingDraft || checkingOut}
                  checkoutDisabled={!canManageSessions || closed || checkingOut || allRowsBase.length === 0}
                  checkoutLabel={checkingOut ? 'جاري المعالجة...' : 'إتمام البيع'}
                  onAddItem={() => setAddDialogOpen(true)}
                  onSave={() => void saveMeta()}
                  onSend={() => void sendDraftToTable()}
                  onPrint={() => void printBill()}
                  onCheckout={() => void checkoutAsPosSale()}
                />

                <TableOrderItemsList
                  rows={allRowsDisplay}
                  formatMoney={formatMoney}
                  onIncCashierLine={(key) => {
                    patchDraft(key, (line) => ({ ...line, quantity: line.quantity + 1 }));
                    void emitMonitor({ eventType: 'RESTAURANT_CASHIER_ITEM_QTY_CHANGED', action: 'cashier.item.qty.inc', status: 'success', metadata: { lineKey: key } });
                  }}
                  onDecCashierLine={(key) => {
                    patchDraft(key, (line) => (line.quantity <= 1 ? null : { ...line, quantity: line.quantity - 1 }));
                    void emitMonitor({ eventType: 'RESTAURANT_CASHIER_ITEM_QTY_CHANGED', action: 'cashier.item.qty.dec', status: 'success', metadata: { lineKey: key } });
                  }}
                  onRemoveCashierLine={(key) => {
                    patchDraft(key, () => null);
                    void emitMonitor({ eventType: 'RESTAURANT_CASHIER_ITEMS_REMOVED', action: 'cashier.item.remove', status: 'success', metadata: { lineKey: key } });
                  }}
                />

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-black tracking-wide text-slate-500">الطلبات الحية</h3>
                    <span className="text-xs font-bold text-slate-500">آخر تحديث {formatRelativeTimeShort(session.lastActivityAt)}</span>
                  </div>
                  {reqLoading ? <div className="text-xs font-bold text-slate-400">جاري تحميل الطلبات...</div> : null}
                  <div className="space-y-2">
                    {requests.slice(0, 8).map((r) => {
                      const status = String(r.requestStatus || 'new');
                      return (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span className="font-mono text-slate-500">{String(r.submittedAt || '').slice(0, 19).replace('T', ' ')}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-slate-700">{requestStatusLabel(status)}</span>
                          </div>
                          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                            {(r.items || []).map((ln, idx) => (
                              <li key={`${r.id}-${idx}`} className="flex justify-between"><span>{ln.itemNameSnapshot} × {ln.quantity}</span><span className="font-mono">{formatMoney(toDisplay(Number(ln.lineSubtotal || 0)))}</span></li>
                            ))}
                          </ul>
                          {canManageSessions && !closed && (status === 'new' || status === 'seen') ? (
                            <div className="mt-2 flex gap-2">
                              {status === 'new' ? <button type="button" disabled={reqBusyId === r.id} onClick={() => void requestStatusAction(r.id, markRequestSeen, { monitorEventType: 'RESTAURANT_QR_REQUEST_SEEN', monitorAction: 'qr.request.seen' })} className="rounded-md bg-slate-200 px-2 py-1 text-[11px] font-black text-slate-800">تمت المشاهدة</button> : null}
                              <button type="button" disabled={reqBusyId === r.id} onClick={() => void requestStatusAction(r.id, acceptRequest, { printKitchenOnAccept: true, request: r, monitorEventType: 'RESTAURANT_QR_REQUEST_ACCEPTED', monitorAction: 'qr.request.accept' })} className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-black text-white">قبول</button>
                              <button type="button" disabled={reqBusyId === r.id} onClick={() => void requestStatusAction(r.id, rejectRequest, { monitorEventType: 'RESTAURANT_QR_REQUEST_REJECTED', monitorAction: 'qr.request.reject' })} className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-black text-white">رفض</button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              <div className="space-y-4 xl:col-span-4">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-black tracking-wide text-slate-500">التعديلات</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-slate-600">الخصم
                      <input value={discountInput} onChange={(e) => { const v = e.target.value; setDiscountInput(v); setDiscountBase(fromDisplay(toMoney(v))); }} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono" />
                    </label>
                    <label className="text-xs font-bold text-slate-600">الضريبة
                      <input value={taxInput} onChange={(e) => { const v = e.target.value; setTaxInput(v); setTaxBase(fromDisplay(toMoney(v))); }} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono" />
                    </label>
                    <label className="text-xs font-bold text-slate-600">رسوم الخدمة
                      <input value={serviceInput} onChange={(e) => { const v = e.target.value; setServiceInput(v); setServiceBase(fromDisplay(toMoney(v))); }} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono" />
                    </label>
                    <label className="text-xs font-bold text-slate-600">المدفوع
                      <input value={paidInput} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm font-mono text-slate-600" />
                    </label>
                  </div>
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-bold text-slate-600">طريقة الدفع
                      <select value={paymentType} onChange={(e) => setPaymentType(e.target.value === 'credit' ? 'credit' : 'cash')} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-bold">
                        <option value="cash">نقدي</option>
                        <option value="credit">آجل</option>
                      </select>
                    </label>
                    {paymentType === 'cash' ? (
                      <label className="block text-xs font-bold text-slate-600">الصندوق
                        <select value={selectedCashBoxId} onChange={(e) => setSelectedCashBoxId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-bold">
                          {cashBoxes.length === 0 ? <option value="">لا توجد صناديق</option> : null}
                          {cashBoxes.map((box) => (
                            <option key={box.id} value={box.id}>{box.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="block text-xs font-bold text-slate-600">العميل الآجل
                        <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-bold">
                          {clients.length === 0 ? <option value="">لا يوجد عملاء</option> : null}
                          {clients.map((client) => (
                            <option key={client.id} value={client.id}>{client.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </section>

                <TableOrderSummary
                  subtotal={toDisplay(subtotalBase)}
                  discount={toDisplay(discountBase)}
                  tax={toDisplay(taxBase)}
                  serviceCharge={toDisplay(serviceBase)}
                  grandTotal={toDisplay(grandBase)}
                  paidAmount={toDisplay(paidBase)}
                  currencyCode={invoiceCurrency}
                />

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <label className="text-xs font-bold text-slate-600">عدد الضيوف
                    <input type="number" min={0} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="mt-2 block text-xs font-bold text-slate-600">ملاحظات
                    <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                  </label>
                  {canManageSessions && !closed ? (
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <button type="button" disabled={saving || checkingOut} onClick={() => void updateSession(session.id, { sessionStatus: 'pending_review' as SessionStatus }).then(() => reload())} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-60">تعيين: قيد المراجعة</button>
                      <button type="button" disabled={saving || checkingOut} onClick={() => void updateSession(session.id, { sessionStatus: 'ready_to_close' as SessionStatus }).then(() => reload())} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-900 disabled:opacity-60">تعيين: جاهز للإغلاق</button>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <AddTableOrderItemsDialog
        open={addDialogOpen}
        options={menuOptions.map((x) => ({ ...x, unitPrice: toDisplay(x.unitPrice) }))}
        busy={sendingDraft}
        onClose={() => setAddDialogOpen(false)}
        onSubmit={(rows: AddDialogDraftLine[]) => {
          const normalized: CashierDraftLine[] = rows.map((row) => ({
            key: `draft-${row.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            itemId: row.itemId,
            name: row.name,
            quantity: Math.max(1, Number(row.quantity || 1)),
            unitPrice: Math.max(0, fromDisplay(Number(row.unitPrice || 0))),
            note: String(row.note || ''),
            category: row.category,
          }));
          setDraftLines((prev) => {
            const next = [...prev];
            for (const line of normalized) {
              const ix = next.findIndex((x) => x.itemId === line.itemId && x.note === line.note);
              if (ix >= 0) next[ix] = { ...next[ix], quantity: next[ix].quantity + line.quantity };
              else next.push(line);
            }
            return next;
          });
          void emitMonitor({
            eventType: 'RESTAURANT_CASHIER_ITEMS_ADDED',
            action: 'cashier.items.add',
            status: 'success',
            metadata: { addedLines: normalized.length, itemIds: normalized.map((x) => x.itemId) },
          });
          setAddDialogOpen(false);
        }}
      />

      <ExchangeRateDialog
        open={rateDialogOpen}
        currencyCode={invoiceCurrency}
        value={exchangeRate}
        readOnly={invoiceCurrency === BASE_CURRENCY}
        onClose={() => setRateDialogOpen(false)}
        onConfirm={(nextRate) => {
          if (nextRate <= 0) return;
          setRateByCurrency((prev) => ({ ...prev, [invoiceCurrency]: nextRate }));
          setRateDialogOpen(false);
        }}
      />
    </div>
  );
};

export default TableOrderWorkspace;
