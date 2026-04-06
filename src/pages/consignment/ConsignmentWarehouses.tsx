import React from 'react';
import { Warehouse } from '../../types';
import { AdaptiveTable } from '../../components/responsive';

interface ConsignmentWarehousesProps {
  warehouses: Warehouse[];
  refreshData: () => Promise<void>;
}

const kindLabels: Record<string, string> = {
  NORMAL: 'عادي',
  CUSTOMER_CONSIGNMENT: 'أمانة عملاء',
  SUPPLIER_CONSIGNMENT: 'أمانة موردين',
};

const ConsignmentWarehouses: React.FC<ConsignmentWarehousesProps> = ({ warehouses }) => {
  const columns = [
    { id: 'name', header: 'المستودع', cell: (r: Warehouse) => <span className="font-bold">{r.name}</span> },
    {
      id: 'kind',
      header: 'نوع المستودع',
      cell: (r: Warehouse) => kindLabels[(r as any).warehouseKind] || (r as any).warehouseKind || 'عادي',
    },
    { id: 'location', header: 'الموقع', cell: (r: Warehouse) => r.location || '—' },
    { id: 'manager', header: 'المسؤول', cell: (r: Warehouse) => r.manager || '—' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-gray-600">
        مستودعات الأمانة تُعرّف من نوع المستودع (أمانة عملاء / أمانة موردين). إعدادات المستودعات من قسم المخزون.
      </p>
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <AdaptiveTable
          rows={warehouses}
          columns={columns}
          keyExtractor={(r) => r.id}
          emptyState={<div className="py-12 text-center text-gray-500">لا توجد مستودعات.</div>}
        />
      </div>
    </div>
  );
};

export default ConsignmentWarehouses;
