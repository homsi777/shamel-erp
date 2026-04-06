import React, { useState, useEffect } from 'react';
import { apiRequest } from '../../lib/api';
import { FileText, Save, RefreshCw } from 'lucide-react';

const InvoiceSettings: React.FC = () => {
  const [settings, setSettings] = useState({
    showLastPurchasePriceColumn: false,
    showAvailableQtyColumn: false,
    showCommissionColumn: false,
    showColumnTotals: true,
    allowPostedInvoiceCorrection: true,
    postedInvoiceCorrectionMode: 'corrective_edit',
    enableImageExport: true,
    defaultImageFormat: 'png',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest('system-settings?key=invoiceSettings').then((res: any) => {
      if (res?.value) {
        try { setSettings(s => ({ ...s, ...JSON.parse(res.value) })); } catch {}
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest('system-settings', {
        method: 'PUT',
        body: JSON.stringify({ key: 'invoiceSettings', value: JSON.stringify(settings) }),
      });
    } catch {}
    setSaving(false);
  };

  const Toggle = ({ label, field }: { label: string; field: string }) => (
    <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 cursor-pointer hover:bg-gray-100 transition">
      <span className="text-sm font-bold text-gray-700">{label}</span>
      <input type="checkbox" checked={(settings as any)[field]}
        onChange={e => setSettings(s => ({ ...s, [field]: e.target.checked }))}
        className="rounded text-primary focus:ring-primary/20 w-5 h-5" />
    </label>
  );

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-5 animate-fadeIn">
      <div className="flex items-center gap-3 border-b pb-4">
        <div className="p-2 rounded-xl bg-blue-50"><FileText size={20} className="text-blue-600" /></div>
        <div>
          <h3 className="text-lg font-black text-gray-800">إعدادات الفواتير</h3>
          <p className="text-xs text-gray-500">التحكم في أعمدة ومحرر الفواتير</p>
        </div>
      </div>

      <h4 className="text-sm font-black text-gray-600">الأعمدة الاختيارية</h4>
      <div className="space-y-3">
        <Toggle label="عرض عمود آخر سعر شراء" field="showLastPurchasePriceColumn" />
        <Toggle label="عرض عمود الرصيد المتاح" field="showAvailableQtyColumn" />
        <Toggle label="عرض عمود العمولة" field="showCommissionColumn" />
        <Toggle label="عرض إجماليات الأعمدة" field="showColumnTotals" />
      </div>

      <h4 className="text-sm font-black text-gray-600 mt-4">التصحيح والتصدير</h4>
      <div className="space-y-3">
        <Toggle label="السماح بتصحيح الفواتير المرحّلة" field="allowPostedInvoiceCorrection" />
        <Toggle label="تمكين تصدير الفاتورة كصورة" field="enableImageExport" />
        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">وضع التصحيح</label>
          <select value={settings.postedInvoiceCorrectionMode}
            onChange={e => setSettings(s => ({ ...s, postedInvoiceCorrectionMode: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-primary cursor-pointer">
            <option value="corrective_edit">تعديل تصحيحي مع أثر تدقيق</option>
            <option value="reverse_recreate">عكس وإعادة إنشاء</option>
            <option value="unpost_repost">إلغاء ترحيل وإعادة ترحيل</option>
          </select>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-bold shadow hover:bg-teal-800 disabled:bg-gray-400 transition">
        {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
        حفظ الإعدادات
      </button>
    </div>
  );
};

export default InvoiceSettings;
