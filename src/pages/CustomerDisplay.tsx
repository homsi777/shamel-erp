import React, { useEffect, useMemo, useState } from 'react';
import { Store, Clock3, ReceiptText } from 'lucide-react';
import { formatNumber } from '../types';
import {
  customerDisplayStandbyPayload,
  type CustomerDisplayPayload,
} from '../types/customerDisplay';

const symbolForCurrency = (currency: string): string => {
  if (currency === 'SYP') return 'ل.س';
  if (currency === 'TRY') return '₺';
  return '$';
};

const CustomerDisplay: React.FC = () => {
  const [payload, setPayload] = useState<CustomerDisplayPayload>(customerDisplayStandbyPayload());
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const applyPayload = (next: any) => {
      if (!next || typeof next !== 'object') return;
      setPayload(next as CustomerDisplayPayload);
    };

    const readStoredState = () => {
      try {
        const raw = localStorage.getItem('shamel_customer_display_state');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        applyPayload(parsed);
      } catch {
        // ignore corrupted cache and keep standby
      }
    };
    readStoredState();

    const api = window.electronAPI;
    let unsubscribeIpc = () => {};
    if (api) {
      const hydrate = async () => {
        try {
          const initial = await api.getCustomerDisplayState();
          if (!disposed && initial) setPayload(initial);
        } catch {
          // no-op: standby mode is the safe fallback
        }
      };
      hydrate();

      unsubscribeIpc = api.onCustomerDisplayUpdate((next) => {
        if (!disposed) applyPayload(next);
      });
    }

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('shamel-customer-display');
      channel.onmessage = (event) => {
        if (!disposed) applyPayload(event.data);
      };
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'shamel_customer_display_state') return;
      if (!event.newValue || disposed) return;
      try { applyPayload(JSON.parse(event.newValue)); } catch {}
    };
    window.addEventListener('storage', onStorage);

    return () => {
      disposed = true;
      unsubscribeIpc?.();
      window.removeEventListener('storage', onStorage);
      if (channel) {
        try { channel.close(); } catch {}
      }
    };
  }, []);

  const currentSymbol = useMemo(
    () => payload.currencySymbol || symbolForCurrency(payload.currency),
    [payload.currency, payload.currencySymbol]
  );

  const hasItems = payload.items.length > 0;
  const isSuccess = payload.mode === 'success';
  const showStandby = payload.mode === 'standby' || (!hasItems && !isSuccess);

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 text-white overflow-hidden"
    >
      <div className="mx-auto max-w-7xl px-8 py-8 h-screen flex flex-col">
        <header className="shrink-0 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-teal-500/20 border border-teal-300/30 flex items-center justify-center">
                <Store className="text-teal-200" size={28} />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  {payload.companyName || 'العالمية للمحاسبة'}
                </h1>
                <p className="text-teal-100/80 text-sm font-bold mt-1">
                  {payload.title || 'شاشة الزبون'}
                </p>
              </div>
            </div>
            <div className="text-left">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/15">
                <Clock3 size={16} className="text-cyan-200" />
                <span className="font-numeric font-bold">
                  {now.toLocaleString('ar-SY')}
                </span>
              </div>
            </div>
          </div>
        </header>

        {showStandby ? (
          <main className="flex-1 grid place-items-center">
            <div className="text-center max-w-2xl">
              <div className="mx-auto h-28 w-28 rounded-full bg-white/10 border border-white/15 flex items-center justify-center mb-8 shadow-2xl">
                <ReceiptText size={48} className="text-cyan-200" />
              </div>
              <h2 className="text-5xl font-black mb-4">أهلًا بكم</h2>
              <p className="text-xl text-white/70 font-bold mb-10">
                بانتظار بدء عملية البيع
              </p>
              <div className="inline-flex px-6 py-3 rounded-2xl bg-white/10 border border-white/20 text-white/90 font-bold">
                {payload.thankYouMessage || 'شكرًا لتسوقكم معنا'}
              </div>
            </div>
          </main>
        ) : (
          <main className="flex-1 mt-6 grid grid-cols-12 gap-6 min-h-0">
            <section className="col-span-8 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden min-h-0 flex flex-col">
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-lg font-black">تفاصيل السلة الحالية</h2>
                <span className="text-sm text-white/70 font-bold">
                  {payload.cartCount} عنصر
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 sticky top-0 z-10">
                    <tr className="text-white/70">
                      <th className="text-right px-6 py-3 font-black">المادة</th>
                      <th className="text-center px-3 py-3 font-black">الكمية</th>
                      <th className="text-center px-3 py-3 font-black">السعر</th>
                      <th className="text-center px-6 py-3 font-black">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.items.map((line) => (
                      <tr key={line.id} className="border-t border-white/10 hover:bg-white/5 transition">
                        <td className="px-6 py-3 font-bold truncate max-w-[30rem]">{line.name}</td>
                        <td className="px-3 py-3 text-center font-numeric">{formatNumber(line.qty)}</td>
                        <td className="px-3 py-3 text-center font-numeric">
                          {formatNumber(line.unitPrice)} {currentSymbol}
                        </td>
                        <td className="px-6 py-3 text-center font-black font-numeric text-cyan-200">
                          {formatNumber(line.lineTotal)} {currentSymbol}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="col-span-4 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 flex flex-col">
              <div className="space-y-3 mb-6">
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="text-xs text-white/60 font-bold mb-1">المجموع قبل الحسم</div>
                  <div className="font-numeric text-2xl font-black">
                    {formatNumber(payload.subtotal)} {currentSymbol}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="text-xs text-white/60 font-bold mb-1">الحسم</div>
                  <div className="font-numeric text-2xl font-black text-amber-200">
                    {formatNumber(payload.discount)} {currentSymbol}
                  </div>
                </div>
                <div className="rounded-2xl bg-emerald-500/20 border border-emerald-200/20 p-4">
                  <div className="text-xs text-emerald-50/80 font-bold mb-1">الإجمالي النهائي</div>
                  <div className="font-numeric text-4xl font-black text-emerald-100">
                    {formatNumber(payload.total)} {currentSymbol}
                  </div>
                </div>
                <div className="rounded-2xl bg-cyan-500/15 border border-cyan-200/20 p-4">
                  <div className="text-xs text-cyan-100/80 font-bold mb-1">المدفوع</div>
                  <div className="font-numeric text-2xl font-black text-cyan-100">
                    {formatNumber(payload.paid)} {currentSymbol}
                  </div>
                </div>
                <div className="rounded-2xl bg-rose-500/15 border border-rose-200/20 p-4">
                  <div className="text-xs text-rose-100/80 font-bold mb-1">المتبقي</div>
                  <div className="font-numeric text-2xl font-black text-rose-100">
                    {formatNumber(payload.remaining)} {currentSymbol}
                  </div>
                </div>
              </div>

              <div className="mt-auto rounded-2xl bg-white/10 border border-white/15 p-4">
                {payload.invoiceNumber && (
                  <div className="text-xs text-white/70 font-bold mb-1">
                    رقم الفاتورة: <span className="font-numeric">{payload.invoiceNumber}</span>
                  </div>
                )}
                <div className={`text-lg font-black ${isSuccess ? 'text-emerald-200' : 'text-white'}`}>
                  {payload.successMessage || payload.thankYouMessage || 'شكرًا لتسوقكم معنا'}
                </div>
              </div>
            </aside>
          </main>
        )}
      </div>
    </div>
  );
};

export default CustomerDisplay;
