import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppUser, PrintSettings } from '../../types';
import { PERMISSIONS } from '../../types';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
  Server,
  ShieldAlert,
  Table2,
  UtensilsCrossed,
  Wifi,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { RestaurantTable } from './restaurant.types';
import { buildRestaurantPublicHash } from '../../lib/restaurantHash';
import { createTable, emitRestaurantMonitorEvent, getTables, regenerateTablePublicToken } from './restaurant.api';
import {
  arabicPrintDiagnosticMessage,
  probeKitchenPrinterFromSettings,
  runTestKitchenPrintDiagnostics,
} from '../../lib/printEngine';
import { apiRequest } from '../../lib/api';

const LS_HOST = 'restaurant_qr_link_host';
const LS_PORT = 'restaurant_qr_link_port';
const LS_PROTO = 'restaurant_qr_link_proto';
const QR_SETTINGS_CHANGED_EVENT = 'restaurant-qr-settings-changed';
const TOAST_EVENT = 'shamel-alert';

/**
 * يجب أن يطابق المنفذ الافتراضي في `backend/server.ts` (SERVER_PORT / SHAMEL_API_PORT / 3111).
 * الواجهة الضيفة (منيو QR) تُبنى على منفذ آخر عادةً (مثل 3222 في التطوير).
 */
const SHAMEL_LOCAL_API_PORT = 3111;
const LISTEN_BIND_HOST = '0.0.0.0';

const can = (user: AppUser | undefined, perm: string) =>
  !user ? false : user.role === 'admin' || user.permissions?.includes(perm);

function toast(message: string) {
  try {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message } }));
  } catch {
    /* ignore */
  }
}

function defaultGuestProtoPort() {
  const envPort = String(import.meta?.env?.VITE_QR_MENU_PORT || '').trim();
  if (typeof window === 'undefined') return { proto: 'http' as const, port: envPort && envPort !== '0' ? envPort : '3111' };
  const proto = (window.location.protocol === 'https:' ? 'https' : 'http') as 'http' | 'https';
  const runtimePort = window.location.port || (proto === 'https' ? '443' : '80');
  const port = (envPort && envPort !== '0' ? envPort : runtimePort) || '3111';
  return { proto, port };
}

function isValidLanIp(ip: string | null | undefined) {
  if (!ip) return false;
  const v = String(ip).trim();
  return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(v);
}

function isZerotierStyleLan192(ip: string) {
  return /^192\.168\.192\.\d{1,3}$/.test(String(ip).trim());
}

function pickPreferredLanIp(found: Set<string>): string | null {
  const list = [...found].filter(isValidLanIp).map((s) => String(s).trim()).sort();
  if (!list.length) return null;
  const tierWifi = list.filter((ip) => /^192\.168\.1\.\d{1,3}$/.test(ip));
  if (tierWifi.length) return tierWifi[0];
  const tierZero = list.filter((ip) => /^192\.168\.0\.\d{1,3}$/.test(ip));
  if (tierZero.length) return tierZero[0];
  const tierOther = list.filter((ip) => !isZerotierStyleLan192(ip));
  if (tierOther.length) return tierOther[0];
  return list[0];
}

async function detectLanIp(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const hn = String(window.location.hostname || '').trim();
  if (/^192\.168\.1\.\d{1,3}$/.test(hn)) return hn;

  const RTCPeerConnectionCtor = (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;
  if (!RTCPeerConnectionCtor) {
    return isValidLanIp(hn) ? hn : null;
  }

  const timeoutMs = 2200;
  const found = new Set<string>();
  if (isValidLanIp(hn)) found.add(hn);

  return await new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };

    const timer = window.setTimeout(() => {
      finish(pickPreferredLanIp(found));
    }, timeoutMs);

    const pc = new RTCPeerConnectionCtor({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pc.createDataChannel('restaurant');

    pc.onicecandidate = (event: any) => {
      try {
        const cand = event?.candidate?.candidate;
        if (!cand) return;
        const ips = String(cand).match(/(\d{1,3}\.){3}\d{1,3}/g) || [];
        for (const ip of ips) {
          if (isValidLanIp(ip)) found.add(ip);
        }
      } catch {
        /* ignore */
      }
    };

    pc
      .createOffer()
      .then((offer: any) => pc.setLocalDescription(offer))
      .catch(() => {});

    window.setTimeout(() => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      window.clearTimeout(timer);
      finish(pickPreferredLanIp(found));
    }, timeoutMs + 100);
  });
}

/** أصل واجهة الضيف (صفحة المنيو في المتصفح) — لبناء روابط الطباعة والمسح */
function buildGuestOrigin(proto: 'http' | 'https', lanIp: string, guestUiPort: string) {
  const p = String(guestUiPort || '').trim();
  if (!lanIp || !p) return '';
  return `${proto}://${lanIp}:${p}`;
}

function buildGuestTableUrl(origin: string, publicToken: string) {
  const tok = String(publicToken || '').trim();
  if (!origin || !tok) return '';
  return `${origin}${buildRestaurantPublicHash(tok)}`;
}

const defaultRestaurantPrintConfig: NonNullable<PrintSettings['restaurant']> = {
  queueEnabled: false,
  queueResetMode: 'daily',
  queueScope: 'branch',
  queuePrefix: '',
  kitchenEnabled: false,
  kitchenHost: '',
  kitchenPort: 9100,
  kitchenPaperSize: '80mm',
  kitchenCopies: 1,
  kitchenAutoPrint: true,
  customerReceiptCopies: 1,
  customerTemplateId: '',
  kitchenTemplateId: '',
  showCashierOnReceipt: true,
  showQueueOnKitchen: true,
  showQueueOnCustomer: true,
};

