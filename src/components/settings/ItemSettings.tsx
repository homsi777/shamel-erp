import React from 'react';
import { Package, Save, RefreshCw, Scissors } from 'lucide-react';
import type { AppSettings } from '../../types';

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings['itemSettings']) => void;
  onSave: () => void;
  saving?: boolean;
}

const ItemSettings: React.FC<Props> = ({ settings, onChange, onSave, saving }) => {
  const value = {
    enableServiceItems: true,
    enableBarcodePerUnit: true,
    enableMultiUnitPricing: true,
    autoSyncAlternateCurrencyPrices: false,
    preferredPriceReferenceCurrency: 'USD',
    allowManualLockOfAlternatePrice: true,
    enableTextileMode: false,
    textileRequireWarehousePreparationForSales: true,
    ...(settings.itemSettings || {}),
  };

  const update = (patch: Partial<typeof value>) => onChange({ ...value, ...patch });

  const Toggle = ({ label, field, help }: { label: string; field: keyof typeof value; help?: string }) => (
    <label className="rounded-xl border border-gray-100 bg-gray-50 p-3 transition hover:bg-gray-100">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-gray-700">{label}</div>
          {help ? <div className="mt-1 text-[11px] font-bold text-gray-500">{help}</div> : null}
        </div>
        <input
          type="checkbox"
          checked={Boolean(value[field])}
          onChange={(e) => update({ [field]: e.target.checked } as Partial<typeof value>)}
          className="h-5 w-5 rounded text-primary focus:ring-primary/20"
        />
      </div>
    </label>
  );

  return (
    <div className="animate-fadeIn space-y-5 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 border-b pb-4">
        <div className="rounded-xl bg-purple-50 p-2"><Package size={20} className="text-purple-600" /></div>
        <div>
          <h3 className="text-lg font-black text-gray-800">إعدادات المواد والمخزون</h3>
          <p className="text-xs text-gray-500">التحكم في سلوك المواد العامة وخصائص الأقمشة من داخل نفس النظام.</p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-black text-gray-600">الإعدادات العامة</h4>
        <Toggle label="تمكين المواد الخدمية" field="enableServiceItems" />
        <Toggle label="تمكين باركود لكل وحدة" field="enableBarcodePerUnit" />
        <Toggle label="تمكين التسعير متعدد الوحدات" field="enableMultiUnitPricing" />
        <Toggle label="مزامنة الأسعار البديلة تلقائيًا" field="autoSyncAlternateCurrencyPrices" />
        <Toggle label="السماح بقفل السعر البديل يدويًا" field="allowManualLockOfAlternatePrice" />
      </div>

      <div className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
        <div className="flex items-center gap-2">
          <Scissors size={18} className="text-amber-700" />
          <div>
            <h4 className="text-sm font-black text-amber-900">وضع الأقمشة</h4>
            <p className="text-[11px] font-bold text-amber-700">
              عند التفعيل تظهر خصائص الأقمشة داخل شاشة المادة والفواتير وإشعارات التسليم الحالية فقط.
            </p>
          </div>
        </div>

        <Toggle
          label="تفعيل عمليات الأقمشة"
          field="enableTextileMode"
          help="عند الإيقاف يبقى النظام على السلوك العام الحالي بدون حقول أقمشة إضافية."
        />

        <Toggle
          label="إلزام تحضير المستودع قبل بيع الأقمشة"
          field="textileRequireWarehousePreparationForSales"
          help="يبقي بيع الأقمشة مرتبطًا بإشعار التسليم والتحضير المعتمد قبل اعتماد فاتورة البيع."
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-gray-500">عملة التسعير المرجعية</label>
        <select
          value={value.preferredPriceReferenceCurrency}
          onChange={(e) => update({ preferredPriceReferenceCurrency: e.target.value })}
          className="w-full cursor-pointer rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
        >
          <option value="USD">USD</option>
          <option value="SYP">SYP</option>
          <option value="TRY">TRY</option>
        </select>
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-white shadow hover:bg-teal-800 disabled:bg-gray-400 transition"
      >
        {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
        حفظ إعدادات المواد
      </button>
    </div>
  );
};

export default ItemSettings;
