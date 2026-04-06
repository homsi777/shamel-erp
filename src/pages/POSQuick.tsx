
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useModalEscape } from '../hooks/useEscapeKey';
import { 
  Search, X, ShoppingCart, CheckCircle2, AlertCircle, 
  RefreshCw, Layers, CreditCard, Wallet,
  Trash2, ArrowRight, Image as ImageIcon, Tag, DollarSign, Info, Globe, Palette, ScanBarcode, Printer, Eye, Download, MoreVertical, LogOut, FileText
} from 'lucide-react';
import { InventoryItem, Category, SubCategory, Client, CashBox, Warehouse, formatNumber, AppSettings, DEFAULT_LABELS, DEFAULT_PRINT_SETTINGS, DEFAULT_CURRENCY_RATES, type ItemBarcode, type Promotion } from '../types';
import { apiRequest, NetworkError, getCurrentOrgId, getCurrentBranchId, logout } from '../lib/api';
import {
  onPosSaleCompletedPrint,
  setLastPosInvoiceForReprint,
  reprintLastInvoice,
  reprintLastKitchenTicket,
  reprintLastBoth,
} from '../lib/printEngine';
import { confirmDialog } from '../lib/confirm';
import { printSaleInvoice, printSaleInvoiceBluetooth, printThermalReceiptWithPreview } from '../printing/printService';
import { buildThermalReceipt, type BluetoothPrinter, type PaperSize, type WindowsPrinter } from '../printing/thermalPrinter';
import { Capacitor } from '@capacitor/core';
import { isAndroidNative, scanBarcodeOnce } from '../lib/barcodeScanner';
import WindowsPrinterPicker from '../components/WindowsPrinterPicker';
import BluetoothPrinterPicker from '../components/BluetoothPrinterPicker';
import ThermalPrintPreviewModal from '../components/ThermalPrintPreviewModal';
import { useSyncQueue } from '../hooks/useSyncQueue';
import useResponsiveLayout from '../hooks/useResponsiveLayout';
import {
  BASE_CURRENCY,
  currencySymbol,
  invoiceAmountBase,
  lineTotalBase,
} from '../lib/currencySemantics';
import {
  customerDisplayStandbyPayload,
  type CustomerDisplayPayload,
  type CustomerDisplayLine,
  type CustomerDisplayMode,
} from '../types/customerDisplay';
import { AdaptiveModal } from '../components/responsive';

interface POSProps {
  inventory: InventoryItem[];
  categories: Category[];
  subCategories: SubCategory[];
  clients: Client[];
  cashBoxes: CashBox[];
  warehouses: Warehouse[];
  refreshData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
}

type CartPriceType = 'retail' | 'wholesale';

interface CartLine {
  itemId: string;
  qty: number;
  priceType: CartPriceType;
  price: number;
  sourceCurrency: 'USD' | 'SYP' | 'TRY';
  sourcePrice: number;
  sourceRate: number;
  isScaleItem?: boolean;
  scaleMode?: 'weight' | 'price';
  scaleUnit?: 'gram' | 'kilogram';
  scaleBarcode?: string;
  scaleWeightKg?: number;
  promotionId?: string;
  promotionName?: string;
  originalPrice?: number;
  discountAmount?: number;
}

const computeEan13CheckDigit = (data12: string) => {
  if (!/^\d{12}$/.test(data12)) return '';
  const sum = data12.split('').reduce((acc, digit, index) => {
    const value = Number(digit);
    return acc + value * (index % 2 === 0 ? 1 : 3);
  }, 0);
  return String((10 - (sum % 10)) % 10);
};

