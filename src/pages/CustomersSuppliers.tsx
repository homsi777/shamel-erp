
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useModalEscape } from '../hooks/useEscapeKey';
import { 
    Users, Truck, Search, Plus, FileText, Phone, MapPin, 
    RefreshCw, LayoutGrid, Building2, CheckCircle2, XCircle, Trash2, Eye, EyeOff, Scale, Info, History, ArrowRightLeft, Calendar, DollarSign, ListTree, AlertCircle, Loader2, Download, ArrowDownLeft, ArrowUpRight
} from 'lucide-react';
import { Party, PartyType, formatNumber, formatDate, CashBox, ReconciliationMark, Invoice, Voucher, AppUser } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import Combobox from '../components/Combobox';
import { SmartLink } from '../components/smart';
import { AdaptiveModal, AdaptiveTable, ResponsivePage } from '../components/responsive';
import useResponsiveLayout from '../hooks/useResponsiveLayout';
import { useSmartDrawer } from '../hooks/useSmartDrawer';
import PartyRowActions from '../components/customers/PartyRowActions';
// @ts-ignore
import html2pdf from 'html2pdf.js';

type UiCurrency = 'USD' | 'SYP' | 'TRY';
const UI_CURRENCIES: UiCurrency[] = ['USD', 'SYP', 'TRY'];
const formatDisplayAmount = (value: unknown) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0';
    const abs = Math.abs(numeric);
    const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : 3;
    const formatted = formatNumber(numeric, decimals);
    if (!formatted.includes('.')) return formatted;
    return formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const symbolForCurrency = (code?: string): string => {
    const cur = String(code || 'USD').toUpperCase();
    if (cur === 'SYP') return 'ل.س';
    if (cur === 'TRY') return '\u20BA';
    return '$';
};
const inferBaseCurrency = (settings: any): UiCurrency => {
    const explicit = String(settings?.defaultCurrency || settings?.primaryCurrency || '').toUpperCase();
    if (UI_CURRENCIES.includes(explicit as UiCurrency)) return explicit as UiCurrency;
    const rates = (settings?.currencyRates && typeof settings.currencyRates === 'object') ? settings.currencyRates : {};
    const fromRates = UI_CURRENCIES.find((c) => Number((rates as any)?.[c]) === 1);
    return fromRates || 'USD';
};
const normalizeRateFromSettings = (currency: UiCurrency, baseCurrency: UiCurrency, rates: Record<string, number>): number => {
    if (currency === baseCurrency) return 1;
    const targetRate = Number((rates as any)?.[currency] || 0);
    const baseRate = Number((rates as any)?.[baseCurrency] || 1);
    if (targetRate > 0 && baseRate > 0) return targetRate / baseRate;
    if (targetRate > 0) return targetRate;
    return 0;
};
const parseCurrencyContextFromSettingsRows = (rows: any): { baseCurrency: UiCurrency; rates: Record<string, number> } => {
    if (!Array.isArray(rows) || rows.length === 0) return readCurrencyContextFromLocalStorage();
    const settingsMap = new Map<string, any>();
    for (const row of rows) {
        const key = String(row?.key || '').trim();
        if (!key) continue;
        let value = row?.value;
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch {}
        }
        settingsMap.set(key, value);
    }
    const baseFromSettings = settingsMap.get('defaultCurrency') ?? settingsMap.get('primaryCurrency');
    const rateMap = settingsMap.get('currencyRates');
    const rates = (rateMap && typeof rateMap === 'object') ? rateMap : {};
    const baseCurrency = inferBaseCurrency({ defaultCurrency: baseFromSettings, currencyRates: rates });
    return { baseCurrency, rates };
};
const readCurrencyContextFromLocalStorage = (): { baseCurrency: UiCurrency; rates: Record<string, number> } => {
    try {
        const raw = localStorage.getItem('shamel_settings');
        const parsed = raw ? JSON.parse(raw) : {};
        const rates = (parsed?.currencyRates && typeof parsed.currencyRates === 'object')
            ? parsed.currencyRates
            : {};
        const baseCurrency = inferBaseCurrency(parsed);
        return { baseCurrency, rates };
    } catch {
        return { baseCurrency: 'USD' as UiCurrency, rates: {} as Record<string, number> };
    }
};

