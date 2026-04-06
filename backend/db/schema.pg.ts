
import { pgTable, text, integer, numeric, date, timestamp, boolean, AnyPgColumn, uniqueIndex, serial } from 'drizzle-orm/pg-core';
// Fix: Verifying sql export from drizzle-orm. Standard for most versions.
import { sql } from 'drizzle-orm';

export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- AUTH: Users ---
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('warehouse_keeper'),
  isActive: boolean('is_active').default(true),
  permissions: text('permissions'),
  companyId: text('company_id'),
  defaultBranchId: text('default_branch_id'),
  branchScope: text('branch_scope').default('restricted'),
  posWarehouseId: text('pos_warehouse_id'),
  posWarehouseName: text('pos_warehouse_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- HR: Employees & Payroll ---
export const employees = pgTable('employees', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  idNumber: text('id_number'),
  birthDate: date('birth_date', { mode: 'string' }),
  address: text('address'),
  maritalStatus: text('marital_status'),
  biometricId: text('biometric_id'),
  position: text('position'),
  baseSalary: numeric('base_salary', { precision: 18, scale: 6, mode: 'number' }).default(0),
  currency: text('currency').default('USD'),
  salaryFrequency: text('salary_frequency').default('monthly'),
  education: text('education'),
  courses: text('courses'),
  notes: text('notes'),
  imageUrl: text('image_url'),
  idFrontUrl: text('id_front_url'),
  idBackUrl: text('id_back_url'),
  experience: text('experience'),
  status: text('status').default('active'),
  joinDate: date('join_date', { mode: 'string' }),
});

