import React from 'react';
import {
  Users,
  Truck,
  FileCheck,
  Warehouse,
  BarChart3,
  Settings,
} from 'lucide-react';

export const CONSIGNMENT_TABS = [
  { id: 'customers', label: 'أمانة العملاء', icon: <Users size={20} /> },
  { id: 'suppliers', label: 'أمانة الموردين', icon: <Truck size={20} /> },
  { id: 'settlements', label: 'تسويات الأمانة', icon: <FileCheck size={20} /> },
  { id: 'warehouses', label: 'مستودعات الأمانة', icon: <Warehouse size={20} /> },
  { id: 'reports', label: 'تقارير الأمانة', icon: <BarChart3 size={20} /> },
  { id: 'settings', label: 'إعدادات الأمانة', icon: <Settings size={20} /> },
] as const;

export type ConsignmentTabId = (typeof CONSIGNMENT_TABS)[number]['id'];

interface ConsignmentSidebarProps {
  activeTab: ConsignmentTabId;
  setActiveTab: (tab: ConsignmentTabId) => void;
}

const ConsignmentSidebar: React.FC<ConsignmentSidebarProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="col-span-12 lg:col-span-2 space-y-1" dir="rtl">
      {CONSIGNMENT_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-right ${
            activeTab === tab.id
              ? 'bg-white shadow-lg border-r-4 border-teal-600 text-teal-700'
              : 'bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

export default ConsignmentSidebar;
