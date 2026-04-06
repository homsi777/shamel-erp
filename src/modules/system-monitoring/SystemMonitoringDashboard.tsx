import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  RefreshCcw,
  Search,
  ShieldAlert,
  Download,
  Siren,
  Workflow,
  XCircle,
} from 'lucide-react';
import { AdaptiveModal } from '../../components/responsive';
import { deleteAllSystemEvents, deleteVisibleSystemEvents, exportSystemEvents, getSystemEvents, resolveSystemEvent, resolveSystemEventsBulk } from '../../lib/api';
import { SystemEvent, SystemEventSeverity, SystemEventsResponse } from '../../types';
import EventDetailsModal from './components/EventDetailsModal';

const POLL_INTERVAL_MS = 15000;

const severityTone: Record<string, string> = {
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const statusTone: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  compensated: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

const startOfTodayIso = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

const prettyJson = (value: any) => JSON.stringify(value ?? {}, null, 2);
const formatDateForFilename = (value: Date = new Date()) => value.toISOString().slice(0, 10);
const extractEventMessage = (event: SystemEvent) => {
  const meta = event?.metadata || {};
  const primary = String(meta.message || meta.error || meta.note || meta.reason || meta.details || '').trim();
  if (primary) return primary;
  const mismatchReasons = Array.isArray(meta.settlementMismatchReasons) ? meta.settlementMismatchReasons.filter(Boolean) : [];
  const blockingReasons = Array.isArray(meta.blockingReasons) ? meta.blockingReasons.filter(Boolean) : [];
  if (mismatchReasons.length > 0 || blockingReasons.length > 0) {
    return [...mismatchReasons, ...blockingReasons].join('، ');
  }
  return String(event?.errorCode || event?.eventType || '').trim();
};
const sanitizeMarkdownCell = (value: any) => String(value ?? '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const buildMarkdownExport = (events: SystemEvent[], scopeLabel: string, filtersLabel: string) => {
  const generatedAt = new Date().toISOString();
  const lines: string[] = [];
  lines.push('# تصدير أحداث المراقبة');
  lines.push(`- النطاق: ${scopeLabel}`);
  lines.push(`- الفلاتر: ${filtersLabel}`);
  lines.push(`- التاريخ: ${generatedAt}`);
  lines.push(`- العدد: ${events.length}`);
  lines.push('');
  lines.push('| النوع | الشدة | التاريخ | الموديول | الإجراء | الرسالة | المستند | الحالة |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  events.forEach((event) => {
    const docRef = event.affectedDocumentType || event.affectedDocumentId
      ? `${event.affectedDocumentType || ''}:${event.affectedDocumentId || ''}`
      : '-';
    lines.push(
      `| ${sanitizeMarkdownCell(event.eventType)} | ${sanitizeMarkdownCell(event.severity)} | ${sanitizeMarkdownCell(event.createdAt)} | ${sanitizeMarkdownCell(event.sourceModule)} | ${sanitizeMarkdownCell(event.action)} | ${sanitizeMarkdownCell(extractEventMessage(event) || '-')} | ${sanitizeMarkdownCell(docRef)} | ${sanitizeMarkdownCell(event.status)} |`,
    );
  });
  lines.push('');
  lines.push('## تفاصيل إضافية');
  events.forEach((event) => {
    lines.push(`### ${event.eventType} (${event.id})`);
    lines.push(`- الشدة: ${event.severity}`);
    lines.push(`- الحالة: ${event.status}`);
    if (event.errorCode) lines.push(`- كود الخطأ: ${event.errorCode}`);
    if (event.affectedDocumentType || event.affectedDocumentId) {
      lines.push(`- المستند: ${event.affectedDocumentType || ''}:${event.affectedDocumentId || ''}`);
    }
    if (event.resolvedAt) lines.push(`- وقت الحل: ${event.resolvedAt}`);
    if (event.resolvedBy) lines.push(`- تم الحل بواسطة: ${event.resolvedBy}`);
    if (event.resolutionNote) lines.push(`- ملاحظة الحل: ${event.resolutionNote}`);
    const message = extractEventMessage(event);
    if (message) lines.push(`- الرسالة: ${message}`);
    if (event.metadata && Object.keys(event.metadata).length > 0) {
      lines.push('');
      lines.push('```json');
      lines.push(prettyJson(event.metadata));
      lines.push('```');
    }
    if (event.compensationStatus && Object.keys(event.compensationStatus || {}).length > 0) {
      lines.push('');
      lines.push('```json');
      lines.push(prettyJson(event.compensationStatus));
      lines.push('```');
    }
    lines.push('');
  });
  return lines.join('\n');
};

