/**
 * Unified «الطباعة والفواتير» — single place for POS, kitchen, queue, templates, printers.
 */
import React, { useState } from 'react';
import { Printer, ChevronDown, ChevronRight, UtensilsCrossed, Hash, LayoutTemplate, Building2, Activity } from 'lucide-react';
import type { AppSettings } from '../../types';
import PrintConfig from './PrintConfig';
import PrinterSettings from './PrinterSettings';
import PrinterManagement from '../print/PrinterManagement';
import TemplateDesigner from '../print/TemplateDesigner';
import PrintJobsHistoryPanel from './PrintJobsHistoryPanel';
import {
  runTestCustomerPrintDiagnostics,
  runTestKitchenPrintDiagnostics,
  probeKitchenPrinterFromSettings,
  arabicPrintDiagnosticMessage,
} from '../../lib/printEngine';

interface Props {
  settings: AppSettings;
  updatePrintProfile: (profileId: string, field: any, value: any) => void;
  updateThermal: (field: string, value: any) => void;
  updatePrintField: (field: string, value: any) => void;
  updateRestaurant: (field: string, value: any) => void;
  companyId?: string;
}

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-6 py-4 bg-gray-50/80 hover:bg-gray-100 transition text-right"
      >
        <span className="flex items-center gap-3 font-black text-gray-900 text-lg">
          {icon}
          {title}
        </span>
        {open ? <ChevronDown size={22} className="text-gray-500" /> : <ChevronRight size={22} className="text-gray-500" />}
      </button>
      {open && <div className="p-6 pt-2 border-t border-gray-100">{children}</div>}
    </div>
  );
};

