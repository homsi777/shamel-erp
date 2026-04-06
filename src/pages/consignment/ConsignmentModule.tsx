import React, { useState } from 'react';
import ConsignmentSidebar, { ConsignmentTabId } from '../../components/consignment/ConsignmentSidebar';
import ConsignmentCustomers from './ConsignmentCustomers.tsx';
import ConsignmentSuppliers from './ConsignmentSuppliers.tsx';
import ConsignmentSettlements from './ConsignmentSettlements.tsx';
import ConsignmentWarehouses from './ConsignmentWarehouses.tsx';
import ConsignmentReports from './ConsignmentReports.tsx';
import ConsignmentSettingsPage from './ConsignmentSettingsPage.tsx';
import { Client, Warehouse, InventoryItem } from '../../types';

interface ConsignmentModuleProps {
  clients: Client[];
  warehouses: Warehouse[];
  items: InventoryItem[];
  refreshData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
}

const ConsignmentModule: React.FC<ConsignmentModuleProps> = ({
  clients,
  warehouses,
  items,
  refreshData,
  setActiveTab,
}) => {
  const [activeTab, setActiveTabLocal] = useState<ConsignmentTabId>('customers');
  const [settlementDocId, setSettlementDocId] = useState<string | undefined>(undefined);
  const [preselectedSettlementId, setPreselectedSettlementId] = useState<string | undefined>(undefined);
  // drilldown from reports → open specific doc
  const [drillDocId, setDrillDocId] = useState<string | undefined>(undefined);
  const [drillDirection, setDrillDirection] = useState<'OUT_CUSTOMER' | 'IN_SUPPLIER' | undefined>(undefined);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('shamel_consignment_drill');
      if (!raw) return;
      const payload = JSON.parse(raw);
      const tab = payload?.tab === 'settlements' ? 'settlements' : (payload?.tab === 'suppliers' ? 'suppliers' : 'customers');
      const id = String(payload?.id || '').trim();
      localStorage.removeItem('shamel_consignment_drill');
      if (!id) return;
      if (tab === 'settlements') {
        setPreselectedSettlementId(id);
        setActiveTabLocal('settlements');
      } else {
        setDrillDocId(id);
        setDrillDirection(tab === 'suppliers' ? 'IN_SUPPLIER' : 'OUT_CUSTOMER');
        setActiveTabLocal(tab === 'suppliers' ? 'suppliers' : 'customers');
      }
    } catch {}
  }, []);

  const clearDrill = () => { setDrillDocId(undefined); setDrillDirection(undefined); };

  const commonProps = {
    clients,
    warehouses,
    items,
    refreshData,
    setActiveTab,
    setConsignmentTab: setActiveTabLocal,
    openSettlementsForDoc: (docId: string) => {
      setSettlementDocId(docId);
      setActiveTabLocal('settlements');
    },
  };

  const handleReportOpenDoc = (docId: string, dir: 'OUT_CUSTOMER' | 'IN_SUPPLIER') => {
    setDrillDocId(docId);
    setDrillDirection(dir);
    setActiveTabLocal(dir === 'IN_SUPPLIER' ? 'suppliers' : 'customers');
  };

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto pb-20" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
          بضاعة برسم الأمانة
        </h1>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <ConsignmentSidebar activeTab={activeTab} setActiveTab={setActiveTabLocal} />

        <div className="col-span-12 lg:col-span-10 min-h-[400px]">
          {activeTab === 'customers' && (
            <ConsignmentCustomers
              {...commonProps}
              direction="OUT_CUSTOMER"
              openViewDocId={drillDirection === 'OUT_CUSTOMER' ? drillDocId : undefined}
              onDrillConsumed={clearDrill}
            />
          )}
          {activeTab === 'suppliers' && (
            <ConsignmentSuppliers
              {...commonProps}
              openViewDocId={drillDirection === 'IN_SUPPLIER' ? drillDocId : undefined}
              onDrillConsumed={clearDrill}
            />
          )}
          {activeTab === 'settlements' && (
            <ConsignmentSettlements
              {...commonProps}
              preselectedDocId={settlementDocId}
              clearPreselectedDocId={() => setSettlementDocId(undefined)}
              preselectedSettlementId={preselectedSettlementId}
              clearPreselectedSettlementId={() => setPreselectedSettlementId(undefined)}
            />
          )}
          {activeTab === 'warehouses' && (
            <ConsignmentWarehouses warehouses={warehouses} refreshData={refreshData} />
          )}
          {activeTab === 'reports' && (
            <ConsignmentReports
              clients={clients}
              warehouses={warehouses}
              setActiveTab={setActiveTab}
              onOpenDoc={handleReportOpenDoc}
            />
          )}
          {activeTab === 'settings' && (
            <ConsignmentSettingsPage refreshData={refreshData} />
          )}
        </div>
      </div>
    </div>
  );
};

export default ConsignmentModule;