const POSQuick: React.FC<POSProps> = ({ 
  inventory, categories, subCategories, clients, cashBoxes, warehouses, refreshData, setActiveTab 
}) => {
  const toDisplayNumber = useCallback((value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }, []);

  const formatPosMoney = useCallback((value: unknown) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(toDisplayNumber(value))
  ), [toDisplayNumber]);

  const formatPosRate = useCallback((value: unknown) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(toDisplayNumber(value))
  ), [toDisplayNumber]);

  const formatPosQty = useCallback((value: unknown, maxFractionDigits = 3) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    }).format(toDisplayNumber(value))
  ), [toDisplayNumber]);

  const itemAvailableQty = useCallback((item: InventoryItem) => {
    const qty = Number((item as any)?.quantity ?? 0);
    return Number.isFinite(qty) ? qty : 0;
  }, []);

  const itemBlocksStockSale = useCallback((item: InventoryItem) => {
    const itemType = String(item?.itemType || 'STOCK').toUpperCase();
    return itemType !== 'SERVICE' && itemType !== 'NON_STOCK';
  }, []);

  const isOutOfStock = useCallback((item: InventoryItem) => (
    itemBlocksStockSale(item) && itemAvailableQty(item) <= 0
  ), [itemAvailableQty, itemBlocksStockSale]);

  const { performOfflineAction, isNetworkAvailable } = useSyncQueue();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeSubCategoryId, setActiveSubCategoryId] = useState<string | null>(null);
  const storedUser = localStorage.getItem('shamel_user');
  const currentUser = storedUser ? JSON.parse(storedUser) : null;
  const isAgentRestrictedMode = Array.isArray(currentUser?.permissions) && currentUser.permissions.includes('agent_mode_restricted');
  const fixedWarehouseId = currentUser?.posWarehouseId || '';
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(fixedWarehouseId || warehouses[0]?.id || '');
  const [todaySales, setTodaySales] = useState(0);
  
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [isOpeningCustomerDisplay, setIsOpeningCustomerDisplay] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [customerDisplaySuccess, setCustomerDisplaySuccess] = useState<{
    invoiceNumber: string;
    total: number;
    paid: number;
    remaining: number;
    currency: 'USD' | 'SYP' | 'TRY';
    currencySymbol: string;
  } | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const customerDisplayPopupRef = useRef<Window | null>(null);
  const customerDisplayChannelRef = useRef<BroadcastChannel | null>(null);

  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [selectedCashBoxId, setSelectedCashBoxId] = useState(cashBoxes[0]?.id || '');
  const [selectedClientId, setSelectedClientId] = useState(() => {
    const cashCust = clients.find(c => c.id === 'party-cash-customer');
    return cashCust ? cashCust.id : '';
  });
  const authScopeKey = `${getCurrentOrgId() || ''}:${getCurrentBranchId() || ''}`;
  const [selectedCurrency, setSelectedCurrency] = useState(() => {
    try {
      const saved = localStorage.getItem('shamel_settings');
      if (saved) { const s = JSON.parse(saved); if (s.defaultCurrency) return s.defaultCurrency; }
    } catch {}
    return 'USD';
  });
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [paidInput, setPaidInput] = useState('');
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);
  const [isSavingRates, setIsSavingRates] = useState(false);
  const [exchangeDraft, setExchangeDraft] = useState({ SYP: '', TRY: '' });
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [shiftInvoices, setShiftInvoices] = useState<any[]>([]);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftResetAt, setShiftResetAt] = useState<string | null>(() => {
    try { return localStorage.getItem('pos_shift_reset_at') || null; } catch { return null; }
  });
  const [printPromptOpen, setPrintPromptOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<any | null>(null);
  const [lastPrintAttempted, setLastPrintAttempted] = useState(false);
  /** Non-blocking hint when auto-print fails (silent; includes reprint action). */
  const [printFailHint, setPrintFailHint] = useState<string | null>(null);
  
  // Windows Printer Picker State
  const [windowsPrinterPickerOpen, setWindowsPrinterPickerOpen] = useState(false);
  const [bluetoothPrinterPickerOpen, setBluetoothPrinterPickerOpen] = useState(false);
  const [thermalPreviewOpen, setThermalPreviewOpen] = useState(false);
  const [previewReceiptData, setPreviewReceiptData] = useState<any>(null);
  const [tempPaperSize, setTempPaperSize] = useState<PaperSize>('80mm');

  const [localShiftInvoices, setLocalShiftInvoices] = useState<any[]>(() => {
    try {
      const orgId = getCurrentOrgId() || 'default';
      const raw = localStorage.getItem(`shamel_pos_offline_invoices_${orgId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const persistLocalShiftInvoices = (next: any[]) => {
    try {
      const orgId = getCurrentOrgId() || 'default';
      localStorage.setItem(`shamel_pos_offline_invoices_${orgId}`, JSON.stringify(next));
    } catch {}
    setLocalShiftInvoices(next);
  };

  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
      const saved = localStorage.getItem('shamel_settings');
      if (saved) setAppSettings(JSON.parse(saved));
  }, []);
  const searchTermRef = useRef('');
  const pendingAutoAddRef = useRef<number | null>(null);

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  const getExchangeRate = (from: 'USD', to: 'SYP' | 'TRY'): number => {
    if (!appSettings?.currencyRates) return 0;
    if (to === 'SYP') return appSettings.currencyRates.SYP || 0;
    if (to === 'TRY') return appSettings.currencyRates.TRY || 0;
    return 1;
  };

  const roundCurrency = (amount: number): number => {
    return Math.round(amount);
  };

  const [localRates, setLocalRates] = useState({ SYP: 0, TRY: 0 });
  const [itemBarcodes, setItemBarcodes] = useState<ItemBarcode[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const cashCustomerId = useMemo(() => {
    const cashCust = clients.find(c => c.id === 'party-cash-customer');
    return cashCust ? cashCust.id : '';
  }, [clients]);
  const supportedPriceCurrencies = new Set(['USD', 'SYP', 'TRY']);
  const resolveBasePrice = useCallback((item: InventoryItem, priceType: CartPriceType) => {
    const posPrice = Number((item as any).posPrice ?? 0);
    const salePrice = Number(item.salePrice || 0);
    const wholesalePrice = Number(item.wholesalePrice || 0);
    const effectiveRetailPrice = posPrice > 0 ? posPrice : salePrice;
    const effectiveWholesalePrice = wholesalePrice > 0
      ? wholesalePrice
      : (posPrice > 0 ? posPrice : salePrice);
    const rawPrice = Number(priceType === 'retail'
      ? effectiveRetailPrice
      : effectiveWholesalePrice);
    const rawCurrency = String((item as any).priceCurrency || 'USD').toUpperCase();
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      return { ok: false as const, reason: 'سعر الصنف غير صالح للبيع.' };
    }
    if (!supportedPriceCurrencies.has(rawCurrency)) {
      return { ok: false as const, reason: `عملة سعر الصنف غير معروفة (${rawCurrency || 'غير معروف'}).` };
    }
    const sourceCurrency = rawCurrency as 'USD' | 'SYP' | 'TRY';
    const sourceRate = sourceCurrency === 'USD'
      ? 1
      : Number((localRates as any)[sourceCurrency] || 0);
    if (sourceCurrency !== 'USD' && sourceRate <= 0) {
      return { ok: false as const, reason: `سعر الصرف غير متوفر لتحويل ${sourceCurrency}.` };
    }
    const priceBase = sourceCurrency === 'USD' ? rawPrice : (rawPrice / sourceRate);
    if (!Number.isFinite(priceBase) || priceBase <= 0) {
      return { ok: false as const, reason: 'فشل حساب السعر الأساسي للصنف.' };
    }
    return {
      ok: true as const,
      sourceCurrency,
      sourcePrice: rawPrice,
      sourceRate,
      priceBase,
    };
  }, [localRates]);

  const resolvePromotionPrice = useCallback((item: InventoryItem, basePrice: number, quantity: number) => {
    const today = new Date().toISOString().slice(0, 10);
    const promotion = promotions.find((entry) =>
      String(entry.status || 'active') === 'active'
      && Array.isArray(entry.itemIds)
      && entry.itemIds.includes(item.id)
      && String(entry.startDate || '') <= today
      && String(entry.endDate || '') >= today
    );
    if (!promotion) return null;
    let finalPrice = basePrice;
    if (promotion.discountType === 'percentage' && Number(promotion.discountPercent || 0) > 0) {
      finalPrice = Math.max(0, basePrice * (1 - Number(promotion.discountPercent || 0) / 100));
    } else if (promotion.discountType === 'amount' && Number(promotion.discountValue || 0) > 0) {
      finalPrice = Math.max(0, basePrice - Number(promotion.discountValue || 0));
    } else if (promotion.discountType === 'special_price' && Number(promotion.specialPrice || 0) > 0) {
      finalPrice = Number(promotion.specialPrice || 0);
    } else if (promotion.discountType === 'buy_quantity_discount' && Number(quantity || 0) >= Number(promotion.buyQuantity || 0) && Number(promotion.getDiscountPercent || 0) > 0) {
      finalPrice = Math.max(0, basePrice * (1 - Number(promotion.getDiscountPercent || 0) / 100));
    }
    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      price: finalPrice,
      originalPrice: basePrice,
      discountAmount: Math.max(0, basePrice - finalPrice),
    };
  }, [promotions]);

  useEffect(() => {
    const sypRate = getExchangeRate('USD', 'SYP');
    const tryRate = getExchangeRate('USD', 'TRY');
    setLocalRates({ SYP: sypRate, TRY: tryRate });
  }, [appSettings]);

  useEffect(() => {
    let cancelled = false;
    const loadInventoryHelpers = async () => {
      if (isAgentRestrictedMode) {
        if (!cancelled) {
          setItemBarcodes([]);
          setPromotions([]);
        }
        return;
      }
      try {
        const [barcodeRows, promotionRows] = await Promise.all([
          apiRequest('item-barcodes').catch(() => []),
          apiRequest('promotions').catch(() => []),
        ]);
        if (!cancelled) {
          setItemBarcodes(Array.isArray(barcodeRows) ? barcodeRows : []);
          setPromotions(Array.isArray(promotionRows) ? promotionRows.map((row: any) => ({
            ...row,
            itemIds: Array.isArray(row?.itemIds) ? row.itemIds : typeof row?.itemIds === 'string' ? JSON.parse(row.itemIds || '[]') : [],
          })) : []);
        }
      } catch {}
    };
    loadInventoryHelpers();
    return () => { cancelled = true; };
  }, [isAgentRestrictedMode]);

  useEffect(() => {
    if (!exchangeModalOpen) return;
    setExchangeDraft({
      SYP: String(localRates.SYP || DEFAULT_CURRENCY_RATES.SYP),
      TRY: String(localRates.TRY || DEFAULT_CURRENCY_RATES.TRY),
    });
  }, [exchangeModalOpen, localRates]);

  const isAndroid = isAndroidNative();
  const layout = useResponsiveLayout();
  const isAndroidLike = layout.isMobile || (layout.isTablet && layout.isTouchDevice);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const buildDefaultSettings = (): AppSettings => ({
    company: { name: 'ERP', address: '', phone1: '', phone2: '', email: '' },
    theme: { primaryColor: '#0f766e', backgroundColor: '#f3f4f6' },
    labels: DEFAULT_LABELS,
    print: DEFAULT_PRINT_SETTINGS,
    currencyRates: DEFAULT_CURRENCY_RATES,
    lowStockThreshold: 5,
    registeredDevices: []
  });

  // ================================ WINDOWS DIRECT PRINTING FUNCTIONS ================================
  
  const openWindowsPrintDialog = (receiptData: any, paperSize: PaperSize = '80mm') => {
    if (isAndroid) {
      const thermal = appSettings?.print?.thermal;
      if (thermal?.enabled && thermal?.printerId) {
        setPreviewReceiptData(receiptData);
        void handleBluetoothPrinterSelect({
          id: thermal.printerId,
          name: 'طابعة بلوتوث',
          address: thermal.printerId,
        }, (thermal.paperSize as PaperSize) || paperSize, true);
        return;
      }
      setPreviewReceiptData(receiptData);
      setTempPaperSize(paperSize);
      setBluetoothPrinterPickerOpen(true);
      return;
    }
    // On Windows/Electron: never show any picker â€” print directly and silently
    void (async () => {
      try {
        await printSaleInvoice(receiptData, { paperSize });
        setLastPrintAttempted(true);
      } catch {
        // silently ignore â€” never block the cashier with a dialog
      }
    })();
  };
  
  const handleWindowsPrinterSelect = async (printer: WindowsPrinter, paperSize: PaperSize) => {
    setWindowsPrinterPickerOpen(false);
    
    if (!previewReceiptData) return;
    
    try {
      await printSaleInvoice(previewReceiptData, { printer, paperSize });
      setStatusMsg({ type: 'success', text: 'تم ارسال امر الطباعة' });
      setLastPrintAttempted(true);
    } catch (e) {
      setStatusMsg({ type: 'error', text: 'فشلت الطباعة' });
    }
    setTimeout(() => setStatusMsg(null), 4000);
  };
  
  const handleWindowsPrinterClose = () => {
    setWindowsPrinterPickerOpen(false);
    setPreviewReceiptData(null);
  };

  const persistThermalDefaults = async (printer: BluetoothPrinter, paperSize: PaperSize) => {
    const baseSettings = appSettings || buildDefaultSettings();
    const currentPrint = baseSettings.print || DEFAULT_PRINT_SETTINGS;
    const nextPrint = {
      ...currentPrint,
      thermal: {
        ...(currentPrint.thermal || {}),
        enabled: true,
        autoPrintPos: true,
        printerId: printer.address || printer.id,
        printerName: printer.name || 'طابعة بلوتوث',
        paperSize,
      },
    };
    const nextSettings = { ...baseSettings, print: nextPrint };
    setAppSettings(nextSettings);
    localStorage.setItem('shamel_settings', JSON.stringify(nextSettings));
    try {
      await apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'print', value: nextPrint }) });
    } catch {}
  };

  const handleBluetoothPrinterSelect = async (printer: BluetoothPrinter, paperSize: PaperSize, silent = false) => {
    setBluetoothPrinterPickerOpen(false);
    if (!previewReceiptData) return;
    try {
      await persistThermalDefaults(printer, paperSize);
      await printSaleInvoiceBluetooth({
        printerIdOrMac: printer.address || printer.id,
        paper: paperSize,
        data: previewReceiptData,
      });
      setStatusMsg({ type: 'success', text: silent ? 'تمت الطباعة على الطابعة الافتراضية' : 'تم حفظ الطابعة والطباعة بنجاح' });
      setLastPrintAttempted(true);
    } catch (e: any) {
      setStatusMsg({ type: 'error', text: e?.message || 'فشلت الطباعة عبر البلوتوث' });
      if (silent) {
        setBluetoothPrinterPickerOpen(true);
      }
    }
    setTimeout(() => setStatusMsg(null), 4000);
  };
  
  const handleShowPreview = () => {
    if (!lastReceipt) return;
    setPreviewReceiptData(lastReceipt);
    setThermalPreviewOpen(true);
  };
  
  const handlePreviewPrint = (paperSize: PaperSize) => {
    setThermalPreviewOpen(false);
    setTempPaperSize(paperSize);
    setWindowsPrinterPickerOpen(true);
  };
  
  const handleQuickWindowsPrint = async () => {
    if (!lastReceipt) return;
    setPrintFailHint(null);
    const r = await reprintLastInvoice();
    if (r.success) {
      setStatusMsg({ type: 'success', text: 'تمت إعادة الطباعة' });
      setLastPrintAttempted(true);
    } else {
      setPrintFailHint('⚠️ فشل الطباعة — يمكنك إعادة الطباعة');
      if (isAndroid) {
        setPreviewReceiptData(lastReceipt);
        setTempPaperSize((appSettings?.print?.thermal?.paperSize as PaperSize) || '80mm');
        setBluetoothPrinterPickerOpen(true);
      }
      setStatusMsg({ type: 'error', text: r.error || 'فشلت الطباعة' });
    }
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const loadTodaySales = async () => {
    try {
      const list = await apiRequest('invoices');
      const todayStr = new Date().toISOString().split('T')[0];
      const resetTs = shiftResetAt ? new Date(shiftResetAt).getTime() : 0;
      const remoteFiltered = (Array.isArray(list) ? list : [])
        .filter((i: any) => {
          const isSale = i?.type === 'sale';
          const isToday = i?.date === todayStr;
          const whOk = (!selectedWarehouseId || i?.targetWarehouseId === selectedWarehouseId);
          const createdTs = new Date(i?.createdAt || i?.date).getTime();
          const afterReset = !resetTs || createdTs >= resetTs;
          return isSale && isToday && whOk && afterReset;
        })
      const localFiltered = (localShiftInvoices || []).filter((i: any) => {
        const isSale = i?.type === 'sale';
        const isToday = i?.date === todayStr;
        const whOk = (!selectedWarehouseId || i?.targetWarehouseId === selectedWarehouseId);
        const createdTs = new Date(i?.createdAt || i?.date).getTime();
        const afterReset = !resetTs || createdTs >= resetTs;
        return isSale && isToday && whOk && afterReset;
      });
      const map = new Map<string, any>();
      [...remoteFiltered, ...localFiltered].forEach((inv: any) => map.set(String(inv.id || inv.invoiceNumber), inv));
      const total = Array.from(map.values()).reduce((s: number, i: any) => s + invoiceAmountBase(i, 'total'), 0);
      setTodaySales(total);
    } catch {
      const todayStr = new Date().toISOString().split('T')[0];
      const resetTs = shiftResetAt ? new Date(shiftResetAt).getTime() : 0;
      const localFiltered = (localShiftInvoices || []).filter((i: any) => {
        const isSale = i?.type === 'sale';
        const isToday = i?.date === todayStr;
        const whOk = (!selectedWarehouseId || i?.targetWarehouseId === selectedWarehouseId);
        const createdTs = new Date(i?.createdAt || i?.date).getTime();
        const afterReset = !resetTs || createdTs >= resetTs;
        return isSale && isToday && whOk && afterReset;
      });
      const total = localFiltered.reduce((s: number, i: any) => s + invoiceAmountBase(i, 'total'), 0);
      setTodaySales(total);
    }
  };

  const loadShiftSummary = async () => {
    setShiftLoading(true);
    try {
      const list = await apiRequest('invoices');
      const todayStr = new Date().toISOString().split('T')[0];
      const resetTs = shiftResetAt ? new Date(shiftResetAt).getTime() : 0;
      const filtered = (Array.isArray(list) ? list : [])
        .filter((i: any) => {
          const isSale = i?.type === 'sale';
          const isToday = i?.date === todayStr;
          const whOk = (!selectedWarehouseId || i?.targetWarehouseId === selectedWarehouseId);
          const createdTs = new Date(i?.createdAt || i?.date).getTime();
          const afterReset = !resetTs || createdTs >= resetTs;
          return isSale && isToday && whOk && afterReset;
        });
      const localFiltered = (localShiftInvoices || []).filter((i: any) => {
        const isSale = i?.type === 'sale';
        const isToday = i?.date === todayStr;
        const whOk = (!selectedWarehouseId || i?.targetWarehouseId === selectedWarehouseId);
        const createdTs = new Date(i?.createdAt || i?.date).getTime();
        const afterReset = !resetTs || createdTs >= resetTs;
        return isSale && isToday && whOk && afterReset;
      });
      const map = new Map<string, any>();
      filtered.forEach((inv: any) => map.set(String(inv.id || inv.invoiceNumber), inv));
      localFiltered.forEach((inv: any) => map.set(String(inv.id || inv.invoiceNumber), inv));
      const merged = Array.from(map.values()).sort((a: any, b: any) => new Date(b?.createdAt || b?.date).getTime() - new Date(a?.createdAt || a?.date).getTime());
      setShiftInvoices(merged);

      const serverIds = new Set<string>(filtered.map((x: any) => String(x.id)));
      const keepLocal = (localShiftInvoices || []).filter((x: any) => !serverIds.has(String(x.id)));
      if (keepLocal.length !== (localShiftInvoices || []).length) persistLocalShiftInvoices(keepLocal);
    } catch {
      const todayStr = new Date().toISOString().split('T')[0];
      const resetTs = shiftResetAt ? new Date(shiftResetAt).getTime() : 0;
      const localFiltered = (localShiftInvoices || []).filter((i: any) => {
        const isSale = i?.type === 'sale';
        const isToday = i?.date === todayStr;
        const whOk = (!selectedWarehouseId || i?.targetWarehouseId === selectedWarehouseId);
        const createdTs = new Date(i?.createdAt || i?.date).getTime();
        const afterReset = !resetTs || createdTs >= resetTs;
        return isSale && isToday && whOk && afterReset;
      });
      setShiftInvoices(localFiltered);
    } finally {
      setShiftLoading(false);
    }
  };

  const [warehouseInitialized, setWarehouseInitialized] = useState(false);
  useEffect(() => {
      if (fixedWarehouseId) {
          setSelectedWarehouseId(fixedWarehouseId);
          setWarehouseInitialized(true);
      } else if (!warehouseInitialized && warehouses.length > 0) {
          setSelectedWarehouseId(warehouses[0].id);
          setWarehouseInitialized(true);
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedWarehouseId, warehouses, warehouseInitialized]);

  useEffect(() => {
    if (!selectedCashBoxId && cashBoxes.length > 0) {
      setSelectedCashBoxId(cashBoxes[0].id);
    }
  }, [cashBoxes, selectedCashBoxId]);

  useEffect(() => {
    const hasSelectedWarehouse = selectedWarehouseId
      ? warehouses.some((warehouse) => String(warehouse.id) === String(selectedWarehouseId))
      : true;
    if (hasSelectedWarehouse) return;

    const fallbackWarehouseId = fixedWarehouseId && warehouses.some((warehouse) => String(warehouse.id) === String(fixedWarehouseId))
      ? fixedWarehouseId
      : (warehouses[0]?.id || '');
    setSelectedWarehouseId(fallbackWarehouseId);
    setCart({});
    setIsCheckoutOpen(false);
  }, [fixedWarehouseId, selectedWarehouseId, warehouses]);

  useEffect(() => {
    const hasSelectedCashBox = selectedCashBoxId
      ? cashBoxes.some((cashBox) => String(cashBox.id) === String(selectedCashBoxId))
      : false;
    if (hasSelectedCashBox) return;
    setSelectedCashBoxId(cashBoxes[0]?.id || '');
  }, [cashBoxes, selectedCashBoxId]);

  useEffect(() => {
    if (paymentType !== 'credit') {
      if (!selectedClientId || !clients.some((client) => String(client.id) === String(selectedClientId))) {
        setSelectedClientId(cashCustomerId);
      }
      return;
    }
    if (selectedClientId && clients.some((client) => String(client.id) === String(selectedClientId))) return;
    setSelectedClientId(cashCustomerId || clients[0]?.id || '');
  }, [cashCustomerId, clients, paymentType, selectedClientId]);

  const lastScopeKeyRef = useRef(authScopeKey);
  useEffect(() => {
    if (lastScopeKeyRef.current === authScopeKey) return;
    lastScopeKeyRef.current = authScopeKey;
    setCart({});
    setIsCheckoutOpen(false);
    setPrintPromptOpen(false);
    setLastReceipt(null);
    setPrintFailHint(null);
    setSelectedCashBoxId(cashBoxes[0]?.id || '');
    setSelectedClientId(cashCustomerId || '');
    setSelectedWarehouseId((current) => {
      if (fixedWarehouseId && warehouses.some((warehouse) => String(warehouse.id) === String(fixedWarehouseId))) {
        return fixedWarehouseId;
      }
      if (current && warehouses.some((warehouse) => String(warehouse.id) === String(current))) {
        return current;
      }
      return warehouses[0]?.id || '';
    });
  }, [authScopeKey, cashBoxes, cashCustomerId, fixedWarehouseId, warehouses]);

  useEffect(() => { loadTodaySales(); }, [selectedWarehouseId]);

  const normalizeDigits = useCallback((value: string) => String(value || '').replace(/\D+/g, ''), []);
  const normalizeLookupCode = useCallback((value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ''), []);
  const normalizeSearchText = useCallback((value: string) => (
    String(value || '')
      .toLowerCase()
      .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ظ‰/g, 'ظٹ')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ), []);
  const compactSearchText = useCallback((value: string) => normalizeSearchText(value).replace(/\s+/g, ''), [normalizeSearchText]);
  const normalizeScaleCode = useCallback((value: string) => {
    const digits = normalizeDigits(value);
    const normalized = digits.replace(/^0+/, '');
    return normalized || '0';
  }, [normalizeDigits]);
  const inventoryInWarehouse = useMemo(
    () => (inventory || []).filter((item) => {
      if (item?.inactive || item?.merged) return false;
      // If no warehouse is selected (ALL), show everything
      if (!selectedWarehouseId) return true;
      return item?.warehouseId === selectedWarehouseId;
    }),
    [inventory, selectedWarehouseId]
  );

  const addToCart = useCallback((item: InventoryItem, priceType: CartPriceType, options?: {
    lineKey?: string;
    qty?: number;
    unitPriceBase?: number;
    sourceCurrency?: 'USD' | 'SYP' | 'TRY';
    sourcePrice?: number;
    sourceRate?: number;
    isScaleItem?: boolean;
    scaleMode?: 'weight' | 'price';
    scaleUnit?: 'gram' | 'kilogram';
    scaleBarcode?: string;
    scaleWeightKg?: number;
  }) => {
    if (isOutOfStock(item)) {
      setStatusMsg({
        type: 'error',
        text: `الصنف ${item.name} نفد من المخزون ولا يمكن إضافته إلى السلة.`,
      });
      setTimeout(() => setStatusMsg(null), 3500);
      return;
    }

    if (String((item as any)?.serialTracking || 'none') === 'required') {
      setStatusMsg({
        type: 'error',
        text: `الصنف ${item.name} يتطلب اختيار سيريال قبل البيع. استخدم شاشة الفواتير العادية لهذا الصنف.`,
      });
      setTimeout(() => setStatusMsg(null), 5000);
      return;
    }

    const qtyToAdd = Number(options?.qty ?? 1);
    if (!Number.isFinite(qtyToAdd) || qtyToAdd <= 0) return;
    const lineKey = options?.lineKey || item.id;
    const existingQty = Number(cart[lineKey]?.qty || 0);

    if (itemBlocksStockSale(item)) {
      const availableQty = itemAvailableQty(item);
      if (existingQty + qtyToAdd > availableQty) {
        setStatusMsg({
          type: 'error',
          text: `الكمية المتاحة من ${item.name} هي ${formatPosQty(availableQty)} فقط.`,
        });
        setTimeout(() => setStatusMsg(null), 3500);
        return;
      }
    }

    const resolved = options?.unitPriceBase !== undefined
      ? {
          ok: true as const,
          sourceCurrency: options?.sourceCurrency || 'USD',
          sourcePrice: Number(options?.sourcePrice ?? options?.unitPriceBase ?? 0),
          sourceRate: Number(options?.sourceRate ?? 1),
          priceBase: Number(options?.unitPriceBase ?? 0),
        }
      : resolveBasePrice(item, priceType);

    if (!resolved.ok) {
      setStatusMsg({ type: 'error', text: `${resolved.reason} لا يمكن إضافة الصنف.` });
      setTimeout(() => setStatusMsg(null), 4500);
      return;
    }
    if (!Number.isFinite(resolved.priceBase) || resolved.priceBase <= 0) {
      setStatusMsg({ type: 'error', text: 'تعذر حساب سعر صالح لهذا الصنف.' });
      setTimeout(() => setStatusMsg(null), 4500);
      return;
    }

    const promotion = resolvePromotionPrice(item, resolved.priceBase, qtyToAdd);
    const finalPriceBase = Number(promotion?.price ?? resolved.priceBase);
    setCart(prev => {
      const current = prev[lineKey];
      return {
        ...prev,
        [lineKey]: {
          itemId: item.id,
          qty: (current?.qty || 0) + qtyToAdd,
          priceType,
          price: finalPriceBase,
          sourceCurrency: resolved.sourceCurrency,
          sourcePrice: promotion ? promotion.originalPrice : resolved.sourcePrice,
          sourceRate: resolved.sourceRate,
          isScaleItem: options?.isScaleItem ?? current?.isScaleItem,
          scaleMode: options?.scaleMode ?? current?.scaleMode,
          scaleUnit: options?.scaleUnit ?? current?.scaleUnit,
          scaleBarcode: options?.scaleBarcode ?? current?.scaleBarcode,
          scaleWeightKg: Number(current?.scaleWeightKg || 0) + Number(options?.scaleWeightKg || 0),
          promotionId: promotion?.promotionId ?? (current as any)?.promotionId,
          promotionName: promotion?.promotionName ?? (current as any)?.promotionName,
          originalPrice: promotion?.originalPrice ?? (current as any)?.originalPrice,
          discountAmount: promotion?.discountAmount ?? (current as any)?.discountAmount,
        }
      };
    });
  }, [cart, isOutOfStock, itemAvailableQty, itemBlocksStockSale, resolveBasePrice, resolvePromotionPrice]);

  const decodeScaleBarcode = useCallback((rawCode: string): (
    | { kind: 'none' }
    | { kind: 'error'; reason: string }
    | {
        kind: 'ok';
        item: InventoryItem;
        qty: number;
        unitPriceBase: number;
        sourceCurrency: 'USD' | 'SYP' | 'TRY';
        sourcePrice: number;
        sourceRate: number;
        scaleMode: 'weight' | 'price';
        scaleUnit: 'gram' | 'kilogram';
        barcode: string;
        scaleWeightKg: number;
      }
  ) => {
    const code = normalizeDigits(rawCode);
    if (!code) return { kind: 'none' };

    const scaleItems = (inventoryInWarehouse || []).filter(i => Boolean((i as any).isScaleItem));
    if (scaleItems.length === 0) return { kind: 'none' };

    const prefixMatched = scaleItems.filter((item) => {
      const prefix = normalizeDigits(String((item as any).scaleBarcodePrefix || ''));
      return prefix && code.startsWith(prefix);
    });
    if (prefixMatched.length === 0) return { kind: 'none' };

    let firstError = '';
    for (const item of prefixMatched) {
      const prefix = normalizeDigits(String((item as any).scaleBarcodePrefix || ''));
      const pluConfig = normalizeDigits(String((item as any).scalePluCode || ''));
      const mode = String((item as any).scaleBarcodeMode || 'weight').toLowerCase() === 'price' ? 'price' : 'weight';
      const unit = String((item as any).scaleUnit || 'gram').toLowerCase() === 'kilogram' ? 'kilogram' : 'gram';
      const itemCodeLengthRaw = Number((item as any).scaleItemCodeLength || pluConfig.length || 0);
      const valueLengthRaw = Number((item as any).scaleValueLength || 0);
      const itemCodeLength = Number.isInteger(itemCodeLengthRaw) && itemCodeLengthRaw > 0 ? itemCodeLengthRaw : pluConfig.length;
      const valueLength = Number.isInteger(valueLengthRaw) && valueLengthRaw > 0 ? valueLengthRaw : 4;
      const prefixLength = prefix.length;
      const payloadLength = prefixLength + itemCodeLength + valueLength;
      const canUseEanCheckDigit = payloadLength === 12;
      const hasCheckDigit = canUseEanCheckDigit && code.length === payloadLength + 1;
      const isSupportedLength = code.length === payloadLength || hasCheckDigit;
      if (!isSupportedLength) {
        if (code.length < payloadLength) {
          if (!firstError) firstError = `باركود الميزان للصنف ${item.name} غير مكتمل.`;
          continue;
        }
        if (!firstError) firstError = `طول باركود الميزان للصنف ${item.name} لا يطابق إعدادات اللصاقة.`;
        continue;
      }

      const normalizedBarcode = code.slice(0, payloadLength);
      if (hasCheckDigit) {
        const actualCheckDigit = code.charAt(payloadLength);
        const expectedCheckDigit = computeEan13CheckDigit(normalizedBarcode);
        if (actualCheckDigit !== expectedCheckDigit) {
          if (!firstError) firstError = `رقم التحقق في باركود الميزان غير صحيح للصنف ${item.name}.`;
          continue;
        }
      }

      const pluFromBarcode = normalizeDigits(normalizedBarcode.slice(prefixLength, prefixLength + itemCodeLength));
      if (normalizeScaleCode(pluFromBarcode) !== normalizeScaleCode(pluConfig)) {
        continue;
      }

      const valueRaw = normalizeDigits(normalizedBarcode.slice(prefixLength + itemCodeLength, payloadLength));
      const valueNumber = Number(valueRaw);
      if (!Number.isFinite(valueNumber) || valueNumber <= 0) {
        if (!firstError) firstError = `قيمة الوزن/السعر في باركود الميزان غير صالحة للصنف ${item.name}.`;
        continue;
      }

      const resolved = resolveBasePrice(item, 'retail');
      if (!resolved.ok) {
        if (!firstError) firstError = `${resolved.reason} للصنف ${item.name}.`;
        continue;
      }

      const configuredDecimals = Number((item as any).scaleDecimals);
      const decimals = Number.isInteger(configuredDecimals) && configuredDecimals >= 0
        ? configuredDecimals
        : (mode === 'price' ? 2 : (unit === 'kilogram' ? 3 : 0));
      const value = valueNumber / Math.pow(10, decimals);
      const configuredPricePerKg = Number((item as any).scalePricePerKg || 0);
      const sourcePricePerKg = configuredPricePerKg > 0 ? configuredPricePerKg : Number(resolved.sourcePrice || 0);
      const sourceRate = Number(resolved.sourceRate || 1);
      const sourceCurrency = resolved.sourceCurrency;
      const pricePerKgBase = sourceCurrency === 'USD' ? sourcePricePerKg : sourcePricePerKg / sourceRate;

      if (mode === 'weight') {
        const weightKg = unit === 'gram' ? value / 1000 : value;
        if (!Number.isFinite(weightKg) || weightKg <= 0) {
          if (!firstError) firstError = `الوزن المستخرج من باركود الميزان غير صالح للصنف ${item.name}.`;
          continue;
        }
        if (!Number.isFinite(pricePerKgBase) || pricePerKgBase <= 0) {
          if (!firstError) firstError = `سعر الكيلو للصنف ${item.name} غير صالح.`;
          continue;
        }
        return {
          kind: 'ok',
          item,
          qty: weightKg,
          unitPriceBase: pricePerKgBase,
          sourceCurrency,
          sourcePrice: sourcePricePerKg,
          sourceRate,
          scaleMode: mode,
          scaleUnit: unit,
          barcode: hasCheckDigit ? code.slice(0, payloadLength + 1) : normalizedBarcode,
          scaleWeightKg: weightKg,
        };
      }

      const lineTotalTransaction = value;
      if (!Number.isFinite(lineTotalTransaction) || lineTotalTransaction <= 0) {
        if (!firstError) firstError = `السعر المضمّن في باركود الميزان غير صالح للصنف ${item.name}.`;
        continue;
      }
      const lineTotalBase = sourceCurrency === 'USD' ? lineTotalTransaction : (lineTotalTransaction / sourceRate);
      if (!Number.isFinite(lineTotalBase) || lineTotalBase <= 0) {
        if (!firstError) firstError = `تعذر تحويل قيمة باركود الميزان للصنف ${item.name}.`;
        continue;
      }

      const inferredWeightKg = pricePerKgBase > 0 ? lineTotalBase / pricePerKgBase : 1;
      const qty = Number.isFinite(inferredWeightKg) && inferredWeightKg > 0 ? inferredWeightKg : 1;
      const unitPriceBase = qty > 0 ? (lineTotalBase / qty) : lineTotalBase;
      const sourcePrice = qty > 0 ? (lineTotalTransaction / qty) : lineTotalTransaction;
      return {
        kind: 'ok',
        item,
        qty,
        unitPriceBase,
        sourceCurrency,
        sourcePrice,
        sourceRate,
        scaleMode: mode,
        scaleUnit: unit,
        barcode: hasCheckDigit ? code.slice(0, payloadLength + 1) : normalizedBarcode,
        scaleWeightKg: Number.isFinite(inferredWeightKg) && inferredWeightKg > 0 ? inferredWeightKg : 0,
      };
    }

    if (firstError) return { kind: 'error', reason: firstError };
    return { kind: 'error', reason: 'لم يتم العثور على مادة ميزان مطابقة لهذا الباركود.' };
  }, [inventoryInWarehouse, normalizeDigits, normalizeScaleCode, resolveBasePrice]);

  const tryAddProductByCode = useCallback((rawCode: string, options?: { silent?: boolean }) => {
    const code = String(rawCode || '').trim();
    if (!code) return false;

    const barcodeMatch = itemBarcodes.find((row) => String(row.barcode || '').trim() === code);
    const normalItem = (inventoryInWarehouse || []).find(i =>
      i?.barcode === code || i?.code === code || i?.serialNumber === code || String(i?.id) === String(barcodeMatch?.itemId || '')
    );
    if (normalItem) {
      addToCart(normalItem, 'retail');
      return true;
    }

    const decoded = decodeScaleBarcode(code);
    if (decoded.kind === 'none') return false;
    if (decoded.kind === 'error') {
      if (!options?.silent) {
        setStatusMsg({ type: 'error', text: decoded.reason });
        setTimeout(() => setStatusMsg(null), 4500);
      }
      return false;
    }

    const lineKey = decoded.scaleMode === 'price'
      ? `${decoded.item.id}::scale::${Date.now()}::${Math.random().toString(36).slice(2, 6)}`
      : decoded.item.id;

    addToCart(decoded.item, 'retail', {
      lineKey,
      qty: decoded.qty,
      unitPriceBase: decoded.unitPriceBase,
      sourceCurrency: decoded.sourceCurrency,
      sourcePrice: decoded.sourcePrice,
      sourceRate: decoded.sourceRate,
      isScaleItem: true,
      scaleMode: decoded.scaleMode,
      scaleUnit: decoded.scaleUnit,
      scaleBarcode: decoded.barcode,
      scaleWeightKg: decoded.scaleWeightKg,
    });
    return true;
  }, [addToCart, decodeScaleBarcode, inventoryInWarehouse, itemBarcodes]);

  const clearPendingAutoAdd = useCallback(() => {
    if (pendingAutoAddRef.current !== null) {
      window.clearTimeout(pendingAutoAddRef.current);
      pendingAutoAddRef.current = null;
    }
  }, []);

  const looksLikeImmediateCodeSearch = useCallback((value: string) => {
    const trimmed = String(value || '').trim();
    if (!trimmed || /\s/.test(trimmed)) return false;

    const digitsOnly = normalizeDigits(trimmed);
    if (digitsOnly.length >= 6 && digitsOnly.length === trimmed.length) return true;
    return /^[a-z0-9._/-]{4,}$/i.test(trimmed);
  }, [normalizeDigits]);

  const handleSearchInputChange = useCallback((rawValue: string) => {
    const nextValue = String(rawValue || '');
    setSearchTerm(nextValue);
    searchTermRef.current = nextValue;
    clearPendingAutoAdd();

    if (!looksLikeImmediateCodeSearch(nextValue)) return;

    const snapshot = nextValue.trim();
    pendingAutoAddRef.current = window.setTimeout(() => {
      pendingAutoAddRef.current = null;
      if (searchTermRef.current.trim() !== snapshot || !snapshot) return;
      const added = tryAddProductByCode(snapshot, { silent: true });
      if (!added) return;
      setSearchTerm('');
      searchTermRef.current = '';
      searchInputRef.current?.focus();
    }, 90);
  }, [clearPendingAutoAdd, looksLikeImmediateCodeSearch, tryAddProductByCode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditable = Boolean(
        activeElement &&
        (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.isContentEditable
        )
      );
      const isSearchFocused = activeElement === searchInputRef.current;

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !isEditable && e.key.length === 1) {
        e.preventDefault();
        searchInputRef.current?.focus();
        handleSearchInputChange(`${searchTermRef.current}${e.key}`);
        return;
      }

      if (e.key === 'Enter' && (isSearchFocused || !isEditable) && searchTermRef.current.trim() !== '') {
        clearPendingAutoAdd();
        const added = tryAddProductByCode(searchTermRef.current.trim());
        if (added) {
          setSearchTerm('');
          searchTermRef.current = '';
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearPendingAutoAdd, handleSearchInputChange, tryAddProductByCode]);

  useEffect(() => () => clearPendingAutoAdd(), [clearPendingAutoAdd]);

  const filteredProducts = useMemo(() => {
    const rawQuery = String(searchTerm || '').trim();
    const queryText = normalizeSearchText(rawQuery);
    const queryCompact = compactSearchText(rawQuery);
    const queryDigits = normalizeDigits(rawQuery);
    const queryTokens = queryText ? queryText.split(' ').filter(Boolean) : [];

    return inventoryInWarehouse
      .filter((item) => {
        if (item?.inactive || item?.merged) return false;
        const matchCat = !activeCategoryId || item?.categoryId === activeCategoryId;
        const matchSubCat = !activeSubCategoryId || item?.subCategoryId === activeSubCategoryId;
        return matchCat && matchSubCat;
      })
      .map((item) => {
        if (!rawQuery) {
          return { item, score: 0 };
        }

        const name = normalizeSearchText(item?.name || '');
        const model = normalizeSearchText(item?.model || '');
        const code = normalizeLookupCode(item?.code || '');
        const serial = normalizeLookupCode(item?.serialNumber || '');
        const barcode = normalizeDigits(String(item?.barcode || ''));
        const extraBarcodes = itemBarcodes
          .filter((row) => String(row.itemId) === String(item.id))
          .map((row) => normalizeDigits(String(row.barcode || '')))
          .filter(Boolean);
        const scalePluCode = normalizeDigits(String((item as any)?.scalePluCode || ''));
        const searchableTextFields = [name, model].filter(Boolean);
        const searchableCompactFields = [
          code,
          serial,
          compactSearchText(item?.name || ''),
          compactSearchText(item?.model || ''),
          compactSearchText(item?.manufacturer || ''),
          compactSearchText(item?.origin || ''),
        ].filter(Boolean);

        let score = -1;
        if (queryDigits && (barcode === queryDigits || extraBarcodes.includes(queryDigits))) score = 150;
        else if (queryDigits && scalePluCode === queryDigits) score = 145;
        else if (queryCompact && code === queryCompact) score = 140;
        else if (queryCompact && serial === queryCompact) score = 135;
        else if (queryText && name === queryText) score = 125;
        else if (queryText && model === queryText) score = 120;
        else if (queryText && searchableTextFields.some((field) => field.startsWith(queryText))) score = 110;
        else if (queryCompact && searchableCompactFields.some((field) => field.startsWith(queryCompact))) score = 100;
        else if (
          queryTokens.length > 0 &&
          queryTokens.every((token) => searchableTextFields.some((field) => field.includes(token)))
        ) score = 95;
        else if (
          queryTokens.length > 0 &&
          queryTokens.every((token) => searchableCompactFields.some((field) => field.includes(token)))
        ) score = 90;
        else if (queryCompact && searchableCompactFields.some((field) => field.includes(queryCompact))) score = 80;
        else if (queryDigits && ((barcode.startsWith(queryDigits) && queryDigits.length >= 3) || extraBarcodes.some((value) => value.startsWith(queryDigits) && queryDigits.length >= 3))) score = 75;
        else if (queryDigits && scalePluCode.startsWith(queryDigits) && queryDigits.length >= 3) score = 70;

        if (score < 0) return null;
        return { item, score };
      })
      .filter((entry): entry is { item: InventoryItem; score: number } => Boolean(entry))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.item.name || '').localeCompare(String(b.item.name || ''), 'ar');
      })
      .map((entry) => entry.item);
  }, [
    inventoryInWarehouse,
    itemBarcodes,
    searchTerm,
    activeCategoryId,
    activeSubCategoryId,
    normalizeSearchText,
    compactSearchText,
    normalizeDigits,
    normalizeLookupCode,
  ]);

  const visibleSubCategories = useMemo(() => {
    if (!activeCategoryId) return [];
    return (subCategories || []).filter((sub) => sub.categoryId === activeCategoryId);
  }, [subCategories, activeCategoryId]);

  const updateQty = (id: string, delta: number) => {
    setCart(prev => {
      const current = prev[id];
      if (!current) return prev;
      const newQty = current.qty + delta;
      if (newQty <= 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: { ...current, qty: newQty } };
    });
  };

  const decreaseItemFromCart = (itemId: string) => {
    setCart(prev => {
      if (prev[itemId]) {
        const current = prev[itemId];
        const newQty = Number(current.qty || 0) - 1;
        if (newQty <= 0) {
          const { [itemId]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [itemId]: { ...current, qty: newQty } };
      }

      const lineKey = Object.keys(prev).reverse().find((key) => prev[key]?.itemId === itemId);
      if (!lineKey) return prev;
      const current = prev[lineKey];
      const newQty = Number(current.qty || 0) - 1;
      if (newQty <= 0) {
        const { [lineKey]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [lineKey]: { ...current, qty: newQty } };
    });
  };

  const togglePriceType = (id: string) => {
      setCart(prev => {
          const current = prev[id];
          if (!current) return prev;
          if (current.scaleMode === 'price') {
            setStatusMsg({ type: 'error', text: 'لا يمكن تبديل نوع السعر لعنصر ميزان يحمل السعر داخل الباركود.' });
            setTimeout(() => setStatusMsg(null), 4000);
            return prev;
          }
          const item = inventory.find(i => i.id === current.itemId);
          if (!item) return prev;

          const newType = current.priceType === 'retail' ? 'wholesale' : 'retail';
          const resolved = resolveBasePrice(item, newType);
          if (!resolved.ok) {
            setStatusMsg({ type: 'error', text: `${resolved.reason} لا يمكن تغيير نوع السعر.` });
            setTimeout(() => setStatusMsg(null), 4500);
            return prev;
          }
          
          return {
            ...prev,
            [id]: {
              ...current,
              priceType: newType,
              price: resolved.priceBase,
              sourceCurrency: resolved.sourceCurrency,
              sourcePrice: resolved.sourcePrice,
              sourceRate: resolved.sourceRate,
            }
          };
      });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  // ESC key closes modals
  useModalEscape(isCheckoutOpen, useCallback(() => setIsCheckoutOpen(false), []));
  useModalEscape(exchangeModalOpen, useCallback(() => setExchangeModalOpen(false), []));
  useModalEscape(isShiftModalOpen, useCallback(() => setIsShiftModalOpen(false), []));
  useModalEscape(printPromptOpen, useCallback(() => setPrintPromptOpen(false), []));
  useModalEscape(agentMenuOpen, useCallback(() => setAgentMenuOpen(false), []));

  const cartTotal = useMemo(() => {
    return (Object.values(cart) as CartLine[]).reduce((sum, item) => {
      return sum + item.price * item.qty;
    }, 0);
  }, [cart]);

  const cartQtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    Object.values(cart).forEach((line) => {
      const itemId = String((line as CartLine)?.itemId || '');
      if (!itemId) return;
      map.set(itemId, (map.get(itemId) || 0) + Number((line as CartLine).qty || 0));
    });
    return map;
  }, [cart]);

  const shiftSummary = useMemo(() => {
    const invoices = shiftInvoices || [];
    const total = invoices.reduce((sum, inv) => sum + invoiceAmountBase(inv, 'total'), 0);
    const collected = invoices.reduce((sum, inv) => sum + invoiceAmountBase(inv, 'paid'), 0);
    const remaining = invoices.reduce((sum, inv) => sum + invoiceAmountBase(inv, 'remaining'), 0);
    const count = invoices.length;
    const itemsMap = new Map<string, { name: string; qty: number; total: number }>();
    invoices.forEach((inv: any) => {
      const rawItems = inv?.items;
      const parsedItems: any[] = Array.isArray(rawItems) ? rawItems : (() => { try { const p = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems; return Array.isArray(p) ? p : []; } catch { return []; } })();
      parsedItems.forEach((it: any) => {
        const name = it?.itemName || it?.name || 'صنف';
        const qty = Number(it?.quantity || 0);
        const lineTotal = lineTotalBase(it, inv);
        const current = itemsMap.get(name) || { name, qty: 0, total: 0 };
        itemsMap.set(name, {
          name,
          qty: current.qty + qty,
          total: current.total + lineTotal
        });
      });
    });
    const items = Array.from(itemsMap.values()).sort((a, b) => b.total - a.total);
    const remainingStockQty = inventory.reduce((sum, item) => sum + Math.max(itemAvailableQty(item), 0), 0);
    const remainingStockItems = inventory.filter((item) => itemAvailableQty(item) > 0).length;
    return { total, collected, remaining, count, items, remainingStockQty, remainingStockItems };
  }, [inventory, itemAvailableQty, shiftInvoices]);

  useEffect(() => {
    if (!agentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (agentMenuRef.current && target && !agentMenuRef.current.contains(target)) {
        setAgentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [agentMenuOpen]);

  const openShiftReport = useCallback(() => {
    setAgentMenuOpen(false);
    setIsShiftModalOpen(true);
    void loadShiftSummary();
  }, [loadShiftSummary]);

  const clearCartWithConfirm = useCallback(async () => {
    setAgentMenuOpen(false);
    if (await confirmDialog('تفريغ السلة؟')) setCart({});
  }, []);

  const openExchangeRateModal = useCallback(() => {
    setAgentMenuOpen(false);
    setExchangeModalOpen(true);
  }, []);

  const handleAgentLogout = useCallback(() => {
    setAgentMenuOpen(false);
    logout();
  }, []);

  const finalTotal = Math.max(0, cartTotal - parseFloat(discount || '0'));

  const { totalPay, changePay, currentRate } = useMemo(() => {
    const totalUSD = finalTotal;
    let totalPay = totalUSD;
    let paidPay = 0;
    let currentRate = 1;
    
    if (selectedCurrency !== BASE_CURRENCY) {
      currentRate = selectedCurrency === 'SYP' ? localRates.SYP : localRates.TRY;
      if (currentRate > 0) {
        totalPay = roundCurrency(totalUSD * currentRate);
        if (!paidInput) {
          paidPay = totalPay;
        } else {
          paidPay = parseFloat(paidInput || '0') || 0;
        }
      } else {
        if (!paidInput) {
          paidPay = totalPay;
        } else {
          paidPay = parseFloat(paidInput || '0') || 0;
        }
      }
    } else {
      if (!paidInput) {
        paidPay = totalPay;
      } else {
        paidPay = parseFloat(paidInput || '0') || 0;
      }
    }
    
    const changePay = paidPay - totalPay;
    
    return { totalPay, changePay, currentRate };
  }, [finalTotal, selectedCurrency, localRates, paidInput]);

  const currencyLabel = currencySymbol(selectedCurrency);
  const displayRate = selectedCurrency === BASE_CURRENCY
    ? 1
    : selectedCurrency === 'SYP'
      ? Number(localRates.SYP || 0)
      : Number(localRates.TRY || 0);
  const toSelectedCurrency = (amountBase: number) => {
    if (selectedCurrency === BASE_CURRENCY) return Number(amountBase || 0);
    if (displayRate > 0) return roundCurrency(Number(amountBase || 0) * displayRate);
    return Number(amountBase || 0);
  };
  const hasElectronBridge = typeof window !== 'undefined' && !!window.electronAPI;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('shamel-customer-display');
    customerDisplayChannelRef.current = channel;
    return () => {
      try { channel.close(); } catch {}
      customerDisplayChannelRef.current = null;
    };
  }, []);

  const customerDisplayPayload = useMemo<CustomerDisplayPayload>(() => {
    const normalizedCurrency = (['USD', 'SYP', 'TRY'].includes(String(selectedCurrency).toUpperCase())
      ? String(selectedCurrency).toUpperCase()
      : 'USD') as 'USD' | 'SYP' | 'TRY';
    const rateForDisplay = normalizedCurrency === 'USD'
      ? 1
      : normalizedCurrency === 'SYP'
        ? Number(localRates.SYP || 0)
        : Number(localRates.TRY || 0);
    const convertFromBase = (amountBase: number) => {
      const base = Number(amountBase || 0);
      if (!Number.isFinite(base)) return 0;
      if (normalizedCurrency === 'USD') return Number(base.toFixed(2));
      if (rateForDisplay > 0) return roundCurrency(base * rateForDisplay);
      return Number(base.toFixed(2));
    };

    const companyName = String(appSettings?.company?.name || 'العالمية للمحاسبة').trim();
    const symbol = currencySymbol(normalizedCurrency);
    const thankYouMessage = 'شكرًا لتسوقكم معنا';

    if (customerDisplaySuccess) {
      return {
        mode: 'success',
        companyName,
        title: 'تمت العملية بنجاح',
        currency: customerDisplaySuccess.currency,
        currencySymbol: customerDisplaySuccess.currencySymbol,
        items: [],
        cartCount: 0,
        subtotal: customerDisplaySuccess.total,
        discount: 0,
        total: customerDisplaySuccess.total,
        paid: customerDisplaySuccess.paid,
        remaining: customerDisplaySuccess.remaining,
        invoiceNumber: customerDisplaySuccess.invoiceNumber,
        successMessage: 'تمت العملية بنجاح - شكرًا لكم',
        thankYouMessage,
        updatedAt: new Date().toISOString(),
      };
    }

    const lines: CustomerDisplayLine[] = (Object.entries(cart) as [string, CartLine][])
      .map(([lineKey, cartItem]) => {
        const invItem = inventory.find(i => i.id === cartItem.itemId);
        if (!invItem) return null;
        const qty = Number(cartItem.qty || 0);
        const unitBase = Number(cartItem.price || 0);
        const lineBase = unitBase * qty;
        return {
          id: lineKey,
          name: String(invItem.name || 'صنف'),
          qty,
          unitPrice: convertFromBase(unitBase),
          lineTotal: convertFromBase(lineBase),
        };
      })
      .filter(Boolean) as CustomerDisplayLine[];

    if (lines.length === 0) {
      return {
        ...customerDisplayStandbyPayload(),
        companyName,
        currency: normalizedCurrency,
        currencySymbol: symbol,
        title: 'شاشة الزبون',
        thankYouMessage,
        updatedAt: new Date().toISOString(),
      };
    }

    const subtotal = convertFromBase(cartTotal);
    const discountBase = parseFloat(discount || '0') || 0;
    const discountAmount = convertFromBase(discountBase);
    const total = convertFromBase(finalTotal);
    const paid = paymentType === 'cash'
      ? (paidInput ? (parseFloat(paidInput || '0') || 0) : totalPay)
      : 0;
    const remaining = paymentType === 'cash'
      ? Math.max(total - paid, 0)
      : total;
    const cartCount = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);

    return {
      mode: 'live',
      companyName,
      title: 'تفاصيل الشراء الحالية',
      currency: normalizedCurrency,
      currencySymbol: symbol,
      items: lines,
      cartCount,
      subtotal,
      discount: discountAmount,
      total,
      paid,
      remaining,
      successMessage: '',
      thankYouMessage,
      updatedAt: new Date().toISOString(),
    };
  }, [
    appSettings?.company?.name,
    cart,
    cartTotal,
    customerDisplaySuccess,
    discount,
    finalTotal,
    inventory,
    localRates.SYP,
    localRates.TRY,
    paidInput,
    paymentType,
    selectedCurrency,
    totalPay,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem('shamel_customer_display_state', JSON.stringify(customerDisplayPayload));
    } catch {}
    if (customerDisplayChannelRef.current) {
      try { customerDisplayChannelRef.current.postMessage(customerDisplayPayload); } catch {}
    }
    if (hasElectronBridge && window.electronAPI?.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay(customerDisplayPayload);
    }
  }, [customerDisplayPayload, hasElectronBridge]);

  useEffect(() => {
    if (!customerDisplaySuccess) return;
    if (Object.keys(cart).length > 0) {
      setCustomerDisplaySuccess(null);
    }
  }, [cart, customerDisplaySuccess]);

  const saveExchangeRates = async () => {
    const nextSyp = Number(exchangeDraft.SYP);
    const nextTry = Number(exchangeDraft.TRY);
    if (!Number.isFinite(nextSyp) || nextSyp <= 0 || !Number.isFinite(nextTry) || nextTry <= 0) {
      setStatusMsg({ type: 'error', text: '\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0623\u0633\u0639\u0627\u0631 \u0635\u0631\u0641 \u0635\u062d\u064a\u062d\u0629.' });
      setTimeout(() => setStatusMsg(null), 4000);
      return;
    }

    const baseSettings = appSettings || buildDefaultSettings();
    const nextRates = { ...DEFAULT_CURRENCY_RATES, ...(baseSettings.currencyRates || {}), SYP: nextSyp, TRY: nextTry };
    const nextSettings: AppSettings = { ...baseSettings, currencyRates: nextRates };

    setIsSavingRates(true);
    try {
      await apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'currencyRates', value: nextRates }) });
      localStorage.setItem('shamel_settings', JSON.stringify(nextSettings));
      setAppSettings(nextSettings);
      setExchangeModalOpen(false);
      setStatusMsg({ type: 'success', text: '\u062a\u0645 \u062d\u0641\u0638 \u0633\u0639\u0631 \u0627\u0644\u0635\u0631\u0641.' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch {
      setStatusMsg({ type: 'error', text: '\u0641\u0634\u0644 \u062d\u0641\u0638 \u0633\u0639\u0631 \u0627\u0644\u0635\u0631\u0641.' });
      setTimeout(() => setStatusMsg(null), 4000);
    } finally {
      setIsSavingRates(false);
    }
  };

  const handleFinalCheckout = async () => {
    if (Object.keys(cart).length === 0) return;
    const requiredSerialLine = (Object.values(cart) as CartLine[]).find((line) => {
      const item = inventory.find((inv) => String(inv.id) === String(line.itemId));
      return String((item as any)?.serialTracking || 'none') === 'required';
    });
    if (requiredSerialLine) {
      const item = inventory.find((inv) => String(inv.id) === String(requiredSerialLine.itemId));
      alert(`الصنف ${item?.name || requiredSerialLine.itemId} يتطلب سيريال، وهذا غير مدعوم في نقطة البيع السريعة حالياً. استخدم شاشة الفواتير العادية.`);
      return;
    }
    const resolvedWarehouseId = (() => {
      if (isAgentRestrictedMode) return '';
      if (fixedWarehouseId && warehouses.some((warehouse) => String(warehouse.id) === String(fixedWarehouseId))) {
        return fixedWarehouseId;
      }
      if (selectedWarehouseId && warehouses.some((warehouse) => String(warehouse.id) === String(selectedWarehouseId))) {
        return selectedWarehouseId;
      }
      return warehouses[0]?.id || '';
    })();
    const resolvedCashBox = paymentType === 'cash'
      ? (cashBoxes.find((cashBox) => String(cashBox.id) === String(selectedCashBoxId)) || cashBoxes[0] || null)
      : null;
    const resolvedClient = paymentType === 'credit'
      ? (clients.find((client) => String(client.id) === String(selectedClientId)) || (cashCustomerId ? clients.find((client) => String(client.id) === String(cashCustomerId)) : null) || clients[0] || null)
      : ((cashCustomerId ? clients.find((client) => String(client.id) === String(cashCustomerId)) : null) || clients.find((client) => String(client.id) === String(selectedClientId)) || null);

    if (paymentType === 'cash' && !resolvedCashBox) { alert('الرجاء اختيار صندوق صالح'); return; }
    if (paymentType === 'credit' && !resolvedClient) { alert('الرجاء اختيار عميل للبيع الآجل'); return; }
    
    if (paymentType === 'cash') {
      if (selectedCurrency !== BASE_CURRENCY && currentRate <= 0) {
        alert('سعر الصرف غير مضبوط'); return;
      }
      if (changePay < 0) {
        alert('المبلغ المدفوع أقل من قيمة الفاتورة.');
        return;
      }
    }

    setIsSubmitting(true);
    let invoiceNo: string;
    try {
      const res = await apiRequest('next-number/pos');
      invoiceNo = res.number;
    } catch {
      invoiceNo = String(Date.now()).slice(-6);
    }
    const cartItemsPayload = (Object.entries(cart) as [string, CartLine][]).map(([lineKey, cartItem]) => {
      const invItem = inventory.find(i => i.id === cartItem.itemId);
      const unitPriceBase = Number(cartItem.price || 0);
      const unitPriceTransaction = selectedCurrency === BASE_CURRENCY
        ? unitPriceBase
        : roundCurrency(unitPriceBase * currentRate);
      const lineTotalBase = Number(unitPriceBase * Number(cartItem.qty || 0));
      const lineTotalTransaction = selectedCurrency === BASE_CURRENCY
        ? lineTotalBase
        : roundCurrency(lineTotalBase * currentRate);
      return {
        itemId: cartItem.itemId,
        cartLineKey: lineKey,
        itemName: invItem?.name,
        quantity: Number(cartItem.qty || 0),
        baseQuantity: Number(cartItem.qty || 0),
        unitPrice: unitPriceTransaction,
        unitPriceTransaction,
        unitPriceBase,
        total: lineTotalTransaction,
        lineTotalTransaction,
        lineTotalBase,
        unitName: invItem?.unitName || 'وحدة',
        isScaleItem: Boolean(cartItem.isScaleItem),
        scaleMode: cartItem.scaleMode || null,
        scaleUnit: cartItem.scaleUnit || null,
        scaleWeightKg: Number(cartItem.scaleWeightKg || 0) || null,
        scaleBarcode: cartItem.scaleBarcode || null,
        currency: selectedCurrency,
        exchangeRate: selectedCurrency === BASE_CURRENCY ? 1 : currentRate,
        // Carry each item's own warehouseId so stock is deducted from the correct warehouse
        warehouseId: invItem?.warehouseId || resolvedWarehouseId || null,
      };
    });

    try {
      const exchangeRate = selectedCurrency !== BASE_CURRENCY ? currentRate : 1;
      const createdAtIso = new Date().toISOString();
      const invoiceId = `inv-${Date.now()}`;
      const totalAmountBase = Number(finalTotal || 0);
      const totalAmountTransaction = selectedCurrency === BASE_CURRENCY
        ? totalAmountBase
        : roundCurrency(totalAmountBase * exchangeRate);
      const discountBase = parseFloat(discount || '0') || 0;
      const discountTransaction = selectedCurrency === BASE_CURRENCY
        ? discountBase
        : roundCurrency(discountBase * exchangeRate);
      const paidAmountBase = paymentType === 'cash' ? totalAmountBase : 0;
      const paidAmountTransaction = paymentType === 'cash' ? totalAmountTransaction : 0;
      const paidAmountOriginal = paidAmountTransaction;
      const remainingAmountBase = paymentType === 'credit' ? totalAmountBase : 0;
      const remainingAmountTransaction = selectedCurrency === BASE_CURRENCY
        ? remainingAmountBase
        : roundCurrency(remainingAmountBase * exchangeRate);

      const curLabel = currencySymbol(selectedCurrency);
      const receiptItems = cartItemsPayload.map((i: any) => ({
        name: i.itemName || 'صنف',
        qty: Number(i.quantity || 0),
        price: Number(i.unitPriceTransaction || 0)
      }));
      const receiptDiscount = discountTransaction;
      const receiptSubtotal = cartItemsPayload.reduce((s: number, it: any) => s + Number(it.lineTotalTransaction || 0), 0);
      const receiptTotal = Math.max(0, receiptSubtotal - receiptDiscount);

      const invoicePayload = {
        id: invoiceId,
        invoiceNumber: invoiceNo,
        type: 'sale',
        currency: selectedCurrency,
        exchangeRate: exchangeRate,
        paymentType,
        cashBoxId: resolvedCashBox?.id || null,
        cashBoxName: resolvedCashBox?.name || null,
        clientId: resolvedClient?.id || null,
        clientName: resolvedClient?.name || 'عميل نقدي',
        date: new Date().toISOString().split('T')[0],
        createdAt: createdAtIso,
        items: cartItemsPayload,
        totalAmount: totalAmountBase,
        totalAmountBase,
        totalAmountTransaction,
        discount: discountBase,
        discountBase,
        discountTransaction,
        originalAmount: totalAmountTransaction,
        paidAmount: paidAmountBase,
        paidAmountBase,
        paidAmountTransaction,
        paidAmountOriginal: paidAmountOriginal,
        remainingAmount: remainingAmountBase,
        remainingAmountBase,
        remainingAmountTransaction,
        notes: notes,
        targetWarehouseId: isAgentRestrictedMode ? null : (resolvedWarehouseId || null),
        posSale: true,
        createdByName: currentUser?.name || currentUser?.username || undefined,
      };
      let createdInvoice: any = null;
      let queuedInvoice = false;
      try {
        createdInvoice = await apiRequest('invoices', { method: 'POST', body: JSON.stringify(invoicePayload) });
      } catch (e: any) {
        if (e instanceof NetworkError || e?.name === 'NetworkError') {
          const invoiceResult = await performOfflineAction('invoices', 'POST' as any, invoicePayload);
          queuedInvoice = !!invoiceResult?.queued;
        } else {
          throw e;
        }
      }

      const queueFromServer = createdInvoice?.queueNumber != null ? String(createdInvoice.queueNumber) : undefined;
      const receiptData = {
        storeName: (appSettings?.company?.name || '').trim() || 'ERP',
        storePhone: (appSettings?.company?.phone1 || '').trim() || undefined,
        invoiceNo,
        dateText: new Date().toLocaleString('ar-EG'),
        customerName: resolvedClient?.name || 'عميل نقدي',
        items: receiptItems,
        discount: receiptDiscount || undefined,
        paid: paymentType === 'cash' ? receiptTotal : 0,
        currencyLabel: curLabel,
        ...(queueFromServer && (appSettings?.print?.restaurant?.showQueueOnCustomer !== false)
          ? { queueNumber: queueFromServer }
          : {}),
        ...(appSettings?.print?.restaurant?.showCashierOnReceipt !== false && (currentUser?.name || currentUser?.username)
          ? { cashierName: String(currentUser?.name || currentUser?.username) }
          : {}),
      };

      if (queuedInvoice) {
        const localInv = { ...invoicePayload, _localQueued: true };
        const next = [...(localShiftInvoices || [])].filter((x: any) => String(x.id) !== String(localInv.id));
        next.push(localInv);
        persistLocalShiftInvoices(next);
        setTodaySales((prev) => prev + Number(finalTotal || 0));
      }

      // Voucher creation is now handled automatically in the backend (invoices.routes.ts)
      // for all cash invoices when they are posted. No need to create voucher here.

      // طباعة تلقائية صامتة بعد البيع — لا تُعطل البيع ولا تنتظر الطباعة
      const thermal = appSettings?.print?.thermal;
      const paperSize = (thermal?.paperSize as PaperSize) || '80mm';
      const narrowFormat: '58mm' | '80mm' = paperSize === '58mm' ? '58mm' : '80mm';
      const companyId = getCurrentOrgId() || undefined;
      const branchId = getCurrentBranchId() || undefined;
      const rest = appSettings?.print?.restaurant;
      const kitchenFmt: '58mm' | '80mm' = rest?.kitchenPaperSize === '58mm' ? '58mm' : '80mm';
      const kitchenTicket =
        rest?.kitchenEnabled &&
        queueFromServer &&
        (rest.showQueueOnKitchen !== false)
          ? {
              storeName: receiptData.storeName,
              queueNumber: queueFromServer,
              invoiceNo,
              dateText: receiptData.dateText,
              orderType: notes || undefined,
              items: receiptItems.map((i) => ({ name: i.name, qty: i.qty })),
            }
          : null;

      setLastReceipt(receiptData);
      setPrintFailHint(null);
      setLastPosInvoiceForReprint({
        receiptData,
        kitchenTicket,
        companyId,
        branchId,
        format: narrowFormat,
        kitchenFormat: kitchenFmt,
        printSettings: appSettings?.print,
        invoiceId: invoiceId,
        invoiceNumber: invoiceNo,
      });

      queueMicrotask(() => {
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        void onPosSaleCompletedPrint({
          receiptData,
          kitchenTicket,
          companyId,
          branchId,
          format: narrowFormat,
          kitchenFormat: kitchenFmt,
          printSettings: appSettings?.print,
          invoiceId,
          invoiceNumber: invoiceNo,
        })
          .then((r) => {
            const elapsed = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
            if (elapsed > 500) console.debug('[POS] print pipeline started after', Math.round(elapsed), 'ms');
            if (r.success) {
              setLastPrintAttempted(true);
            } else {
              setLastPrintAttempted(false);
              console.warn('[POS] auto-print failed', r.error);
              setPrintFailHint('⚠️ فشل الطباعة — يمكنك إعادة الطباعة');
            }
          })
          .catch((e) => {
            console.warn('[POS] auto-print error', e);
            setLastPrintAttempted(false);
            setPrintFailHint('⚠️ فشل الطباعة — يمكنك إعادة الطباعة');
          });
      });

      const normalizedCurrency = (['USD', 'SYP', 'TRY'].includes(String(selectedCurrency).toUpperCase())
        ? String(selectedCurrency).toUpperCase()
        : 'USD') as 'USD' | 'SYP' | 'TRY';
      const paidForDisplay = paymentType === 'cash'
        ? (paidInput ? (parseFloat(paidInput || '0') || 0) : totalPay)
        : 0;
      const remainingForDisplay = paymentType === 'cash'
        ? Math.max(totalPay - paidForDisplay, 0)
        : totalPay;
      setCustomerDisplaySuccess({
        invoiceNumber: invoiceNo,
        total: totalPay,
        paid: paidForDisplay,
        remaining: remainingForDisplay,
        currency: normalizedCurrency,
        currencySymbol: currencySymbol(normalizedCurrency),
      });
      window.setTimeout(() => {
        setCustomerDisplaySuccess((current) => (
          current?.invoiceNumber === invoiceNo ? null : current
        ));
      }, 4500);

      setStatusMsg({ type: 'success', text: queuedInvoice ? `تم حفظ الفاتورة محلياً (${invoiceNo}) وسيتم المزامنة عند عودة الاتصال` : `تم حفظ الفاتورة برقم ${invoiceNo}` });
      setCart({});
      setIsCheckoutOpen(false);
      setDiscount('0');
      setNotes('');
      setPaidInput('');
      if (!queuedInvoice) {
        await refreshData();
        await loadTodaySales();
      }
      
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (e: any) {
      if (e instanceof NetworkError || e?.name === 'NetworkError') {
        setStatusMsg({ type: 'error', text: 'انقطع الاتصال. أعد المحاولة وسيتم المزامنة عند عودة الشبكة.' });
      } else {
        setStatusMsg({ type: 'error', text: e.message || 'فشلت العملية' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBarcodeSearch = async () => {
    const code = await scanBarcodeOnce();
    if (!code) return;
    handleSearchInputChange(code);
    const added = tryAddProductByCode(code);
    if (added) {
      setSearchTerm('');
      searchTermRef.current = '';
    }
  };

  const handlePrintLastInvoice = async () => {
    if (!lastReceipt) return;
    setPrintFailHint(null);
    const r = await reprintLastInvoice();
    if (r.success) {
      setStatusMsg({ type: 'success', text: 'تمت إعادة طباعة إيصال الزبون' });
      setTimeout(() => setStatusMsg(null), 3000);
    } else {
      setPrintFailHint('⚠️ فشل الطباعة — يمكنك إعادة الطباعة');
      setStatusMsg({ type: 'error', text: r.error || 'فشلت إعادة الطباعة' });
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const handleReprintKitchenLast = async () => {
    if (!lastReceipt) return;
    setPrintFailHint(null);
    const r = await reprintLastKitchenTicket();
    if (r.success) {
      setStatusMsg({ type: 'success', text: 'تمت إعادة طباعة تذكرة المطبخ' });
      setTimeout(() => setStatusMsg(null), 3000);
    } else {
      setPrintFailHint('⚠️ فشل طباعة المطبخ — يمكنك إعادة المحاولة');
      setStatusMsg({ type: 'error', text: r.error || 'فشلت طباعة المطبخ' });
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const handleReprintBothLast = async () => {
    if (!lastReceipt) return;
    setPrintFailHint(null);
    const { customer, kitchen } = await reprintLastBoth();
    if (customer.success && kitchen.success) {
      setStatusMsg({ type: 'success', text: 'تمت إعادة طباعة الزبون والمطبخ' });
      setTimeout(() => setStatusMsg(null), 3500);
      return;
    }
    if (customer.success && !kitchen.success) {
      setPrintFailHint('⚠️ نجحت طباعة الزبون وفشلت المطبخ — أعد طباعة المطبخ');
      setStatusMsg({ type: 'error', text: kitchen.error || 'فشلت طباعة المطبخ' });
      setTimeout(() => setStatusMsg(null), 5000);
      return;
    }
    setPrintFailHint('⚠️ فشلت إعادة الطباعة — يمكنك المحاولة مجدداً');
    setStatusMsg({ type: 'error', text: customer.error || 'فشلت الطباعة' });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const exportShiftPdf = async () => {
    const todayStr = new Date().toLocaleDateString('ar-EG');
    const reportTitle = isAgentRestrictedMode
      ? '\u062a\u0642\u0631\u064a\u0631 \u0627\u0644\u0645\u0646\u062f\u0648\u0628'
      : '\u0645\u0644\u062e\u0635 \u0627\u0644\u0648\u0631\u062f\u064a\u0629';
    const fileName = `${isAgentRestrictedMode ? 'agent-report' : 'shift-summary'}-${new Date().toISOString().slice(0, 10)}.pdf`;
    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; background: #ffffff; color: #111827; padding: 24px;">
        <div style="margin-bottom: 18px; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">
          <h1 style="margin: 0 0 8px; font-size: 22px;">${reportTitle}</h1>
          <div style="color: #4b5563; font-size: 12px; line-height: 1.8;">
            <div>\u0627\u0644\u062a\u0627\u0631\u064a\u062e: ${todayStr}</div>
            <div>\u0639\u062f\u062f \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631: ${shiftSummary.count}</div>
            <div>\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a: ${formatPosMoney(shiftSummary.total)} ${BASE_CURRENCY}</div>
            <div>\u0627\u0644\u0645\u0628\u0627\u0644\u063a \u0627\u0644\u0645\u0642\u0628\u0648\u0636\u0629: ${formatPosMoney(shiftSummary.collected)} ${BASE_CURRENCY}</div>
            <div>\u0627\u0644\u0645\u0628\u0627\u0644\u063a \u0627\u0644\u0645\u062a\u0628\u0642\u064a\u0629: ${formatPosMoney(shiftSummary.remaining)} ${BASE_CURRENCY}</div>
            ${isAgentRestrictedMode ? `<div>\u0627\u0644\u0645\u0648\u0627\u062f \u0627\u0644\u0645\u062a\u0628\u0642\u064a\u0629: ${shiftSummary.remainingStockItems}</div><div>\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u062a\u0628\u0642\u064a\u0629: ${formatPosQty(shiftSummary.remainingStockQty)}</div>` : ''}
          </div>
        </div>
        <h2 style="font-size: 15px; margin: 0 0 10px;">\u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px;">
          <thead>
            <tr>
              <th style="border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px; text-align: right;">\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629</th>
              <th style="border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px; text-align: right;">\u0627\u0644\u0639\u0645\u064a\u0644</th>
              <th style="border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px; text-align: right;">\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</th>
            </tr>
          </thead>
          <tbody>
            ${shiftInvoices.map((inv: any) => `
              <tr>
                <td style="border: 1px solid #d1d5db; padding: 8px;">${inv?.invoiceNumber || inv?.id || ''}</td>
                <td style="border: 1px solid #d1d5db; padding: 8px;">${inv?.clientName || '\u0639\u0645\u064a\u0644 \u0646\u0642\u062f\u064a'}</td>
                <td style="border: 1px solid #d1d5db; padding: 8px;">${formatPosMoney(invoiceAmountBase(inv, 'total'))} ${BASE_CURRENCY}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <h2 style="font-size: 15px; margin: 0 0 10px;">\u0627\u0644\u0645\u0648\u0627\u062f \u0627\u0644\u0645\u0628\u0627\u0639\u0629</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px; text-align: right;">\u0627\u0644\u0635\u0646\u0641</th>
              <th style="border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px; text-align: right;">\u0627\u0644\u0643\u0645\u064a\u0629</th>
              <th style="border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px; text-align: right;">\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</th>
            </tr>
          </thead>
          <tbody>
            ${shiftSummary.items.map((it) => `
              <tr>
                <td style="border: 1px solid #d1d5db; padding: 8px;">${it.name}</td>
                <td style="border: 1px solid #d1d5db; padding: 8px;">${formatPosQty(it.qty)}</td>
                <td style="border: 1px solid #d1d5db; padding: 8px;">${formatPosMoney(it.total)} ${BASE_CURRENCY}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = '794px';
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = (html2pdfModule as any).default || html2pdfModule;
      const pdfBlob = await html2pdf()
        .from(container.firstElementChild as HTMLElement)
        .set({
          margin: [10, 10, 10, 10],
          filename: fileName,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .output('blob');

      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };

      if (layout.isMobile && nav.share && nav.canShare?.({ files: [pdfFile] })) {
        await nav.share({
          title: reportTitle,
          text: reportTitle,
          files: [pdfFile],
        });
      } else {
        triggerDownload(pdfBlob, fileName);
      }
      setStatusMsg({
        type: 'success',
        text: layout.isMobile
          ? '\u062a\u0645 \u062a\u062c\u0647\u064a\u0632 PDF \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0623\u0648 \u0627\u0644\u062d\u0641\u0638'
          : '\u062a\u0645 \u062a\u0635\u062f\u064a\u0631 PDF \u0628\u0646\u062c\u0627\u062d'
      });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (error) {
      console.error('Shift PDF export error', error);
      setStatusMsg({ type: 'error', text: '\u062a\u0639\u0630\u0631 \u062a\u0635\u062f\u064a\u0631 PDF \u0644\u0644\u062a\u0642\u0631\u064a\u0631' });
      setTimeout(() => setStatusMsg(null), 4000);
    } finally {
      document.body.removeChild(container);
    }
  };

  const exportShiftSummaryJson = () => {
    const payload = {
      date: new Date().toISOString(),
      total: shiftSummary.total,
      collected: shiftSummary.collected,
      remaining: shiftSummary.remaining,
      invoiceCount: shiftSummary.count,
      remainingStockQty: shiftSummary.remainingStockQty,
      remainingStockItems: shiftSummary.remainingStockItems,
      invoices: shiftInvoices,
      items: shiftSummary.items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `shift-summary-${new Date().toISOString().split('T')[0]}.json`);
  };

  const handleEndShift = async () => {
    const stamp = new Date().toISOString();
    try { localStorage.setItem('pos_shift_reset_at', stamp); } catch {}
    setAgentMenuOpen(false);
    setShiftResetAt(stamp);
    setTodaySales(0);
    setIsShiftModalOpen(false);
    setShiftInvoices([]);
    setStatusMsg({ type: 'success', text: 'تم إنهاء الوردية وتصفير مبيعات اليوم' });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const openCustomerDisplayFallback = () => {
    const popup = customerDisplayPopupRef.current;
    if (popup && !popup.closed) {
      popup.focus();
      return true;
    }
    const url = `${window.location.origin}${window.location.pathname}#/customer-display`;
    const opened = window.open(url, 'shamel-customer-display', 'popup=yes,width=1280,height=780');
    if (!opened) return false;
    customerDisplayPopupRef.current = opened;
    try {
      localStorage.setItem('shamel_customer_display_state', JSON.stringify(customerDisplayPayload));
    } catch {}
    if (customerDisplayChannelRef.current) {
      try { customerDisplayChannelRef.current.postMessage(customerDisplayPayload); } catch {}
    }
    opened.focus();
    return true;
  };

  const openCustomerDisplayWindow = async () => {
    setIsOpeningCustomerDisplay(true);
    try {
      if (window.electronAPI?.openCustomerDisplay) {
        const res = await window.electronAPI.openCustomerDisplay();
        window.electronAPI.updateCustomerDisplay(customerDisplayPayload);
        setStatusMsg({
          type: 'success',
          text: res?.alreadyOpen ? 'تم إظهار شاشة الزبون.' : 'تم فتح شاشة الزبون.',
        });
        setTimeout(() => setStatusMsg(null), 2500);
        return;
      }
      const ok = openCustomerDisplayFallback();
      if (ok) {
        setStatusMsg({ type: 'success', text: 'تم فتح شاشة الزبون.' });
      } else {
        setStatusMsg({ type: 'error', text: 'تعذر فتح شاشة الزبون. تأكد من السماح بالنوافذ المنبثقة.' });
      }
      setTimeout(() => setStatusMsg(null), 3000);
    } catch {
      const ok = openCustomerDisplayFallback();
      if (ok) {
        setStatusMsg({ type: 'success', text: 'تم فتح شاشة الزبون.' });
        setTimeout(() => setStatusMsg(null), 2500);
      } else {
        setStatusMsg({ type: 'error', text: 'فشل فتح شاشة الزبون.' });
        setTimeout(() => setStatusMsg(null), 4000);
      }
    } finally {
      setIsOpeningCustomerDisplay(false);
    }
  };

  const closeCustomerDisplayWindow = async () => {
    const popup = customerDisplayPopupRef.current;
    if (popup && !popup.closed) {
      try { popup.close(); } catch {}
      customerDisplayPopupRef.current = null;
    }
    if (!window.electronAPI?.closeCustomerDisplay) return;
    try {
      await window.electronAPI.closeCustomerDisplay();
      setStatusMsg({ type: 'success', text: 'تم إغلاق شاشة الزبون.' });
      setTimeout(() => setStatusMsg(null), 2500);
    } catch {
      setStatusMsg({ type: 'error', text: 'تعذر إغلاق شاشة الزبون.' });
      setTimeout(() => setStatusMsg(null), 3500);
    }
  };

  const showDesktopCategoryRail = layout.isDesktop;
  const isAgentMobileLayout = isAgentRestrictedMode && layout.isMobile;
  const productGridClass = isAgentMobileLayout
    ? 'grid grid-cols-2 gap-2'
    : layout.isMobile
      ? 'grid grid-cols-2 gap-3'
    : layout.isTablet
      ? 'grid grid-cols-3 gap-4 lg:grid-cols-4'
      : 'grid grid-cols-2 gap-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8';
  const checkoutPreviewMaxHeightClass = layout.isMobile ? 'max-h-[28vh]' : 'max-h-48';
  const productsViewportClass = isAgentMobileLayout ? 'p-2 pb-36' : layout.isMobile ? 'p-3 pb-32' : layout.isTablet ? 'p-4 pb-28' : 'p-6';
  const categoryBarClass = isAgentMobileLayout ? 'px-2 py-2' : layout.isMobile ? 'px-3 py-2' : 'px-4 py-3';
  const productCardClass = isAgentMobileLayout
    ? 'bg-white border border-slate-200 rounded-2xl flex flex-col items-stretch text-right transition relative group overflow-hidden shadow-sm active:scale-[0.99]'
    : 'bg-white border-2 rounded-2xl flex flex-col items-stretch text-right transition relative group overflow-hidden';
  const productImageClass = isAgentMobileLayout
    ? 'relative w-full aspect-square bg-white overflow-hidden border-b shrink-0 flex items-center justify-center p-2 group'
    : 'relative w-full aspect-[4/3] bg-white overflow-hidden border-b shrink-0 flex items-center justify-center p-2 group';
  const floatingCartClass = isAgentMobileLayout
    ? 'w-[calc(100vw-1rem)] justify-between px-4 py-3.5 rounded-[1.4rem]'
    : layout.isMobile
      ? 'w-[calc(100vw-1.5rem)] justify-between px-4 py-4 rounded-2xl'
      : 'px-6 py-4 rounded-full';

  const searchInputClass = `w-full pr-10 pl-10 border-none rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold bg-white/10 text-white placeholder:text-gray-500 ${
    isAndroidLike ? 'min-h-[48px] py-3 text-base' : 'py-2.5'
  }`;
  const actionChipClass = `rounded-full font-bold transition text-sm tap-feedback ${isAndroidLike ? 'px-4 py-2.5' : 'px-4 py-2'}`;
  const compactAgentChipClass = 'rounded-full border px-3 py-2 text-[11px] font-bold transition tap-feedback';
  const stepButtonSize = isAndroidLike ? 'w-9 h-9' : 'w-7 h-7';
  const showMobileCategoryBar = !isAgentMobileLayout || categories.length > 1;
  const showMobileSubCategoryBar = !isAgentMobileLayout || visibleSubCategories.length > 0;

  return (
    <div className={`fixed inset-0 z-[150] flex flex-col bg-gray-100 animate-fadeIn select-none overflow-hidden ${layout.isMobile ? 'android-shell-safe' : ''}`}>
      
      {/* Top Header */}
      {isAgentMobileLayout && (
        <div className="shrink-0 border-b border-slate-200 bg-white shadow-sm android-safe-top">
          <div className="flex items-center justify-between px-2 py-1.5">
            <button onClick={() => setActiveTab('dashboard')} className="min-h-[40px] min-w-[40px] rounded-full p-2 text-slate-700 transition hover:bg-slate-100 tap-feedback">
              <ArrowRight size={20} />
            </button>
            <div className="text-center">
              <div className="text-[11px] font-black text-slate-700">نقطة بيع المندوب</div>
              <div className="text-[10px] font-bold text-slate-400">{Object.keys(cart).length} أصناف في السلة</div>
            </div>
            <button onClick={async () => { if (await confirmDialog("تفريغ السلة")) setCart({}); }} className="min-h-[40px] min-w-[40px] rounded-full p-2 text-red-500 transition hover:bg-red-50 tap-feedback" title="مسح السلة">
              <Trash2 size={20}/>
            </button>
          </div>
          <div className="px-2 pb-2">
            <div className="relative">
              <Search className="absolute right-3 top-3 text-gray-400" size={18} />
              <input
                ref={searchInputRef}
                autoFocus
                type="text"
                placeholder="ابحث عن مادة أو امسح الباركود..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-16 text-sm font-bold text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={searchTerm}
                onChange={e => handleSearchInputChange(e.target.value)}
              />
              {searchTerm && (
                <button onClick={() => handleSearchInputChange('')} className="absolute left-3 top-2.5 text-gray-400 hover:text-red-500 tap-feedback">
                  <X size={18}/>
                </button>
              )}
              {isAndroid && (
                <button
                  onClick={handleBarcodeSearch}
                  className="absolute left-9 top-2.5 text-teal-700 transition tap-feedback"
                  title="مسح باركود"
                >
                  <ScanBarcode size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {isAgentMobileLayout && (
        <div className="pointer-events-none absolute left-2 top-2 z-[260] android-safe-top">
          <div className="pointer-events-auto relative" ref={agentMenuRef}>
            <button
              onClick={() => setAgentMenuOpen((prev) => !prev)}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-slate-200 bg-white/95 p-2 text-slate-700 shadow-lg backdrop-blur transition hover:bg-slate-50 tap-feedback"
              title="قائمة المندوب"
              aria-expanded={agentMenuOpen}
              aria-haspopup="menu"
            >
              <MoreVertical size={19} />
            </button>
            {agentMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+0.45rem)] z-[260] w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <button onClick={openShiftReport} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                  <span>تقرير المندوب</span>
                  <FileText size={17} className="text-teal-700" />
                </button>
                <button onClick={handleEndShift} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                  <span>إنهاء الوردية</span>
                  <DollarSign size={17} className="text-amber-600" />
                </button>
                <button onClick={openExchangeRateModal} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                  <span>تغيير سعر الصرف</span>
                  <Globe size={17} className="text-cyan-700" />
                </button>
                <button onClick={clearCartWithConfirm} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                  <span>تفريغ السلة</span>
                  <Trash2 size={17} className="text-red-500" />
                </button>
                <button onClick={handleAgentLogout} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm font-bold text-red-600 transition hover:bg-red-50">
                  <span>تسجيل خروج</span>
                  <LogOut size={17} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {!isAgentMobileLayout && (
      <div className={`bg-gray-900 text-white shadow-xl shrink-0 flex ${isAgentMobileLayout ? 'flex-wrap items-center gap-2 px-2.5 py-2 android-safe-top' : layout.isMobile ? 'flex-wrap items-center gap-2 px-3 py-2 android-safe-top' : 'items-center gap-4 px-4 h-16'}`}>
        <button onClick={() => setActiveTab('dashboard')} className="min-h-[44px] min-w-[44px] p-2 hover:bg-white/10 rounded-full transition text-white tap-feedback">
          <ArrowRight size={24} />
        </button>
        
        <div className={`relative ${layout.isMobile ? 'order-3 basis-full max-w-none' : 'flex-1 max-w-xl'}`}>
           <Search className="absolute right-3 top-2.5 text-gray-400" size={20} />
            <input 
               ref={searchInputRef}
               autoFocus
               type="text" 
               placeholder="ابحث بالاسم، الموديل، الكود أو امسح الباركود..." 
               className={searchInputClass}
               value={searchTerm}
               onChange={e => handleSearchInputChange(e.target.value)}
            />
            {searchTerm && (
             <button onClick={() => handleSearchInputChange('')} className={`absolute left-3 ${isAndroidLike ? 'top-3' : 'top-2.5'} text-gray-400 hover:text-red-500 tap-feedback`}>
                 <X size={20}/>
              </button>
            )}
           {isAndroid && (
             <button
               onClick={handleBarcodeSearch}
               className={`absolute left-10 ${isAndroidLike ? 'top-3' : 'top-2.5'} text-gray-200 hover:text-white transition tap-feedback`}
               title="مسح باركود"
             >
               <ScanBarcode size={20} />
             </button>
           )}
         </div>

        <div className={`mr-auto flex items-center gap-2 ${isAgentMobileLayout ? 'order-2 w-full justify-end' : layout.isMobile ? 'order-2 w-full justify-between' : ''}`}>
           {!isAgentRestrictedMode && (
           <div className={`${layout.isDesktop ? 'flex' : layout.isMobile ? 'flex min-w-0 flex-1 items-center justify-end' : 'hidden'} flex-col items-end`}>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">المستودع النشط</span>
              <select 
                value={selectedWarehouseId} 
                onChange={e => { if (!fixedWarehouseId) { setSelectedWarehouseId(e.target.value); setCart({}); } }}
                disabled={!!fixedWarehouseId}
                className={`max-w-[11rem] border-none bg-transparent p-0 font-black text-primary outline-none ${fixedWarehouseId ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <option value="">الكل (جميع المستودعات)</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
           </div>
          )}
                      <div className={`${isAgentMobileLayout ? 'hidden' : layout.isMobile ? 'flex' : 'hidden md:flex'} flex-col items-end ml-2`}>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">مبيعات اليوم</span>
              <button
                onClick={() => { setIsShiftModalOpen(true); loadShiftSummary(); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/10 text-white hover:bg-white/20 transition"
                title="عرض ملخص الوردية"
              >
                <DollarSign size={16} />
                <span className="font-numeric font-black text-xs">{formatPosMoney(todaySales)} {BASE_CURRENCY}</span>
               </button>
            </div>
            {!layout.isMobile && !isAgentRestrictedMode && <div className="h-8 w-px bg-white/10 mx-2"></div>}
            <button onClick={async () => { if (await confirmDialog('تفريغ السلة؟')) setCart({}); }} className="text-red-400 p-2 hover:bg-red-500/10 rounded-lg transition tap-feedback min-h-[44px] min-w-[44px]" title="مسح السلة">
               <Trash2 size={24}/>
            </button>
         </div>
      </div>
      )}

      {!isAgentMobileLayout && (
      <div className={`${layout.isDesktop ? 'fixed top-20 left-6 z-[180]' : 'z-[160] border-b bg-white/85 px-3 py-2 backdrop-blur'} flex items-center gap-2 ${layout.isMobile ? 'overflow-x-auto whitespace-nowrap' : ''}`}>
        <button
          onClick={() => setExchangeModalOpen(true)}
          className="bg-white/95 backdrop-blur border border-teal-200 text-teal-800 rounded-xl px-3 py-2 shadow-lg hover:shadow-xl transition flex items-center gap-2 tap-feedback min-h-[44px] shrink-0"
          title={'تعديل سعر الصرف'}
        >
          <Globe size={16} />
          <div className="text-right leading-tight">
            <div className="text-[10px] font-black">أسعار الصرف</div>
            <div className="text-[9px] font-bold text-teal-600">
              SYP: {formatPosRate(localRates.SYP)} | TRY: {formatPosRate(localRates.TRY)}
            </div>
          </div>
        </button>
        <button
          onClick={openCustomerDisplayWindow}
          disabled={isOpeningCustomerDisplay}
          className="h-[44px] px-3 rounded-xl bg-cyan-600 text-white border border-cyan-400/50 shadow-lg hover:bg-cyan-700 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed tap-feedback shrink-0"
          title="تشغيل شاشة الزبون"
        >
          <Eye size={15} />
          <span className="text-[11px] font-black whitespace-nowrap">شاشة 2</span>
        </button>
      </div>
      )}

      {/* Main Content */}
      <div className={`flex-1 flex overflow-hidden ${layout.isDesktop ? '' : 'flex-col'}`}>
        {/* Right: Categories Sidebar */}
        {showDesktopCategoryRail && (
        <div className="w-64 bg-white border-l shadow-2xl flex flex-col shrink-0 z-10">
          <div className="p-4 bg-gradient-to-b from-primary to-teal-700 text-white">
            <h2 className="font-black text-lg flex items-center gap-2">
              <Layers size={20} />
              الفئات
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            <button 
              onClick={() => { setActiveCategoryId(null); setActiveSubCategoryId(null); }}
              className={`w-full p-4 rounded-xl font-bold text-right transition mb-2 flex items-center gap-3 ${!activeCategoryId ? 'bg-primary text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              <Layers size={18} />
              جميع الفئات
            </button>
            
            {categories.map(cat => (
              <button 
                key={cat.id}
                onClick={() => { setActiveCategoryId(cat.id); setActiveSubCategoryId(null); }}
                className={`w-full p-4 rounded-xl font-bold text-right transition mb-2 flex items-center gap-3 ${activeCategoryId === cat.id ? 'bg-primary text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Left: Products Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!showDesktopCategoryRail && showMobileCategoryBar && (
            <div className={`bg-white border-b overflow-x-auto custom-scrollbar whitespace-nowrap shrink-0 flex gap-2 shadow-sm ${isAgentMobileLayout ? 'px-2 py-1.5' : 'px-3 py-3'}`}>
              <button
                onClick={() => { setActiveCategoryId(null); setActiveSubCategoryId(null); }}
                className={`${isAgentMobileLayout ? compactAgentChipClass : actionChipClass} flex items-center gap-2 ${!activeCategoryId ? 'bg-primary text-white shadow-lg border-primary' : 'bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200'}`}
              >
                <Layers size={14} /> جميع الفئات
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setActiveCategoryId(cat.id); setActiveSubCategoryId(null); }}
                  className={`${isAgentMobileLayout ? compactAgentChipClass : actionChipClass} ${activeCategoryId === cat.id ? 'bg-primary text-white shadow-lg border-primary' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
          {/* Subcategories Horizontal Bar */}
          {showMobileSubCategoryBar && (
          <div className={`bg-white border-b overflow-x-auto custom-scrollbar whitespace-nowrap shrink-0 flex gap-2 shadow-sm ${isAgentMobileLayout ? 'px-2 py-1.5' : categoryBarClass}`}>
             <button 
               onClick={() => { setActiveSubCategoryId(null); }}
                className={`${isAgentMobileLayout ? compactAgentChipClass : actionChipClass} flex items-center gap-2 ${!activeSubCategoryId ? 'bg-primary text-white shadow-lg border-primary' : 'bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200'}`}
             >
               <Layers size={14}/> الكل
             </button>
             {visibleSubCategories.map(sub => (
               <button 
                 key={sub.id} 
                 onClick={() => { setActiveSubCategoryId(sub.id); }}
                 className={`${isAgentMobileLayout ? compactAgentChipClass : actionChipClass} ${activeSubCategoryId === sub.id ? 'bg-primary text-white border-primary shadow-lg' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
               >
                 {sub.name}
               </button>
             ))}
             {!activeCategoryId && !isAgentMobileLayout && (
               <span className="text-xs font-bold text-gray-400 px-3 py-2">
                 اختاري فئة رئيسية من القائمة الجانبية
               </span>
             )}
           </div>
          )}

           {/* Products Grid */}
          <div className={`flex-1 overflow-y-auto custom-scrollbar android-scroll-safe ${productsViewportClass}`}>
             {filteredProducts.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
                    <Layers size={80} className="mb-4" />
                   <p className="text-xl font-bold">لا توجد مواد تطابق البحث</p>
                </div>
             ) : (
                 <div className={productGridClass}>
                   {filteredProducts.map(item => {
                     const inCart = cartQtyByItem.get(item.id) || 0;
                     const soldOut = isOutOfStock(item);
                     const availableQty = itemAvailableQty(item);
                     return (
                      <div 
                        key={item.id} 
                        onClick={() => addToCart(item, 'retail')}
                        className={`${productCardClass} tap-feedback ${soldOut ? 'border-red-200 bg-red-50/30 opacity-75' : 'cursor-pointer'} ${inCart > 0 ? 'border-primary shadow-2xl scale-[1.03]' : soldOut ? '' : isAgentMobileLayout ? 'hover:border-slate-300' : 'border-transparent hover:border-gray-200 hover:shadow-xl'}`}
                      >
                         {soldOut && (
                           <span className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-[10px] font-black text-white shadow-lg">
                             <AlertCircle size={12} />
                             نفد
                           </span>
                         )}
                         {inCart > 0 && (
                           <span className="absolute top-2 left-2 z-20 bg-red-600 text-white w-9 h-9 rounded-full flex items-center justify-center font-black shadow-lg animate-bounce border-2 border-white text-sm">
                             {inCart}
                           </span>
                         )}

                         <div className={productImageClass}>
                            {item.imageUrl ? (
                                <img src={item.imageUrl} className="max-w-full max-h-full object-contain transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-gray-100 bg-gray-50">
                                    <ImageIcon size={48} className="mb-1 opacity-20" />
                                    <span className="text-[10px] uppercase font-bold tracking-widest opacity-20">لا صورة</span>
                                </div>
                            )}
                            <button 
                              onClick={(e) => { e.stopPropagation(); addToCart(item, 'retail'); }}
                              disabled={soldOut}
                              title={soldOut ? 'الكمية غير متوفرة' : 'إضافة إلى السلة'}
                              className={`absolute bottom-2 right-2 text-white ${isAndroidLike ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center transition shadow-lg transform ${soldOut ? 'bg-gray-300 cursor-not-allowed opacity-100' : isAgentMobileLayout ? 'bg-primary opacity-100' : 'bg-primary/90 opacity-0 group-hover:opacity-100 hover:scale-110'}`}
                            >
                              <ShoppingCart size={16} />
                            </button>
                         </div>

                         <div className={`${isAgentMobileLayout ? 'p-2.5' : 'p-3'} flex-1 flex flex-col`}>
                           <div className={`${isAgentMobileLayout ? 'text-[12px]' : 'text-xs'} font-bold text-gray-800 line-clamp-2 mb-1 flex-1`}>{item.name}</div>
                           <div className="flex items-center justify-between mt-auto">
                             <div className="flex flex-col">
                               <span className="text-[10px] text-gray-400">{item.code}</span>
                               {Boolean((item as any).isScaleItem) && (
                                 <span className="text-[10px] font-black text-cyan-600">مادة ميزان</span>
                               )}
                               {itemBlocksStockSale(item) && (
                                 <span className={`text-[10px] font-black ${soldOut ? 'text-red-600' : 'text-emerald-600'}`}>
                                   {soldOut ? 'الكمية 0' : `المتوفر ${formatPosQty(availableQty)}`}
                                 </span>
                               )}
                               <span className={`${isAgentMobileLayout ? 'text-[1.05rem]' : 'text-lg'} font-black text-primary font-numeric`}>{formatPosMoney(item.salePrice)} {currencySymbol((item as any).priceCurrency)}</span>
                             </div>
                             <div className="flex gap-1">
                               <button 
                                 onClick={(e) => { e.stopPropagation(); addToCart(item, 'retail'); }}
                                 disabled={soldOut}
                                 title={soldOut ? 'الكمية غير متوفرة' : 'إضافة'}
                                 className={`${soldOut ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-primary text-white hover:bg-teal-700'} ${stepButtonSize} rounded-lg flex items-center justify-center font-bold shadow transition tap-feedback`}
                               >
                                 +
                               </button>
                               {inCart > 0 && (
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); decreaseItemFromCart(item.id); }}
                                   className={`bg-red-500 text-white ${stepButtonSize} rounded-lg flex items-center justify-center font-bold shadow transition hover:bg-red-600 tap-feedback`}
                                 >
                                   -
                                 </button>
                               )}
                             </div>
                           </div>
                         </div>
                      </div>
                    );
                   })}
                </div>
             )}
          </div>
        </div>

      </div>

      {/* Floating Cart Button */}
      <div className={layout.isMobile ? `fixed ${isAgentMobileLayout ? 'inset-x-2' : 'inset-x-3'} bottom-3 z-50 android-fab-offset` : 'fixed bottom-6 left-6 z-50'}>
         <button 
           onClick={() => setIsCheckoutOpen(true)}
           disabled={Object.keys(cart).length === 0}
           className={`relative bg-primary text-white shadow-2xl font-bold flex items-center gap-3 transition transform hover:scale-105 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed tap-feedback ${floatingCartClass} ${Object.keys(cart).length > 0 ? 'animate-bounce' : ''}`}
         >
           <ShoppingCart size={24} />
           <span className={`${layout.isMobile ? 'text-base' : 'text-lg'}`}>سلة المشتريات</span>
          {Object.keys(cart).length > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shadow-lg border-2 border-white">
              {Object.keys(cart).length}
            </span>
          )}
          <span className="opacity-80">|</span>
          <span className="font-numeric">{formatPosMoney(toSelectedCurrency(finalTotal))} {currencyLabel}</span>
        </button>
      </div>

      {/* Shift Modal */}
      {isShiftModalOpen && (
        <AdaptiveModal open={isShiftModalOpen} onClose={() => setIsShiftModalOpen(false)} size="lg" zIndex={200}>
          <div className="flex h-full flex-col">
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white p-4 flex items-center justify-between shrink-0">
               <h3 className="font-bold flex items-center gap-2">
                 <DollarSign size={20} />
                 ملخص الوردية
               </h3>
               <button onClick={() => setIsShiftModalOpen(false)} className="p-1 hover:bg-white/10 rounded transition">
                 <X size={20} />
               </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-6 android-scroll-safe">
               {shiftLoading ? (
                 <div className="text-center py-8">
                   <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                   <p className="font-bold text-gray-500">جاري تحميل البيانات...</p>
                 </div>
               ) : (
                 <>
                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                     <div className="bg-primary/10 p-4 rounded-xl text-center">
                       <div className="text-xs text-gray-500 mb-1">المبيعات</div>
                       <div className="font-black text-2xl text-primary font-numeric">{formatPosMoney(shiftSummary.total)} {BASE_CURRENCY}</div>
                     </div>
                     <div className="bg-blue-50 p-4 rounded-xl text-center">
                       <div className="text-xs text-gray-500 mb-1">عدد الفواتير</div>
                       <div className="font-black text-2xl text-blue-600">{shiftSummary.count}</div>
                     </div>
                     <div className="bg-green-50 p-4 rounded-xl text-center">
                       <div className="text-xs text-gray-500 mb-1">عدد الأصناف</div>
                       <div className="font-black text-2xl text-green-600">{shiftSummary.items.length}</div>
                     </div>
                   </div>
                   
                   <div className="flex flex-col sm:flex-row gap-2 mb-4">
                     <button 
                       onClick={exportShiftPdf}
                       className="flex-1 py-2 px-4 bg-gray-100 text-gray-700 rounded-lg font-bold text-sm hover:bg-gray-200 transition flex items-center justify-center gap-2"
                     >
                       <Printer size={16} />
                       طباعة PDF
                     </button>
                     <button 
                       onClick={exportShiftSummaryJson}
                       className="flex-1 py-2 px-4 bg-gray-100 text-gray-700 rounded-lg font-bold text-sm hover:bg-gray-200 transition flex items-center justify-center gap-2"
                     >
                       <Download size={16} />
                       تصدير JSON
                     </button>
                   </div>
                   
                   <div className="border-t pt-4">
                     <button 
                       onClick={handleEndShift}
                       className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition shadow-lg"
                     >
                       إنهاء الوردية وتصفير المبيعات
                     </button>
                   </div>
                 </>
               )}
            </div>
          </div>
        </AdaptiveModal>
      )}

      {exchangeModalOpen && (
        <AdaptiveModal open={exchangeModalOpen} onClose={() => setExchangeModalOpen(false)} size="sm" zIndex={220}>
          <div className="flex h-full flex-col">
            <div className="bg-gradient-to-r from-teal-700 to-primary text-white p-4 flex items-center justify-between shrink-0">
              <h3 className="font-bold flex items-center gap-2">
                <Globe size={18} />
                {'\u062a\u0639\u062f\u064a\u0644 \u0633\u0639\u0631 \u0627\u0644\u0635\u0631\u0641'}
              </h3>
              <button
                onClick={() => setExchangeModalOpen(false)}
                className="p-1 hover:bg-white/10 rounded transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 android-scroll-safe">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0633\u0639\u0631 \u0644.\u0633 \u0644\u0643\u0644 1$'}</label>
                <input
                  type="number"
                  min="1"
                  className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-primary transition font-numeric"
                  value={exchangeDraft.SYP}
                  onChange={e => setExchangeDraft(prev => ({ ...prev, SYP: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0633\u0639\u0631 TRY \u0644\u0643\u0644 1$'}</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-primary transition font-numeric"
                  value={exchangeDraft.TRY}
                  onChange={e => setExchangeDraft(prev => ({ ...prev, TRY: e.target.value }))}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                <span>{'\u0627\u0644\u0645\u0635\u062f\u0631: \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645'}</span>
                <span className="font-bold">{'\u062d\u0641\u0638 \u0641\u0648\u0631\u064a'}</span>
              </div>
              <button
                onClick={saveExchangeRates}
                disabled={isSavingRates}
                className="w-full py-3 bg-primary text-white rounded-xl font-bold hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSavingRates ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    {'\u062c\u0627\u0631\u064a \u0627\u0644\u062d\u0641\u0638...'}
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} />
                    {'\u062d\u0641\u0638 \u0633\u0639\u0631 \u0627\u0644\u0635\u0631\u0641'}
                  </>
                )}
              </button>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <AdaptiveModal open={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} size="md" zIndex={200}>
          <div className="flex h-full flex-col">
            <div className="bg-gradient-to-r from-primary to-teal-700 text-white p-4 flex items-center justify-between shrink-0">
               <h3 className="font-bold flex items-center gap-2">
                 <CheckCircle2 size={20} />
                 إتمام البيع
               </h3>
               <button onClick={() => setIsCheckoutOpen(false)} className="p-1 hover:bg-white/10 rounded transition">
                 <X size={20} />
               </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 android-scroll-safe">
              {/* Cart Items Preview */}
              <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm overflow-y-auto ${checkoutPreviewMaxHeightClass}`}>
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h4 className="font-bold text-sm text-gray-700">المنتجات</h4>
                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full font-numeric">
                    {Object.keys(cart).length}
                  </span>
                </div>
                <div className="px-4 py-2">
                {Object.entries(cart).map(([lineKey, item]) => {
                  const product = inventory.find(p => p.id === item.itemId);
                  if (!product) return null;
                  const qtyLabel = item.isScaleItem
                    ? `${formatPosQty(Number(item.qty || 0), 3)} ظƒط؛`
                    : `${item.qty}x`;
                  return (
                    <div key={lineKey} className="flex items-center justify-between py-3 border-b last:border-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded-lg font-numeric text-gray-700">{qtyLabel}</span>
                        <span className="text-sm font-bold truncate max-w-[220px]">{product.name}</span>
                      </div>
                      <span className="font-numeric text-primary font-bold">
                        {formatPosMoney(toSelectedCurrency(item.price * item.qty))} {currencyLabel}
                      </span>
                    </div>
                  );
                })}
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs text-gray-500 font-bold">الإجمالي</div>
                    <div className="text-3xl font-black text-primary font-numeric">
                      {formatPosMoney(toSelectedCurrency(finalTotal))} {currencyLabel}
                    </div>
                  </div>
                  {paymentType === 'cash' && selectedCurrency !== BASE_CURRENCY && (
                    <div className="text-right">
                      <div className="text-xs text-gray-500">سعر الصرف</div>
                      <div className="font-bold font-numeric text-gray-700">
                        1$ = {formatPosRate(currentRate)} {currencyLabel}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-600 font-bold text-sm">حسم ممنوح</span>
                  <input
                    type="number"
                    min="0"
                    className="w-28 border border-gray-200 rounded-lg px-2 py-2 text-right font-numeric font-bold focus:ring-2 focus:ring-primary/30 outline-none"
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                {paymentType === 'cash' && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500">المتبقي</span>
                    <span className={`font-bold ${changePay < 0 ? 'text-red-500' : 'text-green-500'}`}>{formatPosMoney(Math.abs(changePay))} {currencyLabel}</span>
                  </div>
                )}
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639'}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => { setPaymentType('cash'); setPaidInput(''); }}
                    className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition ${paymentType === 'cash' ? 'bg-primary text-white shadow-lg' : 'bg-gray-100 text-gray-600'}`}
                  >
                    <Wallet size={18} />
                    نقدي
                  </button>
                  <button 
                    onClick={() => setPaymentType('credit')}
                    className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition ${paymentType === 'credit' ? 'bg-primary text-white shadow-lg' : 'bg-gray-100 text-gray-600'}`}
                  >
                    <CreditCard size={18} />
                    آجل
                  </button>
                </div>
              </div>
              
                            {paymentType === 'cash' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0627\u0644\u0635\u0646\u062f\u0648\u0642'}</label>
                    <select
                      className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-primary transition"
                      value={selectedCashBoxId}
                      onChange={e => setSelectedCashBoxId(e.target.value)}
                    >
                      <option value="">{'\u0627\u062e\u062a\u0631 \u0635\u0646\u062f\u0648\u0642...'}</option>
                      {cashBoxes.map(box => (
                        <option key={box.id} value={box.id}>{box.name}</option>
                      ))}
                    </select>
                    {cashBoxes.length === 0 && (
                      <p className="text-xs text-rose-600 font-bold mt-1">
                        {'\u0644\u0627 \u062a\u0648\u062c\u062f \u0635\u0646\u0627\u062f\u064a\u0642 \u0645\u0639\u0631\u0641\u0629. \u0623\u0636\u0641 \u0635\u0646\u062f\u0648\u0642\u0627\u064b \u0623\u0648\u0644\u0627\u064b \u0645\u0646 \u0642\u0633\u0645 \u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642.'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0627\u0644\u0639\u0645\u0644\u0629'}</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button 
                        onClick={() => { setSelectedCurrency('USD'); setPaidInput(''); }}
                        className={`flex-1 py-2 rounded-lg font-bold transition ${selectedCurrency === BASE_CURRENCY ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}
                      >
                        USD $
                      </button>
                      <button 
                        onClick={() => { setSelectedCurrency('SYP'); setPaidInput(''); }}
                        className={`flex-1 py-2 rounded-lg font-bold transition ${selectedCurrency === 'SYP' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {'\u0633\u0648\u0631\u064a\u0627 \u0644.\u0633'}
                      </button>
                      <button 
                        onClick={() => { setSelectedCurrency('TRY'); setPaidInput(''); }}
                        className={`flex-1 py-2 rounded-lg font-bold transition ${selectedCurrency === 'TRY' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}
                      >
                        Turkey TRY
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">
                      {'\u0627\u0644\u0645\u062f\u0641\u0648\u0639'} ({selectedCurrency === BASE_CURRENCY ? BASE_CURRENCY : selectedCurrency})
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-primary transition font-numeric"
                      value={paidInput}
                      onChange={e => setPaidInput(e.target.value)}
                      placeholder={String(Math.max(0, totalPay))}
                    />
                  </div>
                </>
              )}
              
              {paymentType === 'credit' && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0627\u0644\u0639\u0645\u064a\u0644'}</label>
                  <select 
                    className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-primary transition"
                    value={selectedClientId}
                    onChange={e => setSelectedClientId(e.target.value)}
                  >
                    <option value="">{'\u0627\u062e\u062a\u0631 \u0639\u0645\u064a\u0644...'}</option>
                    {clients.filter(c => c.isActive).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">{'\u0645\u0644\u0627\u062d\u0638\u0627\u062a (\u0627\u062e\u062a\u064a\u0627\u0631\u064a)'}</label>
                <textarea 
                  className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold text-sm outline-none focus:border-primary transition resize-none"
                  rows={2}
                  placeholder={'\u0645\u0644\u0627\u062d\u0638\u0627\u062a...'}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
              
              <div className={layout.isMobile ? 'android-sticky-actions' : ''}>
                <button 
                  onClick={handleFinalCheckout}
                  disabled={isSubmitting || (paymentType === 'cash' && !selectedCashBoxId) || (paymentType === 'credit' && !selectedClientId)}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold text-lg shadow-lg hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 tap-feedback"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      {'\u062c\u0627\u0631\u064a \u0627\u0644\u0645\u0639\u0627\u0644\u062c\u0629...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={24} />
                      {'\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0628\u064a\u0639'} ({formatPosMoney(toSelectedCurrency(finalTotal))} {currencyLabel})
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}
      {/* Windows Printer Picker Modal */}
      {!isAndroid && (
        <WindowsPrinterPicker
          open={windowsPrinterPickerOpen}
          onClose={handleWindowsPrinterClose}
          onSelect={handleWindowsPrinterSelect}
          defaultPaperSize={tempPaperSize}
        />
      )}

      {isAndroid && (
        <BluetoothPrinterPicker
          open={bluetoothPrinterPickerOpen}
          onClose={() => {
            setBluetoothPrinterPickerOpen(false);
            setPreviewReceiptData(null);
          }}
          onSelect={handleBluetoothPrinterSelect}
          defaultPaperSize={tempPaperSize}
          defaultPrinterId={appSettings?.print?.thermal?.printerId || ''}
        />
      )}

      {/* Thermal Print Preview Modal */}
      <ThermalPrintPreviewModal
        open={thermalPreviewOpen}
        onClose={() => setThermalPreviewOpen(false)}
        receiptData={previewReceiptData}
        onPrint={handlePreviewPrint}
        paperSize={tempPaperSize}
        title="معاينة فاتورة POS"
      />

      {/* Status Messages */}
      {statusMsg && (
        <div className={`fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-white rounded-xl shadow-2xl p-4 z-[300] flex items-center gap-3 animate-fadeIn ${statusMsg.type === 'error' ? 'border-r-4 border-red-500' : 'border-r-4 border-green-500'}`}>
          {statusMsg.type === 'error' ? (
            <AlertCircle size={24} className="text-red-500 shrink-0" />
          ) : (
            <CheckCircle2 size={24} className="text-green-500 shrink-0" />
          )}
          <p className="font-bold text-sm flex-1">{statusMsg.text}</p>
          <button onClick={() => setStatusMsg(null)} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
      )}

      {printFailHint && (
        <div className="fixed bottom-24 left-4 right-4 md:left-auto md:max-w-lg md:right-4 bg-amber-50 border border-amber-200 rounded-xl shadow-lg p-3 z-[299] flex flex-col gap-2 animate-fadeIn">
          <div className="flex flex-wrap items-center gap-2">
            <AlertCircle size={18} className="text-amber-600 shrink-0" />
            <p className="font-bold text-xs text-amber-900 flex-1 min-w-[140px]">{printFailHint}</p>
            <button type="button" onClick={() => setPrintFailHint(null)} className="text-amber-700 hover:text-amber-900 text-xs font-bold px-2">
              إغلاق
            </button>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => void handlePrintLastInvoice()}
              className="text-xs font-black bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 tap-feedback"
            >
              إعادة إيصال الزبون
            </button>
            {appSettings?.print?.restaurant?.kitchenEnabled && String(appSettings.print.restaurant.kitchenHost || '').trim() && (
              <>
                <button
                  type="button"
                  onClick={() => void handleReprintKitchenLast()}
                  className="text-xs font-black bg-teal-700 text-white px-3 py-1.5 rounded-lg hover:bg-teal-800 tap-feedback"
                >
                  إعادة مطبخ
                </button>
                <button
                  type="button"
                  onClick={() => void handleReprintBothLast()}
                  className="text-xs font-black bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-black tap-feedback"
                >
                  إعادة زبون + مطبخ
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default POSQuick;