const PrintingDiagnostics: React.FC<{ settings: AppSettings }> = ({ settings }) => {
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rest = settings.print?.restaurant || {};

  const run = async (kind: 'cust' | 'kit' | 'probe') => {
    setBusy(kind);
    setHint(null);
    try {
      if (kind === 'cust') {
        const x = await runTestCustomerPrintDiagnostics(settings);
        setHint(
          x.success
            ? '✓ تمت طباعة اختبار إيصال الزبون بنجاح (صفحة تجريبية).'
            : `✗ ${x.error === 'NO_PRINTER' ? 'لم يُضبط طابعة نقطة البيع — راجع الطابعة الحرارية.' : `فشل: ${x.error || ''}`}`,
        );
        return;
      }
      if (kind === 'kit') {
        const x = await runTestKitchenPrintDiagnostics(settings);
        setHint(
          x.success
            ? '✓ تمت طباعة اختبار المطبخ بنجاح.'
            : `✗ ${x.error || 'فشل طباعة المطبخ'}`,
        );
        return;
      }
      const p = await probeKitchenPrinterFromSettings(String(rest.kitchenHost || ''), Number(rest.kitchenPort ?? 9100));
      setHint(arabicPrintDiagnosticMessage(p));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-teal-200 bg-teal-50/40 p-4 space-y-3">
      <p className="text-sm font-bold text-gray-800">تشخيص الطابعات (بدون بيع حقيقي)</p>
      {hint && (
        <div className="rounded-lg bg-white border border-teal-100 px-3 py-2 text-sm font-bold text-gray-900 whitespace-pre-wrap">
          {hint}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run('cust')}
          className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy === 'cust' ? '…' : 'اختبار طباعة زبون'}
        </button>
        <button
          type="button"
          disabled={!!busy || !rest.kitchenEnabled}
          onClick={() => void run('kit')}
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-black text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {busy === 'kit' ? '…' : 'اختبار طباعة مطبخ'}
        </button>
        <button
          type="button"
          disabled={!!busy || !String(rest.kitchenHost || '').trim()}
          onClick={() => void run('probe')}
          className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-black text-white hover:bg-black disabled:opacity-50"
        >
          {busy === 'probe' ? '…' : 'فحص اتصال مطبخ (TCP)'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        رسائل الاتصال: نجاح، عنوان غير متاح، مهلة زمنية، أو منفذ غير صالح — تظهر بالعربية أعلاه.
      </p>
    </div>
  );
};

const PrintingInvoicesHub: React.FC<Props> = ({
  settings,
  updatePrintProfile,
  updateThermal,
  updatePrintField,
  updateRestaurant,
  companyId,
}) => {
  const r = settings.print?.restaurant || {};

  return (
    <div className="space-y-2 animate-fadeIn max-w-[1200px]">
      <div className="mb-6">
        <h2 className="text-2xl font-black text-gray-900 flex items-center gap-3">
          <Printer className="text-primary" size={28} />
          الطباعة والفواتير
        </h2>
        <p className="text-gray-500 text-sm mt-2">
          إعداد موحّد: فواتير A4/A5، نقطة البيع، مطبخ، دور الطلبات، الطابعات والقوالب — دون تكرار في أماكن متعددة.
        </p>
      </div>

      <Section title="معاينة وقوالب الفواتير (A4 / A5 / حراري)" icon={<LayoutTemplate size={22} className="text-purple-600" />}>
        <PrintConfig settings={settings} updatePrintProfile={updatePrintProfile} />
      </Section>

      <Section title="نقطة البيع — زبون + مطبخ + دور" icon={<UtensilsCrossed size={22} className="text-teal-600" />}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(r.queueEnabled)}
                onChange={(e) => updateRestaurant('queueEnabled', e.target.checked)}
                className="w-4 h-4 rounded text-primary"
              />
              <span className="font-bold text-gray-800">تفعيل رقم الدور / الطابور</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(r.kitchenEnabled)}
                onChange={(e) => updateRestaurant('kitchenEnabled', e.target.checked)}
                className="w-4 h-4 rounded text-primary"
              />
              <span className="font-bold text-gray-800">تفعيل طابعة المطبخ (شبكة / IP)</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">نطاق الدور</label>
              <select
                value={r.queueScope || 'branch'}
                onChange={(e) => updateRestaurant('queueScope', e.target.value)}
                className="w-full border-2 rounded-xl p-2 font-bold"
              >
                <option value="branch">حسب الفرع</option>
                <option value="global">على مستوى الشركة</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">إعادة تعيين الدور</label>
              <select
                value={r.queueResetMode || 'daily'}
                onChange={(e) => updateRestaurant('queueResetMode', e.target.value)}
                className="w-full border-2 rounded-xl p-2 font-bold"
              >
                <option value="daily">يومي (كل يوم جديد)</option>
                <option value="continuous">متصل بدون تصفير يومي</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">بادئة الدور (اختياري)</label>
              <input
                dir="ltr"
                className="w-full border-2 rounded-xl p-2 font-mono text-sm"
                value={r.queuePrefix || ''}
                onChange={(e) => updateRestaurant('queuePrefix', e.target.value)}
                placeholder="مثال: A-"
              />
            </div>
          </div>

          <div className="border rounded-xl p-4 bg-slate-50 space-y-3">
            <h4 className="font-black text-gray-800 flex items-center gap-2">
              <Building2 size={18} /> طابعة المطبخ (TCP)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                dir="ltr"
                placeholder="عنوان IP"
                className="border-2 rounded-xl p-2 font-mono"
                value={r.kitchenHost || ''}
                onChange={(e) => updateRestaurant('kitchenHost', e.target.value)}
              />
              <input
                dir="ltr"
                type="number"
                placeholder="منفذ (افتراضي 9100)"
                className="border-2 rounded-xl p-2 font-mono"
                value={r.kitchenPort ?? 9100}
                onChange={(e) => updateRestaurant('kitchenPort', Number(e.target.value) || 9100)}
              />
              <select
                value={r.kitchenPaperSize || '80mm'}
                onChange={(e) => updateRestaurant('kitchenPaperSize', e.target.value)}
                className="border-2 rounded-xl p-2 font-bold"
              >
                <option value="58mm">58 مم</option>
                <option value="80mm">80 مم</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value={String(r.kitchenCopies ?? 1)}
                onChange={(e) => updateRestaurant('kitchenCopies', Number(e.target.value) as 1 | 2 | 3)}
                className="border-2 rounded-xl p-2 font-bold"
              >
                <option value="1">نسخ مطبخ: 1</option>
                <option value="2">نسخ مطبخ: 2</option>
                <option value="3">نسخ مطبخ: 3</option>
              </select>
              <select
                value={String(r.customerReceiptCopies ?? 1)}
                onChange={(e) => updateRestaurant('customerReceiptCopies', Number(e.target.value) as 1 | 2 | 3)}
                className="border-2 rounded-xl p-2 font-bold"
              >
                <option value="1">نسخ إيصال زبون: 1</option>
                <option value="2">نسخ إيصال زبون: 2</option>
                <option value="3">نسخ إيصال زبون: 3</option>
              </select>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.kitchenAutoPrint !== false}
                  onChange={(e) => updateRestaurant('kitchenAutoPrint', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-bold">طباعة مطبخ تلقائية بعد البيع</span>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <input
                dir="ltr"
                className="border rounded-lg p-2 font-mono text-xs"
                placeholder="معرّف قالب إيصال الزبون (اختياري)"
                value={r.customerTemplateId || ''}
                onChange={(e) => updateRestaurant('customerTemplateId', e.target.value.trim())}
              />
              <input
                dir="ltr"
                className="border rounded-lg p-2 font-mono text-xs"
                placeholder="معرّف قالب مطبخ (اختياري)"
                value={r.kitchenTemplateId || ''}
                onChange={(e) => updateRestaurant('kitchenTemplateId', e.target.value.trim())}
              />
            </div>
            <PrintingDiagnostics settings={settings} />
          </div>
        </div>
      </Section>

      <Section title="سجل محاولات الطباعة (تشخيص)" icon={<Activity size={22} className="text-emerald-600" />} defaultOpen={false}>
        <PrintJobsHistoryPanel />
      </Section>

      <Section title="الطابعة الحرارية الافتراضية (ويندوز / أندرويد)" icon={<Printer size={22} className="text-amber-500" />}>
        <PrinterSettings settings={settings} updateThermal={updateThermal} updatePrintField={updatePrintField} />
      </Section>

      <Section title="رقم الدور — عرض على الإيصالات" icon={<Hash size={22} className="text-blue-600" />} defaultOpen={false}>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.showQueueOnCustomer !== false}
              onChange={(e) => updateRestaurant('showQueueOnCustomer', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-bold">إظهار الدور على إيصال الزبون</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.showQueueOnKitchen !== false}
              onChange={(e) => updateRestaurant('showQueueOnKitchen', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-bold">إظهار الدور على تذكرة المطبخ</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.showCashierOnReceipt !== false}
              onChange={(e) => updateRestaurant('showCashierOnReceipt', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-bold">إظهار اسم الكاشير</span>
          </label>
        </div>
      </Section>

      <Section title="سجل الطابعات" icon={<Printer size={22} className="text-blue-600" />} defaultOpen={false}>
        <PrinterManagement companyId={companyId} />
      </Section>

      <Section title="مصمم القوالب" icon={<LayoutTemplate size={22} className="text-violet-600" />} defaultOpen={false}>
        <TemplateDesigner companyId={companyId} />
      </Section>
    </div>
  );
};

export default PrintingInvoicesHub;