const parseSettingValue = (raw: unknown) => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

type QrPreview = {
  table: RestaurantTable;
  token: string;
  url: string;
} | null;

type ProbeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; bindPort: number | null; t: number }
  | { status: 'error'; message: string };

const RestaurantSettings: React.FC<{ currentUser?: AppUser }> = ({ currentUser }) => {
  const canView = can(currentUser, PERMISSIONS.VIEW_RESTAURANT_MODULE);
  const canManageTables = can(currentUser, PERMISSIONS.MANAGE_RESTAURANT_TABLES);

  const { proto: defProto, port: defGuestPort } = defaultGuestProtoPort();

  const [lanIp, setLanIp] = useState<string | null>(null);
  const [ipDetecting, setIpDetecting] = useState(true);
  const [ipErr, setIpErr] = useState<string | null>(null);

  const [proto, setProto] = useState<'http' | 'https'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_PROTO) : null;
    return saved === 'https' ? 'https' : saved === 'http' ? 'http' : defProto;
  });
  /** منفذ واجهة الضيف (SPA) وليس منفذ الـ API */
  const [guestUiPort, setGuestUiPort] = useState<string>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_PORT) : null;
    return saved || defGuestPort;
  });

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });

  const [qrPreview, setQrPreview] = useState<QrPreview>(null);
  const [printConfig, setPrintConfig] = useState<NonNullable<PrintSettings['restaurant']>>(defaultRestaurantPrintConfig);
  const [printSaving, setPrintSaving] = useState(false);
  const [printDiagBusy, setPrintDiagBusy] = useState<null | 'probe' | 'test'>(null);
  const [printDiagResult, setPrintDiagResult] = useState<string | null>(null);

  const [maintTable, setMaintTable] = useState<RestaurantTable | null>(null);
  const [maintAck, setMaintAck] = useState(false);
  const [maintTypedCode, setMaintTypedCode] = useState('');
  const [maintBusy, setMaintBusy] = useState(false);

  const guestOrigin = useMemo(
    () => (lanIp ? buildGuestOrigin(proto, lanIp, guestUiPort) : ''),
    [proto, lanIp, guestUiPort],
  );

  const persistNetwork = useCallback(
    (nextHost: string | null, nextGuestPort: string, nextProto: 'http' | 'https') => {
      try {
        if (!nextHost) return;
        localStorage.setItem(LS_HOST, nextHost);
        localStorage.setItem(LS_PORT, String(nextGuestPort || ''));
        localStorage.setItem(LS_PROTO, String(nextProto));
        window.dispatchEvent(new Event(QR_SETTINGS_CHANGED_EVENT));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      setIpDetecting(true);
      setIpErr(null);
      try {
        const detected = await detectLanIp();
        if (detected && isValidLanIp(detected)) setLanIp(detected);
        else
          setIpErr(
            'لم نعثر على عنوان 192.168 مناسب. افتح النظام من عنوان الواي‑فاي (مثل 192.168.1.x) إن أمكن، أو تحقق من الشبكة.',
          );
      } catch {
        setIpErr('تعذر تحديد عنوان الشبكة.');
      } finally {
        setIpDetecting(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!lanIp) return;
    persistNetwork(lanIp, guestUiPort, proto);
  }, [lanIp, guestUiPort, proto, persistNetwork]);

  useEffect(() => {
    if (!lanIp || !isValidLanIp(lanIp)) {
      setProbe({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setProbe({ status: 'loading' });
    const url = `http://${lanIp}:${SHAMEL_LOCAL_API_PORT}/api/restaurant/network-ready`;
    void fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setProbe({ status: 'error', message: `لا يوجد رد صالح من الخادم (${r.status}).` });
          return;
        }
        const j = (await r.json().catch(() => ({}))) as { bindPort?: number; ok?: boolean };
        setProbe({
          status: 'ok',
          bindPort: typeof j.bindPort === 'number' ? j.bindPort : null,
          t: Date.now(),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setProbe({
            status: 'error',
            message: `تعذر الوصول إلى الخادم على http://${lanIp}:${SHAMEL_LOCAL_API_PORT} من هذا المتصفح.`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lanIp]);

  const loadTables = useCallback(async () => {
    if (!canView) return;
    setLoadingTables(true);
    setErr(null);
    try {
      const res = await getTables();
      setTables(res.tables || []);
    } catch (e: any) {
      setErr(e?.message || 'تعذر تحميل الطاولات');
      setTables([]);
    } finally {
      setLoadingTables(false);
    }
  }, [canView]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  useEffect(() => {
    const applyPrint = (restaurantRaw: unknown) => {
      const next = {
        ...defaultRestaurantPrintConfig,
        ...((restaurantRaw && typeof restaurantRaw === 'object') ? (restaurantRaw as Record<string, unknown>) : {}),
      } as NonNullable<PrintSettings['restaurant']>;
      setPrintConfig(next);
    };
    try {
      const localRaw = localStorage.getItem('shamel_settings');
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        applyPrint(parsed?.print?.restaurant);
      }
    } catch {
      // ignore
    }
    void (async () => {
      try {
        const rows = await apiRequest('settings');
        if (!Array.isArray(rows)) return;
        const map = new Map(rows.map((r: any) => [String(r.key || ''), parseSettingValue(r.value)]));
        const print = map.get('print');
        applyPrint((print as any)?.restaurant);
      } catch {
        // keep local fallback
      }
    })();
  }, []);

  const updatePrintConfigField = <K extends keyof NonNullable<PrintSettings['restaurant']>>(
    key: K,
    value: NonNullable<PrintSettings['restaurant']>[K],
  ) => {
    setPrintConfig((prev) => ({ ...prev, [key]: value }));
  };

  const savePrintConfig = useCallback(async () => {
    setPrintSaving(true);
    setPrintDiagResult(null);
    try {
      const localRaw = localStorage.getItem('shamel_settings');
      const localSettings = localRaw ? JSON.parse(localRaw) : {};
      const nextPrint = { ...(localSettings?.print || {}), restaurant: printConfig };
      await apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'print', value: nextPrint }) });
      const nextLocal = { ...localSettings, print: nextPrint };
      localStorage.setItem('shamel_settings', JSON.stringify(nextLocal));
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVED',
        action: 'settings.kitchen_printer.save',
        status: 'success',
        metadata: { kitchenEnabled: Boolean(printConfig.kitchenEnabled), kitchenHost: String(printConfig.kitchenHost || ''), kitchenPort: Number(printConfig.kitchenPort || 9100) },
      });
      toast('تم حفظ إعدادات طابعة المطبخ.');
    } catch (e: any) {
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVE_FAILED',
        action: 'settings.kitchen_printer.save',
        severity: 'error',
        status: 'failed',
        errorCode: e?.code || 'RESTAURANT_KITCHEN_PRINTER_SETTINGS_SAVE_FAILED',
        metadata: { message: e?.message || 'save failed' },
      });
      setErr(e?.message || 'تعذر حفظ إعدادات الطابعة.');
    } finally {
      setPrintSaving(false);
    }
  }, [printConfig]);

  const runKitchenProbe = useCallback(async () => {
    setPrintDiagBusy('probe');
    setPrintDiagResult(null);
    try {
      const result = await probeKitchenPrinterFromSettings(
        String(printConfig.kitchenHost || '').trim(),
        Number(printConfig.kitchenPort || 9100),
      );
      setPrintDiagResult(arabicPrintDiagnosticMessage(result));
    } finally {
      setPrintDiagBusy(null);
    }
  }, [printConfig.kitchenHost, printConfig.kitchenPort]);

  const runKitchenTestTicket = useCallback(async () => {
    setPrintDiagBusy('test');
    setPrintDiagResult(null);
    try {
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_KITCHEN_PRINTER_TEST_STARTED',
        action: 'settings.kitchen_printer.test.start',
        status: 'success',
        metadata: { kitchenHost: String(printConfig.kitchenHost || ''), kitchenPort: Number(printConfig.kitchenPort || 9100) },
      });
      const localRaw = localStorage.getItem('shamel_settings');
      const localSettings = localRaw ? JSON.parse(localRaw) : {};
      const appSettings = {
        ...localSettings,
        print: { ...(localSettings?.print || {}), restaurant: printConfig },
      };
      const result = await runTestKitchenPrintDiagnostics(appSettings as any);
      void emitRestaurantMonitorEvent({
        eventType: result.success ? 'RESTAURANT_KITCHEN_PRINTER_TEST_SUCCEEDED' : 'RESTAURANT_KITCHEN_PRINTER_TEST_FAILED',
        action: 'settings.kitchen_printer.test.result',
        severity: result.success ? 'info' : 'warning',
        status: result.success ? 'success' : 'failed',
        errorCode: result.success ? null : (result.error || 'KITCHEN_PRINTER_TEST_FAILED'),
        metadata: { kitchenHost: String(printConfig.kitchenHost || ''), kitchenPort: Number(printConfig.kitchenPort || 9100) },
      });
      setPrintDiagResult(result.success ? 'تم إرسال تذكرة اختبار المطبخ بنجاح.' : `فشل اختبار الطباعة: ${result.error || 'خطأ غير معروف'}`);
    } catch (e: any) {
      void emitRestaurantMonitorEvent({
        eventType: 'RESTAURANT_KITCHEN_PRINTER_TEST_FAILED',
        action: 'settings.kitchen_printer.test.result',
        severity: 'error',
        status: 'failed',
        errorCode: e?.code || 'KITCHEN_PRINTER_TEST_FAILED',
        metadata: { message: e?.message || 'test failed' },
      });
      setPrintDiagResult(`فشل اختبار الطباعة: ${e?.message || 'تعذر إرسال التذكرة التجريبية'}`);
    } finally {
      setPrintDiagBusy(null);
    }
  }, [printConfig]);

  const copyText = async (text: string, successMsg?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (successMsg) toast(successMsg);
    } catch {
      window.prompt('انسخ النص:', text);
    }
  };

  const printQr = useCallback((preview: QrPreview) => {
    if (!preview) return;
    const svgHost = document.getElementById('restaurant-settings-qr-preview');
    const svg = svgHost?.querySelector('svg');
    if (!svg) return;
    const svgMarkup = (svg as SVGElement).outerHTML;
    const title = `طاولة ${preview.table.code}`;
    const url = preview.url;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!DOCTYPE html><html dir="rtl"><head><title>${title}</title><meta charset="utf-8"/></head><body style="text-align:center;font-family:system-ui,sans-serif;padding:28px;background:#fafafa">` +
        `<h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">${title}</h1>` +
        `<p style="margin:0 0 20px;font-size:13px;color:#64748b">امسح الرمز للطلب من هذه الطاولة</p>` +
        `<div style="display:flex;justify-content:center;background:#fff;padding:20px;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:360px;margin:0 auto">${svgMarkup}</div>` +
        `<p style="margin-top:22px;font-weight:700;font-size:15px;color:#0f172a">الطاولة: ${preview.table.code}</p>` +
        `<p style="margin-top:8px;font-weight:700;font-size:13px;color:#475569">امسح للطلب</p>` +
        `<p style="word-break:break-all;font-size:11px;color:#64748b;margin-top:18px;line-height:1.6">${url}</p>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }, []);

  const refreshAfterMutation = useCallback(async () => {
    await loadTables();
  }, [loadTables]);

  const [singleCode, setSingleCode] = useState('T1');
  const [singleGroup, setSingleGroup] = useState('صالة 1');
  const [singleBusy, setSingleBusy] = useState(false);

  const createSingle = useCallback(async () => {
    if (!canManageTables) return;
    const code = String(singleCode || '').trim();
    const zoneName = String(singleGroup || '').trim();
    if (!code || !zoneName || !canView) return;

    setSingleBusy(true);
    setErr(null);
    try {
      const created = await createTable({ code, name: code, zoneName, capacity: null, sortOrder: 0, notes: null });
      const regenerated = await regenerateTablePublicToken(created.table.id);
      setTables((prev) => {
        const next = [...prev];
        const idx = next.findIndex((t) => t.id === regenerated.table.id);
        if (idx >= 0) next[idx] = regenerated.table;
        else next.push(regenerated.table);
        return next;
      });
      toast(`تم إنشاء الطاولة ${code} ورمز المسح لها.`);
    } catch (e: any) {
      setErr(e?.message || 'تعذر إنشاء الطاولة');
      await refreshAfterMutation();
    } finally {
      setSingleBusy(false);
    }
  }, [canManageTables, singleCode, singleGroup, canView, refreshAfterMutation]);

  const [groupFrom, setGroupFrom] = useState('1');
  const [groupTo, setGroupTo] = useState('100');
  const [groupPrefix, setGroupPrefix] = useState('T');
  const [groupName, setGroupName] = useState('صالة رئيسية');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupProgress, setGroupProgress] = useState<{ cur: number; total: number } | null>(null);

  const bulkPlan = useMemo(() => {
    const from = parseInt(String(groupFrom || ''), 10);
    const to = parseInt(String(groupTo || ''), 10);
    const prefix = String(groupPrefix || '').trim() || 'T';
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      return { ok: false as const, reason: 'أدخل نطاقاً صالحاً (من ≤ إلى).' };
    }
    const count = to - from + 1;
    const codes: string[] = [];
    for (let i = from; i <= to; i++) codes.push(`${prefix}${i}`);
    return { ok: true as const, codes, count, prefix, from, to };
  }, [groupFrom, groupTo, groupPrefix]);

  const bulkPreviewText = useMemo(() => {
    if (!bulkPlan.ok) return '';
    const { codes } = bulkPlan;
    if (codes.length <= 6) return codes.join('طŒ ');
    return `${codes.slice(0, 3).join('طŒ ')} â€¦ ${codes.slice(-2).join('طŒ ')}`;
  }, [bulkPlan]);

  const createGroup = useCallback(async () => {
    if (!canManageTables || !bulkPlan.ok) return;
    const { codes } = bulkPlan;
    const zoneName = String(groupName || '').trim();
    if (!zoneName) return;

    setGroupBusy(true);
    setGroupProgress({ cur: 0, total: codes.length });
    setErr(null);
    try {
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        setGroupProgress({ cur: i, total: codes.length });
        const created = await createTable({
          code,
          name: code,
          zoneName,
          capacity: null,
          sortOrder: i,
          notes: null,
        });
        const regenerated = await regenerateTablePublicToken(created.table.id);
        setTables((prev) => {
          const next = [...prev];
          const idx = next.findIndex((t) => t.id === regenerated.table.id);
          if (idx >= 0) next[idx] = regenerated.table;
          else next.push(regenerated.table);
          return next;
        });
      }
      setGroupProgress({ cur: codes.length, total: codes.length });
      toast(`تم تجهيز ${codes.length} طاولة برموز مسح ثابتة لكل منها.`);
    } catch (e: any) {
      setErr(e?.message || 'تعذر إنشاء المجموعة');
      await refreshAfterMutation();
    } finally {
      setGroupBusy(false);
      setGroupProgress(null);
    }
  }, [canManageTables, bulkPlan, groupName, refreshAfterMutation]);

  const openMaint = (t: RestaurantTable) => {
    setMaintTable(t);
    setMaintAck(false);
    setMaintTypedCode('');
  };

  const closeMaint = () => {
    setMaintTable(null);
    setMaintAck(false);
    setMaintTypedCode('');
    setMaintBusy(false);
  };

  const confirmMaintRegen = useCallback(async () => {
    if (!maintTable || !canManageTables) return;
    const expected = String(maintTable.code || '').trim();
    if (!maintAck || maintTypedCode.trim() !== expected) return;
    setMaintBusy(true);
    setErr(null);
    try {
      await regenerateTablePublicToken(maintTable.id);
      await refreshAfterMutation();
      toast('تم إعادة إصدار رابط الطاولة. الملصقات والروابط القديمة لم تعد صالحة.');
      closeMaint();
    } catch (e: any) {
      setErr(e?.message || 'تعذر إعادة إصدار الرابط');
    } finally {
      setMaintBusy(false);
    }
  }, [maintTable, maintAck, maintTypedCode, canManageTables, refreshAfterMutation]);

  const filteredTables = tables
    .slice()
    .sort((a, b) => String(a.sortOrder ?? 0).localeCompare(String(b.sortOrder ?? 0)));

  const lanOk = Boolean(lanIp && !ipErr && isValidLanIp(lanIp));
  const apiReachable = probe.status === 'ok';
  const apiPortOk =
    apiReachable && (probe.bindPort === null || probe.bindPort === SHAMEL_LOCAL_API_PORT);
  const guestOriginOk = Boolean(guestOrigin);
  const opsReady = lanOk && apiReachable && apiPortOk && guestOriginOk;

  const overallStatus: 'loading' | 'ready' | 'warn' | 'error' = ipDetecting
    ? 'loading'
    : !lanOk
      ? 'error'
      : probe.status === 'loading'
        ? 'loading'
        : opsReady
          ? 'ready'
          : 'warn';

  if (!canView) {
    return (
      <div className="min-h-full bg-slate-50 p-8 text-center" dir="rtl">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <UtensilsCrossed className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="text-sm font-bold text-slate-600">لا تملك صلاحية عرض إعدادات المطعم.</p>
        </div>
      </div>
    );
  }

  const firstTableUrl =
    guestOrigin && tables.find((t) => t.publicQrToken)
      ? buildGuestTableUrl(guestOrigin, String(tables.find((t) => t.publicQrToken)!.publicQrToken))
      : '';

  const testSampleDisabled = !opsReady || !firstTableUrl;
  const copyGuestOriginDisabled = !guestOrigin;

  return (
    <div className="min-h-full bg-slate-100/80 pb-12 pt-4 md:pt-6" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-8 px-4 md:px-6">
        {/* عنوان الصفحة */}
        <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">مطعم — تجهيز التشغيل</p>
            <h1 className="mt-1 text-2xl font-black text-slate-900 md:text-3xl">لوحة تجهيز المطعم</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold text-slate-600">
              شبكة محلية، خادم API، وعناوين مسح الضيوف. لا تُعدُّ «جاهزاً للهاتف» إلا عند اكتمال الفحوصات أدناه.
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-2 self-start rounded-2xl border px-4 py-2 text-sm font-black ${
              overallStatus === 'ready'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : overallStatus === 'loading'
                  ? 'border-slate-200 bg-white text-slate-700'
                  : overallStatus === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {overallStatus === 'ready' && <CheckCircle2 size={18} />}
            {overallStatus === 'loading' && <Loader2 size={18} className="animate-spin" />}
            {(overallStatus === 'warn' || overallStatus === 'error') && <AlertTriangle size={18} />}
            {overallStatus === 'ready'
              ? 'جاهز للعمل من الهاتف على الشبكة'
              : overallStatus === 'loading'
                ? 'جارٍ التحقق…'
                : overallStatus === 'warn'
                  ? 'يحتاج ضبطاً قبل الاعتماد'
                  : 'غير جاهز'}
          </div>
        </div>

        {ipDetecting && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
            <Loader2 size={16} className="animate-spin text-primary" />
            جارٍ تحديد عنوان الشبكة…
          </div>
        )}
        {ipErr && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="alert">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm font-bold text-amber-950">{ipErr}</p>
          </div>
        )}
        {err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900">
            {err}
          </div>
        )}

        {/* A — بنية التشغيل */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 md:px-6">
            <h2 className="text-lg font-black text-slate-900">بنية تشغيل المطعم</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">حالة حقيقية للشبكة والخادم — وليس عرض عنوان فقط.</p>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 md:gap-0 md:divide-x md:divide-slate-100 lg:grid-cols-3 lg:divide-x">
            <div className="md:pe-5 lg:col-span-1">
              <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                <Wifi size={14} />
                الشبكة المحلية
              </div>
              <p className="mt-2 font-mono text-xl font-black text-slate-900">{lanIp || 'â€”'}</p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                يُفضَّل 192.168.1.x لضيوف الواي‑فاي. عند وجود أكثر من محوّل، يُفضَّل فتح النظام من عنوان الواي‑فاي.
              </p>
            </div>
            <div className="md:px-5 lg:col-span-1">
              <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                <Server size={14} />
                خادم البيانات (API)
              </div>
              <p className="mt-2 font-mono text-sm font-bold text-slate-800">
                الاستماع: {LISTEN_BIND_HOST}:{SHAMEL_LOCAL_API_PORT}
              </p>
              <div className="mt-2 space-y-1 text-xs font-bold">
                {probe.status === 'loading' && (
                  <span className="flex items-center gap-1 text-slate-600">
                    <Loader2 size={12} className="animate-spin" /> جارٍ التحقق من الوصول من {lanIp || '…'}…
                  </span>
                )}
                {probe.status === 'error' && <span className="text-rose-700">{probe.message}</span>}
                {probe.status === 'ok' && (
                  <>
                    <span className={apiPortOk ? 'text-emerald-700' : 'text-amber-800'}>
                      {apiPortOk ? '✓ يستجيب من الشبكة كما يُنتظر' : '⚠ المنفذ المُبلَّغ لا يطابق الإعداد المتوقع'}
                    </span>
                    {probe.bindPort != null && (
                      <span className="block font-mono text-slate-600">
                        المنفذ الفعلي للعملية: {probe.bindPort}
                      </span>
                    )}
                  </>
                )}
                {probe.status === 'idle' && <span className="text-slate-400">بانتظار عنوان صالح للفحص</span>}
              </div>
              <p className="mt-2 font-mono text-[11px] text-slate-500">
                فحص:
                {lanIp
                  ? ` http://${lanIp}:${SHAMEL_LOCAL_API_PORT}/api/restaurant/network-ready`
                  : ' â€”'}
              </p>
            </div>
            <div className="md:ps-5 lg:col-span-1 lg:border-s-0">
              <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                <QrCode size={14} />
                واجهة الضيف (منيو المسح)
              </div>
              <p className="mt-2 text-xs font-bold text-slate-600">
                الضيف يفتح رابطاً على <span className="font-black">منفذ الواجهة</span> (غالباً 3222 أثناء التطوير)، بينما الاتصال
                بالبيانات يمر عبر المنفذ {SHAMEL_LOCAL_API_PORT}.
              </p>
              <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs font-bold text-slate-800 break-all">
                {guestOrigin || 'â€”'}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={testSampleDisabled}
                  onClick={() => firstTableUrl && window.open(firstTableUrl, '_blank')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ExternalLink size={14} />
                  اختبار رابط عيّنة
                </button>
                <button
                  type="button"
                  disabled={copyGuestOriginDisabled}
                  onClick={() => void copyText(guestOrigin, 'تم نسخ عنوان واجهة الضيف.')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  <Copy size={14} />
                  نسخ عنوان واجهة الضيف
                </button>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 px-5 py-4 md:px-6">
            <p className="text-xs font-bold text-slate-500">
              للوصول من الهاتف: يجب أن يعمل الخادم على {LISTEN_BIND_HOST} وأن يصل المتصفح من الشبكة إلى المنفذ {SHAMEL_LOCAL_API_PORT}، وأن يفتح الضيف صفحة المنيو على العنوان أعلاه (مع المنفذ الصحيح للواجهة).
            </p>
          </div>
        </section>

        {/* حقول ضبط العناوين */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h3 className="text-sm font-black text-slate-900">ضبط العناوين للطباعة والمسح</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-black text-slate-600">بروتوكول واجهة الضيف</span>
              <select
                disabled={!canManageTables}
                value={proto}
                onChange={(e) => setProto(e.target.value as 'http' | 'https')}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-black disabled:opacity-50"
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black text-slate-600">منفذ واجهة الضيف (SPA)</span>
              <input
                disabled={!canManageTables}
                value={guestUiPort}
                onChange={(e) => setGuestUiPort(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm font-black disabled:opacity-50"
                placeholder="3222"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void loadTables()}
                disabled={loadingTables}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingTables ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                تحديث سجل الطاولات
              </button>
            </div>
          </div>
        </section>

        {/* توليد الطاولات */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-900">إعدادات طابعة المطبخ (KOT)</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">هذه الإعدادات خاصة بطابعة المطبخ عبر الشبكة (IP) وتستخدم نفس محرك الطباعة الرسمي.</p>
            </div>
            <button
              type="button"
              disabled={printSaving}
              onClick={() => void savePrintConfig()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              <Printer size={14} /> {printSaving ? 'جاري الحفظ...' : 'حفظ إعدادات الطابعة'}
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-black text-slate-600">
              اسم الطابعة (للعرض)
              <input
                value={String((printConfig as any).kitchenPrinterName || '')}
                onChange={(e) => setPrintConfig((prev) => ({ ...prev, kitchenPrinterName: e.target.value } as any))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                placeholder="Kitchen IP Printer"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(printConfig.kitchenEnabled)}
                onChange={(e) => updatePrintConfigField('kitchenEnabled', e.target.checked)}
              />
              تفعيل طباعة المطبخ
            </label>
            <label className="block text-xs font-black text-slate-600">
              عنوان IP للطابعة
              <input
                dir="ltr"
                value={String(printConfig.kitchenHost || '')}
                onChange={(e) => updatePrintConfigField('kitchenHost', e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                placeholder="192.168.1.120"
              />
            </label>
            <label className="block text-xs font-black text-slate-600">
              المنفذ
              <input
                dir="ltr"
                type="number"
                min={1}
                max={65535}
                value={Number(printConfig.kitchenPort || 9100)}
                onChange={(e) => updatePrintConfigField('kitchenPort', Math.max(1, Number(e.target.value) || 9100))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                placeholder="9100"
              />
            </label>
            <label className="block text-xs font-black text-slate-600">
              نوع ورق الطابعة
              <select
                value={printConfig.kitchenPaperSize || '80mm'}
                onChange={(e) => updatePrintConfigField('kitchenPaperSize', (e.target.value === '58mm' ? '58mm' : '80mm'))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"
              >
                <option value="58mm">58mm (حراري)</option>
                <option value="80mm">80mm (حراري)</option>
              </select>
            </label>
            <label className="block text-xs font-black text-slate-600">
              عدد النسخ
              <select
                value={String(printConfig.kitchenCopies || 1)}
                onChange={(e) => updatePrintConfigField('kitchenCopies', (Math.min(3, Math.max(1, Number(e.target.value) || 1)) as 1 | 2 | 3))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black"
              >
                <option value="1">نسخة واحدة</option>
                <option value="2">نسختان</option>
                <option value="3">ثلاث نسخ</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
              <input
                type="checkbox"
                checked={printConfig.kitchenAutoPrint !== false}
                onChange={(e) => updatePrintConfigField('kitchenAutoPrint', e.target.checked)}
              />
              طباعة تلقائية عند إرسال الطلب للمطبخ
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-black text-slate-700">تعيين الاستخدام</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                <div className="font-black text-slate-900">طابعة المطبخ (KOT)</div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">{String(printConfig.kitchenHost || 'غير محدد')}:{Number(printConfig.kitchenPort || 9100)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                <div className="font-black text-slate-900">طابعة الكاشير (الفاتورة)</div>
                <div className="mt-1 text-[11px] text-slate-500">يتم ضبطها من إعدادات الطباعة العامة للمشروع.</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={printDiagBusy !== null || !String(printConfig.kitchenHost || '').trim()}
              onClick={() => void runKitchenProbe()}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-800 disabled:opacity-50"
            >
              {printDiagBusy === 'probe' ? 'جاري الفحص...' : 'فحص اتصال الطابعة'}
            </button>
            <button
              type="button"
              disabled={printDiagBusy !== null || !printConfig.kitchenEnabled}
              onClick={() => void runKitchenTestTicket()}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-900 disabled:opacity-50"
            >
              {printDiagBusy === 'test' ? 'جاري الطباعة...' : 'Test Printer'}
            </button>
          </div>
          {printDiagResult ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              {printDiagResult}
            </div>
          ) : null}
        </section>
        <section className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">تجهيز الطاولات</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-black text-slate-900">طاولة واحدة</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">يُنشأ رمز مسح ثابت للطاولة ويُعرض في السجل.</p>
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-black text-slate-600">
                  رمز الطاولة
                  <input
                    disabled={!canManageTables || singleBusy}
                    value={singleCode}
                    onChange={(e) => setSingleCode(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm font-bold disabled:opacity-50"
                  />
                </label>
                <label className="block text-xs font-black text-slate-600">
                  الصالة / المجموعة
                  <input
                    disabled={!canManageTables || singleBusy}
                    value={singleGroup}
                    onChange={(e) => setSingleGroup(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-50"
                  />
                </label>
                <button
                  type="button"
                  disabled={!canManageTables || singleBusy || !lanIp}
                  onClick={() => void createSingle()}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-black text-white shadow-md disabled:opacity-40"
                >
                  {singleBusy ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> جارٍ الإنشاء…
                    </span>
                  ) : (
                    'إضافة الطاولة'
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-black text-slate-900">توليد مجموعة</h3>
              <p className="mt-1 text-xs font-bold text-slate-600">مثال: من 1 إلى 100 وبادئة T → T1…T100</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs font-black text-slate-600">
                  من
                  <input
                    type="number"
                    disabled={groupBusy || !canManageTables}
                    value={groupFrom}
                    onChange={(e) => setGroupFrom(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm disabled:opacity-50"
                  />
                </label>
                <label className="text-xs font-black text-slate-600">
                  إلى
                  <input
                    type="number"
                    disabled={groupBusy || !canManageTables}
                    value={groupTo}
                    onChange={(e) => setGroupTo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm disabled:opacity-50"
                  />
                </label>
                <label className="text-xs font-black text-slate-600">
                  البادئة
                  <input
                    disabled={groupBusy || !canManageTables}
                    value={groupPrefix}
                    onChange={(e) => setGroupPrefix(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm disabled:opacity-50"
                  />
                </label>
                <label className="text-xs font-black text-slate-600">
                  الصالة
                  <input
                    disabled={groupBusy || !canManageTables}
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
                  />
                </label>
              </div>
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                <span className="font-black text-slate-500">معاينة: </span>
                {bulkPlan.ok ? (
                  <>
                    {bulkPreviewText}
                    <span className="text-slate-500"> — إجمالي {bulkPlan.count}</span>
                  </>
                ) : (
                  <span className="text-amber-800">{bulkPlan.reason}</span>
                )}
              </div>
              {groupProgress && (
                <div className="mt-2 text-xs font-bold text-slate-600">
                  تقدم: {groupProgress.cur}/{groupProgress.total}
                </div>
              )}
              <button
                type="button"
                disabled={!canManageTables || groupBusy || !lanIp || !bulkPlan.ok}
                onClick={() => void createGroup()}
                className="mt-4 w-full rounded-xl border-2 border-slate-800 bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40"
              >
                {groupBusy ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> جارٍ التوليد…
                  </span>
                ) : (
                  'إنشاء المجموعة'
                )}
              </button>
            </div>
          </div>
        </section>

        {/* سجل الطاولات — جدول إداري */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
            <div>
              <h2 className="text-lg font-black text-slate-900">سجل الطاولات وروابط المسح</h2>
              <p className="text-xs font-bold text-slate-500">
                المعاينة والنسخ والطباعة للاستخدام اليومي — <span className="text-amber-800">لا تُغيّر رمز الطاولة من هنا</span>.
              </p>
            </div>
          </div>

          {tables.length === 0 && !loadingTables ? (
            <div className="px-5 py-16 text-center">
              <Table2 className="mx-auto text-slate-200" size={48} />
              <p className="mt-4 text-sm font-black text-slate-800">لا توجد طاولات بعد</p>
              <p className="mt-2 text-xs font-bold text-slate-500">ابدأ بإضافة طاولة أو بتوليد مجموعة من القسم أعلاه.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                  disabled={!canManageTables || singleBusy || !lanIp}
                  onClick={() => void createSingle()}
                >
                  إضافة طاولة
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-800 disabled:opacity-40"
                  disabled={!canManageTables || groupBusy || !lanIp || !bulkPlan.ok}
                  onClick={() => void createGroup()}
                >
                  توليد مجموعة
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">الطاولة</th>
                    <th className="px-4 py-3">الصالة</th>
                    <th className="px-4 py-3">جاهزية المسح</th>
                    <th className="px-4 py-3">المعرّف</th>
                    <th className="px-4 py-3">الرابط</th>
                    <th className="px-4 py-3 text-center">رمز</th>
                    <th className="px-4 py-3 text-center">إجراءات يومية</th>
                    {canManageTables && <th className="px-4 py-3 text-center">صيانة</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTables.map((t) => {
                    const token = String(t.publicQrToken || '').trim();
                    const url = guestOrigin && token ? buildGuestTableUrl(guestOrigin, token) : '';
                    const ready = Boolean(opsReady && url);
                    const shortTok =
                      token.length > 18 ? `${token.slice(0, 10)}â€¦${token.slice(-6)}` : token || 'â€”';
                    const shortUrl =
                      url.length > 48 ? `${url.slice(0, 40)}â€¦` : url || 'â€”';
                    return (
                      <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-black text-slate-900">{t.code}</td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-600">{t.zoneName || 'â€”'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-black ${
                              ready
                                ? 'bg-emerald-100 text-emerald-900'
                                : token
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {!token ? 'بدون رمز' : ready ? 'جاهز للمسح' : 'ينتظر الشبكة أو العنوان'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{shortTok}</td>
                        <td className="max-w-[200px] px-4 py-3 font-mono text-[11px] text-slate-600" title={url || undefined}>
                          {opsReady ? shortUrl : 'â€”'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {url ? (
                            <div className="inline-block rounded-lg border border-slate-100 bg-white p-1 shadow-sm">
                              <QRCodeSVG value={url} size={52} level="M" includeMargin />
                            </div>
                          ) : (
                            <span className="text-slate-300">â€”</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-center gap-1.5">
                            <button
                              type="button"
                              disabled={!url}
                              onClick={() => url && setQrPreview({ table: t, token, url })}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-black text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                            >
                              <Eye size={12} /> معاينة
                            </button>
                            <button
                              type="button"
                              disabled={!url}
                              onClick={() => void copyText(url, 'تم نسخ رابط الطاولة.')}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-black text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                            >
                              <Copy size={12} /> نسخ
                            </button>
                            <button
                              type="button"
                              disabled={!url}
                              onClick={() => {
                                setQrPreview({ table: t, token, url });
                                setTimeout(() => printQr({ table: t, token, url }), 220);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-black text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                            >
                              <Printer size={12} /> طباعة
                            </button>
                          </div>
                        </td>
                        {canManageTables && (
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => openMaint(t)}
                              className="inline-flex items-center gap-1 text-[11px] font-black text-amber-900 underline-offset-2 hover:underline"
                            >
                              <ShieldAlert size={12} />
                              إعادة إصدار الرابط…
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* معاينة QR */}
        {qrPreview && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            dir="rtl"
            onClick={(e) => e.target === e.currentTarget && setQrPreview(null)}
          >
            <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-[11px] font-black text-slate-400">معاينة للطباعة</p>
                  <h3 className="text-lg font-black text-slate-900">طاولة {qrPreview.table.code}</h3>
                </div>
                <button
                  type="button"
                  aria-label="إغلاق"
                  onClick={() => setQrPreview(null)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="px-5 py-6 text-center">
                <div id="restaurant-settings-qr-preview" className="inline-block rounded-2xl border border-slate-100 bg-white p-4 shadow-inner">
                  <QRCodeSVG value={qrPreview.url} size={220} level="M" includeMargin />
                </div>
                <p className="mt-4 break-all font-mono text-[11px] font-bold text-slate-600 leading-relaxed">
                  {qrPreview.url}
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => printQr(qrPreview)}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
                  >
                    طباعة
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyText(qrPreview.url, 'تم نسخ الرابط.')}
                    className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800"
                  >
                    نسخ الرابط
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrPreview(null)}
                    className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* صيانة — إعادة إصدار الرابط */}
        {maintTable && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
            dir="rtl"
            role="dialog"
            aria-modal="true"
          >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-amber-200/80 bg-white shadow-2xl">
              <div className="border-b border-amber-100 bg-amber-50/80 px-5 py-4">
                <div className="flex items-center gap-2 text-amber-950">
                  <ShieldAlert size={22} />
                  <h3 className="text-lg font-black">إجراء إداري حساس</h3>
                </div>
                <p className="mt-2 text-sm font-bold text-amber-950/90">
                  إعادة إصدار رابط الطاولة <span className="font-black">{maintTable.code}</span>
                </p>
              </div>
              <div className="space-y-4 px-5 py-5">
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
                  سيُبطل هذا الرمز الحالي بالكامل. أي ملصق أو صفحة محفوعة للعميل بنفس الرابط سيتوقف عن العمل حتى تطبع
                  رمزاً جديداً لهذه الطاولة.
                </div>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={maintAck}
                    onChange={(e) => setMaintAck(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-sm font-bold text-slate-800">
                    أؤكد أنني أفهم أن الملصق والروابط الحالية لهذه الطاولة ستصبح غير صالحة، وأرغب في إصدار رابط جديد.
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    للمتابعة اكتب رمز الطاولة بالضبط: <span className="font-mono font-black">{maintTable.code}</span>
                  </span>
                  <input
                    value={maintTypedCode}
                    onChange={(e) => setMaintTypedCode(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm font-black"
                    placeholder={maintTable.code}
                    autoComplete="off"
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={closeMaint}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-700"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={
                      maintBusy || !maintAck || maintTypedCode.trim() !== String(maintTable.code || '').trim()
                    }
                    onClick={() => void confirmMaintRegen()}
                    className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
                  >
                    {maintBusy ? 'جارٍ التنفيذ…' : 'إعادة إصدار رابط الطاولة'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RestaurantSettings;
