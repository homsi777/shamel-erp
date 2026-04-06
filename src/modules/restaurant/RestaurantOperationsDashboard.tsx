import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppUser } from '../../types';
import { PERMISSIONS } from '../../types';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ListPlus,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useRestaurantCashierSocket } from '../../hooks/useRestaurantCashierSocket';
import type { RestaurantTable } from './restaurant.types';
import { navigateToInventoryItem } from './restaurant.helpers';
import {
  getTables,
  createTable,
  updateTable,
  upsertRestaurantMenuItem,
  getRestaurantMenuItems,
  openSessionsForAllEmptyTables,
  emitRestaurantMonitorEvent,
  type RestaurantMenuItemRow,
} from './restaurant.api';
import { apiRequest } from '../../lib/api';
import RestaurantSessionPanel from './RestaurantSessionPanel';
import type { InventoryItem } from '../../types';
import RestaurantShiftCloseDialog, { type RestaurantShiftSummary } from './RestaurantShiftCloseDialog';

type TableBucket = 'all' | 'available' | 'occupied' | 'pending_review' | 'ready_to_close' | 'closed';

type MenuRowModel = RestaurantMenuItemRow & { item: Record<string, unknown> | null };

const LS_HOST = 'restaurant_qr_link_host';
const LS_PORT = 'restaurant_qr_link_port';
const LS_PROTO = 'restaurant_qr_link_proto';
const QR_SETTINGS_CHANGED_EVENT = 'restaurant-qr-settings-changed';
const RESTAURANT_SHIFT_STARTED_AT_KEY = 'restaurant_shift_started_at';
const RESTAURANT_SHIFT_REPORTS_KEY = 'restaurant_shift_reports';

const can = (user: AppUser | undefined, perm: string) => !user ? false : user.role === 'admin' || user.permissions?.includes(perm);

function defaultHostPort(): { host: string; port: string; proto: 'http' | 'https' } {
  const envPort = String(import.meta?.env?.VITE_QR_MENU_PORT || '').trim();
  if (typeof window === 'undefined') return { host: '127.0.0.1', port: envPort && envPort !== '0' ? envPort : '3111', proto: 'http' as const };
  const proto = (window.location.protocol === 'https:' ? 'https' : 'http') as 'http' | 'https';
  const runtimePort = window.location.port || (proto === 'https' ? '443' : '80');
  return {
    host: window.location.hostname || '127.0.0.1',
    port: (envPort && envPort !== '0' ? envPort : runtimePort) || '3111',
    proto,
  };
}

