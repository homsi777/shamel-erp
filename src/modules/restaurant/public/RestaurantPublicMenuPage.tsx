import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, X } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import type { PublicMenuPayload, PublicPriorRequest } from './restaurantPublic.types';
import { fetchPublicMenu, getRestaurantSocketOrigin, RestaurantPublicApiError, submitPublicRequest } from './restaurantPublic.api';
import RestaurantPublicMenuItemCard from './RestaurantPublicMenuItemCard';
import RestaurantPublicCart, { type CartLine } from './RestaurantPublicCart';

const cstKey = (publicToken: string) => `restaurant_cst_${publicToken}`;

export interface RestaurantPublicMenuPageProps {
  publicToken: string;
}

const RestaurantPublicMenuPage: React.FC<RestaurantPublicMenuPageProps> = ({ publicToken }) => {
  const [data, setData] = useState<PublicMenuPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [customerSessionToken, setCustomerSessionToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(cstKey(publicToken));
  });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [requestNote, setRequestNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [highlightItemIds, setHighlightItemIds] = useState<Set<string>>(() => new Set());
  const [cartOpen, setCartOpen] = useState(false);

  const sessionOpenedAtRef = useRef<string | null>(null);
  const socketEventsSeenRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const tok = customerSessionToken || localStorage.getItem(cstKey(publicToken));
      const p = await fetchPublicMenu(publicToken, tok);
      const opened = p.sessionOpen && p.session ? String(p.session.openedAt || '') : null;
      if (sessionOpenedAtRef.current && opened && sessionOpenedAtRef.current !== opened) {
        setCart([]);
        setRequestNote('');
        setHighlightItemIds(new Set());
      }
      if (opened) sessionOpenedAtRef.current = opened;
      else if (!p.sessionOpen) {
        sessionOpenedAtRef.current = null;
        setCart([]);
        setRequestNote('');
      }
      setData(p);
      if (p.qrGuestAutoSession) {
        setToast('تم تفعيل جلسة الطاولة تلقائياً — يمكنك اختيار الأصناف وإرسال الطلب.');
      }
      setLoading(false);
    } catch (e: any) {
      setErr(e?.message || 'تعذر التحميل');
      setLoading(false);
    }
  }, [publicToken, customerSessionToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const bumpRefresh = useCallback(
    (evtKey: string) => {
      if (socketEventsSeenRef.current.has(evtKey)) return;
      socketEventsSeenRef.current.add(evtKey);
      setTimeout(() => socketEventsSeenRef.current.delete(evtKey), 8000);
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const origin = getRestaurantSocketOrigin();
    let socket: Socket | null = null;
    try {
      socket = io(origin, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { publicToken },
      });
      socket.on('connect', () => {
        void refresh();
      });
      socket.on('restaurant:session-closed', () => {
        setToast('انتهت جلسة الطاولة — العرض للاطلاع فقط');
        bumpRefresh('session-closed');
      });
      socket.on('restaurant:request-accepted', (p: any) => {
        const id = typeof p?.requestId === 'string' ? p.requestId : 'x';
        bumpRefresh(`acc:${id}`);
      });
      socket.on('restaurant:request-rejected', (p: any) => {
        const id = typeof p?.requestId === 'string' ? p.requestId : 'x';
        bumpRefresh(`rej:${id}`);
      });
      socket.on('restaurant:request-seen', (p: any) => {
        const id = typeof p?.requestId === 'string' ? p.requestId : 'x';
        bumpRefresh(`seen:${id}`);
      });
      socket.on('restaurant:session-updated', () => {
        bumpRefresh('session-updated');
      });
    } catch {
      /* optional realtime */
    }
    return () => {
      socket?.close();
    };
  }, [publicToken, refresh, bumpRefresh]);

  const sessionOpen = Boolean(data?.sessionOpen);
  const readOnly = !sessionOpen;

  const cartQtyTotal = useMemo(() => cart.reduce((s, l) => s + l.quantity, 0), [cart]);

  useEffect(() => {
    if (!cartOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCartOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [cartOpen]);

  const addToCart = (item: { itemId: string; name: string; basePrice: number }) => {
    if (readOnly) return;
    setHighlightItemIds((prev) => {
      const next = new Set(prev);
      next.delete(item.itemId);
      return next;
    });
    setCart((prev) => {
      const i = prev.findIndex((x) => x.itemId === item.itemId);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, { itemId: item.itemId, name: item.name, unitPrice: item.basePrice, quantity: 1 }];
    });
  };

  const doSubmit = async () => {
    if (readOnly || cart.length === 0 || submitting) return;
    setSubmitting(true);
    setErr(null);
    setHighlightItemIds(new Set());
    const clientRequestId =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    try {
      const res = await submitPublicRequest(publicToken, {
        clientRequestId,
        customerSessionToken: customerSessionToken || localStorage.getItem(cstKey(publicToken)),
        note: requestNote.trim() || null,
        items: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, note: l.note || null })),
      });
      localStorage.setItem(cstKey(publicToken), res.customerSessionToken);
      setCustomerSessionToken(res.customerSessionToken);
      setCart([]);
      setRequestNote('');
      if (res.idempotentReplay) {
        setToast('تم تأكيد الطلب (لم يُنشأ طلب مكرر)');
      } else {
        setToast('تم إرسال طلبك');
      }
      setCartOpen(false);
      await refresh();
    } catch (e: any) {
      const code = e instanceof RestaurantPublicApiError ? e.code : (e as any)?.code;
      const details = (e as any)?.details as { itemId?: string } | undefined;
      if (code === 'RESTAURANT_ITEM_NOT_VISIBLE_IN_QR' || code === 'RESTAURANT_ITEM_UNAVAILABLE') {
        const id = details?.itemId ? String(details.itemId) : null;
        if (id) setHighlightItemIds(new Set([id]));
      }
      if (code === 'RESTAURANT_SESSION_CLOSED' || code === 'RESTAURANT_NO_OPEN_SESSION') {
        await refresh();
      }
      setErr(e?.message || 'فشل الإرسال');
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (s: string) => {
    const m: Record<string, string> = {
      new: 'جديد',
      seen: 'مُطلع',
      accepted: 'مقبول',
      rejected: 'مرفوض',
      archived: 'مؤرشف',
    };
    return m[s] || s;
  };

  const sortedPrior = useMemo(() => {
    const list = data?.priorRequests || [];
    const byId = new Map<string, PublicPriorRequest>();
    for (const r of list) {
      byId.set(String(r.id), r);
    }
    return [...byId.values()].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  }, [data?.priorRequests]);

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm font-bold text-stone-500" dir="rtl">
        جاري تحميل المنيو…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 pb-8 pt-2" dir="rtl">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 py-4 backdrop-blur">
        <h1 className="text-xl font-black text-stone-900">{data?.table ? `${data.table.code} — ${data.table.name}` : 'منيو الطاولة'}</h1>
        {readOnly ? (
          <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-950">
            {data?.session
              ? 'انتهت جلسة هذه الطاولة — يمكنك الاطلاع على المنيو وسجل طلباتك فقط. لا يمكن إرسال طلبات جديدة حتى يفتح المحاسب جلسة جديدة.'
              : 'لا توجد جلسة مفتوحة على هذه الطاولة حاليًا. يرجى انتظار تجهيز الطاولة من الصالة.'}
          </div>
        ) : (
          <p className="mt-1 text-xs font-bold text-stone-500">جلسة مفتوحة — يمكنك الطلب أكثر من مرة ضمن نفس الجلسة.</p>
        )}
        {data?.notice && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-950">{data.notice}</p>}
      </header>

      {toast && (
        <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
          {toast}
          <button type="button" className="mr-2 text-xs underline" onClick={() => setToast(null)}>
            إغلاق
          </button>
        </div>
      )}
      {err && <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">{err}</div>}

      <div className="mx-auto max-w-lg space-y-6 px-4 py-4">
        {(data?.menuCategories || []).map((cat) => (
          <section key={cat.name}>
            <h2 className="mb-3 text-sm font-black text-stone-700">{cat.name}</h2>
            <div className="space-y-3">
              {cat.items.map((item) => (
                <RestaurantPublicMenuItemCard
                  key={item.itemId}
                  item={item}
                  canOrder={!readOnly}
                  onNeedSession={() =>
                    setToast(
                      'لا يمكن الطلب حتى يفتح المحاسب جلسة لهذه الطاولة من «تشغيل المطعم». بعد الفتح أعد فتح أو حدّث هذه الصفحة.',
                    )
                  }
                  highlight={highlightItemIds.has(item.itemId)}
                  onAdd={() => addToCart({ itemId: item.itemId, name: item.name, basePrice: item.basePrice })}
                />
              ))}
            </div>
          </section>
        ))}

        {sortedPrior.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-black text-stone-700">طلباتك في هذه الجلسة</h2>
            <div className="space-y-3">
              {sortedPrior.map((r, idx) => {
                const latest = idx === 0;
                return (
                  <div
                    key={r.id}
                    className={`rounded-2xl border p-3 text-sm ${latest ? 'border-emerald-300 bg-emerald-50/80' : 'border-stone-200 bg-white/90 opacity-85'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-stone-400">{String(r.submittedAt).slice(0, 19).replace('T', ' ')}</span>
                      <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-black text-white">{statusLabel(r.status)}</span>
                    </div>
                    {r.note && <p className="mt-2 text-xs font-bold text-stone-600">{r.note}</p>}
                    <ul className="mt-2 list-disc pr-4 text-xs text-stone-700">
                      {r.lines.map((l, i) => (
                        <li key={`${r.id}-${i}`}>
                          {l.name} × {l.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <>
          <button
            type="button"
            onClick={() => {
              if (readOnly) {
                setToast('لا يمكن فتح السلة لأن جلسة الطاولة غير مفتوحة حالياً.');
                return;
              }
              setCartOpen(true);
            }}
            className={`fixed left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white text-white shadow-2xl ring-4 ring-black/15 transition-transform active:scale-95 relative ${
              readOnly ? 'bg-stone-400' : 'bg-amber-600 hover:scale-105'
            }`}
            style={{
              position: 'fixed',
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
              zIndex: 2147483000,
            }}
            aria-label="فتح سلة الطلب"
            aria-describedby={cartQtyTotal > 0 ? 'cart-badge-count' : undefined}
          >
            <ShoppingCart className="h-7 w-7" strokeWidth={2.25} />
            {cartQtyTotal > 0 ? (
              <span
                id="cart-badge-count"
                className="pointer-events-none absolute -top-1 end-1 flex h-5 min-w-5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-stone-900 px-1 text-[10px] font-black leading-none text-white"
              >
                {cartQtyTotal > 99 ? '99+' : cartQtyTotal}
              </span>
            ) : null}
          </button>

          {cartOpen && !readOnly ? (
            <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-labelledby="public-cart-title">
              <button
                type="button"
                className="absolute inset-0 bg-stone-900/50 backdrop-blur-[2px]"
                aria-label="إغلاق السلة"
                onClick={() => setCartOpen(false)}
              />
              <div className="relative max-h-[min(88dvh,36rem)] overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-stone-200/80">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-4 py-3">
                  <h2 id="public-cart-title" className="text-base font-black text-stone-900">
                    سلة الطلب
                  </h2>
                  <button
                    type="button"
                    onClick={() => setCartOpen(false)}
                    className="rounded-full p-2 text-stone-500 hover:bg-stone-100"
                    aria-label="إغلاق"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="max-h-[min(72dvh,30rem)] overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
                  <RestaurantPublicCart
                    hideTitle
                    lines={cart}
                    requestNote={requestNote}
                    onRequestNote={setRequestNote}
                    onChangeQty={(itemId, qty) => setCart((c) => c.map((x) => (x.itemId === itemId ? { ...x, quantity: qty } : x)))}
                    onRemove={(itemId) => setCart((c) => c.filter((x) => x.itemId !== itemId))}
                    onSubmit={doSubmit}
                    submitting={submitting}
                    disabled={readOnly}
                  />
                </div>
              </div>
            </div>
          ) : null}
      </>
    </div>
  );
};

export default RestaurantPublicMenuPage;
