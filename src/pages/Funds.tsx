import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useModalEscape } from '../hooks/useEscapeKey';
import { 
  Landmark, Wallet, ArrowUpRight, ArrowDownLeft, History, 
  CreditCard, ShieldCheck, Banknote, Calendar, User, FileText, RefreshCw, Layers,
  Filter, Search, Edit3, Trash2, XCircle, CheckCircle2, MoreVertical, ArrowRightLeft
} from 'lucide-react';
import { CashBox, Voucher, Client, formatDate, Invoice, AppSettings, DEFAULT_CURRENCY_RATES } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import AccountPicker from '../components/AccountPicker';
import { useAccounts } from '../hooks/useAccounts';
import { SmartLink } from '../components/smart';
import { AdaptiveModal, AdaptiveTable } from '../components/responsive';

interface FundsProps {
  cashBoxes: CashBox[];
  setCashBoxes: React.Dispatch<React.SetStateAction<CashBox[]>>;
  vouchers: Voucher[];
  setVouchers: React.Dispatch<React.SetStateAction<Voucher[]>>;
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  invoices: Invoice[];
  settings: AppSettings;
  refreshData?: () => Promise<void>;
}

const Funds: React.FC<FundsProps> = ({ cashBoxes, setCashBoxes, vouchers, setVouchers, clients, setClients, invoices, settings, refreshData }) => {
  const toMoneyNumber = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const formatFundsAmount = (value: unknown): string =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(toMoneyNumber(value));

  const [activeView, setActiveView] = useState<'boxes' | 'ledger'>('boxes');
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBoxModalOpen, setIsBoxModalOpen] = useState(false);
  const [editingBox, setEditingBox] = useState<CashBox | null>(null);
  const [voucherType, setVoucherType] = useState<'receipt' | 'payment'>('receipt');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { accounts } = useAccounts();
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'receipt' | 'payment'>('all');
  
    const today = new Date().toISOString().split('T')[0];
    const defaultCur = settings?.defaultCurrency || 'USD';
    const [voucherForm, setVoucherForm] = useState({ date: today, amount: '', cashBoxId: cashBoxes[0]?.id || '', clientId: '', category: '', description: '', referenceNumber: '', currency: defaultCur });
  const [boxForm, setBoxForm] = useState({ id: '', name: '', type: 'sub' as 'main' | 'sub', openingBalance: '', currency: 'USD', accountId: '' as number | '' });
  const cashBoxCurrencies = ['USD', 'SYP', 'TRY'];
  const [transferForm, setTransferForm] = useState({ fromBoxId: '', toBoxId: '', amount: '', notes: '' });
  const isVoucherEditable = (voucher: Voucher | null | undefined) => String(voucher?.status || 'DRAFT').toUpperCase() === 'DRAFT';

  // ESC key closes modals
  useModalEscape(isVoucherModalOpen, useCallback(() => setIsVoucherModalOpen(false), []));
  useModalEscape(isTransferModalOpen, useCallback(() => setIsTransferModalOpen(false), []));
  useModalEscape(isBoxModalOpen, useCallback(() => setIsBoxModalOpen(false), []));

  // Calculations
    const totalLiquidity = cashBoxes.reduce((sum, box) => sum + toMoneyNumber(box.balance), 0);
    const totalReceipts = vouchers.filter(v => v.type === 'receipt').reduce((sum, v) => sum + toMoneyNumber(v.amount), 0);
    const totalPayments = vouchers.filter(v => v.type === 'payment').reduce((sum, v) => sum + toMoneyNumber(v.amount), 0);
    const currencyRates = settings.currencyRates || DEFAULT_CURRENCY_RATES;
    const currencyOptions = ['USD', ...Object.keys(currencyRates)].filter((v, i, arr) => arr.indexOf(v) === i);
    const previewRate = voucherForm.currency === 'USD' ? 1 : Number(currencyRates[voucherForm.currency] || 1);
    const previewBase = voucherForm.amount ? (Number(voucherForm.amount) / (previewRate || 1)) : 0;

  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
        const matchSearch = (v.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                            (v.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (v.category || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchType = filterType === 'all' || v.type === filterType;
        return matchSearch && matchType;
    });
  }, [vouchers, searchTerm, filterType]);

  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const isoDate = (() => {
        const raw = String(voucherForm.date || '').trim();
        if (!raw) return new Date().toISOString();
        const d = new Date(`${raw}T12:00:00`);
        return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
    })();
    const amount = Number(voucherForm.amount);
    const rate = voucherForm.currency === 'USD' ? 1 : Number(currencyRates[voucherForm.currency] || 1);
    const amountBase = voucherForm.currency === 'USD' ? amount : (rate ? amount / rate : amount);
    const box = cashBoxes.find(b => b.id === voucherForm.cashBoxId);
    let refNum = voucherForm.referenceNumber;
    if (!refNum && !editingVoucher) {
        try {
            const res = await apiRequest('next-number/voucher');
            refNum = res.number;
        } catch {
            refNum = String(Date.now()).slice(-7);
        }
    }
    const payload = { id: editingVoucher ? editingVoucher.id : `v-${Date.now()}`, type: voucherType, status: 'DRAFT', date: isoDate, amount: amountBase, originalAmount: amount, currency: voucherForm.currency, exchangeRate: rate, cashBoxId: voucherForm.cashBoxId, cashBoxName: box?.name, clientId: voucherForm.clientId || null, clientName: voucherForm.clientId ? clients.find(c => c.id === voucherForm.clientId)?.name : null, category: voucherForm.category, description: voucherForm.description, referenceNumber: refNum };
    try {
        if (editingVoucher) await apiRequest(`vouchers/${editingVoucher.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await apiRequest('vouchers', { method: 'POST', body: JSON.stringify(payload) });
        const [uv, ub, uc] = await Promise.all([apiRequest('vouchers'), apiRequest('cash-boxes'), apiRequest('clients')]);
        setVouchers(uv); setCashBoxes(ub); setClients(uc);
        await refreshData?.();
        setIsVoucherModalOpen(false); setEditingVoucher(null); setVoucherForm({ date: today, amount: '', cashBoxId: '', clientId: '', category: '', description: '', referenceNumber: '', currency: 'USD' });
    } catch (e: any) { alert(e.response?.data?.error || "فشل حفظ السند"); } finally { setIsSubmitting(false); }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(transferForm.amount);
    if (!transferForm.fromBoxId || !transferForm.toBoxId) { alert("يرجى اختيار الصندوقين"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { alert("يرجى إدخال مبلغ صحيح أكبر من صفر"); return; }
    if (transferForm.fromBoxId === transferForm.toBoxId) { alert("لا يمكن المناقلة لنفس الصندوق"); return; }
    setIsSubmitting(true);
    try {
        await apiRequest('funds/transfer', { method: 'POST', body: JSON.stringify({ ...transferForm, amount }) });
        const [uv, ub] = await Promise.all([apiRequest('vouchers'), apiRequest('cash-boxes')]);
        setVouchers(uv); setCashBoxes(ub);
        setIsTransferModalOpen(false); setTransferForm({ fromBoxId: '', toBoxId: '', amount: '', notes: '' });
        alert("تمت المناقلة بنجاح ✅");
    } catch (e: any) { alert(e.response?.data?.error || "فشلت المناقلة"); } finally { setIsSubmitting(false); }
  };

  const handleDeleteVoucher = async (id: string) => {
    if (!(await confirmDialog('حذف هذا السند سيؤدي إلى استرجاع المبلغ للصندوق أو العميل. هل أنت متأكد؟'))) return;
    try {
        await apiRequest(`vouchers/${id}`, { method: 'DELETE' });
        const [uv, ub, uc] = await Promise.all([apiRequest('vouchers'), apiRequest('cash-boxes'), apiRequest('clients')]);
        setVouchers(uv); setCashBoxes(ub); setClients(uc);
    } catch (e) { alert("فشل الحذف"); }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shamel_voucher_edit_prefill');
      if (!raw) return;
      const payload = JSON.parse(raw);
      const voucherId = String(payload?.id || '');
      if (!voucherId) return;
      const voucher = vouchers.find(v => v.id === voucherId);
      if (!voucher) return;
      localStorage.removeItem('shamel_voucher_edit_prefill');
      if (!isVoucherEditable(voucher)) {
        alert('لا يمكن تعديل سند مرحّل. استخدم عكس/إلغاء حسب الصلاحيات.');
        return;
      }
      setActiveView('ledger');
      setEditingVoucher(voucher);
      setVoucherType(voucher.type as 'receipt' | 'payment');
      setVoucherForm({
        date: voucher.date ? new Date(voucher.date).toISOString().split('T')[0] : today,
        amount: String(voucher.originalAmount ?? voucher.amount ?? ''),
        cashBoxId: voucher.cashBoxId || '',
        clientId: voucher.clientId || '',
        category: voucher.category || '',
        description: voucher.description || '',
        referenceNumber: voucher.referenceNumber || '',
        currency: (voucher.currency || 'USD') as 'USD' | 'SYP' | 'TRY'
      });
      setIsVoucherModalOpen(true);
    } catch {}
  }, [vouchers, today]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shamel_voucher_view_prefill');
      if (!raw) return;
      localStorage.removeItem('shamel_voucher_view_prefill');
      setActiveView('ledger');
    } catch {}
  }, []);

    const handleOpenBoxModal = (box?: CashBox) => {
    if (box) {
      setEditingBox(box);
      setBoxForm({ id: box.id, name: box.name, type: box.type || 'sub', openingBalance: '', currency: box.currency || 'USD', accountId: box.accountId ? Number(box.accountId) : '' });
    } else {
      setEditingBox(null);
      setBoxForm({ id: '', name: '', type: 'sub', openingBalance: '', currency: 'USD', accountId: '' });
    }
    setIsBoxModalOpen(true);
  };

  const handleSaveCashBox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boxForm.name || (!editingBox && !boxForm.openingBalance)) return;

    setIsSubmitting(true);
    try {
      if (editingBox) {
        const payload = { name: boxForm.name, currency: boxForm.currency, accountId: boxForm.accountId ? Number(boxForm.accountId) : null };
        await apiRequest(`cash-boxes/${editingBox.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const payload = {
          id: `box-${Date.now()}`,
          name: boxForm.name,
          type: boxForm.type,
          balance: Number(boxForm.openingBalance),
          currency: boxForm.currency || 'USD',
          accountId: boxForm.accountId ? Number(boxForm.accountId) : null
        };
        await apiRequest('cash-boxes', { method: 'POST', body: JSON.stringify(payload) });
      }

      const updatedBoxes = await apiRequest('cash-boxes');
      setCashBoxes(updatedBoxes);

      setIsBoxModalOpen(false);
      setEditingBox(null);
      setBoxForm({ id: '', name: '', type: 'sub', openingBalance: '', currency: 'USD', accountId: '' });
      alert(editingBox ? "تم حفظ التعديلات بنجاح ✅" : "تم حفظ الصندوق بنجاح ✅");
    } catch (err: any) {
      alert(err.response?.data?.error || (editingBox ? "فشل حفظ التعديلات" : "فشل حفظ الصندوق"));
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-6">
            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                <Landmark className="text-primary" size={32} /> الإدارة المالية
            </h2>
            <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
                <button onClick={() => setActiveView('boxes')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'boxes' ? 'bg-white shadow text-primary' : 'text-gray-500'}`}>الصناديق</button>
                <button onClick={() => setActiveView('ledger')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'ledger' ? 'bg-white shadow text-primary' : 'text-gray-500'}`}>سجل السندات</button>
            </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          <button onClick={() => handleOpenBoxModal()} className="bg-white text-gray-700 border border-gray-300 px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-50 transition shadow-sm">
            <Wallet size={18} /> صندوق جديد
          </button>
          <button onClick={() => setIsTransferModalOpen(true)} className="bg-white text-blue-600 border border-blue-200 px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 hover:bg-blue-50 transition shadow-sm">
            <ArrowRightLeft size={18} /> مناقلة مالية
          </button>
          <button onClick={() => { setVoucherType('payment'); setEditingVoucher(null); setVoucherForm({ date: today, amount: '', cashBoxId: cashBoxes[0]?.id || '', clientId: '', category: '', description: '', referenceNumber: '', currency: 'USD' }); setIsVoucherModalOpen(true); }} className="bg-red-600 text-white px-5 py-2.5 rounded-2xl font-black flex items-center gap-2 hover:bg-red-700 transition shadow-lg transform active:scale-95">
            <ArrowUpRight size={18} /> سند دفع
          </button>
          <button onClick={() => { setVoucherType('receipt'); setEditingVoucher(null); setVoucherForm({ date: today, amount: '', cashBoxId: cashBoxes[0]?.id || '', clientId: '', category: '', description: '', referenceNumber: '', currency: 'USD' }); setIsVoucherModalOpen(true); }} className="bg-green-600 text-white px-5 py-2.5 rounded-2xl font-black flex items-center gap-2 hover:bg-green-700 transition shadow-lg transform active:scale-95">
            <ArrowDownLeft size={18} /> سند قبض
          </button>
        </div>
      </div>

      {activeView === 'boxes' && (
          <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-gray-900 text-white p-6 rounded-[2.5rem] shadow-xl relative overflow-hidden group">
                  <div className="absolute -right-10 -top-10 w-40 h-40 bg-primary/20 rounded-full blur-3xl group-hover:scale-150 transition-transform"></div>
                  <p className="text-gray-400 text-xs font-black uppercase tracking-widest mb-1">السيولة الكلية</p>
                  <h3 className="text-3xl md:text-4xl font-black font-numeric text-primary leading-none break-words">{formatFundsAmount(totalLiquidity)} $</h3>
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] font-bold text-gray-500"><CheckCircle2 size={12}/> تدقيق مالي حي</div>
                </div>
                <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                   <div className="flex justify-between items-start">
                       <div><p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">المقبوضات</p><h3 className="text-2xl font-black font-numeric text-green-600 leading-none break-words">{formatFundsAmount(totalReceipts)} $</h3></div>
                       <div className="bg-green-50 p-3 rounded-2xl text-green-600"><Banknote size={24}/></div>
                   </div>
                </div>
                <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                   <div className="flex justify-between items-start">
                       <div><p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">المدفوعات</p><h3 className="text-2xl font-black font-numeric text-red-600 leading-none break-words">{formatFundsAmount(totalPayments)} $</h3></div>
                       <div className="bg-red-50 p-3 rounded-2xl text-red-600"><CreditCard size={24}/></div>
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cashBoxes.map(box => (
                  <div key={box.id} className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-6 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all group">
                    <div className="flex justify-between items-center mb-6">
                      <div className={`p-3 rounded-2xl ${box.type === 'main' ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-600'}`}><Wallet size={24} /></div>
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-tighter ${box.type === 'main' ? 'bg-primary text-white shadow-lg' : 'bg-orange-50 text-orange-600'}`}>{box.type === 'main' ? 'صندوق رئيسي' : 'نثرية'}</span>
                    </div>
                    <h4 className="font-black text-gray-800 text-lg mb-1 group-hover:text-primary transition-colors"><SmartLink type="cashBox" id={box.id}>{box.name}</SmartLink></h4>
                    <button onClick={() => handleOpenBoxModal(box)} className="mt-2 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full hover:bg-blue-600 hover:text-white transition">تعديل البيانات</button>
                    <div className="text-3xl font-black text-gray-900 font-numeric tracking-tighter leading-none break-words">{formatFundsAmount(box.balance)} $</div>
                  </div>
                ))}
              </div>
          </div>
      )}

      {activeView === 'ledger' && (
          <div className="bg-white rounded-[2.5rem] shadow-xl overflow-hidden border border-gray-100 animate-fadeIn flex flex-col">
              <div className="p-8 bg-gray-50 border-b flex flex-col md:flex-row justify-between items-center gap-6">
                  <div>
                      <h3 className="text-xl font-black text-gray-900 flex items-center gap-3"><History className="text-primary" size={28}/> سجل السندات المالي (Ledger)</h3>
                      <p className="text-xs text-gray-500 mt-1">تتبع كافة العمليات المالية المصنفة</p>
                  </div>
                  <div className="flex flex-1 max-w-2xl gap-3 w-full">
                      <div className="relative flex-1">
                          <Search className="absolute right-3 top-3 text-gray-400" size={18}/>
                          <input type="text" placeholder="بحث..." className="w-full pr-10 pl-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-primary outline-none font-bold text-sm bg-white" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                      </div>
                  </div>
              </div>
              <div className="p-4 md:p-6">
                <AdaptiveTable
                  rows={filteredVouchers}
                  keyExtractor={(v) => v.id}
                  columns={[
                    {
                      id: 'date',
                      header: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e',
                      cell: (v) => <div className="font-bold text-gray-800 text-sm">{formatDate(v.date)}</div>,
                    },
                    {
                      id: 'type',
                      header: '\u0627\u0644\u0646\u0648\u0639',
                      cell: (v) => (
                        <SmartLink type="voucher" id={v.id} inheritStyle tooltip="\u0627\u0646\u0642\u0631 \u0644\u0639\u0631\u0636 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0633\u0646\u062f">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-tighter ${v.type === 'receipt' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            {v.type === 'receipt' ? '\u0642\u0628\u0636' : '\u062f\u0641\u0639'}
                          </span>
                        </SmartLink>
                      ),
                      tdClassName: 'text-center',
                    },
                    {
                      id: 'amount',
                      header: '\u0627\u0644\u0645\u0628\u0644\u063a',
                      cell: (v) => (
                        <div>
                          <SmartLink type="voucher" id={v.id} inheritStyle tooltip="\u0627\u0646\u0642\u0631 \u0644\u0639\u0631\u0636 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0633\u0646\u062f">
                            <div className={`text-xl font-black font-numeric ${v.type === 'receipt' ? 'text-green-600' : 'text-red-600'}`}>
                              {formatFundsAmount(v.originalAmount ?? v.amount)} {v.currency || 'USD'}
                            </div>
                          </SmartLink>
                          {v.currency && v.currency !== 'USD' && (
                            <div className="text-[10px] text-gray-400">\u064a\u0639\u0627\u062f\u0644: {formatFundsAmount(v.amount)} USD</div>
                          )}
                        </div>
                      ),
                    },
                    {
                      id: 'box',
                      header: '\u0627\u0644\u0635\u0646\u062f\u0648\u0642',
                      cell: (v) => (
                        <span className="text-xs font-bold text-gray-600 bg-white border border-gray-200 px-3 py-1 rounded-lg">
                          <SmartLink type="cashBox" id={v.cashBoxId || ''}>{v.cashBoxName}</SmartLink>
                        </span>
                      ),
                    },
                    {
                      id: 'party',
                      header: '\u0627\u0644\u0648\u0635\u0641',
                      cell: (v) => (
                        <div className="font-bold text-gray-700">
                          {v.clientId ? (
                            <SmartLink type="party" id={v.clientId}>{v.clientName || '---'}</SmartLink>
                          ) : (v.clientName || '---')}
                          <div className="text-[10px] text-gray-400 font-normal">{v.description}</div>
                        </div>
                      ),
                    },
                    {
                      id: 'actions',
                      header: '\u0627\u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a',
                      cell: (v) => (
                        <div className="flex justify-center gap-1.5">
                          <button
                            onClick={() => {
                              if (!isVoucherEditable(v)) {
                                alert('\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0639\u062f\u064a\u0644 \u0633\u0646\u062f \u0645\u0631\u062d\u0651\u0644. \u0627\u0633\u062a\u062e\u062f\u0645 \u0639\u0643\u0633/\u0625\u0644\u063a\u0627\u0621 \u062d\u0633\u0628 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a.');
                                return;
                              }
                              setEditingVoucher(v);
                              setVoucherType(v.type as 'receipt' | 'payment');
                              setVoucherForm({
                                date: v.date ? new Date(v.date).toISOString().split('T')[0] : today,
                                amount: String(v.originalAmount ?? v.amount ?? ''),
                                cashBoxId: v.cashBoxId || '',
                                clientId: v.clientId || '',
                                category: v.category || '',
                                description: v.description || '',
                                referenceNumber: v.referenceNumber || '',
                                currency: (v.currency || 'USD') as 'USD' | 'SYP' | 'TRY'
                              });
                              setIsVoucherModalOpen(true);
                            }}
                            className={`p-2 rounded-xl transition shadow-sm border ${
                              isVoucherEditable(v)
                                ? 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border-blue-100'
                                : 'bg-gray-100 text-gray-400 border-gray-200'
                            }`}
                            title={isVoucherEditable(v) ? '\u062a\u0639\u062f\u064a\u0644' : '\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0639\u062f\u064a\u0644 \u0633\u0646\u062f \u0645\u0631\u062d\u0651\u0644'}
                          >
                            <Edit3 size={16}/>
                          </button>
                          <button onClick={() => handleDeleteVoucher(v.id)} className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition shadow-sm border border-red-100" title="\u062d\u0630\u0641"><Trash2 size={16}/></button>
                        </div>
                      ),
                      tdClassName: 'text-center',
                    },
                  ]}
                  mobileCardRender={(v) => (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-gray-900">{formatDate(v.date)}</div>
                          <div className="mt-1 text-xs text-gray-500">{v.description || '-'}</div>
                        </div>
                        <span className={`px-2 py-1 rounded text-[10px] font-black ${v.type === 'receipt' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {v.type === 'receipt' ? '\u0642\u0628\u0636' : '\u062f\u0641\u0639'}
                        </span>
                      </div>
                      <div className="rounded-2xl bg-gray-50 p-3">
                        <div className={`text-lg font-black font-numeric ${v.type === 'receipt' ? 'text-green-600' : 'text-red-600'}`}>
                          {formatFundsAmount(v.originalAmount ?? v.amount)} {v.currency || 'USD'}
                        </div>
                        {v.currency && v.currency !== 'USD' && (
                          <div className="text-[10px] text-gray-400">\u064a\u0639\u0627\u062f\u0644: {formatFundsAmount(v.amount)} USD</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="rounded-full bg-white border border-gray-200 px-3 py-1 font-bold text-gray-600">
                          <SmartLink type="cashBox" id={v.cashBoxId || ''}>{v.cashBoxName}</SmartLink>
                        </span>
                        <span className="rounded-full bg-gray-100 px-3 py-1 font-bold text-gray-600">
                          {v.clientName || '---'}
                        </span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            if (!isVoucherEditable(v)) {
                              alert('\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0639\u062f\u064a\u0644 \u0633\u0646\u062f \u0645\u0631\u062d\u0651\u0644. \u0627\u0633\u062a\u062e\u062f\u0645 \u0639\u0643\u0633/\u0625\u0644\u063a\u0627\u0621 \u062d\u0633\u0628 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a.');
                              return;
                            }
                            setEditingVoucher(v);
                            setVoucherType(v.type as 'receipt' | 'payment');
                            setVoucherForm({
                              date: v.date ? new Date(v.date).toISOString().split('T')[0] : today,
                              amount: String(v.originalAmount ?? v.amount ?? ''),
                              cashBoxId: v.cashBoxId || '',
                              clientId: v.clientId || '',
                              category: v.category || '',
                              description: v.description || '',
                              referenceNumber: v.referenceNumber || '',
                              currency: (v.currency || 'USD') as 'USD' | 'SYP' | 'TRY'
                            });
                            setIsVoucherModalOpen(true);
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                            isVoucherEditable(v)
                              ? 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          \u062a\u0639\u062f\u064a\u0644
                        </button>
                        <button onClick={() => handleDeleteVoucher(v.id)} className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition">
                          \u062d\u0630\u0641
                        </button>
                      </div>
                    </div>
                  )}
                  desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-100"
                  mobileContainerClassName="space-y-3"
                  mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              />
              </div>

                </div>
      )}

      {/* MODAL: TRANSFER */}
      {isTransferModalOpen && (
        <AdaptiveModal open={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} size="md" zIndex={500} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>

            {/* ─── Header ─── */}
            <div className="relative overflow-hidden shrink-0 bg-gradient-to-l from-blue-500 via-blue-600 to-indigo-700">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_50%,white_0%,transparent_70%)]" />
              <div className="relative z-10 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <ArrowRightLeft size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white leading-tight">مناقلة بين الصناديق</h3>
                    <p className="text-[9px] text-white/60 font-bold mt-0.5 tracking-wide">INTER-FUND TRANSFER</p>
                  </div>
                </div>
                <button onClick={() => setIsTransferModalOpen(false)} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 flex items-center justify-center transition">
                  <XCircle size={18} className="text-white" />
                </button>
              </div>
            </div>

            {/* ─── Form ─── */}
            <form onSubmit={handleTransfer} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="px-5 py-4 space-y-3.5">

                {/* From → To */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-red-400 block uppercase mb-1">من الصندوق</label>
                    <select required value={transferForm.fromBoxId} onChange={e => setTransferForm({...transferForm, fromBoxId: e.target.value})} className="w-full py-2.5 px-3 bg-red-50/50 border border-red-200 rounded-xl font-bold text-xs text-red-800 focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none appearance-none transition">
                      <option value="">اختر المصدر...</option>
                      {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name} ({formatFundsAmount(b.balance)}$)</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-emerald-500 block uppercase mb-1">إلى الصندوق</label>
                    <select required value={transferForm.toBoxId} onChange={e => setTransferForm({...transferForm, toBoxId: e.target.value})} className="w-full py-2.5 px-3 bg-emerald-50/50 border border-emerald-200 rounded-xl font-bold text-xs text-emerald-800 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none appearance-none transition">
                      <option value="">اختر الهدف...</option>
                      {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name} ({formatFundsAmount(b.balance)}$)</option>)}
                    </select>
                  </div>
                </div>

                {/* Amount */}
                <div className="rounded-2xl px-4 py-3.5 border-2 bg-blue-50/50 border-blue-100">
                  <label className="text-[10px] font-black text-gray-400 block uppercase mb-1.5">المبلغ</label>
                  <input
                    required type="number" step="0.01"
                    value={transferForm.amount}
                    onChange={e => setTransferForm({...transferForm, amount: e.target.value})}
                    className="w-full bg-transparent border-none outline-none font-black text-2xl text-center text-blue-700 placeholder:text-gray-300"
                    placeholder="0.00"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">ملاحظات <span className="text-gray-300 normal-case">(اختياري)</span></label>
                  <textarea
                    rows={2}
                    value={transferForm.notes}
                    onChange={e => setTransferForm({...transferForm, notes: e.target.value})}
                    className="w-full py-2.5 px-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none transition"
                    placeholder="مثلاً: تحويل مبيعات اليوم..."
                  />
                </div>
              </div>

              {/* ─── Footer ─── */}
              <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-6 py-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl font-bold text-sm transition">
                  إلغاء
                </button>
                <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-10 py-3 text-white font-black rounded-2xl shadow-lg bg-gradient-to-l from-blue-500 to-indigo-600 hover:shadow-blue-200 transition transform active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none">
                  {isSubmitting ? <RefreshCw className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>}
                  تأكيد النقل
                </button>
              </div>
            </form>
          </div>
        </AdaptiveModal>
      )}

      {/* --- VOUCHER MODAL (RECEIPT / PAYMENT) --- */}
      {isVoucherModalOpen && (
        <AdaptiveModal open={isVoucherModalOpen} onClose={() => setIsVoucherModalOpen(false)} size="md" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>

            {/* ─── Colored Header Strip ─── */}
            <div className={`relative overflow-hidden shrink-0 ${voucherType === 'receipt' ? 'bg-gradient-to-l from-emerald-500 via-emerald-600 to-teal-700' : 'bg-gradient-to-l from-rose-500 via-red-600 to-pink-700'}`}>
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_50%,white_0%,transparent_70%)]" />
              <div className="relative z-10 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    {voucherType === 'receipt' ? <ArrowDownLeft size={20} className="text-white" /> : <ArrowUpRight size={20} className="text-white" />}
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white leading-tight">
                      {editingVoucher ? 'تعديل السند' : (voucherType === 'receipt' ? 'سند قبض جديد' : 'سند دفع جديد')}
                    </h3>
                    <p className="text-[9px] text-white/60 font-bold mt-0.5 tracking-wide">
                      {voucherType === 'receipt' ? 'RECEIPT VOUCHER' : 'PAYMENT VOUCHER'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setIsVoucherModalOpen(false)} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 flex items-center justify-center transition">
                  <XCircle size={18} className="text-white" />
                </button>
              </div>
            </div>

            {/* ─── Form Body ─── */}
            <form onSubmit={handleSaveVoucher} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="px-5 py-4 space-y-3.5">

                {/* Amount — Hero Section */}
                <div className={`rounded-2xl px-4 py-3.5 border-2 ${voucherType === 'receipt' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100'}`}>
                  <label className="text-[10px] font-black text-gray-400 block uppercase mb-1.5">المبلغ</label>
                  <div className="flex items-center gap-2">
                    <input
                      required
                      type="number"
                      step="0.01"
                      value={voucherForm.amount}
                      onChange={e => setVoucherForm({ ...voucherForm, amount: e.target.value })}
                      className={`min-w-0 flex-1 bg-transparent border-none outline-none font-black text-2xl text-center placeholder:text-gray-300 ${voucherType === 'receipt' ? 'text-emerald-700' : 'text-rose-700'}`}
                      placeholder="0.00"
                    />
                    <select
                      value={voucherForm.currency}
                      onChange={e => setVoucherForm({ ...voucherForm, currency: e.target.value as 'USD' | 'SYP' | 'TRY' })}
                      className={`shrink-0 w-[72px] text-center font-black text-xs rounded-lg py-2 border-0 outline-none cursor-pointer ${voucherType === 'receipt' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
                    >
                      {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {voucherForm.currency !== 'USD' && (
                    <p className="text-[10px] text-gray-400 mt-1 text-center">
                      يعادل: <span className="font-black">{formatFundsAmount(previewBase)}</span> USD بسعر {previewRate}
                    </p>
                  )}
                </div>

                {/* Date + Cash Box */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">التاريخ</label>
                    <div className="relative">
                      <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" size={14} />
                      <input
                        required type="date"
                        value={voucherForm.date}
                        onChange={e => setVoucherForm({ ...voucherForm, date: e.target.value })}
                        className="w-full py-2.5 px-3 pr-8 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">الصندوق</label>
                    <div className="relative">
                      <Wallet className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" size={14} />
                      <select
                        required
                        value={voucherForm.cashBoxId}
                        onChange={e => setVoucherForm({ ...voucherForm, cashBoxId: e.target.value })}
                        className="w-full py-2.5 px-3 pr-8 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none appearance-none transition"
                      >
                        <option value="">اختر...</option>
                        {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Party */}
                <div>
                  <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">الجهة <span className="text-gray-300 normal-case">(اختياري)</span></label>
                  <div className="relative">
                    <User className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" size={14} />
                    <select
                      value={voucherForm.clientId}
                      onChange={e => setVoucherForm({ ...voucherForm, clientId: e.target.value })}
                      className="w-full py-2.5 px-3 pr-8 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none appearance-none transition"
                    >
                      <option value="">بدون جهة</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.type === 'CUSTOMER' ? 'عميل' : c.type === 'SUPPLIER' ? 'مورد' : 'عميل+مورد'})
                        </option>
                      ))}
                    </select>
                  </div>
                  {voucherForm.clientId && (() => {
                    const party = clients.find(c => c.id === voucherForm.clientId);
                    if (!party) return null;
                    const bal = Number(party.balance || 0);
                    return (
                      <div className={`inline-flex items-center gap-1.5 text-[10px] font-black px-2.5 py-0.5 rounded-lg mt-1 ${bal > 0 ? 'text-red-600 bg-red-50' : bal < 0 ? 'text-emerald-600 bg-emerald-50' : 'text-gray-500 bg-gray-100'}`}>
                        <Banknote size={11} />
                        الرصيد: {Math.abs(bal).toLocaleString()} {bal > 0 ? '(مدين)' : bal < 0 ? '(دائن)' : '(صفر)'}
                      </div>
                    );
                  })()}
                </div>

                {/* Note + Reference */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">ملاحظة <span className="text-gray-300 normal-case">(اختياري)</span></label>
                    <div className="relative">
                      <Layers className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" size={14} />
                      <input
                        type="text"
                        value={voucherForm.category}
                        onChange={e => setVoucherForm({ ...voucherForm, category: e.target.value })}
                        className="w-full py-2.5 px-3 pr-8 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition"
                        placeholder="مصروفات، تسوية..."
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">رقم مرجعي <span className="text-gray-300 normal-case">(اختياري)</span></label>
                    <div className="relative">
                      <FileText className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" size={14} />
                      <input
                        type="text"
                        value={voucherForm.referenceNumber}
                        onChange={e => setVoucherForm({ ...voucherForm, referenceNumber: e.target.value })}
                        className="w-full py-2.5 px-3 pr-8 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition"
                        placeholder="فاتورة/طلب/إيصال..."
                      />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-[10px] font-black text-gray-400 block uppercase mb-1">البيان</label>
                  <textarea
                    rows={2}
                    required
                    value={voucherForm.description}
                    onChange={e => setVoucherForm({ ...voucherForm, description: e.target.value })}
                    className="w-full py-2.5 px-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none transition"
                    placeholder="أدخل وصف السند..."
                  />
                </div>
              </div>

              {/* ─── Footer Actions ─── */}
              <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setIsVoucherModalOpen(false)}
                  className="px-6 py-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl font-bold text-sm transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex items-center gap-2 px-10 py-3 text-white font-black rounded-2xl shadow-lg transition transform active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none ${
                    voucherType === 'receipt'
                      ? 'bg-gradient-to-l from-emerald-500 to-teal-600 hover:shadow-emerald-200'
                      : 'bg-gradient-to-l from-rose-500 to-red-600 hover:shadow-rose-200'
                  }`}
                >
                  {isSubmitting ? (
                    <RefreshCw className="animate-spin" size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  {editingVoucher ? 'حفظ التعديلات' : 'حفظ وتسجيل'}
                </button>
              </div>
            </form>
          </div>
        </AdaptiveModal>
      )}

      {isBoxModalOpen && (
        <AdaptiveModal open={isBoxModalOpen} onClose={() => setIsBoxModalOpen(false)} size="md" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 border-t-8 border-primary">
            <h3 className="text-2xl font-black text-gray-800 mb-6 flex items-center gap-3"><Wallet className="text-primary" /> {editingBox ? 'تعديل بيانات الصندوق' : 'إضافة صندوق جديد'}</h3>
            <form onSubmit={handleSaveCashBox} className="space-y-6">
              <div><label className="block text-xs font-black text-gray-400 mb-2 uppercase">اسم الصندوق</label><input required type="text" value={boxForm.name} onChange={e => setBoxForm({...boxForm, name: e.target.value})} className="w-full p-4 border-2 border-gray-100 rounded-2xl font-bold focus:border-primary outline-none" /></div>
              <div><label className="block text-xs font-black text-gray-400 mb-2 uppercase">العملة</label><select value={boxForm.currency} onChange={e => setBoxForm({...boxForm, currency: e.target.value})} className="w-full p-4 border-2 border-gray-100 rounded-2xl font-bold bg-white focus:border-primary outline-none">{cashBoxCurrencies.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              {!editingBox && (
              <div><label className="block text-xs font-black text-gray-400 mb-2 uppercase">الرصيد الافتتاحي ($)</label><input required type="number" min="0" value={boxForm.openingBalance} onChange={e => setBoxForm({...boxForm, openingBalance: e.target.value})} className="w-full p-4 border-2 border-gray-100 rounded-2xl font-black text-2xl font-numeric focus:border-primary outline-none" /></div>
            )}
              <div className="flex justify-end gap-3 pt-6"><button type="button" onClick={() => setIsBoxModalOpen(false)} className="px-6 py-2 text-gray-400 font-bold">إلغاء</button><button type="submit" disabled={isSubmitting} className="bg-primary text-white px-10 py-3 rounded-xl font-black shadow-lg">{editingBox ? "حفظ التعديلات" : "حفظ الصندوق"}</button></div>
            </form>
          </div>
        </AdaptiveModal>
      )}
    </div>
  );
};

export default Funds;