const RestaurantOperationsDashboard: React.FC<{ currentUser?: AppUser; setActiveTab?: (tab: string) => void }> = ({
  currentUser,
  setActiveTab,
}) => {
  const canView = can(currentUser, PERMISSIONS.VIEW_RESTAURANT_MODULE);
  const canManageTables = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_TABLES);
  const canManageSessions = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_SESSIONS);

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [shiftNotice, setShiftNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getTables();
      setTables(r.tables || []);
    } catch (e: any) {
      setErr(e?.message || 'تعذر تحميل بيانات المطعم');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useRestaurantCashierSocket(canView, {
    onConnect: () => loadRef.current(),
    onSessionUpdated: () => loadRef.current(),
    onRequestNew: () => loadRef.current(),
    onRequestSeen: () => loadRef.current(),
    onRequestAccepted: () => loadRef.current(),
    onRequestRejected: () => loadRef.current(),
    onSessionClosed: () => loadRef.current(),
  });

  const selectedTableBuckets = useMemo(() => {
    const map: Record<string, TableBucket> = {};
    for (const t of tables) {
      const s = t.currentSession;
      if (!s) {
        map[t.id] = 'available';
      } else {
        const st = String(s.sessionStatus || '').toLowerCase();
        if (st === 'closed') map[t.id] = 'closed';
        else if (st === 'pending_review') map[t.id] = 'pending_review';
        else if (st === 'ready_to_close') map[t.id] = 'ready_to_close';
        else map[t.id] = 'occupied';
      }
    }
    return map;
  }, [tables]);

  const [bucket, setBucket] = useState<TableBucket>('all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    // Keep selection stable across reloads; clear if table vanished.
    if (selectedTableId && !tables.some((t) => t.id === selectedTableId)) setSelectedTableId(null);
  }, [tables, selectedTableId]);

  const zones = useMemo(() => {
    const z = new Set<string>();
    for (const t of tables) {
      const n = String(t.zoneName || '').trim();
      if (n) z.add(n);
    }
    return Array.from(z).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [tables]);

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables
      .filter((t) => {
        const b = selectedTableBuckets[t.id] || 'available';
        if (bucket !== 'all' && b !== bucket) return false;
        if (zoneFilter !== 'all' && String(t.zoneName || '') !== zoneFilter) return false;
        if (q) {
          const code = String(t.code || '').toLowerCase();
          const name = String(t.name || '').toLowerCase();
          if (!code.includes(q) && !name.includes(q)) return false;
        }
        return true;
      })
      .map((t) => {
        const s = t.currentSession || null;
        const bucket = selectedTableBuckets[t.id] || 'available';
        const unread = Number(s?.unreadRequestCount || 0) || 0;
        return { table: t, session: s, bucket, unread };
      });
  }, [tables, bucket, zoneFilter, search, selectedTableBuckets]);

  const metrics = useMemo(() => {
    let available = 0;
    let occupied = 0;
    let pending = 0;
    let ready = 0;
    let closed = 0;
    let newRequests = 0;
    for (const t of tables) {
      const b = selectedTableBuckets[t.id] || 'available';
      if (b === 'available') available += 1;
      if (b === 'occupied') occupied += 1;
      if (b === 'pending_review') pending += 1;
      if (b === 'ready_to_close') ready += 1;
      if (b === 'closed') closed += 1;
      const s = t.currentSession;
      if (s && Number(s.unreadRequestCount || 0) > 0) newRequests += Number(s.unreadRequestCount || 0) || 0;
    }
    return { total: tables.length, available, occupied, pending, ready, closed, newRequests };
  }, [tables, selectedTableBuckets]);

  const selectedTable = useMemo(() => tables.find((t) => t.id === selectedTableId) || null, [tables, selectedTableId]);
  const selectedSessionId = selectedTable?.currentSession?.id || null;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openingAllSessions, setOpeningAllSessions] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftClosing, setShiftClosing] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<RestaurantShiftSummary | null>(null);
  const [shiftStartedAt, setShiftStartedAt] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(RESTAURANT_SHIFT_STARTED_AT_KEY);
      return raw || new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  });

  // --- Table create dialog (simple, UI-only) ---
  const [tableDialog, setTableDialog] = useState<
    | null
    | { kind: 'create' }
    | { kind: 'edit'; id: string }
    | { kind: 'group' }
  >(null);

  const selectedEditTarget = useMemo(() => {
    if (!tableDialog || tableDialog.kind !== 'edit') return null;
    return tables.find((t) => t.id === tableDialog.id) || null;
  }, [tableDialog, tables]);

  const [tableForm, setTableForm] = useState({
    code: '',
    name: '',
    zoneName: '',
    capacity: '',
    sortOrder: '0',
    notes: '',
    groupName: 'صالة',
    groupCount: '10',
    groupStart: '1',
  });

  useEffect(() => {
    if (!tableDialog) return;
    if (tableDialog.kind === 'create') {
      setTableForm((p) => ({ ...p, code: '', name: '', zoneName: '', capacity: '', notes: '', sortOrder: '0' }));
    }
    if (tableDialog.kind === 'edit' && selectedEditTarget) {
      setTableForm((p) => ({
        ...p,
        code: selectedEditTarget.code || '',
        name: selectedEditTarget.name || '',
        zoneName: selectedEditTarget.zoneName || '',
        capacity: selectedEditTarget.capacity != null ? String(selectedEditTarget.capacity) : '',
        notes: selectedEditTarget.notes || '',
        sortOrder: String(selectedEditTarget.sortOrder ?? 0),
      }));
    }
    if (tableDialog.kind === 'group') {
      setTableForm((p) => ({ ...p, groupName: 'صالة 1', groupCount: '10', groupStart: '1', zoneName: selectedEditTarget?.zoneName || p.zoneName }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableDialog]);

  const createGroupTables = useCallback(async () => {
    if (!canManageTables) return;
    const count = Math.max(0, parseInt(tableForm.groupCount, 10) || 0);
    const start = Math.max(0, parseInt(tableForm.groupStart, 10) || 0);
    if (count <= 0) throw new Error('عدد الطاولات يجب أن يكون أكبر من 0.');
    const zoneName = tableForm.zoneName.trim() || null;
    // Requirement: T1 -> T10
    for (let i = 0; i < count; i++) {
      const n = start + i;
      const code = `T${n}`;
      const name = `${tableForm.groupName.trim() || 'مجموعة'} ${code}`;
      await createTable({
        code,
        name,
        zoneName,
        capacity: tableForm.capacity.trim() === '' ? null : Math.max(0, parseInt(tableForm.capacity, 10) || 0),
        sortOrder: parseInt(tableForm.sortOrder, 10) || 0,
        notes: tableForm.notes.trim() || null,
      });
    }
  }, [canManageTables, tableForm]);

  // --- Menu / settings modal state ---
  const [qrHost, setQrHost] = useState(() => defaultHostPort().host);
  const [qrPort, setQrPort] = useState(() => defaultHostPort().port);
  const [qrProto, setQrProto] = useState<'http' | 'https'>(() => defaultHostPort().proto);

  useEffect(() => {
    const def = defaultHostPort();
    setQrHost(localStorage.getItem(LS_HOST) || def.host);
    setQrPort(localStorage.getItem(LS_PORT) || def.port);
    const s = localStorage.getItem(LS_PROTO);
    setQrProto(s === 'https' ? 'https' : s === 'http' ? 'http' : def.proto);
  }, []);

  const saveQrSettings = useCallback(() => {
    localStorage.setItem(LS_HOST, qrHost);
    localStorage.setItem(LS_PORT, qrPort);
    localStorage.setItem(LS_PROTO, qrProto);
    window.dispatchEvent(new Event(QR_SETTINGS_CHANGED_EVENT));
  }, [qrHost, qrPort, qrProto]);

  const [menuBusy, setMenuBusy] = useState(false);
  const [menuRows, setMenuRows] = useState<(RestaurantMenuItemRow & { item: any | null })[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const reloadMenu = useCallback(async () => {
    if (!canManageTables) return;
    setMenuBusy(true);
    try {
      const inv = (await apiRequest('inventory')) as InventoryItem[];
      setInventory(inv || []);
      const r = await getRestaurantMenuItems();
      setMenuRows(r.menuItems || []);
    } finally {
      setMenuBusy(false);
    }
  }, [canManageTables]);

  useEffect(() => {
    if (settingsOpen) void reloadMenu();
  }, [settingsOpen, reloadMenu]);

  const addableItems = useMemo(() => {
    const ids = new Set(menuRows.map((m) => String(m.itemId)));
    return inventory.filter((it) => it && it.id && !it.inactive && !ids.has(String(it.id)));
  }, [inventory, menuRows]);

  const [menuSearch, setMenuSearch] = useState('');
  const [addItemSearch, setAddItemSearch] = useState('');

  const filteredMenuRows = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return menuRows;
    return menuRows.filter((row) => {
      const inv = row.item as Record<string, unknown> | null | undefined;
      const name = String(inv?.name ?? '').toLowerCase();
      const code = String(inv?.code ?? '').toLowerCase();
      const cat = String(row.categoryName ?? '').toLowerCase();
      const disp = String(row.displayNameOverride ?? '').toLowerCase();
      return name.includes(q) || code.includes(q) || cat.includes(q) || disp.includes(q) || String(row.itemId).toLowerCase().includes(q);
    });
  }, [menuRows, menuSearch]);

  const menuByCategory = useMemo(() => {
    const m = new Map<string, MenuRowModel[]>();
    for (const row of filteredMenuRows as MenuRowModel[]) {
      const c = String(row.categoryName || 'عام').trim() || 'عام';
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(row);
    }
    return Array.from(m.entries())
      .map(([cat, rows]) => [cat, rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))] as const)
      .sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [filteredMenuRows]);

  const filteredAddableItems = useMemo(() => {
    const q = addItemSearch.trim().toLowerCase();
    if (!q) return addableItems;
    return addableItems.filter(
      (it) =>
        String(it.name || '')
          .toLowerCase()
          .includes(q) ||
        String(it.code || '')
          .toLowerCase()
          .includes(q) ||
        String(it.barcode || '')
          .toLowerCase()
          .includes(q),
    );
  }, [addableItems, addItemSearch]);

  const loadShiftSummary = useCallback(async () => {
    setShiftLoading(true);
    try {
      const now = new Date();
      const started = Number.isFinite(Date.parse(shiftStartedAt)) ? new Date(shiftStartedAt) : now;
      const startedMs = started.getTime();
      const invoices = (await apiRequest('invoices').catch(() => [])) as any[];
      const saleInvoices = (Array.isArray(invoices) ? invoices : []).filter((inv: any) => {
        if (String(inv?.type || '') !== 'sale') return false;
        const ts = Date.parse(String(inv?.createdAt || inv?.date || ''));
        return Number.isFinite(ts) && ts >= startedMs;
      });
      const amountOf = (inv: any) => {
        const candidates = [inv?.totalAmountBase, inv?.totalAmountTransaction, inv?.totalAmount, inv?.originalAmount];
        for (const c of candidates) {
          const n = Number(c);
          if (Number.isFinite(n)) return n;
        }
        return 0;
      };
      const pick = (inv: any, keys: string[]) => {
        for (const key of keys) {
          const n = Number(inv?.[key]);
          if (Number.isFinite(n)) return n;
        }
        return 0;
      };

      const totalSales = saleInvoices.reduce((sum, inv) => sum + amountOf(inv), 0);
      const cashPayments = saleInvoices.filter((inv) => String(inv?.paymentType || '') === 'cash').reduce((sum, inv) => sum + amountOf(inv), 0);
      const creditPayments = saleInvoices.filter((inv) => String(inv?.paymentType || '') === 'credit').reduce((sum, inv) => sum + amountOf(inv), 0);
      const discounts = saleInvoices.reduce((sum, inv) => sum + pick(inv, ['discountBase', 'discountTransaction', 'discount']), 0);
      const taxes = saleInvoices.reduce((sum, inv) => sum + pick(inv, ['taxBase', 'taxAmountBase', 'taxAmount', 'tax', 'vatAmount', 'vat']), 0);
      const serviceCharges = saleInvoices.reduce((sum, inv) => sum + pick(inv, ['serviceChargeBase', 'serviceChargeAmount', 'serviceCharge', 'service']), 0);
      const unpaidInvoicesCount = saleInvoices.filter((inv) => {
        const remaining = pick(inv, ['remainingAmountBase', 'remainingAmountTransaction', 'remainingAmount']);
        return remaining > 0.0001;
      }).length;
      const tableSet = new Set<string>();
      for (const inv of saleInvoices) {
        const sourceSession = String(inv?.sourceDocumentId || '').trim();
        if (sourceSession) tableSet.add(sourceSession);
      }
      const totalOrders = saleInvoices.length;
      const totalInvoices = saleInvoices.length;
      const refundsCount = saleInvoices.filter((inv) => String(inv?.type || '') === 'return').length;
      const voidedCount = saleInvoices.filter((inv) => String(inv?.status || '').toLowerCase() === 'void').length;
      const liveTables = tables.filter((t) => t.currentSession && String(t.currentSession.sessionStatus || '') !== 'closed');
      const pendingRequestsCount = liveTables.reduce((sum, t) => sum + (Number(t.currentSession?.unreadRequestCount || 0) || 0), 0);

      const userName = String(currentUser?.name || currentUser?.username || '').trim();
      const durationMs = Math.max(0, now.getTime() - startedMs);
      const durationHours = Math.floor(durationMs / 3600000);
      const durationMinutes = Math.floor((durationMs % 3600000) / 60000);

      setShiftSummary({
        cashierName: userName || 'â€”',
        startedAt: started.toISOString(),
        now: now.toISOString(),
        durationLabel: `${durationHours}س ${durationMinutes}د`,
        totalOrders,
        totalTablesServed: tableSet.size,
        totalInvoices,
        totalSales,
        cashPayments,
        creditPayments,
        discounts,
        taxes,
        serviceCharges,
        netTotal: totalSales - discounts + taxes + serviceCharges,
        refundsCount,
        voidedCount,
        openTablesCount: liveTables.length,
        pendingRequestsCount,
        unpaidInvoicesCount,
        currency: 'USD',
      });
    } finally {
      setShiftLoading(false);
    }
  }, [currentUser?.name, currentUser?.username, shiftStartedAt, tables]);

  const openShiftDialog = useCallback(async () => {
    setShiftDialogOpen(true);
    void emitRestaurantMonitorEvent({
      eventType: 'RESTAURANT_SHIFT_CLOSE_STARTED',
      action: 'shift.close.start',
      status: 'success',
      metadata: { shiftStartedAt },
    });
    await loadShiftSummary();
  }, [loadShiftSummary, shiftStartedAt]);

  const confirmCloseShift = useCallback(async (forceClose: boolean) => {
    if (!shiftSummary) return;
    const hasUnresolved = shiftSummary.openTablesCount > 0 || shiftSummary.pendingRequestsCount > 0 || shiftSummary.unpaidInvoicesCount > 0;
    if (hasUnresolved && !forceClose) {
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_SHIFT_CLOSE_BLOCKED',
        action: 'shift.close.blocked',
        severity: 'warning',
        status: 'failed',
        requiresManualReview: true,
        metadata: {
          openTablesCount: shiftSummary.openTablesCount,
          pendingRequestsCount: shiftSummary.pendingRequestsCount,
          unpaidInvoicesCount: shiftSummary.unpaidInvoicesCount,
        },
      });
      setErr('لا يمكن إغلاق الوردية قبل معالجة الطاولات المفتوحة والطلبات أو اختيار الإغلاق القسري.');
      return;
    }
    setShiftClosing(true);
    try {
      const closedAt = new Date().toISOString();
      try {
        const raw = localStorage.getItem(RESTAURANT_SHIFT_REPORTS_KEY);
        const prev = raw ? (JSON.parse(raw) as any[]) : [];
        const row = {
          id: `rshift-${Date.now()}`,
          startedAt: shiftSummary.startedAt,
          closedAt,
          summary: shiftSummary,
          forced: forceClose,
          cashierName: shiftSummary.cashierName,
        };
        localStorage.setItem(RESTAURANT_SHIFT_REPORTS_KEY, JSON.stringify([row, ...prev].slice(0, 200)));
      } catch {
        // best effort local history
      }
      localStorage.setItem(RESTAURANT_SHIFT_STARTED_AT_KEY, closedAt);
      setShiftStartedAt(closedAt);
      setShiftDialogOpen(false);
      setShiftNotice('تم إغلاق الوردية بنجاح وبدء وردية جديدة.');
      if (forceClose) {
        void emitRestaurantMonitorEvent({
          eventType: 'RESTAURANT_SHIFT_CLOSE_FORCED',
          action: 'shift.close.forced',
          severity: 'warning',
          status: 'success',
          requiresManualReview: true,
          metadata: {
            openTablesCount: shiftSummary.openTablesCount,
            pendingRequestsCount: shiftSummary.pendingRequestsCount,
            unpaidInvoicesCount: shiftSummary.unpaidInvoicesCount,
          },
        });
      }
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_SHIFT_CLOSE_COMPLETED',
        action: 'shift.close.completed',
        status: 'success',
        metadata: {
          duration: shiftSummary.durationLabel,
          totalOrders: shiftSummary.totalOrders,
          totalInvoices: shiftSummary.totalInvoices,
          totalSales: shiftSummary.totalSales,
          forced: forceClose,
        },
      });
      await loadRef.current();
    } catch (e: any) {
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_SHIFT_CLOSE_FAILED',
        action: 'shift.close.failed',
        severity: 'error',
        status: 'failed',
        errorCode: e?.code || 'RESTAURANT_SHIFT_CLOSE_FAILED',
        metadata: { message: e?.message || 'shift close failed' },
      });
      setErr(e?.message || 'تعذر إغلاق الوردية.');
    } finally {
      setShiftClosing(false);
    }
  }, [shiftSummary]);

  if (!canView) {
    return (
      <div className="min-h-full bg-gray-50 p-6 text-center text-sm font-bold text-gray-600" dir="rtl">
        لا تملك صلاحية عرض المطعم.
      </div>
    );
  }

  const bucketChip = (id: TableBucket, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => setBucket(id)}
      className={`rounded-full px-3 py-1.5 text-xs font-black ${
        bucket === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-slate-100/80" dir="rtl">
      <header className="relative z-20 shrink-0 border-b border-slate-200/90 bg-white/95 backdrop-blur-md">
        <div className="flex items-center gap-2 px-2 py-1.5 sm:px-3 sm:py-2">
          <UtensilsCrossed className="shrink-0 text-orange-600" size={18} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xs font-black text-slate-900 sm:text-sm">تشغيل المطعم</h1>
            <p className="truncate text-[10px] font-bold text-slate-500">
              {metrics.available} فاضية · {metrics.occupied} مشغولة · {metrics.pending} مراجعة
              {metrics.newRequests > 0 ? ` · ${metrics.newRequests} طلب جديد` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-black sm:px-2.5 sm:text-xs ${
                filtersOpen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800'
              }`}
              title="فلاتر وبحث"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal size={14} className="shrink-0" />
              <span className="hidden sm:inline">فلاتر</span>
            </button>
            {canManageTables && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setFiltersOpen(false);
                    setTableDialog({ kind: 'create' });
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-900 bg-slate-900 px-2 py-1.5 text-[10px] font-black text-white sm:text-xs"
                  title="إضافة طاولة"
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFiltersOpen(false);
                    setTableDialog({ kind: 'group' });
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] font-black text-amber-950 sm:text-xs"
                  title="مجموعة طاولات"
                >
                  <ShieldAlert size={14} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => loadRef.current()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-black text-slate-700 sm:text-xs"
              title="تحديث"
            >
              <RefreshCw size={14} />
            </button>
            {canManageSessions ? (
              <button
                type="button"
                onClick={() => void openShiftDialog()}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[10px] font-black text-indigo-900 sm:text-xs"
                title="إغلاق الوردية"
              >
                <ChevronUp size={14} />
                <span className="hidden sm:inline">إغلاق الوردية</span>
              </button>
            ) : null}            {canManageSessions && metrics.available > 0 ? (
              <button
                type="button"
                disabled={openingAllSessions}
                onClick={async () => {
                  const n = metrics.available;
                  if (
                    !window.confirm(
                      `فتح جلسة باسمك لكل طاولة نشطة بلا جلسة الآن؟\nالعدد التقريبي: ${n} طاولة. يمكن للضيف أيضاً تفعيل الجلسة تلقائياً عند فتح منيو QR.`,
                    )
                  )
                    return;
                  setOpeningAllSessions(true);
                  setErr(null);
                  try {
                    await openSessionsForAllEmptyTables();
                    await loadRef.current();
                  } catch (e: any) {
                    setErr(e?.message || 'تعذّر فتح الجلسات دفعة واحدة');
                  } finally {
                    setOpeningAllSessions(false);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2 py-1.5 text-[10px] font-black text-violet-950 sm:text-xs disabled:opacity-50"
                title="فتح جلسات لجميع الطاولات الفارغة"
              >
                <ListPlus size={14} className={openingAllSessions ? 'animate-pulse' : ''} />
                <span className="hidden sm:inline">{openingAllSessions ? '…' : 'فتح الكل'}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setFiltersOpen(false);
                setSettingsOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-black text-slate-700 sm:text-xs"
              title="إعدادات المطعم"
            >
              <Settings size={14} />
            </button>
            {setActiveTab && (
              <button
                type="button"
                onClick={() => setActiveTab('inventory')}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-black text-emerald-950 sm:text-xs"
                title="المخزون"
              >
                <Package size={14} />
              </button>
            )}
          </div>
        </div>

        {filtersOpen ? (
          <div className="absolute inset-x-0 top-full z-30 max-h-[min(70vh,28rem)] overflow-y-auto border-b border-slate-200 bg-white px-3 py-3 shadow-lg sm:left-auto sm:right-2 sm:top-[calc(100%+4px)] sm:w-[min(22rem,calc(100vw-1rem)))] sm:rounded-2xl sm:border sm:shadow-xl">
            <div className="mb-2 text-[10px] font-black text-slate-400">تصفية الظهور</div>
            <div className="flex flex-wrap gap-1.5">
              {bucketChip('all', 'الكل')}
              {bucketChip('available', 'متاحة')}
              {bucketChip('occupied', 'مشغولة')}
              {bucketChip('pending_review', 'مراجعة')}
              {bucketChip('closed', 'مغلقة')}
            </div>
            {zones.length > 0 ? (
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-800"
              >
                <option value="all">كل المناطق</option>
                {zones.map((z) => (
                  <option value={z} key={z}>
                    {z}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="relative mt-3">
              <Search size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="بحث برمز أو اسم الطاولة"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-8 pl-2 text-xs font-bold"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] font-black sm:grid-cols-3">
              {[
                ['متاحة', metrics.available, 'bg-emerald-50 text-emerald-900 border-emerald-200'],
                ['مشغولة', metrics.occupied, 'bg-rose-50 text-rose-900 border-rose-200'],
                ['مراجعة', metrics.pending, 'bg-amber-50 text-amber-950 border-amber-200'],
                ['طلبات', metrics.newRequests, 'bg-orange-50 text-orange-950 border-orange-200'],
                ['مغلقة', metrics.closed, 'bg-slate-50 text-slate-700 border-slate-200'],
              ].map(([title, value, tone]) => (
                <div key={String(title)} className={`rounded-lg border ${tone} px-2 py-1.5 text-center`}>
                  <div className="opacity-90">{String(title)}</div>
                  <div className="text-sm font-black tabular-nums">{String(value)}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="mt-3 w-full rounded-xl bg-slate-100 py-2 text-xs font-black text-slate-800"
            >
              إغلاق الفلاتر
            </button>
          </div>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 p-2 sm:p-3">
        {shiftNotice ? (
          <div className="m-2 mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{shiftNotice}</div>
        ) : null}
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center text-sm font-bold text-slate-500">جاري التحميل…</div>
        ) : err ? (
          <div className="m-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{err}</div>
        ) : cards.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm font-bold text-slate-500">
            لا توجد طاولات مطابقة — جرّب تغيير الفلاتر.
          </div>
        ) : (
          <div className="grid min-h-[calc(100dvh-7rem)] auto-rows-auto grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-2 content-start sm:grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] sm:gap-3">
            {cards.map(({ table: t, session: s, bucket, unread }) => {
              const isSelected = selectedTableId === t.id;
              const borderAccent =
                bucket === 'occupied'
                  ? 'border-rose-400/90'
                  : bucket === 'pending_review'
                    ? 'border-amber-400/90'
                    : bucket === 'ready_to_close'
                      ? 'border-orange-400/90'
                      : bucket === 'closed'
                        ? 'border-slate-300'
                        : 'border-emerald-400/90';
              const statusShort =
                bucket === 'occupied'
                  ? 'مشغولة'
                  : bucket === 'pending_review'
                    ? 'مراجعة'
                    : bucket === 'ready_to_close'
                      ? 'إغلاق'
                      : bucket === 'closed'
                        ? 'مغلقة'
                        : 'فاضية';
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setFiltersOpen(false);
                    setSelectedTableId(t.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setFiltersOpen(false);
                      setSelectedTableId(t.id);
                    }
                  }}
                  title={`${t.name}${t.zoneName ? ` · ${t.zoneName}` : ''}${s?.guestCount != null ? ` · ضيوف ${s.guestCount}` : ''}`}
                  className={`relative flex aspect-square cursor-pointer select-none flex-col items-center justify-center rounded-2xl border-2 bg-white p-2 text-center shadow-sm transition hover:shadow-md active:scale-[0.98] ${borderAccent} ${
                    isSelected ? 'ring-2 ring-slate-900 ring-offset-2 ring-offset-slate-100' : ''
                  }`}
                >
                  {unread > 0 && s ? (
                    <span
                      className="absolute left-1.5 top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white"
                      title="طلبات QR جديدة"
                    >
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                  <span className="font-mono text-xl font-black tabular-nums text-slate-900 sm:text-2xl">{t.code}</span>
                  <span className="mt-1 line-clamp-2 w-full px-0.5 text-[10px] font-bold leading-tight text-slate-600 sm:text-[11px]">{t.name}</span>
                  <span className="mt-auto pt-1 text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">{statusShort}</span>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {selectedTable ? (
        <RestaurantSessionPanel
          variant="modal"
          sessionId={selectedSessionId}
          table={selectedTable}
          canManageSessions={canManageSessions}
          canManageTables={canManageTables}
          onClosePanel={() => setSelectedTableId(null)}
          onSessionsChanged={load}
        />
      ) : null}

      <RestaurantShiftCloseDialog
        open={shiftDialogOpen}
        loading={shiftLoading}
        submitting={shiftClosing}
        summary={shiftSummary}
        onClose={() => setShiftDialogOpen(false)}
        onRefresh={() => void loadShiftSummary()}
        onConfirm={(forceClose) => void confirmCloseShift(forceClose)}
      />

        {/* Settings modal: QR link settings + منيو مرتبط بالمخزون */}
        {settingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" role="dialog" aria-modal="true">
            <div className="max-h-[86vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-black text-slate-900">إعدادات المطعم</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">رابط الضيف + منيو QR (الأصناف من المخزون الرسمي)</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {setActiveTab && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setActiveTab('inventory');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-950"
                      >
                        <Package size={14} /> المخزون
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setActiveTab('restaurant_menu_qr');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-800"
                      >
                        <ExternalLink size={14} /> منيو QR (شاشة كاملة)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setActiveTab('restaurant_settings');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-800"
                      >
                        <Settings size={14} /> تجهيز الشبكة والطاولات
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="إغلاق">
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-5">
                <section className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="text-sm font-black text-slate-900">إعدادات رابط الضيف</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <label className="block text-xs font-bold text-gray-600">
                      البروتوكول
                      <select className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={qrProto} onChange={(e) => setQrProto(e.target.value as any)}>
                        <option value="http">http</option>
                        <option value="https">https</option>
                      </select>
                    </label>
                    <label className="block text-xs font-bold text-gray-600">
                      المضيف
                      <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono" value={qrHost} onChange={(e) => setQrHost(e.target.value.trim())} />
                    </label>
                    <label className="block text-xs font-bold text-gray-600">
                      المنفذ
                      <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono" value={qrPort} onChange={(e) => setQrPort(e.target.value.trim())} />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={() => saveQrSettings()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">
                      حفظ إعدادات الرابط
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm font-bold leading-relaxed text-slate-700">
                    إدارة <span className="font-black text-slate-900">QR Menu</span> أصبحت شاشة مستقلة بالكامل لتجنب تداخل المسؤوليات
                    وتحسين الأداء. شاشة الطاولات هنا مخصصة للتشغيل فقط.
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    {setActiveTab ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setActiveTab('restaurant_menu_qr');
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
                      >
                        <ExternalLink size={14} /> فتح QR Menu
                      </button>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Table create/edit/group dialogs (UI-only) */}
        {tableDialog && canManageTables && (
          <TableDialog
            dialog={tableDialog}
            editTarget={selectedEditTarget}
            form={tableForm}
            setForm={setTableForm}
            onClose={() => setTableDialog(null)}
            onCreate={async () => {
              setErr(null);
              await createTable({
                code: tableForm.code.trim(),
                name: tableForm.name.trim(),
                zoneName: tableForm.zoneName.trim() || null,
                capacity: tableForm.capacity.trim() === '' ? null : Math.max(0, parseInt(tableForm.capacity, 10) || 0),
                sortOrder: parseInt(tableForm.sortOrder, 10) || 0,
                notes: tableForm.notes.trim() || null,
              });
              setTableDialog(null);
              await load();
            }}
            onEdit={async () => {
              if (!selectedEditTarget) return;
              await updateTable(selectedEditTarget.id, {
                name: tableForm.name.trim(),
                zoneName: tableForm.zoneName.trim() || null,
                capacity: tableForm.capacity.trim() === '' ? null : Math.max(0, parseInt(tableForm.capacity, 10) || 0),
                sortOrder: parseInt(tableForm.sortOrder, 10) || 0,
                notes: tableForm.notes.trim() || null,
              });
              setTableDialog(null);
              await load();
            }}
            onGroup={async () => {
              await createGroupTables();
              setTableDialog(null);
              await load();
            }}
          />
        )}
    </div>
  );
};

const MenuPlannerRow: React.FC<{
  row: MenuRowModel;
  disabled: boolean;
  onOpenInInventory: () => void;
  onSave: (patch: {
    isVisibleInQr: boolean;
    isAvailableNow: boolean;
    categoryName: string | null;
    sortOrder: number;
    displayNameOverride: string | null;
    description: string | null;
    imageUrl: string | null;
  }) => void | Promise<void>;
}> = ({ row, disabled, onOpenInInventory, onSave }) => {
  const [expanded, setExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(row.isVisibleInQr);
  const [isAvailable, setIsAvailable] = useState(row.isAvailableNow);
  const [cat, setCat] = useState(row.categoryName || 'عام');
  const [sortOrder, setSortOrder] = useState(String(row.sortOrder ?? 0));
  const [disp, setDisp] = useState(row.displayNameOverride || '');
  const [desc, setDesc] = useState(row.description || '');
  const [img, setImg] = useState(row.imageUrl || '');

  useEffect(() => {
    setIsVisible(row.isVisibleInQr);
    setIsAvailable(row.isAvailableNow);
    setCat(row.categoryName || 'عام');
    setSortOrder(String(row.sortOrder ?? 0));
    setDisp(row.displayNameOverride || '');
    setDesc(row.description || '');
    setImg(row.imageUrl || '');
  }, [row]);

  const inv = row.item;
  const baseName = String(inv?.name ?? row.itemId);
  const code = String(inv?.code ?? 'â€”');
  const itemType = String(inv?.itemType ?? 'STOCK');
  const qty = Number(inv?.quantity ?? 0);
  const sale = Number(inv?.salePrice ?? inv?.posPrice ?? 0);
  const stockWarn = itemType !== 'SERVICE' && qty <= 0 && isAvailable;

  const title = disp.trim() ? disp.trim() : baseName;

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/60">
        <td className="p-2 align-top">
          <div className="min-w-[140px] max-w-[240px]">
            <div className="truncate font-black text-slate-900">{title}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] font-bold text-slate-500">{code}</div>
            {!row.item && (
              <div className="mt-1 text-[10px] font-black text-rose-700">غير مرتبط بمخزون الفرع — راجع المخزون</div>
            )}
            {stockWarn && <div className="mt-1 text-[10px] font-black text-amber-800">متاح للطلب رغم كمية الصفر</div>}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-black text-slate-600 hover:text-slate-900"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              وصف وعرض مخصص
            </button>
          </div>
        </td>
        <td className="p-2 align-middle text-center">
          {itemType === 'SERVICE' ? <span className="text-[10px] font-bold text-slate-500">خدمة</span> : <span className="font-mono font-bold">{qty}</span>}
        </td>
        <td className="p-2 align-middle font-mono text-sm">{Number.isFinite(sale) ? sale.toLocaleString('ar-SY') : 'â€”'}</td>
        <td className="p-2 align-middle text-center">
          <input type="checkbox" checked={isVisible} disabled={disabled} onChange={(e) => setIsVisible(e.target.checked)} className="h-4 w-4 rounded border-slate-300" title="ظهور في QR" />
        </td>
        <td className="p-2 align-middle text-center">
          <input type="checkbox" checked={isAvailable} disabled={disabled} onChange={(e) => setIsAvailable(e.target.checked)} className="h-4 w-4 rounded border-slate-300" title="متاح الآن" />
        </td>
        <td className="p-2 align-middle">
          <input
            className="w-14 rounded-lg border border-slate-200 px-1 py-1 text-center font-mono text-xs font-bold"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            disabled={disabled}
          />
        </td>
        <td className="p-2 align-middle">
          <input
            className="w-full min-w-[5rem] max-w-[8rem] rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            disabled={disabled}
          />
        </td>
        <td className="p-2 align-middle">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              void onSave({
                isVisibleInQr: isVisible,
                isAvailableNow: isAvailable,
                categoryName: cat.trim() ? cat.trim() : null,
                sortOrder: parseInt(sortOrder, 10) || 0,
                displayNameOverride: disp.trim() || null,
                description: desc.trim() || null,
                imageUrl: img.trim() || null,
              });
            }}
            className="rounded-lg bg-slate-900 px-2 py-1.5 text-[10px] font-black text-white disabled:opacity-60"
          >
            حفظ
          </button>
        </td>
        <td className="p-2 align-middle">
          <button
            type="button"
            onClick={onOpenInInventory}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-950 hover:bg-emerald-100"
            title="فتح المادة في شاشة المخزون"
          >
            <ExternalLink size={12} />
            المخزون
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/80">
          <td colSpan={9} className="p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-bold text-slate-600">
                اسم العرض للضيف (اختياري)
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold" value={disp} onChange={(e) => setDisp(e.target.value)} disabled={disabled} />
              </label>
              <label className="block text-[11px] font-bold text-slate-600">
                صورة (رابط)
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs" value={img} onChange={(e) => setImg(e.target.value)} disabled={disabled} />
              </label>
              <label className="col-span-full block text-[11px] font-bold text-slate-600">
                وصف للمنيو
                <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={disabled} />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  void onSave({
                    isVisibleInQr: isVisible,
                    isAvailableNow: isAvailable,
                    categoryName: cat.trim() ? cat.trim() : null,
                    sortOrder: parseInt(sortOrder, 10) || 0,
                    displayNameOverride: disp.trim() || null,
                    description: desc.trim() || null,
                    imageUrl: img.trim() || null,
                  });
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white disabled:opacity-60"
              >
                حفظ مع التفاصيل
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const TableDialog: React.FC<{
  dialog: { kind: 'create' | 'edit' | 'group' };
  editTarget: RestaurantTable | null;
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  onClose: () => void;
  onCreate: () => void | Promise<void>;
  onEdit: () => void | Promise<void>;
  onGroup: () => void | Promise<void>;
}> = ({ dialog, editTarget, form, setForm, onClose, onCreate, onEdit, onGroup }) => {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setSaving(true);
    try {
      if (dialog.kind === 'create') await onCreate();
      if (dialog.kind === 'edit') await onEdit();
      if (dialog.kind === 'group') await onGroup();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'تعذر تنفيذ الإجراء');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" role="dialog" aria-modal="true">
      <div className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-4">
          <div className="text-lg font-black text-slate-900">
            {dialog.kind === 'create' && 'إضافة طاولة'}
            {dialog.kind === 'edit' && 'تعديل طاولة'}
            {dialog.kind === 'group' && 'إنشاء مجموعة طاولات'}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="إغلاق">
            <X size={22} />
          </button>
        </div>

        {err && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{err}</div>}

        <div className="mt-4 space-y-4">
          {dialog.kind !== 'group' && (
            <>
              {dialog.kind === 'create' && (
                <label className="block text-xs font-bold text-gray-600">
                  رمز الطاولة
                  <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.code} onChange={(e) => setForm((p: any) => ({ ...p, code: e.target.value }))} />
                </label>
              )}
              <label className="block text-xs font-bold text-gray-600">
                الاسم
                <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.name} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))} />
              </label>
              <label className="block text-xs font-bold text-gray-600">
                المنطقة (اختياري)
                <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.zoneName} onChange={(e) => setForm((p: any) => ({ ...p, zoneName: e.target.value }))} placeholder="صالة / VIP / خارجي" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-bold text-gray-600">
                  السعة
                  <input type="number" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.capacity} onChange={(e) => setForm((p: any) => ({ ...p, capacity: e.target.value }))} />
                </label>
                <label className="block text-xs font-bold text-gray-600">
                  ترتيب العرض
                  <input type="number" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.sortOrder} onChange={(e) => setForm((p: any) => ({ ...p, sortOrder: e.target.value }))} />
                </label>
              </div>
              <label className="block text-xs font-bold text-gray-600">
                ملاحظات (اختياري)
                <textarea className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" rows={3} value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} />
              </label>
            </>
          )}

          {dialog.kind === 'group' && (
            <>
              <label className="block text-xs font-bold text-gray-600">
                اسم المجموعة
                <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.groupName} onChange={(e) => setForm((p: any) => ({ ...p, groupName: e.target.value }))} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-bold text-gray-600">
                  بدء الترقيم
                  <input type="number" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.groupStart} onChange={(e) => setForm((p: any) => ({ ...p, groupStart: e.target.value }))} />
                </label>
                <label className="block text-xs font-bold text-gray-600">
                  عدد الطاولات
                  <input type="number" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.groupCount} onChange={(e) => setForm((p: any) => ({ ...p, groupCount: e.target.value }))} />
                </label>
              </div>
              <label className="block text-xs font-bold text-gray-600">
                المنطقة (اختياري)
                <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" value={form.zoneName} onChange={(e) => setForm((p: any) => ({ ...p, zoneName: e.target.value }))} placeholder="صالة / VIP / خارجي" />
              </label>
              <label className="block text-xs font-bold text-gray-600">
                ملاحظات (اختياري)
                <textarea className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold" rows={3} value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} />
              </label>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-4">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-60">
            إلغاء
          </button>
          <button type="button" disabled={saving} onClick={submit} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
            {saving ? '...' : 'تنفيذ'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestaurantOperationsDashboard;
