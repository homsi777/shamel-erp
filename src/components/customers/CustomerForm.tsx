import React, { useState } from 'react';
import { Plus, RefreshCw, CheckCircle, User, Phone, MapPin, ChevronDown, DollarSign } from 'lucide-react';
import { Client } from '../../types';

interface Props {
  activeTab: 'customer' | 'supplier';
  onSubmit: (data: Partial<Client>) => Promise<void>;
  isSubmitting: boolean;
  lastActionStatus: string | null;
  linkedAccountPreview?: { code?: string; name?: string } | null;
}

const PRICING_MODES = [
  { value: 'retail',       label: 'سعر المفرق' },
  { value: 'wholesale',    label: 'سعر الجملة' },
  { value: 'wholesale2',   label: 'سعر جملة الجملة' },
  { value: 'distribution', label: 'سعر التوزيع' },
  { value: 'delegate',     label: 'سعر المندوب' },
  { value: 'pos',          label: 'سعر نقطة البيع' },
  { value: 'custom',       label: 'سعر خاص' },
];

const CustomerForm: React.FC<Props> = ({ activeTab, onSubmit, isSubmitting, lastActionStatus, linkedAccountPreview }) => {
  const [formData, setFormData] = useState<any>({ name: '', phone: '', address: '', defaultPricingMode: 'retail', allowManualPriceEdit: true, allowLastPriceOverride: true, allowCustomerItemSpecialPrices: true });
  const [showPricing, setShowPricing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData).then(() => setFormData({ name: '', phone: '', address: '' }));
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit sticky top-6">
      <h3 className="text-lg font-bold mb-6 flex justify-between items-center text-gray-800 border-b pb-2">
        <span>إضافة {activeTab === 'customer' ? 'عميل جديد' : 'مورد جديد'}</span>
        {lastActionStatus === 'success' && (
          <span className="text-xs text-green-600 flex items-center gap-1 animate-pulse bg-green-50 px-2 py-1 rounded-full">
            <CheckCircle size={14} /> تمت الإضافة
          </span>
        )}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">الاسم الكامل</label>
          <div className="relative">
            <input
              required
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary outline-none transition"
              placeholder="الاسم..."
            />
            <User className="absolute left-3 top-2.5 text-gray-400" size={18} />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">رقم الهاتف</label>
          <div className="relative">
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary outline-none transition font-numeric"
              placeholder="09..."
            />
            <Phone className="absolute left-3 top-2.5 text-gray-400" size={18} />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">العنوان</label>
          <div className="relative">
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary outline-none transition"
              placeholder="المحافظة - المنطقة"
            />
            <MapPin className="absolute left-3 top-2.5 text-gray-400" size={18} />
          </div>
        </div>

        {/* Pricing settings – collapsed by default */}
        {activeTab === 'customer' && (
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <button type="button" onClick={() => setShowPricing(p => !p)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition text-xs font-bold text-gray-600">
              <span className="flex items-center gap-1.5"><DollarSign size={13} className="text-emerald-600"/> إعدادات التسعير</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${showPricing ? 'rotate-180' : ''}`} />
            </button>
            {showPricing && (
              <div className="p-3 border-t border-gray-100 space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 mb-1 block">وضع التسعير الافتراضي</label>
                  <select value={formData.defaultPricingMode}
                    onChange={e => setFormData({ ...formData, defaultPricingMode: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer">
                    {PRICING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  {[
                    { key: 'allowLastPriceOverride',          label: 'استخدام آخر سعر بيع' },
                    { key: 'allowCustomerItemSpecialPrices',  label: 'السماح بأسعار خاصة لكل مادة' },
                    { key: 'allowManualPriceEdit',            label: 'السماح بتعديل السعر يدوياً' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={formData[key] ?? true}
                        onChange={e => setFormData({ ...formData, [key]: e.target.checked })}
                        className="rounded border-gray-300 text-primary focus:ring-primary/20" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
          يتم إنشاء الحساب المحاسبي الفرعي تلقائياً عند حفظ العميل/المورد.
          {linkedAccountPreview?.code && (
            <span className="block mt-1 font-mono text-gray-700">
              {linkedAccountPreview.code} — {linkedAccountPreview.name || '-'}
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3 px-4 rounded-xl text-white font-bold flex items-center justify-center gap-2 shadow-lg transition transform active:scale-95 ${
            activeTab === 'customer' ? 'bg-primary hover:bg-teal-800' : 'bg-secondary hover:bg-orange-600'
          }`}
        >
          {isSubmitting ? <RefreshCw className="animate-spin" size={20} /> : <Plus size={20} />}
          {isSubmitting ? 'جاري الحفظ...' : 'حفظ وإضافة'}
        </button>
      </form>
    </div>
  );
};

export default CustomerForm;
