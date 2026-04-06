
import React from 'react';
import { Coins, RefreshCw, Info, DollarSign } from 'lucide-react';
import { AppSettings, DEFAULT_CURRENCY_RATES, formatNumber } from '../../types';

interface Props {
    settings: AppSettings;
    updateCurrencyRate: (currency: string, value: number) => void;
    updateDefaultCurrency: (currency: 'USD' | 'SYP' | 'TRY') => void;
}

const CurrencySettings: React.FC<Props> = ({ settings, updateCurrencyRate, updateDefaultCurrency }) => {
    const safeRates = (settings.currencyRates && typeof settings.currencyRates === 'object')
        ? settings.currencyRates
        : DEFAULT_CURRENCY_RATES;
    const current = {
        ...DEFAULT_CURRENCY_RATES,
        ...safeRates
    };
    const sypValue = Number.isFinite(Number(current.SYP)) ? Number(current.SYP) : Number(DEFAULT_CURRENCY_RATES.SYP);
    const tryValue = Number.isFinite(Number(current.TRY)) ? Number(current.TRY) : Number(DEFAULT_CURRENCY_RATES.TRY);

    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn space-y-8">
            <div className="flex justify-between items-start border-b pb-4">
                <div>
                    <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Coins className="text-primary"/> إعدادات العملات وأسعار الصرف
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">ضبط أسعار الصرف المحلية مقابل الدولار الأمريكي (USD).</p>
                </div>
                <div className="bg-primary/10 text-primary px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
                    Live Exchange Rates
                </div>
            </div>

            {/* العملة الافتراضية */}
            <div className="bg-gradient-to-r from-primary/5 to-blue-50 p-6 rounded-2xl border border-primary/20">
                <label className="text-sm font-bold text-gray-700 mb-3 block">العملة الافتراضية للنظام</label>
                <p className="text-xs text-gray-500 mb-4">سيتم استخدام هذه العملة تلقائياً عند إنشاء فاتورة أو سند جديد.</p>
                <div className="flex gap-3">
                    {([['USD', 'دولار $'], ['SYP', 'ل.س SYP'], ['TRY', 'ل.ت TRY']] as const).map(([code, label]) => (
                        <button
                            key={code}
                            onClick={() => updateDefaultCurrency(code)}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${
                                (settings.defaultCurrency || 'USD') === code
                                    ? 'bg-primary text-white shadow-lg scale-105'
                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-primary'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                    {/* الليرة السورية */}
                    <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 group hover:border-primary transition-colors">
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">الليرة السورية (SYP / $)</label>
                            <div className="bg-white p-2 rounded-xl shadow-sm"><RefreshCw size={14} className="text-primary"/></div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex-1 relative">
                                <input 
                                    type="number" 
                                    value={sypValue} 
                                    onChange={e => updateCurrencyRate('SYP', Number(e.target.value))}
                                    className="w-full p-4 border-2 border-white rounded-xl font-black text-2xl text-center outline-none focus:border-primary shadow-sm"
                                />
                                <div className="absolute left-4 top-4 text-xs font-black text-gray-300">SYP</div>
                            </div>
                            <div className="text-center px-4">
                                <div className="text-[10px] font-bold text-gray-400 mb-1">المعادلة</div>
                                <div className="font-black text-lg text-gray-700">1 $</div>
                            </div>
                        </div>
                    </div>

                    {/* الليرة التركية */}
                    <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 group hover:border-blue-500 transition-colors">
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">الليرة التركية (TRY / $)</label>
                            <div className="bg-white p-2 rounded-xl shadow-sm"><RefreshCw size={14} className="text-blue-500"/></div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex-1 relative">
                                <input 
                                    type="number" 
                                    value={tryValue} 
                                    onChange={e => updateCurrencyRate('TRY', Number(e.target.value))}
                                    className="w-full p-4 border-2 border-white rounded-xl font-black text-2xl text-center outline-none focus:border-blue-500 shadow-sm"
                                />
                                <div className="absolute left-4 top-4 text-xs font-black text-gray-300">TRY</div>
                            </div>
                            <div className="text-center px-4">
                                <div className="text-[10px] font-bold text-gray-400 mb-1">المعادلة</div>
                                <div className="font-black text-lg text-gray-700">1 $</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="bg-gray-900 text-white p-8 rounded-[2rem] shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[200px]">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-3xl -translate-x-10 -translate-y-10"></div>
                        <h4 className="text-sm font-bold text-primary mb-4 flex items-center gap-2"><Info size={16}/> ملحوظة محاسبية</h4>
                        <p className="text-xs text-gray-400 leading-loose">
                            يتم استخدام أسعار الصرف هذه في واجهة الفواتير والتقارير المالية عند اختيار عملة غير الدولار. 
                            <br/><br/>
                            <span className="text-white font-bold">تنبيه:</span> تحديث السعر هنا لا يؤثر على الفواتير القديمة المسجلة مسبقاً، بل ينطبق على الحركات الجديدة فقط.
                        </p>
                    </div>

                    <div className="p-4 bg-yellow-50 border-2 border-yellow-100 rounded-2xl flex items-center gap-4 text-yellow-800">
                        <div className="bg-yellow-200 p-2 rounded-xl"><DollarSign size={24}/></div>
                        <div className="text-xs leading-relaxed font-bold">
                            العملة الأساسية للنظام هي الدولار ($)، كافة العمليات يتم تقييمها محاسبياً بناءً على سعر الصرف المسجل لحظة العملية.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CurrencySettings;
