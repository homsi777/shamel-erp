import React from 'react';
import { Activity, Building, Cloud, Coins, Database, DollarSign, FileText, Network, Package, Palette, Printer, Server, Type, User } from 'lucide-react';
import { isSyncedMode } from '../../lib/appMode';

interface Props {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  allowedTabs?: Set<string>;
}

const SettingsSidebar: React.FC<Props> = ({ activeTab, setActiveTab, allowedTabs }) => {
  const isSynced = isSyncedMode();

  const tabs = [
    { id: 'company', label: 'هوية الشركة', icon: <Building size={20} /> },
    { id: 'labels', label: 'تسميات النظام', icon: <Type size={20} /> },
    { id: 'currency', label: 'أسعار الصرف', icon: <Coins size={20} className="text-amber-600" /> },
    { id: 'pricing_settings', label: 'إعدادات التسعير', icon: <DollarSign size={20} className="text-emerald-600" /> },
    { id: 'invoice_settings', label: 'إعدادات الفواتير', icon: <FileText size={20} className="text-blue-600" /> },
    { id: 'item_settings', label: 'إعدادات المواد', icon: <Package size={20} className="text-purple-600" /> },
    { id: 'printing_invoices', label: 'الطباعة والفواتير', icon: <Printer size={20} /> },
    { id: 'deployment', label: 'نمط التشغيل', icon: <Server size={20} className="text-teal-600" /> },
    { id: 'devices', label: 'الأجهزة والاتصال', icon: <Network size={20} /> },
    { id: 'theme', label: 'المظهر والألوان', icon: <Palette size={20} /> },
    { id: 'users', label: 'المستخدمون والأمان', icon: <User size={20} /> },
    { id: 'dbstatus', label: 'حالة قاعدة البيانات', icon: <Database size={20} className="text-blue-600" /> },
    { id: 'backups', label: 'النسخ الاحتياطي', icon: <Database size={20} className="text-emerald-600" /> },
  ];

  if (isSynced) {
    tabs.push({ id: 'sync', label: 'سجل المزامنة', icon: <Activity size={20} /> });
    tabs.push({ id: 'cloud_link', label: 'الربط السحابي', icon: <Cloud size={20} className="text-blue-500" /> });
  }

  const visibleTabs = allowedTabs && allowedTabs.size > 0
    ? tabs.filter((tab) => allowedTabs.has(tab.id))
    : tabs;

  return (
    <div className="col-span-12 lg:col-span-2">
      <div className="custom-scrollbar -mx-1 flex gap-2 overflow-x-auto pb-2 lg:mx-0 lg:block lg:space-y-3 lg:overflow-visible lg:pb-0">
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          data-settings-tab-id={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`shrink-0 rounded-xl px-4 py-3 font-bold transition-all flex items-center gap-2 whitespace-nowrap lg:w-full lg:py-4 lg:gap-3 ${
            activeTab === tab.id ? 'border border-primary/30 bg-white text-primary shadow-sm lg:translate-x-1 lg:border-r-4 lg:border lg:border-primary/30 lg:shadow-lg' : 'border border-transparent bg-transparent text-gray-500 hover:bg-gray-100'
          }`}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
      </div>
    </div>
  );
};

export default SettingsSidebar;
