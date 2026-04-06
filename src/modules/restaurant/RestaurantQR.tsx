import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, ExternalLink, Printer, QrCode, RefreshCw } from 'lucide-react';
import type { AppUser } from '../../types';
import { PERMISSIONS } from '../../types';
import { buildRestaurantPublicHash } from '../../lib/restaurantHash';
import type { RestaurantTable } from './restaurant.types';
import { getTables, regenerateTablePublicToken } from './restaurant.api';

const LS_HOST = 'restaurant_qr_link_host';
const LS_PORT = 'restaurant_qr_link_port';
const LS_PROTO = 'restaurant_qr_link_proto';
const QR_SETTINGS_CHANGED_EVENT = 'restaurant-qr-settings-changed';

const can = (user: AppUser | undefined, perm: string) =>
  !user ? false : user.role === 'admin' || user.permissions?.includes(perm);

function defaultHostPort() {
  const envPort = String(import.meta?.env?.VITE_QR_MENU_PORT || '').trim();
  if (typeof window === 'undefined') return { host: '127.0.0.1', port: envPort && envPort !== '0' ? envPort : '3111', proto: 'http' as const };
  const proto = window.location.protocol === 'https:' ? 'https' : 'http';
  const runtimePort = window.location.port || (proto === 'https' ? '443' : '80');
  const fallbackPort = envPort && envPort !== '0' ? envPort : runtimePort || '3111';
  return {
    host: window.location.hostname || '127.0.0.1',
    port: fallbackPort,
    proto,
  };
}

const RestaurantQR: React.FC<{ currentUser?: AppUser }> = ({ currentUser }) => {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyTableId, setBusyTableId] = useState<string | null>(null);

  const def = defaultHostPort();
  const [linkHost, setLinkHost] = useState(() => localStorage.getItem(LS_HOST) || def.host);
  const [linkPort, setLinkPort] = useState(() => localStorage.getItem(LS_PORT) || def.port);
  const [linkProto, setLinkProto] = useState<'http' | 'https'>(() => {
    const s = localStorage.getItem(LS_PROTO);
    return s === 'https' ? 'https' : def.proto === 'https' ? 'https' : 'http';
  });

  const canView = can(currentUser, PERMISSIONS.VIEW_RESTAURANT_MODULE);
  const canManageTables = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_TABLES);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setErr(null);
    try {
      const tRes = await getTables();
      setTables(tRes.tables || []);
    } catch (e: any) {
      setErr(e?.message || 'تعذر التحميل');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem(LS_HOST, linkHost);
    localStorage.setItem(LS_PORT, linkPort);
    localStorage.setItem(LS_PROTO, linkProto);
  }, [linkHost, linkPort, linkProto]);

  useEffect(() => {
    const handler = () => {
      const savedHost = localStorage.getItem(LS_HOST) || def.host;
      const savedPort = localStorage.getItem(LS_PORT) || def.port;
      const savedProtoRaw = localStorage.getItem(LS_PROTO);
      const savedProto = savedProtoRaw === 'https' ? 'https' : 'http';
      setLinkHost(savedHost);
      setLinkPort(savedPort);
      setLinkProto(savedProto);
    };
    window.addEventListener(QR_SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(QR_SETTINGS_CHANGED_EVENT, handler);
  }, [def.host, def.port]);

  const publicBase = useMemo(() => {
    const portPart =
      (linkProto === 'https' && linkPort === '443') || (linkProto === 'http' && linkPort === '80') ? '' : `:${linkPort}`;
    return `${linkProto}://${linkHost}${portPart}`;
  }, [linkHost, linkPort, linkProto]);

  const buildCustomerUrl = (publicToken: string) => `${publicBase}${buildRestaurantPublicHash(publicToken)}`;

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('انسخ الرابط:', url);
    }
  };

  const printQrSvgHack = (title: string, svgMarkup: string, url: string) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!DOCTYPE html><html dir="rtl"><head><title>${title}</title></head><body style="text-align:center;font-family:sans-serif;padding:24px">` +
        `<h2 style="margin:0 0 12px">${title}</h2>` +
        svgMarkup +
        `<p style="word-break:break-all;font-size:12px;color:#444;margin-top:16px">${url}</p>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const onRegenerate = async (tableId: string) => {
    if (!canManageTables) return;
    if (!window.confirm('إعادة توليد رمز QR؟ الروابط القديمة ستتوقف عن العمل.')) return;
    setBusyTableId(tableId);
    try {
      await regenerateTablePublicToken(tableId);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'تعذر التجديد');
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
    <div className="min-h-full bg-gray-50 p-4 md:p-6" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-black text-gray-900">QR الطاولات</h1>
          <p className="mt-1 text-sm text-gray-500">كل طاولة لها رابط QR مستقل ورمز جاهز للطباعة والمشاركة.</p>
        </header>

        {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{err}</div> : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-black text-gray-800">طاولات ورموز QR</h2>
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700"
            >
              <RefreshCw size={14} /> تحديث
            </button>
          </div>

          {loading ? (
            <p className="text-sm font-bold text-gray-500">جاري التحميل…</p>
          ) : tables.length === 0 ? (
            <p className="text-sm font-bold text-gray-500">لا توجد طاولات بعد.</p>
          ) : (
            <div className="space-y-4">
              {tables.map((t) => {
                const token = String(t.publicQrToken || '').trim();
                const url = token ? buildCustomerUrl(token) : '';
                return (
                  <div key={t.id} className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-gray-50/80 p-4 lg:flex-row lg:items-start">
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="text-base font-black text-gray-900">
                        {t.code} — {t.name}
                      </div>
                      {!token ? (
                        <p className="text-xs font-bold text-amber-800">لا يوجد رمز بعد — افتح الجلسة أو حدّث قائمة الطاولات.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => copyLink(url)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-black text-gray-800"
                            >
                              <Copy size={14} /> نسخ الرابط
                            </button>
                            <button
                              type="button"
                              onClick={() => window.open(url, '_blank')}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-black text-gray-800"
                            >
                              <ExternalLink size={14} /> تجربة
                            </button>
                            {canManageTables ? (
                              <button
                                type="button"
                                onClick={() => onRegenerate(t.id)}
                                disabled={busyTableId === t.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-950 disabled:opacity-50"
                              >
                                <RefreshCw size={14} /> تجديد الرمز
                              </button>
                            ) : null}
                          </div>
                          <div className="break-all font-mono text-[10px] text-gray-500">{url}</div>
                        </>
                      )}
                    </div>

                    {token ? (
                      <div className="flex shrink-0 flex-col items-center gap-2">
                        <div className="rounded-2xl border border-white bg-white p-3 shadow-sm" id={`qr-${t.id}`}>
                          <QRCodeSVG value={url} size={140} level="M" includeMargin />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(`qr-${t.id}`);
                            const svg = el?.querySelector('svg');
                            if (svg) printQrSvgHack(`${t.code} — ${t.name}`, svg.outerHTML, url);
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-black text-gray-800"
                        >
                          <Printer size={14} /> طباعة QR
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-[140px] w-[140px] items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white text-gray-400">
                        <QrCode size={40} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default RestaurantQR;