const CustomersSuppliers: React.FC<{
    refreshData: () => Promise<void>,
    cashBoxes: CashBox[],
    clients: Party[],
    invoices: Invoice[],
    vouchers: Voucher[],
    currentUser?: AppUser | undefined,
    navigateToTab?: (tab: string) => void
}> = ({ refreshData, cashBoxes, clients, invoices, vouchers, currentUser, navigateToTab }) => {
    const layout = useResponsiveLayout();
    const [activeTab, setActiveTab] = useState<PartyType | 'ALL' | 'TRANSFERS'>('CUSTOMER');
    const [partiesList, setPartiesList] = useState<Party[]>([]);
    const [partyTransactions, setPartyTransactions] = useState<any[]>([]);
    const [transfersList, setTransfersList] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [selectedParty, setSelectedParty] = useState<Party | null>(null);
    const [openSelectedPartyInEditMode, setOpenSelectedPartyInEditMode] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRecomputing, setIsRecomputing] = useState(false);
    const [currencyContext, setCurrencyContext] = useState<{ baseCurrency: UiCurrency; rates: Record<string, number> }>(() => readCurrencyContextFromLocalStorage());
    const isAdmin = currentUser?.role === 'admin';
    const canEditParties = isAdmin || !!currentUser?.permissions?.includes('manage_clients');

    const [form, setForm] = useState({
        name: '',
        type: 'CUSTOMER' as PartyType,
        phone: '',
        email: '',
        address: '',
        taxNo: '',
        openingEntryType: '' as '' | 'debit' | 'credit',
        openingAmount: '',
        openingCurrency: (() => {
            try {
                const raw = localStorage.getItem('shamel_settings');
                const parsed = raw ? JSON.parse(raw) : {};
                return inferBaseCurrency(parsed);
            } catch {
                return 'USD' as UiCurrency;
            }
        })() as UiCurrency
    });

    const [transferForm, setTransferForm] = useState({
        fromPartyId: '', toPartyId: '', fromAccountType: 'CUSTOMER', toAccountType: 'CUSTOMER',
        amount: '', currency: currencyContext.baseCurrency, note: '', date: new Date().toISOString().split('T')[0]
    });

    const fetchParties = async () => {
        setIsLoading(true);
        try {
            const [data, transfers, txRows, settingsRows] = await Promise.all([
                apiRequest('parties'),
                apiRequest('parties/transfers').catch(() => []),
                apiRequest('party-transactions').catch(() => []),
                apiRequest('settings').catch(() => null)
            ]);
            setPartiesList(data || []);
            setTransfersList(transfers || []);
            setPartyTransactions(txRows || []);
            const nextCurrencyContext = parseCurrencyContextFromSettingsRows(settingsRows);
            setCurrencyContext(nextCurrencyContext);
            setForm((prev) => {
                const currentCurrency = UI_CURRENCIES.includes(prev.openingCurrency as UiCurrency)
                    ? (prev.openingCurrency as UiCurrency)
                    : nextCurrencyContext.baseCurrency;
                if (currentCurrency === prev.openingCurrency) return prev;
                return { ...prev, openingCurrency: currentCurrency };
            });
        } catch (e) { console.error("Parties fetch error"); }
        finally { setIsLoading(false); }
    };

    const handleRecomputeBalances = async () => {
        if (!isAdmin || isRecomputing) return;
        const confirmed = await confirmDialog('إعادة احتساب أرصدة العملاء والموردين؟');
        if (!confirmed) return;
        setIsRecomputing(true);
        try {
            await apiRequest('admin/recompute-party-balances', { method: 'POST' });
            await fetchParties();
            await refreshData();
            alert('تمت إعادة احتساب الأرصدة بنجاح');
        } catch (e: any) {
            alert(e?.response?.data?.error || 'فشل إعادة احتساب الأرصدة');
        } finally {
            setIsRecomputing(false);
        }
    };

    useEffect(() => { fetchParties(); }, []);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('shamel_party_edit_prefill');
            if (!raw || partiesList.length === 0) return;
            const payload = JSON.parse(raw);
            const partyId = String(payload?.id || '');
            if (!partyId) return;
            const target = partiesList.find(p => p.id === partyId);
            if (!target) return;
            setSelectedParty(target);
            setOpenSelectedPartyInEditMode(true);
            localStorage.removeItem('shamel_party_edit_prefill');
        } catch {}
    }, [partiesList]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('shamel_party_view_prefill');
            if (!raw || partiesList.length === 0) return;
            const payload = JSON.parse(raw);
            const partyId = String(payload?.id || '');
            if (!partyId) return;
            const target = partiesList.find(p => p.id === partyId);
            if (!target) return;
            setSelectedParty(target);
            localStorage.removeItem('shamel_party_view_prefill');
        } catch {}
    }, [partiesList]);
    useEffect(() => {
        setTransferForm((prev) => (
            prev.currency === currencyContext.baseCurrency
                ? prev
                : { ...prev, currency: currencyContext.baseCurrency }
        ));
    }, [currencyContext.baseCurrency]);

    // ESC key closes modals
    useModalEscape(isAddModalOpen, useCallback(() => setIsAddModalOpen(false), []));
    useModalEscape(isTransferModalOpen, useCallback(() => setIsTransferModalOpen(false), []));
    useModalEscape(!!selectedParty, useCallback(() => setSelectedParty(null), []));

    const filteredParties = useMemo(() => {
        const safeSearch = (searchTerm || '').toLowerCase();
        return (partiesList || []).filter(p => {
            const matchTab = activeTab === 'ALL' || p?.type === activeTab || p?.type === 'BOTH';
            const name = (p?.name || '').toLowerCase();
            const phone = (p?.phone || '');
            return matchTab && (name.includes(safeSearch) || phone.includes(safeSearch));
        });
    }, [partiesList, activeTab, searchTerm]);

    const balancesByPartyId = useMemo(() => {
        const map = new Map<string, number>();
        (partiesList || []).forEach((party) => {
            map.set(party.id, Number(party.balance || 0));
        });
        return map;
    }, [partiesList]);

    const partyBalanceViewById = useMemo(() => {
        const map = new Map<string, { baseAmount: number; secondaryCurrency: UiCurrency | null; secondaryAmount: number }>();
        const baseCurrency = currencyContext.baseCurrency;
        const rateMap = currencyContext.rates || {};
        const totalsByParty = new Map<string, { baseAmount: number; byCurrency: Record<string, number> }>();

        for (const tx of (partyTransactions || [])) {
            const partyId = String((tx as any)?.partyId || '');
            if (!partyId) continue;
            const bucket = totalsByParty.get(partyId) || { baseAmount: 0, byCurrency: {} as Record<string, number> };
            const baseDelta = Number((tx as any)?.deltaBase ?? (tx as any)?.delta ?? 0);
            if (Number.isFinite(baseDelta)) bucket.baseAmount += baseDelta;

            const txCurrency = String((tx as any)?.currency || baseCurrency).toUpperCase();
            const explicitTxDelta = Number((tx as any)?.deltaTransaction);
            let transactionDelta = 0;
            if (Number.isFinite(explicitTxDelta) && Math.abs(explicitTxDelta) > 0.000001) {
                transactionDelta = explicitTxDelta;
            } else if (txCurrency === baseCurrency) {
                transactionDelta = baseDelta;
            } else {
                const derivedRate = normalizeRateFromSettings(txCurrency as UiCurrency, baseCurrency, rateMap);
                transactionDelta = derivedRate > 0 ? (baseDelta * derivedRate) : 0;
            }
            if (!bucket.byCurrency[txCurrency]) bucket.byCurrency[txCurrency] = 0;
            bucket.byCurrency[txCurrency] += transactionDelta;
            totalsByParty.set(partyId, bucket);
        }

        for (const party of (partiesList || [])) {
            const partyId = String(party.id || '');
            const totals = totalsByParty.get(partyId);
            const baseAmount = Number(balancesByPartyId.get(partyId) ?? totals?.baseAmount ?? 0);
            const nonBase = Object.entries(totals?.byCurrency || {})
                .filter(([cur, val]) => cur !== baseCurrency && Number.isFinite(val) && Math.abs(Number(val)) > 0.000001)
                .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])));
            const selectedSecondary = nonBase.length > 0 ? (nonBase[0][0] as UiCurrency) : null;
            const selectedAmount = selectedSecondary ? Number(nonBase[0][1] || 0) : 0;
            map.set(partyId, {
                baseAmount,
                secondaryCurrency: selectedSecondary,
                secondaryAmount: selectedAmount
            });
        }
        return map;
    }, [partyTransactions, partiesList, balancesByPartyId, currencyContext]);

    const validateOpeningBalance = () => {
        if (!form.openingEntryType) return null;
        const amount = Number(form.openingAmount || 0);
        if (!amount || amount <= 0) return 'يرجى إدخال مبلغ افتتاحي صحيح مع نوع الرصيد';
        if (!form.openingCurrency) return 'اختر عملة الرصيد';
        return null;
    };
    const openingBalancePreview = useMemo(() => {
        const amount = Number(form.openingAmount || 0);
        if (!form.openingEntryType || !Number.isFinite(amount) || amount <= 0) return null;
        const baseCurrency = currencyContext.baseCurrency;
        const openingCurrency = (form.openingCurrency || baseCurrency) as UiCurrency;
        const exchangeRate = normalizeRateFromSettings(openingCurrency, baseCurrency, currencyContext.rates || {});
        const baseEquivalent = openingCurrency === baseCurrency
            ? amount
            : (exchangeRate > 0 ? amount / exchangeRate : null);
        return {
            openingCurrency,
            baseCurrency,
            exchangeRate,
            baseEquivalent,
            hasRate: openingCurrency === baseCurrency || exchangeRate > 0,
        };
    }, [form.openingEntryType, form.openingAmount, form.openingCurrency, currencyContext]);

    const handleCreateParty = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const validationError = validateOpeningBalance();
            if (validationError) {
                alert(validationError);
                setIsSubmitting(false);
                return;
            }
            const baseCurrency = currencyContext.baseCurrency;
            const openingCurrency = (form.openingCurrency || baseCurrency) as UiCurrency;
            const openingExchangeRate = normalizeRateFromSettings(openingCurrency, baseCurrency, currencyContext.rates || {});
            const openingAmount = Number(form.openingAmount || 0);
            const hasOpening = !!form.openingEntryType && openingAmount > 0;

            const result = await apiRequest('parties', {
                method: 'POST',
                body: JSON.stringify({
                    name: form.name,
                    type: form.type,
                    phone: form.phone,
                    email: form.email,
                    address: form.address,
                    taxNo: form.taxNo,
                })
            });
            if (!result?.success || !result?.id) {
                alert(result?.error || 'فشل حفظ الطرف');
                setIsSubmitting(false);
                return;
            }

            if (hasOpening) {
                await apiRequest('opening-balances/parties', {
                    method: 'POST',
                    body: JSON.stringify({
                        partyId: String(result.id),
                        amount: openingAmount,
                        entryType: form.openingEntryType,
                        partyRole: form.type,
                        currency: openingCurrency,
                        exchangeRate: openingExchangeRate > 0 ? openingExchangeRate : undefined,
                        note: 'رصيد افتتاحي عند إنشاء الطرف',
                    }),
                });
            }

            setIsAddModalOpen(false);
            setForm({ name: '', type: 'CUSTOMER', phone: '', email: '', address: '', taxNo: '', openingEntryType: '', openingAmount: '', openingCurrency: currencyContext.baseCurrency });
            await fetchParties();
            await refreshData();
        } catch (e: any) {
            const msg = e?.response?.data?.error || e?.message || 'فشل حفظ الطرف';
            alert(`فشل حفظ الطرف: ${msg}`);
        }
        finally { setIsSubmitting(false); }
    };

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (transferForm.fromPartyId === transferForm.toPartyId && transferForm.fromAccountType === transferForm.toAccountType) {
            alert("لا يمكن التحويل لنفس الحساب");
            return;
        }
        setIsSubmitting(true);
        try {
            await apiRequest('parties/transfer', { 
                method: 'POST', 
                body: JSON.stringify({ ...transferForm, amount: Number(transferForm.amount) }) 
            });
            await fetchParties();
            await refreshData();
            setIsTransferModalOpen(false);
            setTransferForm({ fromPartyId: '', toPartyId: '', fromAccountType: 'CUSTOMER', toAccountType: 'CUSTOMER', amount: '', currency: currencyContext.baseCurrency, note: '', date: new Date().toISOString().split('T')[0] });
            alert("تمت عملية المناقلة بنجاح ✅");
        } catch (e: any) { alert(e.response?.data?.error || "فشل تنفيذ المناقلة"); }
        finally { setIsSubmitting(false); }
    };

    const renderPartyBalance = (party: Party) => {
        const balView = partyBalanceViewById.get(party.id);
        const bal = Number(balView?.baseAmount ?? balancesByPartyId.get(party.id) ?? 0);
        const isSupplier = party.type === 'SUPPLIER';
        const isPositiveGood = isSupplier ? bal < 0 : bal > 0;
        const secondaryCur = balView?.secondaryCurrency;
        const secondaryAmount = Number(balView?.secondaryAmount || 0);
        return (
            <div className={`inline-flex flex-col items-center justify-center px-4 py-2 rounded-2xl border ${bal === 0 ? 'bg-gray-50 border-gray-200' : (isPositiveGood ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700')}`}>
                <div className="font-black font-numeric text-lg tracking-tighter">
                    {formatDisplayAmount(Math.abs(bal))} {symbolForCurrency(currencyContext.baseCurrency)}
                </div>
                {!!secondaryCur && Math.abs(secondaryAmount) > 0.000001 && (
                    <div className="text-[10px] font-bold opacity-75 mt-1">
                        {formatDisplayAmount(Math.abs(secondaryAmount))} {symbolForCurrency(secondaryCur)}
                    </div>
                )}
                <div className="text-[9px] font-black uppercase opacity-60">
                    {bal === 0 ? 'صافي' : (bal > 0 ? (party.type === 'CUSTOMER' ? 'لنا عنده' : 'له عندنا') : (party.type === 'CUSTOMER' ? 'له عندنا' : 'لنا عنده'))}
                </div>
            </div>
        );
    };

    const renderPartyLinkState = (party: Party) => (
        (party.accountId || party.arAccountId || party.apAccountId) ? (
            <div className="flex items-center gap-2 text-emerald-600 font-bold text-[10px] bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-100 w-fit">
                <ListTree size={12}/> موثق بالشجرة
            </div>
        ) : (
            <div className="text-[10px] text-gray-400 font-bold">غير مرتبط محاسبياً</div>
        )
    );

    const handleDeleteParty = async (party: Party) => {
        const hasLinkedData =
            (invoices || []).some((inv: any) => String(inv?.clientId || '') === String(party.id)) ||
            (vouchers || []).some((v: any) => String(v?.clientId || '') === String(party.id)) ||
            (partyTransactions || []).some((tx: any) => String(tx?.partyId || '') === String(party.id));
        if (hasLinkedData) {
            alert('لا يمكن حذف الجهة لأنها مرتبطة بحركات أو فواتير أو سندات.');
            return;
        }
        if (!(await confirmDialog('حذف هذه الجهة؟ لن يتم الحذف إذا كانت مرتبطة بفواتير أو سندات.'))) return;
        try {
            await apiRequest(`parties/${party.id}`, {method:'DELETE'});
            fetchParties();
        } catch (err: any) {
            const msg = err?.response?.data?.error || 'فشل حذف الطرف';
            alert(msg);
        }
    };

    const renderPartyActions = (party: Party, mode: 'buttons' | 'menu' = 'buttons') => (
        <PartyRowActions
            mode={mode}
            onView={() => setSelectedParty(party)}
            onDelete={() => handleDeleteParty(party)}
        />
    );

    return (
        <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="py-4 md:py-6">
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-3 rounded-2xl text-primary"><Users size={32}/></div>
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 tracking-tight">إدارة الجهات والحسابات المالية</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase mt-1">المحرك المالي للعملاء والموردين</p>
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    {navigateToTab && (
                        <button
                            onClick={() => navigateToTab('opening_balances')}
                            className="bg-indigo-50 text-indigo-700 border-2 border-indigo-100 px-6 py-3 rounded-2xl font-black shadow-sm hover:bg-indigo-100 transition transform active:scale-95 flex items-center gap-2"
                        >
                            <Scale size={20}/> ذمم أول المدة
                        </button>
                    )}
                    {isAdmin && (
                        <button
                            onClick={handleRecomputeBalances}
                            title="إعادة احتساب أرصدة العملاء والموردين"
                            className="text-[10px] text-gray-400 hover:text-gray-600 px-3 py-2 rounded-xl border border-transparent hover:border-gray-200 opacity-30 hover:opacity-100 transition"
                        >
                            <RefreshCw size={14} className={isRecomputing ? 'animate-spin inline' : 'inline'} /> إعادة احتساب
                        </button>
                    )}
                    <button onClick={() => setIsTransferModalOpen(true)} className="bg-white text-blue-600 border-2 border-blue-100 px-6 py-3 rounded-2xl font-black shadow-sm hover:bg-blue-50 transition transform active:scale-95 flex items-center gap-2">
                        <ArrowRightLeft size={20}/> مناقلة حسابات
                    </button>
                    <button onClick={() => setIsAddModalOpen(true)} className="bg-primary text-white px-8 py-3 rounded-2xl font-black shadow-xl hover:bg-teal-800 transition transform active:scale-95 flex items-center gap-2">
                        <Plus size={20}/> اضافة عميل او مورد
                    </button>
                </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex bg-white p-1.5 rounded-2xl border border-gray-200 shadow-sm w-full md:w-auto">
                    {[
                        { id: 'CUSTOMER', label: 'العملاء', icon: <Users size={16}/> },
                        { id: 'SUPPLIER', label: 'الموردين', icon: <Truck size={16}/> },
                        { id: 'ALL', label: 'الكل', icon: <LayoutGrid size={16}/> },
                        { id: 'TRANSFERS', label: 'سجل المناقلات', icon: <History size={16}/> },
                    ].map(tab => (
                        <button 
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === tab.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-400 hover:bg-gray-50'}`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="relative flex-1 max-w-md w-full">
                    <Search className="absolute right-4 top-3.5 text-gray-400" size={18}/>
                    <input 
                        type="text" 
                        placeholder="بحث بالاسم، الهاتف..." 
                        className="w-full pr-12 pl-4 py-3 bg-white border border-gray-200 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {activeTab === 'TRANSFERS' ? (
                <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
                    <AdaptiveTable
                        rows={transfersList}
                        keyExtractor={(t: any) => String(t.id)}
                        emptyState={<div className="p-20 text-center text-gray-300 font-bold">لا توجد مناقلات مسجلة</div>}
                        tabletColumnVisibility={['transferNumber', 'date', 'fromPartyName', 'toPartyName', 'amount']}
                        columns={[
                            {
                                id: 'transferNumber',
                                header: 'رقم السند',
                                cell: (t: any) => <span className="font-mono font-bold text-blue-600">{t.transferNumber}</span>,
                            },
                            {
                                id: 'date',
                                header: 'التاريخ',
                                cell: (t: any) => <span className="font-numeric text-gray-500">{formatDate(t.date)}</span>,
                            },
                            {
                                id: 'fromPartyName',
                                header: 'من (الطرف المرسل)',
                                cell: (t: any) => <span className="font-bold text-red-600">{t.fromPartyName}</span>,
                            },
                            {
                                id: 'toPartyName',
                                header: 'إلى (الطرف المستلم)',
                                cell: (t: any) => <span className="font-bold text-green-600">{t.toPartyName}</span>,
                            },
                            {
                                id: 'amount',
                                header: 'المبلغ',
                                cell: (t: any) => <span className="font-black font-numeric text-lg">{formatNumber(t.amount)} {symbolForCurrency(t.currency || currencyContext.baseCurrency)}</span>,
                                tdClassName: 'text-center',
                            },
                            {
                                id: 'note',
                                header: 'ملاحظات',
                                cell: (t: any) => <span className="text-xs text-gray-400 italic">{t.note || '-'}</span>,
                            },
                        ]}
                        rowClassName={() => 'hover:bg-gray-50 border-b'}
                        mobileCardRender={(t: any) => (
                            <div className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="font-mono font-bold text-blue-600">{t.transferNumber}</div>
                                    <div className="text-[11px] font-numeric text-gray-500">{formatDate(t.date)}</div>
                                </div>
                                <div className="grid grid-cols-1 gap-2 text-sm">
                                    <div className="rounded-xl bg-red-50 p-3">
                                        <div className="text-[11px] font-bold text-red-500">من</div>
                                        <div className="mt-1 font-black text-red-700">{t.fromPartyName}</div>
                                    </div>
                                    <div className="rounded-xl bg-green-50 p-3">
                                        <div className="text-[11px] font-bold text-green-500">إلى</div>
                                        <div className="mt-1 font-black text-green-700">{t.toPartyName}</div>
                                    </div>
                                </div>
                                <div className="rounded-xl bg-gray-50 p-3">
                                    <div className="text-[11px] font-bold text-gray-500">المبلغ</div>
                                    <div className="mt-1 font-black font-numeric text-lg">{formatNumber(t.amount)} {symbolForCurrency(t.currency || currencyContext.baseCurrency)}</div>
                                </div>
                                <div className="text-xs text-gray-500">{t.note || '-'}</div>
                            </div>
                        )}
                    />
                </div>
            ) : (
                <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
                    <AdaptiveTable
                        rows={filteredParties}
                        keyExtractor={(party) => party.id}
                        enableStickyActions
                        tabletColumnVisibility={['party', 'balance', 'actions']}
                        loading={isLoading && partiesList.length === 0}
                        loadingState={<div className="p-20 text-center text-gray-400 font-bold"><RefreshCw className="animate-spin inline mr-2"/> جاري التحميل...</div>}
                        emptyState={<div className="p-20 text-center text-gray-300 font-bold">لا توجد جهات مسجلة</div>}
                        columns={[
                            {
                                id: 'party',
                                header: 'الجهة',
                                cell: (party) => (
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-sm ${party.type === 'CUSTOMER' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                                            {party.type === 'CUSTOMER' ? <Users size={20}/> : <Truck size={20}/>}
                                        </div>
                                        <div>
                                            <div className="font-black text-gray-900 text-base">{party.name}</div>
                                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{party.type}</div>
                                        </div>
                                    </div>
                                ),
                            },
                            {
                                id: 'accounting',
                                header: 'الربط المحاسبي',
                                cell: (party) => renderPartyLinkState(party),
                            },
                            {
                                id: 'balance',
                                header: 'الرصيد المالي',
                                cell: (party) => <div className="text-center">{renderPartyBalance(party)}</div>,
                                tdClassName: 'text-center',
                            },
                            {
                                id: 'actions',
                                header: 'الإجراءات',
                                cell: (party) => renderPartyActions(party, layout.isTablet ? 'menu' : 'buttons'),
                                tdClassName: 'text-center',
                            },
                        ]}
                        rowClassName={() => 'hover:bg-gray-50 transition-colors group border-b'}
                        mobileCardRender={(party) => (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-sm ${party.type === 'CUSTOMER' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                                            {party.type === 'CUSTOMER' ? <Users size={20}/> : <Truck size={20}/>}
                                        </div>
                                        <div>
                                            <div className="font-black text-gray-900">{party.name}</div>
                                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{party.type}</div>
                                        </div>
                                    </div>
                                    {renderPartyActions(party, 'buttons')}
                                </div>
                                <div>{renderPartyBalance(party)}</div>
                                <div>{renderPartyLinkState(party)}</div>
                            </div>
                        )}
                    />
                </div>
            )}

            {/* --- MODAL: ASSET TRANSFER --- */}
            {isTransferModalOpen && (
                <AdaptiveModal open={true} onClose={() => setIsTransferModalOpen(false)} size="lg" zIndex={110} panelClassName="flex h-full max-h-[92vh] flex-col overflow-hidden border-t-8 border-blue-600 bg-white md:rounded-[3rem]">
                    <div className="flex h-full flex-col">
                        <div className="p-4 md:p-8 bg-gray-900 text-white flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-xl font-black flex items-center gap-3"><ArrowRightLeft className="text-blue-400"/> مناقلة مالية بين الحسابات</h3>
                                <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">Party Ledger Transfer System</p>
                            </div>
                            <button onClick={() => setIsTransferModalOpen(false)}><XCircle size={28}/></button>
                        </div>
                        <form onSubmit={handleTransfer} className="p-4 md:p-10 space-y-4 md:space-y-8 bg-white overflow-y-auto max-h-[75vh] custom-scrollbar android-scroll-safe">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10">
                                {/* المصدر */}
                                <div className="space-y-4 p-4 md:p-6 bg-red-50/30 rounded-[2rem] border border-red-100">
                                    <div className="flex items-center gap-2 text-red-600 font-black uppercase text-[10px] tracking-widest mb-2"><XCircle size={14}/> الطرف المرسل (من)</div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-gray-400 block uppercase">نوع الحساب</label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setTransferForm({...transferForm, fromAccountType: 'CUSTOMER'})} className={`flex-1 py-2 rounded-xl font-bold text-xs ${transferForm.fromAccountType === 'CUSTOMER' ? 'bg-red-600 text-white shadow-md' : 'bg-white text-gray-400'}`}>زبائن</button>
                                            <button type="button" onClick={() => setTransferForm({...transferForm, fromAccountType: 'SUPPLIER'})} className={`flex-1 py-2 rounded-xl font-bold text-xs ${transferForm.fromAccountType === 'SUPPLIER' ? 'bg-red-600 text-white shadow-md' : 'bg-white text-gray-400'}`}>موردين</button>
                                        </div>
                                        <label className="text-[10px] font-black text-gray-400 block uppercase">اسم الجهة</label>
                                        <Combobox 
                                            items={partiesList.filter(p => transferForm.fromAccountType === 'CUSTOMER' ? (p.type === 'CUSTOMER' || p.type === 'BOTH') : (p.type === 'SUPPLIER' || p.type === 'BOTH')).map(p => ({ id: p.id, label: p.name, subLabel: `رصيد: ${formatNumber(Math.abs(balancesByPartyId.get(p.id) || 0))}${symbolForCurrency(currencyContext.baseCurrency)}` }))} 
                                            selectedId={transferForm.fromPartyId} 
                                            onSelect={(id) => setTransferForm({...transferForm, fromPartyId: id})}
                                            placeholder="ابحث عن الطرف المرسل..."
                                        />
                                    </div>
                                </div>

                                {/* المستلم */}
                                <div className="space-y-4 p-4 md:p-6 bg-green-50/30 rounded-[2rem] border border-green-100">
                                    <div className="flex items-center gap-2 text-green-600 font-black uppercase text-[10px] tracking-widest mb-2"><CheckCircle2 size={14}/> الطرف المستلم (إلى)</div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-gray-400 block uppercase">نوع الحساب</label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setTransferForm({...transferForm, toAccountType: 'CUSTOMER'})} className={`flex-1 py-2 rounded-xl font-bold text-xs ${transferForm.toAccountType === 'CUSTOMER' ? 'bg-green-600 text-white shadow-md' : 'bg-white text-gray-400'}`}>زبائن</button>
                                            <button type="button" onClick={() => setTransferForm({...transferForm, toAccountType: 'SUPPLIER'})} className={`flex-1 py-2 rounded-xl font-bold text-xs ${transferForm.toAccountType === 'SUPPLIER' ? 'bg-green-600 text-white shadow-md' : 'bg-white text-gray-400'}`}>موردين</button>
                                        </div>
                                        <label className="text-[10px] font-black text-gray-400 block uppercase">اسم الجهة</label>
                                        <Combobox 
                                            items={partiesList.filter(p => transferForm.toAccountType === 'CUSTOMER' ? (p.type === 'CUSTOMER' || p.type === 'BOTH') : (p.type === 'SUPPLIER' || p.type === 'BOTH')).map(p => ({ id: p.id, label: p.name, subLabel: `رصيد: ${formatNumber(Math.abs(balancesByPartyId.get(p.id) || 0))}${symbolForCurrency(currencyContext.baseCurrency)}` }))} 
                                            selectedId={transferForm.toPartyId} 
                                            onSelect={(id) => setTransferForm({...transferForm, toPartyId: id})}
                                            placeholder="ابحث عن الطرف المستلم..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 block uppercase tracking-widest">المبلغ المراد تحويله</label>
                                    <div className="relative">
                                        <input required type="number" step="0.01" value={transferForm.amount} onChange={e => setTransferForm({...transferForm, amount: e.target.value})} className="w-full border-2 border-blue-100 rounded-2xl p-4 font-black text-2xl text-center text-blue-700 focus:border-blue-500 outline-none font-numeric" placeholder="0.00" />
                                        <div className="absolute left-4 top-4 text-xs font-black text-gray-300">{symbolForCurrency(transferForm.currency || currencyContext.baseCurrency)}</div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 block uppercase tracking-widest">تاريخ المناقلة</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-4 text-gray-300" size={20}/>
                                        <input type="date" value={transferForm.date} onChange={e => setTransferForm({...transferForm, date: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-numeric font-bold outline-none" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 block uppercase tracking-widest">البيان / ملاحظة</label>
                                    <input type="text" value={transferForm.note} onChange={e => setTransferForm({...transferForm, note: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-blue-500" placeholder="مثلاً: تسوية حسابات داخلية..." />
                                </div>
                            </div>

                            <div className="p-5 bg-yellow-50 rounded-3xl border-2 border-yellow-100 flex items-start gap-4">
                                <Info className="text-yellow-600 shrink-0" size={24}/>
                                <div className="text-[10px] text-yellow-800 leading-relaxed font-bold">
                                    تأثير محاسبي: سيقوم النظام بإنشاء قيد مزدوج (Double Entry) يخفض حساب المرسل ويزيد حساب المستلم. ستظهر هذه الحركة في كشف حساب الطرفين كـ "مناقلة مالية بين الحسابات".
                                </div>
                            </div>

                            <div className="flex flex-col-reverse md:flex-row md:justify-end gap-3 pt-6 border-t android-sticky-actions">
                                <button type="button" onClick={() => setIsTransferModalOpen(false)} className="w-full md:w-auto px-8 py-3 text-gray-400 font-bold">إلغاء</button>
                                <button type="submit" disabled={isSubmitting || !transferForm.amount || !transferForm.fromPartyId || !transferForm.toPartyId} className="w-full md:w-auto bg-blue-600 text-white px-16 py-4 rounded-[1.5rem] font-black text-lg shadow-xl hover:bg-blue-700 transition transform active:scale-95 disabled:bg-gray-300">
                                    {isSubmitting ? <RefreshCw className="animate-spin" size={24}/> : <CheckCircle2 size={24}/>} 
                                    تأكيد وتنفيذ التحويل
                                </button>
                            </div>
                        </form>
                    </div>
                </AdaptiveModal>
            )}

            {isAddModalOpen && (
                <AdaptiveModal open={true} onClose={() => setIsAddModalOpen(false)} size="lg" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col overflow-hidden border-t-8 border-primary bg-white md:rounded-[3rem]">
                    <div className="flex h-full flex-col">
                        <div className="p-4 md:p-8 bg-gray-900 text-white flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-xl font-black">تسجيل جهة جديدة</h3>
                                <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">Party Registration Engine</p>
                            </div>
                            <button onClick={() => setIsAddModalOpen(false)}><XCircle size={28}/></button>
                        </div>
                        <form onSubmit={handleCreateParty} className="overflow-y-auto bg-white p-4 md:p-10 space-y-6 md:space-y-8 android-scroll-safe">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                <div className="md:col-span-2">
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">الاسم الكامل</label>
                                    <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-black text-lg focus:border-primary outline-none" placeholder="الاسم..." />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">النوع المحاسبي</label>
                                    <select value={form.type} onChange={e => setForm({...form, type: e.target.value as PartyType})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-white">
                                        <option value="CUSTOMER">عميل (Customer)</option>
                                        <option value="SUPPLIER">مورد (Supplier)</option>
                                        <option value="BOTH">عميل ومورد معاً</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">رقم الهاتف</label>
                                    <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold font-numeric focus:border-primary outline-none" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">العنوان / الموقع</label>
                                    <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold focus:border-primary outline-none" />
                                </div>
                            <section className="border-t border-slate-200 pt-6 mt-6 md:col-span-2">
    <h3 className="text-sm font-bold text-slate-400 mb-4">💰 الرصيد الافتتاحي — اختياري</h3>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
            <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">نوع الحساب</label>
            <select
                value={form.openingEntryType}
                onChange={e => setForm({ ...form, openingEntryType: e.target.value as any })}
                className="w-full border-2 border-gray-100 rounded-2xl p-5 text-base font-bold bg-white"
            >
                <option value="">— بدون رصيد افتتاحي —</option>
                <option value="debit">مدين (لنا عنده)</option>
                <option value="credit">دائن (له عندنا)</option>
            </select>
        </div>
        <div>
            <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">المبلغ</label>
            <input
                type="number"
                min="0"
                step="0.01"
                value={form.openingAmount}
                onChange={e => setForm({ ...form, openingAmount: e.target.value })}
                disabled={!form.openingEntryType}
                className="w-full border-2 border-gray-100 rounded-2xl p-5 text-base font-bold font-numeric focus:border-primary outline-none disabled:bg-gray-100"
                placeholder="0.00"
            />
        </div>
        <div>
            <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">العملة</label>
            <select
                value={form.openingCurrency}
                onChange={e => setForm({ ...form, openingCurrency: e.target.value as any })}
                disabled={!form.openingEntryType}
                className="w-full border-2 border-gray-100 rounded-2xl p-5 text-base font-bold bg-white disabled:bg-gray-100"
            >
                <option value="USD">دولار — USD</option>
                <option value="SYP">ليرة سورية — SYP</option>
                <option value="TRY">ليرة تركية — TRY</option>
            </select>
        </div>
    </div>
    {form.openingEntryType && Number(form.openingAmount || 0) > 0 && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
            <p className="text-xs text-amber-700 font-bold">سيُرحّل هذا الرصيد تلقائياً عند حفظ {form.type === 'SUPPLIER' ? 'المورد' : 'العميل'}.</p>
            {openingBalancePreview && (
                <>
                    {openingBalancePreview.hasRate ? (
                        <>
                            <p className="text-[11px] text-amber-700 font-semibold">
                                سعر الصرف المعتمد: 1 {symbolForCurrency(openingBalancePreview.baseCurrency)} = {formatNumber(openingBalancePreview.exchangeRate)} {symbolForCurrency(openingBalancePreview.openingCurrency)}
                            </p>
                            {openingBalancePreview.baseEquivalent !== null && (
                                <p className="text-[11px] text-amber-700 font-semibold">
                                    المعادل بالعملة الأساسية: {formatNumber(openingBalancePreview.baseEquivalent)} {symbolForCurrency(openingBalancePreview.baseCurrency)}
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="text-[11px] text-red-600 font-semibold">
                            تنبيه: لا يوجد سعر صرف صالح لهذه العملة حالياً. سيتم رفض الحفظ من الخادم حتى ضبط السعر من الإعدادات.
                        </p>
                    )}
                </>
            )}
        </div>
    )}
</section>

                            </div>
                            <div className="flex flex-col-reverse md:flex-row md:justify-end gap-3 pt-6 border-t android-sticky-actions">
                                <button type="button" onClick={() => setIsAddModalOpen(false)} className="w-full md:w-auto px-8 py-3 text-gray-500 font-bold">إلغاء</button>
                                <button type="submit" disabled={isSubmitting} className="w-full md:w-auto bg-primary text-white px-16 py-4 rounded-[1.5rem] font-black text-lg shadow-xl hover:bg-teal-800 transition transform active:scale-95 disabled:bg-gray-300">
                                    {isSubmitting ? <RefreshCw className="animate-spin" size={24}/> : <CheckCircle2 size={24}/>} 
                                    تأكيد وحفظ
                                </button>
                            </div>
                        </form>
                    </div>
                </AdaptiveModal>
            )}

            {selectedParty && (
                <PartyProfileModal 
                    party={selectedParty} 
                    openInEditMode={openSelectedPartyInEditMode}
                    canEdit={canEditParties}
                    onClose={() => { setSelectedParty(null); setOpenSelectedPartyInEditMode(false); }} 
                    onPartyUpdated={(nextParty) => setSelectedParty(nextParty)}
                    cashBoxes={cashBoxes}
                    invoices={invoices}
                    vouchers={vouchers}
                    transfers={transfersList}
                    refreshData={async () => { await fetchParties(); await refreshData(); }}
                />
            )}
        </div>
        </ResponsivePage>
    );
};

const PartyProfileModal: React.FC<{ party: Party, openInEditMode?: boolean, canEdit: boolean, onClose: () => void, onPartyUpdated: (party: Party) => void, cashBoxes: CashBox[], invoices: Invoice[], vouchers: Voucher[], transfers: any[], refreshData: () => Promise<void> }> = ({ party, openInEditMode, canEdit, onClose, onPartyUpdated, cashBoxes, invoices, vouchers, transfers, refreshData }) => {
    const layout = useResponsiveLayout();
    const [tab, setTab] = useState<'LEDGER' | 'INVOICES' | 'VOUCHERS'>('LEDGER');
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [partyDetails, setPartyDetails] = useState<Party>(party);
    const [ledgerItems, setLedgerItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [ledgerError, setLedgerError] = useState<string | null>(null);
    const [activeMark, setActiveMark] = useState<ReconciliationMark | null>(null);
    const [filterFromMark, setFilterFromMark] = useState(true);
    const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
    const [perCurrencyTotals, setPerCurrencyTotals] = useState<Record<string, { debit: number; credit: number; balance: number }>>({});
    
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: any } | null>(null);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    // Quick voucher inline state
    const [quickVoucher, setQuickVoucher] = useState<{ open: boolean; type: 'receipt' | 'payment' }>({ open: false, type: 'receipt' });
    const [qvForm, setQvForm] = useState({ amount: '', description: '', cashBoxId: cashBoxes[0]?.id || '', date: new Date().toISOString().split('T')[0], currency: 'USD' });
    const [qvSubmitting, setQvSubmitting] = useState(false);

    const handleQuickVoucher = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!qvForm.amount || !qvForm.description) return;
        setQvSubmitting(true);
        try {
            await apiRequest('vouchers', {
                method: 'POST',
                body: JSON.stringify({
                    id: `v-${Date.now()}`,
                    type: quickVoucher.type,
                    status: 'DRAFT',
                    date: qvForm.date,
                    amount: parseFloat(qvForm.amount),
                    currency: qvForm.currency,
                    cashBoxId: qvForm.cashBoxId,
                    cashBoxName: cashBoxes.find(b => b.id === qvForm.cashBoxId)?.name,
                    clientId: partyDetails.id,
                    clientName: partyDetails.name,
                    description: qvForm.description,
                })
            });
            await refreshData();
            await buildLedger();
            setQuickVoucher({ open: false, type: 'receipt' });
            setQvForm({ amount: '', description: '', cashBoxId: cashBoxes[0]?.id || '', date: new Date().toISOString().split('T')[0], currency: 'USD' });
        } catch (err: any) {
            alert(err?.message || 'فشل إنشاء السند');
        } finally {
            setQvSubmitting(false);
        }
    };

    // Smart Card: open ledger row details on click
    const { open: openSmartCard } = useSmartDrawer();
    const handleRowClick = (item: any) => {
        const docType = String(item.documentType || '').trim();
        const docId = String(item.documentId || '').trim();
        if (docType === 'invoice' && docId) {
            openSmartCard({ type: 'invoice', id: docId, meta: { partyId: partyDetails.id, rowId: item.rowId } });
            return;
        }
        if (docType === 'voucher' && docId) {
            openSmartCard({ type: 'voucher', id: docId, meta: { partyId: partyDetails.id, rowId: item.rowId } });
            return;
        }
        if (docType === 'transaction' && docId) {
            openSmartCard({ type: 'ledgerRow', id: docId, meta: { partyId: partyDetails.id, rowId: item.rowId } });
            return;
        }
        alert('لا يمكن عرض تفاصيل هذه الحركة حالياً.');
    };

const buildLedger = async () => {
    setIsLoading(true);
    setLedgerError(null);
    try {
        const endpoint = partyDetails.type === 'SUPPLIER' ? `suppliers/${partyDetails.id}/statement` : `customers/${partyDetails.id}/statement`;
        const result = await apiRequest(`${endpoint}?currency=${encodeURIComponent(currencyFilter)}`);
        // الـ API يُرجع كائن: { party, lines, totals, currency, perCurrencyTotals }
        const lines = result?.lines;
        if (result?.perCurrencyTotals) setPerCurrencyTotals(result.perCurrencyTotals);
        if (Array.isArray(lines) && lines.length > 0) {
            const mapped = lines.map((r: any, idx: number) => {
                const rowId = r.rowId || r.id || `stmt-${idx}`;
                return {
                    id: rowId,
                    rowId,
                    rowType: r.rowType || 'transaction',
                    documentType: r.documentType || 'transaction',
                    documentId: r.documentId || r.id || '',
                    kind: r.kind,
                    refId: r.refId,
                    date: r.date || new Date().toISOString(),
                    memo: r.description || 'حركة مالية',
                    debit: Number(r.debit || 0),
                    credit: Number(r.credit || 0),
                    runningBalance: Number(r.balance || 0),
                    currencyCode: r.currencyCode || 'USD',
                    invoiceItems: r.invoiceItems || null
                };
            });
            setLedgerItems(mapped);
        } else {
            setLedgerItems([]);
        }
    } catch (e: any) {
        console.error('فشل جلب كشف الحساب:', e);
        setLedgerError('تعذر جلب كشف الحساب. تأكد من الاتصال وحاول مرة أخرى.');
        setLedgerItems([]);
    } finally {
        setIsLoading(false);
    }
};


    useEffect(() => { setPartyDetails(party); }, [party]);
    useEffect(() => {
        if (openInEditMode && canEdit) setIsEditOpen(true);
    }, [openInEditMode, canEdit]);
    useEffect(() => { buildLedger(); }, [partyDetails.id, partyDetails.type, currencyFilter]);

    const handleSetMark = async (item: any) => {
        try {
            await apiRequest('reconciliation-marks', {
                method: 'POST',
                body: JSON.stringify({
                    scopeType: 'PARTY',
                    scopeId: partyDetails.id,
                    reportType: 'PARTY_STATEMENT',
                    markAt: item.date,
                    rowRefId: item.documentId || item.id,
                    note: 'مطابقة يدوية من كشف الحساب'
                })
            });
            await buildLedger();
            setContextMenu(null);
            alert("تم تعيين نقطة المطابقة بنجاح ✅");
        } catch (e) { alert("فشل تعيين المطابقة"); }
    };

    const handleContextMenu = (e: React.MouseEvent, item: any) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    const displayedLedger = useMemo(() => {
        if (!filterFromMark || !activeMark) return ledgerItems;
        return ledgerItems.filter(l => new Date(l.date).getTime() >= new Date(activeMark.markAt).getTime());
    }, [ledgerItems, activeMark, filterFromMark]);

    const [isExporting, setIsExporting] = useState(false);
    const pdfRef = useRef<HTMLDivElement>(null);

    const handleExportPDF = async () => {
        if (displayedLedger.length === 0) return;
        setIsExporting(true);
        try {
            const balance = ledgerItems[ledgerItems.length-1]?.runningBalance || 0;
            const totalDebit = displayedLedger.reduce((s, i) => s + i.debit, 0);
            const totalCredit = displayedLedger.reduce((s, i) => s + i.credit, 0);
            const isCustomer = partyDetails.type === 'CUSTOMER';
            const typeLabel = isCustomer ? 'عميل' : partyDetails.type === 'SUPPLIER' ? 'مورد' : 'عميل / مورد';
            const now = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
            const curLabel = currencyFilter === 'ALL' ? 'جميع العملات' : currencyFilter === 'SYP' ? 'ليرة سورية' : currencyFilter === 'TRY' ? 'ليرة تركية' : 'دولار أمريكي';
            const curSym = (code: string) => code === 'USD' ? '$' : code === 'SYP' ? 'ل.س' : code === 'TRY' ? '₺' : code;

            const html = `
<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:30px;color:#1e293b;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="font-size:22px;font-weight:900;margin:0 0 4px;">كشف حساب - ${partyDetails.name}</h1>
    <p style="font-size:12px;color:#64748b;margin:0;">${typeLabel} | ${curLabel} | تاريخ التصدير: ${now}</p>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:20px;gap:12px;">
    <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:10px;color:#16a34a;font-weight:700;">إجمالي المدين</div>
      <div style="font-size:16px;font-weight:900;color:#15803d;">${formatNumber(totalDebit)}</div>
    </div>
    <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:10px;color:#dc2626;font-weight:700;">إجمالي الدائن</div>
      <div style="font-size:16px;font-weight:900;color:#dc2626;">${formatNumber(totalCredit)}</div>
    </div>
    <div style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:10px;color:#475569;font-weight:700;">الرصيد الصافي</div>
      <div style="font-size:16px;font-weight:900;color:${balance > 0 ? '#15803d' : balance < 0 ? '#dc2626' : '#475569'};">${formatNumber(balance)}</div>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="background:#f1f5f9;">
        <th style="padding:10px 8px;text-align:right;border-bottom:2px solid #cbd5e1;font-weight:800;color:#475569;">التاريخ</th>
        <th style="padding:10px 8px;text-align:right;border-bottom:2px solid #cbd5e1;font-weight:800;color:#475569;">البيان</th>
        <th style="padding:10px 8px;text-align:center;border-bottom:2px solid #cbd5e1;font-weight:800;color:#16a34a;">مدين (+)</th>
        <th style="padding:10px 8px;text-align:center;border-bottom:2px solid #cbd5e1;font-weight:800;color:#dc2626;">دائن (-)</th>
        <th style="padding:10px 8px;text-align:center;border-bottom:2px solid #cbd5e1;font-weight:800;color:#3b82f6;">العملة</th>
        <th style="padding:10px 8px;text-align:center;border-bottom:2px solid #cbd5e1;font-weight:800;color:#1e293b;background:#f1f5f9;">الرصيد</th>
      </tr>
    </thead>
    <tbody>
      ${displayedLedger.map((item, idx) => `
        <tr style="border-bottom:1px solid #f1f5f9;${idx % 2 === 0 ? '' : 'background:#fafafa;'}">
          <td style="padding:8px;font-weight:600;color:#94a3b8;font-size:10px;">${formatDate(item.date, true)}</td>
          <td style="padding:8px;font-weight:700;color:#334155;">${item.memo}</td>
          <td style="padding:8px;text-align:center;font-weight:800;color:#16a34a;">${item.debit > 0 ? formatNumber(item.debit) : '—'}</td>
          <td style="padding:8px;text-align:center;font-weight:800;color:#dc2626;">${item.credit > 0 ? formatNumber(item.credit) : '—'}</td>
          <td style="padding:8px;text-align:center;font-weight:800;color:#3b82f6;font-size:10px;">${curSym(item.currencyCode || 'USD')}</td>
          <td style="padding:8px;text-align:center;font-weight:900;color:${item.runningBalance > 0 ? '#15803d' : item.runningBalance < 0 ? '#dc2626' : '#475569'};background:#f8fafc;">${formatNumber(item.runningBalance)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div style="margin-top:20px;text-align:center;font-size:9px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;">
    العالمية للمحاسبة — كشف حساب مُصدّر آلياً | ${displayedLedger.length} حركة
  </div>
</div>`;

            const container = document.createElement('div');
            container.innerHTML = html;
            document.body.appendChild(container);

            const fileName = `كشف_حساب_${partyDetails.name}_${Date.now()}.pdf`;
            await html2pdf().from(container).set({
                margin: [10, 10, 10, 10],
                filename: fileName,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).save();

            document.body.removeChild(container);
        } catch (e) {
            console.error('PDF export error:', e);
            alert('فشل تصدير PDF');
        } finally {
            setIsExporting(false);
        }
    };

    const handleSavePartyEdits = async (values: Partial<Party>) => {
        const nextName = String(values.name || '').trim();
        const nextType = String(values.type || '').toUpperCase();
        if (!nextName) {
            alert('الاسم مطلوب');
            return;
        }
        if (!['CUSTOMER', 'SUPPLIER', 'BOTH'].includes(nextType)) {
            alert('نوع الطرف مطلوب');
            return;
        }

        const payload: any = {
            name: nextName,
            type: nextType,
            phone: values.phone || '',
            address: values.address || '',
            notes: values.notes || '',
            isActive: values.isActive ?? true,
            accountId: values.accountId ?? null,
            arAccountId: values.arAccountId ?? null,
            apAccountId: values.apAccountId ?? null,
            geoLat: values.geoLat ?? null,
            geoLng: values.geoLng ?? null,
            geoLabel: values.geoLabel ?? null
        };

        try {
            const res = await apiRequest(`parties/${party.id}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
            const updated = (res?.party || { ...party, ...payload }) as Party;
            setPartyDetails(updated);
            onPartyUpdated(updated);
            await refreshData();
            await buildLedger();
            setIsEditOpen(false);
        } catch (e: any) {
            alert(e?.message || e?.response?.data?.error || 'فشل حفظ تعديلات الطرف');
        }
    };

    const balance = ledgerItems[ledgerItems.length-1]?.runningBalance || 0;
    const totalDebit = ledgerItems.reduce((s, i) => s + i.debit, 0);
    const totalCredit = ledgerItems.reduce((s, i) => s + i.credit, 0);
    const isCustomer = partyDetails.type === 'CUSTOMER';
    const semanticBalanceLabel = (bal: number) => {
        if (bal === 0) return 'متوازن';
        if (isCustomer) return bal > 0 ? 'لنا عنده' : 'له عندنا';
        return bal > 0 ? 'لنا عنده' : 'له عندنا';
    };
    const semanticBalanceTone = (bal: number) => {
        if (bal === 0) return 'text-white';
        const positiveGood = isCustomer ? bal > 0 : bal > 0;
        return positiveGood ? 'text-emerald-300' : 'text-red-300';
    };
    const filterCurrencySymbol = currencyFilter === 'SYP' ? 'ل.س' : currencyFilter === 'TRY' ? '₺' : '$';

    return (
        <AdaptiveModal open={true} onClose={onClose} size="xl" zIndex={110} panelClassName="flex h-full max-h-[92vh] flex-col border border-white/60 bg-gradient-to-b from-slate-50 to-white">
            <div className="flex h-full flex-col overflow-hidden" onClick={() => setContextMenu(null)}>
                
                {/* Header */}
                <div className="shrink-0 relative overflow-hidden">
                    <div className={`absolute inset-0 ${isCustomer ? 'bg-gradient-to-l from-blue-600 via-blue-700 to-indigo-800' : 'bg-gradient-to-l from-orange-500 via-orange-600 to-red-700'}`} />
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE4YzMuMyAwIDYgMi43IDYgNnMtMi43IDYtNiA2LTYtMi43LTYtNiAyLjctNiA2LTZ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
                    
                    <div className="relative z-10 px-4 py-4 md:px-6 md:py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20 shrink-0">
                                <Building2 size={28} className="text-white"/>
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-2xl font-black text-white truncate">{partyDetails.name}</h2>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${isCustomer ? 'bg-blue-400/30 text-blue-100 border border-blue-300/30' : 'bg-orange-400/30 text-orange-100 border border-orange-300/30'}`}>
                                        {isCustomer ? 'عميل' : partyDetails.type === 'SUPPLIER' ? 'مورد' : 'عميل / مورد'}
                                    </span>
                                    {partyDetails.phone && (
                                        <span className="text-white/50 text-[10px] font-bold flex items-center gap-1"><Phone size={10}/> {partyDetails.phone}</span>
                                    )}
                                    {activeMark && (
                                        <span className="flex items-center gap-1 text-emerald-300 bg-emerald-400/15 px-2 py-0.5 rounded-lg border border-emerald-400/20 text-[9px] font-black">
                                            <Scale size={11}/> مطابقة: {formatDate(activeMark.markAt, true)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Balance Card */}
                        <div className={`flex items-center gap-2 ${layout.isMobile ? 'w-full' : 'shrink-0'}`}>
                            <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-5 py-3 border border-white/20 text-center shrink-0">
                                <div className="text-white/60 text-[9px] font-black uppercase tracking-widest mb-1">الرصيد الحالي</div>
                                <div className={`text-2xl font-black font-numeric ${semanticBalanceTone(balance)}`} dir="ltr">
                                    {formatDisplayAmount(Math.abs(balance))} <span className="text-sm text-white/40">{filterCurrencySymbol}</span>
                                </div>
                                <div className="text-[9px] text-white/50 font-bold mt-0.5">{semanticBalanceLabel(balance)}</div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className={`flex items-center gap-2 ${layout.isMobile ? 'w-full justify-end' : 'shrink-0'}`}>
                            {canEdit && (
                                <button onClick={() => setIsEditOpen(true)} className="p-2.5 bg-white/10 hover:bg-amber-500 rounded-xl text-white transition-all border border-white/10 hover:border-amber-400" title="تعديل">
                                    <FileText size={16}/>
                                </button>
                            )}
                            <button onClick={onClose} className="p-2.5 bg-white/10 hover:bg-red-500 rounded-xl text-white transition-all border border-white/10 hover:border-red-400" title="إغلاق">
                                <XCircle size={16}/>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stats & Toolbar */}
                <div className="shrink-0 px-4 md:px-5 py-3 bg-white border-b border-gray-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Currency Filter */}
                        <div className="flex items-center bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
                            {['ALL', 'USD', 'SYP', 'TRY'].map(cur => (
                                <button
                                    key={cur}
                                    onClick={() => setCurrencyFilter(cur)}
                                    className={`px-2.5 py-1.5 text-[10px] font-black transition-all ${currencyFilter === cur ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}
                                >
                                    {cur === 'ALL' ? 'الكل' : cur === 'SYP' ? 'ل.س' : cur === 'TRY' ? '₺' : '$'}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl border border-emerald-100">
                            <DollarSign size={13}/>
                            <span className="text-[10px] font-black">مدين</span>
                            <span className="font-numeric font-black text-xs mr-1">{formatDisplayAmount(totalDebit)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1.5 rounded-xl border border-red-100">
                            <DollarSign size={13}/>
                            <span className="text-[10px] font-black">دائن</span>
                            <span className="font-numeric font-black text-xs mr-1">{formatDisplayAmount(totalCredit)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-xl border border-slate-200">
                            <ListTree size={13}/>
                            <span className="text-[10px] font-black">{displayedLedger.length} حركة</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {activeMark && (
                            <button 
                                onClick={() => setFilterFromMark(!filterFromMark)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border ${filterFromMark ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200' : 'bg-white text-gray-500 border-gray-200 hover:border-emerald-300'}`}
                            >
                                {filterFromMark ? <Eye size={13}/> : <EyeOff size={13}/>}
                                {filterFromMark ? 'من آخر مطابقة' : 'الكشف كاملاً'}
                            </button>
                        )}
                        <button 
                            onClick={handleExportPDF}
                            disabled={isExporting || displayedLedger.length === 0}
                            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-4 py-1.5 rounded-xl text-[10px] font-black transition shadow-md"
                        >
                           {isExporting ? <Loader2 size={13} className="animate-spin"/> : <Download size={13}/>} {isExporting ? 'جاري التصدير...' : 'تصدير PDF'}
                        </button>
                        <button onClick={() => { setQuickVoucher({ open: true, type: 'receipt' }); setQvForm(f => ({ ...f, amount: '', description: '' })); }} className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition shadow-md">
                            <ArrowDownLeft size={13}/> سند قبض
                        </button>
                        <button onClick={() => { setQuickVoucher({ open: true, type: 'payment' }); setQvForm(f => ({ ...f, amount: '', description: '' })); }} className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition shadow-md">
                            <ArrowUpRight size={13}/> سند دفع
                        </button>
                    </div>
                </div>

                {/* Quick Voucher Inline Form */}
                {quickVoucher.open && (
                    <div className="shrink-0 px-4 md:px-5 py-3 bg-gray-50 border-b border-gray-200 animate-fadeIn">
                        <form onSubmit={handleQuickVoucher} className="flex flex-col md:flex-row md:items-end gap-3">
                            <div className="text-xs font-black mb-1 flex items-center gap-2">
                                {quickVoucher.type === 'receipt' ? <ArrowDownLeft size={14} className="text-green-600"/> : <ArrowUpRight size={14} className="text-red-600"/>}
                                {quickVoucher.type === 'receipt' ? 'سند قبض سريع' : 'سند دفع سريع'} — {partyDetails.name}
                            </div>
                            <input type="number" step="0.01" required placeholder="المبلغ" value={qvForm.amount} onChange={e => setQvForm({...qvForm, amount: e.target.value})} className={`w-full md:w-32 p-2 border-2 rounded-xl font-black text-center outline-none ${quickVoucher.type === 'receipt' ? 'border-green-200 focus:border-green-500' : 'border-red-200 focus:border-red-500'}`}/>
                            <select value={qvForm.currency} onChange={e => setQvForm({...qvForm, currency: e.target.value})} className="w-full md:w-auto p-2 border-2 border-gray-200 rounded-xl font-black outline-none text-xs">
                                <option value="USD">$ دولار</option>
                                <option value="SYP">ل.س ليرة سورية</option>
                                <option value="TRY">₺ ليرة تركية</option>
                            </select>
                            <input type="text" required placeholder="البيان" value={qvForm.description} onChange={e => setQvForm({...qvForm, description: e.target.value})} className="w-full md:flex-1 min-w-[200px] p-2 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-blue-400"/>
                            <select value={qvForm.cashBoxId} onChange={e => setQvForm({...qvForm, cashBoxId: e.target.value})} className="w-full md:w-auto p-2 border-2 border-gray-200 rounded-xl font-bold outline-none">
                                {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                            <input type="date" value={qvForm.date} onChange={e => setQvForm({...qvForm, date: e.target.value})} className="w-full md:w-auto p-2 border-2 border-gray-200 rounded-xl font-bold outline-none"/>
                            <button type="submit" disabled={qvSubmitting} className={`w-full md:w-auto px-5 py-2 rounded-xl text-white font-black text-xs transition ${quickVoucher.type === 'receipt' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50`}>
                                {qvSubmitting ? 'جاري الحفظ...' : 'حفظ'}
                            </button>
                            <button type="button" onClick={() => setQuickVoucher({ open: false, type: 'receipt' })} className="w-full md:w-auto px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 font-bold text-xs transition">إلغاء</button>
                        </form>
                    </div>
                )}

                {/* Table */}
                <div className="flex-1 overflow-y-auto custom-scrollbar relative" onClick={() => setContextMenu(null)}>
                    {layout.isMobile ? (
                        <div className="p-3">
                            {isLoading ? (
                                <div className="py-10 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <RefreshCw size={24} className="animate-spin text-blue-500"/>
                                        <span className="text-xs font-bold text-gray-400">جاري جلب الحركات...</span>
                                    </div>
                                </div>
                            ) : ledgerError ? (
                                <div className="py-10 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center"><AlertCircle size={24} className="text-red-400"/></div>
                                        <span className="text-xs font-bold text-red-400">{ledgerError}</span>
                                        <button onClick={() => buildLedger()} className="px-4 py-2 bg-blue-600 rounded-xl text-white text-[10px] font-black hover:bg-blue-700 transition">إعادة المحاولة</button>
                                    </div>
                                </div>
                            ) : displayedLedger.length === 0 ? (
                                <div className="py-10 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center"><History size={24} className="text-gray-300"/></div>
                                        <span className="text-xs font-bold text-gray-400">لا توجد حركات مالية مسجلة</span>
                                    </div>
                                </div>
                            ) : (
                                <AdaptiveTable
                                    rows={displayedLedger}
                                    keyExtractor={(row, index) => row.rowId || row.id || `${index}`}
                                    onRowClick={(row) => handleRowClick(row)}
                                    columns={[
                                        { id: 'date', header: 'التاريخ', cell: (row: any) => <span className="font-numeric text-gray-600">{formatDate(row.date, true)}</span> },
                                        { id: 'memo', header: 'البيان', cell: (row: any) => <span className="font-bold text-gray-800">{row.memo}</span> },
                                        { id: 'debit', header: 'مدين', cell: (row: any) => <span className="font-numeric text-emerald-700">{formatDisplayAmount(row.debit || 0)}</span> },
                                        { id: 'credit', header: 'دائن', cell: (row: any) => <span className="font-numeric text-red-600">{formatDisplayAmount(row.credit || 0)}</span> },
                                        { id: 'balance', header: 'الرصيد', cell: (row: any) => <span className="font-numeric font-bold">{formatDisplayAmount(row.runningBalance || 0)}</span> },
                                    ]}
                                    mobileCardRender={(row: any) => (
                                        <div className="space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="font-bold text-gray-800">
                                                        {row.documentType === 'invoice' && row.documentId ? (
                                                            <SmartLink type="invoice" id={row.documentId} meta={{ partyId: partyDetails.id }} inheritStyle>
                                                                {row.memo}
                                                            </SmartLink>
                                                        ) : row.documentType === 'voucher' && row.documentId ? (
                                                            <SmartLink type="voucher" id={row.documentId} meta={{ partyId: partyDetails.id }} inheritStyle>
                                                                {row.memo}
                                                            </SmartLink>
                                                        ) : (
                                                            row.memo
                                                        )}
                                                    </div>
                                                    <div className="mt-1 text-xs text-gray-500 font-numeric">{formatDate(row.date, true)}</div>
                                                </div>
                                                <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${row.currencyCode === 'USD' ? 'bg-green-50 text-green-700 border border-green-100' : row.currencyCode === 'SYP' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                                    {row.currencyCode === 'USD' ? '$' : row.currencyCode === 'SYP' ? 'ل.س' : row.currencyCode === 'TRY' ? '₺' : row.currencyCode}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 text-sm">
                                                <div className="rounded-xl bg-emerald-50 p-3">
                                                    <div className="text-[11px] text-emerald-700">مدين</div>
                                                    <div className="mt-1 font-numeric font-black text-emerald-700">{row.debit > 0 ? formatDisplayAmount(row.debit) : '-'}</div>
                                                </div>
                                                <div className="rounded-xl bg-red-50 p-3">
                                                    <div className="text-[11px] text-red-700">دائن</div>
                                                    <div className="mt-1 font-numeric font-black text-red-700">{row.credit > 0 ? formatDisplayAmount(row.credit) : '-'}</div>
                                                </div>
                                                <div className="rounded-xl bg-gray-50 p-3">
                                                    <div className="text-[11px] text-gray-500">الرصيد</div>
                                                    <div className="mt-1 font-numeric font-black text-gray-800">{formatDisplayAmount(row.runningBalance || 0)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    desktopWrapperClassName="hidden"
                                    mobileContainerClassName="space-y-3"
                                    mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                                />
                            )}
                        </div>
                    ) : (
                        <AdaptiveTable
                            rows={displayedLedger}
                            keyExtractor={(item: any, idx) => item.rowId || item.id || `${idx}`}
                            loading={isLoading}
                            loadingState={
                                <div className="py-24 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <RefreshCw size={24} className="animate-spin text-blue-500"/>
                                        <span className="text-xs font-bold text-gray-400">جاري جلب الحركات...</span>
                                    </div>
                                </div>
                            }
                            emptyState={ledgerError ? (
                                <div className="py-24 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center"><AlertCircle size={24} className="text-red-400"/></div>
                                        <span className="text-xs font-bold text-red-400">{ledgerError}</span>
                                        <button onClick={() => buildLedger()} className="px-4 py-2 bg-blue-600 rounded-xl text-white text-[10px] font-black hover:bg-blue-700 transition">إعادة المحاولة</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="py-24 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center"><History size={24} className="text-gray-300"/></div>
                                        <span className="text-xs font-bold text-gray-400">لا توجد حركات مالية مسجلة</span>
                                    </div>
                                </div>
                            )}
                            onRowClick={(item: any) => handleRowClick(item)}
                            onRowContextMenu={(event, item: any) => !layout.isMobile && handleContextMenu(event, item)}
                            tabletColumnVisibility={['date', 'memo', 'debit', 'credit', 'runningBalance']}
                            columns={[
                                {
                                    id: 'date',
                                    header: 'التاريخ',
                                    cell: (item: any) => {
                                        const isMarkedRow = activeMark && item.documentId === activeMark.rowRefId;
                                        return (
                                            <div className="flex items-center gap-1.5">
                                                {isMarkedRow && <Scale size={12} className="text-emerald-500 shrink-0"/>}
                                                <span className="font-numeric text-[11px] font-bold text-slate-400">{formatDate(item.date, true)}</span>
                                            </div>
                                        );
                                    },
                                },
                                {
                                    id: 'memo',
                                    header: 'البيان',
                                    cell: (item: any) => {
                                        const isMarkedRow = activeMark && item.documentId === activeMark.rowRefId;
                                        return (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-700 text-[11px]">
                                                        {item.documentType === 'invoice' && item.documentId ? (
                                                            <SmartLink type="invoice" id={item.documentId} meta={{ partyId: partyDetails.id }} inheritStyle>
                                                                {item.memo}
                                                            </SmartLink>
                                                        ) : item.documentType === 'voucher' && item.documentId ? (
                                                            <SmartLink type="voucher" id={item.documentId} meta={{ partyId: partyDetails.id }} inheritStyle>
                                                                {item.memo}
                                                            </SmartLink>
                                                        ) : item.memo}
                                                    </span>
                                                    {item.invoiceItems && item.invoiceItems.length > 0 ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedRows(prev => { const next = new Set(prev); next.has(item.rowId) ? next.delete(item.rowId) : next.add(item.rowId); return next; }); }}
                                                            className="text-[8px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md hover:bg-blue-100 transition border border-blue-100 shrink-0"
                                                            title="عرض تفاصيل الأصناف"
                                                        >
                                                            {item.invoiceItems.length} صنف {expandedRows.has(item.rowId) ? '▲' : '▼'}
                                                        </button>
                                                    ) : null}
                                                    {isMarkedRow ? <span className="text-[7px] font-black bg-emerald-500 text-white px-1.5 py-0.5 rounded-md uppercase shrink-0">مطابقة</span> : null}
                                                </div>
                                                {expandedRows.has(item.rowId) && item.invoiceItems ? (
                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-[10px] rounded-lg bg-blue-50/30 p-2">
                                                        {item.invoiceItems.map((it: any, i: number) => (
                                                            <div key={i} className="bg-white rounded-lg px-2.5 py-1.5 border border-blue-100 flex items-center justify-between gap-2">
                                                                <span className="font-bold text-slate-700 truncate">{it.name}</span>
                                                                <span className="font-black text-blue-600 shrink-0">{it.qty} × {formatDisplayAmount(it.price)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    },
                                },
                                {
                                    id: 'debit',
                                    header: 'مدين (+)',
                                    cell: (item: any) => item.debit > 0 ? <span className="font-black font-numeric text-emerald-600 text-[11px] bg-emerald-50 px-2 py-0.5 rounded-lg">{formatDisplayAmount(item.debit)}</span> : <span className="text-gray-200">—</span>,
                                    tdClassName: 'text-center',
                                },
                                {
                                    id: 'credit',
                                    header: 'دائن (-)',
                                    cell: (item: any) => item.credit > 0 ? <span className="font-black font-numeric text-red-500 text-[11px] bg-red-50 px-2 py-0.5 rounded-lg">{formatDisplayAmount(item.credit)}</span> : <span className="text-gray-200">—</span>,
                                    tdClassName: 'text-center',
                                },
                                {
                                    id: 'currencyCode',
                                    header: 'العملة',
                                    cell: (item: any) => (
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${item.currencyCode === 'USD' ? 'bg-green-50 text-green-700 border border-green-100' : item.currencyCode === 'SYP' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                            {item.currencyCode === 'USD' ? '$' : item.currencyCode === 'SYP' ? 'ل.س' : item.currencyCode === 'TRY' ? '₺' : item.currencyCode}
                                        </span>
                                    ),
                                    tdClassName: 'text-center',
                                },
                                {
                                    id: 'runningBalance',
                                    header: 'الرصيد',
                                    cell: (item: any) => <span className={`font-black font-numeric text-[12px] ${item.runningBalance > 0 ? 'text-emerald-700' : item.runningBalance < 0 ? 'text-red-600' : 'text-slate-500'}`}>{formatDisplayAmount(item.runningBalance)}</span>,
                                    tdClassName: 'text-center bg-slate-50/80',
                                },
                            ]}
                            rowClassName={(item: any, idx) => {
                                const isMarkedRow = activeMark && item.documentId === activeMark.rowRefId;
                                const isLast = idx === displayedLedger.length - 1;
                                return `border-b border-gray-50 hover:bg-blue-50/40 transition-colors cursor-pointer group ${isMarkedRow ? 'bg-emerald-50/60 !border-r-[3px] border-r-emerald-500' : ''} ${isLast ? 'bg-slate-50/50' : ''}`;
                            }}
                        />
                    )}

                    {!layout.isMobile && contextMenu && (
                        <div 
                            className="fixed z-[200] bg-white shadow-2xl rounded-2xl border border-gray-100 py-1.5 w-52 animate-fadeIn"
                            style={{ top: contextMenu.y, left: contextMenu.x }}
                        >
                            <button 
                                onClick={() => handleSetMark(contextMenu.item)}
                                className="w-full text-right px-4 py-2.5 hover:bg-emerald-50 hover:text-emerald-600 flex items-center gap-2.5 font-bold text-[11px] transition"
                            >
                                <Scale size={14}/> تعيين كمطابقة وتدقيق
                            </button>
                            <button 
                                className="w-full text-right px-4 py-2.5 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2.5 font-bold text-[11px] transition"
                                onClick={() => alert('تفاصيل الحركة: ' + contextMenu.item.memo)}
                            >
                                <Info size={14}/> عرض تفاصيل الحركة
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="shrink-0 px-4 md:px-5 py-3 bg-white border-t border-gray-100 flex flex-col md:flex-row md:justify-between md:items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[9px] text-gray-400 font-bold">
                        <Info size={12} className="text-blue-400"/> كليك يمين على أي سطر = نقطة مطابقة
                    </span>
                    <button onClick={onClose} className="w-full md:w-auto px-8 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-black text-xs transition">
                        إغلاق
                    </button>
                </div>
            </div>
            {isEditOpen && (
                <PartyEditModal
                    party={partyDetails}
                    onClose={() => setIsEditOpen(false)}
                    onSave={handleSavePartyEdits}
                />
            )}
        </AdaptiveModal>
    );
};

const PartyEditModal: React.FC<{
    party: Party;
    onClose: () => void;
    onSave: (values: Partial<Party>) => Promise<void> | void;
}> = ({ party, onClose, onSave }) => {
    const [form, setForm] = useState<Partial<Party>>({
        name: party.name || '',
        phone: party.phone || '',
        address: party.address || '',
        notes: party.notes || '',
        type: party.type || 'CUSTOMER',
        isActive: party.isActive ?? true,
        accountId: party.accountId ?? null,
        arAccountId: party.arAccountId ?? '',
        apAccountId: party.apAccountId ?? '',
        geoLat: party.geoLat ?? undefined,
        geoLng: party.geoLng ?? undefined,
        geoLabel: party.geoLabel ?? ''
    });
    const [isSaving, setIsSaving] = useState(false);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(form);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AdaptiveModal open={true} onClose={onClose} size="lg" zIndex={130} panelClassName="flex h-full max-h-[92vh] flex-col">
            <form onSubmit={save} className="flex h-full flex-col overflow-hidden rounded-3xl bg-white">
                <div className="p-4 md:p-6 border-b flex justify-between items-center bg-gray-50">
                    <h3 className="text-xl font-black">تعديل بيانات الطرف</h3>
                    <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><XCircle size={22} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input required value={String(form.name || '')} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} className="border rounded-xl p-3 font-bold" placeholder="الاسم" />
                    <input value={String(form.phone || '')} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} className="border rounded-xl p-3 font-bold" placeholder="الهاتف" />
                    <input value={String(form.address || '')} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} className="border rounded-xl p-3 font-bold md:col-span-2" placeholder="العنوان" />
                    <textarea value={String(form.notes || '')} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} className="border rounded-xl p-3 font-bold md:col-span-2" rows={3} placeholder="ملاحظات" />
                    <select value={String(form.type || 'CUSTOMER')} onChange={e => setForm(prev => ({ ...prev, type: e.target.value as PartyType }))} className="border rounded-xl p-3 font-bold">
                        <option value="CUSTOMER">CUSTOMER</option>
                        <option value="SUPPLIER">SUPPLIER</option>
                        <option value="BOTH">BOTH</option>
                    </select>
                    <label className="flex items-center gap-2 border rounded-xl p-3 font-bold">
                        <input type="checkbox" checked={!!form.isActive} onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))} />
                        تفعيل
                    </label>
                    <input value={String(form.accountId ?? '')} onChange={e => setForm(prev => ({ ...prev, accountId: e.target.value === '' ? null : Number(e.target.value) }))} className="border rounded-xl p-3 font-bold" placeholder="account_id" />
                    <input value={String(form.arAccountId ?? '')} onChange={e => setForm(prev => ({ ...prev, arAccountId: e.target.value }))} className="border rounded-xl p-3 font-bold" placeholder="ar_account_id" />
                    <input value={String(form.apAccountId ?? '')} onChange={e => setForm(prev => ({ ...prev, apAccountId: e.target.value }))} className="border rounded-xl p-3 font-bold" placeholder="ap_account_id" />
                    <input value={String(form.geoLat ?? '')} onChange={e => setForm(prev => ({ ...prev, geoLat: e.target.value === '' ? undefined : Number(e.target.value) }))} className="border rounded-xl p-3 font-bold" placeholder="geo_lat" />
                    <input value={String(form.geoLng ?? '')} onChange={e => setForm(prev => ({ ...prev, geoLng: e.target.value === '' ? undefined : Number(e.target.value) }))} className="border rounded-xl p-3 font-bold" placeholder="geo_lng" />
                    <input value={String(form.geoLabel ?? '')} onChange={e => setForm(prev => ({ ...prev, geoLabel: e.target.value }))} className="border rounded-xl p-3 font-bold md:col-span-2" placeholder="geo_label" />
                </div>
                <div className="p-4 md:p-6 border-t flex flex-col-reverse md:flex-row md:justify-end gap-3">
                    <button type="button" onClick={onClose} className="w-full md:w-auto px-6 py-2 rounded-xl bg-gray-200 font-bold">إلغاء</button>
                    <button type="submit" disabled={isSaving} className="w-full md:w-auto px-8 py-2 rounded-xl bg-primary text-white font-black disabled:opacity-50">
                        {isSaving ? 'جاري الحفظ...' : 'حفظ'}
                    </button>
                </div>
            </form>
        </AdaptiveModal>
    );
};

export default CustomersSuppliers;
