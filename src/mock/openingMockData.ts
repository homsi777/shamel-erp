export const MOCK_ITEMS = [
  { id: 1, code: 'ITM-001', name: 'صنف أ', unit: 'كيلوغرام', barcode: '1234567890' },
  { id: 2, code: 'ITM-002', name: 'صنف ب', unit: 'قطعة', barcode: '0987654321' },
  { id: 3, code: 'ITM-003', name: 'صنف ج', unit: 'متر', barcode: '1122334455' },
  { id: 4, code: 'ITM-004', name: 'صنف د', unit: 'لتر', barcode: '5566778899' },
  { id: 5, code: 'ITM-005', name: 'صنف هـ', unit: 'صندوق', barcode: '9988776655' }
];

export const MOCK_WAREHOUSES = [
  { id: 1, name: 'المخزن الرئيسي' },
  { id: 2, name: 'مخزن الفرع الأول' },
  { id: 3, name: 'مخزن الفرع الثاني' }
];

export const MOCK_CUSTOMERS = [
  { id: 1, type: 'customer', name: 'شركة النور للتجارة' },
  { id: 2, type: 'customer', name: 'مؤسسة السلام' },
  { id: 3, type: 'customer', name: 'شركة الأمل' }
];

export const MOCK_SUPPLIERS = [
  { id: 4, type: 'supplier', name: 'مورد الخامات الأول' },
  { id: 5, type: 'supplier', name: 'شركة التوريدات العامة' }
];

export const MOCK_CASH_BOXES = [
  { id: 1, name: 'الصندوق الرئيسي', currency: 'USD' },
  { id: 2, name: 'صندوق الليرة السورية', currency: 'SYP' },
  { id: 3, name: 'صندوق الليرة التركية', currency: 'TRY' }
];

export const MOCK_ACCOUNTS = [
  { id: 10, name: 'رأس المال', code: '301' },
  { id: 11, name: 'الأصول الثابتة', code: '121' },
  { id: 12, name: 'قرض بنكي', code: '201' }
];
