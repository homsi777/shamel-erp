import React from 'react';
import ConsignmentCustomers from './ConsignmentCustomers';
import { Client, Warehouse, InventoryItem } from '../../types';

interface ConsignmentSuppliersProps {
  clients: Client[];
  warehouses: Warehouse[];
  items: InventoryItem[];
  refreshData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
  setConsignmentTab?: (tab: 'customers' | 'suppliers' | 'settlements' | 'warehouses' | 'reports' | 'settings') => void;
  openSettlementsForDoc?: (documentId: string) => void;
  openViewDocId?: string;
  onDrillConsumed?: () => void;
}

const ConsignmentSuppliers: React.FC<ConsignmentSuppliersProps> = (props) => (
  <ConsignmentCustomers {...props} direction="IN_SUPPLIER" />
);

export default ConsignmentSuppliers;
