import React, { useEffect, useMemo, useState } from 'react';
import { BadgePercent, Barcode, Clock3, Image as ImageIcon, Package2 } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  buildPromotionsDisplayPayload,
  promotionsDisplayChannelName,
  promotionsDisplayStorageKey,
  readPromotionsDisplayState,
} from '../lib/promotionsDisplay';
import type { PromotionsDisplayPayload } from '../types/promotionsDisplay';

const emptyPayload = (): PromotionsDisplayPayload => ({
  companyName: 'العالمية للمحاسبة',
  title: 'شاشة العروض',
  entries: [],
  updatedAt: new Date().toISOString(),
});

const PromotionsDisplay: React.FC = () => {
  const [payload, setPayload] = useState<PromotionsDisplayPayload>(() => readPromotionsDisplayState() || emptyPayload());
  const [activeIndex, setActiveIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const applyPayload = (next: unknown) => {
      if (!next || typeof next !== 'object') return;
      setPayload(next as PromotionsDisplayPayload);
      setActiveIndex(0);
    };

    const hydrate = async () => {
      try {
        const initial = await window.electronAPI?.getPromotionsDisplayState?.();
        if (!disposed && initial) applyPayload(initial);
      } catch {}

      try {
        const [promotionRows, itemRows] = await Promise.all([
          apiRequest('promotions').catch(() => []),
          apiRequest('inventory').catch(() => []),
        ]);
        if (!disposed && Array.isArray(promotionRows) && Array.isArray(itemRows)) {
          setPayload(buildPromotionsDisplayPayload(promotionRows, itemRows));
        }
      } catch {}
    };
    hydrate();

    const unsubscribeIpc = window.electronAPI?.onPromotionsDisplayUpdate?.((next) => {
      if (!disposed) applyPayload(next);
    }) || (() => {});

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(promotionsDisplayChannelName);
      channel.onmessage = (event) => {
        if (!disposed) applyPayload(event.data);
      };
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== promotionsDisplayStorageKey || !event.newValue || disposed) return;
      try {
        applyPayload(JSON.parse(event.newValue));
      } catch {}
    };
    window.addEventListener('storage', onStorage);

    return () => {
      disposed = true;
      unsubscribeIpc();
      window.removeEventListener('storage', onStorage);
      if (channel) channel.close();
    };
  }, [payload.entries.length]);

  const entries = payload.entries || [];
  const activeEntry = entries[activeIndex] || null;

  useEffect(() => {
    if (entries.length <= 1) return;
    const seconds = Math.max(5, Number(activeEntry?.displayDurationSeconds || 10));
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % entries.length);
    }, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [activeEntry?.displayDurationSeconds, entries.length, activeIndex]);

  const gallery = useMemo(() => {
    if (!activeEntry) return [];
    const list = [activeEntry.mainImageUrl, ...(activeEntry.extraImageUrls || [])]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    return Array.from(new Set(list));
  }, [activeEntry]);

  if (!activeEntry) {
    return (
      <div dir="rtl" className="min-h-screen bg-[radial-gradient(circle_at_top,#15314d,transparent_40%),linear-gradient(135deg,#08111b,#0f1725_55%,#121a29)] text-white">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col items-center justify-center px-8 text-center">
          <div className="mb-8 flex h-28 w-28 items-center justify-center rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl">
            <Package2 size={48} className="text-cyan-200" />
          </div>
          <h1 className="text-6xl font-black tracking-tight">{payload.title}</h1>
          <p className="mt-4 text-2xl font-bold text-white/70">لا توجد عروض مفعلة للعرض الآن</p>
          <p className="mt-6 text-sm font-bold text-white/40">{payload.companyName}</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#18395b,transparent_38%),linear-gradient(135deg,#08111b,#0d1522_48%,#101827)] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col px-10 py-8">
        <header className="mb-8 flex items-center justify-between rounded-[2rem] border border-white/10 bg-white/5 px-8 py-6 shadow-2xl backdrop-blur-xl">
          <div>
            <div className="text-sm font-black text-cyan-200/80">{payload.companyName}</div>
            <h1 className="mt-2 text-5xl font-black tracking-tight">{payload.title}</h1>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-3 text-left">
            <div className="flex items-center gap-2 text-sm font-bold text-white/70">
              <Clock3 size={16} className="text-cyan-200" />
              {now.toLocaleString('ar-SY')}
            </div>
          </div>
        </header>

        <main className="grid flex-1 grid-cols-[1.4fr_0.9fr] gap-8">
          <section className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.16),transparent_22%)]" />
            <div className="relative flex h-full flex-col">
              <div className="mb-6 flex items-start justify-between gap-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-500/15 px-4 py-2 text-sm font-black text-emerald-100">
                    <BadgePercent size={16} />
                    العرض رقم {activeIndex + 1} من {entries.length}
                  </div>
                  <h2 className="mt-5 max-w-4xl text-6xl font-black leading-[1.15]">{activeEntry.name}</h2>
                  {activeEntry.description && (
                    <p className="mt-4 max-w-3xl text-2xl font-bold leading-10 text-white/75">{activeEntry.description}</p>
                  )}
                </div>
                <div className="min-w-[220px] rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4 text-center">
                  <div className="text-sm font-black text-white/50">مدة الشريحة</div>
                  <div className="mt-2 text-4xl font-black text-cyan-200">{activeEntry.displayDurationSeconds}s</div>
                </div>
              </div>

              <div className="grid flex-1 grid-cols-[1.15fr_0.85fr] gap-6">
                <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20">
                  {activeEntry.mainImageUrl ? (
                    <img src={activeEntry.mainImageUrl} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full min-h-[520px] items-center justify-center text-white/30">
                      <ImageIcon size={96} />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                    <div className="text-sm font-black text-white/50">المواد المشمولة</div>
                    <div className="mt-4 space-y-3">
                      {activeEntry.itemNames.length > 0 ? activeEntry.itemNames.map((itemName) => (
                        <div key={itemName} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xl font-black">
                          {itemName}
                        </div>
                      )) : (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-lg font-bold text-white/45">
                          لم يتم ربط مادة محددة
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-[1.75rem] border border-amber-300/15 bg-amber-500/10 p-5">
                      <div className="text-sm font-black text-amber-100/60">قيمة العرض</div>
                      <div className="mt-3 text-3xl font-black text-amber-100">{activeEntry.priceLabel || 'عرض خاص'}</div>
                    </div>
                    <div className="rounded-[1.75rem] border border-cyan-300/15 bg-cyan-500/10 p-5">
                      <div className="text-sm font-black text-cyan-100/60">نوع الحسم</div>
                      <div className="mt-3 text-3xl font-black text-cyan-100">{activeEntry.discountLabel || 'حسب الإعداد'}</div>
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
                    <div className="text-sm font-black text-white/50">الفترة</div>
                    <div className="mt-3 text-2xl font-black">{activeEntry.startDate} ← {activeEntry.endDate}</div>
                    {activeEntry.offerBarcode && (
                      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <Barcode className="text-cyan-200" size={22} />
                        <div>
                          <div className="text-xs font-black text-white/45">باركود العرض</div>
                          <div className="font-mono text-xl font-black tracking-[0.18em]">{activeEntry.offerBarcode}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-5">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 text-lg font-black">معرض الصور</div>
              <div className="grid grid-cols-2 gap-4">
                {gallery.length > 0 ? gallery.slice(0, 4).map((image, index) => (
                  <div key={`${image}-${index}`} className="aspect-[4/3] overflow-hidden rounded-[1.4rem] border border-white/10 bg-black/20">
                    <img src={image} className="h-full w-full object-cover" />
                  </div>
                )) : (
                  <div className="col-span-2 flex aspect-[4/3] items-center justify-center rounded-[1.4rem] border border-dashed border-white/10 text-white/30">
                    <ImageIcon size={56} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 text-lg font-black">قائمة التشغيل</div>
              <div className="space-y-3">
                {entries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={`rounded-[1.4rem] border px-4 py-4 transition ${
                      index === activeIndex
                        ? 'border-cyan-300/30 bg-cyan-500/15 shadow-lg'
                        : 'border-white/10 bg-black/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-black">{entry.name}</div>
                        <div className="mt-1 text-xs font-bold text-white/45">ترتيب {entry.displayOrder} • {entry.displayDurationSeconds} ثانية</div>
                      </div>
                      <div className="text-sm font-black text-cyan-200">#{index + 1}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
};

export default PromotionsDisplay;
