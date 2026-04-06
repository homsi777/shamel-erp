
import React from 'react';

export interface ReportSummaryItem {
  title: string;
  value: string | number;
  color?: string;
  subValue?: string;
  suffix?: string;
}

export interface ReportData {
  title: string;
  subtitle?: string;
  summary: ReportSummaryItem[];
  tableHeaders: string[];
  tableRows: (string | number)[][];
  extraInfo?: React.ReactNode;
  raw?: any;
  meta?: Record<string, any>;
}

export interface ReportFilterState {
  dateFrom: string;
  dateTo: string;
  datePreset?: 'last30days' | 'all';
  selectedBranchId: string;
  selectedWarehouseId: string;
  selectedEntityId: string;
  selectedPartyId: string;
  selectedItemId: string;
  selectedCategoryId: string;
  selectedUserId: string;
  selectedDelegateId: string;
  selectedCashboxId: string;
  selectedAccountId: string;
  selectedCurrency?: string;
  reportStatus?: string;
  invoiceType?: 'all' | 'sale' | 'purchase';
  inventoryMode?: 'item_movement' | 'stock_by_warehouse';
  movementType?: 'all' | 'in' | 'out';
  topN?: number;
  containerSearchQuery: string;
  reportSearchQuery: string;
  reconciliationType: 'fund' | 'client';
  actualValueInput: string;
  filterModel: string;
  filterOrigin: string;
  filterColor: string;
  filterManufacturer: string;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'all';
}
