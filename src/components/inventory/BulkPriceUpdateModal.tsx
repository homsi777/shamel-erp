import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Percent, RefreshCw, WalletCards, XCircle } from 'lucide-react';
import { AdaptiveModal } from '../responsive';
import { apiRequest } from '../../lib/api';
import { confirmDialog } from '../../lib/confirm';
import type {
  BulkPriceScope,
  BulkPriceUpdatePayload,
  Category,
  InventoryItem,
  ItemGroup,
  PriceFieldKey,
  PriceUpdatePreviewResult,
  Unit,
} from '../../types';
import PriceUpdatePreview from './PriceUpdatePreview';
import { getSupportedScopeOptions, previewBulkPriceUpdate } from '../../services/bulkPriceService';

const SCOPE_LABELS: Record<BulkPriceScope, string> = {
  single: 'مادة واحدة',
  selected: 'المواد المحددة',
  all: 'كل المواد',
  category: 'حسب التصنيف',
  unit: 'حسب الوحدة',
  group: 'حسب المجموعة',
};

const FIELD_LABELS: Record<PriceFieldKey, string> = {
  sale_price: 'سعر المبيع',
  purchase_price: 'سعر الشراء',
  wholesale_price: 'سعر الجملة',
  pos_price: 'سعر POS',
};

const OPERATION_LABELS = {
  add_fixed: 'إضافة قيمة ثابتة',
  add_percentage: 'إضافة نسبة',
  set_profit_margin: 'هامش ربح',
  adjust_exchange_rate: 'تعديل بسعر الصرف',
  copy_from_other_price: 'نسخ من تسعيرة أخرى',
} as const;

const extractCurrencyRates = (settingsRows: any[]) => {
  const map = new Map<string, any>();
  for (const row of settingsRows || []) {
    map.set(String(row?.key || ''), row?.value);
  }
  return {
    USD: 1,
    ...(map.get('currencyRates') || {}),
  };
};

const hasUsableExchangeRates = (rates: Record<string, number>) =>
  Object.entries(rates || {}).some(([code, value]) => code !== 'USD' && Number(value) > 0);

const normalizeDecimalInput = (value: string) => value.replace(/,/g, '.').replace(/[^\d.-]/g, '');

