export type AccountType = 'assets' | 'liabilities' | 'equity' | 'revenue' | 'expenses';
export type AccountNature = 'debit' | 'credit';

export interface Account {
  id: number;
  code: string;
  nameAr: string;
  nameEn?: string;
  parentId: number | null;
  level: number;
  accountType: AccountType;
  accountNature: AccountNature;
  isParent: boolean;
  isActive: boolean;
  isSystem: boolean;
  currencyCode?: string;
  branchId?: string | null;
  companyId?: string | null;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  balance?: number;
  totalDebit?: number;
  totalCredit?: number;
  children?: Account[];
}

export interface RemoteBranch {
    id: string;
    name: string;
    employeeName: string;
    ipAddress: string;
    syncInterval: number;
    showFinancials: boolean;
    showInventory: boolean;
    showInvoices: boolean;
    connectionMode?: 'server' | 'client';
    status: 'online' | 'offline';
    lastSeen?: string;
    clientId?: string;
    clientName?: string;
    userId?: string;
    userName?: string;
    deviceLabel?: string;
    platform?: string;
    appVersion?: string;
    userAgent?: string;
    sessionId?: string;
    branchName?: string;
    lastInvoiceNumber?: string | null;
    lastInvoiceAt?: string | null;
    data?: {
        totalSales: number;
        itemsCount: number;
        invoicesCount: number;
        lastUpdate: string;
        recentInvoices?: any[];
        topSelling?: any[];
        agentActiveCount?: number;
        agentInactiveCount?: number;
        agentOnlineCount?: number;
        agentInventoryQty?: number;
        agentInventoryValue?: number;
        agentSalesTotalToday?: number;
        agentSalesCountToday?: number;
    };
}

export interface ReconciliationMark {
  id: string;
  scopeType: 'PARTY' | 'ACCOUNT' | 'ITEM' | 'EMPLOYEE' | 'CASHBOX';
  scopeId: string;
  reportType: 'PARTY_STATEMENT' | 'EXPENSES_REPORT' | 'ITEM_LEDGER' | 'CASHBOX_LEDGER' | 'opening_receivables';
  markAt: string;
  rowRefId?: string;
  note?: string;
  isActive: boolean;
  createdAt: string;
}

export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';

export interface Party {
  id: string;
  name: string;
  type: PartyType;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  taxNo?: string;
  balance: number; 
  isActive: boolean;
  accountId?: number | null;
  arAccountId?: string;
  apAccountId?: string;
  geoLat?: number;
  geoLng?: number;
  geoLabel?: string;
  // Pricing engine
  defaultPricingMode?: 'retail' | 'wholesale' | 'wholesale2' | 'distribution' | 'delegate' | 'pos' | 'custom';
  allowLastPriceOverride?: boolean;
  allowCustomerItemSpecialPrices?: boolean;
  allowManualPriceEdit?: boolean;
  preferredCurrencyForSales?: string;
}

