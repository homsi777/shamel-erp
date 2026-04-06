
import { sqliteTable, text, integer, real, AnySQLiteColumn, uniqueIndex } from 'drizzle-orm/sqlite-core';
// Fix: Verifying sql export from drizzle-orm. Standard for most versions.
import { sql } from 'drizzle-orm';

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- AUTH: Users ---
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('warehouse_keeper'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  permissions: text('permissions'),
  companyId: text('company_id'),
  defaultBranchId: text('default_branch_id'),
  branchScope: text('branch_scope').default('restricted'),
  posWarehouseId: text('pos_warehouse_id'),
  posWarehouseName: text('pos_warehouse_name'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- HR: Employees & Payroll ---
export const employees = sqliteTable('employees', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  idNumber: text('id_number'),
  birthDate: text('birth_date'),
  address: text('address'),
  maritalStatus: text('marital_status'),
  biometricId: text('biometric_id'),
  position: text('position'),
  baseSalary: real('base_salary').default(0),
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
  joinDate: text('join_date'),
});

export const salaryTransactions = sqliteTable('salary_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  employeeId: text('employee_id').notNull(),
  employeeName: text('employee_name'),
  amount: real('amount').notNull(),
  currency: text('currency').default('USD'),
  type: text('type').notNull(),
  period: text('period'),
  cashBoxId: text('cash_box_id'),
  journalEntryId: integer('journal_entry_id'),
  journalEntryNumber: text('journal_entry_number'),
  date: text('date').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- BIOMETRIC: Devices & Attendance ---
export const biometricDevices = sqliteTable('biometric_devices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  ip: text('ip').notNull(),
  port: integer('port').default(4370),
  location: text('location'),
  notes: text('notes'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const attendanceRecords = sqliteTable('attendance_records', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  deviceId: text('device_id'),
  deviceIp: text('device_ip'),
  employeeId: text('employee_id'),
  employeeName: text('employee_name'),
  biometricId: text('biometric_id'),
  timestamp: text('timestamp').notNull(),
  eventType: text('event_type'),
  source: text('source'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- PARTIES (Customers & Suppliers) ---
export const parties = sqliteTable('parties', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  type: text('type').notNull(), // CUSTOMER | SUPPLIER | BOTH
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  taxNo: text('tax_no'),
  balance: real('balance').default(0),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  accountId: integer('account_id').references(() => accounts.id),
  arAccountId: text('ar_account_id'),
  apAccountId: text('ap_account_id'),
  geoLat: real('geo_lat'),
  geoLng: real('geo_lng'),
  geoLabel: text('geo_label'),
  // Consignment defaults per party
  defaultConsignmentAllowed: integer('default_consignment_allowed', { mode: 'boolean' }).default(false),
  defaultCommissionProfileId: text('default_commission_profile_id'),
  defaultConsignmentWarehouseId: text('default_consignment_warehouse_id'),
  defaultConsignmentPricingPolicy: text('default_consignment_pricing_policy'),
  // Pricing engine fields
  defaultPricingMode: text('default_pricing_mode').default('retail'), // retail | wholesale | wholesale2 | distribution | delegate | pos | custom
  allowLastPriceOverride: integer('allow_last_price_override', { mode: 'boolean' }).default(true),
  allowCustomerItemSpecialPrices: integer('allow_customer_item_special_prices', { mode: 'boolean' }).default(true),
  allowManualPriceEdit: integer('allow_manual_price_edit', { mode: 'boolean' }).default(true),
  preferredCurrencyForSales: text('preferred_currency_for_sales'),
});

// --- PARTY LEDGER (Customers & Suppliers) ---
export const partyTransactions = sqliteTable('party_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  partyId: text('party_id').notNull(),
  partyType: text('party_type'),
  kind: text('kind').notNull(),
  refId: text('ref_id'),
  amount: real('amount').notNull(),
  delta: real('delta').notNull(),
  currency: text('currency'),
  amountBase: real('amount_base'),
  deltaBase: real('delta_base'),
  amountTransaction: real('amount_transaction'),
  deltaTransaction: real('delta_transaction'),
  exchangeRate: real('exchange_rate').default(1),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- ACCOUNTS (Chart of Accounts) ---
// Fix: Added missing accounts table to satisfy TABLE_MAP in server.ts and types.ts
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id'),
  code: text('code').notNull().unique(),
  lookupCode: text('lookup_code'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  parentId: integer('parent_id').references((): AnySQLiteColumn => accounts.id),
  level: integer('level').notNull().default(1),
  accountType: text('account_type').notNull(), // assets | liabilities | equity | revenue | expenses
  accountNature: text('account_nature').notNull(), // debit | credit
  isParent: integer('is_parent', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  currencyCode: text('currency_code').default('SYP'),
  branchId: text('branch_id'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const journalEntries = sqliteTable('journal_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id'),
  entryNumber: text('entry_number').notNull().unique(),
  entryDate: text('entry_date').notNull(),
  description: text('description').notNull(),
  referenceType: text('reference_type').notNull(),
  referenceId: integer('reference_id'),
  totalDebit: real('total_debit').notNull().default(0),
  totalCredit: real('total_credit').notNull().default(0),
  currencyCode: text('currency_code').default('SYP'),
  exchangeRate: real('exchange_rate').default(1),
  status: text('status').notNull().default('draft'),
  branchId: text('branch_id'),
  createdBy: integer('created_by'),
  postedAt: text('posted_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const journalEntryLines = sqliteTable('journal_entry_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id'),
  journalEntryId: integer('journal_entry_id').notNull().references((): AnySQLiteColumn => journalEntries.id),
  accountId: integer('account_id').notNull().references((): AnySQLiteColumn => accounts.id),
  debit: real('debit').notNull().default(0),
  credit: real('credit').notNull().default(0),
  currencyCode: text('currency_code').default('SYP'),
  exchangeRate: real('exchange_rate').default(1),
  amountInCurrency: real('amount_in_currency'),
  description: text('description'),
  partyId: integer('party_id'),
  partnerRefId: text('partner_ref_id'),
  costCenterId: integer('cost_center_id'),
});

export const accountBalances = sqliteTable('account_balances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id'),
  accountId: integer('account_id').notNull().references((): AnySQLiteColumn => accounts.id),
  periodKey: text('period_key').notNull(),
  debitTotal: real('debit_total').notNull().default(0),
  creditTotal: real('credit_total').notNull().default(0),
  balance: real('balance').notNull().default(0),
  currencyCode: text('currency_code').default('SYP'),
});

// --- INVENTORY ---
export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  code: text('code').notNull(),
  groupId: text('group_id'),
  groupName: text('group_name'),
  merged: integer('merged', { mode: 'boolean' }).default(false),
  inactive: integer('inactive', { mode: 'boolean' }).default(false),
  mergedIntoItemId: text('merged_into_item_id'),
  barcode: text('barcode'),
  serialNumber: text('serial_number'),
  serialTracking: text('serial_tracking').default('none'),
  unitName: text('unit_name'),
  unitId: text('unit_id'),
  quantity: real('quantity').notNull().default(0),
  costPrice: real('cost_price').notNull().default(0),
  costPriceBase: real('cost_price_base').notNull().default(0),
  salePrice: real('sale_price').notNull().default(0),
  salePriceBase: real('sale_price_base'),
  wholesalePrice: real('wholesale_price').default(0),
  wholesalePriceBase: real('wholesale_price_base'),
  posPrice: real('pos_price').default(0),
  posPriceBase: real('pos_price_base'),
  pricePerMeter: real('price_per_meter').default(0),
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
  grossWeight: real('gross_weight'),
  netWeight: real('net_weight'),
  isScaleItem: integer('is_scale_item', { mode: 'boolean' }).notNull().default(false),
  scalePluCode: text('scale_plu_code'),
  scaleBarcodePrefix: text('scale_barcode_prefix'),
  scaleBarcodeMode: text('scale_barcode_mode'),
  scaleUnit: text('scale_unit'),
  scalePricePerKg: real('scale_price_per_kg'),
  scaleItemCodeLength: integer('scale_item_code_length'),
  scaleValueLength: integer('scale_value_length'),
  scaleDecimals: integer('scale_decimals'),
  wholesaleWholesalePrice: real('wholesale_wholesale_price').default(0),
  wholesaleWholesalePriceBase: real('wholesale_wholesale_price_base'),
  distributionPrice: real('distribution_price').default(0),
  distributionPriceBase: real('distribution_price_base'),
  delegatePrice: real('delegate_price').default(0),
  delegatePriceBase: real('delegate_price_base'),
  itemType: text('item_type').default('STOCK'), // STOCK | SERVICE | NON_STOCK
  priceCurrency: text('price_currency').default('USD'),
  lastPurchasePriceTransaction: real('last_purchase_price_transaction'),
  lastPurchaseCurrency: text('last_purchase_currency'),
  lastPurchaseExchangeRate: real('last_purchase_exchange_rate'),
  lastPurchaseAt: text('last_purchase_at'),
  isTextile: integer('is_textile', { mode: 'boolean' }).notNull().default(false),
  textileBaseUom: text('textile_base_uom'),
  supportsColorDimension: integer('supports_color_dimension', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  lastUpdated: text('last_updated').default(sql`CURRENT_TIMESTAMP`),
});

export const textileColors = sqliteTable('textile_colors', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  code: text('code'),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const textileStockBalances = sqliteTable('textile_stock_balances', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  itemId: text('item_id').notNull(),
  colorId: text('color_id').notNull(),
  baseUom: text('base_uom').notNull(),
  rollCount: real('roll_count').notNull().default(0),
  totalLength: real('total_length').notNull().default(0),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
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

export const textileStockMovements = sqliteTable('textile_stock_movements', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  itemId: text('item_id').notNull(),
  colorId: text('color_id').notNull(),
  baseUom: text('base_uom').notNull(),
  rollDelta: real('roll_delta').notNull().default(0),
  lengthDelta: real('length_delta').notNull().default(0),
  documentType: text('document_type').notNull(),
  documentId: text('document_id').notNull(),
  documentNumber: text('document_number'),
  documentLineId: text('document_line_id'),
  movementType: text('movement_type').notNull(),
  userId: text('user_id'),
  userName: text('user_name'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const itemSerials = sqliteTable('item_serials', {
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  serialNumberUnique: uniqueIndex('item_serials_serial_number_unique').on(table.serialNumber),
}));

export const itemBarcodes = sqliteTable('item_barcodes', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  itemId: text('item_id').notNull(),
  barcode: text('barcode').notNull(),
  unitId: text('unit_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  barcodeUnique: uniqueIndex('item_barcodes_barcode_unique').on(table.barcode),
}));

// --- CUSTOMER-ITEM SPECIAL PRICES ---
export const customerItemPrices = sqliteTable('customer_item_prices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  customerId: text('customer_id').notNull(),
  itemId: text('item_id').notNull(),
  unitId: text('unit_id'),
  currencyId: text('currency_id'),
  price: real('price').notNull(),
  minQty: real('min_qty'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const promotions = sqliteTable('promotions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  offerBarcode: text('offer_barcode'),
  description: text('description'),
  discountType: text('discount_type').notNull(),
  discountPercent: real('discount_percent').default(0),
  discountValue: real('discount_value').default(0),
  specialPrice: real('special_price').default(0),
  buyQuantity: real('buy_quantity').default(0),
  getDiscountPercent: real('get_discount_percent').default(0),
  primaryItemId: text('primary_item_id'),
  itemIds: text('item_ids'),
  mainImageUrl: text('main_image_url'),
  extraImageUrls: text('extra_image_urls'),
  displayOrder: integer('display_order').default(0),
  displayDurationSeconds: integer('display_duration_seconds').default(10),
  showOnDisplay: integer('show_on_display', { mode: 'boolean' }).default(true),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const warehouses = sqliteTable('warehouses', { 
  id: text('id').primaryKey(), 
  companyId: text('company_id'),
  code: text('code'),
  name: text('name').notNull(), 
  location: text('location'), 
  manager: text('manager'),
  branchId: text('branch_id'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  warehouseKind: text('warehouse_kind').default('NORMAL'), // NORMAL | CUSTOMER_CONSIGNMENT | SUPPLIER_CONSIGNMENT
  ownerPartyId: text('owner_party_id'),
  ownerPartyType: text('owner_party_type'), // CUSTOMER | SUPPLIER | null
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  userId: text('user_id').notNull(),
  operationType: text('operation_type').notNull(),
  affectedItems: text('affected_items').notNull(),
  oldValues: text('old_values'),
  newValues: text('new_values'),
  meta: text('meta'),
  timestamp: text('timestamp').notNull(),
});

export const systemEvents = sqliteTable('system_events', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  sourceModule: text('source_module').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  requiresManualReview: integer('requires_manual_review', { mode: 'boolean' }).notNull().default(false),
  affectedDocumentType: text('affected_document_type'),
  affectedDocumentId: text('affected_document_id'),
  compensationStatus: text('compensation_status'),
  metadata: text('metadata').notNull().default('{}'),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const itemGroups = sqliteTable('item_groups', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const itemGroupItems = sqliteTable('item_group_items', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  groupId: text('group_id').notNull(),
  itemId: text('item_id').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- Agents (Mobile Warehouses) ---
export const agents = sqliteTable('agents', {
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
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  commissionRate: real('commission_rate').default(0),
  commissionCurrency: text('commission_currency').default('USD'),
  lastLat: real('last_lat'),
  lastLng: real('last_lng'),
  lastSeenAt: text('last_seen_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const agentInventory = sqliteTable('agent_inventory', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  agentId: text('agent_id').notNull(),
  itemId: text('item_id').notNull(),
  itemName: text('item_name'),
  unitName: text('unit_name'),
  quantity: real('quantity').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  uniqueScope: uniqueIndex('agent_inventory_scope_unique').on(table.companyId, table.branchId, table.agentId, table.itemId),
}));

export const agentTransfers = sqliteTable('agent_transfers', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name'),
  transferType: text('transfer_type').default('transfer'),
  status: text('status').default('posted'),
  warehouseId: text('warehouse_id'),
  warehouseName: text('warehouse_name'),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name'),
  items: text('items'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const agentTransferLines = sqliteTable('agent_transfer_lines', {
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
  quantity: real('quantity').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const agentInventoryMovements = sqliteTable('agent_inventory_movements', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  agentId: text('agent_id').notNull(),
  itemId: text('item_id').notNull(),
  itemName: text('item_name'),
  unitName: text('unit_name'),
  qty: real('qty').notNull(),
  baseQty: real('base_qty').notNull(),
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- TRANSFERS ---
export const stockTransfers = sqliteTable('stock_transfers', {
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
  quantity: real('quantity').notNull(),
  unitName: text('unit_name'),
  date: text('date').default(sql`CURRENT_TIMESTAMP`),
  notes: text('notes'),
});

export const partyTransfers = sqliteTable('party_transfers', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  transferNumber: text('transfer_number').notNull(),
  fromPartyId: text('from_party_id').notNull(),
  fromPartyName: text('from_party_name'),
  toPartyId: text('to_party_id').notNull(),
  toPartyName: text('to_party_name'),
  amount: real('amount').notNull(),
  currency: text('currency'),
  date: text('date').default(sql`CURRENT_TIMESTAMP`),
  note: text('note'),
});

// --- Delivery Notices ---
export const deliveryNotices = sqliteTable('delivery_notices', {
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
  date: text('date').notNull(),
  items: text('items'),
  audit: text('audit'),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name'),
  submittedById: text('submitted_by_id'),
  submittedByName: text('submitted_by_name'),
  submittedAt: text('submitted_at'),
  confirmedById: text('confirmed_by_id'),
  confirmedByName: text('confirmed_by_name'),
  confirmedAt: text('confirmed_at'),
  rejectedById: text('rejected_by_id'),
  rejectedByName: text('rejected_by_name'),
  rejectedAt: text('rejected_at'),
  rejectReason: text('reject_reason'),
  managerNotes: text('manager_notes'),
  referenceNumber: text('reference_number'),
  operationType: text('operation_type'),
  convertToInvoice: integer('convert_to_invoice', { mode: 'boolean' }).default(false),
  linkedInvoiceId: text('linked_invoice_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- OTHER TABLES ---
export const categories = sqliteTable('categories', { id: text('id').primaryKey(), companyId: text('company_id'), name: text('name').notNull() });
export const subCategories = sqliteTable('sub_categories', { id: text('id').primaryKey(), companyId: text('company_id'), name: text('name').notNull(), categoryId: text('category_id') });
export const units = sqliteTable('units', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  isBase: integer('is_base').default(0),
  baseUnitId: text('base_unit_id'),
  factor: real('factor').default(1),
  multiplier: real('multiplier').default(1)
});
export const cashBoxes = sqliteTable('cash_boxes', { id: text('id').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), name: text('name').notNull(), balance: real('balance').notNull().default(0), currency: text('currency').default('USD'), accountId: integer('account_id').references(() => accounts.id), isActive: integer('is_active', { mode: 'boolean' }).default(true) });
export const vouchers = sqliteTable('vouchers', { id: text('id').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), type: text('type').notNull(), date: text('date').notNull(), amount: real('amount').notNull(), amountBase: real('amount_base'), amountTransaction: real('amount_transaction'), originalAmount: real('original_amount'), currency: text('currency'), exchangeRate: real('exchange_rate'), cashBoxId: text('cash_box_id'), cashBoxName: text('cash_box_name'), clientId: text('client_id'), clientName: text('client_name'), category: text('category'), description: text('description'), referenceNumber: text('reference_number'), linkedInvoiceId: text('linked_invoice_id'), journalEntryId: text('journal_entry_id'), status: text('status').notNull().default('DRAFT'), createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  // FX settlement fields — populated when this voucher settles a foreign-currency invoice
  settlementExchangeRate: real('settlement_exchange_rate'),
  fxDifferenceAmount: real('fx_difference_amount'),
  fxDifferenceType: text('fx_difference_type'), // 'gain' | 'loss' | null
  fxJournalEntryId: integer('fx_journal_entry_id'),
});
export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  invoiceNumber: text('invoice_number').notNull(),
  type: text('type').notNull(),
  clientId: text('client_id'),
  clientName: text('client_name'),
  date: text('date').notNull(),
  items: text('items'),
  totalAmount: real('total_amount').notNull(),
  totalAmountBase: real('total_amount_base'),
  totalAmountTransaction: real('total_amount_transaction'),
  discount: real('discount'),
  discountBase: real('discount_base'),
  discountTransaction: real('discount_transaction'),
  originalAmount: real('original_amount'),
  exchangeRate: real('exchange_rate'),
  paidAmount: real('paid_amount').notNull(),
  paidAmountBase: real('paid_amount_base'),
  paidAmountTransaction: real('paid_amount_transaction'),
  remainingAmount: real('remaining_amount').notNull(),
  remainingAmountBase: real('remaining_amount_base'),
  remainingAmountTransaction: real('remaining_amount_transaction'),
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
  geoLat: real('geo_lat'),
  geoLng: real('geo_lng'),
  geoLabel: text('geo_label'),
  targetWarehouseId: text('target_warehouse_id'),
  targetWarehouseName: text('target_warehouse_name'),
  sourceDocumentType: text('source_document_type'),
  sourceDocumentId: text('source_document_id'),
  journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
  correctionAudit: text('correction_audit'),
  // Landed cost separation: goodsSubtotal = supplier payable basis; additionalCostsTotal = extra costs (customs, freight, etc.)
  goodsSubtotal: real('goods_subtotal'),
  additionalCostsTotal: real('additional_costs_total'),
  /** POS / restaurant queue token (stable after issue) */
  queueNumber: text('queue_number'),
  queueScope: text('queue_scope'),
  queueDate: text('queue_date'),
  kitchenPrintedAt: text('kitchen_printed_at'),
  customerPrintedAt: text('customer_printed_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
export const invoiceMovements = sqliteTable('invoice_movements', {
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const systemSettings = sqliteTable('system_settings', { key: text('key').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), value: text('value').notNull() });

/** Atomic sequence for POS queue numbers (per scope). */
export const queueCounters = sqliteTable('queue_counters', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  scopeKey: text('scope_key').notNull().unique(),
  lastValue: integer('last_value').notNull().default(0),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const warehouseDispatchNotices = sqliteTable('warehouse_dispatch_notices', {
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
  requestedAt: text('requested_at'),
  preparedAt: text('prepared_at'),
  approvedAt: text('approved_at'),
  rejectedAt: text('rejected_at'),
  convertedAt: text('converted_at'),
  rejectedReason: text('rejected_reason'),
  notes: text('notes'),
  printMeta: text('print_meta'),
  linkedInvoiceId: text('linked_invoice_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const warehouseDispatchNoticeLines = sqliteTable('warehouse_dispatch_notice_lines', {
  id: text('id').primaryKey(),
  noticeId: text('notice_id').notNull(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  warehouseId: text('warehouse_id'),
  itemId: text('item_id').notNull(),
  itemName: text('item_name'),
  colorId: text('color_id').notNull(),
  colorName: text('color_name'),
  requestedRollCount: real('requested_roll_count').notNull().default(0),
  fulfilledRollCount: real('fulfilled_roll_count').notNull().default(0),
  fulfilledTotalLength: real('fulfilled_total_length').notNull().default(0),
  baseUom: text('base_uom').notNull(),
  textileUnitPricePerLength: real('textile_unit_price_per_length'),
  lineStatus: text('line_status').notNull().default('draft'),
  notes: text('notes'),
  sourceInvoiceLineId: text('source_invoice_line_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const warehouseDispatchNoticeLineDecompositions = sqliteTable('warehouse_dispatch_notice_line_decompositions', {
  id: text('id').primaryKey(),
  noticeId: text('notice_id').notNull(),
  lineId: text('line_id').notNull(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  sequence: integer('sequence').notNull(),
  lengthValue: real('length_value').notNull(),
  unit: text('unit').notNull(),
  rollLabel: text('roll_label'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

/** Atomic document counters for invoices / vouchers in shared LAN mode. */
export const documentSequences = sqliteTable('document_sequences', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  sequenceKey: text('sequence_key').notNull().unique(),
  documentType: text('document_type').notNull(),
  lastValue: integer('last_value').notNull().default(0),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

/** Audit log for print attempts (customer / kitchen). */
export const printJobs = sqliteTable('print_jobs', {
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  printedAt: text('printed_at'),
  /** POS auto, manual reprint, settings test, etc. */
  source: text('source'),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name'),
});

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  name: text('name').notNull(),
  code: text('code'),
  isMain: integer('is_main', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  location: text('location'),
  manager: text('manager'),
  phone: text('phone'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const userBranchAccess = sqliteTable('user_branch_access', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  branchId: text('branch_id').notNull(),
  roleOverride: text('role_override'),
  permissionOverride: text('permission_override'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userBranchUnique: uniqueIndex('user_branch_access_user_branch_unique').on(table.userId, table.branchId),
}));

export const userCompanyAccess = sqliteTable('user_company_access', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  companyId: text('company_id').notNull(),
  roleOverride: text('role_override'),
  permissionOverride: text('permission_override'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userCompanyUnique: uniqueIndex('user_company_access_user_company_unique').on(table.userId, table.companyId),
}));

export const reconciliationMarks = sqliteTable('reconciliation_marks', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id').notNull(),
  reportType: text('report_type').notNull(),
  markAt: text('mark_at').notNull(),
  rowRefId: text('row_ref_id'),
  note: text('note'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const remoteBranches = sqliteTable('remote_branches', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  employeeName: text('employee_name'),
  ipAddress: text('ip_address').notNull(),
  syncInterval: integer('sync_interval').default(30),
  showFinancials: integer('show_financials', { mode: 'boolean' }).default(true),
  showInventory: integer('show_inventory', { mode: 'boolean' }).default(true),
  showInvoices: integer('show_invoices', { mode: 'boolean' }).default(true),
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
export const partners = sqliteTable('partners', { id: text('id').primaryKey(), companyId: text('company_id'), name: text('name').notNull(), type: text('type').notNull(), percentage: real('percentage').notNull(), capitalAmount: real('capital_amount').default(0), currentBalance: real('current_balance').default(0), joinDate: text('join_date'), status: text('status').default('active'), linkedClientId: text('linked_client_id') });
export const partnerTransactions = sqliteTable('partner_transactions', { id: text('id').primaryKey(), companyId: text('company_id'), branchId: text('branch_id'), partnerId: text('partner_id').notNull(), partnerName: text('partner_name'), type: text('type').notNull(), amount: real('amount').notNull(), date: text('date').notNull(), description: text('description') });

// --- Manufacturing ---
export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  code: text('code'),
  outputItemId: text('output_item_id').notNull(),
  outputItemName: text('output_item_name'),
  outputQty: real('output_qty').default(1),
  unitName: text('unit_name'),
  lines: text('lines'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const manufacturingOrders = sqliteTable('manufacturing_orders', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  code: text('code').notNull(),
  date: text('date').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  warehouseName: text('warehouse_name'),
  outputItemId: text('output_item_id').notNull(),
  outputItemName: text('output_item_name'),
  outputQty: real('output_qty').notNull(),
  unitCost: real('unit_cost').default(0),
  totalCost: real('total_cost').default(0),
  status: text('status').default('DRAFT'),
  expenseType: text('expense_type').default('FIXED'),
  expenseValue: real('expense_value').default(0),
  items: text('items'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- Expenses ---
export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  code: text('code').notNull(),
  date: text('date').notNull(),
  description: text('description').notNull(),
  totalAmount: real('total_amount').notNull(),
  currency: text('currency').default('USD'),
  paymentType: text('payment_type').default('CASH'),
  cashBoxId: text('cash_box_id'),
  cashBoxName: text('cash_box_name'),
  warehouseId: text('warehouse_id'),
  warehouseName: text('warehouse_name'),
  manufacturingOrderId: text('manufacturing_order_id'),
  status: text('status').default('DRAFT'),
  lines: text('lines'),
  postedAt: text('posted_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- CONSIGNMENT: Documents, Settlements, Commission Profiles ---
export const consignmentDocuments = sqliteTable('consignment_documents', {
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
  issueDate: text('issue_date').notNull(),
  notes: text('notes'),
  currencyId: text('currency_id'),
  exchangeRate: real('exchange_rate').default(1),
  pricingPolicy: text('pricing_policy').default('MANUAL'),
  commissionType: text('commission_type').default('NONE'),
  commissionValue: real('commission_value').default(0),
  totalQty: real('total_qty').default(0),
  totalAmountReference: real('total_amount_reference'),
  createdBy: text('created_by').notNull(),
  postedBy: text('posted_by'),
  postedAt: text('posted_at'),
  cancelledBy: text('cancelled_by'),
  cancelledAt: text('cancelled_at'),
  journalEntryId: integer('journal_entry_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const consignmentDocumentLines = sqliteTable('consignment_document_lines', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  documentId: text('document_id').notNull(),
  itemId: text('item_id').notNull(),
  unitId: text('unit_id'),
  unitName: text('unit_name'),
  unitFactor: real('unit_factor'),
  qty: real('qty').notNull(),
  baseQty: real('base_qty').notNull(),
  serialNumbers: text('serial_numbers'),
  unitCost: real('unit_cost').notNull().default(0),
  referencePrice: real('reference_price'),
  customSalePrice: real('custom_sale_price'),
  commissionType: text('commission_type'),
  commissionValue: real('commission_value').default(0),
  notes: text('notes'),
  settledSoldQty: real('settled_sold_qty').default(0),
  settledReturnedQty: real('settled_returned_qty').default(0),
  remainingQty: real('remaining_qty').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const consignmentSettlements = sqliteTable('consignment_settlements', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  settlementNumber: text('settlement_number').notNull().unique(),
  documentId: text('document_id').notNull(),
  settlementDate: text('settlement_date').notNull(),
  status: text('status').notNull().default('DRAFT'), // DRAFT | POSTED | CANCELLED
  notes: text('notes'),
  totalSoldQty: real('total_sold_qty').default(0),
  totalReturnedQty: real('total_returned_qty').default(0),
  grossSalesAmount: real('gross_sales_amount').default(0),
  grossPurchaseAmount: real('gross_purchase_amount').default(0),
  totalCommission: real('total_commission').default(0),
  netAmount: real('net_amount').default(0),
  createdBy: text('created_by').notNull(),
  postedBy: text('posted_by'),
  postedAt: text('posted_at'),
  cancelledBy: text('cancelled_by'),
  cancelledAt: text('cancelled_at'),
  linkedInvoiceId: text('linked_invoice_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const consignmentSettlementLines = sqliteTable('consignment_settlement_lines', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),
  settlementId: text('settlement_id').notNull(),
  documentLineId: text('document_line_id').notNull(),
  actionType: text('action_type').notNull(), // SOLD | RETURNED | ADJUSTED
  unitId: text('unit_id'),
  unitName: text('unit_name'),
  unitFactor: real('unit_factor'),
  qty: real('qty').notNull(),
  baseQty: real('base_qty').notNull(),
  serialNumbers: text('serial_numbers'),
  unitPrice: real('unit_price'),
  unitCost: real('unit_cost'),
  commissionType: text('commission_type'),
  commissionValue: real('commission_value').default(0),
  lineGrossAmount: real('line_gross_amount').default(0),
  lineCommissionAmount: real('line_commission_amount').default(0),
  lineNetAmount: real('line_net_amount').default(0),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const consignmentCommissionProfiles = sqliteTable('consignment_commission_profiles', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  name: text('name').notNull(),
  appliesTo: text('applies_to').notNull(), // CUSTOMER | SUPPLIER | BOTH
  commissionType: text('commission_type').notNull(), // PERCENT | FIXED_PER_UNIT | FIXED_DOCUMENT
  commissionValue: real('commission_value').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- INVENTORY MOVEMENTS (generic log, used by consignment) ---
export const inventoryMovements = sqliteTable('inventory_movements', {
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
  qty: real('qty').notNull(),
  baseQty: real('base_qty').notNull(),
  textileColorId: text('textile_color_id'),
  textileRollDelta: real('textile_roll_delta').default(0),
  textileLengthDelta: real('textile_length_delta').default(0),
  textileBaseUom: text('textile_base_uom'),
  userId: text('user_id'),
  userName: text('user_name'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- FISCAL PERIODS (Period Closing / إقفال السنة المالية) ---
export const fiscalPeriods = sqliteTable('fiscal_periods', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),

  /** Human-readable label e.g. "2024", "2024-Q1" */
  name: text('name').notNull(),

  /** YYYY-MM-DD */
  startDate: text('start_date').notNull(),

  /** YYYY-MM-DD */
  endDate: text('end_date').notNull(),

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
  netPnl: real('net_pnl'),

  /** Total revenue in period (base currency) */
  totalRevenue: real('total_revenue'),

  /** Total expenses in period (base currency) */
  totalExpenses: real('total_expenses'),

  closedBy: text('closed_by'),
  closedAt: text('closed_at'),
  reopenedBy: text('reopened_by'),
  reopenedAt: text('reopened_at'),
  reopenReason: text('reopen_reason'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
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
export const printTemplates = sqliteTable('print_templates', {
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

  isDefault:   integer('is_default', { mode: 'boolean' }).default(false),
  isActive:    integer('is_active',  { mode: 'boolean' }).default(true),

  /** Toggles */
  showLogo:         integer('show_logo',          { mode: 'boolean' }).default(true),
  showCompanyName:  integer('show_company_name',   { mode: 'boolean' }).default(true),
  showAddress:      integer('show_address',         { mode: 'boolean' }).default(true),
  showPhone:        integer('show_phone',           { mode: 'boolean' }).default(true),
  showTaxNumber:    integer('show_tax_number',      { mode: 'boolean' }).default(false),
  showQrCode:       integer('show_qr_code',         { mode: 'boolean' }).default(false),
  showDiscount:     integer('show_discount',         { mode: 'boolean' }).default(true),
  showTaxBreakdown: integer('show_tax_breakdown',   { mode: 'boolean' }).default(false),
  showFooter:       integer('show_footer',           { mode: 'boolean' }).default(true),
  showSignatureLine:integer('show_signature_line',  { mode: 'boolean' }).default(false),

  /** Custom text fields */
  headerTitle:    text('header_title'),
  headerSubtitle: text('header_subtitle'),
  footerText:     text('footer_text'),

  /** Font size: 'sm' | 'md' | 'lg' */
  fontSize: text('font_size').default('md'),

  createdBy: text('created_by'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Registered printers — one row per physical printer.
 * Used for: automatic printer selection by document type,
 * network printing, bluetooth pairing.
 */
export const printers = sqliteTable('printers', {
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

  isDefault:  integer('is_default',  { mode: 'boolean' }).default(false),
  isActive:   integer('is_active',   { mode: 'boolean' }).default(true),

  /**
   * Codepage for ESC/POS Arabic encoding.
   * 'PC864' | 'CP1256' | 'UTF8'
   */
  codepage: text('codepage').default('UTF8'),

  /** Which document types this printer handles (comma-separated) */
  documentTypes: text('document_types'),

  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
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
export const reconciliationSessions = sqliteTable('reconciliation_sessions', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),

  /** 'party_ar' | 'party_ap' | 'bank' | 'interco' */
  type: text('type').notNull(),

  /** Party being reconciled (customer / supplier id) */
  partyId: text('party_id'),
  partyName: text('party_name'),

  /** ISO date range covered */
  fromDate: text('from_date'),
  toDate: text('to_date'),

  /** 'open' | 'confirmed' | 'cancelled' */
  status: text('status').notNull().default('open'),

  /** Total debit side matched */
  totalDebitMatched: real('total_debit_matched').default(0),

  /** Total credit side matched */
  totalCreditMatched: real('total_credit_matched').default(0),

  /** Net difference posted as write-off (if any) */
  differenceAmount: real('difference_amount').default(0),

  /** Journal entry id for any write-off difference posted */
  writeOffJournalEntryId: integer('write_off_journal_entry_id'),

  /** Tolerance used for auto-match (USD) */
  toleranceAmount: real('tolerance_amount').default(0),

  confirmedBy: text('confirmed_by'),
  confirmedAt: text('confirmed_at'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Each row is one item in a session — either a "debit" document (invoice,
 * debit note) or a "credit" document (receipt, payment, credit note).
 * Matched pairs share the same `matchGroupId`.
 */
export const reconciliationItems = sqliteTable('reconciliation_items', {
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
  refDate: text('ref_date'),

  partyId: text('party_id'),
  partyName: text('party_name'),

  /** Transaction currency (SYP / TRY / USD) */
  currency: text('currency').default('USD'),

  /** Amount in transaction currency */
  amountForeign: real('amount_foreign').default(0),

  /** Amount in base currency (USD) */
  amountBase: real('amount_base').notNull(),

  /** Amount allocated to this match (may be < amountBase for partial match) */
  allocatedBase: real('allocated_base').default(0),

  /** Remaining unmatched base amount */
  remainingBase: real('remaining_base').default(0),

  /** Null = unmatched; shared UUID with paired item = matched */
  matchGroupId: text('match_group_id'),

  /** 'unmatched' | 'matched' | 'partial' | 'written_off' */
  matchStatus: text('match_status').notNull().default('unmatched'),

  /** 'auto' | 'manual' */
  matchMethod: text('match_method'),

  /** Difference within match group (if within tolerance, written off) */
  matchDifference: real('match_difference').default(0),

  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- FX REVALUATION (SAP F.05 equivalent) ---

/**
 * One revaluation run per execution.
 * Records the aggregate results and links to the two journal entries:
 *   - revaluationJournalEntryId  → the unrealized FX gain/loss entry (posted on valuationDate)
 *   - reversalJournalEntryId     → the automatic reversal (posted on first day of next period)
 */
export const fxRevaluationRuns = sqliteTable('fx_revaluation_runs', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  branchId: text('branch_id'),

  /** Date used as "current rate" benchmark (usually last day of period) */
  valuationDate: text('valuation_date').notNull(),

  /** ISO date on which the reversal entry is posted (usually next day) */
  reversalDate: text('reversal_date').notNull(),

  /** SYP rate used for this run */
  rateSyp: real('rate_syp').notNull(),

  /** TRY rate used for this run */
  rateTry: real('rate_try').notNull(),

  status: text('status').notNull().default('draft'), // draft | posted | reversed | cancelled

  /** Total unrealized gain in base currency */
  totalUnrealizedGain: real('total_unrealized_gain').default(0),

  /** Total unrealized loss in base currency */
  totalUnrealizedLoss: real('total_unrealized_loss').default(0),

  /** Net (gain - loss) */
  netUnrealized: real('net_unrealized').default(0),

  /** Number of open items evaluated */
  itemsEvaluated: integer('items_evaluated').default(0),

  /** Journal entry ID for the revaluation posting */
  revaluationJournalEntryId: integer('revaluation_journal_entry_id'),

  /** Journal entry ID for the automatic reversal */
  reversalJournalEntryId: integer('reversal_journal_entry_id'),

  executedBy: text('executed_by'),
  executedAt: text('executed_at'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

/**
 * One row per open invoice/receivable/payable evaluated in a revaluation run.
 * Provides full drill-down: which party, which invoice, what was the FX impact.
 */
export const fxRevaluationLines = sqliteTable('fx_revaluation_lines', {
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
  outstandingForeign: real('outstanding_foreign').notNull(),

  /** Rate at which the balance was originally recorded */
  originalRate: real('original_rate').notNull(),

  /** Base value as originally recorded (outstanding × original rate) */
  bookValueBase: real('book_value_base').notNull(),

  /** Revaluation rate (current market rate) */
  revaluationRate: real('revaluation_rate').notNull(),

  /** Base value at revaluation rate */
  revaluedBase: real('revalued_base').notNull(),

  /** Difference = revaluedBase − bookValueBase */
  unrealizedDiff: real('unrealized_diff').notNull(),

  /** 'gain' | 'loss' | 'none' */
  diffType: text('diff_type').notNull(),

  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- ACTIVATION CODES ---
export const activationCodes = sqliteTable('activation_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  activationType: text('activation_type').notNull().default('local'),
  licenseMission: text('license_mission').notNull().default('LOCAL_STANDALONE'),
  isUsed: integer('is_used', { mode: 'boolean' }).default(false),
  usedAt: text('used_at'),
  computerName: text('computer_name'),
  appVersion: text('app_version'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

/** Idempotency keys for POST /activation/notify-success (client-generated UUID). */
export const activationTelegramDedupe = sqliteTable('activation_telegram_dedupe', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const systemSuperAdmins = sqliteTable('system_super_admins', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  isBootstrap: integer('is_bootstrap', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const licenseExtensions = sqliteTable('license_extensions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  extensionType: text('extension_type').notNull(),
  label: text('label').notNull(),
  payload: text('payload').notNull(),
  appliedBy: text('applied_by').notNull(),
  appliedAt: text('applied_at').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// --- RESTAURANT: tables & sessions (operational; not invoices/POS) ---
export const restaurantTables = sqliteTable('restaurant_tables', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  zoneName: text('zone_name'),
  capacity: integer('capacity'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  notes: text('notes'),
  /** Future: stable public token for QR deep-link (no logic in phase 2). */
  publicQrToken: text('public_qr_token'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const restaurantTableSessions = sqliteTable('restaurant_table_sessions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  tableId: text('table_id').notNull().references(() => restaurantTables.id),
  openedByUserId: text('opened_by_user_id').notNull(),
  closedByUserId: text('closed_by_user_id'),
  /** open | pending_review | ready_to_close | closed */
  sessionStatus: text('session_status').notNull().default('open'),
  guestCount: integer('guest_count'),
  openedAt: text('opened_at').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  closedAt: text('closed_at'),
  preliminaryTotal: real('preliminary_total').notNull().default(0),
  notes: text('notes'),
  source: text('source').notNull().default('cashier'),
  /** Future: QR request inbox (unread count per session). */
  unreadRequestCount: integer('unread_request_count').default(0),
  /** Future: bind to final posted invoice id. */
  finalInvoiceId: text('final_invoice_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const restaurantMenuItems = sqliteTable('restaurant_menu_items', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  itemId: text('item_id').notNull(),
  isVisibleInQr: integer('is_visible_in_qr', { mode: 'boolean' }).notNull().default(true),
  displayNameOverride: text('display_name_override'),
  description: text('description'),
  imageUrl: text('image_url'),
  categoryName: text('category_name'),
  sortOrder: integer('sort_order').notNull().default(0),
  isAvailableNow: integer('is_available_now', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const restaurantTableRequests = sqliteTable('restaurant_table_requests', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  tableId: text('table_id').notNull().references(() => restaurantTables.id),
  sessionId: text('session_id').notNull().references(() => restaurantTableSessions.id),
  publicQrTokenSnapshot: text('public_qr_token_snapshot'),
  requestStatus: text('request_status').notNull().default('new'),
  requestSource: text('request_source').notNull().default('qr'),
  customerSessionToken: text('customer_session_token'),
  submittedAt: text('submitted_at').notNull(),
  seenAt: text('seen_at'),
  acceptedAt: text('accepted_at'),
  rejectedAt: text('rejected_at'),
  archivedAt: text('archived_at'),
  notes: text('notes'),
  clientRequestId: text('client_request_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const restaurantTableRequestItems = sqliteTable('restaurant_table_request_items', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => restaurantTableRequests.id),
  companyId: text('company_id').notNull(),
  branchId: text('branch_id').notNull(),
  itemId: text('item_id').notNull(),
  itemNameSnapshot: text('item_name_snapshot').notNull(),
  itemCodeSnapshot: text('item_code_snapshot'),
  unitNameSnapshot: text('unit_name_snapshot'),
  quantity: real('quantity').notNull(),
  baseUnitPrice: real('base_unit_price').notNull(),
  lineSubtotal: real('line_subtotal').notNull(),
  customerNote: text('customer_note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