const SystemMonitoringDashboard: React.FC = () => {
  const [filters, setFilters] = useState({
    severity: '',
    eventType: '',
    sourceModule: '',
    actionContains: '',
    requiresManualReview: '' as '' | 'true',
    dateFrom: '',
    dateTo: '',
    resolvedState: 'active',
  });
  const [viewMode, setViewMode] = useState<'intelligent' | 'raw'>('intelligent');
  const [eventsResponse, setEventsResponse] = useState<SystemEventsResponse | null>(null);
  const [overviewResponse, setOverviewResponse] = useState<SystemEventsResponse | null>(null);
  const [manualReviewEvents, setManualReviewEvents] = useState<SystemEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SystemEvent | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isBulkResolving, setIsBulkResolving] = useState(false);
  const [bulkOlderThan, setBulkOlderThan] = useState('30d');
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    type: 'resolve_single' | 'resolve_visible' | 'resolve_old' | 'delete_all' | 'delete_visible' | 'start_fresh' | null;
    note: string;
    confirmText: string;
    targetId: string | null;
  }>({ open: false, type: null, note: '', confirmText: '', targetId: null });

  const resolveFilterValue = (value: string) => {
    if (value === 'active') return false;
    if (value === 'resolved') return true;
    return undefined;
  };

  const loadData = useCallback(async (silent = false) => {
    try {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      const [events, overview, manualReview] = await Promise.all([
        getSystemEvents({
          severity: filters.severity || undefined,
          event_type: filters.eventType || undefined,
          source_module: filters.sourceModule || undefined,
          action_contains: filters.actionContains || undefined,
          date_from: filters.dateFrom || undefined,
          date_to: filters.dateTo || undefined,
          requires_manual_review: filters.requiresManualReview === '' ? undefined : Boolean(filters.requiresManualReview === 'true'),
          resolved: resolveFilterValue(filters.resolvedState),
          limit: 150,
        }),
        getSystemEvents({
          date_from: startOfTodayIso(),
          limit: 50,
        }),
        getSystemEvents({
          requires_manual_review: true,
          resolved: false,
          limit: 50,
        }),
      ]);

      setEventsResponse(events);
      setOverviewResponse(overview);
      setManualReviewEvents(manualReview.items);
      setLastUpdatedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message || 'فشل تحميل مركز المراقبة.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [filters.actionContains, filters.dateFrom, filters.dateTo, filters.eventType, filters.severity, filters.resolvedState, filters.sourceModule, filters.requiresManualReview]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadData(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const eventTypeOptions = useMemo(() => {
    const source = new Set<string>();
    (eventsResponse?.items || []).forEach((event) => source.add(event.eventType));
    return Array.from(source).sort();
  }, [eventsResponse?.items]);

  const sourceModuleOptions = useMemo(() => {
    const source = new Set<string>();
    (eventsResponse?.items || []).forEach((event) => source.add(event.sourceModule));
    return Array.from(source).sort();
  }, [eventsResponse?.items]);

  type IssueGroup = {
    key: string;
    title: string;
    severity: SystemEventSeverity;
    score: number;
    occurrences: number;
    lastSeen: string;
    representative: SystemEvent;
  };

  const severityScore = (severity: SystemEventSeverity) => {
    if (severity === 'critical') return 110;
    if (severity === 'error') return 85;
    if (severity === 'warning') return 55;
    return 10;
  };

  const isCriticalType = (event: SystemEvent) => {
    const blob = `${event.eventType} ${event.errorCode || ''} ${event.sourceModule}`.toLowerCase();
    return blob.includes('security')
      || blob.includes('consistency')
      || blob.includes('accounting')
      || blob.includes('drift')
      || blob.includes('scope')
      || blob.includes('journal');
  };

  const computeEventScore = (event: SystemEvent, groupOccurrences: number) => {
    const createdAt = new Date(event.createdAt).getTime();
    const hoursSince = Math.max(0, (Date.now() - createdAt) / 3_600_000);
    const recencyScore = Math.max(0, 48 - hoursSince) / 48 * 25;
    const frequencyScore = Math.min(40, Math.max(0, groupOccurrences - 1) * 6);
    const typeScore = isCriticalType(event) ? 35 : 0;
    return Math.round(severityScore(event.severity) + recencyScore + frequencyScore + typeScore);
  };

  const eventsForIntelligence = useMemo(() => {
    return (eventsResponse?.items || []).filter((event) => {
      if (event.resolvedAt) return false;
      if (event.requiresManualReview) return true;
      return event.severity === 'warning' || event.severity === 'error' || event.severity === 'critical';
    });
  }, [eventsResponse?.items]);

  const issueGroups = useMemo<IssueGroup[]>(() => {
    const map = new Map<string, { events: SystemEvent[]; representative: SystemEvent }>();
    eventsForIntelligence.forEach((event) => {
      const key = `${event.errorCode || event.eventType}::${event.sourceModule}::${event.action || 'unknown'}`;
      const existing = map.get(key);
      if (existing) {
        existing.events.push(event);
      } else {
        map.set(key, { events: [event], representative: event });
      }
    });

    const groups: IssueGroup[] = [];
    map.forEach(({ events, representative }, key) => {
      const sortedByTime = [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const lastSeen = sortedByTime[0]?.createdAt || representative.createdAt;
      const highestSeverity = events.reduce<SystemEventSeverity>((acc, current) => {
        const weight = severityScore(current.severity);
        return weight > severityScore(acc) ? current.severity : acc;
      }, representative.severity);
      const score = computeEventScore(sortedByTime[0] || representative, events.length);
      const title = representative.errorCode
        ? `${representative.errorCode}`
        : representative.eventType;
      groups.push({
        key,
        title,
        severity: highestSeverity,
        score,
        occurrences: events.length,
        lastSeen,
        representative: sortedByTime[0] || representative,
      });
    });
    return groups.sort((a, b) => b.score - a.score);
  }, [eventsForIntelligence]);

  const healthStatus = useMemo(() => {
    if (eventsForIntelligence.some((event) => event.severity === 'critical' || event.severity === 'error')) {
      return { label: 'حرج', tone: 'bg-red-50 text-red-700 border-red-200' };
    }
    if (eventsForIntelligence.some((event) => event.severity === 'warning' || event.requiresManualReview)) {
      return { label: 'تحذير', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    return { label: 'سليم', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }, [eventsForIntelligence]);

  const describeIssue = (issue: IssueGroup) => {
    const blob = `${issue.representative.eventType} ${issue.representative.errorCode || ''} ${issue.representative.sourceModule}`.toLowerCase();
    const actionBlob = String(issue.representative.action || '').toLowerCase();
    const isRestaurant = String(issue.representative.sourceModule || '').toLowerCase() === 'restaurant';

    if (isRestaurant) {
      if (actionBlob.includes('unread.healed')) {
        return {
          summary: 'تمت معالجة انحراف عداد unread بعد اكتشاف mismatch في تطابق الطلبات/الحالة.',
          action: 'تحقق من جلسة/طاولة الحدث ثم راجع أي طلبات جديدة تبدو مفقودة أو مكررة.',
        };
      }
      if (actionBlob.includes('unread.recomputed')) {
        return {
          summary: 'تمت إعادة حساب عداد unread بناءً على الواقع الحالي للطلبات داخل الجلسة.',
          action: 'إن تكرر كثيرًا بشكل غير طبيعي راقب drift وراجع سجلات الطاولة/الطلب من نفس المصدر.',
        };
      }
      if (actionBlob.includes('session.close_blocked')) {
        return {
          summary: 'تعذر إغلاق جلسة الطاولة بسبب وجود طلبات QR غير محلومة (حالة new).',
          action: 'افتح الجلسة في المطعم وأرشِد الطلبات (seen/accept/reject) أو استخدم الإغلاق الإجباري عند الضرورة.',
        };
      }
      if (actionBlob.includes('session.force_close')) {
        return {
          summary: 'تم الإغلاق الإجباري لجلسة بها unread QR غير مُعالج، ما قد يؤثر على ثقة سير التشغيل.',
          action: 'راجِع الطلبات المرتبطة بالجولة يدويًا ثم تأكد من عدم وجود تكرار/تلوث بين الجلسات.',
        };
      }
      if (actionBlob.includes('invalid_transition')) {
        return {
          summary: 'تم حجب انتقال حالة غير مسموح لطلب QR (انحراف FSM/تسلسل غير متوقع).',
          action: 'راجع حالة الطلب (المعرف/الجلسة) وابدأ بإعادة مزامنة الواجهة ثم تأكد من عدم وجود race قديم.',
        };
      }
      if (actionBlob.includes('duplicate_blocked')) {
        return {
          summary: 'تم حجب/منع submit مكرر لطلب QR (idempotency أو تداخل race).',
          action: 'تحقق من clientRequestId وراجع سجل آخر محاولة في نفس الجلسة لتحديد سبب التكرار.',
        };
      }
      if (actionBlob.includes('qr.item.unavailable_blocked') || actionBlob.includes('item_unavailable')) {
        return {
          summary: 'طلب QR يحتوي عنصرًا غير متاح حاليًا (unavailable).',
          action: 'راجع إعداد توفر العنصر في QR/المنيو (is_available_now) أو صحح بيانات العنصر/التوفر ثم أعد المحاولة.',
        };
      }
      if (actionBlob.includes('qr.item.visibility_blocked') || actionBlob.includes('item_not_visible')) {
        return {
          summary: 'طلب QR يحتوي عنصرًا غير ظاهر ضمن منيو QR (visibility).',
          action: 'تحقق من إعداد is_visible_in_qr للعنصر أو تحديث بيانات المنيو العامة ثم أعد المحاولة.',
        };
      }
      if (actionBlob.includes('qr.request')) {
        return {
          summary: 'حدث متعلق بطلب QR (submit/seen/accept/reject/archive) يحتاج متابعة بحسب السياق.',
          action: 'افتح تفاصيل الحدث ثم راقب ما إذا كانت الحالة الجديدة منطقية ضمن FSM للجلسة.',
        };
      }
      if (actionBlob.includes('socket.resync')) {
        return {
          summary: 'تم تحفيز مسار resync الخاص بالـ socket بسبب تباين/انقطاع.',
          action: 'أعد تحميل حالة المطعم للمحصلين وتحقق من استقرار الاتصال ثم راقب إن استمرت الأنماط.',
        };
      }
    }
    if (blob.includes('consistency')) {
      return {
        summary: 'فشل في فحص الاتساق أو عدم تطابق مخطط قاعدة البيانات.',
        action: 'راجع آخر تغييرات المخطط أو قيود الحقول المرتبطة ثم أعد تشغيل الحارس.',
      };
    }
    if (blob.includes('security') || blob.includes('scope')) {
      return {
        summary: 'محاولة وصول أو سياق غير مطابق لسياسات الأمان.',
        action: 'تحقق من صلاحيات المستخدم وسياق الشركة/الفرع في الطلبات.',
      };
    }
    if (blob.includes('drift') || blob.includes('partner_pilot')) {
      return {
        summary: 'انحراف بين الأرصدة التشغيلية والمحاسبية يحتاج مراجعة.',
        action: 'راجع التسويات المرتبطة والفواتير/السندات الحديثة للشريك.',
      };
    }
    if (blob.includes('journal') || blob.includes('accounting')) {
      return {
        summary: 'مشكلة في القيود أو الربط المحاسبي.',
        action: 'تحقق من القيد المرتبط بالمستند ومن سلامة الحسابات الفرعية.',
      };
    }
    if (blob.includes('print')) {
      return {
        summary: 'إخفاق في الطباعة أو إعدادات الطابعة.',
        action: 'راجع إعداد الطابعة والقوالب ثم أعد المحاولة.',
      };
    }
    if (blob.includes('invoice') || blob.includes('voucher')) {
      return {
        summary: 'مشكلة في مستند مالي أساسي.',
        action: 'راجع حالة المستند والقيود المرتبطة قبل إعادة المحاولة.',
      };
    }
    if (blob.includes('opening')) {
      return {
        summary: 'مشكلة في أرصدة افتتاحية أو ترحيل مبدئي.',
        action: 'راجع خطوط الافتتاح وتأكد من اكتمال الربط المحاسبي.',
      };
    }
    return {
      summary: 'حدث يحتاج متابعة تشغيلية.',
      action: 'راجع تفاصيل الحدث ثم اتخذ الإجراء المناسب.',
    };
  };

  const toggleExpanded = (eventId: string) => {
    setExpandedRows((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const handleResolve = async (eventId: string) => {
    setActionDialog({
      open: true,
      type: 'resolve_single',
      note: '',
      confirmText: '',
      targetId: eventId,
    });
  };

  const buildFilterParams = (forceAll = false) => {
    if (forceAll) return {};
    return {
      severity: filters.severity || undefined,
      event_type: filters.eventType || undefined,
      source_module: filters.sourceModule || undefined,
      action_contains: filters.actionContains || undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      requires_manual_review: filters.requiresManualReview === '' ? undefined : Boolean(filters.requiresManualReview === 'true'),
      resolved: resolveFilterValue(filters.resolvedState),
    };
  };

  const buildOlderThanIso = (value: string) => {
    const now = new Date();
    if (value === '24h') now.setHours(now.getHours() - 24);
    else if (value === '7d') now.setDate(now.getDate() - 7);
    else if (value === '30d') now.setDate(now.getDate() - 30);
    else if (value === '90d') now.setDate(now.getDate() - 90);
    return now.toISOString();
  };

  const handleBulkResolveVisible = async () => {
    if (!eventsResponse?.items?.length) return;
    setActionDialog({
      open: true,
      type: 'resolve_visible',
      note: '',
      confirmText: '',
      targetId: null,
    });
  };

  const handleResolveOldWarnings = async () => {
    setActionDialog({
      open: true,
      type: 'resolve_old',
      note: '',
      confirmText: '',
      targetId: null,
    });
  };

  const handleStartFreshView = async () => {
    setActionDialog({
      open: true,
      type: 'start_fresh',
      note: 'تمت المراجعة والتنظيف قبل جولة اختبار جديدة',
      confirmText: '',
      targetId: null,
    });
  };

  const handleDeleteAll = async () => {
    setActionDialog({
      open: true,
      type: 'delete_all',
      note: '',
      confirmText: '',
      targetId: null,
    });
  };

  const handleDeleteVisible = async () => {
    if (!eventsResponse?.items?.length) return;
    setActionDialog({
      open: true,
      type: 'delete_visible',
      note: '',
      confirmText: '',
      targetId: null,
    });
  };

  const closeActionDialog = () => {
    setActionDialog({ open: false, type: null, note: '', confirmText: '', targetId: null });
  };

  const submitActionDialog = async () => {
    if (!actionDialog.type) return;
    const note = actionDialog.note.trim() || undefined;
    try {
      if (actionDialog.type === 'resolve_single' && actionDialog.targetId) {
        setResolvingId(actionDialog.targetId);
        await resolveSystemEvent(actionDialog.targetId, note);
      }
      if (actionDialog.type === 'resolve_visible') {
        setIsBulkResolving(true);
        await resolveSystemEventsBulk({
          eventIds: (eventsResponse?.items || []).map((event) => event.id),
          resolved: false,
          note,
        });
      }
      if (actionDialog.type === 'resolve_old') {
        setIsBulkResolving(true);
        await resolveSystemEventsBulk({
          severities: ['warning', 'error', 'critical'],
          resolved: false,
          olderThan: buildOlderThanIso(bulkOlderThan),
          note,
        });
      }
      if (actionDialog.type === 'start_fresh') {
        setIsBulkResolving(true);
        await resolveSystemEventsBulk({
          eventIds: (eventsResponse?.items || []).map((event) => event.id),
          resolved: false,
          olderThan: buildOlderThanIso(bulkOlderThan),
          note: note || 'تمت المراجعة والتنظيف قبل جولة اختبار جديدة',
        });
        setFilters((prev) => ({ ...prev, resolvedState: 'active' }));
      }
      if (actionDialog.type === 'delete_all') {
        setIsDeleting(true);
        await deleteAllSystemEvents();
      }
      if (actionDialog.type === 'delete_visible') {
        setIsDeleting(true);
      await deleteVisibleSystemEvents({
        eventIds: (eventsResponse?.items || []).map((event) => event.id),
        severity: filters.severity || undefined,
        eventType: filters.eventType || undefined,
        sourceModule: filters.sourceModule || undefined,
        resolved: resolveFilterValue(filters.resolvedState),
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      }
      await loadData(true);
      closeActionDialog();
    } finally {
      setResolvingId(null);
      setIsBulkResolving(false);
      setIsDeleting(false);
    }
  };

  const downloadTextFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([`\ufeff${content}`], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'json' | 'md', scope: 'filtered' | 'all') => {
    try {
      setIsExporting(true);
      setError(null);
      const exportDate = formatDateForFilename();
      const scopeLabel = scope === 'all' ? 'كل الأحداث' : 'النتائج الحالية';
      const filterLabel =
        scope === 'all'
          ? 'بدون فلاتر'
          : [
              filters.severity ? `الشدة=${filters.severity}` : null,
              filters.eventType ? `النوع=${filters.eventType}` : null,
              filters.sourceModule ? `الموديول=${filters.sourceModule}` : null,
              filters.actionContains ? `الإجراء=${filters.actionContains}` : null,
              filters.requiresManualReview === 'true' ? 'مراجعة يدوية=نعم' : null,
              filters.dateFrom ? `ظ…ظ†=${filters.dateFrom}` : null,
              filters.dateTo ? `إلى=${filters.dateTo}` : null,
              filters.resolvedState === 'active'
                ? 'النطاق=نشطة'
                : filters.resolvedState === 'resolved'
                  ? 'النطاق=محلولة'
                  : 'النطاق=الكل',
            ]
              .filter(Boolean)
              .join('، ') || 'بدون فلاتر';

      let events: SystemEvent[] = [];
      if (scope === 'filtered') {
        events = eventsResponse?.items || [];
      } else {
        const exportResponse = await exportSystemEvents(buildFilterParams(true));
        events = exportResponse.items || [];
      }

        const exportRows = events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          severity: event.severity,
          timestamp: event.createdAt,
          sourceModule: event.sourceModule,
          action: event.action,
          status: event.status,
          message: extractEventMessage(event),
          errorCode: event.errorCode || null,
          affectedDocumentType: event.affectedDocumentType || null,
          affectedDocumentId: event.affectedDocumentId || null,
          metadata: event.metadata || {},
          compensationStatus: event.compensationStatus || null,
          resolvedAt: event.resolvedAt || null,
          resolvedBy: event.resolvedBy || null,
          resolutionNote: event.resolutionNote || null,
        }));

      if (format === 'json') {
        const payload = {
          generatedAt: new Date().toISOString(),
          scope: scopeLabel,
          filters: filterLabel,
          total: exportRows.length,
          items: exportRows,
        };
        const json = JSON.stringify(payload, null, 2);
        const filename = scope === 'all'
          ? `monitoring-events-${exportDate}.json`
          : `monitoring-events-filtered-${exportDate}.json`;
        downloadTextFile(filename, json, 'application/json');
      } else {
        const markdown = buildMarkdownExport(events, scopeLabel, filterLabel);
        const filename = scope === 'all'
          ? `monitoring-events-${exportDate}.md`
          : `monitoring-events-filtered-${exportDate}.md`;
        downloadTextFile(filename, markdown, 'text/markdown');
      }
    } catch (e: any) {
      setError(e?.message || 'فشل تصدير البيانات.');
    } finally {
      setIsExporting(false);
    }
  };

  const cards = [
    {
      key: 'today-total',
      label: 'إجمالي أحداث اليوم',
      value: overviewResponse?.summary.total || 0,
      icon: <Workflow size={18} />,
      tone: 'from-emerald-50 via-white to-white border-emerald-200 text-emerald-700',
    },
    {
      key: 'critical',
      label: 'الأحداث الحرجة',
      value: overviewResponse?.summary.criticalCount || 0,
      icon: <Siren size={18} />,
      tone: 'from-red-50 via-white to-white border-red-200 text-red-700',
    },
    {
      key: 'manual-review',
      label: 'حالات تحتاج مراجعة',
      value: manualReviewEvents.length,
      icon: <ShieldAlert size={18} />,
      tone: 'from-amber-50 via-white to-white border-amber-200 text-amber-700',
    },
    {
      key: 'failed',
      label: 'عمليات فاشلة',
      value: overviewResponse?.summary.failedCount || 0,
      icon: <XCircle size={18} />,
      tone: 'from-rose-50 via-white to-white border-rose-200 text-rose-700',
    },
  ];
  const topIssues = issueGroups.slice(0, 5);

  return (
    <div className="min-h-full space-y-5 p-4 md:p-6" dir="rtl">
      <div className="rounded-[2rem] border border-gray-200 bg-gradient-to-l from-gray-950 via-gray-900 to-slate-900 px-5 py-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-3xl bg-white/10 p-4 shadow-inner">
              <ShieldAlert size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-black">مركز المراقبة التشغيلية</h1>
              <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-white/70">
                طبقة مراقبة داخلية لالتقاط التعويضات، الإخفاقات الحرجة، حالات المراجعة اليدوية، وشذوذات المسارات
                المالية والمخزنية قبل أن تتحول إلى مشكلة تشغيلية صامتة.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-black">
                <span className={`rounded-full border px-3 py-1 ${healthStatus.tone}`}>
                  حالة النظام: {healthStatus.label}
                </span>
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-white/80">
                  العرض: {viewMode === "intelligent" ? "الذكي" : "السجل الخام"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1">
              <button
                onClick={() => setViewMode('intelligent')}
                className={`rounded-full px-3 py-1 text-xs font-black transition ${
                  viewMode === "intelligent" ? "bg-white text-gray-900" : "text-white/70 hover:bg-white/10"
                }`}
              >
                العرض الذكي
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`rounded-full px-3 py-1 text-xs font-black transition ${
                  viewMode === "raw" ? "bg-white text-gray-900" : "text-white/70 hover:bg-white/10"
                }`}
              >
                السجل الخام
              </button>
            </div>
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-black">
              تحديث حي كل 15 ثانية
            </span>
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white/80">
              آخر تحديث: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('ar-EG') : '—'}
            </span>
            <button
              onClick={() => loadData(true)}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white px-4 py-2 text-xs font-black text-gray-900 transition hover:bg-gray-100"
            >
              <RefreshCcw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              تحديث الآن
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.key} className={`rounded-3xl border bg-gradient-to-l p-5 shadow-sm ${card.tone}`}>
            <div className="flex items-center justify-between">
              <div className="rounded-2xl bg-white/80 p-3 shadow-sm">{card.icon}</div>
              <div className="text-3xl font-black">{card.value}</div>
            </div>
            <p className="mt-4 text-sm font-black">{card.label}</p>
          </div>
        ))}
      </div>

      {viewMode === 'intelligent' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black text-gray-900">أهم المشكلات الآن</h2>
                <p className="mt-1 text-xs font-bold text-gray-400">أعلى المشكلات تأثيرًا حسب الشدة والتكرار والحداثة</p>
              </div>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-black text-gray-600">
                أعلى {topIssues.length}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {topIssues.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <CheckCircle2 size={20} className="mx-auto text-emerald-600" />
                  <p className="mt-2 text-sm font-black text-emerald-800">لا توجد مشكلات حرجة ظاهرة حاليًا</p>
                </div>
              ) : (
                topIssues.map((issue) => {
                  const insight = describeIssue(issue);
                  return (
                    <div key={issue.key} className="rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-black text-gray-900">{issue.title}</h3>
                          <p className="mt-1 text-xs font-bold text-gray-400">{issue.representative.sourceModule} / {issue.representative.action}</p>
                        </div>
                        <span className={'rounded-full border px-3 py-1 text-xs font-black ' + (severityTone[issue.severity] || severityTone.info)}>
                          {issue.severity}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500">
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">تكرار: {issue.occurrences}</span>
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">آخر ظهور: {new Date(issue.lastSeen).toLocaleString('ar-EG')}</span>
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">النقاط: {issue.score}</span>
                      </div>
                      <p className="mt-3 text-xs font-bold text-gray-600">{insight.summary}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-black text-gray-900">رؤى تشغيلية قابلة للتنفيذ</h2>
              <p className="mt-1 text-xs font-bold text-gray-400">إرشادات عملية بحسب أعلى المشكلات الحالية</p>
            </div>
            <div className="mt-4 space-y-3">
              {topIssues.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-center">
                  <p className="text-sm font-black text-gray-600">لا توجد توصيات عاجلة حاليًا</p>
                </div>
              ) : (
                topIssues.map((issue) => {
                  const insight = describeIssue(issue);
                  return (
                    <div key={`${issue.key}-insight`} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={14} className="text-amber-600" />
                        <h3 className="text-sm font-black text-gray-900">{issue.title}</h3>
                      </div>
                      <p className="mt-2 text-xs font-bold text-gray-600">{insight.action}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.2fr)_minmax(22rem,0.9fr)]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-black text-gray-900">تصفية وتتبع الأحداث</h2>
                <p className="mt-1 text-xs font-bold text-gray-400">ابحث حسب الشدة، النوع، والنطاق الزمني</p>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-gray-50 px-3 py-2 text-xs font-black text-gray-500">
                <Search size={14} />
                {eventsResponse?.total || 0} نتيجة
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
              <select
                value={filters.severity}
                onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value }))}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-primary focus:bg-white"
              >
                <option value="">كل مستويات الخطورة</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
                <option value="critical">critical</option>
              </select>

              <select
                value={filters.eventType}
                onChange={(e) => setFilters((prev) => ({ ...prev, eventType: e.target.value }))}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-primary focus:bg-white"
              >
                <option value="">كل أنواع الأحداث</option>
                {eventTypeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <select
                value={filters.sourceModule}
                onChange={(e) => setFilters((prev) => ({ ...prev, sourceModule: e.target.value }))}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-primary focus:bg-white"
              >
                <option value="">كل الموديولات</option>
                {sourceModuleOptions.map((module) => (
                  <option key={module} value={module}>{module}</option>
                ))}
              </select>


              <select
                value={filters.resolvedState}
                onChange={(e) => setFilters((prev) => ({ ...prev, resolvedState: e.target.value }))}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-primary focus:bg-white"
              >
                <option value="active">الأحداث النشطة</option>
                <option value="all">كل الأحداث</option>
                <option value="resolved">الأحداث المحلولة</option>
              </select>

              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-primary focus:bg-white"
              />

              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-primary focus:bg-white"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-gray-500">قوالب المطعم:</span>
              {(
                [
                  { key: 'r_all', label: 'كل أحداث المطعم', apply: { sourceModule: 'restaurant', actionContains: '', eventType: '', requiresManualReview: '' } },
                  { key: 'r_qr', label: 'طلبات QR', apply: { sourceModule: 'restaurant', actionContains: 'qr.request', eventType: '', requiresManualReview: '' } },
                  { key: 'r_sessions', label: 'جلسات الطاولات', apply: { sourceModule: 'restaurant', actionContains: 'session.', eventType: '', requiresManualReview: '' } },
                  { key: 'r_checkout', label: 'Checkout / فاتورة', apply: { sourceModule: 'restaurant', actionContains: 'checkout.', eventType: '', requiresManualReview: '' } },
                  { key: 'r_kitchen', label: 'طباعة المطبخ', apply: { sourceModule: 'restaurant', actionContains: 'kitchen.', eventType: '', requiresManualReview: '' } },
                  { key: 'r_shift', label: 'إغلاق الوردية', apply: { sourceModule: 'restaurant', actionContains: 'shift.', eventType: '', requiresManualReview: '' } },
                  { key: 'r_settings', label: 'إعدادات الطابعة', apply: { sourceModule: 'restaurant', actionContains: 'settings.kitchen_printer', eventType: '', requiresManualReview: '' } },
                  { key: 'r_unread', label: 'مشاكل unread', apply: { sourceModule: 'restaurant', actionContains: 'unread.', eventType: '', requiresManualReview: '' } },
                  { key: 'r_manual', label: 'يحتاج مراجعة', apply: { sourceModule: 'restaurant', actionContains: '', eventType: '', requiresManualReview: 'true' as const } },
                ] as const
              ).map((chip) => {
                const active =
                  filters.sourceModule === chip.apply.sourceModule
                  && filters.eventType === chip.apply.eventType
                  && filters.actionContains === chip.apply.actionContains
                  && filters.requiresManualReview === chip.apply.requiresManualReview;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setFilters((prev) => ({ ...prev, ...chip.apply }))}
                    className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                      active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={handleBulkResolveVisible}
                disabled={isBulkResolving || !eventsResponse?.items?.length}
                className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 size={14} />
                وضع علامة محلول للمرئي
              </button>
              <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
                <select
                  value={bulkOlderThan}
                  onChange={(e) => setBulkOlderThan(e.target.value)}
                  className="bg-transparent text-xs font-black text-amber-700 outline-none"
                >
                  <option value="24h">أقدم من 24 ساعة</option>
                  <option value="7d">أقدم من 7 أيام</option>
                  <option value="30d">أقدم من 30 يوم</option>
                  <option value="90d">أقدم من 90 يوم</option>
                </select>
                <button
                  onClick={handleResolveOldWarnings}
                  disabled={isBulkResolving}
                  className="rounded-xl border border-amber-300 bg-white px-3 py-1 text-[11px] font-black text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  حل التحذيرات/الأخطاء القديمة
                </button>
              </div>
              <button
                onClick={handleStartFreshView}
                disabled={isBulkResolving}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-900 px-4 py-2 text-xs font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                بدء عرض نظيف
              </button>
              <button
                onClick={handleDeleteVisible}
                disabled={isDeleting || !eventsResponse?.items?.length}
                className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                حذف الأحداث المعروضة فقط
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={isDeleting}
                className="flex items-center gap-2 rounded-2xl border border-rose-300 bg-rose-600 px-4 py-2 text-xs font-black text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                حذف كل الأحداث
              </button>
              <button
                onClick={() => handleExport('json', 'filtered')}
                disabled={isExporting}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download size={14} />
                تصدير النتائج (JSON)
              </button>
              <button
                onClick={() => handleExport('md', 'filtered')}
                disabled={isExporting}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download size={14} />
                تصدير النتائج (Markdown)
              </button>
              <button
                onClick={() => handleExport('json', 'all')}
                disabled={isExporting}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-900 px-4 py-2 text-xs font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download size={14} />
                تصدير كل الأحداث (JSON)
              </button>
              <button
                onClick={() => handleExport('md', 'all')}
                disabled={isExporting}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-900 px-4 py-2 text-xs font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download size={14} />
                تصدير كل الأحداث (Markdown)
              </button>
            </div>
          </div>

          {viewMode === 'raw' ? (
            <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-4">
              <h2 className="text-sm font-black text-gray-900">سجل الأحداث التشغيلية</h2>
              <p className="mt-1 text-xs font-bold text-gray-400">صفوف ملوّنة، تفاصيل قابلة للتوسعة، ونافذة تفصيل كاملة</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-black text-gray-600">
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">مرئي: {(eventsResponse?.items || []).length}</span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                  نشط: {eventsResponse?.summary.activeCount ?? ((eventsResponse?.items || []).filter((event) => !event.resolvedAt).length)}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-gray-700">
                  محلول: {eventsResponse?.summary.resolvedCount ?? ((eventsResponse?.items || []).filter((event) => !!event.resolvedAt).length)}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">إجمالي: {eventsResponse?.total || 0}</span>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-right">
                <thead className="bg-gray-50 text-[11px] font-black uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">الحدث</th>
                    <th className="px-4 py-3">الشدة</th>
                    <th className="px-4 py-3">الموديول</th>
                    <th className="px-4 py-3">الحالة</th>
                    <th className="px-4 py-3">مراجعة</th>
                    <th className="px-4 py-3 text-left">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {(eventsResponse?.items || []).map((event) => {
                    const expanded = !!expandedRows[event.id];
                    return (
                      <React.Fragment key={event.id}>
                        <tr className={`border-t border-gray-100 ${event.severity === 'critical' ? 'bg-red-50/60' : 'bg-white'}`}>
                          <td className="px-4 py-4 align-top text-xs font-bold text-gray-600">
                            {new Date(event.createdAt).toLocaleString('ar-EG')}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-black text-gray-900">{event.eventType}</span>
                              <span className="font-mono text-[11px] font-bold text-gray-400">{event.id}</span>
                              <span className="text-xs font-bold text-gray-500">{extractEventMessage(event) || '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${severityTone[event.severity] || severityTone.info}`}>
                              {event.severity}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top text-sm font-black text-gray-700">
                            {event.sourceModule}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusTone[event.status] || statusTone.success}`}>
                              {event.status}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top">
                            {event.requiresManualReview && !event.resolvedAt ? (
                              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                                ⚠ يحتاج مراجعة
                              </span>
                            ) : event.resolvedAt ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                                تمت المراجعة
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-gray-400">لا</span>
                            )}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => toggleExpanded(event.id)}
                                className="rounded-xl border border-gray-200 p-2 text-gray-600 transition hover:bg-gray-50"
                                title="توسيع"
                              >
                                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                              <button
                                onClick={() => setSelectedEvent(event)}
                                className="rounded-xl border border-gray-200 p-2 text-gray-600 transition hover:bg-gray-50"
                                title="تفاصيل"
                              >
                                <Eye size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-gray-100 bg-gray-50/80">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl bg-gray-950 p-4">
                                  <p className="mb-2 text-xs font-black text-gray-400">Compensation Status</p>
                                  <pre className="max-h-60 overflow-auto text-left text-[11px] leading-6 text-emerald-300" dir="ltr">
                                    {prettyJson(event.compensationStatus)}
                                  </pre>
                                </div>
                                <div className="rounded-2xl bg-gray-950 p-4">
                                  <p className="mb-2 text-xs font-black text-gray-400">Metadata JSON</p>
                                  <pre className="max-h-60 overflow-auto text-left text-[11px] leading-6 text-sky-300" dir="ltr">
                                    {prettyJson(event.metadata)}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {!isLoading && (eventsResponse?.items || []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center">
                        <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-gray-300">
                          <Workflow size={42} className="opacity-30" />
                          <p className="text-sm font-black text-gray-500">لا توجد أحداث تطابق الفلاتر الحالية</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-gray-200 bg-gray-50 p-6 text-center">
              <Workflow size={32} className="mx-auto text-gray-400" />
              <p className="mt-3 text-sm font-black text-gray-700">العرض الذكي يركز على أهم المشكلات فقط.</p>
              <p className="mt-1 text-xs font-bold text-gray-500">للاطلاع على السجل الكامل، بدّل إلى السجل الخام.</p>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black text-gray-900">لوحة المراجعة اليدوية</h2>
                <p className="mt-1 text-xs font-bold text-gray-400">الحالات الحرجة المفتوحة التي تحتاج تدخلاً من المشغّل</p>
              </div>
              <div className="rounded-full bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
                {manualReviewEvents.length} مفتوح
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {manualReviewEvents.map((event) => (
                <div key={event.id} className="rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 via-white to-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={15} className="text-amber-600" />
                        <h3 className="text-sm font-black text-gray-900">{event.eventType}</h3>
                      </div>
                      <p className="mt-2 text-xs font-bold text-gray-500">
                        {event.sourceModule} / {event.action}
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] font-bold text-gray-400">{event.affectedDocumentId || event.id}</p>
                    </div>
                    <button
                      onClick={() => handleResolve(event.id)}
                      disabled={resolvingId === event.id}
                      className="rounded-2xl bg-gray-900 px-4 py-2 text-xs font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resolvingId === event.id ? 'جارٍ الإغلاق...' : 'إغلاق المراجعة'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${severityTone[event.severity] || severityTone.info}`}>
                      {event.severity}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${statusTone[event.status] || statusTone.success}`}>
                      {event.status}
                    </span>
                    {event.errorCode && (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-black text-rose-700">
                        {event.errorCode}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {manualReviewEvents.length === 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                  <CheckCircle2 size={24} className="mx-auto text-emerald-600" />
                  <p className="mt-3 text-sm font-black text-emerald-800">لا توجد حالات مراجعة يدوية مفتوحة حالياً</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AdaptiveModal
        open={actionDialog.open}
        onClose={closeActionDialog}
        size="lg"
        zIndex={420}
        panelClassName="flex h-full max-h-[80vh] flex-col"
      >
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-900 px-5 py-4 text-white">
          <h3 className="text-sm font-black">
            {actionDialog.type === 'delete_all' && 'تأكيد حذف كل الأحداث'}
            {actionDialog.type === 'delete_visible' && 'تأكيد حذف الأحداث المعروضة'}
            {actionDialog.type === 'resolve_visible' && 'تأكيد وضع علامة محلول للمرئي'}
            {actionDialog.type === 'resolve_old' && 'تأكيد حل التحذيرات/الأخطاء القديمة'}
            {actionDialog.type === 'start_fresh' && 'تأكيد بدء عرض نظيف'}
            {actionDialog.type === 'resolve_single' && 'تأكيد إغلاق المراجعة'}
          </h3>
          <button onClick={closeActionDialog} className="rounded-xl px-3 py-1 text-xs font-black text-white/70 hover:bg-white/10">
            إغلاق
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-5" dir="rtl">
          {(actionDialog.type === 'delete_all' || actionDialog.type === 'delete_visible') && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              هذا الإجراء يحذف السجلات نهائياً ولا يمكن التراجع عنه.
            </div>
          )}

          {actionDialog.type === 'resolve_old' && (
            <p className="text-sm font-bold text-gray-700">
              سيتم وضع علامة "محلول" لكل التحذيرات والأخطاء الأقدم من النطاق المحدد.
            </p>
          )}

          {actionDialog.type === 'resolve_visible' && (
            <p className="text-sm font-bold text-gray-700">
              سيتم وضع علامة "محلول" لكل الأحداث المعروضة حالياً ضمن الفلاتر الحالية.
            </p>
          )}

          {actionDialog.type === 'start_fresh' && (
            <p className="text-sm font-bold text-gray-700">
              سيتم حل الأحداث المرئية الأقدم من النطاق المحدد ثم تحديث العرض.
            </p>
          )}

          {(actionDialog.type === 'resolve_single' || actionDialog.type === 'resolve_visible' || actionDialog.type === 'resolve_old' || actionDialog.type === 'start_fresh') && (
            <div className="space-y-2">
              <label className="text-xs font-black text-gray-600">ملاحظة الحل (اختياري)</label>
              <textarea
                value={actionDialog.note}
                onChange={(e) => setActionDialog((prev) => ({ ...prev, note: e.target.value }))}
                className="min-h-[90px] w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-primary"
                placeholder="اكتب ملاحظة قصيرة عن سبب الإغلاق..."
              />
            </div>
          )}

          {(actionDialog.type === 'delete_all' || actionDialog.type === 'delete_visible') && (
            <div className="space-y-2">
              <label className="text-xs font-black text-gray-600">اكتب DELETE للتأكيد</label>
              <input
                value={actionDialog.confirmText}
                onChange={(e) => setActionDialog((prev) => ({ ...prev, confirmText: e.target.value }))}
                className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-800 outline-none focus:border-rose-400"
                placeholder="DELETE"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-white px-5 py-4">
          {/*
            keep delete confirmation strict: require typed DELETE
          */}
          <button
            onClick={closeActionDialog}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50"
          >
            إلغاء
          </button>
          <button
            onClick={submitActionDialog}
            disabled={
              isBulkResolving ||
              isDeleting ||
              ((actionDialog.type === 'delete_all' || actionDialog.type === 'delete_visible') && actionDialog.confirmText !== 'DELETE')
            }
            className="rounded-xl border border-gray-900 bg-gray-900 px-4 py-2 text-xs font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            تأكيد
          </button>
        </div>
      </AdaptiveModal>

      <EventDetailsModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
};

export default SystemMonitoringDashboard;