export const salaryTransactions = pgTable('salary_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  employeeId: text('employee_id').notNull(),
  employeeName: text('employee_name'),
  amount: numeric('amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  currency: text('currency').default('USD'),
  type: text('type').notNull(),
  period: text('period'),
  cashBoxId: text('cash_box_id'),
  journalEntryId: integer('journal_entry_id'),
  journalEntryNumber: text('journal_entry_number'),
  date: date('date', { mode: 'string' }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- BIOMETRIC: Devices & Attendance ---
export const biometricDevices = pgTable('biometric_devices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  ip: text('ip').notNull(),
  port: integer('port').default(4370),
  location: text('location'),
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const attendanceRecords = pgTable('attendance_records', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  deviceId: text('device_id'),
  deviceIp: text('device_ip'),
  employeeId: text('employee_id'),
  employeeName: text('employee_name'),
  biometricId: text('biometric_id'),
  timestamp: timestamp('timestamp', { withTimezone: true, mode: 'string' }).notNull(),
  eventType: text('event_type'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- PARTIES (Customers & Suppliers) ---
export const parties = pgTable('parties', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  type: text('type').notNull(), // CUSTOMER | SUPPLIER | BOTH
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  taxNo: text('tax_no'),
  balance: numeric('balance', { precision: 18, scale: 6, mode: 'number' }).default(0),
  isActive: boolean('is_active').default(true),
  accountId: integer('account_id').references(() => accounts.id),
  arAccountId: text('ar_account_id'),
  apAccountId: text('ap_account_id'),
  geoLat: numeric('geo_lat', { precision: 18, scale: 6, mode: 'number' }),
  geoLng: numeric('geo_lng', { precision: 18, scale: 6, mode: 'number' }),
  geoLabel: text('geo_label'),
  // Consignment defaults per party
  defaultConsignmentAllowed: boolean('default_consignment_allowed').default(false),
  defaultCommissionProfileId: text('default_commission_profile_id'),
  defaultConsignmentWarehouseId: text('default_consignment_warehouse_id'),
  defaultConsignmentPricingPolicy: text('default_consignment_pricing_policy'),
  // Pricing engine fields
  defaultPricingMode: text('default_pricing_mode').default('retail'), // retail | wholesale | wholesale2 | distribution | delegate | pos | custom
  allowLastPriceOverride: boolean('allow_last_price_override').default(true),
  allowCustomerItemSpecialPrices: boolean('allow_customer_item_special_prices').default(true),
  allowManualPriceEdit: boolean('allow_manual_price_edit').default(true),
  preferredCurrencyForSales: text('preferred_currency_for_sales'),
});

// --- PARTY LEDGER (Customers & Suppliers) ---
export const partyTransactions = pgTable('party_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  partyId: text('party_id').notNull(),
  partyType: text('party_type'),
  kind: text('kind').notNull(),
  refId: text('ref_id'),
  amount: numeric('amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  delta: numeric('delta', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  currency: text('currency'),
  amountBase: numeric('amount_base', { precision: 18, scale: 6, mode: 'number' }),
  deltaBase: numeric('delta_base', { precision: 18, scale: 6, mode: 'number' }),
  amountTransaction: numeric('amount_transaction', { precision: 18, scale: 6, mode: 'number' }),
  deltaTransaction: numeric('delta_transaction', { precision: 18, scale: 6, mode: 'number' }),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6, mode: 'number' }).default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- ACCOUNTS (Chart of Accounts) ---
// Fix: Added missing accounts table to satisfy TABLE_MAP in server.ts and types.ts
export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  companyId: text('company_id'),
  code: text('code').notNull().unique(),
  lookupCode: text('lookup_code'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  parentId: integer('parent_id').references((): AnyPgColumn => accounts.id),
  level: integer('level').notNull().default(1),
  accountType: text('account_type').notNull(), // assets | liabilities | equity | revenue | expenses
  accountNature: text('account_nature').notNull(), // debit | credit
  isParent: boolean('is_parent').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  isSystem: boolean('is_system').notNull().default(false),
  currencyCode: text('currency_code').default('SYP'),
  branchId: text('branch_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const journalEntries = pgTable('journal_entries', {
  id: serial('id').primaryKey(),
  companyId: text('company_id'),
  entryNumber: text('entry_number').notNull().unique(),
  entryDate: date('entry_date', { mode: 'string' }).notNull(),
  description: text('description').notNull(),
  referenceType: text('reference_type').notNull(),
  referenceId: integer('reference_id'),
  totalDebit: numeric('total_debit', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  totalCredit: numeric('total_credit', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  currencyCode: text('currency_code').default('SYP'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6, mode: 'number' }).default(1),
  status: text('status').notNull().default('draft'),
  branchId: text('branch_id'),
  createdBy: integer('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const journalEntryLines = pgTable('journal_entry_lines', {
  id: serial('id').primaryKey(),
  companyId: text('company_id'),
  journalEntryId: integer('journal_entry_id').notNull().references((): AnyPgColumn => journalEntries.id),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => accounts.id),
  debit: numeric('debit', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  credit: numeric('credit', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  currencyCode: text('currency_code').default('SYP'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6, mode: 'number' }).default(1),
  amountInCurrency: numeric('amount_in_currency', { precision: 18, scale: 6, mode: 'number' }),
  description: text('description'),
  partyId: integer('party_id'),
  partnerRefId: text('partner_ref_id'),
  costCenterId: integer('cost_center_id'),
});

export const accountBalances = pgTable('account_balances', {
  id: serial('id').primaryKey(),
  companyId: text('company_id'),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => accounts.id),
  periodKey: text('period_key').notNull(),
  debitTotal: numeric('debit_total', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  creditTotal: numeric('credit_total', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  balance: numeric('balance', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  currencyCode: text('currency_code').default('SYP'),
});

// --- INVENTORY ---
export const items = pgTable('items', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  code: text('code').notNull(),
  groupId: text('group_id'),
  groupName: text('group_name'),
  merged: boolean('merged').default(false),
  inactive: boolean('inactive').default(false),
  mergedIntoItemId: text('merged_into_item_id'),
  barcode: text('barcode'),
  serialNumber: text('serial_number'),
  serialTracking: text('serial_tracking').default('none'),
  unitName: text('unit_name'),
  unitId: text('unit_id'),
  quantity: numeric('quantity', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  costPrice: numeric('cost_price', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  costPriceBase: numeric('cost_price_base', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  salePrice: numeric('sale_price', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  salePriceBase: numeric('sale_price_base', { precision: 18, scale: 6, mode: 'number' }),
  wholesalePrice: numeric('wholesale_price', { precision: 18, scale: 6, mode: 'number' }).default(0),
  wholesalePriceBase: numeric('wholesale_price_base', { precision: 18, scale: 6, mode: 'number' }),
  posPrice: numeric('pos_price', { precision: 18, scale: 6, mode: 'number' }).default(0),
  posPriceBase: numeric('pos_price_base', { precision: 18, scale: 6, mode: 'number' }),
  pricePerMeter: numeric('price_per_meter', { precision: 18, scale: 6, mode: 'number' }).default(0),
  warehouseId: text('warehouse_id'),
  warehouseName: text('warehouse_name'),
  categoryId: text('category_id'),
  subCategoryId: text('sub_category_id'),
  imageUrl: text('image_url'),
  minStockAlert: integer('min_stock_alert').default(5),
  model: text('model'),
  dimensions: text('dimensions'),
  color: text('color'),
  origin: text('origin'),
  manufacturer: text('manufacturer'),
  grossWeight: numeric('gross_weight', { precision: 18, scale: 6, mode: 'number' }),
  netWeight: numeric('net_weight', { precision: 18, scale: 6, mode: 'number' }),
  isScaleItem: boolean('is_scale_item').notNull().default(false),
  scalePluCode: text('scale_plu_code'),
  scaleBarcodePrefix: text('scale_barcode_prefix'),
  scaleBarcodeMode: text('scale_barcode_mode'),
  scaleUnit: text('scale_unit'),
  scalePricePerKg: numeric('scale_price_per_kg', { precision: 18, scale: 6, mode: 'number' }),
  scaleItemCodeLength: integer('scale_item_code_length'),
  scaleValueLength: integer('scale_value_length'),
  scaleDecimals: integer('scale_decimals'),
  wholesaleWholesalePrice: numeric('wholesale_wholesale_price', { precision: 18, scale: 6, mode: 'number' }).default(0),
  wholesaleWholesalePriceBase: numeric('wholesale_wholesale_price_base', { precision: 18, scale: 6, mode: 'number' }),
  distributionPrice: numeric('distribution_price', { precision: 18, scale: 6, mode: 'number' }).default(0),
  distributionPriceBase: numeric('distribution_price_base', { precision: 18, scale: 6, mode: 'number' }),
  delegatePrice: numeric('delegate_price', { precision: 18, scale: 6, mode: 'number' }).default(0),
  delegatePriceBase: numeric('delegate_price_base', { precision: 18, scale: 6, mode: 'number' }),
  itemType: text('item_type').default('STOCK'), // STOCK | SERVICE | NON_STOCK
  priceCurrency: text('price_currency').default('USD'),
  lastPurchasePriceTransaction: numeric('last_purchase_price_transaction', { precision: 18, scale: 6, mode: 'number' }),
  lastPurchaseCurrency: text('last_purchase_currency'),
  lastPurchaseExchangeRate: numeric('last_purchase_exchange_rate', { precision: 18, scale: 6, mode: 'number' }),
  lastPurchaseAt: timestamp('last_purchase_at', { withTimezone: true, mode: 'string' }),
  isTextile: boolean('is_textile').notNull().default(false),
  textileBaseUom: text('textile_base_uom'),
  supportsColorDimension: boolean('supports_color_dimension').notNull().default(false),
  notes: text('notes'),
  lastUpdated: timestamp('last_updated', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const textileColors = pgTable('textile_colors', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  code: text('code'),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const textileStockBalances = pgTable('textile_stock_balances', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  itemId: text('item_id').notNull(),
  colorId: text('color_id').notNull(),
  baseUom: text('base_uom').notNull(),
  rollCount: numeric('roll_count', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  totalLength: numeric('total_length', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => ({
  scopeUnique: uniqueIndex('textile_stock_balances_scope_unique').on(
    table.companyId,
    table.branchId,
    table.warehouseId,
    table.itemId,
    table.colorId,
    table.baseUom,
  ),
}));

export const textileStockMovements = pgTable('textile_stock_movements', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  itemId: text('item_id').notNull(),
  colorId: text('color_id').notNull(),
  baseUom: text('base_uom').notNull(),
  rollDelta: numeric('roll_delta', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  lengthDelta: numeric('length_delta', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  documentType: text('document_type').notNull(),
  documentId: text('document_id').notNull(),
  documentNumber: text('document_number'),
  documentLineId: text('document_line_id'),
  movementType: text('movement_type').notNull(),
  userId: text('user_id'),
  userName: text('user_name'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const itemSerials = pgTable('item_serials', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  itemId: text('item_id').notNull(),
  serialNumber: text('serial_number').notNull(),
  warehouseId: text('warehouse_id'),
  status: text('status').notNull().default('available'),
  purchaseInvoiceId: text('purchase_invoice_id'),
  salesInvoiceId: text('sales_invoice_id'),
  // Consignment linkage / location
  consignmentDocumentId: text('consignment_document_id'),
  consignmentSettlementId: text('consignment_settlement_id'),
  locationType: text('location_type'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => ({
  serialNumberUnique: uniqueIndex('item_serials_serial_number_unique').on(table.serialNumber),
}));

export const itemBarcodes = pgTable('item_barcodes', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  itemId: text('item_id').notNull(),
  barcode: text('barcode').notNull(),
  unitId: text('unit_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => ({
  barcodeUnique: uniqueIndex('item_barcodes_barcode_unique').on(table.barcode),
}));

// --- CUSTOMER-ITEM SPECIAL PRICES ---
export const customerItemPrices = pgTable('customer_item_prices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  customerId: text('customer_id').notNull(),
  itemId: text('item_id').notNull(),
  unitId: text('unit_id'),
  currencyId: text('currency_id'),
  price: numeric('price', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  minQty: numeric('min_qty', { precision: 18, scale: 6, mode: 'number' }),
  isActive: boolean('is_active').default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const promotions = pgTable('promotions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  offerBarcode: text('offer_barcode'),
  description: text('description'),
  discountType: text('discount_type').notNull(),
  discountPercent: numeric('discount_percent', { precision: 18, scale: 6, mode: 'number' }).default(0),
  discountValue: numeric('discount_value', { precision: 18, scale: 6, mode: 'number' }).default(0),
  specialPrice: numeric('special_price', { precision: 18, scale: 6, mode: 'number' }).default(0),
  buyQuantity: numeric('buy_quantity', { precision: 18, scale: 6, mode: 'number' }).default(0),
  getDiscountPercent: numeric('get_discount_percent', { precision: 18, scale: 6, mode: 'number' }).default(0),
  primaryItemId: text('primary_item_id'),
  itemIds: text('item_ids'),
  mainImageUrl: text('main_image_url'),
  extraImageUrls: text('extra_image_urls'),
  displayOrder: integer('display_order').default(0),
  displayDurationSeconds: integer('display_duration_seconds').default(10),
  showOnDisplay: boolean('show_on_display').default(true),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const warehouses = pgTable('warehouses', { 
  id: text('id').primaryKey(), 
  companyId: text('company_id'),
  code: text('code'),
  name: text('name').notNull(), 
  location: text('location'), 
  manager: text('manager'),
  branchId: text('branch_id'),
  isActive: boolean('is_active').default(true),
  warehouseKind: text('warehouse_kind').default('NORMAL'), // NORMAL | CUSTOMER_CONSIGNMENT | SUPPLIER_CONSIGNMENT
  ownerPartyId: text('owner_party_id'),
  ownerPartyType: text('owner_party_type'), // CUSTOMER | SUPPLIER | null
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  userId: text('user_id').notNull(),
  operationType: text('operation_type').notNull(),
  affectedItems: text('affected_items').notNull(),
  oldValues: text('old_values'),
  newValues: text('new_values'),
  meta: text('meta'),
  timestamp: timestamp('timestamp', { withTimezone: true, mode: 'string' }).notNull(),
});

export const systemEvents = pgTable('system_events', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  sourceModule: text('source_module').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  requiresManualReview: boolean('requires_manual_review').notNull().default(false),
  affectedDocumentType: text('affected_document_type'),
  affectedDocumentId: text('affected_document_id'),
  compensationStatus: text('compensation_status'),
  metadata: text('metadata').notNull().default('{}'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const itemGroups = pgTable('item_groups', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const itemGroupItems = pgTable('item_group_items', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  groupId: text('group_id').notNull(),
  itemId: text('item_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- Agents (Mobile Warehouses) ---
export const agents = pgTable('agents', {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    branchId: text('branch_id').notNull(),
    userId: text('user_id'),
    name: text('name').notNull(),
    phone: text('phone'),
    vehicle: text('vehicle'),
    vehicleImage: text('vehicle_image'),
    certificateImage: text('certificate_image'),
    notes: text('notes'),
    isActive: boolean('is_active').default(true),
    commissionRate: numeric('commission_rate', { precision: 18, scale: 6, mode: 'number' }).default(0),
    commissionCurrency: text('commission_currency').default('USD'),
    lastLat: numeric('last_lat', { precision: 18, scale: 6, mode: 'number' }),
    lastLng: numeric('last_lng', { precision: 18, scale: 6, mode: 'number' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  });
  
  export const agentInventory = pgTable('agent_inventory', {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    branchId: text('branch_id').notNull(),
    agentId: text('agent_id').notNull(),
    itemId: text('item_id').notNull(),
    itemName: text('item_name'),
    unitName: text('unit_name'),
    quantity: numeric('quantity', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  }, (table) => ({
    uniqueScope: uniqueIndex('agent_inventory_scope_unique').on(table.companyId, table.branchId, table.agentId, table.itemId),
  }));
  
  export const agentTransfers = pgTable('agent_transfers', {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    branchId: text('branch_id').notNull(),
    agentId: text('agent_id').notNull(),
    agentName: text('agent_name'),
    transferType: text('transfer_type').notNull().default('transfer'),
    status: text('status').notNull().default('posted'),
    warehouseId: text('warehouse_id'),
    warehouseName: text('warehouse_name'),
    createdById: text('created_by_id'),
    createdByName: text('created_by_name'),
    items: text('items'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  });

  export const agentTransferLines = pgTable('agent_transfer_lines', {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    branchId: text('branch_id').notNull(),
    transferId: text('transfer_id').notNull(),
    agentId: text('agent_id').notNull(),
    warehouseId: text('warehouse_id'),
    warehouseName: text('warehouse_name'),
    itemId: text('item_id').notNull(),
    itemName: text('item_name'),
    unitName: text('unit_name'),
    quantity: numeric('quantity', { precision: 18, scale: 6, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  });

  export const agentInventoryMovements = pgTable('agent_inventory_movements', {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    branchId: text('branch_id').notNull(),
    agentId: text('agent_id').notNull(),
    itemId: text('item_id').notNull(),
    itemName: text('item_name'),
    unitName: text('unit_name'),
    qty: numeric('qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
    baseQty: numeric('base_qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
    movementType: text('movement_type').notNull(),
    documentType: text('document_type').notNull(),
    documentId: text('document_id').notNull(),
    documentNumber: text('document_number'),
    documentLineId: text('document_line_id'),
    warehouseId: text('warehouse_id'),
    warehouseName: text('warehouse_name'),
    userId: text('user_id'),
    userName: text('user_name'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  });

// --- TRANSFERS ---
export const stockTransfers = pgTable('stock_transfers', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  fromBranchId: text('from_branch_id'),
  toBranchId: text('to_branch_id'),
  transferNumber: text('transfer_number').notNull(),
  itemId: text('item_id').notNull(),
  itemName: text('item_name'),
  itemCode: text('item_code'),
  fromItemId: text('from_item_id'),
  toItemId: text('to_item_id'),
  fromWarehouseId: text('from_warehouse_id'),
  fromWarehouseName: text('from_warehouse_name'),
  toWarehouseId: text('to_warehouse_id'),
  toWarehouseName: text('to_warehouse_name'),
  quantity: numeric('quantity', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  unitName: text('unit_name'),
  date: timestamp('date', { withTimezone: true, mode: 'string' }).defaultNow(),
  notes: text('notes'),
});

export const partyTransfers = pgTable('party_transfers', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  transferNumber: text('transfer_number').notNull(),
  fromPartyId: text('from_party_id').notNull(),
  fromPartyName: text('from_party_name'),
  toPartyId: text('to_party_id').notNull(),
  toPartyName: text('to_party_name'),
  amount: numeric('amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  currency: text('currency'),
  date: timestamp('date', { withTimezone: true, mode: 'string' }).defaultNow(),
  note: text('note'),
});

// --- Delivery Notices ---
export const deliveryNotices = pgTable('delivery_notices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  status: text('status').notNull().default('DRAFT'),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  receiverType: text('receiver_type'),
  receiverId: text('receiver_id'),
  receiverName: text('receiver_name'),
  notes: text('notes'),
  date: date('date', { mode: 'string' }).notNull(),
  items: text('items'),
  audit: text('audit'),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name'),
  submittedById: text('submitted_by_id'),
  submittedByName: text('submitted_by_name'),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }),
  confirmedById: text('confirmed_by_id'),
  confirmedByName: text('confirmed_by_name'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'string' }),
  rejectedById: text('rejected_by_id'),
  rejectedByName: text('rejected_by_name'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'string' }),
  rejectReason: text('reject_reason'),
  managerNotes: text('manager_notes'),
  referenceNumber: text('reference_number'),
  operationType: text('operation_type'),
  convertToInvoice: boolean('convert_to_invoice').default(false),
  linkedInvoiceId: text('linked_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- OTHER TABLES ---
export const categories = pgTable('categories', { id: text('id').primaryKey(), companyId: text('company_id'), name: text('name').notNull() });
export const subCategories = pgTable('sub_categories', { id: text('id').primaryKey(), companyId: text('company_id'), name: text('name').notNull(), categoryId: text('category_id') });
export const units = pgTable('units', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  isBase: integer('is_base').default(0),
  baseUnitId: text('base_unit_id'),
  factor: numeric('factor', { precision: 18, scale: 6, mode: 'number' }).default(1),
  multiplier: numeric('multiplier', { precision: 18, scale: 6, mode: 'number' }).default(1)
});
export const cashBoxes = pgTable('cash_boxes', { id: text('id').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), name: text('name').notNull(), balance: numeric('balance', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0), currency: text('currency').default('USD'), accountId: integer('account_id').references(() => accounts.id), isActive: boolean('is_active').default(true) });
export const vouchers = pgTable('vouchers', { id: text('id').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), type: text('type').notNull(), date: text('date').notNull(), amount: numeric('amount', { precision: 18, scale: 6, mode: 'number' }).notNull(), amountBase: numeric('amount_base', { precision: 18, scale: 6, mode: 'number' }), amountTransaction: numeric('amount_transaction', { precision: 18, scale: 6, mode: 'number' }), originalAmount: numeric('original_amount', { precision: 18, scale: 6, mode: 'number' }), currency: text('currency'), exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6, mode: 'number' }), cashBoxId: text('cash_box_id'), cashBoxName: text('cash_box_name'), clientId: text('client_id'), clientName: text('client_name'), category: text('category'), description: text('description'), referenceNumber: text('reference_number'), linkedInvoiceId: text('linked_invoice_id'), journalEntryId: text('journal_entry_id'), status: text('status').notNull().default('DRAFT'), createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  // FX settlement fields — populated when this voucher settles a foreign-currency invoice
  settlementExchangeRate: numeric('settlement_exchange_rate', { precision: 18, scale: 6, mode: 'number' }),
  fxDifferenceAmount: numeric('fx_difference_amount', { precision: 18, scale: 6, mode: 'number' }),
  fxDifferenceType: text('fx_difference_type'), // 'gain' | 'loss' | null
  fxJournalEntryId: integer('fx_journal_entry_id'),
});
export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  invoiceNumber: text('invoice_number').notNull(),
  type: text('type').notNull(),
  clientId: text('client_id'),
  clientName: text('client_name'),
  date: date('date', { mode: 'string' }).notNull(),
  items: text('items'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  totalAmountBase: numeric('total_amount_base', { precision: 18, scale: 6, mode: 'number' }),
  totalAmountTransaction: numeric('total_amount_transaction', { precision: 18, scale: 6, mode: 'number' }),
  discount: numeric('discount', { precision: 18, scale: 6, mode: 'number' }),
  discountBase: numeric('discount_base', { precision: 18, scale: 6, mode: 'number' }),
  discountTransaction: numeric('discount_transaction', { precision: 18, scale: 6, mode: 'number' }),
  originalAmount: numeric('original_amount', { precision: 18, scale: 6, mode: 'number' }),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6, mode: 'number' }),
  paidAmount: numeric('paid_amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  paidAmountBase: numeric('paid_amount_base', { precision: 18, scale: 6, mode: 'number' }),
  paidAmountTransaction: numeric('paid_amount_transaction', { precision: 18, scale: 6, mode: 'number' }),
  remainingAmount: numeric('remaining_amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  remainingAmountBase: numeric('remaining_amount_base', { precision: 18, scale: 6, mode: 'number' }),
  remainingAmountTransaction: numeric('remaining_amount_transaction', { precision: 18, scale: 6, mode: 'number' }),
  paymentType: text('payment_type'),
  applyStock: integer('apply_stock').default(1),
  currency: text('currency'),
  notes: text('notes'),
  returnType: text('return_type'),
    createdById: text('created_by_id'),
    createdByName: text('created_by_name'),
    createdByRole: text('created_by_role'),
    agentId: text('agent_id'),
    agentName: text('agent_name'),
    agentUserId: text('agent_user_id'),
  geoLat: numeric('geo_lat', { precision: 18, scale: 6, mode: 'number' }),
  geoLng: numeric('geo_lng', { precision: 18, scale: 6, mode: 'number' }),
  geoLabel: text('geo_label'),
  targetWarehouseId: text('target_warehouse_id'),
  targetWarehouseName: text('target_warehouse_name'),
  sourceDocumentType: text('source_document_type'),
  sourceDocumentId: text('source_document_id'),
  journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
  correctionAudit: text('correction_audit'),
  // Landed cost separation: goodsSubtotal = supplier payable basis; additionalCostsTotal = extra costs (customs, freight, etc.)
  goodsSubtotal: numeric('goods_subtotal', { precision: 18, scale: 6, mode: 'number' }),
  additionalCostsTotal: numeric('additional_costs_total', { precision: 18, scale: 6, mode: 'number' }),
  /** POS / restaurant queue token (stable after issue) */
  queueNumber: text('queue_number'),
  queueScope: text('queue_scope'),
  queueDate: date('queue_date', { mode: 'string' }),
  kitchenPrintedAt: timestamp('kitchen_printed_at', { withTimezone: true, mode: 'string' }),
  customerPrintedAt: timestamp('customer_printed_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});
export const invoiceMovements = pgTable('invoice_movements', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  invoiceId: text('invoice_id').notNull(),
  invoiceNumber: text('invoice_number'),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  reason: text('reason'),
  userId: text('user_id'),
  userName: text('user_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow()
});

export const systemSettings = pgTable('system_settings', { key: text('key').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), value: text('value').notNull() });

/** Atomic sequence for POS queue numbers (per scope). */
export const queueCounters = pgTable('queue_counters', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  scopeKey: text('scope_key').notNull().unique(),
  lastValue: integer('last_value').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const warehouseDispatchNotices = pgTable('warehouse_dispatch_notices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  customerId: text('customer_id'),
  customerName: text('customer_name'),
  sourceDocumentType: text('source_document_type'),
  sourceDocumentId: text('source_document_id'),
  dispatchNumber: text('dispatch_number').notNull(),
  status: text('status').notNull().default('draft'),
  requestedBy: text('requested_by'),
  requestedByName: text('requested_by_name'),
  preparedBy: text('prepared_by'),
  preparedByName: text('prepared_by_name'),
  approvedBy: text('approved_by'),
  approvedByName: text('approved_by_name'),
  rejectedBy: text('rejected_by'),
  rejectedByName: text('rejected_by_name'),
  convertedBy: text('converted_by'),
  convertedByName: text('converted_by_name'),
  requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'string' }),
  preparedAt: timestamp('prepared_at', { withTimezone: true, mode: 'string' }),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'string' }),
  convertedAt: timestamp('converted_at', { withTimezone: true, mode: 'string' }),
  rejectedReason: text('rejected_reason'),
  notes: text('notes'),
  printMeta: text('print_meta'),
  linkedInvoiceId: text('linked_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const warehouseDispatchNoticeLines = pgTable('warehouse_dispatch_notice_lines', {
  id: text('id').primaryKey(),
  noticeId: text('notice_id').notNull(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id'),
  itemId: text('item_id').notNull(),
  itemName: text('item_name'),
  colorId: text('color_id').notNull(),
  colorName: text('color_name'),
  requestedRollCount: numeric('requested_roll_count', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  fulfilledRollCount: numeric('fulfilled_roll_count', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  fulfilledTotalLength: numeric('fulfilled_total_length', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  baseUom: text('base_uom').notNull(),
  textileUnitPricePerLength: numeric('textile_unit_price_per_length', { precision: 18, scale: 6, mode: 'number' }),
  lineStatus: text('line_status').notNull().default('draft'),
  notes: text('notes'),
  sourceInvoiceLineId: text('source_invoice_line_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const warehouseDispatchNoticeLineDecompositions = pgTable('warehouse_dispatch_notice_line_decompositions', {
  id: text('id').primaryKey(),
  noticeId: text('notice_id').notNull(),
  lineId: text('line_id').notNull(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  sequence: integer('sequence').notNull(),
  lengthValue: numeric('length_value', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  unit: text('unit').notNull(),
  rollLabel: text('roll_label'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

/** Atomic document counters for invoices / vouchers in shared LAN mode. */
export const documentSequences = pgTable('document_sequences', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  sequenceKey: text('sequence_key').notNull().unique(),
  documentType: text('document_type').notNull(),
  lastValue: integer('last_value').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

/** Audit log for print attempts (customer / kitchen). */
export const printJobs = pgTable('print_jobs', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  invoiceId: text('invoice_id'),
  /** Logical document: customer_receipt | kitchen_ticket */
  printType: text('print_type').notNull(),
  /** Renderer document: pos_receipt | kitchen_ticket */
  documentType: text('document_type'),
  templateId: text('template_id'),
  payloadSummary: text('payload_summary'),
  printerId: text('printer_id'),
  printerAddress: text('printer_address'),
  printerConnectionType: text('printer_connection_type'),
  invoiceNumber: text('invoice_number'),
  copies: integer('copies').default(1),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  printedAt: timestamp('printed_at', { withTimezone: true, mode: 'string' }),
  /** POS auto, manual reprint, settings test, etc. */
  source: text('source'),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name'),
});

export const branches = pgTable('branches', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  name: text('name').notNull(),
  code: text('code'),
  isMain: boolean('is_main').default(false),
  isActive: boolean('is_active').default(true),
  location: text('location'),
  manager: text('manager'),
  phone: text('phone'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow()
});

export const userBranchAccess = pgTable('user_branch_access', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  branchId: text('branch_id').notNull(),
  roleOverride: text('role_override'),
  permissionOverride: text('permission_override'),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => ({
  userBranchUnique: uniqueIndex('user_branch_access_user_branch_unique').on(table.userId, table.branchId),
}));

export const userCompanyAccess = pgTable('user_company_access', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  companyId: text('company_id').notNull(),
  roleOverride: text('role_override'),
  permissionOverride: text('permission_override'),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => ({
  userCompanyUnique: uniqueIndex('user_company_access_user_company_unique').on(table.userId, table.companyId),
}));

export const reconciliationMarks = pgTable('reconciliation_marks', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id').notNull(),
  reportType: text('report_type').notNull(),
  markAt: timestamp('mark_at', { withTimezone: true, mode: 'string' }).notNull(),
  rowRefId: text('row_ref_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow()
});

export const remoteBranches = pgTable('remote_branches', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  employeeName: text('employee_name'),
  ipAddress: text('ip_address').notNull(),
  syncInterval: integer('sync_interval').default(30),
  showFinancials: boolean('show_financials').default(true),
  showInventory: boolean('show_inventory').default(true),
  showInvoices: boolean('show_invoices').default(true),
  connectionMode: text('connection_mode').default('server'),
  clientId: text('client_id'),
  clientName: text('client_name'),
  userId: text('user_id'),
  userName: text('user_name'),
  deviceLabel: text('device_label'),
  platform: text('platform'),
  appVersion: text('app_version'),
  userAgent: text('user_agent'),
  sessionId: text('session_id'),
  lastSeen: text('last_seen'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});
export const partners = pgTable('partners', { id: text('id').primaryKey(), companyId: text('company_id'), name: text('name').notNull(), type: text('type').notNull(), percentage: numeric('percentage', { precision: 18, scale: 6, mode: 'number' }).notNull(), capitalAmount: numeric('capital_amount', { precision: 18, scale: 6, mode: 'number' }).default(0), currentBalance: numeric('current_balance', { precision: 18, scale: 6, mode: 'number' }).default(0), joinDate: text('join_date'), status: text('status').default('active'), linkedClientId: text('linked_client_id') });
export const partnerTransactions = pgTable('partner_transactions', { id: text('id').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), partnerId: text('partner_id').notNull(), partnerName: text('partner_name'), type: text('type').notNull(), amount: numeric('amount', { precision: 18, scale: 6, mode: 'number' }).notNull(), date: text('date').notNull(), description: text('description') });

// --- Manufacturing ---
export const recipes = pgTable('recipes', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  code: text('code'),
  outputItemId: text('output_item_id').notNull(),
  outputItemName: text('output_item_name'),
  outputQty: numeric('output_qty', { precision: 18, scale: 6, mode: 'number' }).default(1),
  unitName: text('unit_name'),
  lines: text('lines'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const manufacturingOrders = pgTable('manufacturing_orders', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  code: text('code').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  outputItemId: text('output_item_id').notNull(),
  outputItemName: text('output_item_name'),
  outputQty: numeric('output_qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6, mode: 'number' }).default(0),
  totalCost: numeric('total_cost', { precision: 18, scale: 6, mode: 'number' }).default(0),
  status: text('status').default('DRAFT'),
  expenseType: text('expense_type').default('FIXED'),
  expenseValue: numeric('expense_value', { precision: 18, scale: 6, mode: 'number' }).default(0),
  items: text('items'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- Expenses ---
export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  code: text('code').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  description: text('description').notNull(),
  totalAmount: numeric('total_amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  currency: text('currency').default('USD'),
  paymentType: text('payment_type').default('CASH'),
  cashBoxId: text('cash_box_id'),
  cashBoxName: text('cash_box_name'),
  warehouseId: text('warehouse_id'),
  warehouseName: text('warehouse_name'),
  manufacturingOrderId: text('manufacturing_order_id'),
  status: text('status').default('DRAFT'),
  lines: text('lines'),
  postedAt: timestamp('posted_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- CONSIGNMENT: Documents, Settlements, Commission Profiles ---
export const consignmentDocuments = pgTable('consignment_documents', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  documentNumber: text('document_number').notNull().unique(),
  direction: text('direction').notNull(), // OUT_CUSTOMER | IN_SUPPLIER
  status: text('status').notNull().default('DRAFT'), // DRAFT | POSTED | PARTIALLY_SETTLED | FULLY_SETTLED | CANCELLED
  partyType: text('party_type').notNull(), // CUSTOMER | SUPPLIER
  partyId: text('party_id').notNull(),
  sourceWarehouseId: text('source_warehouse_id'),
  consignmentWarehouseId: text('consignment_warehouse_id').notNull(),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  notes: text('notes'),
  currencyId: text('currency_id'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6, mode: 'number' }).default(1),
  pricingPolicy: text('pricing_policy').default('MANUAL'),
  commissionType: text('commission_type').default('NONE'),
  commissionValue: numeric('commission_value', { precision: 18, scale: 6, mode: 'number' }).default(0),
  totalQty: numeric('total_qty', { precision: 18, scale: 6, mode: 'number' }).default(0),
  totalAmountReference: numeric('total_amount_reference', { precision: 18, scale: 6, mode: 'number' }),
  createdBy: text('created_by').notNull(),
  postedBy: text('posted_by'),
  postedAt: timestamp('posted_at', { withTimezone: true, mode: 'string' }),
  cancelledBy: text('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  journalEntryId: integer('journal_entry_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const consignmentDocumentLines = pgTable('consignment_document_lines', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  documentId: text('document_id').notNull(),
  itemId: text('item_id').notNull(),
  unitId: text('unit_id'),
  unitName: text('unit_name'),
  unitFactor: numeric('unit_factor', { precision: 18, scale: 6, mode: 'number' }),
  qty: numeric('qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  baseQty: numeric('base_qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  serialNumbers: text('serial_numbers'),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  referencePrice: numeric('reference_price', { precision: 18, scale: 6, mode: 'number' }),
  customSalePrice: numeric('custom_sale_price', { precision: 18, scale: 6, mode: 'number' }),
  commissionType: text('commission_type'),
  commissionValue: numeric('commission_value', { precision: 18, scale: 6, mode: 'number' }).default(0),
  notes: text('notes'),
  settledSoldQty: numeric('settled_sold_qty', { precision: 18, scale: 6, mode: 'number' }).default(0),
  settledReturnedQty: numeric('settled_returned_qty', { precision: 18, scale: 6, mode: 'number' }).default(0),
  remainingQty: numeric('remaining_qty', { precision: 18, scale: 6, mode: 'number' }).default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const consignmentSettlements = pgTable('consignment_settlements', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  settlementNumber: text('settlement_number').notNull().unique(),
  documentId: text('document_id').notNull(),
  settlementDate: date('settlement_date', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('DRAFT'), // DRAFT | POSTED | CANCELLED
  notes: text('notes'),
  totalSoldQty: numeric('total_sold_qty', { precision: 18, scale: 6, mode: 'number' }).default(0),
  totalReturnedQty: numeric('total_returned_qty', { precision: 18, scale: 6, mode: 'number' }).default(0),
  grossSalesAmount: numeric('gross_sales_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),
  grossPurchaseAmount: numeric('gross_purchase_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),
  totalCommission: numeric('total_commission', { precision: 18, scale: 6, mode: 'number' }).default(0),
  netAmount: numeric('net_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),
  createdBy: text('created_by').notNull(),
  postedBy: text('posted_by'),
  postedAt: timestamp('posted_at', { withTimezone: true, mode: 'string' }),
  cancelledBy: text('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  linkedInvoiceId: text('linked_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const consignmentSettlementLines = pgTable('consignment_settlement_lines', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  settlementId: text('settlement_id').notNull(),
  documentLineId: text('document_line_id').notNull(),
  actionType: text('action_type').notNull(), // SOLD | RETURNED | ADJUSTED
  unitId: text('unit_id'),
  unitName: text('unit_name'),
  unitFactor: numeric('unit_factor', { precision: 18, scale: 6, mode: 'number' }),
  qty: numeric('qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  baseQty: numeric('base_qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  serialNumbers: text('serial_numbers'),
  unitPrice: numeric('unit_price', { precision: 18, scale: 6, mode: 'number' }),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6, mode: 'number' }),
  commissionType: text('commission_type'),
  commissionValue: numeric('commission_value', { precision: 18, scale: 6, mode: 'number' }).default(0),
  lineGrossAmount: numeric('line_gross_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),
  lineCommissionAmount: numeric('line_commission_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),
  lineNetAmount: numeric('line_net_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const consignmentCommissionProfiles = pgTable('consignment_commission_profiles', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  appliesTo: text('applies_to').notNull(), // CUSTOMER | SUPPLIER | BOTH
  commissionType: text('commission_type').notNull(), // PERCENT | FIXED_PER_UNIT | FIXED_DOCUMENT
  commissionValue: numeric('commission_value', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  isActive: boolean('is_active').default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- INVENTORY MOVEMENTS (generic log, used by consignment) ---
export const inventoryMovements = pgTable('inventory_movements', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  itemId: text('item_id').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  documentType: text('document_type').notNull(), // INVOICE | TRANSFER | CONSIGNMENT_DOCUMENT | CONSIGNMENT_SETTLEMENT | ...
  documentId: text('document_id').notNull(),
  documentNumber: text('document_number'),
  documentLineId: text('document_line_id'),
  movementType: text('movement_type').notNull(),
  unitId: text('unit_id'),
  unitName: text('unit_name'),
  qty: numeric('qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  baseQty: numeric('base_qty', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  textileColorId: text('textile_color_id'),
  textileRollDelta: numeric('textile_roll_delta', { precision: 18, scale: 6, mode: 'number' }).default(0),
  textileLengthDelta: numeric('textile_length_delta', { precision: 18, scale: 6, mode: 'number' }).default(0),
  textileBaseUom: text('textile_base_uom'),
  userId: text('user_id'),
  userName: text('user_name'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- FISCAL PERIODS (Period Closing / إقفال السنة المالية) ---
export const fiscalPeriods = pgTable('fiscal_periods', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),

  /** Human-readable label e.g. "2024", "2024-Q1" */
  name: text('name').notNull(),

  /** YYYY-MM-DD */
  startDate: date('start_date', { mode: 'string' }).notNull(),

  /** YYYY-MM-DD */
  endDate: date('end_date', { mode: 'string' }).notNull(),

  /**
   * open     → Transactions allowed
   * closing  → Pre-closing validation passed, closing journal being prepared
   * closed   → All transactions blocked; closing entries posted
   * reopened → Exceptional re-open after audit (new entries still tracked)
   */
  status: text('status').notNull().default('open'),

  /** ID of the closing journal entry (P&L zeroing → Retained Earnings) */
  closingJournalEntryId: integer('closing_journal_entry_id'),

  /** Net P&L transferred to retained earnings (positive = profit, negative = loss) */
  netPnl: numeric('net_pnl', { precision: 18, scale: 6, mode: 'number' }),

  /** Total revenue in period (base currency) */
  totalRevenue: numeric('total_revenue', { precision: 18, scale: 6, mode: 'number' }),

  /** Total expenses in period (base currency) */
  totalExpenses: numeric('total_expenses', { precision: 18, scale: 6, mode: 'number' }),

  closedBy: text('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
  reopenedBy: text('reopened_by'),
  reopenedAt: timestamp('reopened_at', { withTimezone: true, mode: 'string' }),
  reopenReason: text('reopen_reason'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- PRINTING SYSTEM (Template Engine + Printer Management) ---

/**
 * Print templates: one row per document type / format combination.
 * `template_json` holds the structured config; `template_html` holds an
 * optional fully-custom HTML override.
 *
 * Template types: pos_receipt | sale_invoice | purchase_invoice | voucher | report
 * Formats: 58mm | 80mm | A4 | A5
 */
export const printTemplates = pgTable('print_templates', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId:  text('branch_id'),

  /** 'pos_receipt' | 'sale_invoice' | 'purchase_invoice' | 'voucher' | 'report' */
  templateType: text('template_type').notNull(),

  /** '58mm' | '80mm' | 'A4' | 'A5' */
  format: text('format').notNull().default('A4'),

  name: text('name').notNull(),

  /** JSON blob — structured template config (sections, fields, toggles) */
  templateJson: text('template_json'),

  /** Optional fully-custom HTML override (takes precedence over templateJson) */
  templateHtml: text('template_html'),

  isDefault:   boolean('is_default').default(false),
  isActive:    boolean('is_active').default(true),

  /** Toggles */
  showLogo:         boolean('show_logo').default(true),
  showCompanyName:  boolean('show_company_name').default(true),
  showAddress:      boolean('show_address').default(true),
  showPhone:        boolean('show_phone').default(true),
  showTaxNumber:    boolean('show_tax_number').default(false),
  showQrCode:       boolean('show_qr_code').default(false),
  showDiscount:     boolean('show_discount').default(true),
  showTaxBreakdown: boolean('show_tax_breakdown').default(false),
  showFooter:       boolean('show_footer').default(true),
  showSignatureLine:boolean('show_signature_line').default(false),

  /** Custom text fields */
  headerTitle:    text('header_title'),
  headerSubtitle: text('header_subtitle'),
  footerText:     text('footer_text'),

  /** Font size: 'sm' | 'md' | 'lg' */
  fontSize: text('font_size').default('md'),

  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

/**
 * Registered printers — one row per physical printer.
 * Used for: automatic printer selection by document type,
 * network printing, bluetooth pairing.
 */
export const printers = pgTable('printers', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId:  text('branch_id'),

  name: text('name').notNull(),

  /** 'thermal' | 'standard' */
  type: text('type').notNull().default('standard'),

  /** 'usb' | 'bluetooth' | 'network' | 'windows' */
  connectionType: text('connection_type').notNull().default('windows'),

  /** IP address, bluetooth MAC, or Windows printer name */
  address: text('address'),

  /** '58' | '80' | 'A4' | 'A5' */
  paperSize: text('paper_size').notNull().default('A4'),

  isDefault:  boolean('is_default').default(false),
  isActive:   boolean('is_active').default(true),

  /**
   * Codepage for ESC/POS Arabic encoding.
   * 'PC864' | 'CP1256' | 'UTF8'
   */
  codepage: text('codepage').default('UTF8'),

  /** Which document types this printer handles (comma-separated) */
  documentTypes: text('document_types'),

  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- RECONCILIATION (SAP FI matching / Odoo-style) ---

/**
 * A reconciliation session ties together one side of a party's ledger
 * (invoices / debit notes) against the other side (payments / credit notes).
 *
 * Types of reconciliation supported:
 *   - party_ar   : Customer AR — invoice vs. receipt voucher
 *   - party_ap   : Supplier AP — purchase invoice vs. payment voucher
 *   - bank       : Bank statement line vs. journal entry (GL)
 *   - interco    : Inter-company / inter-branch
 */
export const reconciliationSessions = pgTable('reconciliation_sessions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),

  /** 'party_ar' | 'party_ap' | 'bank' | 'interco' */
  type: text('type').notNull(),

  /** Party being reconciled (customer / supplier id) */
  partyId: text('party_id'),
  partyName: text('party_name'),

  /** ISO date range covered */
  fromDate: date('from_date', { mode: 'string' }),
  toDate: date('to_date', { mode: 'string' }),

  /** 'open' | 'confirmed' | 'cancelled' */
  status: text('status').notNull().default('open'),

  /** Total debit side matched */
  totalDebitMatched: numeric('total_debit_matched', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Total credit side matched */
  totalCreditMatched: numeric('total_credit_matched', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Net difference posted as write-off (if any) */
  differenceAmount: numeric('difference_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Journal entry id for any write-off difference posted */
  writeOffJournalEntryId: integer('write_off_journal_entry_id'),

  /** Tolerance used for auto-match (USD) */
  toleranceAmount: numeric('tolerance_amount', { precision: 18, scale: 6, mode: 'number' }).default(0),

  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'string' }),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

/**
 * Each row is one item in a session — either a "debit" document (invoice,
 * debit note) or a "credit" document (receipt, payment, credit note).
 * Matched pairs share the same `matchGroupId`.
 */
export const reconciliationItems = pgTable('reconciliation_items', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  sessionId: text('session_id').notNull(),

  /**
   * 'invoice' | 'debit_note' | 'receipt' | 'payment' |
   * 'credit_note' | 'journal_entry' | 'bank_line'
   */
  itemType: text('item_type').notNull(),

  /** 'debit' | 'credit' */
  side: text('side').notNull(),

  /** Source document reference */
  refId: text('ref_id'),
  refNumber: text('ref_number'),
  refDate: date('ref_date', { mode: 'string' }),

  partyId: text('party_id'),
  partyName: text('party_name'),

  /** Transaction currency (SYP / TRY / USD) */
  currency: text('currency').default('USD'),

  /** Amount in transaction currency */
  amountForeign: numeric('amount_foreign', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Amount in base currency (USD) */
  amountBase: numeric('amount_base', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** Amount allocated to this match (may be < amountBase for partial match) */
  allocatedBase: numeric('allocated_base', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Remaining unmatched base amount */
  remainingBase: numeric('remaining_base', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Null = unmatched; shared UUID with paired item = matched */
  matchGroupId: text('match_group_id'),

  /** 'unmatched' | 'matched' | 'partial' | 'written_off' */
  matchStatus: text('match_status').notNull().default('unmatched'),

  /** 'auto' | 'manual' */
  matchMethod: text('match_method'),

  /** Difference within match group (if within tolerance, written off) */
  matchDifference: numeric('match_difference', { precision: 18, scale: 6, mode: 'number' }).default(0),

  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- FX REVALUATION (SAP F.05 equivalent) ---

/**
 * One revaluation run per execution.
 * Records the aggregate results and links to the two journal entries:
 *   - revaluationJournalEntryId  → the unrealized FX gain/loss entry (posted on valuationDate)
 *   - reversalJournalEntryId     → the automatic reversal (posted on first day of next period)
 */
export const fxRevaluationRuns = pgTable('fx_revaluation_runs', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),

  /** Date used as "current rate" benchmark (usually last day of period) */
  valuationDate: date('valuation_date', { mode: 'string' }).notNull(),

  /** ISO date on which the reversal entry is posted (usually next day) */
  reversalDate: date('reversal_date', { mode: 'string' }).notNull(),

  /** SYP rate used for this run */
  rateSyp: numeric('rate_syp', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** TRY rate used for this run */
  rateTry: numeric('rate_try', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  status: text('status').notNull().default('draft'), // draft | posted | reversed | cancelled

  /** Total unrealized gain in base currency */
  totalUnrealizedGain: numeric('total_unrealized_gain', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Total unrealized loss in base currency */
  totalUnrealizedLoss: numeric('total_unrealized_loss', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Net (gain - loss) */
  netUnrealized: numeric('net_unrealized', { precision: 18, scale: 6, mode: 'number' }).default(0),

  /** Number of open items evaluated */
  itemsEvaluated: integer('items_evaluated').default(0),

  /** Journal entry ID for the revaluation posting */
  revaluationJournalEntryId: integer('revaluation_journal_entry_id'),

  /** Journal entry ID for the automatic reversal */
  reversalJournalEntryId: integer('reversal_journal_entry_id'),

  executedBy: text('executed_by'),
  executedAt: timestamp('executed_at', { withTimezone: true, mode: 'string' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

/**
 * One row per open invoice/receivable/payable evaluated in a revaluation run.
 * Provides full drill-down: which party, which invoice, what was the FX impact.
 */
export const fxRevaluationLines = pgTable('fx_revaluation_lines', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  runId: text('run_id').notNull(),

  /** 'receivable' | 'payable' */
  itemType: text('item_type').notNull(),

  partyId: text('party_id'),
  partyName: text('party_name'),

  /** Linked invoice (if applicable) */
  invoiceId: text('invoice_id'),
  invoiceNumber: text('invoice_number'),

  /** Original transaction currency */
  currency: text('currency').notNull(),

  /** Outstanding foreign-currency balance being revalued */
  outstandingForeign: numeric('outstanding_foreign', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** Rate at which the balance was originally recorded */
  originalRate: numeric('original_rate', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** Base value as originally recorded (outstanding × original rate) */
  bookValueBase: numeric('book_value_base', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** Revaluation rate (current market rate) */
  revaluationRate: numeric('revaluation_rate', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** Base value at revaluation rate */
  revaluedBase: numeric('revalued_base', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** Difference = revaluedBase − bookValueBase */
  unrealizedDiff: numeric('unrealized_diff', { precision: 18, scale: 6, mode: 'number' }).notNull(),

  /** 'gain' | 'loss' | 'none' */
  diffType: text('diff_type').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- ACTIVATION CODES ---
export const activationCodes = pgTable('activation_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  activationType: text('activation_type').notNull().default('local'),
  licenseMission: text('license_mission').notNull().default('LOCAL_STANDALONE'),
  isUsed: boolean('is_used').default(false),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  computerName: text('computer_name'),
  appVersion: text('app_version'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

/** Idempotency keys for POST /activation/notify-success (client-generated UUID). */
export const activationTelegramDedupe = pgTable('activation_telegram_dedupe', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const systemSuperAdmins = pgTable('system_super_admins', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  isBootstrap: boolean('is_bootstrap').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const licenseExtensions = pgTable('license_extensions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  extensionType: text('extension_type').notNull(),
  label: text('label').notNull(),
  payload: text('payload').notNull(),
  appliedBy: text('applied_by').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// --- RESTAURANT: tables & sessions (operational; not invoices/POS) ---
export const restaurantTables = pgTable('restaurant_tables', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  zoneName: text('zone_name'),
  capacity: integer('capacity'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  /** Future: stable public token for QR deep-link (no logic in phase 2). */
  publicQrToken: text('public_qr_token'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const restaurantTableSessions = pgTable('restaurant_table_sessions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  tableId: text('table_id').notNull().references(() => restaurantTables.id),
  openedByUserId: text('opened_by_user_id').notNull(),
  closedByUserId: text('closed_by_user_id'),
  /** open | pending_review | ready_to_close | closed */
  sessionStatus: text('session_status').notNull().default('open'),
  guestCount: integer('guest_count'),
  openedAt: timestamp('opened_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'string' }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
  preliminaryTotal: numeric('preliminary_total', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  notes: text('notes'),
  source: text('source').notNull().default('cashier'),
  /** Future: QR request inbox (unread count per session). */
  unreadRequestCount: integer('unread_request_count').default(0),
  /** Future: bind to final posted invoice id. */
  finalInvoiceId: text('final_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const restaurantMenuItems = pgTable('restaurant_menu_items', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  itemId: text('item_id').notNull(),
  isVisibleInQr: boolean('is_visible_in_qr').notNull().default(true),
  displayNameOverride: text('display_name_override'),
  description: text('description'),
  imageUrl: text('image_url'),
  categoryName: text('category_name'),
  sortOrder: integer('sort_order').notNull().default(0),
  isAvailableNow: boolean('is_available_now').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const restaurantTableRequests = pgTable('restaurant_table_requests', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  tableId: text('table_id').notNull().references(() => restaurantTables.id),
  sessionId: text('session_id').notNull().references(() => restaurantTableSessions.id),
  publicQrTokenSnapshot: text('public_qr_token_snapshot'),
  requestStatus: text('request_status').notNull().default('new'),
  requestSource: text('request_source').notNull().default('qr'),
  customerSessionToken: text('customer_session_token'),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }).notNull(),
  seenAt: timestamp('seen_at', { withTimezone: true, mode: 'string' }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'string' }),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
  notes: text('notes'),
  clientRequestId: text('client_request_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const restaurantTableRequestItems = pgTable('restaurant_table_request_items', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => restaurantTableRequests.id),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  itemId: text('item_id').notNull(),
  itemNameSnapshot: text('item_name_snapshot').notNull(),
  itemCodeSnapshot: text('item_code_snapshot'),
  unitNameSnapshot: text('unit_name_snapshot'),
  quantity: numeric('quantity', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  baseUnitPrice: numeric('base_unit_price', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  lineSubtotal: numeric('line_subtotal', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  customerNote: text('customer_note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});
