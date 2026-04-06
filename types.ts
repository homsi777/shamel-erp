
export interface FabricItem {
  id: string;
  warehouseId?: string; // New: Link item to a warehouse
  warehouseName?: string; // New: Cache name for display
  name: string;
  code: string;
  color: string;
  type: string;
  rollsCount: number; // Number of "Tobe"
  metersPerRoll: number;
  costPrice: number; // Purchase Price (Weighted Average Cost - متوسط التكلفة المرجح)
  pricePerMeter: number; // Sale Price 1 (Retail - المفرق)
  wholesalePrice?: number; // Sale Price 2 (Wholesale - الجملة)
  lastUpdated: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  type: 'customer' | 'supplier'; // عميل أو مورد
  address?: string;
  balance: number; // الرصيد (له أو عليه)
}

export interface InvoiceItem {
  fabricId: string;
  fabricName: string;
  rollsSold: number;
  metersSold: number;
  yardsSold: number;
  priceAtSale: number; // Unit Price
  total: number; // Line Total
  costAtSale?: number; // Snapshot of cost price at the moment of sale (for profit calc)
  isReturn?: boolean; // New: Marks this specific item as being returned in an exchange
}

export type InvoiceStatus = 'draft' | 'posted' | 'void'; // مسودة، مرحلة، ملغاة

export interface Invoice {
  id: string;
  invoiceNumber: string; // المتسلسل البشري (مثال: INV-2024-001)
  originalInvoiceNumber?: string; // رقم الفاتورة الأصلية (من المصنع/المورد)
  type: 'sale' | 'purchase' | 'return' | 'exchange'; // أنواع الفواتير المحدثة
  status: InvoiceStatus; // حالة الفاتورة
  paymentType: 'cash' | 'credit'; // نقدي أو آجل
  clientId: string;
  clientName: string; 
  date: string;
  items: InvoiceItem[];
  totalAmount: number; // قيمة الفاتورة الحالية (شاملة المصاريف إن وجدت)
  paidAmount: number; // المدفوع
  remainingAmount: number; // المتبقي
  targetWarehouseId?: string; // للمشتريات: المستودع الذي دخلت إليه البضاعة
  targetWarehouseName?: string;
  additionalCosts?: {
    customs: number;    // تخليص جمركي
    shipping: number;   // أجور شحن (دولي/خارجي)
    transport: number;  // أجور نقل (داخلي)
    labor: number;      // أجور عمال (تحميل/تنزيل)
    others: number;     // مصاريف أخرى
  };
  notes?: string; // ملاحظات (مثل سبب الإرجاع)
  createdAt: string; // Timestamp for DB
}

export interface StockAudit {
  id: string;
  date: string;
  fabricId: string;
  fabricName: string;
  systemRolls: number;
  actualRolls: number;
  difference: number;
  notes: string;
}

// --- NEW TYPES FOR FUNDS ---
export interface CashBox {
  id: string;
  name: string;
  type: 'main' | 'sub'; // رئيسي أو فرعي
  balance: number;
  currency: string;
}

export interface Voucher {
  id: string;
  type: 'receipt' | 'payment'; // قبض أو دفع
  date: string;
  amount: number;
  cashBoxId: string;
  cashBoxName: string;
  clientId?: string; // اختياري: ربط السند بعميل/مورد
  clientName?: string;
  category: string; // تصنيف (كهرباء، دفعة، نقل...)
  description: string;
  referenceNumber?: string; // رقم إيصال ورقي
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
  manager: string;
}

// --- NEW TYPES FOR PARTNERS ---
export interface Partner {
  id: string;
  name: string;
  type: 'capital' | 'operational' | 'mixed';
  percentage: number; // Profit/Loss Share %
  capitalAmount: number; // رأس المال المدفوع
  currentBalance: number; // الحساب الجاري (أرباح مرحلة - مسحوبات)
  joinDate: string;
  status: 'active' | 'inactive';
  linkedClientId?: string; // Link to Client/Supplier Account (Optional)
}

export interface PartnerTransaction {
  id: string;
  partnerId: string;
  partnerName: string;
  type: 'capital_injection' | 'capital_withdrawal' | 'profit_distribution' | 'profit_withdrawal';
  amount: number;
  date: string;
  description: string;
  relatedVoucherId?: string; // If it involved cash movement
}

