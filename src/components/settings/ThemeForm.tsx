import React from 'react';
import { Palette, Sparkles, RotateCcw, Eye } from 'lucide-react';
import { AppSettings } from '../../types';

interface Props {
    settings: AppSettings;
    updateTheme: (field: string, value: string) => void;
}

const presets = [
    {
        id: 'emerald',
        name: 'زمردي أنيق',
        primaryColor: '#0f766e',
        secondaryColor: '#f59e0b',
        backgroundColor: '#f3f4f6',
        textColor: '#0f172a',
        inputBgColor: '#ffffff',
        sidebarBgColor: '#ffffff'
    },
    {
        id: 'navy',
        name: 'كحلي احترافي',
        primaryColor: '#0b3b5b',
        secondaryColor: '#f97316',
        backgroundColor: '#f5f7fb',
        textColor: '#0b1320',
        inputBgColor: '#ffffff',
        sidebarBgColor: '#ffffff'
    },
    {
        id: 'royal',
        name: 'ملكي عصري',
        primaryColor: '#1d4ed8',
        secondaryColor: '#f43f5e',
        backgroundColor: '#f8fafc',
        textColor: '#111827',
        inputBgColor: '#ffffff',
        sidebarBgColor: '#f8fafc'
    },
    {
        id: 'forest',
        name: 'غابة هادئة',
        primaryColor: '#14532d',
        secondaryColor: '#eab308',
        backgroundColor: '#f7f7f0',
        textColor: '#1f2937',
        inputBgColor: '#ffffff',
        sidebarBgColor: '#ffffff'
    },
    {
        id: 'sand',
        name: 'رملي دافئ',
        primaryColor: '#9a3412',
        secondaryColor: '#0f766e',
        backgroundColor: '#faf7f2',
        textColor: '#3f2a1d',
        inputBgColor: '#ffffff',
        sidebarBgColor: '#ffffff'
    }
];

const DEFAULTS = presets[0];

const ThemeForm: React.FC<Props> = ({ settings, updateTheme }) => {
    const applyPreset = (preset: typeof presets[number]) => {
        updateTheme('primaryColor', preset.primaryColor);
        updateTheme('secondaryColor', preset.secondaryColor);
        updateTheme('backgroundColor', preset.backgroundColor);
        updateTheme('textColor', preset.textColor);
        updateTheme('inputBgColor', preset.inputBgColor);
        updateTheme('sidebarBgColor', preset.sidebarBgColor);
    };

    const resetDefaults = () => applyPreset(DEFAULTS);

    const theme = {
        ...DEFAULTS,
        ...(settings.theme || {})
    };

    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn space-y-8">
            <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                    <Palette className="text-primary" /> تخصيص المظهر والألوان
                </h3>
                <div className="flex gap-2">
                    <button onClick={resetDefaults} className="px-3 py-2 text-xs font-black bg-gray-100 rounded-xl hover:bg-gray-200 transition flex items-center gap-1">
                        <RotateCcw size={14} /> استرجاع الافتراضي
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-gray-700 font-black text-sm">
                    <Sparkles size={16} className="text-primary" /> باقات ألوان جاهزة
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {presets.map(p => (
                        <button
                            key={p.id}
                            onClick={() => applyPreset(p)}
                            className="border rounded-2xl p-3 text-right hover:shadow-md transition flex items-center justify-between"
                        >
                            <div>
                                <div className="text-sm font-black text-gray-800">{p.name}</div>
                                <div className="text-xs text-gray-400">{p.primaryColor} • {p.secondaryColor}</div>
                            </div>
                            <div className="flex gap-1">
                                <span className="w-5 h-5 rounded-full" style={{ background: p.primaryColor }} />
                                <span className="w-5 h-5 rounded-full" style={{ background: p.secondaryColor }} />
                                <span className="w-5 h-5 rounded-full" style={{ background: p.backgroundColor, border: '1px solid #e5e7eb' }} />
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="block font-black text-gray-700 mb-3">اللون الأساسي</label>
                    <input type="color" value={theme.primaryColor} onChange={e => updateTheme('primaryColor', e.target.value)} className="w-16 h-16 rounded cursor-pointer" />
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="block font-black text-gray-700 mb-3">اللون الثانوي</label>
                    <input type="color" value={theme.secondaryColor || '#f59e0b'} onChange={e => updateTheme('secondaryColor', e.target.value)} className="w-16 h-16 rounded cursor-pointer" />
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="block font-black text-gray-700 mb-3">لون الخلفية</label>
                    <input type="color" value={theme.backgroundColor} onChange={e => updateTheme('backgroundColor', e.target.value)} className="w-16 h-16 rounded cursor-pointer" />
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="block font-black text-gray-700 mb-3">لون النص</label>
                    <input type="color" value={theme.textColor || '#111827'} onChange={e => updateTheme('textColor', e.target.value)} className="w-16 h-16 rounded cursor-pointer" />
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="block font-black text-gray-700 mb-3">خلفية الحقول</label>
                    <input type="color" value={theme.inputBgColor || '#ffffff'} onChange={e => updateTheme('inputBgColor', e.target.value)} className="w-16 h-16 rounded cursor-pointer" />
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <label className="block font-black text-gray-700 mb-3">خلفية الشريط الجانبي</label>
                    <input type="color" value={theme.sidebarBgColor || '#ffffff'} onChange={e => updateTheme('sidebarBgColor', e.target.value)} className="w-16 h-16 rounded cursor-pointer" />
                </div>
            </div>

            <div className="border-t pt-6">
                <div className="flex items-center gap-2 text-gray-700 font-black text-sm mb-4">
                    <Eye size={16} className="text-primary" /> معاينة فورية
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="rounded-2xl p-4 border" style={{ background: theme.sidebarBgColor || '#ffffff' }}>
                        <div className="text-xs text-gray-500">القائمة الجانبية</div>
                        <div className="mt-3 space-y-2">
                            <div className="h-3 rounded" style={{ background: theme.primaryColor }} />
                            <div className="h-3 rounded bg-gray-200" />
                            <div className="h-3 rounded bg-gray-200" />
                        </div>
                    </div>
                    <div className="rounded-2xl p-4 border" style={{ background: theme.backgroundColor }}>
                        <div className="text-xs text-gray-500">الخلفية العامة</div>
                        <div className="mt-4 p-4 rounded-xl" style={{ background: theme.inputBgColor || '#ffffff', color: theme.textColor || '#111827' }}>
                            نموذج إدخال
                        </div>
                    </div>
                    <div className="rounded-2xl p-4 border" style={{ background: '#ffffff' }}>
                        <div className="text-xs text-gray-500">زر رئيسي وثانوي</div>
                        <div className="mt-3 flex gap-2">
                            <button className="px-4 py-2 rounded-xl text-white text-sm font-black" style={{ background: theme.primaryColor }}>زر أساسي</button>
                            <button className="px-4 py-2 rounded-xl text-white text-sm font-black" style={{ background: theme.secondaryColor || '#f59e0b' }}>زر ثانوي</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ThemeForm;
