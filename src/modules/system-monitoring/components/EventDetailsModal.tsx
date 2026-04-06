import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../../../components/responsive';
import { SystemEvent } from '../../../types';

type Props = {
  event: SystemEvent | null;
  onClose: () => void;
};

const severityClasses: Record<string, string> = {
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const statusClasses: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  compensated: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

const prettyJson = (value: any) => JSON.stringify(value ?? {}, null, 2);
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

const EventDetailsModal: React.FC<Props> = ({ event, onClose }) => {
  if (!event) return null;

  return (
    <AdaptiveModal open={!!event} onClose={onClose} size="xl" zIndex={400} panelClassName="flex h-full max-h-[92vh] flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-l from-gray-950 via-gray-900 to-gray-800 px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 p-3">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h3 className="text-base font-black">تفاصيل الحدث التشغيلي</h3>
            <p className="mt-1 text-xs font-bold text-white/60">{event.eventType}</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-xl p-2 text-white/50 transition hover:bg-white/10 hover:text-white">
          <XCircle size={22} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-5" dir="rtl">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-black ${severityClasses[event.severity] || severityClasses.info}`}>
                {event.severity}
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusClasses[event.status] || statusClasses.success}`}>
                {event.status}
              </span>
              {event.requiresManualReview && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                  ⚠ يحتاج مراجعة
                </span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-[11px] font-black text-gray-400">الموديول</p>
                <p className="mt-1 text-sm font-black text-gray-900">{event.sourceModule}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-[11px] font-black text-gray-400">الإجراء</p>
                <p className="mt-1 text-sm font-black text-gray-900">{event.action}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-[11px] font-black text-gray-400">رمز الخطأ</p>
                <p className="mt-1 break-all font-mono text-xs font-bold text-rose-700">{event.errorCode || '—'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-[11px] font-black text-gray-400">وقت الإنشاء</p>
                <p className="mt-1 text-sm font-black text-gray-900">{new Date(event.createdAt).toLocaleString('ar-EG')}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3 md:col-span-2">
                <p className="text-[11px] font-black text-gray-400">الرسالة</p>
                <p className="mt-1 text-sm font-black text-gray-900">{extractEventMessage(event) || '—'}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-gray-800">
                <Clock3 size={16} className="text-primary" />
                <h4 className="text-sm font-black">الوثيقة المتأثرة</h4>
              </div>
              <div className="space-y-2 text-sm font-bold text-gray-600">
                <p>النوع: <span className="text-gray-900">{event.affectedDocumentType || '—'}</span></p>
                <p>المعرف: <span className="break-all font-mono text-xs text-gray-900">{event.affectedDocumentId || '—'}</span></p>
                <p>الحل: <span className="text-gray-900">{event.resolvedAt ? 'تمت المراجعة' : 'غير محلول'}</span></p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-gray-800">
                {event.requiresManualReview ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
                <h4 className="text-sm font-black">حالة المراجعة</h4>
              </div>
              <div className="space-y-2 text-sm font-bold text-gray-600">
                <p>يتطلب مراجعة: <span className="text-gray-900">{event.requiresManualReview ? 'نعم' : 'لا'}</span></p>
                <p>تم الحل بواسطة: <span className="text-gray-900">{event.resolvedBy || '—'}</span></p>
                <p>وقت الحل: <span className="text-gray-900">{event.resolvedAt ? new Date(event.resolvedAt).toLocaleString('ar-EG') : '—'}</span></p>
                <p>ملاحظة الحل: <span className="text-gray-900">{event.resolutionNote || '—'}</span></p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 text-sm font-black text-gray-800">Compensation Status</h4>
            <pre className="max-h-[22rem] overflow-auto rounded-2xl bg-gray-950 p-4 text-left text-[11px] leading-6 text-emerald-300" dir="ltr">
              {prettyJson(event.compensationStatus)}
            </pre>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 text-sm font-black text-gray-800">Metadata JSON</h4>
            <pre className="max-h-[22rem] overflow-auto rounded-2xl bg-gray-950 p-4 text-left text-[11px] leading-6 text-sky-300" dir="ltr">
              {prettyJson(event.metadata)}
            </pre>
          </div>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default EventDetailsModal;
