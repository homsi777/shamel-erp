
import React from 'react';
import { Building } from 'lucide-react';
import { AppSettings } from '../../types';

interface Props {
    settings: AppSettings;
    updateCompany: (field: string, value: string) => void;
}

const CompanyForm: React.FC<Props> = ({ settings, updateCompany }) => {
    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn">
            <h3 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2"><Building className="text-primary"/> البيانات الأساسية للمنشأة</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-gray-600 mb-2">اسم الشركة / المؤسسة</label>
                    <input type="text" value={settings.company.name} onChange={e => updateCompany('name', e.target.value)} className="w-full pr-10 pl-4 py-3 border rounded-xl font-bold text-lg" />
                </div>
                <div><label className="block text-sm font-bold text-gray-600 mb-2">العنوان</label><input type="text" value={settings.company.address} onChange={e => updateCompany('address', e.target.value)} className="w-full pr-10 pl-4 py-3 border rounded-xl" /></div>
                <div><label className="block text-sm font-bold text-gray-600 mb-2">البريد الإلكتروني</label><input type="email" value={settings.company.email} onChange={e => updateCompany('email', e.target.value)} className="w-full pr-10 pl-4 py-3 border rounded-xl" /></div>
                <div><label className="block text-sm font-bold text-gray-600 mb-2">رقم الهاتف 1</label><input type="text" value={settings.company.phone1} onChange={e => updateCompany('phone1', e.target.value)} className="w-full pr-10 pl-4 py-3 border rounded-xl" /></div>
                <div><label className="block text-sm font-bold text-gray-600 mb-2">رقم الهاتف 2</label><input type="text" value={settings.company.phone2} onChange={e => updateCompany('phone2', e.target.value)} className="w-full pr-10 pl-4 py-3 border rounded-xl" /></div>
                <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-gray-600 mb-2">شعار الشركة (رابط صورة)</label>
                    <input type="text" value={settings.company.logo || ''} onChange={e => updateCompany('logo', e.target.value)} className="w-full pr-10 pl-4 py-3 border rounded-xl text-left" dir="ltr" />
                </div>
            </div>
        </div>
    );
};
export default CompanyForm;
