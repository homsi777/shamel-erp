
import React, { useState } from 'react';
import { Type, LayoutGrid, FileText, Package, PieChart, Wallet } from 'lucide-react';
import { AppSettings, DEFAULT_LABELS, LabelSettings } from '../../types';

interface Props {
    settings: AppSettings;
    updateLabel: (group: keyof LabelSettings, key: string, value: string) => void;
}

const LabelsEditor: React.FC<Props> = ({ settings, updateLabel }) => {
    const [activeGroup, setActiveGroup] = useState<keyof LabelSettings>('general');
    
    const groups = [
        { id: 'general', label: 'عام', icon: <LayoutGrid size={16}/> },
        { id: 'menu', label: 'القائمة', icon: <LayoutGrid size={16}/> },
        { id: 'invoice', label: 'الفواتير', icon: <FileText size={16}/> },
        { id: 'inventory', label: 'المخزون', icon: <Package size={16}/> },
        { id: 'reports', label: 'التقارير', icon: <FileText size={16}/> },
        { id: 'partners', label: 'الشركاء', icon: <PieChart size={16}/> },
        { id: 'funds', label: 'المالية', icon: <Wallet size={16}/> },
    ];
    
    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn">
            <h3 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2"><Type className="text-primary"/> تغيير مسميات النظام</h3>
            
            <div className="flex gap-2 mb-8 border-b pb-1 overflow-x-auto custom-scrollbar whitespace-nowrap">
                {groups.map(g => (
                    <button 
                        key={g.id} 
                        onClick={() => setActiveGroup(g.id as any)} 
                        className={`px-6 py-3 rounded-t-xl font-bold transition flex items-center gap-2 ${activeGroup === g.id ? 'bg-primary/5 text-primary border-b-4 border-primary' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                    >
                        {g.icon}
                        {g.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 animate-fadeIn">
                {Object.entries((settings.labels || DEFAULT_LABELS)[activeGroup] || {}).map(([key, value]) => (
                    <div key={key} className="group">
                        <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase tracking-widest group-hover:text-primary transition-colors">
                            {key.replace(/_/g, ' ')}
                        </label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={value as string} 
                                onChange={e => updateLabel(activeGroup, key, e.target.value)} 
                                className="w-full border-2 border-gray-100 rounded-xl p-3 bg-gray-50 focus:bg-white focus:border-primary focus:ring-0 outline-none transition font-bold text-gray-700 shadow-sm" 
                            />
                            <div className="absolute left-3 top-3 text-gray-200 group-hover:text-primary/20 transition-colors">
                                <Type size={20}/>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-10 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3">
                <div className="bg-blue-100 p-2 rounded-lg text-blue-600 shrink-0">
                    <LayoutGrid size={20}/>
                </div>
                <div>
                    <h4 className="font-bold text-blue-900 text-sm">نصيحة تقنية</h4>
                    <p className="text-blue-700 text-xs mt-1 leading-relaxed">
                        تغيير المسميات هنا سيؤثر على القوائم، العناوين، والتقارير في كامل النظام. استخدم مسميات واضحة تتناسب مع طبيعة عملك (مثلاً: تغيير "العميل" إلى "المشتري" أو "المورد" إلى "المصنع").
                    </p>
                </div>
            </div>
        </div>
    );
};
export default LabelsEditor;
