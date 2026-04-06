import React, { useState, useEffect } from 'react';
import { apiRequest } from '../../lib/api';
import { DollarSign, Save, RefreshCw } from 'lucide-react';

const PricingSettings: React.FC = () => {
  const [settings, setSettings] = useState({
    enableLastSoldPriceRecall: true,
    enableCustomerSpecificPrices: true,
    pricingResolutionPriority: 'customer_special,last_sold,pricing_mode,default,manual',
    allowManualPriceOverride: true,
    showPriceSourceInInvoice: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest('system-settings?key=pricingSettings').then((res: any) => {
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
        body: JSON.stringify({ key: 'pricingSettings', value: JSON.stringify(settings) }),
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
        <div className="p-2 rounded-xl bg-emerald-50"><DollarSign size={20} className="text-emerald-600" /></div>
        <div>
          <h3 className="text-lg font-black text-gray-800">إعدادات التسعير</h3>
          <p className="text-xs text-gray-500">التحكم في محرك الأسعار وسلوك التسعير في الفواتير</p>
        </div>
      </div>

      <div className="space-y-3">
        <Toggle label="تذكر آخر سعر بيع لكل عميل/مادة" field="enableLastSoldPriceRecall" />
        <Toggle label="تمكين أسعار خاصة لكل عميل/مادة" field="enableCustomerSpecificPrices" />
        <Toggle label="السماح بتعديل السعر يدوياً" field="allowManualPriceOverride" />
        <Toggle label="إظهار مصدر السعر في الفاتورة" field="showPriceSourceInInvoice" />
      </div>

      <div>
        <label className="text-xs font-bold text-gray-500 mb-1 block">أولوية تحديد السعر</label>
        <input type="text" value={settings.pricingResolutionPriority}
          onChange={e => setSettings(s => ({ ...s, pricingResolutionPriority: e.target.value }))}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          dir="ltr" />
        <p className="text-[11px] text-gray-400 mt-1">الأولوية من اليسار لليمين: customer_special, last_sold, pricing_mode, default, manual</p>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-bold shadow hover:bg-teal-800 disabled:bg-gray-400 transition">
        {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
        حفظ الإعدادات
      </button>
    </div>
  );
};

export default PricingSettings;
