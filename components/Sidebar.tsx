
import React from 'react';
import { LayoutDashboard, Package, ClipboardList, FileText, BarChart3, Users, Landmark, Settings, Handshake } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, toggleSidebar }) => {
  const menuItems = [
    { id: 'dashboard', label: 'الرئيسية', icon: <LayoutDashboard size={20} /> },
    { id: 'inventory', label: 'المخزون', icon: <Package size={20} /> },
    { id: 'invoices', label: 'الفواتير ونقاط البيع', icon: <FileText size={20} /> },
    { id: 'funds', label: 'الصناديق والسندات', icon: <Landmark size={20} /> },
    { id: 'partners', label: 'إدارة الشركاء', icon: <Handshake size={20} /> },
    { id: 'clients', label: 'العملاء والموردين', icon: <Users size={20} /> },
    { id: 'stocktaking', label: 'الجرد السنوي', icon: <ClipboardList size={20} /> },
    { id: 'reports', label: 'التقارير', icon: <BarChart3 size={20} /> },
    { id: 'settings', label: 'الإعدادات العامة', icon: <Settings size={20} /> },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden" 
          onClick={toggleSidebar}
        ></div>
      )}

      {/* Sidebar */}
      <div 
        className={`fixed inset-y-0 right-0 z-30 w-64 shadow-lg transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:inset-0 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ backgroundColor: 'var(--color-sidebar-bg)' }}
      >
        {/* Dynamic Background via Tailwind 'bg-primary' which maps to CSS var */}
        <div className="flex items-center justify-center h-20 border-b bg-primary text-white">
          <h1 className="text-2xl font-bold">نسيج سيستم</h1>
        </div>
        <nav className="mt-5 px-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                if (window.innerWidth < 768) toggleSidebar();
              }}
              className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                activeTab === item.id
                  ? 'bg-primary/10 text-primary border-r-4 border-primary'
                  : 'text-gray-600 hover:bg-gray-100/50 hover:text-gray-900'
              }`}
            >
              <span className="ml-3">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
};

export default Sidebar;
