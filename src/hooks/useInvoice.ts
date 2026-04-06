
import { useEffect, useRef, useState } from 'react';
import { Invoice, InvoiceItem, InventoryItem, Client, CashBox, Warehouse, AppUser, CurrencyRates, DEFAULT_CURRENCY_RATES } from '../types';
import { getAdditionalCostsTotal } from '../modules/invoices/invoice.calculations';
import { useSyncQueue } from './useSyncQueue';
import { apiRequest } from '../lib/api';

const createDefaultInvoiceEntry = () => ({
    itemId: '',
    itemName: '',
    unitName: 'قطعة',
    quantity: '',
    price: '',
    total: '',
    meters: '',
    yards: '',
    rolls: '',
    priceYard: '',
    lengthType: 'meter',
    serialNumbers: [] as string[],
    originalUnitPrice: '',
    promotionId: '',
    promotionName: '',
    promotionDiscountAmount: '',
    isTextile: false,
    textileBaseUom: 'meter' as 'meter' | 'yard',
    textileColorId: '',
    textileColorName: '',
    textileDecompositionPayload: [] as Array<{ sequence: number; lengthValue: number; unit: 'meter' | 'yard'; rollLabel?: string | null }>,
});

export const useInvoice = (
    inventory: InventoryItem[], 
    _invoices: Invoice[], 
    clients: Client[], 
    _partners: any[],
    cashBoxes: CashBox[],
    warehouses: Warehouse[],
    refreshData: () => Promise<void>,
    currentUser?: AppUser | null,
    defaultCurrency?: string,
    currencyRates?: CurrencyRates,
    textileModeEnabled = false,
) => {
    const { performOfflineAction } = useSyncQueue();
    const resolvedRates = currencyRates || DEFAULT_CURRENCY_RATES;
    const rateFor = (cur: 'USD' | 'SYP' | 'TRY') => (cur === 'USD' ? 1 : Number(resolvedRates[cur] || 1));
    const toBaseAmount = (value: number, cur: 'USD' | 'SYP' | 'TRY') => {
        const amount = Number(value || 0);
        if (cur === 'USD') return amount;
        const rate = rateFor(cur);
        return rate > 0 ? amount / rate : amount;
    };
    const fromBaseAmount = (value: number, cur: 'USD' | 'SYP' | 'TRY') => {
        const amount = Number(value || 0);
        if (cur === 'USD') return amount;
        const rate = rateFor(cur);
        return rate > 0 ? amount * rate : amount;
    };
    
    // Mode and Type
    const [activeMode, setActiveMode] = useState<string>('invoice');
    const [invoiceType, setInvoiceType] = useState<'sale' | 'purchase' | 'opening_stock'>('sale');
    const [openingStockType, setOpeningStockType] = useState<'inventory' | 'financial'>('inventory');

    // Basic Fields
    const [selectedClientId, setSelectedClientId] = useState('');
    const [selectedWarehouseId, setSelectedWarehouseId] = useState(warehouses[0]?.id || '');
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
    const [customInvoiceNumber, setCustomInvoiceNumber] = useState('');
    const [originalInvoiceNumber, setOriginalInvoiceNumber] = useState('');
    const [currency, setCurrency] = useState<'USD' | 'TRY' | 'SYP'>((defaultCurrency as any) || 'USD');
    const [notes, setNotes] = useState('');

    // Cart and Totals
    const [cart, setCart] = useState<InvoiceItem[]>([]);
    const [financialCart, setFinancialCart] = useState<any[]>([]);
    const [purchaseCosts, setPurchaseCosts] = useState({ customs: '', shipping: '', transport: '', labor: '', others: '' });
    const [showExpenses, setShowExpenses] = useState(false);
    const [discount, setDiscount] = useState('');

    // Payment
    const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
    const [selectedCashBoxId, setSelectedCashBoxId] = useState(cashBoxes[0]?.id || '');
    const [paidSplit, setPaidSplit] = useState<{ USD: string; SYP: string; TRY: string }>({ USD: '', SYP: '', TRY: '' });

    // UI State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'warning', text: string } | null>(null);
    const [isInquiryOpen, setIsInquiryOpen] = useState(false);
    const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [printInvoice, setPrintInvoice] = useState<Invoice | null>(null);
    const [lastSavedInvoice, setLastSavedInvoice] = useState<Invoice | null>(null);
    const prevCurrencyRef = useRef<'USD' | 'SYP' | 'TRY'>(currency);

    useEffect(() => {
        if (!selectedWarehouseId && warehouses.length > 0) {
            setSelectedWarehouseId(warehouses[0].id);
        }
    }, [warehouses, selectedWarehouseId]);

    useEffect(() => {
        if (activeMode === 'opening_stock' && openingStockType === 'inventory') {
            setInvoiceType('opening_stock');
        }
    }, [activeMode, openingStockType]);

    useEffect(() => {
        if (!selectedCashBoxId && cashBoxes.length > 0) {
            setSelectedCashBoxId(cashBoxes[0].id);
        }
    }, [cashBoxes, selectedCashBoxId]);

    useEffect(() => {
        const prevCurrency = prevCurrencyRef.current;
        if (prevCurrency === currency) return;
        const convert = (amount: number, fromCur: 'USD' | 'SYP' | 'TRY', toCur: 'USD' | 'SYP' | 'TRY') => {
            if (!Number.isFinite(amount)) return 0;
            const base = toBaseAmount(amount, fromCur);
            return fromBaseAmount(base, toCur);
        };
        setCart(prev => prev.map((line: any) => {
            const unitPrice = convert(Number(line.unitPrice || 0), prevCurrency, currency);
            const textileUnitPricePerLength = line.textileUnitPricePerLength != null
                ? convert(Number(line.textileUnitPricePerLength || 0), prevCurrency, currency)
                : line.textileUnitPricePerLength;
            const qty = Number(line.quantity || 0);
            const total = unitPrice * qty;
            return {
                ...line,
                unitPrice,
                total,
                textileUnitPricePerLength,
                priceAtSale: unitPrice,
                autoResolvedUnitPrice: line.autoResolvedUnitPrice != null
                    ? convert(Number(line.autoResolvedUnitPrice || 0), prevCurrency, currency)
                    : line.autoResolvedUnitPrice,
            };
        }));
        setEntry(prev => {
            if (!prev.price) return prev;
            const unitPrice = convert(Number(prev.price || 0), prevCurrency, currency);
            const qty = Number(prev.isTextile ? (prev.textileBaseUom === 'yard' ? prev.yards || 0 : prev.meters || 0) : (prev.quantity || 0));
            return {
                ...prev,
                price: String(unitPrice),
                total: qty ? String(unitPrice * qty) : prev.total,
            };
        });
        prevCurrencyRef.current = currency;
    }, [currency]);

    // Auto-select default cash customer/supplier based on invoice type
    useEffect(() => {
        if (selectedClientId) return; // User already picked a party
        const defaultId = invoiceType === 'sale' ? 'party-cash-customer' : invoiceType === 'purchase' ? 'party-cash-supplier' : '';
        if (defaultId && clients.some(c => c.id === defaultId)) {
            setSelectedClientId(defaultId);
        }
    }, [invoiceType, clients]);

    // POS Entry
    const [entry, setEntry] = useState(createDefaultInvoiceEntry);

    useEffect(() => {
        if (!entry.itemId) return;
        const selectedItem = inventory.find(i => String(i.id) === String(entry.itemId));
        if (!selectedItem) return;
        const effectiveIsTextile = textileModeEnabled && Boolean(selectedItem.isTextile || (selectedItem as any).is_textile);
        const effectiveTextileBaseUom = String(selectedItem.textileBaseUom || (selectedItem as any).textile_base_uom || 'meter') as 'meter' | 'yard';
        if (effectiveIsTextile && (!entry.isTextile || entry.textileBaseUom !== effectiveTextileBaseUom)) {
            setEntry(prev => ({
                ...prev,
                isTextile: true,
                textileBaseUom: effectiveTextileBaseUom,
                unitName: effectiveTextileBaseUom,
                quantity: '',
            }));
        }
    }, [entry.itemId, entry.isTextile, entry.textileBaseUom, inventory, textileModeEnabled]);

    useEffect(() => {
        if (textileModeEnabled || !entry.itemId) return;
        const selectedItem = inventory.find(i => String(i.id) === String(entry.itemId));
        if (!selectedItem) return;
        if (!entry.isTextile && !(selectedItem as any).is_textile && !selectedItem.isTextile) return;
        setEntry(prev => ({
            ...prev,
            isTextile: false,
            textileBaseUom: 'meter',
            textileColorId: '',
            textileColorName: '',
            rolls: '',
            meters: '',
            yards: '',
            unitName: selectedItem.unitName || 'قطعة',
        }));
    }, [entry.itemId, entry.isTextile, inventory, textileModeEnabled]);

    const handleItemSelect = async (id: string, name?: string) => {
        if (id) {
            const item = inventory.find(i => i.id === id && !i.inactive && !i.merged);
            if (item) {
                const effectiveIsTextile = textileModeEnabled && Boolean(item.isTextile || (item as any).is_textile);
                const effectiveTextileBaseUom = String(item.textileBaseUom || (item as any).textile_base_uom || 'meter') as 'meter' | 'yard';
                const itemCurrency = (item.priceCurrency as 'USD' | 'SYP' | 'TRY' | undefined) || 'USD';
                const basePriceFromItem = invoiceType === 'sale'
                    ? Number((item as any).posPriceBase ?? item.salePriceBase ?? (item as any).posPrice ?? item.salePrice ?? 0)
                    : Number((item as any).costPriceBase ?? item.costPrice ?? 0);
                const basePriceResolved = (item as any).posPriceBase || item.salePriceBase || (item as any).costPriceBase
                    ? basePriceFromItem
                    : toBaseAmount(basePriceFromItem, itemCurrency);
                const baseOriginalUnitPrice = Number(basePriceResolved || 0);
                let baseUnitPrice = baseOriginalUnitPrice;
                let displayUnitPrice = fromBaseAmount(baseUnitPrice, currency);
                let pricingSource = '';
                let pricingSourceKey = '';
                let autoResolvedUnitPrice = displayUnitPrice;
                let lastPurchasePrice = Number((item as any).lastPurchasePriceTransaction || item.costPrice || 0);
                let availableQty = Number(item.quantity || 0);

                // Use pricing resolution service for sale invoices
                if (invoiceType === 'sale') {
                    try {
                        const customerId = selectedClientId || '';
                        const priceRes = await apiRequest(`pricing/resolve?itemId=${id}&customerId=${customerId}`);
                        if (priceRes && priceRes.unitPrice > 0) {
                            baseUnitPrice = Number(priceRes.unitPrice || baseUnitPrice);
                            displayUnitPrice = fromBaseAmount(baseUnitPrice, currency);
                            pricingSource = priceRes.source || '';
                            pricingSourceKey = priceRes.sourceKey || '';
                            autoResolvedUnitPrice = displayUnitPrice;
                            if (priceRes.lastPurchasePrice) lastPurchasePrice = priceRes.lastPurchasePrice;
                            if (priceRes.availableQty != null) availableQty = priceRes.availableQty;
                        }
                    } catch { /* fallback to local price */ }

                    try {
                        const evalResult = await apiRequest('promotions/evaluate', {
                            method: 'POST',
                            body: JSON.stringify({ itemId: item.id, quantity: 1, unitPrice: Number(displayUnitPrice || 0), referenceDate: invoiceDate }),
                        });
                        if (evalResult?.promotion?.finalPrice !== undefined) {
                            displayUnitPrice = Number(evalResult.promotion.finalPrice || displayUnitPrice);
                            baseUnitPrice = toBaseAmount(displayUnitPrice, currency);
                            setEntry(prev => ({
                                ...prev,
                                promotionId: String(evalResult?.promotion?.promotionId || ''),
                                promotionName: String(evalResult?.promotion?.promotionName || ''),
                                promotionDiscountAmount: String(evalResult?.promotion?.discountAmount || 0),
                            }));
                        }
                    } catch {}
                }
                setEntry(prev => ({
                    ...prev,
                    itemId: id,
                    itemName: item.name,
                    unitName: effectiveIsTextile ? effectiveTextileBaseUom : (item.unitName || 'قطعة'),
                    price: Number(displayUnitPrice || 0).toString(),
                    originalUnitPrice: Number(baseOriginalUnitPrice || 0).toString(),
                    serialNumbers: [],
                    pricingSource,
                    pricingSourceKey,
                    autoResolvedUnitPrice: String(displayUnitPrice),
                    lastPurchasePrice: String(lastPurchasePrice),
                    availableQty: String(availableQty),
                    itemType: (item as any).itemType || 'STOCK',
                    isTextile: effectiveIsTextile,
                    textileBaseUom: effectiveTextileBaseUom,
                    textileColorId: '',
                    textileColorName: '',
                    textileDecompositionPayload: [],
                    quantity: effectiveIsTextile ? '' : prev.quantity,
                    rolls: effectiveIsTextile ? '' : prev.rolls,
                    meters: effectiveIsTextile ? '' : prev.meters,
                    yards: effectiveIsTextile ? '' : prev.yards,
                }));
            }
        } else if (name !== undefined) {
            setEntry(prev => ({ ...prev, itemId: '', itemName: name }));
        }
    };

    const handleAddToCart = (overrides?: Partial<InvoiceItem> & { serialNumbers?: string[] }) => {
        if (entry.isTextile) {
            if (invoiceType === 'sale' && !entry.itemId) {
                setStatusMsg({ type: 'error', text: 'لا يمكن البيع إلا لمادة موجودة في المخزون. اختر مادة من القائمة.' });
                return;
            }
            const textileRollCount = parseFloat(entry.rolls || '0');
            const textileTotalLength = parseFloat(entry.textileBaseUom === 'yard' ? (entry.yards || '0') : (entry.meters || '0'));
            const textileUnitPricePerLength = parseFloat(entry.price || '0');
            const decompositionPayload = Array.isArray((overrides as any)?.textileDecompositionPayload)
                ? (overrides as any)?.textileDecompositionPayload
                : Array.isArray((entry as any).textileDecompositionPayload)
                    ? (entry as any).textileDecompositionPayload
                    : [];
            const decompositionLength = decompositionPayload.reduce((sum: number, row: any) => sum + Number(row?.lengthValue || 0), 0);
            const effectiveLength = invoiceType === 'sale' && decompositionPayload.length > 0
                ? decompositionLength
                : textileTotalLength;
            if (!entry.itemName || !entry.textileColorName || textileRollCount <= 0 || effectiveLength <= 0 || textileUnitPricePerLength <= 0) {
                setStatusMsg({ type: 'error', text: 'يرجى إدخال اللون والكمية والطول وسعر الطول.' });
                return;
            }
            if (invoiceType === 'sale') {
                if (decompositionPayload.length !== Math.round(textileRollCount)) {
                    setStatusMsg({ type: 'error', text: 'يرجى إكمال تفكيك الرولات قبل إضافة السطر.' });
                    return;
                }
                if (decompositionPayload.some((row: any) => Number(row?.lengthValue || 0) <= 0)) {
                    setStatusMsg({ type: 'error', text: 'تفكيك الرولات غير مكتمل.' });
                    return;
                }
            }
            if (invoiceType === 'purchase' && textileTotalLength <= 0) {
                setStatusMsg({ type: 'error', text: 'يرجى إدخال الطول الإجمالي للشراء.' });
                return;
            }
            const textileItem: InvoiceItem = {
                itemId: entry.itemId || `NEW-${Date.now()}`,
                itemName: entry.itemName,
                unitName: entry.textileBaseUom,
                quantity: effectiveLength,
                baseQuantity: effectiveLength,
                unitPrice: textileUnitPricePerLength,
                total: effectiveLength * textileUnitPricePerLength,
                rollsSold: 0,
                metersSold: entry.textileBaseUom === 'meter' ? effectiveLength : 0,
                yardsSold: entry.textileBaseUom === 'yard' ? effectiveLength : 0,
                priceAtSale: textileUnitPricePerLength,
                serialNumbers: [],
                originalUnitPrice: Number(overrides?.originalUnitPrice ?? entry.originalUnitPrice ?? textileUnitPricePerLength),
                promotionId: '',
                promotionName: '',
                promotionDiscountAmount: 0,
                pricingSource: (entry as any).pricingSource || '',
                pricingModeApplied: (entry as any).pricingSourceKey || '',
                autoResolvedUnitPrice: Number((entry as any).autoResolvedUnitPrice || textileUnitPricePerLength),
                isManualPriceOverride: Number((entry as any).autoResolvedUnitPrice || 0) > 0 && textileUnitPricePerLength !== Number((entry as any).autoResolvedUnitPrice || 0),
                lastPurchasePrice: Number((entry as any).lastPurchasePrice || 0),
                availableQty: Number((entry as any).availableQty || 0),
                commissionType: 'NONE',
                commissionValue: 0,
                commissionAmount: 0,
                itemType: (entry as any).itemType || 'STOCK',
                isTextile: true,
                textileColorId: entry.textileColorId || undefined,
                textileColorName: entry.textileColorName || undefined,
                textileRollCount: textileRollCount,
                textileTotalLength: effectiveLength,
                textileBaseUom: entry.textileBaseUom === 'yard' ? 'yard' : 'meter',
                textileUnitPricePerLength,
                textileDecompositionPayload: decompositionPayload,
            } as any;
            setCart([...cart, { ...textileItem, ...overrides }]);
            setEntry(createDefaultInvoiceEntry());
            return;
        }

        if (invoiceType === 'sale' && !entry.itemId) {
            setStatusMsg({ type: 'error', text: 'لا يمكن البيع إلا لمادة موجودة في المخزون. اختر مادة من القائمة.' });
            return;
        }

        if (!entry.itemName || !entry.quantity || !entry.price) {
            setStatusMsg({ type: 'error', text: 'يرجى إكمال بيانات الصنف' });
            return;
        }

        const q = parseFloat(entry.quantity || '0');
        const p = parseFloat(entry.price);
        
        const newItem: InvoiceItem = {
            itemId: entry.itemId || `NEW-${Date.now()}`,
            itemName: entry.itemName,
            unitName: entry.unitName,
            quantity: q,
            unitPrice: p,
            total: q * p,
            rollsSold: 0,
            metersSold: 0,
            yardsSold: 0,
            priceAtSale: p,
            serialNumbers: overrides?.serialNumbers || entry.serialNumbers || [],
            originalUnitPrice: Number(overrides?.originalUnitPrice ?? entry.originalUnitPrice ?? p),
            promotionId: String(overrides?.promotionId ?? entry.promotionId ?? ''),
            promotionName: String(overrides?.promotionName ?? entry.promotionName ?? ''),
            promotionDiscountAmount: Number(overrides?.promotionDiscountAmount ?? entry.promotionDiscountAmount ?? 0),
            pricingSource: (entry as any).pricingSource || '',
            pricingModeApplied: (entry as any).pricingSourceKey || '',
            autoResolvedUnitPrice: Number((entry as any).autoResolvedUnitPrice || p),
            isManualPriceOverride: Number((entry as any).autoResolvedUnitPrice || 0) > 0 && p !== Number((entry as any).autoResolvedUnitPrice || 0),
            lastPurchasePrice: Number((entry as any).lastPurchasePrice || 0),
            availableQty: Number((entry as any).availableQty || 0),
            commissionType: 'NONE',
            commissionValue: 0,
            commissionAmount: 0,
            itemType: (entry as any).itemType || 'STOCK',
        } as any;

        setCart([...cart, newItem]);
        setEntry(createDefaultInvoiceEntry());
    };

    const handleAddToFinancialCart = (item: any) => {
        setFinancialCart(prev => [...prev, item]);
    };

    const handleRemoveFromFinancialCart = (index: number) => {
        setFinancialCart(prev => prev.filter((_, i) => i !== index));
    };

    const handleExchangeFromInvoice = (inv: Invoice) => {
        setActiveMode('exchange');
        setInvoiceType(inv.type === 'purchase' ? 'purchase' : 'sale');
        setSelectedClientId(inv.clientId);
        setOriginalInvoiceNumber(inv.invoiceNumber || '');
        setCart(inv.items.map(i => ({ ...i, isReturn: true })));
    };

    const getGeoLocation = async () => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
        return new Promise<{ lat: number; lng: number } | null>((resolve) => {
            let done = false;
            const timeoutId = setTimeout(() => {
                if (done) return;
                done = true;
                resolve(null);
            }, 2500);
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timeoutId);
                    resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                },
                () => {
                    if (done) return;
                    done = true;
                    clearTimeout(timeoutId);
                    resolve(null);
                },
                { enableHighAccuracy: true, maximumAge: 60000, timeout: 2000 }
            );
        });
    };

    const handleCreateInvoice = async () => {
        const isFinancialOS = activeMode === 'opening_stock' && openingStockType === 'financial';
        
        if (!isFinancialOS && cart.length === 0) {
            setStatusMsg({ type: 'error', text: 'السلة فارغة' });
            return;
        }

        if (isFinancialOS && financialCart.length === 0) {
            setStatusMsg({ type: 'error', text: 'يرجى إدخال ذمة مالية واحدة على الأقل' });
            return;
        }

        setIsSubmitting(true);
        setStatusMsg(null);

        if (isFinancialOS) {
            try {
                for (const line of financialCart) {
                    const party = clients.find(c => c.id === line.clientId);
                    let refNum = customInvoiceNumber;
                    if (!refNum) {
                        try {
                            const res = await apiRequest('next-number/opening_stock');
                            refNum = res.number;
                        } catch {
                            refNum = String(Date.now()).slice(-6);
                        }
                    }
                    await performOfflineAction('opening-balances/parties', 'POST', {
                        partyId: line.clientId,
                        amount: Number(line.amount || 0),
                        entryType: line.type,
                        partyRole: party?.type,
                        currency,
                        note: notes || 'رصيد افتتاحي',
                        date: invoiceDate,
                        referenceNumber: refNum
                    });
                }
                setStatusMsg({ type: 'success', text: 'تم حفظ الأرصدة الافتتاحية للذمم بنجاح ✅' });
                setFinancialCart([]);
                await refreshData();
            } catch (e: any) {
                setStatusMsg({ type: 'error', text: `فشل الحفظ: ${e.message || 'حدث خطأ غير متوقع'}` });
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        const totalExpenses = getAdditionalCostsTotal(purchaseCosts);
        const discountValue = Number(discount || 0);
        const itemsSubtotal = isFinancialOS
            ? financialCart.reduce((s, i) => s + i.amount, 0)
            : cart.reduce((s, i) => s + i.total, 0);
        // goodsTotal = what supplier is owed (no extra costs)
        const goodsTotal = Math.max(0, itemsSubtotal - discountValue);
        // full total = goods + extra costs (used for inventory cost basis)
        const total = isFinancialOS
            ? itemsSubtotal
            : Math.max(0, itemsSubtotal + (invoiceType === 'purchase' ? totalExpenses : 0) - discountValue);

        const warehouse = warehouses.find(w => w.id === selectedWarehouseId);

        const geo = await getGeoLocation();
        if (currentUser?.role === 'agent' && geo) {
            await performOfflineAction(`agents/${currentUser.id}/location`, 'POST', { lat: geo.lat, lng: geo.lng });
        }

        const computedInvoiceNumber = await (async () => {
            if (customInvoiceNumber) return customInvoiceNumber;
            const docType = activeMode === 'opening_stock' ? 'opening_stock'
                : activeMode === 'return' ? 'return'
                : activeMode === 'exchange' ? 'exchange'
                : invoiceType;
            try {
                const res = await apiRequest(`next-number/${docType}`);
                return res.number;
            } catch {
                return String(Date.now()).slice(-6);
            }
        })();

        // --- Exchange rate from settings ---
        const rates = currencyRates || DEFAULT_CURRENCY_RATES;
        const exchangeRate = currency === 'USD' ? 1 : Number(rates[currency] || 1);
        const toBaseAmount = (value: number) => {
            const amount = Number(value || 0);
            if (currency === 'USD') return amount;
            return exchangeRate > 0 ? amount / exchangeRate : amount;
        };
        const totalTransaction = Number(total || 0);
        const goodsTotalTransaction = Number(goodsTotal || 0);
        const additionalCostsTotalTransaction = invoiceType === 'purchase' ? Number(totalExpenses || 0) : 0;
        const discountTransaction = Number(discountValue || 0);
        const totalBase = toBaseAmount(totalTransaction);
        const goodsTotalBase = toBaseAmount(goodsTotalTransaction);
        const additionalCostsTotalBase = toBaseAmount(additionalCostsTotalTransaction);
        const discountBase = toBaseAmount(discountTransaction);
        const splitCurrencies: Array<'USD' | 'SYP' | 'TRY'> = ['USD', 'SYP', 'TRY'];
        const paymentSplit = splitCurrencies
            .map((cur) => {
                const raw = Number((paidSplit as any)?.[cur] || 0);
                if (!Number.isFinite(raw) || raw <= 0) return null;
                const rate = cur === 'USD' ? 1 : Number(rates[cur] || 1);
                const base = rate > 0 ? (raw / rate) : raw;
                return {
                    currency: cur,
                    amount: raw,
                    rate,
                    amountBase: base,
                };
            })
            .filter(Boolean) as Array<{ currency: 'USD' | 'SYP' | 'TRY'; amount: number; rate: number; amountBase: number }>;

        const paidBase = paymentSplit.reduce((sum, line) => sum + Number(line.amountBase || 0), 0);
        const settlementBase = invoiceType === 'purchase' ? goodsTotalBase : totalBase;
        const settlementTransaction = currency === 'USD' ? settlementBase : (exchangeRate ? settlementBase * exchangeRate : settlementBase);
        const paidTransactionRaw = currency === 'USD' ? paidBase : (exchangeRate ? paidBase * exchangeRate : paidBase);
        const paidTransaction = Math.min(settlementTransaction, paidTransactionRaw);
        const remainingBase = Math.max(0, settlementBase - paidBase);
        const remainingTransaction = currency === 'USD' ? remainingBase : (exchangeRate ? remainingBase * exchangeRate : remainingBase);
        const normalizedItems = cart.map((line: any) => {
            const qty = Number((line?.baseQuantity ?? line?.quantity) || 0);
            const unitPriceTransaction = Number((line?.unitPriceTransaction ?? line?.unitPrice ?? line?.priceAtSale) || 0);
            const lineTotalTransaction = Number((line?.lineTotalTransaction ?? line?.total ?? (unitPriceTransaction * qty)) || 0);
            return {
                ...line,
                quantity: qty,
                baseQuantity: qty,
                unitPrice: unitPriceTransaction,
                unitPriceTransaction,
                unitPriceBase: toBaseAmount(unitPriceTransaction),
                total: lineTotalTransaction,
                lineTotalTransaction,
                lineTotalBase: toBaseAmount(lineTotalTransaction),
                currency,
                exchangeRate,
            };
        });
        const box = cashBoxes.find(b => b.id === selectedCashBoxId);

        const payload: any = {
            id: `inv-${Date.now()}`,
            invoiceNumber: computedInvoiceNumber,
            originalInvoiceNumber,
            type: activeMode === 'return' ? 'return' : activeMode === 'exchange' ? 'exchange' : invoiceType,
            returnType: (activeMode === 'return' || activeMode === 'exchange') ? (invoiceType === 'purchase' ? 'purchase' : 'sale') : undefined,
            currency,
            exchangeRate,
            notes,
            clientId: selectedClientId,
            clientName: clients.find(c => c.id === selectedClientId)?.name || 'عميل عام',
            date: invoiceDate,
            items: normalizedItems,
            totalAmount: totalBase,
            totalAmountBase: totalBase,
            totalAmountTransaction: totalTransaction,
            originalAmount: totalTransaction,
            // Landed cost separation: supplier owes only goods subtotal, not extra costs
            goodsSubtotal: goodsTotalBase,
            additionalCostsTotal: additionalCostsTotalBase,
            discount: discountBase,
            discountBase,
            discountTransaction,
            paidAmount: paidBase,
            paidAmountBase: paidBase,
            paidAmountTransaction: paidTransaction,
            paidAmountOriginal: paidTransaction,
            remainingAmount: remainingBase,
            remainingAmountBase: remainingBase,
            remainingAmountTransaction: remainingTransaction,
            paymentSplit,
            targetWarehouseId: selectedWarehouseId,
            targetWarehouseName: warehouse?.name || 'غير محدد',
            cashBoxId: selectedCashBoxId || null,
            cashBoxName: box?.name || null,
            selectedCashBoxId: selectedCashBoxId || null,
            paymentType: paymentType,
            createdById: currentUser?.id,
            createdByName: currentUser?.name || currentUser?.username,
            createdByRole: currentUser?.role,
            geoLat: geo?.lat,
            geoLng: geo?.lng
        };
        // عند رصيد أول المدة للمخزون: أجبر تطبيق المخزون
        if (activeMode === 'opening_stock' && openingStockType === 'inventory') {
            payload.type = 'opening_stock';
            payload.applyStock = 1;
        }


        try {
            const result = await performOfflineAction('invoices', 'POST', payload);
            
            if (result.queued) {
                setStatusMsg({ type: 'warning', text: 'تم حفظ الفاتورة محلياً (الموبايل). سيتم رفعها للسيرفر فور توفر الشبكة ☁️' });
            } else {
                setStatusMsg({ type: 'success', text: 'تم حفظ الفاتورة بنجاح على السيرفر الرئيسي ✅' });
            }
            setLastSavedInvoice(payload);
            setCart([]); setSelectedClientId(''); setPaidSplit({ USD: '', SYP: '', TRY: '' }); setDiscount('');
            setFinancialCart([]);
            await refreshData();
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: `فشل الحفظ: ${e.message || 'حدث خطأ غير متوقع'}` });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReturnFromInvoice = (inv: Invoice, returnType: 'sale' | 'purchase' = 'sale') => {
        setActiveMode('return');
        setInvoiceType(returnType === 'purchase' ? 'purchase' : 'sale');
        setSelectedClientId(inv.clientId);
        setOriginalInvoiceNumber(inv.invoiceNumber || '');
        setCart(inv.items.map(i => ({ ...i, isReturn: true })));
    };

    return {
        state: { 
            activeMode, invoiceType, openingStockType, selectedClientId, selectedWarehouseId, 
            invoiceDate, customInvoiceNumber, originalInvoiceNumber, currency, notes, cart, financialCart, 
            purchaseCosts, showExpenses, discount, paymentType, selectedCashBoxId, paidSplit, 
            isSubmitting, statusMsg, isInquiryOpen, viewInvoice, editingInvoice, printInvoice, 
            lastSavedInvoice, entry 
        },
        setters: { 
            setActiveMode, setInvoiceType, setOpeningStockType, setSelectedClientId, 
            setSelectedWarehouseId, setInvoiceDate, setCustomInvoiceNumber, 
            setOriginalInvoiceNumber, setCurrency, setNotes, setCart, setFinancialCart, setPurchaseCosts, 
            setShowExpenses, setDiscount, setPaymentType, setSelectedCashBoxId, setPaidSplit, 
            setStatusMsg, setIsInquiryOpen, setViewInvoice, setEditingInvoice, setPrintInvoice, 
            setEntry 
        },
        handlers: { 
            handleItemSelect, handleAddToCart, handleCreateInvoice, 
            handleReturnFromInvoice, handleAddToFinancialCart, handleRemoveFromFinancialCart, handleExchangeFromInvoice
        }
    };
};
