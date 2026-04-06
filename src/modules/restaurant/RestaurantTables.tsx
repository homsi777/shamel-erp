import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { AppUser } from '../../types';
import { PERMISSIONS } from '../../types';
import { useRestaurantCashierSocket } from '../../hooks/useRestaurantCashierSocket';
import {
  deriveCardUiStatus,
  formatRelativeTimeShort,
  sessionBadgeClass,
  sessionStatusCardTone,
  sessionStatusLabel,
} from './restaurant.helpers';
import type { RestaurantTable, RestaurantTablesFilter } from './restaurant.types';
import { getTables, openSession } from './restaurant.api';
import RestaurantTableForm from './RestaurantTableForm';
import RestaurantSessionPanel from './RestaurantSessionPanel';
import { Plus, RefreshCw, Search } from 'lucide-react';

const can = (user: AppUser | undefined, perm: string) =>
  !user ? false : user.role === 'admin' || user.permissions?.includes(perm);

export interface RestaurantTablesProps {
  currentUser?: AppUser;
}

const RestaurantTables: React.FC<RestaurantTablesProps> = ({ currentUser }) => {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<RestaurantTablesFilter>('all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<RestaurantTable | null>(null);
  const [panelSessionId, setPanelSessionId] = useState<string | null>(null);
  const [busyTableId, setBusyTableId] = useState<string | null>(null);
  const [socketToast, setSocketToast] = useState<string | null>(null);

  const canView = can(currentUser, PERMISSIONS.VIEW_RESTAURANT_MODULE);
  const canManageTables = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_TABLES);
  const canManageSessions = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_SESSIONS);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getTables();
      setTables(r.tables || []);
    } catch (e: any) {
      setErr(e?.message || 'تعذر تحميل الطاولات');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  React.useEffect(() => {
    load();
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;

  const toastDedupeRef = useRef<Map<string, number>>(new Map());
  const shouldToastRequestNew = (requestId: string) => {
    const now = Date.now();
    const key = `rn:${requestId}`;
    const prev = toastDedupeRef.current.get(key);
    if (prev && now - prev < 5000) return false;
    toastDedupeRef.current.set(key, now);
    return true;
  };

  useRestaurantCashierSocket(canView, {
    onConnect: () => loadRef.current(),
    onRequestNew: (p) => {
      loadRef.current();
      const rid = typeof p?.requestId === 'string' ? p.requestId : '';
      if (rid && !shouldToastRequestNew(rid)) return;
      const code = typeof p?.tableCode === 'string' ? p.tableCode : '';
      setSocketToast(code ? `طلب QR جديد — طاولة ${code}` : 'طلب QR جديد');
    },
    onSessionUpdated: () => loadRef.current(),
    onRequestSeen: () => loadRef.current(),
    onRequestAccepted: () => loadRef.current(),
    onRequestRejected: () => loadRef.current(),
    onSessionClosed: () => loadRef.current(),
  });

  const zones = useMemo(() => {
    const z = new Set<string>();
    for (const t of tables) {
      const n = String(t.zoneName || '').trim();
      if (n) z.add(n);
    }
    return Array.from(z).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [tables]);

  const cards = useMemo(() => {
    return tables.map((t) => {
      const session = t.currentSession && String(t.currentSession.sessionStatus) !== 'closed' ? t.currentSession : null;
      return { table: t, session, uiStatus: deriveCardUiStatus(session) };
    });
  }, [tables]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter !== 'all' && c.uiStatus !== filter) return false;
      if (zoneFilter !== 'all' && String(c.table.zoneName || '') !== zoneFilter) return false;
      if (q) {
        const code = String(c.table.code || '').toLowerCase();
        const name = String(c.table.name || '').toLowerCase();
        if (!code.includes(q) && !name.includes(q)) return false;
      }
      return true;
    });
  }, [cards, filter, zoneFilter, search]);

  const metrics = useMemo(() => {
    const total = tables.length;
    let available = 0;
    let occupied = 0;
    let pending = 0;
    let ready = 0;
    let lastActMs = 0;
    for (const c of cards) {
      if (c.uiStatus === 'available') available += 1;
      if (c.uiStatus === 'occupied') occupied += 1;
      if (c.uiStatus === 'pending_review') pending += 1;
      if (c.uiStatus === 'ready_to_close') ready += 1;
      if (c.session?.lastActivityAt) {
        const ms = Date.parse(String(c.session.lastActivityAt));
        if (Number.isFinite(ms)) lastActMs = Math.max(lastActMs, ms);
      }
    }
    const lastActivityLabel = lastActMs ? formatRelativeTimeShort(new Date(lastActMs).toISOString()) : '—';
    return { total, available, occupied, pending, ready, lastActivityLabel };
  }, [tables.length, cards]);

  const openNewSession = async (tableId: string) => {
    if (!canManageSessions) return;
    setBusyTableId(tableId);
    setErr(null);
    try {
      const { session } = await openSession(tableId, {});
      await load();
      setPanelSessionId(session.id);
    } catch (e: any) {
      setErr(e?.message || 'تعذر فتح الجلسة');
    } finally {
      setBusyTableId(null);
    }
  };

  if (!canView) {
    return (
      <div className="min-h-full bg-gray-50 p-6 text-center text-sm font-bold text-gray-600" dir="rtl">
        لا تملك صلاحية عرض المطعم.
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6" dir="rtl">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">شبكة الطاولات</h1>
            <p className="mt-1 text-sm text-slate-500">تشغيل فقط — الجلسة ليست فاتورة نهائية.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm"
            >
              <RefreshCw size={16} /> تحديث
            </button>
            {canManageTables && (
              <button
                type="button"
                onClick={() => {
                  setEditTarget(null);
                  setFormOpen('create');
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm"
              >
                <Plus size={18} /> طاولة جديدة
              </button>
            )}
          </div>
        </header>

        {err && (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{err}</div>
        )}

        {socketToast && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-950">
            <span>{socketToast}</span>
            <button type="button" className="text-xs font-black text-violet-800 underline" onClick={() => setSocketToast(null)}>
              إخفاء
            </button>
          </div>
        )}

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['الطاولات', metrics.total],
            ['متاحة', metrics.available],
            ['مشغولة', metrics.occupied],
            ['بانتظار المراجعة', metrics.pending],
            ['جاهزة للإغلاق', metrics.ready],
            ['آخر نشاط', metrics.lastActivityLabel],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold text-slate-500">{k}</div>
              <div className="mt-1 text-xl font-black text-slate-900">{v}</div>
            </div>
          ))}
        </section>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'الكل'],
                ['available', 'متاحة'],
                ['occupied', 'مشغولة'],
                ['pending_review', 'مراجعة'],
                ['ready_to_close', 'إغلاق'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-full px-3 py-1.5 text-xs font-black ${
                  filter === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {zones.length > 0 && (
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
              >
                <option value="all">كل المناطق</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            )}
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="بحث بالرمز أو الاسم"
                className="w-full min-w-[200px] rounded-xl border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm font-bold lg:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm font-bold text-slate-500">جاري التحميل…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm font-bold text-slate-500">
            لا توجد طاولات مطابقة. أضف طاولات من «طاولة جديدة».
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(({ table: t, session }) => {
              const tone = session ? sessionStatusCardTone(session.sessionStatus) : 'border-l-4 border-l-slate-200 border-gray-200';
              const occ = Boolean(session);
              const unread = Number(session?.unreadRequestCount || 0) || 0;
              const hasNewQr = unread > 0;
              return (
                <div
                  key={t.id}
                  className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${tone} ${
                    hasNewQr ? 'ring-2 ring-amber-400 ring-offset-2' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-lg font-black text-slate-900">
                        <span>
                          {t.code} · {t.name}
                        </span>
                        {hasNewQr && (
                          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white" title="طلبات QR جديدة">
                            {unread} QR
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs font-bold text-slate-500">
                        {t.zoneName || 'بدون منطقة'}
                        {t.capacity != null ? ` · سعة ${t.capacity}` : ''}
                      </div>
                    </div>
                    {canManageTables && (
                      <button
                        type="button"
                        className="shrink-0 text-xs font-bold text-primary hover:underline"
                        onClick={() => {
                          setEditTarget(t);
                          setFormOpen('edit');
                        }}
                      >
                        تعديل
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {session ? (
                      <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[11px] font-black ${sessionBadgeClass(session.sessionStatus)}`}>
                        {sessionStatusLabel(session.sessionStatus)}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-900">
                        متاحة
                      </span>
                    )}
                  </div>

                  {session && (
                    <dl className="mt-3 space-y-1 text-xs text-slate-600">
                      <div className="flex justify-between">
                        <dt className="font-bold text-slate-500">الضيوف</dt>
                        <dd className="font-bold">{session.guestCount ?? '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="font-bold text-slate-500">فتحت</dt>
                        <dd>{formatRelativeTimeShort(session.openedAt)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="font-bold text-slate-500">آخر نشاط</dt>
                        <dd>{formatRelativeTimeShort(session.lastActivityAt)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="font-bold text-slate-500">إجمالي تقديري</dt>
                        <dd className="font-mono font-bold">{Number(session.preliminaryTotal || 0).toFixed(2)}</dd>
                      </div>
                    </dl>
                  )}

                  <div className="mt-4">
                    {!occ && canManageSessions && (
                      <button
                        type="button"
                        disabled={busyTableId === t.id}
                        onClick={() => openNewSession(t.id)}
                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white disabled:opacity-50"
                      >
                        {busyTableId === t.id ? '…' : 'فتح جلسة'}
                      </button>
                    )}
                    {occ && (
                      <button
                        type="button"
                        onClick={() => setPanelSessionId(session!.id)}
                        className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-black text-white"
                      >
                        فتح الطاولة / الجلسة
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFormOpen(null);
          }}
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" dir="rtl">
            <h3 className="mb-4 text-lg font-black text-slate-900">{formOpen === 'create' ? 'طاولة جديدة' : 'تعديل طاولة'}</h3>
            <RestaurantTableForm
              mode={formOpen === 'create' ? 'create' : 'edit'}
              initial={editTarget}
              onCancel={() => setFormOpen(null)}
              onSaved={() => {
                setFormOpen(null);
                load();
              }}
            />
          </div>
        </div>
      )}

      <RestaurantSessionPanel
        sessionId={panelSessionId}
        canManageSessions={canManageSessions}
        onClosePanel={() => setPanelSessionId(null)}
        onSessionsChanged={load}
      />
    </div>
  );
};

export default RestaurantTables;