const parseDecimalInput = (value: string) => {
  const normalized = normalizeDecimalInput(value).trim();
  if (!normalized || normalized === '.' || normalized === '-' || normalized === '-.') return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

type FormState = BulkPriceUpdatePayload;

const BulkPriceUpdateModal: React.FC<{
  open: boolean;
  onClose: () => void;
  items: InventoryItem[];
  categories: Category[];
  units: Unit[];
  groups: ItemGroup[];
  selectedItemIds: string[];
  currentUserId: string;
  onExecute: (payload: BulkPriceUpdatePayload, preview: PriceUpdatePreviewResult, currencyRates: Record<string, number>) => Promise<void>;
}> = ({ open, onClose, items, categories, units, groups, selectedItemIds, currentUserId, onExecute }) => {
  const [form, setForm] = useState<FormState>({
    scope: selectedItemIds.length === 1 ? 'single' : selectedItemIds.length > 1 ? 'selected' : 'all',
    itemIds: selectedItemIds,
    targetField: 'sale_price',
    operation: 'add_fixed',
    amount: 0,
    amountMode: 'item_currency',
    sourceField: 'purchase_price',
  });
  const [currencyRates, setCurrencyRates] = useState<Record<string, number>>({ USD: 1 });
  const [preview, setPreview] = useState<PriceUpdatePreviewResult | null>(null);
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [dailyRateSource, setDailyRateSource] = useState('');
  const [amountInput, setAmountInput] = useState('0');
  const [percentageInput, setPercentageInput] = useState('0');
  const [marginInput, setMarginInput] = useState('0');
  const [exchangeRateInput, setExchangeRateInput] = useState('0');

  useEffect(() => {
    if (!open) return;
    setForm((prev) => ({
      ...prev,
      scope: selectedItemIds.length === 1 ? 'single' : selectedItemIds.length > 1 ? 'selected' : 'all',
      itemIds: selectedItemIds,
    }));
    setAmountInput(String(form.amount ?? 0));
    setPercentageInput(String(form.percentage ?? 0));
    setMarginInput(String(form.marginPercent ?? 0));
    setExchangeRateInput(String(form.exchangeRate ?? 0));
    setPreview(null);
  }, [open, selectedItemIds]);

  useEffect(() => {
    if (form.operation !== 'add_fixed') return;
    setAmountInput(String(form.amount ?? 0));
  }, [form.amount, form.operation]);

  useEffect(() => {
    if (form.operation !== 'add_percentage') return;
    setPercentageInput(String(form.percentage ?? 0));
  }, [form.percentage, form.operation]);

  useEffect(() => {
    if (form.operation !== 'set_profit_margin') return;
    setMarginInput(String(form.marginPercent ?? 0));
  }, [form.marginPercent, form.operation]);

  useEffect(() => {
    if (form.operation !== 'adjust_exchange_rate' || form.useDailyExchangeRate) return;
    setExchangeRateInput(String(form.exchangeRate ?? 0));
  }, [form.exchangeRate, form.operation, form.useDailyExchangeRate]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadSettings = async () => {
      setIsLoadingRates(true);
      try {
        const rows = await apiRequest('settings');
        if (!cancelled) {
          setCurrencyRates(extractCurrencyRates(Array.isArray(rows) ? rows : []));
          setDailyRateSource('ExchangeRate module / settings');
        }
      } catch {
        if (!cancelled) {
          setCurrencyRates({ USD: 1 });
          setDailyRateSource('');
        }
      } finally {
        if (!cancelled) setIsLoadingRates(false);
      }
    };
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const scopeOptions = useMemo(() => {
    return getSupportedScopeOptions(selectedItemIds.length, groups.length > 0);
  }, [groups.length, selectedItemIds.length]);

  const validateForm = () => {
    if (form.scope === 'category' && !form.categoryId) {
      alert('يرجى اختيار التصنيف أولاً.');
      return false;
    }
    if (form.scope === 'unit' && !form.unitId) {
      alert('يرجى اختيار الوحدة أولاً.');
      return false;
    }
    if (form.scope === 'group' && !form.groupId) {
      alert('يرجى اختيار مجموعة المواد أولاً.');
      return false;
    }
    if (form.operation === 'adjust_exchange_rate' && !form.useDailyExchangeRate && !(Number(form.exchangeRate || 0) > 0)) {
      alert('سعر الصرف يجب أن يكون أكبر من صفر.');
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    if (!validateForm()) return;
    setIsLoadingRates(true);
    try {
      const nextPreview = await previewBulkPriceUpdate({
        payload: form,
        currencyRates,
        userId: currentUserId,
      });
      setPreview(nextPreview);
    } finally {
      setIsLoadingRates(false);
    }
  };

  const handleDailyExchangeRatePreview = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      alert('تحديث الأسعار وفق النشرة اليومية يتطلب اتصالاً بالإنترنت.');
      return;
    }

    setIsLoadingRates(true);
    try {
      const rows = await apiRequest('settings');
      const nextRates = extractCurrencyRates(Array.isArray(rows) ? rows : []);
      if (!hasUsableExchangeRates(nextRates)) {
        alert('لا توجد أسعار صرف صالحة داخل ExchangeRate module.');
        return;
      }

      const nextForm: FormState = {
        ...form,
        operation: 'adjust_exchange_rate',
        useDailyExchangeRate: true,
        exchangeRate: undefined,
      };

      setCurrencyRates(nextRates);
      setDailyRateSource('ExchangeRate module / settings');
      setForm(nextForm);
      const nextPreview = await previewBulkPriceUpdate({
        payload: nextForm,
        currencyRates: nextRates,
        userId: currentUserId,
      });
      setPreview(nextPreview);
      if (nextPreview.affectedCount === 0) {
        alert('لا توجد مواد مؤهلة للتحديث وفق سعر الصرف اليومي الحالي.');
      }
    } catch {
      alert('تعذر جلب سعر الصرف الحالي من وحدة ExchangeRate.');
    } finally {
      setIsLoadingRates(false);
    }
  };

  const handleExecute = async () => {
    if (!validateForm()) return;
    const nextPreview = preview || await previewBulkPriceUpdate({
      payload: form,
      currencyRates,
      userId: currentUserId,
    });
    setPreview(nextPreview);
    if (nextPreview.affectedCount === 0) return;
    const confirmed = await confirmDialog(
      form.useDailyExchangeRate
        ? `سيتم تحديث ${nextPreview.affectedCount} مادة وفق النشرة اليومية الحالية. هل تريد المتابعة؟`
        : `سيتم تطبيق التعديل على ${nextPreview.affectedCount} مادة. هل تريد المتابعة؟`,
    );
    if (!confirmed) return;
    setIsExecuting(true);
    try {
      await onExecute(form, nextPreview, currencyRates);
      onClose();
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <AdaptiveModal open={open} onClose={onClose} size="xl" zIndex={200} panelClassName="flex h-full max-h-[92vh] flex-col">
      <div className="flex h-full max-h-[92vh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <WalletCards size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-900">تعديل الأسعار</h3>
              <p className="text-[11px] font-bold text-gray-400">محرك تعديل الأسعار الجماعي</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700">
            <XCircle size={18} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-4 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div>
              <label className="mb-1 block text-xs font-black text-gray-500">النطاق</label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as BulkPriceScope })}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
              >
                {scopeOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={!option.enabled}>
                    {SCOPE_LABELS[option.value]}{!option.enabled ? ' (غير متاح)' : ''}
                  </option>
                ))}
              </select>
              {form.scope === 'group' && (
                <p className="mt-1 text-[11px] font-bold text-amber-700">
                  سيُفعَّل اختيار المجموعة بالكامل في PHASE 3 مع نظام مجموعات المواد.
                </p>
              )}
            </div>

            {form.scope === 'category' && (
              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">التصنيف</label>
                <select
                  value={form.categoryId || ''}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                >
                  <option value="">اختر التصنيف</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
            )}

            {form.scope === 'unit' && (
              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">الوحدة</label>
                <select
                  value={form.unitId || ''}
                  onChange={(e) => setForm({ ...form, unitId: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                >
                  <option value="">اختر الوحدة</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </div>
            )}

            {form.scope === 'group' && (
              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">المجموعة</label>
                <select
                  value={form.groupId || ''}
                  onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                >
                  <option value="">اختر المجموعة</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-black text-gray-500">الحقل السعري</label>
              <select
                value={form.targetField}
                onChange={(e) => setForm({ ...form, targetField: e.target.value as PriceFieldKey })}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
              >
                {Object.entries(FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-black text-gray-500">العملية</label>
              <select
                value={form.operation}
                onChange={(e) => setForm({ ...form, operation: e.target.value as FormState['operation'], useDailyExchangeRate: false })}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
              >
                {Object.entries(OPERATION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {form.operation === 'add_fixed' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">القيمة</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    lang="en"
                    dir="ltr"
                    value={amountInput}
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      const normalized = normalizeDecimalInput(rawValue);
                      setAmountInput(normalized);
                      setForm({ ...form, amount: parseDecimalInput(normalized) });
                    }}
                    onBlur={() => setAmountInput(String(parseDecimalInput(amountInput)))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">عملة القيمة</label>
                  <select
                    value={form.amountMode || 'item_currency'}
                    onChange={(e) => setForm({ ...form, amountMode: e.target.value as FormState['amountMode'] })}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                  >
                    <option value="item_currency">حسب عملة المادة</option>
                    <option value="usd">دولار</option>
                    <option value="syp">ليرة سورية</option>
                  </select>
                </div>
              </>
            )}

            {form.operation === 'add_percentage' && (
              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">النسبة %</label>
                <div className="relative">
                  <Percent className="pointer-events-none absolute left-3 top-3.5 text-gray-300" size={16} />
                  <input
                    type="text"
                    inputMode="decimal"
                    lang="en"
                    dir="ltr"
                    value={percentageInput}
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      const normalized = normalizeDecimalInput(rawValue);
                      setPercentageInput(normalized);
                      setForm({ ...form, percentage: parseDecimalInput(normalized) });
                    }}
                    onBlur={() => setPercentageInput(String(parseDecimalInput(percentageInput)))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 pl-8 font-bold outline-none"
                  />
                </div>
              </div>
            )}

            {form.operation === 'set_profit_margin' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">هامش الربح %</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    lang="en"
                    dir="ltr"
                    value={marginInput}
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      const normalized = normalizeDecimalInput(rawValue);
                      setMarginInput(normalized);
                      setForm({ ...form, marginPercent: parseDecimalInput(normalized) });
                    }}
                    onBlur={() => setMarginInput(String(parseDecimalInput(marginInput)))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black text-gray-500">الحقل المرجعي</label>
                  <select
                    value={form.sourceField || 'purchase_price'}
                    onChange={(e) => setForm({ ...form, sourceField: e.target.value as PriceFieldKey })}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                  >
                    {Object.entries(FIELD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {form.operation === 'adjust_exchange_rate' && (
              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">سعر الصرف الجديد</label>
                <input
                  type="text"
                  inputMode="decimal"
                  lang="en"
                  dir="ltr"
                  value={form.useDailyExchangeRate ? '' : exchangeRateInput}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    const normalized = normalizeDecimalInput(rawValue);
                    setExchangeRateInput(normalized);
                    setForm({ ...form, useDailyExchangeRate: false, exchangeRate: parseDecimalInput(normalized) });
                  }}
                  onBlur={() => {
                    if (!form.useDailyExchangeRate) {
                      setExchangeRateInput(String(parseDecimalInput(exchangeRateInput)));
                    }
                  }}
                  placeholder="0.0000"
                  disabled={form.useDailyExchangeRate}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none disabled:bg-gray-100 disabled:text-gray-400"
                />
                <p className="mt-1 text-[11px] font-bold text-gray-400">
                  {form.useDailyExchangeRate
                    ? `يتم استخدام أسعار الصرف الحالية من ${dailyRateSource || 'ExchangeRate module'}.`
                    : 'يعتمد على السعر الأساسي المخزن إن وجد، وإلا على السعر الحالي.'}
                </p>
              </div>
            )}

            {form.operation === 'copy_from_other_price' && (
              <div>
                <label className="mb-1 block text-xs font-black text-gray-500">نسخ من حقل</label>
                <select
                  value={form.sourceField || 'sale_price'}
                  onChange={(e) => setForm({ ...form, sourceField: e.target.value as PriceFieldKey })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                >
                  {Object.entries(FIELD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-black text-gray-500">ملاحظات العملية</label>
              <textarea
                rows={3}
                value={form.notes || ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-bold outline-none"
                placeholder="اختياري"
              />
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-3 text-xs font-bold text-blue-800">
              <div className="flex items-center gap-2">
                <Layers size={14} />
                {isLoadingRates ? 'جاري تحميل أسعار الصرف...' : `أسعار الصرف المتاحة: ${Object.keys(currencyRates).join(', ')}`}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <PriceUpdatePreview preview={preview} />
            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-5 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleDailyExchangeRatePreview}
                disabled={isLoadingRates || isExecuting}
                className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-black text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                تحديث الأسعار وفق النشرة اليومية
              </button>
              <button
                type="button"
                onClick={handlePreview}
                className="rounded-xl border border-primary/20 bg-white px-5 py-3 text-sm font-black text-primary hover:bg-primary/5"
              >
                معاينة
              </button>
              <button
                type="button"
                onClick={handleExecute}
                disabled={isExecuting}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-white shadow-lg disabled:opacity-50"
              >
                {isExecuting ? <RefreshCw className="animate-spin" size={16} /> : <WalletCards size={16} />}
                تنفيذ التعديل
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdaptiveModal>
  );
};

export default BulkPriceUpdateModal;
