
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useModalEscape } from '../hooks/useEscapeKey';
import { Plus, Search, Edit2, Tag, Box, Ruler, RefreshCw, Settings2, Check, Warehouse as WarehouseIcon, XCircle, Filter, Image as ImageIcon, Upload, Trash2, DollarSign, Layers, Info, Hash, ScanBarcode, ArrowRightLeft, History, Building2, User, Phone, MapPin, X, AlertTriangle, FileText, ClipboardList, Eye, Package, TrendingUp, TrendingDown, FolderTree, ChevronDown, PackageCheck } from 'lucide-react';
import { InventoryItem, Category, SubCategory, Unit, Warehouse, Branch, formatDate, formatNumber, toNumericValue, PERMISSIONS, type AppUser, type BulkPriceUpdatePayload, type PriceUpdatePreviewResult, type ItemBarcode, type ItemGroup, type ItemGroupItem, type Promotion, type TextileColor, type TextileInventoryBalance, type AppSettings } from '../types';
import { apiRequest } from '../lib/api';
import { formatUnitRule } from '../lib/unitConversion';
import { confirmDialog } from '../lib/confirm';
import { SmartLink } from '../components/smart';
import { AdaptiveModal, AdaptiveTable, ResponsiveActionBar, ResponsivePage } from '../components/responsive';
import BulkPriceUpdateModal from '../components/inventory/BulkPriceUpdateModal';
import ItemGroupsManager from '../components/inventory/ItemGroupsManager';
import MergeItemsModal from '../components/inventory/MergeItemsModal';
import PromotionManagerModal from '../components/inventory/PromotionManagerModal';
import SerialTrackingReportModal from '../components/inventory/SerialTrackingReportModal';
import ItemFormModal from '../components/inventory/ItemFormModal';
import InventoryRowActions from '../components/inventory/InventoryRowActions';
import { applyBulkPriceUpdate } from '../services/bulkPriceService';
import { executeItemMerge } from '../services/itemMergeService';
import { buildPromotionsDisplayPayload, publishPromotionsDisplayState } from '../lib/promotionsDisplay';
import { SHAMEL_INVENTORY_FOCUS_ITEM_ID } from '../modules/restaurant/restaurant.helpers';
import { isTextileModeEnabled } from '../lib/textileMode';
import { resolveProjectProfile } from '../lib/projectProfiles';
import { getEffectiveVisibleTabs } from '../lib/systemModules';
import useResponsiveLayout from '../hooks/useResponsiveLayout';

const SCALE_LABEL_PRESET = {
  prefix: '9',
  mode: 'weight',
  unit: 'kilogram',
  itemCodeLength: '6',
  valueLength: '5',
  decimals: '3',
  samplePlu: '900018',
} as const;

const computeEan13CheckDigit = (data12: string) => {
  if (!/^\d{12}$/.test(data12)) return '';
  const sum = data12.split('').reduce((acc, digit, index) => {
    const value = Number(digit);
    return acc + value * (index % 2 === 0 ? 1 : 3);
  }, 0);
  return String((10 - (sum % 10)) % 10);
};

const formatEditableNumber = (value: unknown, maxFractionDigits = 2) => {
  const numeric = toNumericValue(value);
  return numeric.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
};

const formatInventoryQty = (value: unknown, maxFractionDigits = 3) => {
  const numeric = toNumericValue(value);
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
};

const serializeItemTreeNumber = (value: unknown, maxFractionDigits = 3) =>
  formatEditableNumber(value, maxFractionDigits);

const currSym = (c?: string) => c === 'SYP' ? 'ل.س' : c === 'TRY' ? '₺' : '$';

type ItemTreeImportMode = 'create' | 'update' | 'upsert';
type ItemTreeRow = {
  name: string;
  code?: string;
  barcode?: string;
  category?: string;
  unit?: string;
  costPrice?: string;
  salePrice?: string;
  posPrice?: string;
  wholesalePrice?: string;
  openingQty?: string;
  notes?: string;
  active?: string | boolean | number | null;
};

type ItemTreePreviewRow = {
  index: number;
  data: ItemTreeRow;
  action: 'create' | 'update' | 'skip' | 'error';
  errors: string[];
  matchedItemId?: string | null;
};

const normalizeHeaderKey = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
    .replace(/[^\w\u0600-\u06FF]+/g, '');

const normalizeNameKey = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCodeKey = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();

const HEADER_ALIASES: Record<keyof ItemTreeRow, string[]> = {
  name: ['name', 'item', 'product', 'material', 'itemname', 'productname', 'المادة', 'الصنف', 'اسم', 'اسم المادة', 'اسم الصنف'],
  code: ['code', 'itemcode', 'productcode', 'sku', 'الكود', 'رمز', 'رمز الصنف', 'رقم الصنف', 'رقم المادة'],
  barcode: ['barcode', 'bar', 'barcodevalue', 'باركود', 'الباركود', 'باركود المادة'],
  category: ['category', 'group', 'classification', 'الفئة', 'التصنيف', 'المجموعة', 'قسم', 'تصنيف'],
  unit: ['unit', 'uom', 'unitname', 'الوحدة', 'وحدة', 'وحدة القياس', 'قياس'],
  costPrice: ['cost', 'costprice', 'purchaseprice', 'cost_price', 'سعر التكلفة', 'سعر الشراء', 'تكلفة'],
  salePrice: ['sale', 'saleprice', 'retailprice', 'سعر البيع', 'سعر المبيع', 'سعر التجزئة'],
  posPrice: ['posprice', 'cashierprice', 'سعر نقطة البيع', 'سعر الكاشير', 'سعر الكاش'],
  wholesalePrice: ['wholesale', 'wholesaleprice', 'سعر الجملة', 'جملة'],
  openingQty: ['openingqty', 'openingquantity', 'quantity', 'qty', 'الكمية', 'كمية', 'رصيد افتتاحي', 'كمية افتتاحية'],
  notes: ['notes', 'note', 'ملاحظات', 'ملاحظة'],
  active: ['active', 'inactive', 'نشط', 'غيرنشط', 'غير نشط', 'فعال', 'مفعل'],
};

const HEADER_ALIAS_MAP = new Map<string, keyof ItemTreeRow>();
Object.entries(HEADER_ALIASES).forEach(([key, aliases]) => {
  aliases.forEach((alias) => HEADER_ALIAS_MAP.set(normalizeHeaderKey(alias), key as keyof ItemTreeRow));
});

const parseCsvLine = (line: string) => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((entry) => entry.trim());
};

const parseCsvText = (text: string) => {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(rows[0]);
  const dataRows = rows.slice(1).map((row) => parseCsvLine(row));
  return { headers, rows: dataRows };
};

const parseJsonText = (text: string) => {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.data)) return parsed.data;
  return [];
};

const normalizeNumericString = (value: string) =>
  String(value || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const parseNumberSafe = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = normalizeNumericString(String(value)).replace(/[^\d.-]+/g, '');
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

const parseActiveFlag = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value || '').trim().toLowerCase();
  const yesSet = new Set(['1', 'true', 'yes', 'y', 'نعم', 'فعال', 'نشط']);
  const noSet = new Set(['0', 'false', 'no', 'n', 'لا', 'غير نشط', 'غيرنشط', 'inactive']);
  if (yesSet.has(normalized)) return true;
  if (noSet.has(normalized)) return false;
  return null;
};

const downloadTextFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([`\ufeff${content}`], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

interface InventoryProps {
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  warehouses: Warehouse[];
  refreshData: () => Promise<void>;
  setActiveTab?: (tab: string) => void;
  settings?: AppSettings;
}

const Inventory: React.FC<InventoryProps> = ({ items, setItems, warehouses: initialWarehouses, refreshData, setActiveTab, settings }) => {
  const layout = useResponsiveLayout();
  const textileModeEnabled = isTextileModeEnabled(settings);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeView, setActiveView] = useState<'items' | 'config' | 'transfers' | 'branches' | 'inquiry'>('items');
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [unitForm, setUnitForm] = useState({ name: '', isBase: true, baseUnitId: '', factor: '1' });
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [branchesList, setBranchesList] = useState<Branch[]>([]);
  const [itemGroups, setItemGroups] = useState<ItemGroup[]>([]);
  const [itemGroupItems, setItemGroupItems] = useState<ItemGroupItem[]>([]);
  const [itemBarcodes, setItemBarcodes] = useState<ItemBarcode[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [textileColors, setTextileColors] = useState<TextileColor[]>([]);
  const [textileBalances, setTextileBalances] = useState<TextileInventoryBalance[]>([]);
  const [itemBarcodeInputs, setItemBarcodeInputs] = useState<string[]>(['']);
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('all');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedSubCategoryFilter, setSelectedSubCategoryFilter] = useState<string>('all');
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>('all');
  const [selectedTextileColorFilter, setSelectedTextileColorFilter] = useState<string>('all');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'date' | 'alpha' | 'numbers'>('date');
  const [transferHistory, setTransferHistory] = useState<any[]>([]);
  const [transferToBranchId, setTransferToBranchId] = useState<string>('');
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [isBulkPriceModalOpen, setIsBulkPriceModalOpen] = useState(false);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isPromotionManagerOpen, setIsPromotionManagerOpen] = useState(false);
  const [isSerialReportOpen, setIsSerialReportOpen] = useState(false);
  const [isItemTreeExportOpen, setIsItemTreeExportOpen] = useState(false);
  const [isItemTreeImportOpen, setIsItemTreeImportOpen] = useState(false);
  const [itemTreeExportScope, setItemTreeExportScope] = useState<'filtered' | 'all'>('filtered');
  const [itemTreeImportMode, setItemTreeImportMode] = useState<ItemTreeImportMode>('upsert');
  const [itemTreeImportRows, setItemTreeImportRows] = useState<ItemTreeRow[]>([]);
  const [itemTreeImportFileName, setItemTreeImportFileName] = useState('');
  const [itemTreeImportErrors, setItemTreeImportErrors] = useState<string[]>([]);
  const [itemTreeDefaultWarehouseId, setItemTreeDefaultWarehouseId] = useState('');
  const [itemTreeOpeningDate, setItemTreeOpeningDate] = useState('');
  const [itemTreeFiscalYear, setItemTreeFiscalYear] = useState(String(new Date().getFullYear()));
  const [itemTreeProcessing, setItemTreeProcessing] = useState(false);
  const [itemTreeImportResult, setItemTreeImportResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  } | null>(null);
  const [itemModalTab, setItemModalTab] = useState<'basic' | 'pricing' | 'serials' | 'details'>('basic');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<any | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingConfig, setEditingConfig] = useState<{type: 'category' | 'sub' | 'unit' | 'warehouse', item: any} | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState<{type: string, catId?: string} | null>(null);
  const [quickAddValue, setQuickAddValue] = useState('');
  const [inquirySearch, setInquirySearch] = useState('');
  const [selectedInquiryItem, setSelectedInquiryItem] = useState<InventoryItem | null>(null);
  const [inquiryMovements, setInquiryMovements] = useState<any[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const consumedInventoryFocusRef = useRef(false);

  useEffect(() => {
    if (consumedInventoryFocusRef.current || !items.length) return;
    try {
      const id = sessionStorage.getItem(SHAMEL_INVENTORY_FOCUS_ITEM_ID);
      if (!id) return;
      const it = items.find((i) => String(i.id) === String(id));
      consumedInventoryFocusRef.current = true;
      sessionStorage.removeItem(SHAMEL_INVENTORY_FOCUS_ITEM_ID);
      if (it) {
        setActiveView('items');
        setExpandedItemId(it.id);
        setSearchTerm(String(it.code || it.name || '').trim());
      }
    } catch {
      /* ignore */
    }
  }, [items]);

  const storedUser = localStorage.getItem('shamel_user');
  const currentUser: AppUser | null = storedUser ? JSON.parse(storedUser) : null;
  const resolvedProjectProfile = resolveProjectProfile(settings);
  const effectiveVisibleTabs = useMemo(
    () => getEffectiveVisibleTabs(resolvedProjectProfile.id, settings?.moduleControl),
    [resolvedProjectProfile.id, settings?.moduleControl],
  );
  const canOpenInventoryPromotions = effectiveVisibleTabs.has('inventory_promotions');
  const canOpenDeliveryNotices = effectiveVisibleTabs.has('delivery_notices');
  const canOpenDeliveryApprovals = effectiveVisibleTabs.has('delivery_approvals');
  const canEditSinglePrice = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.PRICE_EDIT);
  const canEditBulkPrice = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.PRICE_BULK_EDIT);
  const canUpdateExchangeRatePrices = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.EXCHANGE_RATE_UPDATE);
  const canManageGroups = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.GROUP_MANAGE);
  const canMergeItems = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.ITEM_MERGE);

  const [itemForm, setItemForm] = useState({
    name: '', code: '', barcode: '', serialNumber: '', serialTracking: 'none', categoryId: '', subCategoryId: '', unitId: '', 
    warehouseId: '', quantity: '', costPrice: '', salePrice: '', wholesalePrice: '', posPrice: '', imageUrl: '', minStockAlert: '5',
    model: '', dimensions: '', color: '', origin: '', manufacturer: '', grossWeight: '', netWeight: '', notes: '',
    isTextile: false, textileBaseUom: 'meter', supportsColorDimension: false,
    isScaleItem: false, scalePluCode: '', scaleBarcodePrefix: String(SCALE_LABEL_PRESET.prefix), scaleBarcodeMode: String(SCALE_LABEL_PRESET.mode), scaleUnit: String(SCALE_LABEL_PRESET.unit),
    scalePricePerKg: '', scaleItemCodeLength: String(SCALE_LABEL_PRESET.itemCodeLength), scaleValueLength: String(SCALE_LABEL_PRESET.valueLength), scaleDecimals: String(SCALE_LABEL_PRESET.decimals)
  });

  const availableSubCategories = useMemo(() => {
    return subCategories.filter(sc => sc.categoryId === itemForm.categoryId);
  }, [subCategories, itemForm.categoryId]);

  const scaleBarcodePreview = useMemo(() => {
    const prefix = String(itemForm.scaleBarcodePrefix || SCALE_LABEL_PRESET.prefix).replace(/\D+/g, '') || SCALE_LABEL_PRESET.prefix;
    const pluLengthRaw = Number(itemForm.scaleItemCodeLength || SCALE_LABEL_PRESET.itemCodeLength);
    const valueLengthRaw = Number(itemForm.scaleValueLength || SCALE_LABEL_PRESET.valueLength);
    const decimalsRaw = Number(itemForm.scaleDecimals || SCALE_LABEL_PRESET.decimals);
    const pluLength = Number.isInteger(pluLengthRaw) && pluLengthRaw > 0 ? pluLengthRaw : Number(SCALE_LABEL_PRESET.itemCodeLength);
    const valueLength = Number.isInteger(valueLengthRaw) && valueLengthRaw > 0 ? valueLengthRaw : Number(SCALE_LABEL_PRESET.valueLength);
    const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 ? decimalsRaw : Number(SCALE_LABEL_PRESET.decimals);
    const pluDigits = String(itemForm.scalePluCode || SCALE_LABEL_PRESET.samplePlu).replace(/\D+/g, '') || SCALE_LABEL_PRESET.samplePlu;
    const plu = pluDigits.padStart(pluLength, '0').slice(-pluLength);
    const unit = itemForm.scaleUnit === 'gram' ? 'gram' : 'kilogram';
    const sampleWeight = unit === 'kilogram' ? 3.062 : 3062;
    const rawValue = Math.round(sampleWeight * Math.pow(10, decimals));
    const value = String(rawValue).padStart(valueLength, '0').slice(-valueLength);
    const payload = `${prefix}${plu}${value}`;
    const checksum = payload.length === 12 ? computeEan13CheckDigit(payload) : '';
    const displayValue = unit === 'kilogram'
      ? `${(Number(value) / Math.pow(10, decimals)).toFixed(decimals)} كغ`
      : `${(Number(value) / Math.pow(10, decimals)).toFixed(decimals)} غ`;

    return {
      payload,
      checksum,
      fullBarcode: `${payload}${checksum}`,
      groupedBarcode: checksum ? `${prefix} ${plu} ${value} ${checksum}` : `${prefix} ${plu} ${value}`,
      valueSegment: value,
      displayValue,
    };
  }, [
    itemForm.scaleBarcodePrefix,
    itemForm.scaleItemCodeLength,
    itemForm.scaleValueLength,
    itemForm.scaleDecimals,
    itemForm.scalePluCode,
    itemForm.scaleUnit,
  ]);

  const scaleDecimalsHint = useMemo(() => {
    if (itemForm.scaleUnit === 'kilogram') {
      return `عند اختيار كيلوغرام يوصى غالبًا بالمنازل العشرية = 3، بحيث ${scaleBarcodePreview.valueSegment} تعني ${scaleBarcodePreview.displayValue}.`;
    }
    return `عند اختيار غرام يوصى غالبًا بالمنازل العشرية = 0، بحيث ${scaleBarcodePreview.valueSegment} تعني ${scaleBarcodePreview.displayValue}.`;
  }, [itemForm.scaleUnit, scaleBarcodePreview.displayValue, scaleBarcodePreview.valueSegment]);

  const applyScaleLabelPreset = useCallback(() => {
    setItemForm(prev => ({
      ...prev,
      isScaleItem: true,
      scaleBarcodePrefix: SCALE_LABEL_PRESET.prefix,
      scaleBarcodeMode: SCALE_LABEL_PRESET.mode,
      scaleUnit: SCALE_LABEL_PRESET.unit,
      scaleItemCodeLength: SCALE_LABEL_PRESET.itemCodeLength,
      scaleValueLength: SCALE_LABEL_PRESET.valueLength,
      scaleDecimals: SCALE_LABEL_PRESET.decimals,
    }));
  }, []);

  const baseUnits = useMemo(() => units.filter(u => u.isBase || !u.baseUnitId), [units]);

  const [warehouseForm, setWarehouseForm] = useState({
    name: '', code: '', location: '', manager: '', branchId: '', notes: ''
  });

  const [branchForm, setBranchForm] = useState({
    name: '', location: '', manager: '', phone: '', notes: ''
  });

  const [transferForm, setTransferForm] = useState({
    itemId: '', fromWH: '', toWH: '', quantity: '', unitId: '', unitName: '', notes: '', transferNo: `TR-${Date.now().toString().slice(-6)}`
  });

  const parsePromotionItemIds = (value: unknown) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const parsePromotionImages = (value: unknown) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
    } catch {
      return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
    }
  };

  const loadConfig = async () => {
    try {
        let [c, sc, u, w, b, groups, groupItems, barcodes, promotionsRows, colorRows, balanceRows] = await Promise.all([
          apiRequest('categories'), 
          apiRequest('sub-categories'), 
          apiRequest('units'),
          apiRequest('warehouses'),
          apiRequest('branches').catch(() => []),
          apiRequest('item-groups').catch(() => []),
          apiRequest('item-group-items').catch(() => []),
          apiRequest('item-barcodes').catch(() => []),
          apiRequest('promotions').catch(() => []),
          apiRequest('textile/colors').catch(() => []),
          apiRequest('textile/inventory').catch(() => []),
        ]);

        // Auto-create default category "رئيسي" if none exist
        if (!Array.isArray(c) || c.length === 0) {
            try {
                await apiRequest('categories', { method: 'POST', body: JSON.stringify({ id: `c-default-${Date.now()}`, name: 'رئيسي' }) });
                c = await apiRequest('categories');
            } catch {}
        }
        // Auto-create default subcategory "عام" under first category if none exist
        if ((!Array.isArray(sc) || sc.length === 0) && Array.isArray(c) && c.length > 0) {
            try {
                await apiRequest('sub-categories', { method: 'POST', body: JSON.stringify({ id: `sc-default-${Date.now()}`, name: 'عام', categoryId: c[0].id }) });
                sc = await apiRequest('sub-categories');
            } catch {}
        }
        // Auto-create default unit "قطعة" if none exist
        if (!Array.isArray(u) || u.length === 0) {
            try {
                await apiRequest('units', { method: 'POST', body: JSON.stringify({ id: `u-default-${Date.now()}`, name: 'قطعة', isBase: 1, factor: 1, multiplier: 1 }) });
                u = await apiRequest('units');
            } catch {}
        }

        setCategories(c); setSubCategories(sc); setUnits(u); setWarehouses(w); setBranchesList(b);
        setItemGroups(Array.isArray(groups) ? groups : []);
        setItemGroupItems(Array.isArray(groupItems) ? groupItems : []);
        setItemBarcodes(Array.isArray(barcodes) ? barcodes : []);
        setTextileColors(Array.isArray(colorRows) ? colorRows : []);
        setTextileBalances(Array.isArray(balanceRows) ? balanceRows : []);
        setPromotions(Array.isArray(promotionsRows) ? promotionsRows.map((row: any) => ({
          ...row,
          itemIds: parsePromotionItemIds(row?.itemIds),
          extraImageUrls: parsePromotionImages(row?.extraImageUrls),
          showOnDisplay: row?.showOnDisplay !== false && row?.showOnDisplay !== 0,
        })) : []);
        
        if (activeView === 'transfers' || activeView === 'items') {
            const tr = await apiRequest('inventory/transfers').catch(() => []);
            setTransferHistory(tr);
        }
    } catch (e: any) { console.error("Config load error", e); }
  };

  useEffect(() => { loadConfig(); }, [activeView]);
  useEffect(() => { setWarehouses(initialWarehouses); }, [initialWarehouses]);
  useEffect(() => {
    publishPromotionsDisplayState(buildPromotionsDisplayPayload(promotions, items));
  }, [promotions, items]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shamel_product_view_prefill');
      if (!raw || items.length === 0) return;
      const payload = JSON.parse(raw);
      const productId = String(payload?.id || '');
      if (!productId) return;
      const target = items.find(i => i.id === productId);
      if (!target) return;
      setActiveView('inquiry');
      setInquirySearch(target.name);
      setSelectedInquiryItem(target);
      localStorage.removeItem('shamel_product_view_prefill');
    } catch {}
  }, [items]);

  const normalizeSearchText = (value: string) => {
    return (value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  };

  const matchesSmartSearch = (item: InventoryItem, query: string) => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const relatedBarcodes = itemBarcodes
      .filter((row) => String(row.itemId) === String(item.id))
      .map((row) => row.barcode);

    const haystack = normalizeSearchText([
      item.name,
      item.code,
      item.barcode,
      ...relatedBarcodes,
      item.serialNumber,
      item.model,
      item.color,
      item.manufacturer,
      item.origin,
      item.dimensions,
      item.notes,
      item.warehouseName
    ].filter(Boolean).join(' '));

    if (!haystack) return false;

    if (tokens.length === 1) return haystack.includes(tokens[0]);

    const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(pattern, 'i').test(haystack);
  };

  const getSortableNumber = (value?: string) => {
    if (!value) return null;
    const numeric = Number(String(value).replace(/[^\d.]+/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  };

  const filterDateStart = dateFromFilter ? new Date(`${dateFromFilter}T00:00:00`).getTime() : null;
  const filterDateEnd = dateToFilter ? new Date(`${dateToFilter}T23:59:59.999`).getTime() : null;

  const clearInventoryFilters = () => {
    setSearchTerm('');
    setSelectedWarehouseFilter('all');
    setSelectedGroupFilter('all');
    setSelectedCategoryFilter('all');
    setSelectedSubCategoryFilter('all');
    setSelectedUnitFilter('all');
    setSelectedTextileColorFilter('all');
    setDateFromFilter('');
    setDateToFilter('');
  };

  // ESC key closes modals
  useModalEscape(isItemModalOpen, useCallback(() => setIsItemModalOpen(false), []));
  useModalEscape(isUnitModalOpen, useCallback(() => setIsUnitModalOpen(false), []));
  useModalEscape(isWarehouseModalOpen, useCallback(() => setIsWarehouseModalOpen(false), []));
  useModalEscape(isTransferModalOpen, useCallback(() => setIsTransferModalOpen(false), []));
  useModalEscape(isBranchModalOpen, useCallback(() => setIsBranchModalOpen(false), []));
  useModalEscape(isGroupManagerOpen, useCallback(() => setIsGroupManagerOpen(false), []));
  useModalEscape(isMergeModalOpen, useCallback(() => setIsMergeModalOpen(false), []));
  useModalEscape(isItemTreeExportOpen, useCallback(() => setIsItemTreeExportOpen(false), []));
  useModalEscape(isItemTreeImportOpen, useCallback(() => setIsItemTreeImportOpen(false), []));

  useEffect(() => {
    if (isItemTreeImportOpen && !itemTreeDefaultWarehouseId && warehouses.length > 0) {
      setItemTreeDefaultWarehouseId(String(warehouses[0]?.id || ''));
    }
  }, [isItemTreeImportOpen, itemTreeDefaultWarehouseId, warehouses]);

  const filteredItems = useMemo(() => {
    const list = (items || []).filter(i => {
      if (i.inactive || i.merged) return false;
      const matchesSearch = matchesSmartSearch(i, searchTerm);
      const matchesWarehouse = selectedWarehouseFilter === 'all' || i.warehouseId === selectedWarehouseFilter;
      const matchesGroup = selectedGroupFilter === 'all' || String((i as any).groupId || '') === selectedGroupFilter;
      const matchesCategory = selectedCategoryFilter === 'all' || String(i.categoryId || '') === selectedCategoryFilter;
      const matchesSubCategory = selectedSubCategoryFilter === 'all' || String(i.subCategoryId || '') === selectedSubCategoryFilter;
      const matchesUnit = selectedUnitFilter === 'all' || String(i.unitId || '') === selectedUnitFilter || String(i.unitName || '') === selectedUnitFilter;
      const matchesTextileColor = !textileModeEnabled
        || selectedTextileColorFilter === 'all'
        || !i.isTextile
        || textileBalances.some((balance) =>
          String(balance.itemId || '') === String(i.id)
          && String(balance.colorId || '') === selectedTextileColorFilter
          && (selectedWarehouseFilter === 'all' || String(balance.warehouseId || '') === String(selectedWarehouseFilter))
        );
      const itemTime = i.lastUpdated ? new Date(i.lastUpdated).getTime() : 0;
      const matchesDateFrom = filterDateStart === null || itemTime >= filterDateStart;
      const matchesDateTo = filterDateEnd === null || itemTime <= filterDateEnd;
      return matchesSearch && matchesWarehouse && matchesGroup && matchesCategory && matchesSubCategory && matchesUnit && matchesTextileColor && matchesDateFrom && matchesDateTo;
    });

    const sorted = [...list];
    if (sortBy === 'date') {
      sorted.sort((a, b) => {
        const aTime = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
        const bTime = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
        return bTime - aTime;
      });
    } else if (sortBy === 'alpha') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar', { numeric: true, sensitivity: 'base' }));
    } else if (sortBy === 'numbers') {
      sorted.sort((a, b) => {
        const aNum = getSortableNumber(a.code);
        const bNum = getSortableNumber(b.code);
        if (aNum !== null && bNum !== null) return aNum - bNum;
        if (aNum !== null) return -1;
        if (bNum !== null) return 1;
        return (a.code || '').localeCompare(b.code || '', 'ar', { numeric: true, sensitivity: 'base' });
      });
    }

    return sorted;
  }, [items, searchTerm, selectedWarehouseFilter, selectedGroupFilter, selectedCategoryFilter, selectedSubCategoryFilter, selectedUnitFilter, selectedTextileColorFilter, textileBalances, filterDateStart, filterDateEnd, sortBy]);

  const itemTreePreview = useMemo<ItemTreePreviewRow[]>(() => {
    if (!itemTreeImportRows.length) return [];

    const barcodeMap = new Map<string, InventoryItem>();
    const codeMap = new Map<string, InventoryItem>();
    const nameMap = new Map<string, InventoryItem[]>();

    (items || []).forEach((item) => {
      const codeKey = normalizeCodeKey(item.code || '');
      const nameKey = normalizeNameKey(item.name || '');
      const barcodeKey = normalizeCodeKey(item.barcode || '');
      if (barcodeKey) barcodeMap.set(barcodeKey, item);
      if (codeKey) codeMap.set(codeKey, item);
      if (nameKey) {
        const list = nameMap.get(nameKey) || [];
        list.push(item);
        nameMap.set(nameKey, list);
      }
    });

    (itemBarcodes || []).forEach((row) => {
      const barcodeKey = normalizeCodeKey(row.barcode || '');
      if (!barcodeKey) return;
      const item = items.find((entry) => String(entry.id) === String(row.itemId));
      if (item) barcodeMap.set(barcodeKey, item);
    });

    const fileBarcodeCount = new Map<string, number>();
    const fileCodeCount = new Map<string, number>();
    const fileNameCount = new Map<string, number>();
    itemTreeImportRows.forEach((row) => {
      const barcodeKey = normalizeCodeKey(row.barcode || '');
      const codeKey = normalizeCodeKey(row.code || '');
      const nameKey = normalizeNameKey(row.name || '');
      if (barcodeKey) fileBarcodeCount.set(barcodeKey, (fileBarcodeCount.get(barcodeKey) || 0) + 1);
      if (codeKey) fileCodeCount.set(codeKey, (fileCodeCount.get(codeKey) || 0) + 1);
      if (nameKey) fileNameCount.set(nameKey, (fileNameCount.get(nameKey) || 0) + 1);
    });

    return itemTreeImportRows.map((row, index) => {
      const errors: string[] = [];
      const name = String(row.name || '').trim();
      const barcodeKey = normalizeCodeKey(row.barcode || '');
      const codeKey = normalizeCodeKey(row.code || '');
      const nameKey = normalizeNameKey(name);

      if (!name) errors.push('الاسم مطلوب.');
      if (barcodeKey && (fileBarcodeCount.get(barcodeKey) || 0) > 1) errors.push('باركود مكرر داخل الملف.');
      if (codeKey && (fileCodeCount.get(codeKey) || 0) > 1) errors.push('الكود مكرر داخل الملف.');
      if (nameKey && (fileNameCount.get(nameKey) || 0) > 1) errors.push('الاسم مكرر داخل الملف.');

      const numericFields: Array<[string, string | undefined]> = [
        ['سعر التكلفة', row.costPrice],
        ['سعر البيع', row.salePrice],
        ['سعر نقطة البيع', row.posPrice],
        ['سعر الجملة', row.wholesalePrice],
        ['الكمية الافتتاحية', row.openingQty],
      ];
      numericFields.forEach(([label, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (parseNumberSafe(value) === null) errors.push(`قيمة غير صحيحة لـ ${label}.`);
      });

      const barcodeMatch = barcodeKey ? barcodeMap.get(barcodeKey) : null;
      const codeMatch = codeKey ? codeMap.get(codeKey) : null;
      const nameMatches = nameKey ? (nameMap.get(nameKey) || []) : [];
      const nameMatch = nameMatches.length === 1 ? nameMatches[0] : null;

      if (nameMatches.length > 1 && !barcodeMatch && !codeMatch) {
        errors.push('الاسم مطابق لأكثر من مادة موجودة.');
      }

      if (barcodeMatch && codeMatch && String(barcodeMatch.id) !== String(codeMatch.id)) {
        errors.push('الباركود يشير إلى مادة مختلفة عن الكود.');
      }

      const matchedItem = barcodeMatch || codeMatch || nameMatch || null;
      let action: ItemTreePreviewRow['action'] = 'create';
      if (errors.length > 0) {
        action = 'error';
      } else if (matchedItem) {
        action = itemTreeImportMode === 'create' ? 'skip' : 'update';
      } else {
        action = itemTreeImportMode === 'update' ? 'skip' : 'create';
      }

      return {
        index: index + 1,
        data: row,
        action,
        errors,
        matchedItemId: matchedItem ? String(matchedItem.id) : null,
      };
    });
  }, [itemTreeImportRows, itemTreeImportMode, items, itemBarcodes]);

  const itemTreeSummary = useMemo(() => {
    return itemTreePreview.reduce(
      (acc, row) => {
        acc[row.action] += 1;
        return acc;
      },
      { create: 0, update: 0, skip: 0, error: 0 } as Record<'create' | 'update' | 'skip' | 'error', number>
    );
  }, [itemTreePreview]);

  const visibleItemIds = useMemo(() => filteredItems.map((item) => String(item.id)), [filteredItems]);
  const getTextileBalancesForItem = useCallback((item: InventoryItem) => (
    textileBalances.filter((balance) =>
      String(balance.itemId || '') === String(item.id)
      && (selectedWarehouseFilter === 'all' || String(balance.warehouseId || '') === String(selectedWarehouseFilter))
    )
  ), [selectedWarehouseFilter, textileBalances]);
  const allVisibleSelected = visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedItemIds.includes(id));

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds((prev) => (
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    ));
  };

  const toggleSelectAllVisible = () => {
    setSelectedItemIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleItemIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleItemIds]));
    });
  };

  const handleExecuteBulkPriceUpdate = async (payload: BulkPriceUpdatePayload, preview: PriceUpdatePreviewResult, currencyRates: Record<string, number>) => {
    const requiresBulk = payload.scope !== 'single';
    if (payload.useDailyExchangeRate && !canUpdateExchangeRatePrices && !canEditBulkPrice) {
      alert('لا تملك صلاحية تحديث الأسعار حسب النشرة اليومية.');
      return;
    }
    if (requiresBulk && !canEditBulkPrice) {
      alert('لا تملك صلاحية تعديل الأسعار الجماعي.');
      return;
    }
    if (!requiresBulk && !canEditSinglePrice && !canEditBulkPrice) {
      alert('لا تملك صلاحية تعديل الأسعار.');
      return;
    }

    await applyBulkPriceUpdate({
      payload,
      currencyRates,
      userId: currentUser?.id || 'local-user',
    });
    await refreshData();
    setSelectedItemIds([]);
    alert(`تم تحديث ${preview.affectedCount} مادة بنجاح.`);
  };

  const buildItemTreeExportRows = (sourceItems: InventoryItem[]) => {
    const categoryMap = new Map(categories.map((c) => [String(c.id), c.name]));
    const unitMap = new Map(units.map((u) => [String(u.id), u.name]));
    return (sourceItems || []).map((item) => ({
      name: item.name || '',
      code: item.code || '',
      barcode: item.barcode || '',
      category: categoryMap.get(String(item.categoryId || '')) || (item as any).categoryName || '',
      unit: item.unitName || unitMap.get(String(item.unitId || '')) || '',
      costPrice: serializeItemTreeNumber(item.costPrice, 2),
      salePrice: serializeItemTreeNumber(item.salePrice, 2),
      posPrice: serializeItemTreeNumber(item.posPrice, 2),
      wholesalePrice: serializeItemTreeNumber(item.wholesalePrice, 2),
      openingQty: serializeItemTreeNumber(item.quantity, 3),
      notes: item.notes || '',
      active: item.inactive ? 'لا' : 'نعم',
    }));
  };

  const handleExportItemTree = (format: 'csv' | 'json', scope: 'filtered' | 'all') => {
    const exportItems = scope === 'filtered' ? filteredItems : (items || []);
    const rows = buildItemTreeExportRows(exportItems);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const payload = {
        dialect: 'postgres',
        source: 'inventory.item-tree',
        generatedAt: new Date().toISOString(),
        scope: scope === 'filtered' ? 'filtered' : 'all',
        total: rows.length,
        items: rows,
      };
      downloadTextFile(`item-tree-${scope}-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
      return;
    }
    const headers = [
      'اسم المادة',
      'الكود',
      'الباركود',
      'التصنيف',
      'الوحدة',
      'سعر التكلفة',
      'سعر البيع',
      'سعر نقطة البيع',
      'سعر الجملة',
      'الكمية الافتتاحية',
      'ملاحظات',
      'نشط',
    ];
    const escapeCsv = (value: any) => {
      const text = String(value ?? '');
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };
    const lines = [
      headers.join(','),
      ...rows.map((row) => [
        row.name,
        row.code,
        row.barcode,
        row.category,
        row.unit,
        row.costPrice,
        row.salePrice,
        row.posPrice,
        row.wholesalePrice,
        row.openingQty,
        row.notes,
        row.active,
      ].map(escapeCsv).join(',')),
    ];
    downloadTextFile(`item-tree-${scope}-${stamp}.csv`, lines.join('\n'), 'text/csv');
  };

  const handleDownloadItemTreeTemplate = (format: 'csv' | 'json') => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const sample = {
        dialect: 'postgres',
        template: 'inventory.item-tree',
        generatedAt: new Date().toISOString(),
        items: [{
        name: 'مثال مادة',
        code: 'ITEM-001',
        barcode: '1234567890123',
        category: 'رئيسي',
        unit: 'قطعة',
        costPrice: serializeItemTreeNumber(10, 2),
        salePrice: serializeItemTreeNumber(15, 2),
        posPrice: serializeItemTreeNumber(15, 2),
        wholesalePrice: serializeItemTreeNumber(13, 2),
        openingQty: serializeItemTreeNumber(0, 3),
        notes: '',
        active: 'نعم',
        }],
      };
      downloadTextFile(`item-tree-template-${stamp}.json`, JSON.stringify(sample, null, 2), 'application/json');
      return;
    }
    const headers = [
      'اسم المادة',
      'الكود',
      'الباركود',
      'التصنيف',
      'الوحدة',
      'سعر التكلفة',
      'سعر البيع',
      'سعر نقطة البيع',
      'سعر الجملة',
      'الكمية الافتتاحية',
      'ملاحظات',
      'نشط',
    ];
    const sampleRow = [
      'مثال مادة',
      'ITEM-001',
      '1234567890123',
      'رئيسي',
      'قطعة',
      serializeItemTreeNumber(10, 2),
      serializeItemTreeNumber(15, 2),
      serializeItemTreeNumber(15, 2),
      serializeItemTreeNumber(13, 2),
      serializeItemTreeNumber(0, 3),
      '',
      'نعم',
    ];
    const lines = [headers.join(','), sampleRow.join(',')];
    downloadTextFile(`item-tree-template-${stamp}.csv`, lines.join('\n'), 'text/csv');
  };

  const handleItemTreeFileSelected = (file: File) => {
    setItemTreeImportErrors([]);
    setItemTreeImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const isJson = file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[');
        const normalizedRows: ItemTreeRow[] = [];
        if (isJson) {
          const parsedRows = parseJsonText(text);
          parsedRows.forEach((row: any) => {
            if (!row || typeof row !== 'object') return;
            const normalized: ItemTreeRow = { name: '' };
            Object.entries(row).forEach(([key, value]) => {
              const normalizedKey = HEADER_ALIAS_MAP.get(normalizeHeaderKey(key)) || (key as keyof ItemTreeRow);
              if (normalizedKey in HEADER_ALIASES) {
                (normalized as any)[normalizedKey] = String(value ?? '').trim();
              }
            });
            normalizedRows.push(normalized);
          });
        } else {
          const { headers, rows } = parseCsvText(text);
          const headerMap = headers.map((header) => HEADER_ALIAS_MAP.get(normalizeHeaderKey(header)) || null);
          rows.forEach((row) => {
            const normalized: ItemTreeRow = { name: '' };
            headerMap.forEach((key, idx) => {
              if (!key) return;
              (normalized as any)[key] = String(row[idx] ?? '').trim();
            });
            normalizedRows.push(normalized);
          });
        }
        setItemTreeImportRows(normalizedRows.filter((row) => Object.values(row).some((value) => String(value || '').trim() !== '')));
        setItemTreeImportFileName(file.name);
      } catch (error: any) {
        setItemTreeImportErrors([error?.message || 'فشل قراءة ملف الاستيراد.']);
      }
    };
    reader.onerror = () => setItemTreeImportErrors(['فشل قراءة ملف الاستيراد.']);
    reader.readAsText(file, 'utf-8');
  };

  const handleExecuteItemTreeImport = async () => {
    if (itemTreeProcessing) return;
    if (!itemTreePreview.length) {
      alert('لا توجد بيانات صالحة للاستيراد.');
      return;
    }
    const defaultWarehouseId = String(itemTreeDefaultWarehouseId || '').trim();
    if (!defaultWarehouseId) {
      alert('يرجى اختيار مستودع افتراضي للاستيراد.');
      return;
    }

    setItemTreeProcessing(true);
    setItemTreeImportErrors([]);
    setItemTreeImportResult(null);

    try {
      const categoryMap = new Map(categories.map((c) => [normalizeNameKey(c.name), c]));
      const unitMap = new Map(units.map((u) => [normalizeNameKey(u.name), u]));
      const subCategoryByCategory = new Map(subCategories.map((sc) => [String(sc.categoryId), sc]));

      const ensureCategory = async (name: string) => {
        const key = normalizeNameKey(name);
        if (!key) return null;
        if (categoryMap.has(key)) return categoryMap.get(key);
        const id = `c-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await apiRequest('categories', { method: 'POST', body: JSON.stringify({ id, name }) });
        const created = { id, name } as Category;
        categoryMap.set(key, created);
        setCategories((prev) => [...prev, created]);
        return created;
      };

      const ensureSubCategory = async (categoryId: string) => {
        if (subCategoryByCategory.has(categoryId)) return subCategoryByCategory.get(categoryId);
        const id = `sc-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const payload = { id, name: 'عام', categoryId };
        await apiRequest('sub-categories', { method: 'POST', body: JSON.stringify(payload) });
        const created = payload as SubCategory;
        subCategoryByCategory.set(categoryId, created);
        setSubCategories((prev) => [...prev, created]);
        return created;
      };

      const ensureUnit = async (name: string) => {
        const key = normalizeNameKey(name);
        if (!key) return null;
        if (unitMap.has(key)) return unitMap.get(key);
        const id = `u-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await apiRequest('units', { method: 'POST', body: JSON.stringify({ id, name, isBase: 1, factor: 1, multiplier: 1 }) });
        const created = { id, name, isBase: true } as Unit;
        unitMap.set(key, created);
        setUnits((prev) => [...prev, created]);
        return created;
      };

      const settingsRows = await apiRequest('settings').catch(() => []);
      const currencyRow = Array.isArray(settingsRows)
        ? settingsRows.find((row: any) => row?.key === 'primaryCurrency' || row?.key === 'defaultCurrency')
        : null;
      const resolvedCurrency = String(currencyRow?.value || 'USD').toUpperCase() || 'USD';
      const openingDate = itemTreeOpeningDate || new Date().toISOString().slice(0, 10);
      const fiscalYear = itemTreeFiscalYear || String(new Date().getFullYear());

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      const openingLinesByWarehouse = new Map<string, any[]>();

      for (const row of itemTreePreview) {
        if (row.action === 'skip') {
          skipped += 1;
          continue;
        }
        if (row.action === 'error') {
          errors += 1;
          continue;
        }
        const data = row.data;
        const costPrice = parseNumberSafe(data.costPrice) || 0;
        const salePrice = parseNumberSafe(data.salePrice) || 0;
        const posPrice = parseNumberSafe(data.posPrice) || salePrice || 0;
        const wholesalePrice = parseNumberSafe(data.wholesalePrice) || 0;
        const openingQty = parseNumberSafe(data.openingQty) || 0;
        const activeFlag = parseActiveFlag(data.active);
        const inactive = activeFlag === null ? false : !activeFlag;

        const category = data.category ? await ensureCategory(String(data.category).trim()) : null;
        const subCategory = category ? await ensureSubCategory(String(category.id)) : null;
        const unit = data.unit ? await ensureUnit(String(data.unit).trim()) : null;

        const payload = {
          name: String(data.name || '').trim(),
          code: String(data.code || '').trim() || undefined,
          barcode: String(data.barcode || '').trim() || undefined,
          categoryId: category?.id || '',
          subCategoryId: subCategory?.id || '',
          unitId: unit?.id || '',
          unitName: unit?.name || data.unit || 'قطعة',
          warehouseId: defaultWarehouseId,
          costPrice,
          salePrice,
          posPrice,
          wholesalePrice,
          notes: String(data.notes || '').trim(),
          inactive,
          quantity: 0,
          userId: currentUser?.id || 'system',
          lastUpdated: new Date().toISOString(),
        } as any;

        try {
          const targetId = row.action === 'update' && row.matchedItemId ? row.matchedItemId : `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (row.action === 'update' && row.matchedItemId) {
            await apiRequest(`inventory/${row.matchedItemId}`, { method: 'PUT', body: JSON.stringify(payload) });
            updated += 1;
          } else {
            await apiRequest('inventory', { method: 'POST', body: JSON.stringify({ ...payload, id: targetId }) });
            created += 1;
          }

          if (openingQty > 0) {
            const lines = openingLinesByWarehouse.get(defaultWarehouseId) || [];
            lines.push({
              item_id: targetId,
              item_name: payload.name,
              item_code: payload.code || '',
              unit: payload.unitName,
              quantity: openingQty,
              cost_price: costPrice,
              warehouse_id: defaultWarehouseId,
            });
            openingLinesByWarehouse.set(defaultWarehouseId, lines);
          }
        } catch (error: any) {
          errors += 1;
          setItemTreeImportErrors((prev) => [...prev, error?.message || 'فشل إنشاء/تحديث مادة.']);
        }
      }

      for (const [warehouseId, lines] of openingLinesByWarehouse.entries()) {
        if (!lines.length) continue;
        try {
          await apiRequest('opening-stock/post', {
            method: 'POST',
            body: JSON.stringify({
              fiscalYear,
              warehouseId,
              currency: resolvedCurrency,
              date: openingDate,
              lines,
            }),
          });
        } catch (error: any) {
          errors += 1;
          setItemTreeImportErrors((prev) => [...prev, error?.message || 'فشل ترحيل مواد أول المدة.']);
        }
      }

      await refreshData();
      setItemTreeImportResult({ created, updated, skipped, errors });
    } finally {
      setItemTreeProcessing(false);
    }
  };

  const handleExecuteItemMerge = async ({ sourceItemId, targetItemId }: { sourceItemId: string; targetItemId: string }) => {
    if (!canMergeItems) {
      alert('لا تملك صلاحية دمج المواد.');
      return { success: false } as any;
    }
    const result = await executeItemMerge({
      sourceItemId,
      targetItemId,
      userId: currentUser?.id || 'local-user',
    });
    await loadConfig();
    await refreshData();
    setSelectedItemIds([]);
    alert(`تم دمج المادة بنجاح. السجلات المتأثرة: ${result.affectedRecordsCount}`);
    return result;
  };

  // تعزيز سجل المناقلات ببيانات المواد الإضافية
  const enrichedTransfers = useMemo(() => {
    return (transferHistory || []).map((tr: any) => {
      const item = items.find(i => i.id === tr.itemId) || items.find(i => i.name === tr.itemName);
      const toItem = items.find(i => i.id === tr.toItemId) || null;
      return {
        ...tr,
        item,
        toItem,
        salePrice: tr.salePrice ?? item?.salePrice ?? 0,
        wholesalePrice: tr.wholesalePrice ?? item?.wholesalePrice ?? 0,
        imageUrl: tr.imageUrl ?? item?.imageUrl ?? ''
      };
    });
  }, [transferHistory, items]);

  // الحصول على آخر مناقلة لكل مادة لعرضها في القائمة الرئيسية إذا لزم الأمر
  const latestTransferByItemId = useMemo(() => {
    const map = new Map<string, any>();
    enrichedTransfers.forEach((tr: any) => {
      const id = tr.itemId || tr.item?.id;
      if (!id) return;
      const prev = map.get(id);
      const prevTime = prev?.date ? new Date(prev.date).getTime() : 0;
      const nextTime = tr?.date ? new Date(tr.date).getTime() : 0;
      if (!prev || nextTime >= prevTime) map.set(id, tr);
    });
    return map;
  }, [enrichedTransfers]);

  const handleOpenItemModal = (item?: InventoryItem) => {
    setItemModalTab('basic');
    if (item) {
        setEditingItem(item);
        setItemBarcodeInputs([
          ...new Set([
            ...(item.barcode ? [item.barcode] : []),
            ...itemBarcodes.filter((row) => String(row.itemId) === String(item.id)).map((row) => row.barcode).filter(Boolean),
          ]),
          '',
        ]);
        setItemForm({ 
            name: item.name, code: item.code, barcode: item.barcode || '', serialNumber: item.serialNumber || '', serialTracking: item.serialTracking || 'none',
            categoryId: item.categoryId || '', subCategoryId: item.subCategoryId || '',
            unitId: item.unitId || units.find(u => u.name === item.unitName)?.id || '', warehouseId: item.warehouseId || warehouses[0]?.id || '', 
            quantity: formatEditableNumber(item.quantity, 3), costPrice: formatEditableNumber(item.costPrice), 
            salePrice: formatEditableNumber(item.salePrice), wholesalePrice: formatEditableNumber(item.wholesalePrice || 0), posPrice: formatEditableNumber((item as any).posPrice ?? item.salePrice ?? 0),
            imageUrl: item.imageUrl || '', minStockAlert: (item.minStockAlert || 5).toString(),
            model: item.model || '', dimensions: item.dimensions || '', color: item.color || '',
            origin: item.origin || '', manufacturer: item.manufacturer || '',
            grossWeight: (item.grossWeight || '').toString(), netWeight: (item.netWeight || '').toString(),
            notes: item.notes || '',
            isTextile: Boolean((item as any).isTextile),
            textileBaseUom: String((item as any).textileBaseUom || 'meter'),
            supportsColorDimension: Boolean((item as any).supportsColorDimension),
            isScaleItem: Boolean((item as any).isScaleItem),
            scalePluCode: String((item as any).scalePluCode || ''),
            scaleBarcodePrefix: String((item as any).scaleBarcodePrefix || SCALE_LABEL_PRESET.prefix),
            scaleBarcodeMode: String((item as any).scaleBarcodeMode || SCALE_LABEL_PRESET.mode),
            scaleUnit: String((item as any).scaleUnit || SCALE_LABEL_PRESET.unit),
            scalePricePerKg: String((item as any).scalePricePerKg ?? ''),
            scaleItemCodeLength: String((item as any).scaleItemCodeLength ?? SCALE_LABEL_PRESET.itemCodeLength),
            scaleValueLength: String((item as any).scaleValueLength ?? SCALE_LABEL_PRESET.valueLength),
            scaleDecimals: String((item as any).scaleDecimals ?? SCALE_LABEL_PRESET.decimals)
        });
    } else {
        setEditingItem(null);
        const defaultCat = categories.find(c => c.name === 'رئيسي') || categories[0];
        const defaultSub = defaultCat ? (subCategories.find(sc => sc.categoryId === defaultCat.id && sc.name === 'عام') || subCategories.find(sc => sc.categoryId === defaultCat.id)) : null;
        const defaultUnit = units.find(u => u.name === 'قطعة') || units[0];
        setItemBarcodeInputs(['']);
        setItemForm({ 
            name: '', code: '', barcode: '', serialNumber: '', serialTracking: 'none',
            categoryId: defaultCat?.id || '', 
            subCategoryId: defaultSub?.id || '', 
            unitId: defaultUnit?.id || '', 
            warehouseId: warehouses[0]?.id || '', quantity: '', costPrice: '', salePrice: '', wholesalePrice: '', posPrice: '', imageUrl: '', minStockAlert: '5',
            model: '', dimensions: '', color: '', origin: '', manufacturer: '', grossWeight: '', netWeight: '', notes: '',
            isTextile: false, textileBaseUom: 'meter', supportsColorDimension: false,
            isScaleItem: false, scalePluCode: '', scaleBarcodePrefix: SCALE_LABEL_PRESET.prefix, scaleBarcodeMode: SCALE_LABEL_PRESET.mode, scaleUnit: SCALE_LABEL_PRESET.unit,
            scalePricePerKg: '', scaleItemCodeLength: SCALE_LABEL_PRESET.itemCodeLength, scaleValueLength: SCALE_LABEL_PRESET.valueLength, scaleDecimals: SCALE_LABEL_PRESET.decimals
        });
    }
    setIsItemModalOpen(true);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!(await confirmDialog('هل أنت متأكد من حذف هذه المادة نهائياً؟'))) return;
    try {
      await apiRequest(`inventory/${itemId}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((row) => String(row.id) !== String(itemId)));
    } catch (err: any) {
      alert(err?.response?.data?.error || 'فشل حذف المادة');
    }
  };

  const handleOpenBranchModal = (branch?: Branch) => {
      if (branch) {
          setEditingBranch(branch);
          setBranchForm({ name: branch.name, location: branch.location || '', manager: branch.manager || '', phone: branch.phone || '', notes: branch.notes || '' });
      } else {
          setEditingBranch(null);
          setBranchForm({ name: '', location: '', manager: '', phone: '', notes: '' });
      }
      setIsBranchModalOpen(true);
  };
  const handleOpenUnitModal = (unit?: Unit) => {
      if (unit) {
          setEditingUnit(unit);
          setUnitForm({
              name: unit.name || '',
              isBase: !!unit.isBase,
              baseUnitId: unit.baseUnitId || '',
              factor: String(unit.factor ?? 1)
          });
      } else {
          setEditingUnit(null);
          setUnitForm({ name: '', isBase: true, baseUnitId: '', factor: '1' });
      }
      setIsUnitModalOpen(true);
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!unitForm.name.trim()) { alert('يرجى إدخال اسم الوحدة'); return; }
      const factor = Number(unitForm.factor || 0);
      if (unitForm.isBase && factor !== 1) { alert('الوحدة الأساسية يجب أن يكون عاملها 1'); return; }
      if (!unitForm.isBase) {
          if (!unitForm.baseUnitId) { alert('يرجى اختيار الوحدة الأساسية'); return; }
          if (editingUnit && unitForm.baseUnitId === editingUnit.id) { alert('لا يمكن أن تكون الوحدة مشتقة من نفسها'); return; }
          const base = units.find(u => u.id === unitForm.baseUnitId);
          if (!base || !(base.isBase || !base.baseUnitId)) { alert('يجب اختيار وحدة أساسية فعلاً'); return; }
          if (!factor || factor <= 0) { alert('قيمة المعامل يجب أن تكون رقمية أكبر من صفر'); return; }
      }

      const payload = {
          name: unitForm.name.trim(),
          isBase: unitForm.isBase ? 1 : 0,
          baseUnitId: unitForm.isBase ? null : unitForm.baseUnitId,
          factor: unitForm.isBase ? 1 : factor,
          multiplier: unitForm.isBase ? 1 : factor
      };

      try {
          if (editingUnit) {
              await apiRequest(`units/${editingUnit.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          } else {
              await apiRequest('units', { method: 'POST', body: JSON.stringify({ id: `u-${Date.now()}`, ...payload }) });
          }
          await loadConfig();
          await refreshData();
          setIsUnitModalOpen(false);
          setEditingUnit(null);
          setUnitForm({ name: '', isBase: true, baseUnitId: '', factor: '1' });
      } catch (err: any) {
          alert(err.message || 'فشل حفظ الوحدة');
      }
  };


  const handleDeleteBranch = async (id: string) => {
      const linkedWH = warehouses.filter(w => w.branchId === id);
      if (linkedWH.length > 0) {
          alert(`لا يمكن حذف الفرع! يوجد ${linkedWH.length} مستودعات مرتبطة به.`);
          return;
      }
      if (!(await confirmDialog("هل أنت متأكد من حذف هذا الفرع؟"))) return;
      try {
          await apiRequest(`branches/${id}`, { method: 'DELETE' });
          await loadConfig();
      } catch (e) { alert("فشل حذف الفرع"); }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        if (editingBranch) {
            await apiRequest(`branches/${editingBranch.id}`, { method: 'PUT', body: JSON.stringify(branchForm) });
        } else {
            await apiRequest('branches', { method: 'POST', body: JSON.stringify({ ...branchForm, id: `br-${Date.now()}`, createdAt: new Date().toISOString() }) });
        }
        await loadConfig();
        await refreshData();
        setIsBranchModalOpen(false);
        setBranchForm({ name: '', location: '', manager: '', phone: '', notes: '' });
    } catch (e) { alert("فشل حفظ الفرع"); }
    finally { setIsSaving(false); }
  };

  const handleDeleteConfig = async (type: string, id: string) => {
      let linkedItems: InventoryItem[] = [];
      let typeLabel = '';
      if (type === 'unit') { linkedItems = items.filter(i => i.unitId === id || i.unitName === id); typeLabel = 'وحدة القياس'; }
      else if (type === 'category') { linkedItems = items.filter(i => i.categoryId === id); typeLabel = 'الفئة'; }
      else if (type === 'sub') { linkedItems = items.filter(i => i.subCategoryId === id); typeLabel = 'التصنيف الفرعي'; }
      else if (type === 'warehouse') { linkedItems = items.filter(i => i.warehouseId === id); typeLabel = 'المستودع'; }

      if (linkedItems.length > 0) {
          alert(`خطأ تكتيكي: لا يمكن حذف ${typeLabel} لأنها مرتبطة بمواد في المخزون.`);
          return;
      }
      if (!(await confirmDialog(`هل أنت متأكد من حذف هذه الـ ${typeLabel}؟`))) return;
      const api = type === 'unit' ? 'units' : type === 'category' ? 'categories' : type === 'warehouse' ? 'warehouses' : 'sub-categories';
      try {
          await apiRequest(`${api}/${id}`, { method: 'DELETE' });
          await loadConfig();
          await refreshData();
      } catch (e) { alert("فشل الحذف من السيرفر."); }
  };

  const handleOpenEditConfig = (type: any, item: any) => {
      setEditingConfig({ type, item });
      setQuickAddValue(item.name);
      setShowQuickAdd({ type: 'edit' });
  };

  const handleSaveConfigUpdate = async () => {
      if (!editingConfig || !quickAddValue) return;
      const { type, item } = editingConfig;
      const api = type === 'unit' ? 'units' : type === 'category' ? 'categories' : type === 'warehouse' ? 'warehouses' : 'sub-categories';
      try {
          await apiRequest(`${api}/${item.id}`, { method: 'PUT', body: JSON.stringify({ name: quickAddValue }) });
          await loadConfig();
          await refreshData();
          const updatedItems = items.map(i => {
              if (type === 'unit' && (i.unitId === item.id || i.unitName === item.name)) return { ...i, unitName: quickAddValue };
              if (type === 'warehouse' && i.warehouseId === item.id) return { ...i, warehouseName: quickAddValue };
              return i;
          });
          setItems(updatedItems);
          setShowQuickAdd(null);
          setEditingConfig(null);
          setQuickAddValue('');
      } catch (e) { alert("فشل التحديث"); }
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferForm.itemId || !transferForm.toWH || !transferForm.quantity) return;
    const unit = units.find(u => u.id === transferForm.unitId) || units.find(u => u.name === transferForm.unitName);
    const unitName = unit?.name || transferForm.unitName || '';
    const factor = unit && !(unit.isBase || !unit.baseUnitId) ? Number(unit.factor || 1) : 1;
    const baseQuantity = Number(transferForm.quantity || 0) * factor;
    if (transferForm.fromWH === transferForm.toWH) { alert("لا يمكن المناقلة لنفس المستودع"); return; }
    
    setIsSaving(true);
    try {
        if (editingTransfer) {
        await apiRequest(`inventory/transfers/${editingTransfer.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                ...transferForm,
                quantity: Number(transferForm.quantity),
                baseQuantity,
                unitName,
                unitId: unit?.id || transferForm.unitId,
                transferNumber: transferForm.transferNo
            })
        });
    } else {
        await apiRequest('inventory/transfer', {
            method: 'POST',
            body: JSON.stringify({
                ...transferForm,
                quantity: Number(transferForm.quantity),
                baseQuantity,
                unitName,
                unitId: unit?.id || transferForm.unitId
            })
        });
    }
        
        const updatedFromApi = await apiRequest('inventory');
        setItems(updatedFromApi);
        const updatedTransfers = await apiRequest('inventory/transfers').catch(() => []);
        setTransferHistory(updatedTransfers);

        setIsTransferModalOpen(false);
        setEditingTransfer(null);
        setTransferForm({ itemId: '', fromWH: '', toWH: '', quantity: '', unitId: '', unitName: '', notes: '', transferNo: `TR-${Date.now().toString().slice(-6)}` });
        setTransferToBranchId('');
        alert("تمت عملية المناقلة بنجاح ✅");
    } catch (err: any) {
        alert(err.message || "فشل تنفيذ المناقلة");
    } finally { setIsSaving(false); }
  };

  
  const handleOpenEditTransfer = (tr: any) => {
    setEditingTransfer(tr);
    setTransferForm({
      itemId: tr.itemId || '',
      fromWH: tr.fromWarehouseId || '',
      toWH: tr.toWarehouseId || '',
      quantity: String(tr.quantity || ''),
      unitId: tr.unitId || '',
      unitName: tr.unitName || '',
      notes: tr.notes || '',
      transferNo: tr.transferNumber || tr.transferNo || `TR-${Date.now().toString().slice(-6)}`
    });
    setIsTransferModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => { setItemForm(prev => ({ ...prev, imageUrl: reader.result as string })); };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    if (textileModeEnabled && itemForm.isTextile) {
      const baseUom = String(itemForm.textileBaseUom || '').trim();
      const textileColorsText = String(itemForm.color || '').trim();
      if (baseUom !== 'meter' && baseUom !== 'yard') {
        alert('يجب تحديد وحدة القماش الأساسية: meter أو yard.');
        setIsSaving(false);
        return;
      }
      if (!textileColorsText) {
        alert('يرجى إدخال ألوان القماش داخل خصائص الأقمشة.');
        setIsSaving(false);
        return;
      }
    }
    if (itemForm.isScaleItem) {
      const plu = String(itemForm.scalePluCode || '').trim();
      const prefix = String(itemForm.scaleBarcodePrefix || '').trim();
      const codeLength = Number(itemForm.scaleItemCodeLength || 0);
      const valueLength = Number(itemForm.scaleValueLength || 0);
      const decimals = Number(itemForm.scaleDecimals || 0);
      const pricePerKg = Number(itemForm.scalePricePerKg || itemForm.salePrice || 0);

      if (!plu) { alert('يرجى إدخال كود الميزان (PLU).'); setIsSaving(false); return; }
      if (!prefix) { alert('يرجى إدخال بادئة باركود الميزان.'); setIsSaving(false); return; }
      if (!/^\d+$/.test(plu)) { alert('كود الميزان يجب أن يكون رقمياً فقط.'); setIsSaving(false); return; }
      if (!/^\d+$/.test(prefix)) { alert('بادئة باركود الميزان يجب أن تكون رقمية فقط.'); setIsSaving(false); return; }
      if (!Number.isInteger(codeLength) || codeLength <= 0) { alert('عدد خانات كود المادة في باركود الميزان غير صالح.'); setIsSaving(false); return; }
      if (!Number.isInteger(valueLength) || valueLength <= 0) { alert('عدد خانات الوزن/القيمة في باركود الميزان غير صالح.'); setIsSaving(false); return; }
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 5) { alert('عدد المنازل العشرية يجب أن يكون بين 0 و 5.'); setIsSaving(false); return; }
      if (plu.length !== codeLength) { alert(`\u0643\u0648\u062f \u0627\u0644\u0645\u064a\u0632\u0627\u0646 (PLU) \u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 ${codeLength} \u062e\u0627\u0646\u0627\u062a \u062a\u0645\u0627\u0645\u064b\u0627 \u0644\u064a\u0637\u0627\u0628\u0642 \u0627\u0644\u0644\u0635\u0627\u0642\u0629.`); setIsSaving(false); return; }

      if (itemForm.scaleBarcodeMode === 'weight' && !(pricePerKg > 0)) { alert('\u0633\u0639\u0631 \u0627\u0644\u0643\u064a\u0644\u0648 \u0645\u0637\u0644\u0648\u0628 \u0639\u0646\u062f \u0627\u062e\u062a\u064a\u0627\u0631 \u0628\u0627\u0631\u0643\u0648\u062f \u064a\u062d\u0645\u0644 \u0627\u0644\u0648\u0632\u0646.'); setIsSaving(false); return; }
    }

    const unitName = units.find(u => u.id === itemForm.unitId || u.name === itemForm.unitId)?.name || itemForm.unitId || 'قطعة';
    const warehouseName = warehouses.find(w => w.id === itemForm.warehouseId)?.name || 'رئيسي';
    const isScaleItem = Boolean(itemForm.isScaleItem);
    const normalizedScalePricePerKg = Number(itemForm.scalePricePerKg || itemForm.salePrice || 0);
    const normalizedBarcodes = Array.from(new Set(
      itemBarcodeInputs
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
    const payload = { 
        ...itemForm, unitName, warehouseName, 
        groupId: editingItem?.groupId || null,
        groupName: editingItem?.groupName || null,
        merged: editingItem?.merged || false,
        inactive: editingItem?.inactive || false,
        mergedIntoItemId: editingItem?.mergedIntoItemId || null,
        quantity: Number(itemForm.quantity) || 0, costPrice: Number(itemForm.costPrice) || 0,
        salePrice: Number(itemForm.salePrice) || 0, pricePerMeter: Number(itemForm.salePrice) || 0,
        wholesalePrice: Number(itemForm.wholesalePrice) || 0, posPrice: Number(itemForm.posPrice) || Number(itemForm.salePrice) || 0, minStockAlert: Number(itemForm.minStockAlert) || 5,
        grossWeight: Number(itemForm.grossWeight) || 0, netWeight: Number(itemForm.netWeight) || 0,
        isTextile: textileModeEnabled ? Boolean(itemForm.isTextile) : false,
        textileBaseUom: textileModeEnabled && itemForm.isTextile ? String(itemForm.textileBaseUom || 'meter') : null,
        supportsColorDimension: textileModeEnabled && itemForm.isTextile ? true : false,
        isScaleItem,
        scalePluCode: isScaleItem ? String(itemForm.scalePluCode || '').trim() : null,
        scaleBarcodePrefix: isScaleItem ? String(itemForm.scaleBarcodePrefix || '').trim() : null,
        scaleBarcodeMode: isScaleItem ? String(itemForm.scaleBarcodeMode || 'weight').trim().toLowerCase() : null,
        scaleUnit: isScaleItem ? String(itemForm.scaleUnit || 'gram').trim().toLowerCase() : null,
        scalePricePerKg: isScaleItem ? (normalizedScalePricePerKg > 0 ? normalizedScalePricePerKg : null) : null,
        scaleItemCodeLength: isScaleItem ? (Number(itemForm.scaleItemCodeLength) || null) : null,
        scaleValueLength: isScaleItem ? (Number(itemForm.scaleValueLength) || null) : null,
        scaleDecimals: isScaleItem ? Math.max(0, Number(itemForm.scaleDecimals) || 0) : null,
        serialTracking: itemForm.serialTracking || 'none',
        userId: currentUser?.id || 'local-user',
        lastUpdated: new Date().toISOString() 
    };
    delete (payload as any)._syncExchangeRate;
    if (editingItem) {
      delete (payload as any).quantity;
    }
    try {
        const targetId = editingItem?.id || `item-${Date.now()}`;
        if (editingItem) {
            await apiRequest(`inventory/${editingItem.id}`, { method: 'PUT', body: JSON.stringify(payload) });
            setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...payload } as InventoryItem : i));
            alert("تم تحديث بيانات المادة بنجاح ✅");
        } else {
            await apiRequest('inventory', { method: 'POST', body: JSON.stringify({ ...payload, id: targetId }) });
            setItems(prev => [{ ...payload, id: targetId } as InventoryItem, ...prev]);
            alert("تم إضافة المادة الجديدة بنجاح ✅");
        }

        const existingRows = itemBarcodes.filter((row) => String(row.itemId) === String(targetId));
        for (const row of existingRows) {
          await apiRequest(`item-barcodes/${row.id}`, { method: 'DELETE' });
        }
        for (const barcode of normalizedBarcodes) {
          await apiRequest('item-barcodes', {
            method: 'POST',
            body: JSON.stringify({ id: `ibarcode-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, itemId: targetId, barcode }),
          });
        }
        if (!editingItem && normalizedBarcodes.length > 0 && payload.barcode !== normalizedBarcodes[0]) {
          await apiRequest(`inventory/${targetId}`, {
            method: 'PUT',
            body: JSON.stringify({ barcode: normalizedBarcodes[0], userId: currentUser?.id || 'local-user' }),
          });
        }
        await loadConfig();
        setIsItemModalOpen(false);
    } catch(err: any) { alert(`فشل الحفظ: ${err.message}`); }
    finally { setIsSaving(false); }
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        await apiRequest('warehouses', { method: 'POST', body: JSON.stringify({ ...warehouseForm, id: `wh-${Date.now()}` }) });
        await loadConfig();
        await refreshData();
        setIsWarehouseModalOpen(false);
        setWarehouseForm({ name: '', code: '', location: '', manager: '', branchId: '', notes: '' });
    } catch (e) { alert("فشل إضافة المستودع"); }
    finally { setIsSaving(false); }
  };

  const handleQuickAdd = async () => {
      if (!quickAddValue || !showQuickAdd) return;
      if (showQuickAdd.type === 'edit') { handleSaveConfigUpdate(); return; }
      const api = showQuickAdd.type === 'unit' ? 'units' : showQuickAdd.type === 'category' ? 'categories' : showQuickAdd.type === 'warehouse' ? 'warehouses' : 'sub-categories';
      const body: any = { id: `${api.charAt(0)}-${Date.now()}`, name: quickAddValue };
      if (showQuickAdd.catId) body.categoryId = showQuickAdd.catId;
      try {
          await apiRequest(api, { method: 'POST', body: JSON.stringify(body) });
          await loadConfig();
          await refreshData();
          setQuickAddValue(''); setShowQuickAdd(null);
      } catch (e) { alert("فشل الإضافة السريعة"); }
  };

  // ── Full-area item form (replaces inventory content, stays within content column) ──
  if (isItemModalOpen) {
    return (
      <ItemFormModal
        open={isItemModalOpen}
        onClose={() => setIsItemModalOpen(false)}
        onSubmit={handleSubmitItem}
        editingItem={editingItem}
        isSaving={isSaving}
        itemModalTab={itemModalTab}
        setItemModalTab={setItemModalTab}
        itemForm={itemForm}
        setItemForm={setItemForm}
        fileInputRef={fileInputRef}
        handleImageUpload={handleImageUpload}
        categories={categories}
        availableSubCategories={availableSubCategories}
        baseUnits={baseUnits}
        warehouses={warehouses}
        itemBarcodeInputs={itemBarcodeInputs}
        setItemBarcodeInputs={setItemBarcodeInputs}
        applyScaleLabelPreset={applyScaleLabelPreset}
        scaleDecimalsHint={scaleDecimalsHint}
        scaleBarcodePreview={scaleBarcodePreview}
        scaleLabelPreset={SCALE_LABEL_PRESET}
        textileModeEnabled={textileModeEnabled}
      />
    );
  }

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="py-4 md:py-6" maxWidth="wide">
    <div className="space-y-6" onClick={() => showActionsMenu && setShowActionsMenu(false)}>
      <div className="bg-white px-5 pt-4 pb-3 rounded-2xl shadow-sm border border-gray-100">
        {/* ── Top bar: title + tabs + actions ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Title */}
          <h2 className="text-lg font-black text-gray-800 flex items-center gap-2 shrink-0">
            <Box className="text-primary" size={20}/> إدارة المخزون
          </h2>

          {/* View tabs */}
          <div className="inline-flex bg-gray-100 p-0.5 rounded-xl border gap-0.5 flex-wrap">
            <button onClick={() => setActiveView('items')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'items' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>المواد</button>
            <button onClick={() => setActiveView('inquiry')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'inquiry' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>استعلام</button>
            <button onClick={() => setActiveView('transfers')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'transfers' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>المناقلات</button>
            <button onClick={() => setActiveView('branches')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'branches' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>الفروع</button>
            <button onClick={() => setActiveView('config')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'config' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>الإعدادات</button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions dropdown + primary button */}
          <ResponsiveActionBar>
            {/* "أدوات" dropdown */}
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setShowActionsMenu(p => !p)}
                data-inventory-action="tools-toggle"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition ${showActionsMenu ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                <Settings2 size={14}/> أدوات <ChevronDown size={13} className={`transition-transform ${showActionsMenu ? 'rotate-180' : ''}`}/>
              </button>

              {showActionsMenu && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[220px] py-1.5 overflow-hidden animate-fadeIn">
                  {/* prices */}
                  <div className="px-3 py-1 text-[10px] font-black text-gray-400 uppercase tracking-wider">الأسعار</div>
                  <button onClick={() => { setIsBulkPriceModalOpen(true); setShowActionsMenu(false); }} disabled={!canEditSinglePrice && !canEditBulkPrice}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition">
                    <DollarSign size={14}/> تعديل الأسعار
                  </button>
                  {/* items */}
                  <div className="px-3 py-1 text-[10px] font-black text-gray-400 uppercase tracking-wider border-t mt-1">المواد</div>
                  <button onClick={() => { setIsGroupManagerOpen(true); setShowActionsMenu(false); }} disabled={!canManageGroups}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-40 transition">
                    <FolderTree size={14}/> مجموعات المواد
                  </button>
                  <button onClick={() => { setIsMergeModalOpen(true); setShowActionsMenu(false); }} disabled={!canMergeItems}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40 transition">
                    <Layers size={14}/> دمج مادتين
                  </button>
                  {canOpenInventoryPromotions && (
                    <button onClick={() => { setIsPromotionManagerOpen(true); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 transition">
                      <Tag size={14}/> العروض والتخفيضات
                    </button>
                  )}
                  <button onClick={() => { setIsSerialReportOpen(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition">
                    <Hash size={14}/> تقرير السيريال
                  </button>
                  <button onClick={() => { setIsItemTreeExportOpen(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition">
                    <FileText size={14}/> تصدير شجرة المواد
                  </button>
                  <button onClick={() => { setIsItemTreeImportOpen(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition">
                    <Upload size={14}/> استيراد شجرة المواد
                  </button>
                  {/* consignment */}
                  <div className="px-3 py-1 text-[10px] font-black text-gray-400 uppercase tracking-wider border-t mt-1">الأمانات</div>
                  {setActiveTab && (
                    <button onClick={() => { setActiveTab('consignments'); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-teal-700 hover:bg-teal-50 transition">
                      <PackageCheck size={14}/> بضاعة برسم الأمانة
                    </button>
                  )}
                  {/* logistics */}
                  <div className="px-3 py-1 text-[10px] font-black text-gray-400 uppercase tracking-wider border-t mt-1">اللوجستيات</div>
                  <button onClick={() => { setIsTransferModalOpen(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/5 transition">
                    <ArrowRightLeft size={14}/> مناقلة مستودع
                  </button>
                  <button onClick={() => { setIsWarehouseModalOpen(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-secondary hover:bg-secondary/5 transition">
                    <WarehouseIcon size={14}/> مستودع جديد
                  </button>
                  <button onClick={() => { handleOpenBranchModal(); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition">
                    <Building2 size={14}/> إضافة فرع
                  </button>
                  {/* navigation */}
                  {setActiveTab && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-black text-gray-400 uppercase tracking-wider border-t mt-1">روابط سريعة</div>
                      <button onClick={() => { setActiveTab('opening_stock'); setShowActionsMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 transition">
                        <Box size={14}/> مواد أول المدة
                      </button>
                      {canOpenDeliveryNotices && (
                        <button onClick={() => { setActiveTab('delivery_notices'); setShowActionsMenu(false); }}
                          data-inventory-action="delivery_notices"
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition">
                          <FileText size={14}/> إشعارات التسليم
                        </button>
                      )}
                      {canOpenDeliveryApprovals && (
                        <button onClick={() => { setActiveTab('delivery_approvals'); setShowActionsMenu(false); }}
                          data-inventory-action="delivery_approvals"
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition">
                          <ClipboardList size={14}/> اعتماد الإشعارات
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Primary: New item */}
            <button onClick={() => handleOpenItemModal()} className="bg-primary text-white px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow hover:bg-teal-800 transition">
              <Plus size={14}/> مادة جديدة
            </button>
          </ResponsiveActionBar>
        </div>

        {activeView === 'items' && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs font-bold text-gray-500">
                  <Filter size={14}/> تصفية:
                </label>
                <select
                  value={selectedWarehouseFilter}
                  onChange={(e) => setSelectedWarehouseFilter(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm font-bold text-primary outline-none focus:ring-0 md:w-auto"
                >
                  <option value="all">جميع المستودعات</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select
                  value={selectedGroupFilter}
                  onChange={(e) => setSelectedGroupFilter(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm font-bold text-primary outline-none focus:ring-0 md:w-auto"
                >
                  <option value="all">كل المجموعات</option>
                  {itemGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <select
                  value={selectedTextileColorFilter}
                  onChange={(e) => setSelectedTextileColorFilter(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm font-bold text-primary outline-none focus:ring-0 md:w-auto"
                >
                  <option value="all">كل الألوان</option>
                  {textileColors.map((color) => <option key={color.id} value={color.id}>{color.name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters((prev) => !prev)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-bold transition ${showAdvancedFilters ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-primary/30'}`}
                >
                  {showAdvancedFilters ? 'إخفاء الفلتر المتقدم' : 'فلتر متقدم'}
                </button>
                <button
                  type="button"
                  onClick={clearInventoryFilters}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-600 hover:bg-gray-100"
                >
                  مسح الفلاتر
                </button>
              </div>

              <div className="mr-auto flex items-center gap-2 text-xs font-bold text-gray-500">
                <button onClick={toggleSelectAllVisible} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-primary">
                  {allVisibleSelected ? 'إلغاء تحديد الظاهر' : 'تحديد الظاهر'}
                </button>
                <span>المحدد: {selectedItemIds.length}</span>
                <span>النتائج: {filteredItems.length}</span>
              </div>
            </div>

            {showAdvancedFilters && (
              <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-6 animate-fadeIn">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-500">الفئة</label>
                  <select value={selectedCategoryFilter} onChange={(e) => { setSelectedCategoryFilter(e.target.value); if (e.target.value === 'all') setSelectedSubCategoryFilter('all'); }} className="w-full rounded-lg border border-gray-200 px-3 py-2 font-bold outline-none focus:border-primary">
                    <option value="all">كل الفئات</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-500">التصنيف الفرعي</label>
                  <select value={selectedSubCategoryFilter} onChange={(e) => setSelectedSubCategoryFilter(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 font-bold outline-none focus:border-primary">
                    <option value="all">كل التصنيفات</option>
                    {subCategories.filter((sub) => selectedCategoryFilter === 'all' || String(sub.categoryId) === selectedCategoryFilter).map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-500">الوحدة</label>
                  <select value={selectedUnitFilter} onChange={(e) => setSelectedUnitFilter(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 font-bold outline-none focus:border-primary">
                    <option value="all">كل الوحدات</option>
                    {baseUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-500">من تاريخ</label>
                  <input type="date" value={dateFromFilter} onChange={(e) => setDateFromFilter(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 font-bold outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-500">إلى تاريخ</label>
                  <input type="date" value={dateToFilter} onChange={(e) => setDateToFilter(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 font-bold outline-none focus:border-primary" />
                </div>
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500">
                  يتم تطبيق التاريخ على آخر تحديث للمادة داخل البطاقة.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {activeView === 'items' && (
        <div className="bg-white rounded-xl shadow border overflow-hidden animate-fadeIn">
          {/* ── Search + Sort bar ── */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-gray-50">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="بحث بالاسم أو الكود أو الباركود..."
                className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold bg-white"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'date' | 'alpha' | 'numbers')}
              className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-primary bg-white outline-none cursor-pointer"
            >
              <option value="date">ترتيب: تاريخ</option>
              <option value="alpha">ترتيب: أبجدي</option>
              <option value="numbers">ترتيب: أرقام</option>
            </select>
            <span className="text-xs text-gray-400 font-bold whitespace-nowrap">{filteredItems.length} مادة</span>
          </div>

          {layout.isMobile ? (
            filteredItems.length === 0 ? (
              <div className="py-16 text-center text-gray-400 font-bold text-sm">لا توجد مواد تطابق البحث</div>
            ) : (
              <div className="space-y-3 p-3">
                {filteredItems.map((item) => {
                  const textileItemBalances = getTextileBalancesForItem(item);
                  const lowStock = Number(item.quantity || 0) <= Number(item.minStockAlert || 5);
                  const itemStatus = Number(item.quantity || 0) > 0 ? (lowStock ? 'منخفض' : 'متوفر') : 'نفد';
                  const statusClass = Number(item.quantity || 0) > 0
                    ? (lowStock ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')
                    : 'bg-rose-50 text-rose-700 border-rose-200';
                  return (
                    <div key={item.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-gray-800">{item.name}</div>
                          <div className="mt-1 truncate font-mono text-[11px] text-gray-400">
                            {item.code}{(item as any).barcode ? ` · ${(item as any).barcode}` : ''}
                          </div>
                        </div>
                        <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${statusClass}`}>
                          {itemStatus}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-gray-50 p-2">
                          <div className="text-[10px] font-bold text-gray-500">الرصيد</div>
                          <div className="mt-1 font-black text-blue-700">
                            {formatInventoryQty(item.quantity)} {item.unitName || ''}
                          </div>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-2">
                          <div className="text-[10px] font-bold text-gray-500">المجموعة / الوحدة</div>
                          <div className="mt-1 font-bold text-gray-700 truncate">
                            {(item as any).groupName || 'بدون مجموعة'} · {item.unitName || '—'}
                          </div>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-2">
                          <div className="text-[10px] font-bold text-emerald-700">سعر المفرق</div>
                          <div className="mt-1 font-black text-emerald-700 font-numeric">
                            {Number(item.salePrice || 0) > 0 ? `${formatNumber(item.salePrice)} ${currSym(item.priceCurrency)}` : '—'}
                          </div>
                        </div>
                        <div className="rounded-xl bg-orange-50 p-2">
                          <div className="text-[10px] font-bold text-orange-700">سعر الجملة</div>
                          <div className="mt-1 font-black text-orange-700 font-numeric">
                            {Number(item.wholesalePrice || 0) > 0 ? `${formatNumber(item.wholesalePrice)} ${currSym(item.priceCurrency)}` : '—'}
                          </div>
                        </div>
                      </div>
                      {textileModeEnabled && item.isTextile && textileItemBalances.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {textileItemBalances.slice(0, 3).map((balance) => (
                            <span key={balance.id} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">
                              {balance.colorName || 'بدون لون'}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenItemModal(item)}
                          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-3 text-xs font-black text-white"
                        >
                          تعديل
                        </button>
                        <InventoryRowActions
                          mode="menu"
                          onPrimaryEdit={() => handleOpenItemModal(item)}
                          onDelete={() => handleDeleteItem(String(item.id))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <>
              {/* ── Column headers ── */}
              <div className="grid items-center gap-2 px-4 py-2 bg-gray-100 border-b text-[11px] font-bold text-gray-500 uppercase tracking-wide select-none"
                style={{ gridTemplateColumns: '2rem 1fr 8rem 8rem 9rem 7rem 7rem 5rem' }}>
                <div>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} className="cursor-pointer" />
                </div>
                <div>المادة</div>
                <div className="text-center">المستودع</div>
                <div className="text-center">الرصيد</div>
                <div className="text-center">المفرق</div>
                <div className="text-center">الجملة</div>
                <div className="text-center">إجراءات</div>
              </div>

              {/* ── Rows ── */}
              {filteredItems.length === 0 ? (
                <div className="py-16 text-center text-gray-400 font-bold text-sm">لا توجد مواد تطابق البحث</div>
              ) : (
                filteredItems.map(item => {
              const isExpanded = expandedItemId === item.id;
              const textileItemBalances = getTextileBalancesForItem(item);
              return (
                <div key={item.id} className="border-b last:border-b-0">
                  {/* Main row */}
                  <div
                    className={`grid items-center gap-2 px-4 py-3 cursor-pointer transition-colors select-none ${isExpanded ? 'bg-teal-50/60' : 'hover:bg-gray-50'}`}
                    style={{ gridTemplateColumns: '2rem 1fr 8rem 8rem 9rem 7rem 7rem 5rem' }}
                    onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                  >
                    {/* checkbox */}
                    <div onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedItemIds.includes(String(item.id))} onChange={() => toggleItemSelection(String(item.id))} className="cursor-pointer" />
                    </div>
                    {/* name + code */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 shrink-0 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-100">
                        {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-contain" /> : <ImageIcon className="text-gray-200" size={15} />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-gray-800 text-sm truncate leading-tight">
                          <SmartLink type="product" id={item.id} inheritStyle tooltip="انقر لعرض تفاصيل المادة">
                            {item.name}
                          </SmartLink>
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono truncate">
                          {item.code}{(item as any).barcode ? ` · ${(item as any).barcode}` : ''}
                        </div>
                        {textileModeEnabled && item.isTextile && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">قماش</span>
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">{item.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}</span>
                          </div>
                        )}
                      </div>
                      {Boolean((item as any).isScaleItem) && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-cyan-50 text-cyan-700 border border-cyan-100">ميزان</span>
                      )}
                    </div>
                    {/* warehouse */}
                    <div className="text-center text-xs text-gray-500 truncate">{item.warehouseName || '—'}</div>
                    <div className="text-center">
                      {textileModeEnabled && item.isTextile && textileItemBalances.length > 0 ? (
                        <div className="space-y-1">
                          {textileItemBalances.slice(0, 2).map((balance) => (
                            <div key={balance.id} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">
                              {balance.colorName || 'بدون لون'}
                            </div>
                          ))}
                          {textileItemBalances.length > 2 && (
                            <div className="text-[10px] font-black text-gray-400">+{textileItemBalances.length - 2}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                    {/* qty */}
                    <div className="text-center">
                      <span className={`font-black text-base font-numeric ${Number(item.quantity) > 0 ? 'text-blue-700' : 'text-gray-400'}`}>{formatInventoryQty(item.quantity)}</span>
                      {item.unitName && <span className="text-[10px] text-gray-400 block leading-none">{item.unitName}</span>}
                      {textileModeEnabled && item.isTextile && textileItemBalances.length > 0 && (
                        <span className="mt-1 block text-[10px] font-black text-emerald-700">
                          {textileItemBalances.reduce((sum, balance) => sum + Number(balance.rollCount || 0), 0)} رول
                        </span>
                      )}
                    </div>
                    {/* sale price */}
                    <div className="text-center font-bold text-green-700 text-sm font-numeric">
                      {Number(item.salePrice || 0) > 0 ? `${formatNumber(item.salePrice)} ${currSym(item.priceCurrency)}` : <span className="text-gray-300">—</span>}
                    </div>
                    {/* wholesale price */}
                    <div className="text-center font-bold text-orange-600 text-sm font-numeric">
                      {Number(item.wholesalePrice || 0) > 0 ? `${formatNumber(item.wholesalePrice)} ${currSym(item.priceCurrency)}` : <span className="text-gray-300">—</span>}
                    </div>
                    {/* actions */}
                    <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleOpenItemModal(item)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition" title="تعديل"><Edit2 size={14}/></button>
                      <button onClick={() => handleDeleteItem(String(item.id))} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition" title="حذف"><Trash2 size={14}/></button>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {/* Expanded details panel */}
                  {isExpanded && (
                    <div className="border-t border-teal-100 bg-gradient-to-br from-teal-50/40 to-blue-50/30 px-6 py-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4 text-xs">
                        <div className="space-y-0.5">
                          <div className="text-gray-400 font-bold">سعر التكلفة</div>
                          <div className="font-black text-red-600 font-numeric">{Number(item.costPrice || 0) > 0 ? `${formatNumber(item.costPrice)} ${currSym(item.priceCurrency)}` : '—'}</div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="text-gray-400 font-bold">سعر المفرق</div>
                          <div className="font-black text-green-700 font-numeric">{Number(item.salePrice || 0) > 0 ? `${formatNumber(item.salePrice)} ${currSym(item.priceCurrency)}` : '—'}</div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="text-gray-400 font-bold">سعر الجملة</div>
                          <div className="font-black text-orange-600 font-numeric">{Number(item.wholesalePrice || 0) > 0 ? `${formatNumber(item.wholesalePrice)} ${currSym(item.priceCurrency)}` : '—'}</div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="text-gray-400 font-bold">المستودع</div>
                          <div className="font-bold text-gray-700">{item.warehouseName || '—'}</div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="text-gray-400 font-bold">المجموعة</div>
                          <div className="font-bold text-violet-700">{(item as any).groupName || 'بدون مجموعة'}</div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="text-gray-400 font-bold">الوحدة</div>
                          <div className="font-bold text-gray-700">{item.unitName || '—'}</div>
                        </div>
                        {(item as any).barcode && (
                          <div className="space-y-0.5">
                            <div className="text-gray-400 font-bold">الباركود</div>
                            <div className="font-mono text-gray-600">{(item as any).barcode}</div>
                          </div>
                        )}
                        {item.minStockAlert != null && (
                          <div className="space-y-0.5">
                            <div className="text-gray-400 font-bold">تنبيه أدنى مخزون</div>
                            <div className={`font-black font-numeric ${Number(item.quantity) <= (item.minStockAlert || 5) ? 'text-red-600' : 'text-gray-600'}`}>
                              {item.minStockAlert}
                              {Number(item.quantity) <= (item.minStockAlert || 5) && <span className="mr-1 text-red-500">⚠ منخفض</span>}
                            </div>
                          </div>
                        )}
                        {latestTransferByItemId.get(item.id) && (
                          <div className="space-y-0.5 col-span-2">
                            <div className="text-gray-400 font-bold">آخر نقل</div>
                            <div className="text-emerald-700 font-bold">
                              {latestTransferByItemId.get(item.id).fromWarehouseName || '—'} → {latestTransferByItemId.get(item.id).toWarehouseName || '—'} · {formatDate(latestTransferByItemId.get(item.id).date)}
                            </div>
                          </div>
                        )}
                        {item.notes && (
                          <div className="space-y-0.5 col-span-2">
                            <div className="text-gray-400 font-bold">ملاحظات</div>
                            <div className="text-gray-600">{item.notes}</div>
                          </div>
                        )}
                        {textileModeEnabled && item.isTextile && (
                          <div className="space-y-2 col-span-2 xl:col-span-6">
                            <div className="text-gray-400 font-bold">أرصدة الأقمشة حسب اللون</div>
                            {textileItemBalances.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-3 text-xs font-bold text-gray-400">
                                لا توجد أرصدة أقمشة مفصلة لهذا الصنف ضمن الفلاتر الحالية.
                              </div>
                            ) : (
                              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {textileItemBalances.map((balance) => (
                                  <div key={balance.id} className="rounded-xl border border-emerald-100 bg-white px-3 py-3">
                                    <div className="font-black text-emerald-800">{balance.colorName || 'بدون لون'}</div>
                                    <div className="mt-1 text-xs font-bold text-gray-600">{Number(balance.rollCount || 0)} رول</div>
                                    <div className="text-xs font-bold text-gray-600">
                                      {Number(balance.totalLength || 0).toFixed(2)} {balance.baseUom === 'yard' ? 'ياردة' : 'متر'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
            </>
          )}
        </div>
      )}

      {activeView === 'inquiry' && (
          <div className="bg-white rounded-xl shadow overflow-hidden border animate-fadeIn">
              <div className="p-6 bg-gradient-to-r from-teal-50 to-blue-50 border-b">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-3"><Eye className="text-teal-600"/> استعلام عن مادة</h3>
                  <p className="text-xs text-gray-500 mb-4">ابحث عن أي مادة بالاسم أو الكود أو الباركود لمعرفة تفاصيلها الكاملة وحركتها</p>
                  <div className="relative max-w-xl">
                      <Search className="absolute right-3 top-3 text-gray-400" size={20}/>
                      <input autoFocus type="text" placeholder="اكتب اسم المادة أو الكود أو الباركود..." 
                          className="w-full pr-10 pl-4 py-3 border-2 border-teal-200 rounded-xl font-bold text-lg outline-none focus:border-teal-500" 
                          value={inquirySearch} 
                          onChange={e => { setInquirySearch(e.target.value); setSelectedInquiryItem(null); }}
                      />
                  </div>
              </div>
              {!selectedInquiryItem && inquirySearch.trim() && (
                  <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto bg-gray-50">
                      {items.filter(i => matchesSmartSearch(i, inquirySearch)).length === 0 ? (
                          <div className="text-center text-gray-400 font-bold py-10">لا توجد نتائج</div>
                      ) : (
                          items.filter(i => matchesSmartSearch(i, inquirySearch)).slice(0, 20).map(item => (
                              <div key={item.id} onClick={async () => {
                                  setSelectedInquiryItem(item);
                                  try {
                                      const moves = await apiRequest(`reports/item-movement?itemId=${encodeURIComponent(item.id)}`);
                                      setInquiryMovements(Array.isArray(moves?.rows) ? moves.rows : Array.isArray(moves) ? moves : []);
                                  } catch { setInquiryMovements([]); }
                              }} className="bg-white p-4 rounded-xl shadow-sm cursor-pointer hover:bg-teal-50 hover:border-teal-300 border border-gray-100 flex items-center justify-between transition">
                                  <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden border">
                                          {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-contain"/> : <Package className="text-gray-300" size={18}/>}
                                      </div>
                                      <div>
                                          <div className="font-bold text-gray-800">{item.name}</div>
                                          <div className="text-[10px] text-gray-400 font-mono">{item.code} {item.barcode ? `| ${item.barcode}` : ''}</div>
                                      </div>
                                  </div>
                                  <div className="text-left">
                                      <div className="font-bold text-blue-700">{formatInventoryQty(item.quantity)} <span className="text-xs text-gray-400">{item.unitName}</span></div>
                                      <div className="text-xs text-green-600 font-bold">{formatNumber(item.salePrice)} {currSym(item.priceCurrency)}</div>
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              )}
              {selectedInquiryItem && (
                  <div className="p-6 space-y-6">
                      <button onClick={() => setSelectedInquiryItem(null)} className="text-xs text-gray-500 hover:text-primary font-bold flex items-center gap-1 mb-2">← العودة للنتائج</button>
                      <div className="flex items-start gap-6">
                          <div className="w-24 h-24 rounded-2xl bg-gray-50 flex items-center justify-center overflow-hidden border shadow-sm flex-shrink-0">
                              {selectedInquiryItem.imageUrl ? <img src={selectedInquiryItem.imageUrl} className="w-full h-full object-contain"/> : <Package className="text-gray-200" size={40}/>}
                          </div>
                          <div className="flex-1 min-w-0">
                              <h4 className="text-xl font-black text-gray-800">{selectedInquiryItem.name}</h4>
                              <div className="text-sm text-gray-500 font-mono mt-1">كود: {selectedInquiryItem.code} {selectedInquiryItem.barcode ? ` | باركود: ${selectedInquiryItem.barcode}` : ''} {selectedInquiryItem.serialNumber ? ` | سيريال: ${selectedInquiryItem.serialNumber}` : ''}</div>
                          </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                              <div className="text-xs text-blue-500 font-bold mb-1">الرصيد الحالي</div>
                              <div className="text-2xl font-black text-blue-700">{formatInventoryQty(selectedInquiryItem.quantity)}</div>
                              <div className="text-xs text-gray-500">{selectedInquiryItem.unitName}</div>
                          </div>
                          <div className="bg-green-50 p-4 rounded-xl border border-green-100 text-center">
                              <div className="text-xs text-green-500 font-bold mb-1">سعر المفرق</div>
                              <div className="text-2xl font-black text-green-700">{formatNumber(selectedInquiryItem.salePrice)} {currSym(selectedInquiryItem.priceCurrency)}</div>
                          </div>
                          <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 text-center">
                              <div className="text-xs text-orange-500 font-bold mb-1">سعر الجملة</div>
                              <div className="text-2xl font-black text-orange-700">{formatNumber(selectedInquiryItem.wholesalePrice || 0)} {currSym(selectedInquiryItem.priceCurrency)}</div>
                          </div>
                          <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center">
                              <div className="text-xs text-red-500 font-bold mb-1">سعر التكلفة</div>
                              <div className="text-2xl font-black text-red-700">{formatNumber(selectedInquiryItem.costPrice)} {currSym(selectedInquiryItem.priceCurrency)}</div>
                          </div>
                      </div>
                      {(selectedInquiryItem.model || selectedInquiryItem.manufacturer || selectedInquiryItem.origin || selectedInquiryItem.color || selectedInquiryItem.dimensions) && (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-gray-50 p-4 rounded-xl border">
                              {selectedInquiryItem.model && <div><span className="text-xs text-gray-500">الموديل:</span> <span className="font-bold text-sm">{selectedInquiryItem.model}</span></div>}
                              {selectedInquiryItem.manufacturer && <div><span className="text-xs text-gray-500">الشركة المصنعة:</span> <span className="font-bold text-sm">{selectedInquiryItem.manufacturer}</span></div>}
                              {selectedInquiryItem.origin && <div><span className="text-xs text-gray-500">بلد المنشأ:</span> <span className="font-bold text-sm">{selectedInquiryItem.origin}</span></div>}
                              {selectedInquiryItem.color && <div><span className="text-xs text-gray-500">اللون:</span> <span className="font-bold text-sm">{selectedInquiryItem.color}</span></div>}
                              {selectedInquiryItem.dimensions && <div><span className="text-xs text-gray-500">الأبعاد:</span> <span className="font-bold text-sm">{selectedInquiryItem.dimensions}</span></div>}
                              {(selectedInquiryItem.grossWeight || selectedInquiryItem.netWeight) && <div><span className="text-xs text-gray-500">الوزن:</span> <span className="font-bold text-sm">{selectedInquiryItem.netWeight || '-'} صافي / {selectedInquiryItem.grossWeight || '-'} إجمالي</span></div>}
                          </div>
                      )}
                      <div className="bg-gray-50 p-4 rounded-xl border">
                          <div className="flex items-center gap-2 mb-2">
                              <WarehouseIcon size={16} className="text-primary"/>
                              <span className="font-bold text-sm text-gray-800">المستودع:</span>
                              <span className="font-bold text-primary">{selectedInquiryItem.warehouseName || '-'}</span>
                          </div>
                          {selectedInquiryItem.notes && (
                              <div className="text-xs text-gray-500 mt-2"><span className="font-bold">ملاحظات:</span> {selectedInquiryItem.notes}</div>
                          )}
                      </div>
                      {inquiryMovements.length > 0 && (
                          <div>
                              <h5 className="font-bold text-sm text-gray-700 flex items-center gap-2 mb-3"><History size={16} className="text-primary"/> آخر الحركات</h5>
                              <AdaptiveTable
                                  rows={inquiryMovements.slice(0, 15)}
                                  keyExtractor={(m: any, idx) => `movement-${idx}-${m.id || m.refNumber || m.invoiceNumber || ''}`}
                                  tabletColumnVisibility={['date', 'type', 'quantity', 'reference']}
                                  columns={[
                                      { id: 'date', header: 'التاريخ', cell: (m: any) => <span className="text-xs font-numeric">{formatDate(m.date)}</span> },
                                      { id: 'type', header: 'النوع', cell: (m: any) => <span className="text-xs font-bold">{m.movementType || m.type || m.kind || '-'}</span> },
                                      {
                                          id: 'quantity',
                                          header: 'الكمية',
                                          cell: (m: any) => (
                                              <span className={`inline-flex items-center gap-1 font-bold ${m.movementType === 'IN' || Number(m.qtyIn || m.inQty || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                  {m.movementType === 'IN' || Number(m.qtyIn || m.inQty || 0) > 0 ? <><TrendingUp size={12}/> +{m.quantity || m.qtyIn || m.inQty}</> : <><TrendingDown size={12}/> -{m.quantity || m.qtyOut || m.outQty}</>}
                                              </span>
                                          ),
                                          tdClassName: 'text-center',
                                      },
                                      { id: 'reference', header: 'المرجع', cell: (m: any) => <span className="text-xs text-gray-500">{m.refNumber || m.invoiceNumber || m.transferNumber || (typeof m.ref === 'string' ? m.ref : '-')}</span> },
                                  ]}
                                  mobileCardRender={(m: any) => (
                                      <div className="space-y-2">
                                          <div className="flex items-center justify-between gap-2">
                                              <div className="text-xs font-bold text-gray-700">{m.movementType || m.type || m.kind || '-'}</div>
                                              <div className="text-[11px] font-numeric text-gray-500">{formatDate(m.date)}</div>
                                          </div>
                                          <div className="text-sm font-bold">
                                              <span className={`inline-flex items-center gap-1 ${m.movementType === 'IN' || Number(m.qtyIn || m.inQty || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                  {m.movementType === 'IN' || Number(m.qtyIn || m.inQty || 0) > 0 ? <><TrendingUp size={12}/> +{m.quantity || m.qtyIn || m.inQty}</> : <><TrendingDown size={12}/> -{m.quantity || m.qtyOut || m.outQty}</>}
                                              </span>
                                          </div>
                                          <div className="text-xs text-gray-500">{m.refNumber || m.invoiceNumber || m.transferNumber || (typeof m.ref === 'string' ? m.ref : '-')}</div>
                                      </div>
                                  )}
                                  rowClassName={(_, idx) => idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                              />
                          </div>
                      )}
                  </div>
              )}
              {!inquirySearch.trim() && !selectedInquiryItem && (
                  <div className="p-16 text-center text-gray-300">
                      <ScanBarcode size={48} className="mx-auto mb-4 opacity-50"/>
                      <div className="font-bold text-lg">ابحث عن أي مادة</div>
                      <div className="text-sm">أدخل الاسم أو الكود أو رقم الباركود</div>
                  </div>
              )}
          </div>
      )}

      {activeView === 'branches' && (
          <div className="bg-white rounded-xl shadow overflow-hidden border animate-fadeIn">
              <div className="p-6 bg-gray-50 border-b flex justify-between items-center">
                  <div>
                      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Building2 className="text-indigo-600"/> إدارة فروع المؤسسة</h3>
                      <p className="text-xs text-gray-500">عرض وإدارة كافة الفروع والمواقع التابعة للمنظمة</p>
                  </div>
                  <button onClick={() => handleOpenBranchModal()} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-indigo-700 transition">+ فرع جديد</button>
              </div>
              <AdaptiveTable
              rows={branchesList}
              keyExtractor={(br) => br.id}
              emptyState={<div className="p-10 text-center text-gray-400 font-bold">لا يوجد فروع مضافة حالياً</div>}
              enableStickyActions
              tabletColumnVisibility={['name', 'manager', 'phone', 'actions']}
              columns={[
                  { id: 'name', header: 'اسم الفرع', cell: (br: any) => <span className="font-bold text-indigo-900">{br.name}</span> },
                  { id: 'location', header: 'الموقع', cell: (br: any) => <div className="flex items-center gap-2 text-sm text-gray-600"><MapPin size={14}/> {br.location || '-'}</div> },
                  { id: 'manager', header: 'المدير المسؤول', cell: (br: any) => <div className="flex items-center gap-2 text-sm font-bold text-gray-700"><User size={14}/> {br.manager || '-'}</div> },
                  { id: 'phone', header: 'رقم الهاتف', cell: (br: any) => <span className="font-numeric text-sm">{br.phone || '-'}</span>, tdClassName: 'text-center' },
                  { id: 'createdAt', header: 'تاريخ التأسيس', cell: (br: any) => <span className="text-xs text-gray-500 font-numeric">{formatDate(br.createdAt)}</span>, tdClassName: 'text-center' },
                  {
                      id: 'actions',
                      header: 'الإجراءات',
                      cell: (br: any) => (
                          <InventoryRowActions
                              mode={layout.isTablet ? 'menu' : 'buttons'}
                              onPrimaryEdit={() => handleOpenBranchModal(br)}
                              onDelete={() => handleDeleteBranch(br.id)}
                          />
                      ),
                      tdClassName: 'text-center',
                  },
              ]}
              mobileCardRender={(br: any) => (
                  <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-indigo-900">{br.name}</div>
                          <InventoryRowActions
                              mode="buttons"
                              onPrimaryEdit={() => handleOpenBranchModal(br)}
                              onDelete={() => handleDeleteBranch(br.id)}
                          />
                      </div>
                      <div className="text-xs text-gray-600">{br.location || '-'}</div>
                      <div className="text-xs text-gray-600">{br.manager || '-'}</div>
                      <div className="text-[11px] text-gray-500 font-numeric">{formatDate(br.createdAt)}</div>
                  </div>
              )}
              rowClassName={(_, idx) => idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
          />
          </div>
      )}

      {activeView === 'transfers' && (
          <div className="bg-white rounded-xl shadow overflow-hidden border animate-fadeIn">
              <div className="p-6 bg-gray-50 border-b flex justify-between items-center">
                  <div>
                      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><History className="text-primary"/> سجل المناقلات المخزنية</h3>
                      <p className="text-xs text-gray-500">متابعة كافة حركات نقل البضائع بين الفروع والمستودعات</p>
                  </div>
                  <button onClick={() => setIsTransferModalOpen(true)} className="bg-primary text-white px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-teal-800 transition">+ تنفيذ مناقلة</button>
              </div>
              <AdaptiveTable
              rows={enrichedTransfers}
              keyExtractor={(tr: any) => tr.id}
              emptyState={<div className="p-10 text-center text-gray-400 font-bold">لا يوجد سجل مناقلات حتى الآن</div>}
              enableStickyActions
              tabletColumnVisibility={['transferNumber', 'date', 'itemName', 'quantity', 'toWarehouseName', 'actions']}
              columns={[
                  { id: 'transferNumber', header: 'رقم الحركة', cell: (tr: any) => <span className="font-bold text-xs font-mono">{tr.transferNumber}</span> },
                  { id: 'date', header: 'التاريخ', cell: (tr: any) => <span className="text-xs font-numeric">{formatDate(tr.date)}</span> },
                  { id: 'itemName', header: 'المادة', cell: (tr: any) => <span className="font-bold text-sm">{tr.itemName}</span> },
                  {
                    id: 'image',
                    header: 'صورة',
                    cell: (tr: any) => (
                      <div className="mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-gray-50 shadow-sm">
                        {tr.imageUrl ? <img src={tr.imageUrl} className="h-full w-full object-contain" /> : <ImageIcon className="text-gray-200" size={18} />}
                      </div>
                    ),
                    tdClassName: 'text-center',
                  },
                  { id: 'quantity', header: 'الكمية', cell: (tr: any) => <span className="font-bold text-primary font-numeric">{formatInventoryQty(tr.quantity)} {tr.unitName}</span>, tdClassName: 'text-center' },
                  { id: 'salePrice', header: 'سعر المفرق', cell: (tr: any) => <span className="font-bold text-green-700 font-numeric">{formatNumber(tr.salePrice)} {currSym(tr.priceCurrency)}</span>, tdClassName: 'text-center' },
                  { id: 'wholesalePrice', header: 'سعر الجملة', cell: (tr: any) => <span className="font-bold text-orange-600 font-numeric">{formatNumber(tr.wholesalePrice || 0)} {currSym(tr.priceCurrency)}</span>, tdClassName: 'text-center' },
                  { id: 'fromWarehouseName', header: 'من', cell: (tr: any) => <span className="rounded border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{tr.fromWarehouseName}</span>, tdClassName: 'text-center' },
                  { id: 'toWarehouseName', header: 'إلى', cell: (tr: any) => <span className="rounded border border-green-100 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">{tr.toWarehouseName}</span>, tdClassName: 'text-center' },
                  { id: 'notes', header: 'ملاحظات', cell: (tr: any) => <span className="text-xs text-gray-500 italic">{tr.notes || '-'}</span> },
                  {
                    id: 'actions',
                    header: 'إجراءات',
                    cell: (tr: any) => (
                      <InventoryRowActions
                        mode={layout.isTablet ? 'menu' : 'buttons'}
                        onPrimaryEdit={() => handleOpenEditTransfer(tr)}
                        onSecondaryAction={() => tr.toItem && handleOpenItemModal(tr.toItem)}
                        secondaryLabel="تعديل مادة الهدف"
                      />
                    ),
                    tdClassName: 'text-center',
                  },
              ]}
              mobileCardRender={(tr: any) => (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm">{tr.itemName}</div>
                      <div className="text-[11px] font-numeric text-gray-500">{tr.transferNumber} • {formatDate(tr.date)}</div>
                    </div>
                    <InventoryRowActions
                      mode="buttons"
                      onPrimaryEdit={() => handleOpenEditTransfer(tr)}
                      onSecondaryAction={() => tr.toItem && handleOpenItemModal(tr.toItem)}
                      secondaryLabel="تعديل مادة الهدف"
                    />
                  </div>
                  <div className="text-xs text-gray-600">{formatInventoryQty(tr.quantity)} {tr.unitName} • {formatNumber(tr.salePrice)} {currSym(tr.priceCurrency)}</div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="rounded border border-red-100 bg-red-50 px-2 py-0.5 font-bold text-red-700">{tr.fromWarehouseName}</span>
                    <span className="rounded border border-green-100 bg-green-50 px-2 py-0.5 font-bold text-green-700">{tr.toWarehouseName}</span>
                  </div>
                </div>
              )}
              rowClassName={(_, idx) => idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
          />
          </div>
      )}

      {activeView === 'config' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fadeIn">
              <ConfigBox title="المستودعات" items={warehouses} type="warehouse" icon={<WarehouseIcon size={18}/>} onAdd={() => setIsWarehouseModalOpen(true)} onEdit={handleOpenEditConfig} onDelete={handleDeleteConfig} />
                <ConfigBox title="الوحدات" items={units} type="unit" icon={<Ruler size={18}/>} onAdd={() => handleOpenUnitModal()} onEdit={(t:any,i:any)=> t==='unit'? handleOpenUnitModal(i) : handleOpenEditConfig(t,i)} onDelete={handleDeleteConfig} />
              <ConfigBox title="الفئات الرئيسية" items={categories} type="category" icon={<Tag size={18}/>} onAdd={() => setShowQuickAdd({type: 'category'})} onEdit={handleOpenEditConfig} onDelete={handleDeleteConfig} />
              
              <div className="bg-white p-6 rounded-xl shadow border h-fit space-y-4">
                  <h3 className="font-bold border-b pb-2 flex items-center gap-2 text-gray-700"><Settings2 size={18} className="text-primary"/> التصنيفات الفرعية</h3>
                  <div className="space-y-3 overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
                      {categories.map(c => (
                          <div key={c.id} className="border rounded-lg p-3 bg-gray-50/50">
                              <div className="flex justify-between items-center mb-2">
                                  <span className="font-bold text-xs text-primary">{c.name}</span>
                                  <button onClick={() => setShowQuickAdd({type: 'sub', catId: c.id})} className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full hover:bg-teal-800 transition">+ إضافة</button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                  {subCategories.filter(s => s.categoryId === c.id).map(s => (
                                      <div key={s.id} className="group relative flex items-center bg-white border border-gray-200 px-2 py-1 rounded text-[10px] font-bold text-gray-600 hover:border-primary transition">
                                          {s.name}
                                          <div className="mr-1 flex gap-0.5">
                                              <button onClick={() => handleOpenEditConfig('sub', s)} className="text-blue-400 hover:text-blue-600"><Edit2 size={8}/></button>
                                              <button onClick={() => handleDeleteConfig('sub', s.id)} className="text-red-400 hover:text-red-600"><Trash2 size={8}/></button>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {isItemTreeExportOpen && (
        <AdaptiveModal open={isItemTreeExportOpen} onClose={() => setIsItemTreeExportOpen(false)} size="md" zIndex={500}>
          <div className="flex h-full flex-col">
            <div className="p-4 md:p-6 bg-emerald-700 text-white flex justify-between items-center">
              <h3 className="text-lg font-black flex items-center gap-2"><FileText size={20}/> تصدير شجرة المواد</h3>
              <button onClick={() => setIsItemTreeExportOpen(false)}><XCircle size={22}/></button>
            </div>
            <div className="p-4 md:p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">نطاق التصدير</label>
                <select
                  value={itemTreeExportScope}
                  onChange={(e) => setItemTreeExportScope(e.target.value as 'filtered' | 'all')}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold"
                >
                  <option value="filtered">العناصر المفلترة</option>
                  <option value="all">كل المواد</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => handleExportItemTree('csv', itemTreeExportScope)}
                  className="rounded-xl bg-white border border-emerald-200 px-4 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50 transition"
                >
                  تصدير CSV
                </button>
                <button
                  onClick={() => handleExportItemTree('json', itemTreeExportScope)}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 transition"
                >
                  تصدير JSON
                </button>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {isItemTreeImportOpen && (
        <AdaptiveModal open={isItemTreeImportOpen} onClose={() => setIsItemTreeImportOpen(false)} size="xl" zIndex={500}>
          <div className="flex h-full flex-col">
            <div className="p-4 md:p-6 bg-indigo-700 text-white flex justify-between items-center">
              <h3 className="text-lg font-black flex items-center gap-2"><Upload size={20}/> استيراد شجرة المواد</h3>
              <button onClick={() => setIsItemTreeImportOpen(false)}><XCircle size={22}/></button>
            </div>
            <div className="p-4 md:p-6 space-y-4 overflow-y-auto">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleDownloadItemTreeTemplate('csv')}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-black text-gray-700 hover:bg-gray-50 transition"
                >
                  تحميل قالب CSV
                </button>
                <button
                  onClick={() => handleDownloadItemTreeTemplate('json')}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-black text-gray-700 hover:bg-gray-50 transition"
                >
                  تحميل قالب JSON
                </button>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">ملف الاستيراد</label>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) => e.target.files?.[0] && handleItemTreeFileSelected(e.target.files[0])}
                    className="w-full text-xs font-bold"
                  />
                  {itemTreeImportFileName && (
                    <div className="mt-2 text-[11px] font-bold text-gray-500">الملف: {itemTreeImportFileName}</div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">وضع الاستيراد</label>
                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    {(['create', 'update', 'upsert'] as ItemTreeImportMode[]).map((mode) => (
                      <label key={mode} className={`px-3 py-1.5 rounded-full border cursor-pointer ${itemTreeImportMode === mode ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                        <input
                          type="radio"
                          className="mr-2"
                          checked={itemTreeImportMode === mode}
                          onChange={() => setItemTreeImportMode(mode)}
                        />
                        {mode === 'create' ? 'إنشاء فقط' : mode === 'update' ? 'تحديث فقط' : 'إنشاء أو تحديث'}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">المستودع الافتراضي</label>
                    <select
                      value={itemTreeDefaultWarehouseId}
                      onChange={(e) => setItemTreeDefaultWarehouseId(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
                    >
                      <option value="">اختر مستودعاً</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">تاريخ أول المدة</label>
                    <input
                      type="date"
                      value={itemTreeOpeningDate}
                      onChange={(e) => setItemTreeOpeningDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">سنة أول المدة</label>
                    <input
                      type="text"
                      value={itemTreeFiscalYear}
                      onChange={(e) => setItemTreeFiscalYear(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
                    />
                  </div>
                </div>
              </div>

              {itemTreeImportErrors.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 space-y-1">
                  {itemTreeImportErrors.map((err, idx) => (
                    <div key={idx}>{err}</div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-bold">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">إنشاء: {itemTreeSummary.create}</div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-2 text-blue-700">تحديث: {itemTreeSummary.update}</div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-2 text-gray-600">تجاوز: {itemTreeSummary.skip}</div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700">أخطاء: {itemTreeSummary.error}</div>
              </div>

              {itemTreePreview.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  <div className="max-h-72 overflow-auto">
                    <AdaptiveTable
                    rows={itemTreePreview}
                    keyExtractor={(row) => `preview-${row.index}`}
                    tabletColumnVisibility={['index', 'name', 'action', 'notes']}
                    columns={[
                      { id: 'index', header: '#', cell: (row: any) => <span className="font-bold text-gray-500">{row.index}</span> },
                      { id: 'name', header: 'المادة', cell: (row: any) => <span className="font-bold text-gray-800">{row.data.name || '-'}</span> },
                      {
                        id: 'action',
                        header: 'الإجراء',
                        cell: (row: any) => (
                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${
                            row.action === 'create' ? 'bg-emerald-100 text-emerald-700'
                              : row.action === 'update' ? 'bg-blue-100 text-blue-700'
                              : row.action === 'skip' ? 'bg-gray-100 text-gray-600'
                              : 'bg-rose-100 text-rose-700'
                          }`}>
                            {row.action === 'create' ? 'إنشاء' : row.action === 'update' ? 'تحديث' : row.action === 'skip' ? 'تجاوز' : 'خطأ'}
                          </span>
                        ),
                      },
                      { id: 'notes', header: 'ملاحظات', cell: (row: any) => <span className="text-[11px] text-gray-500">{row.errors.length ? row.errors.join(' | ') : '—'}</span> },
                    ]}
                    mobileCardRender={(row: any) => (
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-gray-800">{row.data.name || '-'}</div>
                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${
                            row.action === 'create' ? 'bg-emerald-100 text-emerald-700'
                              : row.action === 'update' ? 'bg-blue-100 text-blue-700'
                              : row.action === 'skip' ? 'bg-gray-100 text-gray-600'
                              : 'bg-rose-100 text-rose-700'
                          }`}>
                            {row.action === 'create' ? 'إنشاء' : row.action === 'update' ? 'تحديث' : row.action === 'skip' ? 'تجاوز' : 'خطأ'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500">{row.errors.length ? row.errors.join(' | ') : '—'}</div>
                      </div>
                    )}
                    rowClassName={(_, idx) => idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  />
                  </div>
                </div>
              )}

              {itemTreeImportResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                  تم الاستيراد: إنشاء {itemTreeImportResult.created}، تحديث {itemTreeImportResult.updated}، تجاوز {itemTreeImportResult.skipped}، أخطاء {itemTreeImportResult.errors}.
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
                <button onClick={() => setIsItemTreeImportOpen(false)} className="w-full sm:w-auto px-6 py-2 text-gray-500 font-bold">إلغاء</button>
                <button
                  onClick={handleExecuteItemTreeImport}
                  disabled={itemTreeProcessing || itemTreePreview.length === 0}
                  className="w-full sm:w-auto bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition disabled:opacity-60"
                >
                  {itemTreeProcessing ? 'جاري الاستيراد...' : 'تنفيذ الاستيراد'}
                </button>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {/* --- باقي النوافذ المنبثقة (Modals) كما هي تماماً للحفاظ على استقرار النظام --- */}
      
      <BulkPriceUpdateModal
        open={isBulkPriceModalOpen}
        onClose={() => setIsBulkPriceModalOpen(false)}
        items={items}
        categories={categories}
        units={units}
        groups={itemGroups}
        selectedItemIds={selectedItemIds}
        currentUserId={currentUser?.id || 'local-user'}
        onExecute={handleExecuteBulkPriceUpdate}
      />

      <ItemGroupsManager
        open={isGroupManagerOpen}
        onClose={() => setIsGroupManagerOpen(false)}
        items={items}
        groups={itemGroups}
        assignments={itemGroupItems}
        selectedItemIds={selectedItemIds}
        currentUserId={currentUser?.id || 'local-user'}
        onReload={async () => {
          await loadConfig();
          await refreshData();
        }}
      />

      <MergeItemsModal
        open={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
        items={items}
        itemGroupItems={itemGroupItems}
        onExecute={handleExecuteItemMerge}
      />

      <PromotionManagerModal
        open={isPromotionManagerOpen}
        onClose={() => setIsPromotionManagerOpen(false)}
        items={items}
        promotions={promotions}
        onReload={async () => {
          await loadConfig();
          await refreshData();
        }}
      />

      <SerialTrackingReportModal
        open={isSerialReportOpen}
        onClose={() => setIsSerialReportOpen(false)}
        items={items}
        warehouses={warehouses}
      />

      {isBranchModalOpen && (
          <AdaptiveModal open={isBranchModalOpen} onClose={() => setIsBranchModalOpen(false)} size="md" zIndex={500} panelClassName="flex h-full max-h-[92vh] flex-col overflow-hidden border-t-8 border-indigo-600 bg-white md:rounded-3xl">
              <div className="flex h-full flex-col">
                  <div className="p-4 md:p-8 bg-gray-900 text-white flex justify-between items-center">
                      <div>
                          <h3 className="text-2xl font-black flex items-center gap-3"><Building2 size={32} className="text-indigo-400"/> {editingBranch ? 'تعديل الفرع' : 'إضافة فرع جديد'}</h3>
                          <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">Branch Management v1.1</p>
                      </div>
                      <button onClick={() => setIsBranchModalOpen(false)} className="bg-white/10 p-2 rounded-full hover:bg-red-500 transition"><XCircle size={24}/></button>
                  </div>
                  <form onSubmit={handleCreateBranch} className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-8 space-y-4 md:space-y-5 android-scroll-safe">
                      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">اسم الفرع</label>
                            <input required type="text" value={branchForm.name} onChange={e => setBranchForm({...branchForm, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold focus:border-indigo-500 outline-none" placeholder="فرع الكاشير، معرض حلب..." />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">الموقع / العنوان</label>
                                <input type="text" value={branchForm.location} onChange={e => setBranchForm({...branchForm, location: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none" placeholder="المنطقة - الشارع" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">المدير المسئول</label>
                                <input type="text" value={branchForm.manager} onChange={e => setBranchForm({...branchForm, manager: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none" placeholder="اسم مدير الفرع" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">رقم التواصل</label>
                            <input type="tel" value={branchForm.phone} onChange={e => setBranchForm({...branchForm, phone: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-numeric text-sm focus:border-indigo-500 outline-none" placeholder="09xxxxxxx" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">ملاحظات</label>
                            <textarea rows={2} value={branchForm.notes} onChange={e => setBranchForm({...branchForm, notes: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 text-xs focus:border-indigo-500 outline-none" placeholder="بيانات إضافية عن الفرع..."></textarea>
                        </div>
                      </div>
                      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 android-sticky-actions">
                          <button type="button" onClick={() => setIsBranchModalOpen(false)} className="w-full sm:w-auto px-6 py-2 text-gray-500 font-bold">إلغاء</button>
                          <button type="submit" disabled={isSaving} className="w-full sm:w-auto bg-indigo-600 text-white px-10 py-3 rounded-xl font-black shadow-lg hover:bg-indigo-700 transition">
                             {isSaving ? <RefreshCw className="animate-spin" size={18}/> : <Check size={18}/>} {editingBranch ? 'حفظ التغييرات' : 'حفظ الفرع'}
                          </button>
                      </div>
                  </form>
              </div>
          </AdaptiveModal>
      )}

      {isTransferModalOpen && (
          <AdaptiveModal open={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} size="lg" zIndex={500} panelClassName="flex h-full max-h-[92vh] flex-col overflow-hidden border-t-8 border-primary bg-white md:rounded-3xl">
              <div className="flex h-full flex-col">
                  <div className="p-4 md:p-8 bg-gray-900 text-white flex justify-between items-center">
                      <div>
                          <h3 className="text-2xl font-black flex items-center gap-3"><ArrowRightLeft size={32} className="text-primary"/> تنفيذ مناقلة مخزنية تكتيكية</h3>
                          <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">Transfer Operations v2.0</p>
                      </div>
                      <button onClick={() => setIsTransferModalOpen(false)} className="bg-white/10 p-2 rounded-full hover:bg-red-500 transition"><XCircle size={24}/></button>
                  </div>
                  <form onSubmit={handleSubmitTransfer} className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-8 space-y-4 md:space-y-6 android-scroll-safe">
                      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">رقم المناقلة</label>
                                <input readOnly type="text" value={transferForm.transferNo} className="w-full bg-gray-100 border-none rounded-2xl p-4 font-mono font-black text-blue-700" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">تاريخ الحركة</label>
                                <div className="p-3 bg-gray-100 rounded-xl font-bold text-gray-600 text-sm">{new Date().toLocaleDateString('ar-EG')}</div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">اختر الصنف المراد نقله</label>
                            <select 
                                required 
                                value={transferForm.itemId} 
                                onChange={e => {
                                    const itm = items.find(i => i.id === e.target.value);
                                    setTransferForm({...transferForm, itemId: e.target.value, fromWH: itm?.warehouseId || '', toWH: ''});
                                    setTransferToBranchId('');
                                }} 
                                className="w-full border-2 border-gray-100 rounded-xl p-4 font-bold text-lg bg-gray-50 focus:border-primary focus:bg-white outline-none transition"
                            >
                                <option value="">-- ابحث عن مادة --</option>
                                {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.code}) - الرصيد: {i.quantity} {i.unitName} - {i.warehouseName}</option>)}
                            </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 items-end">
                            <div className="md:col-span-1">
                                <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">الفرع المستلم (إلى)</label>
                                <select
                                    value={transferToBranchId}
                                    onChange={e => {
                                        setTransferToBranchId(e.target.value);
                                        setTransferForm({ ...transferForm, toWH: '' });
                                    }}
                                    className="w-full border-2 border-gray-200 rounded-xl p-3 font-bold text-gray-700 bg-white focus:border-primary outline-none"
                                >
                                    <option value="">-- اختر الفرع --</option>
                                    {branchesList.map(br => <option key={br.id} value={br.id}>{br.name}</option>)}
                                </select>
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">مستودع الوجهة (إلى)</label>
                                <select 
                                    required 
                                    value={transferForm.toWH} 
                                    onChange={e => setTransferForm({...transferForm, toWH: e.target.value})} 
                                    className="w-full border-2 border-primary/20 rounded-xl p-3 font-bold text-primary bg-primary/5 focus:border-primary outline-none"
                                >
                                    <option value="">-- اختر الهدف --</option>
                                    {warehouses
                                        .filter(w => w.id !== transferForm.fromWH)
                                        .filter(w => !transferToBranchId || w.branchId === transferToBranchId)
                                        .map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">الكمية المنقولة</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="number"
                                        step="0.01"
                                        value={transferForm.quantity}
                                        onChange={e => setTransferForm({...transferForm, quantity: e.target.value})}
                                        className="w-full border-2 border-gray-200 rounded-xl p-3 font-black text-2xl text-center focus:border-primary outline-none font-numeric"
                                        placeholder="0.00"
                                    />
                                    {transferForm.itemId && <span className="absolute right-2 bottom-3 text-[10px] font-bold text-gray-400">{items.find(i=>i.id===transferForm.itemId)?.unitName}</span>}
                                </div>
                            </div>
                            <div className="md:col-span-1">
                                <button type="submit" disabled={isSaving || !transferForm.quantity} className="w-full bg-primary text-white py-4 rounded-xl font-black shadow-xl hover:bg-teal-800 transition flex items-center justify-center gap-2 transform active:scale-95 disabled:bg-gray-300 tap-feedback">
                                    {isSaving ? <RefreshCw className="animate-spin"/> : <Check size={24}/>} تنفيذ النقل
                                </button>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase">سبب المناقلة / ملاحظات</label>
                            <input type="text" value={transferForm.notes} onChange={e => setTransferForm({...transferForm, notes: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-primary outline-none" placeholder="مثلاً: تغذية فرع الكاشير، طلب زبون..." />
                        </div>
                      </div>
                  </form>
              </div>
          </AdaptiveModal>
      )}

      {isWarehouseModalOpen && (
          <AdaptiveModal open={isWarehouseModalOpen} onClose={() => setIsWarehouseModalOpen(false)} size="md" zIndex={500}>
              <div className="flex h-full flex-col">
                  <div className="p-4 md:p-6 bg-secondary text-white flex justify-between items-center shrink-0"><h3 className="text-xl font-bold flex items-center gap-2"><WarehouseIcon size={24}/> إضافة مستودع</h3><button onClick={() => setIsWarehouseModalOpen(false)}><XCircle size={24}/></button></div>
                  <form onSubmit={handleCreateWarehouse} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 android-scroll-safe">
                      <div><label className="block text-xs font-bold text-gray-500 mb-1">اسم المستودع</label><input required type="text" value={warehouseForm.name} onChange={e => setWarehouseForm({...warehouseForm, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold focus:border-secondary outline-none" /></div>
                      <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">الفرع التابع</label>
                          <select value={warehouseForm.branchId} onChange={e => setWarehouseForm({...warehouseForm, branchId: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-secondary">
                              <option value="">-- بدون ربط بفرع --</option>
                              {branchesList.map(br => <option key={br.id} value={br.id}>{br.name}</option>)}
                          </select>
                      </div>
                      <div><label className="block text-xs font-bold text-gray-500 mb-1">الموقع</label><input type="text" value={warehouseForm.location} onChange={e => setWarehouseForm({...warehouseForm, location: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold focus:border-secondary outline-none" /></div>
                      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 android-sticky-actions">
                          <button type="button" onClick={() => setIsWarehouseModalOpen(false)} className="w-full sm:w-auto px-6 py-2 text-gray-400 font-bold">إلغاء</button>
                          <button type="submit" disabled={isSaving} className="w-full sm:w-auto bg-secondary text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-orange-600 transition">{isSaving ? 'جاري الحفظ...' : 'حفظ المستودع'}</button>
                      </div>
                  </form>
              </div>
          </AdaptiveModal>
      )}

      {isUnitModalOpen && (
          <AdaptiveModal open={isUnitModalOpen} onClose={() => setIsUnitModalOpen(false)} size="md" zIndex={500}>
              <div className="flex h-full flex-col">
                  <div className="p-4 md:p-6 bg-primary text-white flex justify-between items-center shrink-0">
                      <h3 className="text-xl font-bold flex items-center gap-2"><Ruler size={24}/> {editingUnit ? 'تعديل وحدة' : 'إضافة وحدة'}</h3>
                      <button onClick={() => setIsUnitModalOpen(false)}><XCircle size={24}/></button>
                  </div>
                  <form onSubmit={handleSaveUnit} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 android-scroll-safe">
                      <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">اسم الوحدة</label>
                          <input required type="text" value={unitForm.name} onChange={e => setUnitForm({...unitForm, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold focus:border-primary outline-none" />
                      </div>
                      <div className="flex items-center gap-2">
                          <input id="isBaseUnit" type="checkbox" checked={unitForm.isBase} onChange={e => setUnitForm({...unitForm, isBase: e.target.checked, baseUnitId: e.target.checked ? '' : unitForm.baseUnitId, factor: e.target.checked ? '1' : unitForm.factor})} />
                          <label htmlFor="isBaseUnit" className="text-xs font-bold text-gray-600">وحدة أساسية</label>
                      </div>
                      {!unitForm.isBase && (
                        <>
                          <div>
                              <label className="block text-xs font-bold text-gray-500 mb-1">الوحدة الأساسية</label>
                              <select value={unitForm.baseUnitId} onChange={e => setUnitForm({...unitForm, baseUnitId: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-primary">
                                  <option value="">-- اختر وحدة أساسية --</option>
                                  {baseUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                              </select>
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-gray-500 mb-1">المعامل (كم يساوي من الوحدة الأساسية)</label>
                              <input type="number" step="0.0001" value={unitForm.factor} onChange={e => setUnitForm({...unitForm, factor: e.target.value})} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-primary font-numeric text-center" placeholder="مثال: 1000 للطن إذا كانت الأساس كغ" />
                          </div>
                          <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                              <div className="text-[10px] font-black text-gray-500 uppercase mb-1">قاعدة التحويل</div>
                              <div className="text-sm font-black text-gray-700">
                                  {(() => {
                                      const base = units.find(u => u.id === unitForm.baseUnitId);
                                      const factor = Number(unitForm.factor || 1);
                                      return base ? `1 ${unitForm.name || 'وحدة'} = ${factor} ${base.name}` : 'اختر الوحدة الأساسية وأدخل المعامل';
                                  })()}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-2">أمثلة: 1 طن = 1000 كغ، 1 متر = 100 سم</div>
                          </div>
                        </>
                      )}
                      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 android-sticky-actions">
                          <button type="button" onClick={() => setIsUnitModalOpen(false)} className="w-full sm:w-auto px-6 py-2 text-gray-400 font-bold">إلغاء</button>
                          <button type="submit" disabled={isSaving} className="w-full sm:w-auto bg-primary text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-teal-800 transition">{isSaving ? 'جاري الحفظ...' : (editingUnit ? 'حفظ التغييرات' : 'حفظ الوحدة')}</button>
                      </div>
                  </form>
              </div>
          </AdaptiveModal>
      )}

      {showQuickAdd && (
          <AdaptiveModal open={!!showQuickAdd} onClose={() => { setShowQuickAdd(null); setQuickAddValue(''); setEditingConfig(null); }} size="md" zIndex={600}>
              <div className="w-full h-full md:h-auto md:max-w-md md:mx-auto bg-white rounded-none md:rounded-xl shadow-none md:shadow-2xl p-4 md:p-6 overflow-y-auto animate-fadeIn android-scroll-safe">
                  <h3 className="text-lg font-bold mb-4 border-b pb-2 flex items-center gap-2 text-primary">
                      {showQuickAdd.type === 'edit' ? 'تعديل البيانات' : `إضافة ${showQuickAdd.type === 'unit' ? 'وحدة' : showQuickAdd.type === 'category' ? 'فئة' : 'تصنيف'} جديد`}
                  </h3>
                  <input autoFocus type="text" value={quickAddValue} onChange={e => setQuickAddValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleQuickAdd()} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold mb-6 outline-none focus:border-primary" placeholder="ادخل الاسم هنا..." />
                  
                  {showQuickAdd.type === 'edit' && (
                      <div className="mb-4 p-3 bg-yellow-50 border border-yellow-100 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="text-yellow-600 shrink-0" size={16}/>
                        <p className="text-[10px] text-yellow-800 font-bold">تنبيه: تغيير الاسم هنا سيقوم بتحديث الأسماء المرتبطة في كافة سجلات المخزون فوراً لضمان دقة التقارير.</p>
                      </div>
                  )}

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
                      <button onClick={() => { setShowQuickAdd(null); setQuickAddValue(''); setEditingConfig(null); }} className="w-full sm:w-auto px-6 py-2 text-gray-600 font-bold hover:bg-gray-100 rounded-lg">إلغاء</button>
                      <button onClick={handleQuickAdd} className="w-full sm:w-auto bg-primary text-white px-8 py-2 rounded-xl font-bold shadow-lg">
                          {showQuickAdd.type === 'edit' ? 'تحديث البيانات' : 'إضافة الآن'}
                      </button>
                  </div>
              </div>
          </AdaptiveModal>
      )}
    </div>
    </ResponsivePage>
  );
};

const ConfigBox = ({title, items, type, icon, onAdd, onEdit, onDelete}: any) => (
    <div className="bg-white p-6 rounded-xl shadow border flex flex-col h-fit space-y-4 hover:shadow-md transition group/box">
        <h3 className="font-bold flex items-center gap-2 border-b pb-2 text-gray-700">{icon} {title}</h3>
        <div className="flex flex-wrap gap-2 overflow-y-auto max-h-[150px] custom-scrollbar">
            {items.length === 0 ? (
                <span className="text-xs text-gray-400 italic">لا يوجد سجلات</span>
            ) : (
                items.map((i: any) => (
                    <div key={i.id} className="group relative flex items-center bg-gray-50 border border-gray-200 px-3 py-1 rounded-full text-xs font-bold text-gray-600 hover:border-primary hover:bg-white transition shadow-sm">
                        {i.name}
                        <div className="mr-1.5 flex items-center gap-1">
                            <button onClick={() => onEdit(type, i)} className="text-blue-400 hover:text-blue-600" title="تعديل"><Edit2 size={10}/></button>
                            <button onClick={() => onDelete(type, i.id)} className="text-red-400 hover:text-red-600" title="حذف"><Trash2 size={10}/></button>
                        </div>
                    </div>
                ))
            )}
        </div>
        <button onClick={onAdd} className="w-full py-2 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded-xl text-xs font-bold transition border border-primary/20 shadow-sm">+ إضافة {title}</button>
    </div>
);

export default Inventory;
