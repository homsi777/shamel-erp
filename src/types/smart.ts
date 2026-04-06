/**
 * Smart Card / Global Drawer System Types
 * نظام البطاقة الذكية - أنواع البيانات
 */

/** أنواع الكيانات المدعومة */
export type SmartEntityType =
  | 'ledgerRow'
  | 'invoice'
  | 'party'
  | 'product'
  | 'voucher'
  | 'cashBox'
  | 'deliveryNotice'
  | 'expense'
  | 'employee'
  | 'salaryTransaction'
  | 'partner';

/** بيانات فتح Drawer */
export interface SmartOpenPayload {
  type: SmartEntityType;
  id: string;
  meta?: Record<string, any>; // currency, partyId, rowId...
}

/** Badge للعرض */
export interface SmartBadge {
  label: string;
  value: string;
  kind: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
}

/** حقل بسيط */
export interface SmartField {
  label: string;
  value: string | number | null;
  type?: 'text' | 'number' | 'currency' | 'date' | 'badge';
  badge?: SmartBadge;
}

/** عمود جدول */
export interface SmartTableColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'currency';
}

/** جدول بيانات داخل قسم */
export interface SmartTable {
  columns: SmartTableColumn[];
  data: Record<string, string | number | null>[];
  summary?: { label: string; value: string | number }[];
}

/** قسم من الأقسام */
export interface SmartSection {
  title: string;
  rows: SmartField[];
  collapsed?: boolean;
  table?: SmartTable;
}

/** العمليات المتاحة */
export interface SmartActions {
  canOpen: boolean;
  canEdit: boolean;
  canExport: boolean;
  canPrint: boolean;
  canDelete?: boolean;
  disabledReason?: {
    edit?: string;
    delete?: string;
  };
}

/** استجابة QuickView API */
export interface SmartQuickViewResponse {
  type: SmartEntityType;
  id: string;
  title: string;
  subtitle?: string;
  badges: SmartBadge[];
  fields: SmartField[];
  sections: SmartSection[];
  actions: SmartActions;
  /** بيانات إضافية للتصدير */
  exportMeta?: Record<string, any>;
}

/** حالة Drawer */
export interface SmartDrawerState {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  payload: SmartOpenPayload | null;
  data: SmartQuickViewResponse | null;
}

/** Context API */
export interface SmartDrawerContextValue {
  state: SmartDrawerState;
  open: (payload: SmartOpenPayload) => void;
  close: () => void;
  retry: () => void;
}

/** ترجمات الأنواع للعرض */
export const SMART_TYPE_LABELS: Record<SmartEntityType, string> = {
  ledgerRow: 'سطر كشف حساب',
  invoice: 'فاتورة',
  party: 'عميل/مورد',
  product: 'مادة',
  voucher: 'سند',
  cashBox: 'صندوق',
  deliveryNotice: 'إشعار تسليم',
  expense: 'مصروف',
  employee: 'موظف',
  salaryTransaction: 'معاملة راتب',
  partner: 'شريك',
};

/** أيقونات الأنواع */
export const SMART_TYPE_ICONS: Record<SmartEntityType, string> = {
  ledgerRow: 'FileText',
  invoice: 'FileDigit',
  party: 'Users',
  product: 'Package',
  voucher: 'Receipt',
  cashBox: 'Wallet',
  deliveryNotice: 'Truck',
  expense: 'TrendingDown',
  employee: 'UserRound',
  salaryTransaction: 'Banknote',
  partner: 'Handshake',
};
