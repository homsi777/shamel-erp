import React, { useMemo, useState } from 'react';
import { X, Phone, DollarSign, FileText, Wallet, ArrowDownLeft, ArrowUpRight, User, Receipt, Printer } from 'lucide-react';
import { Client, Invoice, Voucher, CashBox, formatDate, formatNumber } from '../../types';
import { apiRequest } from '../../lib/api';
import { AdaptiveModal, AdaptiveTable } from '../responsive';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

interface Props {
    client: Client;
    onClose: () => void;
    invoices: Invoice[];
    vouchers: Voucher[];
    cashBoxes: CashBox[];
    onAddPayment: (amount: number, boxId: string) => Promise<void>;
    isSubmitting: boolean;
}

type StatementLine = {
    date: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    currencyCode?: string;
};

const formatDisplayAmount = (value: unknown) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0';
    const abs = Math.abs(numeric);
    const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : 3;
    const formatted = formatNumber(numeric, decimals);
    if (!formatted.includes('.')) return formatted;
    return formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const CustomerDetailsModal: React.FC<Props> = ({ client, onClose, invoices, vouchers, cashBoxes, onAddPayment, isSubmitting }) => {
    const layout = useResponsiveLayout();
    const [activeTab, setActiveTab] = useState<'invoices' | 'statement' | 'payment'>('invoices');
    const [paymentAmount, setPaymentAmount] = useState('');
    const [selectedBoxId, setSelectedBoxId] = useState(cashBoxes[0]?.id || '');

    const [fromDate, setFromDate] = useState(() => new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().slice(0, 10));
    const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [statementLines, setStatementLines] = useState<StatementLine[]>([]);
    const [statementTotals, setStatementTotals] = useState({ debit: 0, credit: 0, balance: 0, currency: 'SYP' });
    const [statementLoading, setStatementLoading] = useState(false);
    const [statementError, setStatementError] = useState<string | null>(null);
    const [hasStatement, setHasStatement] = useState(false);

    const clientInvoices = useMemo(() => (
        invoices
            .filter(inv => inv.clientId === client.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    ), [invoices, client.id]);

    const clientVouchers = useMemo(() => (
        vouchers
            .filter(v => v.clientId === client.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    ), [vouchers, client.id]);

    const getBalanceInfo = () => {
        const bal = client.balance || 0;
        const color = bal > 0 ? 'text-green-600' : bal < 0 ? 'text-red-600' : 'text-gray-400';
        if (client.type === 'CUSTOMER') {
            return { val: bal, color, label: bal > 0 ? 'عليه (ذمة)' : (bal < 0 ? 'له (رصيد)' : 'صافي') };
        }
        return { val: bal, color, label: bal > 0 ? 'له (دين علينا)' : (bal < 0 ? 'لنا (مرتجع)' : 'صافي') };
    };
    const balInfo = getBalanceInfo();

    const handleSubmitPayment = (e: React.FormEvent) => {
        e.preventDefault();
        onAddPayment(Number(paymentAmount), selectedBoxId).then(() => {
            setPaymentAmount('');
            setActiveTab('statement');
        });
    };

    const fetchStatement = async () => {
        try {
            setStatementLoading(true);
            setStatementError(null);
            const isSupplier = client.type === 'SUPPLIER';
            const endpoint = isSupplier
                ? `suppliers/${client.id}/statement`
                : `customers/${client.id}/statement`;
            const url = `${endpoint}?from=${fromDate}&to=${toDate}`;
            const response = await apiRequest(url);
            const lines = Array.isArray(response?.lines) ? response.lines : Array.isArray(response) ? response : [];
            const totals = response?.totals || {};

            if (lines.length === 0) {
                setHasStatement(false);
                setStatementLines([]);
                setStatementTotals({ debit: 0, credit: 0, balance: 0, currency: response?.currency || 'SYP' });
                return;
            }

            setHasStatement(true);
            setStatementLines(lines.map((l: any) => ({
                date: l.date || l.entryDate || l.entry_date || '',
                description: l.description || l.desc || l.reference || '',
                debit: Number(l.debit || 0),
                credit: Number(l.credit || 0),
                balance: Number(l.balance || 0),
                currencyCode: l.currencyCode || l.currency || response?.currency || 'SYP'
            })));

            setStatementTotals({
                debit: Number(totals.debit || totals.totalDebit || 0),
                credit: Number(totals.credit || totals.totalCredit || 0),
                balance: Number(totals.balance || 0),
                currency: response?.currency || 'SYP'
            });
        } catch (e: any) {
            setStatementError(e?.message || 'تعذر جلب كشف الحساب.');
            setHasStatement(false);
            setStatementLines([]);
            setStatementTotals({ debit: 0, credit: 0, balance: 0, currency: 'SYP' });
        } finally {
            setStatementLoading(false);
        }
    };

    const legacyStatement = useMemo(() => {
        const isSupplier = client.type === 'SUPPLIER';
        const ledger: { date: string; description: string; debit: number; credit: number; }[] = [];

        clientInvoices.forEach(inv => {
            const isSale = inv.type === 'sale';
            const isPurchase = inv.type === 'purchase';
            const isReturn = inv.type === 'return' || inv.type === 'exchange';
            const returnType = String((inv as any).returnType || '').toLowerCase();
            const isPurchaseReturn = isReturn && returnType === 'purchase';

            const debit = isSupplier
                ? (isPurchase ? inv.totalAmount : 0)
                : (isSale ? inv.totalAmount : 0);
            const credit = isReturn
                ? inv.totalAmount
                : 0;

            const label = isSale
                ? 'فاتورة مبيعات'
                : isPurchase
                ? 'فاتورة مشتريات'
                : (isPurchaseReturn ? 'مرتجع مشتريات' : 'مرتجع مبيعات');

            ledger.push({
                date: inv.date,
                description: `${label} - ${inv.invoiceNumber}`,
                debit,
                credit
            });
        });

        clientVouchers.forEach(v => {
            const isReceipt = v.type === 'receipt';
            const debit = isSupplier
                ? (isReceipt ? Number(v.amount || 0) : 0)
                : (v.type === 'payment' ? Number(v.amount || 0) : 0);
            const credit = isSupplier
                ? (v.type === 'payment' ? Number(v.amount || 0) : 0)
                : (isReceipt ? Number(v.amount || 0) : 0);
            ledger.push({
                date: v.date,
                description: `${isReceipt ? 'سند قبض' : 'سند دفع'} - ${v.referenceNumber || v.id}`,
                debit,
                credit
            });
        });

        ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let running = 0;
        const rows: StatementLine[] = [];
        ledger.forEach(item => {
            running += (Number(item.debit || 0) - Number(item.credit || 0));
            rows.push({
                date: item.date,
                description: item.description,
                debit: Number(item.debit || 0),
                credit: Number(item.credit || 0),
                balance: running,
                currencyCode: 'SYP'
            });
        });
        return rows;
    }, [client.type, clientInvoices, clientVouchers]);

    const legacyTotals = useMemo(() => {
        const debit = legacyStatement.reduce((s, r) => s + Number(r.debit || 0), 0);
        const credit = legacyStatement.reduce((s, r) => s + Number(r.credit || 0), 0);
        const balance = legacyStatement.length ? legacyStatement[legacyStatement.length - 1].balance : 0;
        return { debit, credit, balance, currency: 'SYP' };
    }, [legacyStatement]);

    const renderStatementTable = (rows: StatementLine[]) => (
        rows.length === 0 ? (
            <div className="text-center py-16 text-gray-400 flex flex-col items-center">
                <Wallet size={48} className="mb-4 opacity-20"/>
                <p>لا توجد حركات مالية مسجلة</p>
            </div>
        ) : (
            <AdaptiveTable
                rows={rows}
                keyExtractor={(row, idx) => `${row.date}-${idx}`}
                columns={[
                    {
                        id: 'date',
                        header: 'التاريخ',
                        cell: (row) => <span className="font-numeric text-gray-600">{formatDate(row.date)}</span>,
                    },
                    {
                        id: 'desc',
                        header: 'البيان',
                        cell: (row) => <span className="text-gray-700">{row.description || '-'}</span>,
                    },
                    {
                        id: 'debit',
                        header: 'مدين',
                        cell: (row) => <span className="font-bold font-numeric text-green-600">{row.debit ? formatDisplayAmount(row.debit) : ''}</span>,
                        tdClassName: 'text-center',
                    },
                    {
                        id: 'credit',
                        header: 'دائن',
                        cell: (row) => <span className="font-bold font-numeric text-red-600">{row.credit ? formatDisplayAmount(row.credit) : ''}</span>,
                        tdClassName: 'text-center',
                    },
                    {
                        id: 'balance',
                        header: 'الرصيد',
                        cell: (row) => <span className="font-bold font-numeric text-gray-700">{formatDisplayAmount(row.balance)}</span>,
                        tdClassName: 'text-center',
                    },
                ]}
                mobileCardRender={(row) => (
                    <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-bold text-gray-800">{row.description || '-'}</div>
                            <div className="text-xs text-gray-500 font-numeric">{formatDate(row.date)}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded-xl bg-emerald-50 p-2 text-center">
                                <div className="text-[10px] text-emerald-700">مدين</div>
                                <div className="mt-1 font-numeric font-bold text-emerald-700">{row.debit ? formatDisplayAmount(row.debit) : '-'}</div>
                            </div>
                            <div className="rounded-xl bg-red-50 p-2 text-center">
                                <div className="text-[10px] text-red-700">دائن</div>
                                <div className="mt-1 font-numeric font-bold text-red-700">{row.credit ? formatDisplayAmount(row.credit) : '-'}</div>
                            </div>
                            <div className="rounded-xl bg-gray-100 p-2 text-center">
                                <div className="text-[10px] text-gray-600">الرصيد</div>
                                <div className="mt-1 font-numeric font-bold text-gray-800">{formatDisplayAmount(row.balance)}</div>
                            </div>
                        </div>
                    </div>
                )}
                desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-200 bg-white"
                mobileContainerClassName="space-y-3"
                mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            />
        )
    );

    return (
        <AdaptiveModal open={!!client} onClose={onClose} size="xl" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
                <div className="shrink-0 bg-gray-900 text-white">
                    <div className="flex flex-col gap-4 p-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex gap-4 items-center">
                            <div className={`p-3 rounded-full ${client.type === 'CUSTOMER' ? 'bg-blue-600' : 'bg-orange-600'}`}>
                                <User size={28} className="text-white" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold md:text-2xl">{client.name}</h2>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-300">
                                    <span className="flex items-center gap-1 bg-gray-800 px-2 py-0.5 rounded-md"><Phone size={14}/> {client.phone || '---'}</span>
                                    <span className="bg-gray-700 px-2 py-0.5 rounded-md">{client.type === 'CUSTOMER' ? 'عميل' : 'مورد'}</span>
                                </div>
                            </div>
                        </div>
                        <div className={`flex items-center gap-3 ${layout.isMobile ? 'justify-between' : 'justify-end'}`}>
                            <div className="rounded-2xl bg-white/10 px-4 py-2">
                                <div className="text-xs text-gray-300 mb-1">الرصيد الحالي</div>
                                <div className={`text-2xl font-bold font-numeric ${balInfo.val === 0 ? 'text-gray-300' : balInfo.val > 0 ? 'text-green-400' : 'text-red-400'}`} dir="ltr">
                                    {formatDisplayAmount(Math.abs(balInfo.val))} $
                                </div>
                                <div className="text-[10px] text-gray-400 mt-1">{balInfo.label}</div>
                            </div>
                            <button onClick={onClose} className="p-2 bg-white/10 rounded-full hover:bg-red-500 hover:text-white transition"><X size={20}/></button>
                        </div>
                    </div>
                </div>

                <div className="flex border-b bg-gray-50 px-6 pt-4 gap-2 shrink-0 overflow-x-auto">
                    <button onClick={() => setActiveTab('invoices')} className={`px-6 py-3 rounded-t-xl font-bold text-sm flex items-center gap-2 transition ${activeTab === 'invoices' ? 'bg-white text-primary border-t-4 border-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                        <FileText size={18}/> سجل الفواتير
                    </button>
                    <button onClick={() => { setActiveTab('statement'); fetchStatement(); }} className={`px-6 py-3 rounded-t-xl font-bold text-sm flex items-center gap-2 transition ${activeTab === 'statement' ? 'bg-white text-primary border-t-4 border-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                        <Wallet size={18}/> كشف الحساب
                    </button>
                    <button onClick={() => setActiveTab('payment')} className={`px-6 py-3 rounded-t-xl font-bold text-sm flex items-center gap-2 transition ${activeTab === 'payment' ? 'bg-green-50 text-green-700 border-t-4 border-green-600 shadow-sm' : 'text-gray-500 hover:text-green-600'}`}>
                        <DollarSign size={18}/> تسجيل دفعة جديدة
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50">
                    {activeTab === 'invoices' && (
                        <div className="space-y-4 animate-fadeIn">
                            {clientInvoices.length === 0 ? (
                                <div className="text-center py-20 text-gray-400 flex flex-col items-center">
                                    <FileText size={48} className="mb-4 opacity-20"/>
                                    <p>لا توجد فواتير مسجلة لهذا الحساب</p>
                                </div>
                            ) : (
                                <AdaptiveTable
                                    rows={clientInvoices}
                                    keyExtractor={(inv) => inv.id}
                                    columns={[
                                        {
                                            id: 'number',
                                            header: 'رقم الفاتورة',
                                            cell: (inv) => <span className="font-mono font-bold text-blue-700">{inv.originalInvoiceNumber || inv.invoiceNumber || inv.id.slice(-6)}</span>,
                                        },
                                        {
                                            id: 'date',
                                            header: 'التاريخ',
                                            cell: (inv) => <span className="font-numeric text-gray-600">{formatDate(inv.date)}</span>,
                                        },
                                        {
                                            id: 'type',
                                            header: 'النوع',
                                            cell: (inv) => (
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${inv.type === 'sale' ? 'bg-green-100 text-green-700' : inv.type === 'purchase' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700'}`}>
                                                    {inv.type === 'sale' ? 'بيع' : inv.type === 'purchase' ? 'شراء' : 'مرتجع'}
                                                </span>
                                            ),
                                            tdClassName: 'text-center',
                                        },
                                        {
                                            id: 'total',
                                            header: 'القيمة',
                                            cell: (inv) => <span className="font-bold font-numeric">{formatDisplayAmount(inv.totalAmount)}</span>,
                                            tdClassName: 'text-center',
                                        },
                                        {
                                            id: 'paid',
                                            header: 'المدفوع',
                                            cell: (inv) => <span className="text-green-600 font-numeric">{formatDisplayAmount(inv.paidAmount)}</span>,
                                            tdClassName: 'text-center',
                                        },
                                        {
                                            id: 'remaining',
                                            header: 'المتبقي',
                                            cell: (inv) => <span className="text-red-600 font-bold font-numeric">{formatDisplayAmount(inv.remainingAmount)}</span>,
                                            tdClassName: 'text-center',
                                        },
                                    ]}
                                    mobileCardRender={(inv) => (
                                        <div className="space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="font-bold text-gray-900">{inv.originalInvoiceNumber || inv.invoiceNumber || inv.id.slice(-6)}</div>
                                                    <div className="mt-1 text-xs text-gray-500 font-numeric">{formatDate(inv.date)}</div>
                                                </div>
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${inv.type === 'sale' ? 'bg-green-100 text-green-700' : inv.type === 'purchase' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700'}`}>
                                                    {inv.type === 'sale' ? 'بيع' : inv.type === 'purchase' ? 'شراء' : 'مرتجع'}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 text-xs">
                                                <div className="rounded-xl bg-gray-100 p-2 text-center">
                                                    <div className="text-[10px] text-gray-600">القيمة</div>
                                                    <div className="mt-1 font-numeric font-bold text-gray-800">{formatDisplayAmount(inv.totalAmount)}</div>
                                                </div>
                                                <div className="rounded-xl bg-emerald-50 p-2 text-center">
                                                    <div className="text-[10px] text-emerald-700">المدفوع</div>
                                                    <div className="mt-1 font-numeric font-bold text-emerald-700">{formatDisplayAmount(inv.paidAmount)}</div>
                                                </div>
                                                <div className="rounded-xl bg-red-50 p-2 text-center">
                                                    <div className="text-[10px] text-red-700">المتبقي</div>
                                                    <div className="mt-1 font-numeric font-bold text-red-700">{formatDisplayAmount(inv.remainingAmount)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-200 bg-white"
                                    mobileContainerClassName="space-y-3"
                                    mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'statement' && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col lg:flex-row gap-3 items-center justify-between">
                                <div className="flex flex-wrap gap-2 items-center">
                                    <div>
                                        <label className="text-xs text-gray-400">من تاريخ</label>
                                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400">إلى تاريخ</label>
                                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm" />
                                    </div>
                                    <button onClick={fetchStatement} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold">عرض</button>
                                </div>
                                <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-bold flex items-center gap-2">
                                    <Printer size={16}/> طباعة
                                </button>
                            </div>

                            {statementLoading && (
                                <div className="text-center py-10 text-gray-400 font-bold">جاري تحميل كشف الحساب...</div>
                            )}
                            {statementError && (
                                <div className="text-center py-6 text-red-500 font-bold">{statementError}</div>
                            )}

                            {!statementLoading && !statementError && (
                                <>
                                    {hasStatement ? renderStatementTable(statementLines) : renderStatementTable(legacyStatement)}

                                    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center justify-between text-sm font-bold">
                                        <span>إجمالي المدين: {formatDisplayAmount(hasStatement ? statementTotals.debit : legacyTotals.debit)}</span>
                                        <span>إجمالي الدائن: {formatDisplayAmount(hasStatement ? statementTotals.credit : legacyTotals.credit)}</span>
                                        <span>الرصيد: {formatDisplayAmount(hasStatement ? statementTotals.balance : legacyTotals.balance)} {hasStatement ? statementTotals.currency : legacyTotals.currency}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {activeTab === 'payment' && (
                        <div className="flex justify-center items-center h-full animate-fadeIn">
                            <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100 max-w-md w-full">
                                <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2 border-b pb-4">
                                    <DollarSign className="text-green-600" size={24}/>
                                    {client.type === 'CUSTOMER' ? 'تسجيل مقبوضات (من العميل)' : 'تسجيل مدفوعات (للمورد)'}
                                </h3>
                                <form onSubmit={handleSubmitPayment} className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-600 mb-2">قيمة الدفعة ($)</label>
                                        <div className="relative">
                                            <input autoFocus type="number" required min="0.1" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="w-full pl-4 pr-12 py-3 border-2 border-green-100 rounded-xl focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none font-bold text-xl font-numeric text-green-800" placeholder="0.00" />
                                            <div className="absolute right-4 top-3.5 text-green-600 font-bold">$</div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-600 mb-2">الصندوق</label>
                                        <select value={selectedBoxId} onChange={e => setSelectedBoxId(e.target.value)} className="w-full p-3 border rounded-xl bg-gray-50 focus:bg-white transition">
                                            {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name} (رصيد: {formatDisplayAmount(b.balance)})</option>)}
                                        </select>
                                    </div>
                                    <button type="submit" disabled={isSubmitting} className={`w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2 ${client.type === 'CUSTOMER' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                                        {isSubmitting ? 'جاري المعالجة...' : <><Receipt size={20}/> تأكيد وتسجيل</>}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </AdaptiveModal>
    );
};

export default CustomerDetailsModal;
