import React, { useState, useEffect } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { ConsignmentSettings } from '../../types';

interface ConsignmentSettingsPageProps {
  refreshData: () => Promise<void>;
}

const ConsignmentSettingsPage: React.FC<ConsignmentSettingsPageProps> = () => {
  const [settings, setSettings] = useState<ConsignmentSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiRequest('settings/consignment')
      .then((res: any) => setSettings(res || {}))
      .catch(() => setSettings({}))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setToast(null);
    try {
      await apiRequest('settings/consignment', { method: 'PUT', body: JSON.stringify(settings) });
      setToast({ type: 'success', text: 'تم حفظ الإعدادات' });
    } catch {
      setToast({ type: 'error', text: 'فشل الحفظ' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-teal-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      {toast && (
        <div
          className={`px-4 py-2 rounded-lg ${toast.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
        >
          {toast.text}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-800">إعدادات الأمانة</h3>

        <div>
          <label className="block text-sm font-bold text-gray-600 mb-1">سياسة أمانة المورد</label>
          <select
            value={settings.supplierPolicy || ''}
            onChange={(e) => setSettings((s) => ({ ...s, supplierPolicy: e.target.value as any || undefined }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white"
          >
            <option value="">—</option>
            <option value="REAL_LEDGER">REAL_LEDGER (دفتر حقيقي)</option>
            <option value="MEMO_ONLY">MEMO_ONLY (تذكاري فقط)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-600 mb-1">حساب مخزون أمانة العملاء</label>
          <input
            type="text"
            value={String(settings.customerConsignmentInventoryAccountId ?? '')}
            onChange={(e) =>
              setSettings((s) => ({ ...s, customerConsignmentInventoryAccountId: e.target.value || undefined }))
            }
            placeholder="معرف الحساب"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-600 mb-1">حساب مخزون أمانة الموردين</label>
          <input
            type="text"
            value={String(settings.supplierConsignmentInventoryAccountId ?? '')}
            onChange={(e) =>
              setSettings((s) => ({ ...s, supplierConsignmentInventoryAccountId: e.target.value || undefined }))
            }
            placeholder="معرف الحساب"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-600 mb-1">حساب التزامات الموردين</label>
          <input
            type="text"
            value={String(settings.supplierLiabilityAccountId ?? '')}
            onChange={(e) =>
              setSettings((s) => ({ ...s, supplierLiabilityAccountId: e.target.value || undefined }))
            }
            placeholder="معرف الحساب"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl"
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          حفظ الإعدادات
        </button>
      </div>
    </div>
  );
};

export default ConsignmentSettingsPage;