export interface CustomerItemPrice {
  id: string;
  customerId: string;
  itemId: string;
  unitId?: string;
  currencyId?: string;
  price: number;
  minQty?: number;
  isActive?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePartyInput {
  name: string;
  type: PartyType;
  phone?: string;
  email?: string;
  address?: string;
  taxNo?: string;
  openingEntryType?: 'debit' | 'credit' | '';
  openingAmount?: number;
  openingCurrency?: 'USD' | 'SYP' | 'TRY';
}

export type Client = Party;

export interface InventoryItem {
  id: string;
  userId?: string;
  warehouseId?: string;
  warehouseName?: string;
  groupId?: string;
  groupName?: string;
  merged?: boolean;
  inactive?: boolean;
  mergedIntoItemId?: string | null;
  name: string;
  code: string;
  barcode?: string;
  serialNumber?: string;
  serialTracking?: 'none' | 'optional' | 'required';
  categoryId?: string;
  subCategoryId?: string;
  unitId?: string;
  unitName?: string;
  quantity: number;
  rollsCount?: number;
  metersPerRoll?: number;
  costPrice: number;
  salePrice: number;
  wholesalePrice?: number;
  wholesaleWholesalePrice?: number;
  distributionPrice?: number;
  delegatePrice?: number;
  posPrice?: number;
  costPriceBase?: number;
  salePriceBase?: number;
  wholesalePriceBase?: number;
  wholesaleWholesalePriceBase?: number;
  distributionPriceBase?: number;
  delegatePriceBase?: number;
  posPriceBase?: number;
  priceCurrency?: string;
  itemType?: 'STOCK' | 'SERVICE' | 'NON_STOCK';
  imageUrl?: string;
  minStockAlert?: number;
  model?: string;
  dimensions?: string;
  color?: string;
  origin?: string;
  manufacturer?: string;
  grossWeight?: number;
  netWeight?: number;
  isScaleItem?: boolean;
  scalePluCode?: string;
  scaleBarcodePrefix?: string;
  scaleBarcodeMode?: 'weight' | 'price';
  scaleUnit?: 'gram' | 'kilogram';
  scalePricePerKg?: number;
  scaleItemCodeLength?: number;
  scaleValueLength?: number;
  scaleDecimals?: number;
  isTextile?: boolean;
  textileBaseUom?: 'meter' | 'yard' | null;
  supportsColorDimension?: boolean;
  notes?: string;
  lastUpdated: string;
}

export interface TextileColor {
  id: string;
  code?: string | null;
  name: string;
  normalizedName?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TextileInventoryBalance {
  id: string;
  companyId?: string | null;
  branchId?: string | null;
  warehouseId: string;
  warehouseName?: string | null;
  itemId: string;
  itemName?: string;
  itemCode?: string;
  colorId: string;
  colorName?: string;
  baseUom: 'meter' | 'yard';
  rollCount: number;
  totalLength: number;
  updatedAt?: string;
}

export interface ItemSerial {
  id: string;
  itemId: string;
  serialNumber: string;
  warehouseId?: string;
  status: 'available' | 'reserved' | 'sold' | 'returned' | 'damaged';
  purchaseInvoiceId?: string;
  salesInvoiceId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemBarcode {
  id: string;
  itemId: string;
  barcode: string;
  unitId?: string;
  createdAt?: string;
}

export type PromotionDiscountType = 'percentage' | 'amount' | 'special_price' | 'buy_quantity_discount';

export interface Promotion {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  offerBarcode?: string;
  description?: string;
  discountType: PromotionDiscountType;
  discountPercent?: number;
  discountValue?: number;
  specialPrice?: number;
  buyQuantity?: number;
  getDiscountPercent?: number;
  primaryItemId?: string;
  itemIds: string[];
  mainImageUrl?: string;
  extraImageUrls?: string[];
  displayOrder?: number;
  displayDurationSeconds?: number;
  showOnDisplay?: boolean;
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
}

export interface PromotionResolution {
  promotionId: string;
  promotionName: string;
  originalPrice: number;
  finalPrice: number;
  discountAmount: number;
  label: string;
}

export type PriceFieldKey = 'sale_price' | 'purchase_price' | 'wholesale_price' | 'pos_price';

export type BulkPriceScope = 'single' | 'selected' | 'all' | 'category' | 'unit' | 'group';

export type BulkPriceOperation =
  | 'add_fixed'
  | 'add_percentage'
  | 'set_profit_margin'
  | 'adjust_exchange_rate'
  | 'copy_from_other_price';

export type FixedAmountMode = 'item_currency' | 'usd' | 'syp';

export interface BulkPriceUpdatePayload {
  scope: BulkPriceScope;
  itemIds?: string[];
  categoryId?: string;
  unitId?: string;
  groupId?: string;
  targetField: PriceFieldKey;
  operation: BulkPriceOperation;
  useDailyExchangeRate?: boolean;
  amount?: number;
  amountMode?: FixedAmountMode;
  percentage?: number;
  marginPercent?: number;
  exchangeRate?: number;
  sourceField?: PriceFieldKey;
  notes?: string;
}

export interface PriceUpdatePreviewRow {
  itemId: string;
  itemName: string;
  itemCode: string;
  priceCurrency: string;
  targetField: PriceFieldKey;
  oldValue: number;
  newValue: number;
  delta: number;
  differencePercent: number;
  hasLargeDifference: boolean;
}

export interface PriceUpdatePreviewResult {
  affectedCount: number;
  rows: PriceUpdatePreviewRow[];
  skippedIds: string[];
}

export interface BulkPriceUpdateRequest {
  mode: 'preview' | 'execute';
  payload: BulkPriceUpdatePayload;
  userId: string;
  currencyRates?: Record<string, number>;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  timestamp: string;
  operationType: string;
  affectedItems: string[];
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  meta?: Record<string, any>;
}

export type SystemEventSeverity = 'info' | 'warning' | 'error' | 'critical';
export type SystemEventStatus = 'success' | 'failed' | 'compensated' | 'partial';

export interface SystemEvent {
  id: string;
  eventType: string;
  severity: SystemEventSeverity;
  sourceModule: string;
  action: string;
  status: SystemEventStatus;
  errorCode?: string | null;
  requiresManualReview: boolean;
  affectedDocumentType?: string | null;
  affectedDocumentId?: string | null;
  compensationStatus?: Record<string, any> | null;
  metadata: Record<string, any>;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}

export interface SystemEventsResponse {
  items: SystemEvent[];
  total: number;
  summary: {
    total: number;
    resolvedCount?: number;
    activeCount?: number;
    criticalCount: number;
    manualReviewCount: number;
    failedCount: number;
  };
}

export interface ItemGroup {
  id: string;
  name: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemGroupItem {
  id: string;
  groupId: string;
  itemId: string;
  createdAt?: string;
}

export interface ItemMergePreview {
  sourceItemId: string;
  targetItemId: string;
  sourceItemName: string;
  targetItemName: string;
  quantityToTransfer: number;
  affectedInvoiceCount: number;
  affectedInvoiceLineCount: number;
  affectedTransferCount: number;
  affectedAgentInventoryCount: number;
  affectedDeliveryNoticeCount: number;
  affectedItemGroupLinks: number;
  affectedInventoryTransactionCount: number;
  affectedRecordsCount: number;
  warnings: string[];
}

export interface ItemMergeResult {
  success: boolean;
  sourceItemId: string;
  targetItemId: string;
  transferredQuantity: number;
  affectedRecordsCount: number;
  affectedInvoiceCount: number;
  affectedInvoiceLineCount: number;
  affectedTransferCount: number;
  affectedAgentInventoryCount: number;
  affectedDeliveryNoticeCount: number;
  affectedItemGroupLinks: number;
  affectedInventoryTransactionCount: number;
}

export interface InvoiceItem {
  itemId: string;
  itemName: string;
  fabricId?: string; 
  fabricName?: string; 
  quantity: number;
  unitPrice: number;
  rollsSold?: number;
  metersSold?: number;
  yardsSold?: number;
  priceAtSale?: number;
  total: number;
  unitName?: string;
  unitId?: string;
  baseUnitId?: string;
  baseQuantity?: number;
  unitFactor?: number;
  costAtSale?: number;
  isReturn?: boolean;
  serialNumbers?: string[];
  promotionId?: string;
  promotionName?: string;
  originalUnitPrice?: number;
  promotionDiscountAmount?: number;
  // Commission support
  commissionType?: 'NONE' | 'PERCENT' | 'FIXED_PER_UNIT' | 'FIXED_LINE';
  commissionValue?: number;
  commissionAmount?: number;
  // Pricing engine metadata
  pricingModeApplied?: string;
  pricingSource?: string;
  autoResolvedUnitPrice?: number;
  isManualPriceOverride?: boolean;
  lastPurchasePrice?: number;
  availableQty?: number;
  isTextile?: boolean;
  textileColorId?: string;
  textileColorName?: string;
  textileRollCount?: number;
  textileTotalLength?: number;
  textileBaseUom?: 'meter' | 'yard';
  textileUnitPricePerLength?: number;
  textileDecompositionPayload?: Array<{
    sequence: number;
    lengthValue: number;
    unit: 'meter' | 'yard';
    rollLabel?: string | null;
  }>;
  sourceDispatchLineId?: string;
}

export type InvoiceType = 'sale' | 'purchase' | 'return' | 'exchange' | 'opening_stock';
export type InvoiceStatus = 'draft' | 'posted' | 'void';

export type InvoiceStockStatus = 'ACTIVE' | 'LOCKED';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  originalInvoiceNumber?: string;
  type: InvoiceType;
  returnType?: 'sale' | 'purchase';
  status: InvoiceStatus;
  paymentType: 'cash' | 'credit';
  clientId: string;
  clientName: string;
  date: string;
  items: InvoiceItem[];
  totalAmount: number;
  discount?: number;
  paidAmount: number;
  remainingAmount: number;
  currency: string;
  originalAmount?: number;
  exchangeRate?: number;
  applyStock?: boolean;
  stockStatus?: InvoiceStockStatus;
  createdById?: string;
  createdByName?: string;
  createdByRole?: string;
  agentId?: string;
  agentName?: string;
  agentUserId?: string;
  geoLat?: number;
  geoLng?: number;
  geoLabel?: string;
  targetWarehouseId?: string;
  targetWarehouseName?: string;
  notes?: string;
  /** POS queue token (stable; from server at sale time). */
  queueNumber?: string;
  customerPrintedAt?: string;
  kitchenPrintedAt?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  createdAt: string;
}

export type TextileDispatchStatus =
  | 'draft'
  | 'sent_to_warehouse'
  | 'in_preparation'
  | 'prepared'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'converted_to_invoice'
  | 'cancelled';

export interface TextileDispatchDecompositionEntry {
  id?: string;
  lineId?: string;
  sequence: number;
  lengthValue: number;
  unit: 'meter' | 'yard';
  rollLabel?: string | null;
}

export interface TextileDispatchLine {
  id?: string;
  itemId: string;
  itemName?: string;
  colorId: string;
  colorName?: string;
  requestedRollCount: number;
  fulfilledRollCount?: number;
  fulfilledTotalLength?: number;
  baseUom: 'meter' | 'yard';
  textileUnitPricePerLength?: number;
  notes?: string;
  decomposition?: TextileDispatchDecompositionEntry[];
}

export interface TextileDispatchNotice {
  id: string;
  dispatchNumber: string;
  status: TextileDispatchStatus;
  warehouseId: string;
  warehouseName?: string;
  customerId?: string | null;
  customerName?: string | null;
  notes?: string | null;
  linkedInvoiceId?: string | null;
  requestedBy?: string | null;
  requestedByName?: string | null;
  preparedBy?: string | null;
  preparedByName?: string | null;
  approvedBy?: string | null;
  approvedByName?: string | null;
  rejectedReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lines?: TextileDispatchLine[];
}

// --- INVOICE MOVEMENT TYPES ---
export interface InvoiceMovement {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  clientId: string;
  clientName: string;
  date: string;
  totalAmount: number;
  currency: string;
  stockStatus: InvoiceStockStatus;
  warehouseId?: string;
  warehouseName?: string;
  createdAt: string;
}

export interface InvoiceMovementLog {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  action: 'LOCK' | 'ACTIVATE';
  fromStatus: InvoiceStockStatus | null;
  toStatus: InvoiceStockStatus;
  reason?: string;
  userId: string;
  userName: string;
  createdAt: string;
}

// --- UNIT MANAGEMENT TYPES ---
export interface Unit {
  id: string;
  name: string;
  isBase: boolean;
  baseUnitId?: string;
  baseUnitName?: string;
  factor: number;
  multiplier: number;
  createdAt?: string;
}

// Helper type for unit conversion
export interface UnitConversionResult {
  fromUnitId: string;
  toUnitId: string;
  inputQuantity: number;
  outputQuantity: number;
  factor: number;
}

export interface CashBox {
  id: string;
  name: string;
  type: 'main' | 'sub';
  balance: number;
  currency: string;
  accountId?: number | null;
  companyId?: string;
  branchId?: string | null;
  isActive?: boolean;
}

export interface Voucher {
  id: string;
  type: 'receipt' | 'payment';
  status: 'DRAFT' | 'POSTED';
  date: string;
  amount: number;
  originalAmount?: number;
  currency?: string;
  exchangeRate?: number;
  cashBoxId: string;
  cashBoxName: string;
  clientId?: string;
  clientName?: string;
  category: string;
  description: string;
  referenceNumber?: string;
  linkedInvoiceId?: string;
  journalEntryId?: number | null;
  companyId?: string;
  branchId?: string | null;
  createdAt?: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code?: string;
  location: string;
  manager: string;
  companyId?: string;
  branchId?: string;
  isActive?: boolean;
  warehouseKind?: string;
}

// --- Consignment module ---
export type ConsignmentDirection = 'OUT_CUSTOMER' | 'IN_SUPPLIER';
export type ConsignmentDocStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_SETTLED' | 'FULLY_SETTLED' | 'CANCELLED';
export type ConsignmentSettlementStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export type ConsignmentLineActionType = 'SOLD' | 'RETURNED' | 'ADJUSTED';

export interface ConsignmentDocument {
  id: string;
  documentNumber: string;
  direction: ConsignmentDirection;
  status: ConsignmentDocStatus;
  partyType: string;
  partyId: string;
  sourceWarehouseId?: string;
  /** For IN_SUPPLIER: external/supplier reference (not our warehouse) */
  supplierReference?: string;
  consignmentWarehouseId: string;
  /** Document currency — all line prices and totals are in this currency */
  currency?: string;
  currencyCode?: string;
  issueDate: string;
  notes?: string;
  totalQty?: number;
  createdBy: string;
  postedBy?: string;
  postedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConsignmentDocumentLine {
  id: string;
  documentId: string;
  itemId: string;
  unitId?: string;
  unitName?: string;
  unitFactor?: number;
  qty: number;
  baseQty: number;
  serialNumbers?: string;
  /** Consignment cost per base unit (سعر الأمانة) */
  unitCost?: number;
  referencePrice?: number;
  /** Sale price per base unit (سعر البيع) */
  customSalePrice?: number;
  /** Line-level commission amount (العمولة) */
  commissionAmount?: number;
  settledSoldQty?: number;
  settledReturnedQty?: number;
  remainingQty?: number;
  notes?: string;
}

export interface ConsignmentSettlement {
  id: string;
  settlementNumber: string;
  documentId: string;
  settlementDate: string;
  status: ConsignmentSettlementStatus;
  notes?: string;
  totalSoldQty?: number;
  totalReturnedQty?: number;
  grossSalesAmount?: number;
  grossPurchaseAmount?: number;
  linkedInvoiceId?: string;
  createdBy: string;
  postedBy?: string;
  postedAt?: string;
}

export interface ConsignmentSettlementLine {
  id: string;
  settlementId: string;
  documentLineId: string;
  actionType: ConsignmentLineActionType;
  qty: number;
  baseQty: number;
  serialNumbers?: string;
  unitPrice?: number;
  unitCost?: number;
}

export interface ConsignmentSettings {
  supplierPolicy?: 'REAL_LEDGER' | 'MEMO_ONLY';
  customerConsignmentInventoryAccountId?: number | string;
  supplierConsignmentInventoryAccountId?: number | string;
  supplierLiabilityAccountId?: number | string;
}

export interface Branch {
  id: string;
  companyId?: string;
  name: string;
  code?: string;
  isMain?: boolean;
  isActive?: boolean;
  location: string;
  manager: string;
  phone: string;
  notes: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Agent {
  id: string;
  companyId?: string;
  branchId?: string;
  userId?: string;
  name: string;
  phone?: string;
  vehicle?: string;
  vehicleImage?: string;
  certificateImage?: string;
  notes?: string;
  isActive?: boolean;
  commissionRate?: number;
  commissionCurrency?: string;
  lastLat?: number;
  lastLng?: number;
  lastSeenAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type Currency = 'USD' | 'SYP' | 'TRY';
export type OpeningAccountType = 'customer' | 'supplier' | 'cash_box' | 'account';

export interface OpeningStockLine {
  id: string;
  item_id: string | null;
  item_name: string;
  item_code: string;
  unit: string;
  quantity: number;
  cost_price: number;
  currency: Currency;
  warehouse_id: string | null;
  total: number;
  notes: string;
}

export interface OpeningBalanceLine {
  id: string;
  account_type: OpeningAccountType;
  account_id: string | null;
  account_name: string;
  debit: number;
  credit: number;
  currency: Currency;
  notes: string;
}

export interface CurrencyBalance {
  currency: Currency;
  total_debit: number;
  total_credit: number;
  difference: number;
  is_balanced: boolean;
  is_used: boolean;
}

export interface AgentInventoryLine {
  id: string;
  companyId?: string;
  branchId?: string;
  agentId: string;
  itemId: string;
  itemName?: string;
  unitName?: string;
  quantity: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentTransfer {
  id: string;
  companyId?: string;
  branchId?: string;
  agentId: string;
  agentName?: string;
  transferType?: 'transfer' | 'return' | 'reconcile';
  status?: 'posted' | 'failed' | 'manual_review';
  warehouseId?: string;
  warehouseName?: string;
  createdById?: string;
  createdByName?: string;
  items?: any[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentTransferLine {
  id: string;
  transferId: string;
  agentId: string;
  itemId: string;
  itemName?: string;
  unitName?: string;
  quantity: number;
  warehouseId?: string;
  warehouseName?: string;
  createdAt?: string;
}

export interface AgentInventoryMovement {
  id: string;
  agentId: string;
  itemId: string;
  itemName?: string;
  unitName?: string;
  qty: number;
  baseQty: number;
  movementType: string;
  documentType: string;
  documentId: string;
  documentNumber?: string;
  documentLineId?: string;
  warehouseId?: string;
  warehouseName?: string;
  userId?: string;
  userName?: string;
  notes?: string;
  createdAt?: string;
}

export type DeliveryNoticeStatus = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';

export interface DeliveryNoticeItem {
  itemId: string;
  itemName: string;
  unitName?: string;
  availableQty?: number;
  quantity: number;
  unitPrice?: number;
  notes?: string;
  isTextile?: boolean;
  textileColorId?: string;
  textileColorName?: string;
  textileRollCount?: number;
  textileTotalLength?: number;
  textileBaseUom?: 'meter' | 'yard';
  textileDecomposition?: Array<{
    idx: number;
    length: number;
    unit?: 'meter' | 'yard';
    rollLabel?: string;
  }>;
  textilePreparationCompleted?: boolean;
  textilePreparedById?: string;
  textilePreparedByName?: string;
  textilePreparedAt?: string;
}

export interface DeliveryNoticeAuditEntry {
  action: string;
  byId?: string;
  byName?: string;
  at: string;
  reason?: string;
}

export interface DeliveryNotice {
  id: string;
  status: DeliveryNoticeStatus;
  warehouseId: string;
  warehouseName?: string;
  receiverType?: string;
  receiverId?: string;
  receiverName?: string;
  notes?: string;
  date: string;
  items: DeliveryNoticeItem[];
  audit?: DeliveryNoticeAuditEntry[];
  createdById?: string;
  createdByName?: string;
  submittedById?: string;
  submittedByName?: string;
  submittedAt?: string;
  confirmedById?: string;
  confirmedByName?: string;
  confirmedAt?: string;
  rejectedById?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectReason?: string;
  managerNotes?: string;
  referenceNumber?: string;
  operationType?: string;
  convertToInvoice?: boolean;
  linkedInvoiceId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Category { id: string; name: string; }
export interface SubCategory { id: string; name: string; categoryId: string; }

export interface Partner {
  id: string;
  name: string;
  type: 'capital' | 'operational' | 'mixed';
  percentage: number;
  capitalAmount: number;
  currentBalance: number;
  joinDate: string;
  status: 'active' | 'inactive';
  linkedClientId?: string;
}

export interface PartnerTransaction {
  id: string;
  partnerId: string;
  partnerName: string;
  type: 'capital_injection' | 'capital_withdrawal' | 'profit_distribution' | 'profit_withdrawal';
  amount: number;
  date: string;
  description: string;
  relatedVoucherId?: string;
}

export type UserRole = 'admin' | 'manager' | 'accountant' | 'warehouse_keeper' | 'textile_warehouse_keeper' | 'hr_officer' | 'production_manager' | 'cashier' | 'agent';

export interface AppUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  permissions: string[];
  companyId?: string;
  allowedCompanyIds?: string[];
  defaultBranchId?: string | null;
  currentBranchId?: string | null;
  allowedBranchIds?: string[];
  requiresBranchSelection?: boolean;
  branchScope?: 'restricted' | 'company_wide' | string;
  posWarehouseId?: string;
  posWarehouseName?: string;
  isActive?: boolean;
}

export const PERMISSIONS = {
  VIEW_INVENTORY: 'view_inventory',
  MANAGE_INVENTORY: 'manage_inventory',
  PRICE_EDIT: 'price_edit',
  PRICE_BULK_EDIT: 'price_bulk_edit',
  EXCHANGE_RATE_UPDATE: 'exchange_rate_update',
  GROUP_MANAGE: 'group_manage',
  ITEM_MERGE: 'item_merge',
  VIEW_COST_PRICE: 'view_cost_price',
  MANAGE_STOCKTAKING: 'manage_stocktaking',
  MANAGE_DELIVERY_NOTICES: 'manage_delivery_notices',
  APPROVE_DELIVERY_NOTICES: 'approve_delivery_notices',
  ACCESS_POS: 'access_pos',
  POS_ONLY: 'pos_only',
  POS_CASHIER: 'pos_cashier',
  MANAGE_POS_CURRENCY: 'manage_pos_currency',
  AUTO_PRINT_POS_RECEIPT: 'auto_print_pos_receipt',
  AGENT_MODE_RESTRICTED: 'agent_mode_restricted',
  CREATE_SALE_INVOICE: 'create_sale_invoice',
  CREATE_PURCHASE_INVOICE: 'create_purchase_invoice',
  MANAGE_CLIENTS: 'manage_clients',
  VIEW_FUNDS: 'view_funds',
  MANAGE_VOUCHERS: 'manage_vouchers',
  VIEW_PROFITS: 'view_profits',
  MANAGE_PARTNERS: 'manage_partners',
  VIEW_ACCOUNTS: 'view_accounts',
  MANAGE_ACCOUNTS: 'manage_accounts',
  MANAGE_EXPENSES: 'manage_expenses',
  VIEW_EMPLOYEES: 'view_employees',
  MANAGE_EMPLOYEES: 'manage_employees',
  MANAGE_PAYROLL: 'manage_payroll',
  VIEW_RECIPES: 'view_recipes',
  MANAGE_RECIPES: 'manage_recipes',
  MANAGE_PRODUCTION: 'manage_production',
  MANAGE_AGENTS: 'manage_agents',
  MANAGE_USERS: 'manage_users',
  MANAGE_SETTINGS: 'manage_settings',
  VIEW_REPORTS: 'view_reports',
  MANAGE_UNITS: 'manage_units',
  MANAGE_INVOICE_MOVEMENTS: 'manage_invoice_movements',
  VIEW_CONSIGNMENTS: 'view_consignments',
  /** عرض قسم المطعم (شاشات placeholder — منطق تشغيلي لاحقًا) */
  VIEW_RESTAURANT_MODULE: 'view_restaurant_module',
  MANAGE_RESTAURANT_TABLES: 'manage_restaurant_tables',
  MANAGE_RESTAURANT_SESSIONS: 'manage_restaurant_sessions',
  VIEW_TEXTILE_DISPATCH_MODULE: 'view_textile_dispatch_module',
  OPEN_TEXTILE_DISPATCH_DOCUMENT: 'open_textile_dispatch_document',
  MANAGE_TEXTILE_DISPATCH_REQUESTS: 'manage_textile_dispatch_requests',
  DECOMPOSE_TEXTILE_DISPATCH: 'decompose_textile_dispatch',
  UPDATE_TEXTILE_DISPATCH_PREPARATION: 'update_textile_dispatch_preparation',
  CONFIRM_TEXTILE_DISPATCH_PREPARATION: 'confirm_textile_dispatch_preparation',
  PRINT_TEXTILE_DISPATCH_DOCUMENT: 'print_textile_dispatch_document',
  VIEW_TEXTILE_STOCK_CONTEXT: 'view_textile_stock_context',
  APPROVE_TEXTILE_DISPATCH: 'approve_textile_dispatch',
  CONVERT_TEXTILE_DISPATCH_TO_INVOICE: 'convert_textile_dispatch_to_invoice',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: Object.values(PERMISSIONS),
  manager: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.PRICE_EDIT, PERMISSIONS.PRICE_BULK_EDIT, PERMISSIONS.EXCHANGE_RATE_UPDATE, PERMISSIONS.VIEW_COST_PRICE,
    PERMISSIONS.GROUP_MANAGE, PERMISSIONS.ITEM_MERGE,
    PERMISSIONS.MANAGE_DELIVERY_NOTICES, PERMISSIONS.APPROVE_DELIVERY_NOTICES,
    PERMISSIONS.ACCESS_POS, PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.CREATE_PURCHASE_INVOICE, PERMISSIONS.MANAGE_CLIENTS,
    PERMISSIONS.VIEW_FUNDS, PERMISSIONS.MANAGE_VOUCHERS,     PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.VIEW_RECIPES, PERMISSIONS.VIEW_ACCOUNTS,
    PERMISSIONS.MANAGE_AGENTS, PERMISSIONS.MANAGE_UNITS, PERMISSIONS.MANAGE_INVOICE_MOVEMENTS, PERMISSIONS.VIEW_CONSIGNMENTS,
    PERMISSIONS.VIEW_RESTAURANT_MODULE, PERMISSIONS.MANAGE_RESTAURANT_TABLES, PERMISSIONS.MANAGE_RESTAURANT_SESSIONS,
    PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE, PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT, PERMISSIONS.MANAGE_TEXTILE_DISPATCH_REQUESTS,
    PERMISSIONS.DECOMPOSE_TEXTILE_DISPATCH, PERMISSIONS.UPDATE_TEXTILE_DISPATCH_PREPARATION, PERMISSIONS.CONFIRM_TEXTILE_DISPATCH_PREPARATION,
    PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT, PERMISSIONS.VIEW_TEXTILE_STOCK_CONTEXT, PERMISSIONS.APPROVE_TEXTILE_DISPATCH, PERMISSIONS.CONVERT_TEXTILE_DISPATCH_TO_INVOICE,
  ],
  accountant: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.PRICE_EDIT, PERMISSIONS.PRICE_BULK_EDIT, PERMISSIONS.EXCHANGE_RATE_UPDATE, PERMISSIONS.GROUP_MANAGE,
    PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.CREATE_PURCHASE_INVOICE, PERMISSIONS.MANAGE_CLIENTS,
    PERMISSIONS.VIEW_FUNDS, PERMISSIONS.MANAGE_VOUCHERS, PERMISSIONS.VIEW_PROFITS, PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_ACCOUNTS, PERMISSIONS.MANAGE_ACCOUNTS, PERMISSIONS.MANAGE_EXPENSES, PERMISSIONS.MANAGE_PAYROLL,
    PERMISSIONS.MANAGE_INVOICE_MOVEMENTS, PERMISSIONS.VIEW_CONSIGNMENTS,
    PERMISSIONS.VIEW_RESTAURANT_MODULE,
    PERMISSIONS.MANAGE_RESTAURANT_TABLES,
    PERMISSIONS.MANAGE_RESTAURANT_SESSIONS,
    PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE, PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT, PERMISSIONS.MANAGE_TEXTILE_DISPATCH_REQUESTS,
    PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT, PERMISSIONS.VIEW_TEXTILE_STOCK_CONTEXT, PERMISSIONS.APPROVE_TEXTILE_DISPATCH, PERMISSIONS.CONVERT_TEXTILE_DISPATCH_TO_INVOICE,
  ],
  cashier: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.ACCESS_POS, PERMISSIONS.POS_CASHIER, PERMISSIONS.MANAGE_POS_CURRENCY, PERMISSIONS.AUTO_PRINT_POS_RECEIPT, PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.MANAGE_CLIENTS
  ],
  warehouse_keeper: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.GROUP_MANAGE, PERMISSIONS.ITEM_MERGE, PERMISSIONS.MANAGE_STOCKTAKING,
    PERMISSIONS.MANAGE_DELIVERY_NOTICES, PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.MANAGE_UNITS, PERMISSIONS.VIEW_CONSIGNMENTS
  ],
  textile_warehouse_keeper: [
    PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE,
    PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT,
    PERMISSIONS.DECOMPOSE_TEXTILE_DISPATCH,
    PERMISSIONS.UPDATE_TEXTILE_DISPATCH_PREPARATION,
    PERMISSIONS.CONFIRM_TEXTILE_DISPATCH_PREPARATION,
    PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT,
  ],
  agent: [
    PERMISSIONS.VIEW_INVENTORY,
    PERMISSIONS.ACCESS_POS,
    PERMISSIONS.CREATE_SALE_INVOICE,
    PERMISSIONS.MANAGE_CLIENTS,
    PERMISSIONS.AGENT_MODE_RESTRICTED,
  ],
  hr_officer: [
    PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.MANAGE_EMPLOYEES, PERMISSIONS.MANAGE_PAYROLL, PERMISSIONS.VIEW_REPORTS,
  ],
  production_manager: [
    PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.VIEW_RECIPES, PERMISSIONS.MANAGE_RECIPES, PERMISSIONS.MANAGE_PRODUCTION
  ]
};

export const PERMISSION_GROUPS = {
    inventory: { label: 'المخزون والمستودعات', keys: [PERMISSIONS.VIEW_INVENTORY, PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.VIEW_COST_PRICE, PERMISSIONS.PRICE_EDIT, PERMISSIONS.PRICE_BULK_EDIT, PERMISSIONS.EXCHANGE_RATE_UPDATE, PERMISSIONS.GROUP_MANAGE, PERMISSIONS.ITEM_MERGE, PERMISSIONS.MANAGE_STOCKTAKING, PERMISSIONS.MANAGE_DELIVERY_NOTICES, PERMISSIONS.APPROVE_DELIVERY_NOTICES, PERMISSIONS.MANAGE_UNITS] },
    sales: { label: 'المبيعات والعملاء', keys: [PERMISSIONS.ACCESS_POS, PERMISSIONS.POS_ONLY, PERMISSIONS.POS_CASHIER, PERMISSIONS.MANAGE_POS_CURRENCY, PERMISSIONS.AUTO_PRINT_POS_RECEIPT, PERMISSIONS.AGENT_MODE_RESTRICTED, PERMISSIONS.CREATE_SALE_INVOICE, PERMISSIONS.CREATE_PURCHASE_INVOICE, PERMISSIONS.MANAGE_CLIENTS, PERMISSIONS.MANAGE_INVOICE_MOVEMENTS] },
    textile: {
      label: 'تشغيل الأقمشة والمستودع',
      keys: [
        PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE,
        PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT,
        PERMISSIONS.MANAGE_TEXTILE_DISPATCH_REQUESTS,
        PERMISSIONS.DECOMPOSE_TEXTILE_DISPATCH,
        PERMISSIONS.UPDATE_TEXTILE_DISPATCH_PREPARATION,
        PERMISSIONS.CONFIRM_TEXTILE_DISPATCH_PREPARATION,
        PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT,
        PERMISSIONS.VIEW_TEXTILE_STOCK_CONTEXT,
        PERMISSIONS.APPROVE_TEXTILE_DISPATCH,
        PERMISSIONS.CONVERT_TEXTILE_DISPATCH_TO_INVOICE,
      ],
    },
    finance: { label: 'المالية والمحاسبة', keys: [PERMISSIONS.VIEW_FUNDS, PERMISSIONS.MANAGE_VOUCHERS, PERMISSIONS.VIEW_ACCOUNTS, PERMISSIONS.MANAGE_ACCOUNTS, PERMISSIONS.MANAGE_EXPENSES, PERMISSIONS.VIEW_PROFITS, PERMISSIONS.MANAGE_PARTNERS] },
    hr: { label: 'الموارد البشرية (HR)', keys: [PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.MANAGE_EMPLOYEES, PERMISSIONS.MANAGE_PAYROLL] },
    manufacturing: { label: 'قسم التصنيع والإنتاج', keys: [PERMISSIONS.VIEW_RECIPES, PERMISSIONS.MANAGE_RECIPES, PERMISSIONS.MANAGE_PRODUCTION] },
    admin: { label: 'الإدارة والتقارير العامة', keys: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.VIEW_REPORTS, PERMISSIONS.MANAGE_AGENTS] },
    restaurant: {
      label: 'المطعم',
      keys: [
        PERMISSIONS.VIEW_RESTAURANT_MODULE,
        PERMISSIONS.MANAGE_RESTAURANT_TABLES,
        PERMISSIONS.MANAGE_RESTAURANT_SESSIONS,
      ],
    },
};

PERMISSION_GROUPS.inventory.keys = [
  PERMISSIONS.VIEW_INVENTORY,
  PERMISSIONS.MANAGE_INVENTORY,
  PERMISSIONS.PRICE_EDIT,
  PERMISSIONS.PRICE_BULK_EDIT,
  PERMISSIONS.EXCHANGE_RATE_UPDATE,
  PERMISSIONS.GROUP_MANAGE,
  PERMISSIONS.ITEM_MERGE,
  PERMISSIONS.VIEW_COST_PRICE,
  PERMISSIONS.MANAGE_STOCKTAKING,
  PERMISSIONS.MANAGE_DELIVERY_NOTICES,
  PERMISSIONS.APPROVE_DELIVERY_NOTICES,
  PERMISSIONS.MANAGE_UNITS,
];

export const PERMISSION_LABELS: Record<string, string> = {
    [PERMISSIONS.VIEW_INVENTORY]: 'عرض المخزون',
    [PERMISSIONS.MANAGE_INVENTORY]: 'إدارة الأصناف والمواد',
    [PERMISSIONS.VIEW_COST_PRICE]: 'عرض أسعار التكلفة (حساس)',
    [PERMISSIONS.MANAGE_STOCKTAKING]: 'إجراء الجرد السنوي',
    [PERMISSIONS.ACCESS_POS]: 'دخول نقطة البيع (POS)',
    [PERMISSIONS.POS_ONLY]: 'وضع نقطة البيع فقط (إظهار POS فقط)',
    [PERMISSIONS.POS_CASHIER]: 'صلاحيات كاشير نقطة البيع',
    [PERMISSIONS.MANAGE_POS_CURRENCY]: 'اختيار العملة في نقطة البيع',
    [PERMISSIONS.AUTO_PRINT_POS_RECEIPT]: 'طباعة تلقائية لفاتورة الحرارية',
    [PERMISSIONS.AGENT_MODE_RESTRICTED]: 'وضع المندوب المقيد (واجهة المندوب فقط)',
    [PERMISSIONS.CREATE_SALE_INVOICE]: 'إصدار فواتير المبيعات',
    [PERMISSIONS.CREATE_PURCHASE_INVOICE]: 'إصدار فواتير المشتريات',
    [PERMISSIONS.MANAGE_CLIENTS]: 'إدارة العناوين والحسابات',
    [PERMISSIONS.VIEW_FUNDS]: 'عرض أرصدة الصناديق',
    [PERMISSIONS.MANAGE_VOUCHERS]: 'إصدار سندات القبض والدفع',
    [PERMISSIONS.VIEW_PROFITS]: 'عرض تقارير الأرباح',
    [PERMISSIONS.MANAGE_PARTNERS]: 'إدارة حسابات الشركاء',
    [PERMISSIONS.VIEW_ACCOUNTS]: 'عرض شجرة الحسابات',
    [PERMISSIONS.MANAGE_ACCOUNTS]: 'تعديل الدليل المحاسبي',
    [PERMISSIONS.MANAGE_EXPENSES]: 'إدارة وتوزيع المصاريف',
    [PERMISSIONS.VIEW_EMPLOYEES]: 'عرض سجلات الموظفين',
    [PERMISSIONS.MANAGE_EMPLOYEES]: 'إدارة شؤون الموظفين',
    [PERMISSIONS.MANAGE_PAYROLL]: 'معالجة الرواتب والسلف',
    [PERMISSIONS.VIEW_RECIPES]: 'عرض وصفات الإنتاج',
    [PERMISSIONS.MANAGE_RECIPES]: 'تعديل تركيبات المواد',
    [PERMISSIONS.MANAGE_PRODUCTION]: 'بدء أوامر التصنيع',
    [PERMISSIONS.MANAGE_USERS]: 'إدارة مستخدمي النظام',
    [PERMISSIONS.MANAGE_SETTINGS]: 'تعديل إعدادات النظام',
    [PERMISSIONS.VIEW_REPORTS]: 'عرض كافة التقارير',
    [PERMISSIONS.MANAGE_DELIVERY_NOTICES]: 'إدارة إشعارات التسليم (إنشاء/إرسال)',
    [PERMISSIONS.APPROVE_DELIVERY_NOTICES]: 'اعتماد إشعارات التسليم',
    [PERMISSIONS.MANAGE_AGENTS]: 'إدارة المناديب (خريطة ومخزون)',
    [PERMISSIONS.MANAGE_UNITS]: 'إدارة الوحدات والتحويلات',
    [PERMISSIONS.MANAGE_INVOICE_MOVEMENTS]: 'إدارة حركات الفواتير وتفعيل/قفل المخزون',
    [PERMISSIONS.VIEW_RESTAURANT_MODULE]: 'عرض قسم المطعم',
    [PERMISSIONS.MANAGE_RESTAURANT_TABLES]: 'إدارة طاولات المطعم',
    [PERMISSIONS.MANAGE_RESTAURANT_SESSIONS]: 'إدارة جلسات الطاولات (فتح/إغلاق/حالات)',
    [PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE]: 'عرض شاشة سندات الأقمشة',
    [PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT]: 'فتح سند القماش',
    [PERMISSIONS.MANAGE_TEXTILE_DISPATCH_REQUESTS]: 'إنشاء وإدارة طلبات تجهيز الأقمشة',
    [PERMISSIONS.DECOMPOSE_TEXTILE_DISPATCH]: 'إدخال تفكيك الرولات',
    [PERMISSIONS.UPDATE_TEXTILE_DISPATCH_PREPARATION]: 'حفظ تجهيز سند القماش',
    [PERMISSIONS.CONFIRM_TEXTILE_DISPATCH_PREPARATION]: 'تأكيد وإرسال تجهيز سند القماش',
    [PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT]: 'طباعة سند تجهيز الأقمشة',
    [PERMISSIONS.VIEW_TEXTILE_STOCK_CONTEXT]: 'عرض سياق مخزون الأقمشة',
    [PERMISSIONS.APPROVE_TEXTILE_DISPATCH]: 'اعتماد أو رفض سند تجهيز الأقمشة',
    [PERMISSIONS.CONVERT_TEXTILE_DISPATCH_TO_INVOICE]: 'تحويل سند الأقمشة إلى فاتورة بيع',
};

PERMISSION_LABELS[PERMISSIONS.PRICE_EDIT] = 'تعديل أسعار مادة واحدة';
PERMISSION_LABELS[PERMISSIONS.PRICE_BULK_EDIT] = 'تعديل الأسعار الجماعي';
PERMISSION_LABELS[PERMISSIONS.EXCHANGE_RATE_UPDATE] = 'تحديث الأسعار حسب النشرة اليومية';

export interface LabelSettings {
  general: Record<string, string>;
  menu: Record<string, string>;
  invoice: Record<string, string>;
  inventory: Record<string, string>;
  reports: Record<string, string>;
  partners: Record<string, string>;
  funds: Record<string, string>;
}

export const DEFAULT_LABELS: LabelSettings = {
    general: { client: 'العميل', supplier: 'المورد', date: 'التاريخ' },
    menu: { dashboard: 'الرئيسية', inventory: 'المخزون', invoices: 'الفواتير', funds: 'المالية', partners: 'الشركاء', stocktaking: 'الجرد', reports: 'التقارير', settings: 'الإعدادات' },
    invoice: { new_invoice: 'فاتورة جديدة', sale_type: 'مبيع', purchase_type: 'شراء', opening_stock: 'بضاعة أول المدة', save_btn: 'حفظ', print_btn: 'طباعة' },
    inventory: { title: 'إدارة المخزون' },
    reports: { sales_report: 'تقرير المبيعات', purchases_report: 'تقرير المشتريات', fund_movement: 'حركة الصناديق', client_statement: 'كشف حساب عميل', supplier_statement: 'كشف حساب مورد', profit_loss: 'الأرباح والخسائر', inventory_valuation: 'تقييم المخزون', export_excel: 'تصدير Excel', export_pdf: 'تصدير PDF' },
    partners: { title: 'إدارة الشركاء' },
    funds: { title: 'الصناديق والسندات' }
};

export type PaperSize = '80mm' | '58mm' | 'A4' | 'A5' | '85mm';

export interface PrintProfile {
  id: string;
  name: string;
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  headerTitle: string;
  headerSubtitle: string;
  headerExtra?: string;
  footerText: string;
  showLogo: boolean;
  showPhone: boolean;
  showAddress: boolean;
  showQrCode: boolean;
  showTaxNumber: boolean;
  fontSize: 'sm' | 'md' | 'lg';
}

/** Restaurant / dual-printer POS — persisted under `print` settings key */
export interface RestaurantPrintSettings {
  queueEnabled?: boolean;
  /** continuous = never reset by day; daily = reset each business day */
  queueResetMode?: 'continuous' | 'daily';
  queueScope?: 'global' | 'branch';
  queuePrefix?: string;
  kitchenEnabled?: boolean;
  kitchenHost?: string;
  kitchenPort?: number;
  kitchenPaperSize?: '58mm' | '80mm';
  kitchenCopies?: 1 | 2 | 3;
  kitchenAutoPrint?: boolean;
  customerReceiptCopies?: 1 | 2 | 3;
  customerTemplateId?: string;
  kitchenTemplateId?: string;
  showCashierOnReceipt?: boolean;
  showQueueOnKitchen?: boolean;
  showQueueOnCustomer?: boolean;
}

export interface PrintSettings {
  profiles: {
    sale_invoice: PrintProfile;
    purchase_invoice: PrintProfile;
    vouchers: PrintProfile;
    reports: PrintProfile;
  };
  defaultPrinter?: string;
  /** طابعة A4 افتراضية للكشوفات والتقارير (اسم الطابعة أو المعرف) */
  defaultA4PrinterId?: string;
  defaultA4PrinterName?: string;
  autoPrint: boolean;
  /** مطاعم — طابعة زبون + مطبخ + دور */
  restaurant?: RestaurantPrintSettings;
  thermal?: {
      enabled: boolean;
      printerId: string;
      paperSize: string;
      autoPrintPos: boolean;
      /** طابعة حرارية افتراضية لويندوز (نقطة البيع) - لا يفتح نافذة اختيار */
      windowsPrinterId?: string;
      windowsPrinterName?: string;
      /**
       * POS silent print mode (after sale):
       * - silent: direct print, no dialog (default)
       * - preview: open HTML preview (debug)
       * - disabled: no print
       */
      posPrintMode?: 'silent' | 'preview' | 'disabled';
      /** 1–3 copies for POS receipt */
      posCopies?: 1 | 2 | 3;
      /** If false, skip auto-print after sale (manual reprint still available) */
      posAutoPrintAfterSale?: boolean;
      /** Optional override: printer row id from `printers` table */
      posPrinterId?: string;
  };
}

export interface DeploymentSettings {
  mode: 'standalone' | 'local_network';
  role: 'standalone' | 'host' | 'terminal';
  apiBaseUrl?: string | null;
  allowLocalUsbPrinting?: boolean;
}

export type ProjectProfileId =
  | 'COMPREHENSIVE_GENERAL'
  | 'COMPREHENSIVE_COMMERCIAL'
  | 'COMPREHENSIVE_RESTAURANT'
  | 'COMPREHENSIVE_MANUFACTURING'
  | 'COMPREHENSIVE_DISTRIBUTION';

export interface ProjectProfileSettings {
  id: ProjectProfileId;
  source?: 'setup_wizard' | 'settings' | 'server' | 'legacy_inference';
  configuredAt?: string;
}

export interface ModuleControlSettings {
  disabledTabs: string[];
  forceEnabledTabs: string[];
  nodeOverrides?: Record<string, 'enabled' | 'disabled'>;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  extensionCodes?: string[];
}

export interface CompanyInfo {
  name: string;
  address: string;
  email: string;
  phone1: string;
  phone2: string;
  logo?: string;
}

export interface ThemeSettings {
  primaryColor: string;
  secondaryColor?: string;
  backgroundColor: string;
  textColor?: string;
  inputBgColor?: string;
  sidebarBgColor?: string;
}

export interface RegisteredDevice {
    id: string;
    name: string;
    role: string;
    ipAddress: string;
    connectionType: string;
    notes: string;
    addedAt: string;
}

// --- CURRENCY SETTINGS ---
export interface CurrencyRates {
  SYP: number;
  TRY: number;
  [key: string]: number;
}

export const DEFAULT_CURRENCY_RATES: CurrencyRates = {
  SYP: 15000,
  TRY: 32,
};

export interface AppSettings {
  company: CompanyInfo;
  theme: ThemeSettings;
  print?: PrintSettings;
  deployment?: DeploymentSettings;
  projectProfile?: ProjectProfileSettings;
  moduleControl?: ModuleControlSettings;
  itemSettings?: ItemSettingsConfig;
  labels?: LabelSettings;
  lowStockThreshold: number;
  registeredDevices?: RegisteredDevice[];
  currencyRates?: CurrencyRates;
  defaultCurrency?: string;
}

export interface ItemSettingsConfig {
  enableServiceItems?: boolean;
  enableBarcodePerUnit?: boolean;
  enableMultiUnitPricing?: boolean;
  autoSyncAlternateCurrencyPrices?: boolean;
  preferredPriceReferenceCurrency?: string;
  allowManualLockOfAlternatePrice?: boolean;
  enableTextileMode?: boolean;
  textileRequireWarehousePreparationForSales?: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
    autoPrint: false,
    profiles: {
        sale_invoice: { id: 'sale_invoice', name: 'فاتورة مبيع', paperSize: 'A4', orientation: 'portrait', headerTitle: '', headerSubtitle: '', footerText: '', showLogo: true, showPhone: true, showAddress: true, showQrCode: true, showTaxNumber: false, fontSize: 'md' },
        purchase_invoice: { id: 'purchase_invoice', name: 'فاتورة شراء', paperSize: 'A4', orientation: 'portrait', headerTitle: '', headerSubtitle: '', footerText: '', showLogo: true, showPhone: true, showAddress: true, showQrCode: true, showTaxNumber: false, fontSize: 'md' },
        vouchers: { id: 'vouchers', name: 'سند مالي', paperSize: 'A5', orientation: 'portrait', headerTitle: '', headerSubtitle: '', footerText: '', showLogo: true, showPhone: true, showAddress: true, showQrCode: false, showTaxNumber: false, fontSize: 'md' },
        reports: { id: 'reports', name: 'تقرير', paperSize: 'A4', orientation: 'portrait', headerTitle: '', headerSubtitle: '', footerText: '', showLogo: true, showPhone: true, showAddress: true, showQrCode: false, showTaxNumber: false, fontSize: 'md' },
    }
};

export interface Organization {
    id: string;
    name: string;
    type: string;
    primaryCurrency: string;
    createdAt: string;
}

export interface Institution extends Organization {
    address?: string;
    phone?: string;
    taxId?: string;
    commercialId?: string;
    industrialId?: string;
    mode: 'local' | 'remote';
    activeModules: string[];
    config: {
        mainWarehouseName: string;
        mainCashBoxName: string;
        defaultUnit: string;
    };
}

export interface SyncQueueItem {
    id: string;
    endpoint: string;
    method: 'POST' | 'PUT' | 'DELETE';
    payload: any;
    delta?: any;
    status: 'pending' | 'syncing' | 'failed';
    createdAt: number;
    retryCount: number;
    lastError?: string;
}

export const isOnline = () => navigator.onLine;

export interface Employee {
    id: string;
    name: string;
    phone: string;
    email?: string;
    idNumber: string;
    birthDate: string;
    address: string;
    maritalStatus: string;
    biometricId?: string;
    position: string;
    baseSalary: number;
    currency: string;
    salaryFrequency: 'monthly' | 'weekly' | 'daily';
    experience?: string;
    education?: string;
    courses?: string;
    notes?: string;
    imageUrl?: string;
    idFrontUrl?: string;
    idBackUrl?: string;
    status: 'active' | 'inactive';
    joinDate: string;
}

export interface BiometricDevice {
    id: string;
    name: string;
    ip: string;
    port: number;
    location?: string;
    notes?: string;
    isActive?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface AttendanceRecord {
    id: string;
    deviceId?: string;
    deviceIp?: string;
    employeeId?: string;
    employeeName?: string;
    biometricId?: string;
    timestamp: string;
    eventType?: string | null;
    source?: string;
    createdAt?: string;
}

export interface ExperienceRecord {
    position: string;
    company: string;
    duration: string;
    responsibilities: string;
}

export type SalaryFrequency = 'monthly' | 'weekly' | 'daily';

export interface SalaryTransaction {
    id: string;
    employeeId: string;
    employeeName: string;
    amount: number;
    currency: string;
    type: 'full_salary' | 'advance' | 'bonus' | 'deduction';
    period: string;
    cashBoxId: string;
    journalEntryId?: number | null;
    journalEntryNumber?: string | null;
    date: string;
    notes: string;
}

export interface Recipe {
    id: string;
    name: string;
    code?: string;
    outputItemId: string;
    outputItemName: string;
    outputQty?: number;
    unitName?: string;
    lines: RecipeLine[];
    notes?: string;
    createdAt: string;
}

export interface RecipeLine {
    id: string;
    recipeId: string;
    inputItemId: string;
    inputItemName: string;
    qtyPerOutput: number;
    wastagePct: number;
}

export interface ManufacturingOrder {
    id: string;
    code: string;
    date: string;
    warehouseId: string;
    warehouseName?: string;
    outputItemId: string;
    outputItemName: string;
    outputQty: number;
    unitCost: number;
    totalCost: number;
    status: 'DRAFT' | 'POSTED';
    expenseType: 'FIXED' | 'PERCENT';
    expenseValue: number;
    items: ManufacturingOrderItem[];
    notes: string;
    createdAt: string;
}

export interface ManufacturingOrderItem {
    id: string;
    inputItemId: string;
    inputItemName: string;
    inputQty: number;
    unitCostAtTime: number;
    lineTotalCost: number;
}

export interface Expense {
    id: string;
    code: string;
    date: string;
    description: string;
    totalAmount: number;
    currency: string;
    paymentType: 'CASH' | 'ACCRUED' | 'BANK';
    cashBoxId?: string;
    cashBoxName?: string;
    warehouseId?: string;
    warehouseName?: string;
    manufacturingOrderId?: string;
    status: 'DRAFT' | 'POSTED' | 'CANCELLED';
    lines: ExpenseLine[];
    postedAt?: string;
    createdAt: string;
}

export interface ExpenseLine {
    id: string;
    expenseId: string;
    accountId: string;
    accountName: string;
    amount: number;
    notes: string;
}

export const METER_TO_YARD = 1.09361;
export const USD_TO_SYP = 15000;

export const toNumericValue = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const formatNumber = (num: unknown, decimals = 2) => {
  const value = toNumericValue(num);
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const formatDate = (dateStr: string, includeTime = false) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'short', day: 'numeric'
  };
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return date.toLocaleDateString('en-GB', options);
};

PERMISSION_LABELS[PERMISSIONS.GROUP_MANAGE] = 'إدارة مجموعات المواد';

PERMISSION_LABELS[PERMISSIONS.ITEM_MERGE] = 'دمج المواد';