// --- NEW TYPES FOR SETTINGS & USERS ---

export type UserRole = 'admin' | 'manager' | 'accountant' | 'warehouse_keeper';

export interface AppUser {
  id: string;
  username: string;
  role: UserRole;
  permissions: string[]; 
}

// Define Granular Permissions
export const PERMISSIONS = {
  // Inventory
  VIEW_INVENTORY: 'view_inventory',
  MANAGE_INVENTORY: 'manage_inventory', // Add/Edit/Delete Items
  VIEW_COST_PRICE: 'view_cost_price', // Sensitive
  
  // Sales & Operations
  CREATE_SALE_INVOICE: 'create_sale_invoice',
  CREATE_PURCHASE_INVOICE: 'create_purchase_invoice',
  MANAGE_CLIENTS: 'manage_clients',
  
  // Finance
  VIEW_FUNDS: 'view_funds',
  MANAGE_VOUCHERS: 'manage_vouchers', // Receipts/Payments
  VIEW_PROFITS: 'view_profits', // Sensitive
  MANAGE_PARTNERS: 'manage_partners',
  
  // Admin
  MANAGE_USERS: 'manage_users',
  MANAGE_SETTINGS: 'manage_settings',
  VIEW_REPORTS: 'view_reports',
};

// Default Roles Configuration
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: Object.values(PERMISSIONS), // All permissions
  manager: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.VIEW_COST_PRICE,
    PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.CREATE_PURCHASE_INVOICE, PERMISSIONS.MANAGE_CLIENTS,
    PERMISSIONS.VIEW_FUNDS, PERMISSIONS.MANAGE_VOUCHERS, PERMISSIONS.VIEW_REPORTS
  ],
  accountant: [
    PERMISSIONS.VIEW_INVENTORY, 
    PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.CREATE_PURCHASE_INVOICE, PERMISSIONS.MANAGE_CLIENTS,
    PERMISSIONS.VIEW_FUNDS, PERMISSIONS.MANAGE_VOUCHERS, PERMISSIONS.VIEW_PROFITS, PERMISSIONS.VIEW_REPORTS
  ],
  warehouse_keeper: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY,
    // Note: No Cost Price, No Funds, No Profits
  ]
};

export interface CompanyInfo {
  name: string;
  address: string;
  email: string;
  phone1: string;
  phone2: string;
  logo?: string; // Base64 Image string
}

export interface ThemeSettings {
  primaryColor: string; // Main Brand Color (Sidebar, Buttons)
  secondaryColor: string; // Accent Color
  backgroundColor: string; // App Background
  textColor: string; // Main Text Color
  inputBgColor: string; // Input Fields Background
  sidebarBgColor: string; // Sidebar Background
}

// --- ADVANCED PRINT SETTINGS ---
export type PaperSize = '80mm' | '58mm' | 'A4' | 'A5';

export interface PrintProfile {
  id: string; // e.g., 'invoice_cashier', 'report_standard'
  name: string; // e.g., 'فاتورة مبيع (كاشير)'
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  headerTitle: string;
  headerSubtitle: string;
  footerText: string;
  showLogo: boolean;
  showPhone: boolean;
  showAddress: boolean;
  showQrCode: boolean; // For Invoices
  showTaxNumber: boolean;
  fontSize: 'sm' | 'md' | 'lg';
}

export interface PrintSettings {
  profiles: {
    sale_invoice: PrintProfile;
    purchase_invoice: PrintProfile;
    vouchers: PrintProfile;
    reports: PrintProfile;
  };
  defaultPrinter?: string;
  autoPrint: boolean;
}

export interface AppSettings {
  company: CompanyInfo;
  theme: ThemeSettings;
  print: PrintSettings;
  lowStockThreshold: number;
}

// --- BACKUP LOGS ---
export interface BackupLog {
  id: string;
  date: string;
  fileName: string;
  stats: {
    itemsCount: number;
    invoicesCount: number;
    clientsCount: number;
  };
  size: string;
  note: string;
}

export const METER_TO_YARD = 1.09361;
export const USD_TO_SYP = 15000; // Exchange rate: 1 USD = 15000 SYP

export const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
