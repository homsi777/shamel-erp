
import React, { useState, useMemo } from 'react';
import { 
  Handshake, Plus, ArrowUpRight, ArrowDownLeft, PieChart, 
  Briefcase, FileText, RefreshCw
} from 'lucide-react';
// Updated import to use InventoryItem
import { Partner, PartnerTransaction, CashBox, Voucher, Invoice, InventoryItem, Client, formatDate, toNumericValue } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import { SmartLink } from '../components/smart';

interface PartnersProps {
  partners: Partner[];
  setPartners: React.Dispatch<React.SetStateAction<Partner[]>>;
  partnerTransactions: PartnerTransaction[];
  setPartnerTransactions?: React.Dispatch<React.SetStateAction<PartnerTransaction[]>>; // Optional to avoid removing from type
  cashBoxes: CashBox[];
  setCashBoxes?: React.Dispatch<React.SetStateAction<CashBox[]>>; // Optional
  setVouchers?: React.Dispatch<React.SetStateAction<Voucher[]>>; // Optional
  invoices: Invoice[];
  // Updated inventory type to InventoryItem[]
  inventory: InventoryItem[];
  vouchers: Voucher[];
  clients: Client[];
  refreshData: () => Promise<void>;
}

const Partners: React.FC<PartnersProps> = ({ 
  partners, setPartners, partnerTransactions, 
  cashBoxes, invoices, inventory, vouchers, clients, refreshData
}) => {
  const toItemsArray = (items: unknown): any[] => {
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const [activeTab, setActiveTab] = useState<'overview' | 'capital' | 'profits' | 'reports'>('overview');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'inject' | 'withdraw'>('inject');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Forms
  const [partnerForm, setPartnerForm] = useState<Partial<Partner>>({ 
    name: '', type: 'capital', percentage: 0, capitalAmount: 0, status: 'active', linkedClientId: '' 
  });
  
  const [transactionForm, setTransactionForm] = useState({
    partnerId: '',
    amount: '',
    cashBoxId: '',
    description: ''
  });

  const [selectedReportPartnerId, setSelectedReportPartnerId] = useState('');

  // --- CALCULATIONS ---
  const profitMetrics = useMemo(() => {
    const safeInvoices = invoices || [];
    const safeInventory = inventory || [];
    const safeVouchers = vouchers || [];
    const safePartnerTransactions = partnerTransactions || [];

    // 1. Revenue (Sales)
    const sales = safeInvoices.filter(inv => inv.type === 'sale');
    const revenue = sales.reduce((sum, inv) => sum + toNumericValue(inv.totalAmount), 0);

    // 2. COGS
    let cogs = 0;
    sales.forEach(inv => {
      toItemsArray(inv.items).forEach(item => {
         // Updated logic to find item by ID or name in InventoryItem array
         const currentItem = safeInventory.find(i => i.id === item.itemId || i.id === item.fabricId || i.name === item.itemName || i.name === item.fabricName);
         const cost = currentItem ? toNumericValue(currentItem.costPrice) : (toNumericValue(item.priceAtSale) || toNumericValue(item.unitPrice)) * 0.8;
         // Using quantity or metersSold for COGS calc
         cogs += (toNumericValue(item.metersSold) || toNumericValue(item.quantity)) * cost;
      });
    });

    // 3. Expenses
    const expenseVouchers = safeVouchers.filter(v => 
      v.type === 'payment' && 
      v.category !== 'مشتريات نقدية' && 
      v.category !== 'سحب أرباح' &&     
      v.category !== 'سحب رأس مال'
    );
    const expenses = expenseVouchers.reduce((sum, v) => sum + toNumericValue(v.amount), 0);

    const netProfit = revenue - cogs - expenses;

    // Distributed Profits
    const totalDistributed = safePartnerTransactions
      .filter(t => t.type === 'profit_distribution')
      .reduce((sum, t) => sum + toNumericValue(t.amount), 0);

    const distributableProfit = netProfit - totalDistributed;

    return { revenue, cogs, expenses, netProfit, distributableProfit, totalDistributed };
  }, [invoices, inventory, vouchers, partnerTransactions]);

  // --- HANDLERS ---

  const handleAddPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const newPartner: Partner = {
      id: Date.now().toString(),
      name: partnerForm.name!,
      type: partnerForm.type as any,
      percentage: Number(partnerForm.percentage),
      capitalAmount: Number(partnerForm.capitalAmount),
      currentBalance: 0,
      joinDate: new Date().toISOString(),
      status: 'active',
      linkedClientId: partnerForm.linkedClientId
    };

    try {
        await apiRequest('partners', { method: 'POST', body: JSON.stringify(newPartner) });
        setPartners([...partners, newPartner]);
        setIsAddModalOpen(false);
        setPartnerForm({ name: '', type: 'capital', percentage: 0, capitalAmount: 0, status: 'active', linkedClientId: '' });
    } catch(e) { alert("فشل إضافة الشريك"); }
    finally { setIsSubmitting(false); }
  };

  const handleFinancialAction = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(transactionForm.amount);
    const boxId = transactionForm.cashBoxId;
    const partnerId = transactionForm.partnerId;
    const box = cashBoxes.find(b => b.id === boxId);
    const partner = partners.find(p => p.id === partnerId);

    if (!box || !partner) return;

    if (actionType === 'withdraw' && box.balance < amount) { alert('رصيد الصندوق غير كاف'); return; }
    
    setIsSubmitting(true);

    const newTrans: PartnerTransaction = {
       id: `pt-${Date.now()}`,
       partnerId: partnerId,
       partnerName: partner.name,
       type: actionType === 'inject' ? 'capital_injection' : 'profit_withdrawal',
       amount: amount,
       date: new Date().toISOString(),
       description: transactionForm.description,
    };

    const newVoucher: Voucher = {
      id: Date.now().toString(),
      type: actionType === 'inject' ? 'receipt' : 'payment',
      status: 'DRAFT',
      date: new Date().toISOString(),
      amount: amount,
      cashBoxId: boxId,
      cashBoxName: box.name,
      category: actionType === 'inject' ? 'زيادة رأس مال' : 'سحب شريك',
      description: `${actionType === 'inject' ? 'إيداع من الشريك' : 'سحب للشريك'} ${partner.name}`
    };

    try {
        await apiRequest('partners/transaction', {
            method: 'POST',
            body: JSON.stringify({
                partnerId: partnerId,
                transaction: newTrans,
                voucher: newVoucher,
                cashBoxUpdate: true
            })
        });
        await refreshData();
        setIsActionModalOpen(false);
        setTransactionForm({ partnerId: '', amount: '', cashBoxId: '', description: '' });
    } catch (e) {
        alert("فشلت العملية");
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleDistributeProfits = async () => {
     if (profitMetrics.distributableProfit <= 0) {
        alert('لا توجد أرباح قابلة للتوزيع حالياً');
        return;
     }

     if (!(await confirmDialog(`سيتم توزيع مبلغ ${profitMetrics.distributableProfit.toFixed(2)}$ على الشركاء حسب النسب. هل أنت متأكد؟`))) return;
     
     setIsSubmitting(true);

     // We need to send multiple transactions to the server. 
     // For simplicity in this demo, we'll do them sequentially or assume the server endpoint supports batch.
     // Currently server supports single transaction. We will loop.
     
     try {
         for (const p of partners) {
            const share = (profitMetrics.distributableProfit * p.percentage) / 100;
            if (share > 0) {
               const trans: PartnerTransaction = {
                  id: `dist-${Date.now()}-${p.id}`,
                  partnerId: p.id,
                  partnerName: p.name,
                  type: 'profit_distribution',
                  amount: share,
                  date: new Date().toISOString(),
                  description: 'توزيع أرباح آلي'
               };
               // Call endpoint with NO voucher (book entry only)
               await apiRequest('partners/transaction', {
                   method: 'POST',
                   body: JSON.stringify({
                       partnerId: p.id,
                       transaction: trans,
                       voucher: null, 
                       cashBoxUpdate: false
                   })
               });
            }
         }
         await refreshData();
         alert('تم توزيع الأرباح وتحديث الأرصدة بنجاح!');
     } catch (e) {
         alert("حدث خطأ أثناء التوزيع");
     } finally {
         setIsSubmitting(false);
     }
  };

  // --- RENDER TABS ---

  const renderOverview = () => (
     <div className="space-y-6 animate-fadeIn">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
           <div className="bg-white p-4 rounded-xl shadow border-r-4 border-primary">
              <div className="text-gray-500 text-xs font-bold mb-1">عدد الشركاء</div>
              <div className="text-2xl font-bold">{partners.length}</div>
           </div>
           <div className="bg-white p-4 rounded-xl shadow border-r-4 border-blue-500">
              <div className="text-gray-500 text-xs font-bold mb-1">إجمالي رأس المال</div>
              <div className="text-2xl font-bold text-blue-600">
                 {partners.reduce((s, p) => s + p.capitalAmount, 0).toLocaleString()} $
              </div>
           </div>
           <div className="bg-white p-4 rounded-xl shadow border-r-4 border-green-500">
              <div className="text-gray-500 text-xs font-bold mb-1">الأرباح الموزعة (الجاري)</div>
              <div className="text-2xl font-bold text-green-600">
                 {partners.reduce((s, p) => s + p.currentBalance, 0).toLocaleString()} $
              </div>
           </div>
           <div className="bg-gray-800 text-white p-4 rounded-xl shadow">
              <div className="text-gray-300 text-xs font-bold mb-1">صافي الربح العام</div>
              <div className="text-2xl font-bold text-secondary">
                 {profitMetrics.netProfit.toLocaleString()} $
              </div>
           </div>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
           <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                 <tr>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الشريك</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">النوع</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">النسبة %</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">رأس المال</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">الرصيد الجاري</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">الحالة</th>
                 </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                 {partners.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                       <td className="px-6 py-4 font-bold text-gray-900 flex flex-col">
                          <SmartLink type="partner" id={p.id}>{p.name}</SmartLink>
                          {p.linkedClientId && <span className="text-xs text-blue-500 font-normal">مرتبط بحساب: {clients.find(c=>c.id===p.linkedClientId)?.name}</span>}
                       </td>
                       <td className="px-6 py-4 text-center text-sm">{p.type === 'capital' ? 'رأس مال' : 'تشغيلي'}</td>
                       <td className="px-6 py-4 text-center font-bold">{p.percentage}%</td>
                       <td className="px-6 py-4 text-center font-bold text-blue-700">{p.capitalAmount.toLocaleString()} $</td>
                       <td className="px-6 py-4 text-center font-bold text-green-700">{p.currentBalance.toLocaleString()} $</td>
                       <td className="px-6 py-4 text-center">
                          <span className={`px-2 py-1 text-xs rounded-full ${p.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                             {p.status === 'active' ? 'نشط' : 'منسحب'}
                          </span>
                       </td>
                    </tr>
                 ))}
              </tbody>
           </table>
        </div>
     </div>
  );

  const renderProfitDistribution = () => (
     <div className="space-y-8 animate-fadeIn max-w-4xl mx-auto">
        <div className="bg-gradient-to-br from-indigo-900 to-purple-900 text-white p-8 rounded-2xl shadow-xl text-center">
           <h3 className="text-2xl font-bold mb-2">توزيع الأرباح الآلي</h3>
           <p className="text-indigo-200 mb-6">يتم احتساب صافي الربح بناءً على المبيعات والمصاريف الفعلية وتوزيعه حسب النسب.</p>
           
           <div className="flex justify-center gap-8 mb-8">
              <div className="text-center">
                 <div className="text-sm text-indigo-300">صافي الربح الكلي</div>
                 <div className="text-3xl font-bold text-green-400">{profitMetrics.netProfit.toLocaleString()} $</div>
              </div>
              <div className="text-center border-r border-indigo-700 pr-8">
                 <div className="text-sm text-indigo-300">تم توزيعه سابقاً</div>
                 <div className="text-3xl font-bold text-yellow-400">{profitMetrics.totalDistributed.toLocaleString()} $</div>
              </div>
              <div className="text-center border-r border-indigo-700 pr-8">
                 <div className="text-sm text-indigo-300">قابل للتوزيع الآن</div>
                 <div className="text-3xl font-bold text-white">{profitMetrics.distributableProfit.toLocaleString()} $</div>
              </div>
           </div>

           <button 
             onClick={handleDistributeProfits}
             disabled={profitMetrics.distributableProfit <= 0 || isSubmitting}
             className="bg-green-500 text-white px-8 py-3 rounded-full font-bold shadow-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
           >
              {isSubmitting ? <RefreshCw className="animate-spin" /> : <PieChart size={20} />} 
              اعتماد وتوزيع الأرباح
           </button>
        </div>

        {/* Simulation Table */}
        <div className="bg-white p-6 rounded-xl shadow border">
           <h4 className="font-bold text-gray-800 mb-4">محاكاة التوزيع (قبل الاعتماد)</h4>
           <table className="w-full text-sm">
              <thead className="bg-gray-50">
                 <tr>
                    <th className="p-3 text-right">الشريك</th>
                    <th className="p-3 text-center">النسبة</th>
                    <th className="p-3 text-center">حصة الربح المتوقعة</th>
                 </tr>
              </thead>
              <tbody>
                 {partners.map(p => (
                    <tr key={p.id} className="border-b last:border-0">
                       <td className="p-3 font-medium">{p.name}</td>
                       <td className="p-3 text-center">{p.percentage}%</td>
                       <td className="p-3 text-center font-bold text-green-600">
                          {((profitMetrics.distributableProfit * p.percentage) / 100).toFixed(2)} $
                       </td>
                    </tr>
                 ))}
              </tbody>
           </table>
        </div>
     </div>
  );

  const renderReports = () => {
     const partner = partners.find(p => p.id === selectedReportPartnerId);
     const pTrans = partnerTransactions.filter(t => t.partnerId === selectedReportPartnerId);

     return (
        <div className="space-y-6 animate-fadeIn">
           <div className="flex gap-4 items-center mb-4">
              <label className="font-bold">اختر الشريك:</label>
              <select 
                 className="border rounded p-2 w-64" 
                 value={selectedReportPartnerId} 
                 onChange={e => setSelectedReportPartnerId(e.target.value)}
              >
                 <option value="">-- اختر --</option>
                 {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
           </div>

           {partner && (
              <div className="bg-white p-8 rounded-xl shadow-lg border-t-8 border-primary">
                 <div className="flex justify-between items-start mb-8 border-b pb-4">
                    <div>
                       <h2 className="text-2xl font-bold text-gray-800">{partner.name}</h2>
                       <p className="text-gray-500">كشف حساب شريك مفصل</p>
                    </div>
                    <div className="text-left">
                       <div className="text-sm text-gray-500">تاريخ الانضمام</div>
                       <div className="font-bold">{formatDate(partner.joinDate)}</div>
                    </div>
                 </div>

                 <div className="grid grid-cols-3 gap-6 mb-8">
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-center">
                       <div className="text-gray-500 text-xs mb-1">رأس المال الحالي</div>
                       <div className="text-2xl font-bold text-blue-700">{partner.capitalAmount.toLocaleString()} $</div>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg border border-green-100 text-center">
                       <div className="text-gray-500 text-xs mb-1">نسبة الأرباح</div>
                       <div className="text-2xl font-bold text-green-700">{partner.percentage}%</div>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 text-center">
                       <div className="text-gray-500 text-xs mb-1">الرصيد الجاري (للسحب)</div>
                       <div className="text-2xl font-bold text-purple-700">{partner.currentBalance.toLocaleString()} $</div>
                    </div>
                 </div>

                 <h4 className="font-bold text-gray-700 mb-4">سجل الحركات المالية</h4>
                 <table className="w-full text-sm border">
                    <thead className="bg-gray-50">
                       <tr>
                          <th className="p-2 border">التاريخ</th>
                          <th className="p-2 border">نوع الحركة</th>
                          <th className="p-2 border">الوصف</th>
                          <th className="p-2 border">دائن (له)</th>
                          <th className="p-2 border">مدين (عليه)</th>
                       </tr>
                    </thead>
                    <tbody>
                       {pTrans.length === 0 ? <tr><td colSpan={5} className="p-4 text-center">لا توجد حركات</td></tr> : 
                        pTrans.map(t => (
                           <tr key={t.id}>
                              <td className="p-2 border">{formatDate(t.date)}</td>
                              <td className="p-2 border text-center">
                                 {t.type === 'capital_injection' && 'إيداع رأس مال'}
                                 {t.type === 'capital_withdrawal' && 'سحب رأس مال'}
                                 {t.type === 'profit_distribution' && 'توزيع أرباح'}
                                 {t.type === 'profit_withdrawal' && 'سحب أرباح'}
                              </td>
                              <td className="p-2 border">{t.description}</td>
                              <td className="p-2 border text-green-600 font-bold text-center">
                                 {(t.type === 'capital_injection' || t.type === 'profit_distribution') ? t.amount : '-'}
                              </td>
                              <td className="p-2 border text-red-600 font-bold text-center">
                                 {(t.type === 'capital_withdrawal' || t.type === 'profit_withdrawal') ? t.amount : '-'}
                              </td>
                           </tr>
                        ))}
                    </tbody>
                 </table>
              </div>
           )}
        </div>
     );
  };

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6">
         <div>
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
               <Handshake className="text-primary"/> إدارة الشركاء ورأس المال
            </h2>
            <p className="text-sm text-gray-500 mt-1">نظام مركزي لإدارة الحصص، توزيع الأرباح، وحسابات الشركاء</p>
         </div>
         <div className="flex gap-2">
            <button onClick={() => { setActionType('inject'); setIsActionModalOpen(true); }} className="bg-white border text-green-700 border-green-200 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-green-50">
               <ArrowDownLeft size={18} /> إيداع (رأس مال)
            </button>
            <button onClick={() => { setActionType('withdraw'); setIsActionModalOpen(true); }} className="bg-white border text-red-700 border-red-200 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-50">
               <ArrowUpRight size={18} /> مسحوبات
            </button>
            <button onClick={() => setIsAddModalOpen(true)} className="bg-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow">
               <Plus size={18} /> شريك جديد
            </button>
         </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
         {[
            { id: 'overview', label: 'نظرة عامة', icon: <Briefcase size={16}/> },
            { id: 'profits', label: 'توزيع الأرباح', icon: <PieChart size={16}/> },
            { id: 'reports', label: 'كشوف الحسابات', icon: <FileText size={16}/> },
         ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition ${activeTab === tab.id ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
               {tab.icon} {tab.label}
            </button>
         ))}
      </div>

      {/* Content Area */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'profits' && renderProfitDistribution()}
      {activeTab === 'reports' && renderReports()}

      {/* --- ADD PARTNER MODAL --- */}
      {isAddModalOpen && (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-fadeIn">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
               <h3 className="text-xl font-bold mb-4 border-b pb-2">إضافة شريك جديد</h3>
               <form onSubmit={handleAddPartner} className="space-y-4">
                  <div>
                     <label className="block text-sm font-bold text-gray-700">الاسم الكامل</label>
                     <input required type="text" value={partnerForm.name} onChange={e => setPartnerForm({...partnerForm, name: e.target.value})} className="w-full border rounded p-2" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-sm font-bold text-gray-700">نوع الشراكة</label>
                        <select value={partnerForm.type} onChange={e => setPartnerForm({...partnerForm, type: e.target.value as any})} className="w-full border rounded p-2">
                           <option value="capital">رأس مال فقط</option>
                           <option value="operational">شريك مضارب (تشغيل)</option>
                           <option value="mixed">مختلط</option>
                        </select>
                     </div>
                     <div>
                        <label className="block text-sm font-bold text-gray-700">نسبة الأرباح %</label>
                        <input required type="number" min="0" max="100" value={partnerForm.percentage} onChange={e => setPartnerForm({...partnerForm, percentage: Number(e.target.value)})} className="w-full border rounded p-2" />
                     </div>
                  </div>
                  <div>
                     <label className="block text-sm font-bold text-gray-700">رأس المال الافتتاحي (تسجيل فقط)</label>
                     <input type="number" min="0" value={partnerForm.capitalAmount} onChange={e => setPartnerForm({...partnerForm, capitalAmount: Number(e.target.value)})} className="w-full border rounded p-2" />
                     <p className="text-xs text-gray-500 mt-1">* لإدخال المبلغ نقدياً للصندوق، استخدم زر "إيداع" بعد الإنشاء.</p>
                  </div>
                  <div>
                     <label className="block text-sm font-bold text-gray-700">ربط بحساب عميل/مورد (اختياري)</label>
                     <select value={partnerForm.linkedClientId} onChange={e => setPartnerForm({...partnerForm, linkedClientId: e.target.value})} className="w-full border rounded p-2 bg-gray-50">
                        <option value="">-- بدون ربط --</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type === 'CUSTOMER' ? 'عميل' : 'مورد'})</option>)}
                     </select>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                     <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 bg-gray-100 rounded text-gray-600">إلغاء</button>
                     <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-primary text-white rounded font-bold">{isSubmitting ? 'جاري...' : 'حفظ الشريك'}</button>
                  </div>
               </form>
            </div>
         </div>
      )}

      {/* --- ACTION MODAL (Inject/Withdraw) --- */}
      {isActionModalOpen && (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-fadeIn">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
               <h3 className={`text-xl font-bold mb-4 border-b pb-2 flex items-center gap-2 ${actionType === 'inject' ? 'text-green-700' : 'text-red-700'}`}>
                  {actionType === 'inject' ? <ArrowDownLeft /> : <ArrowUpRight />}
                  {actionType === 'inject' ? 'إيداع نقدي (زيادة رأس مال)' : 'سحب نقدي (مسحوبات)'}
               </h3>
               <form onSubmit={handleFinancialAction} className="space-y-4">
                  <div>
                     <label className="block text-sm font-bold text-gray-700">الشريك</label>
                     <select required value={transactionForm.partnerId} onChange={e => setTransactionForm({...transactionForm, partnerId: e.target.value})} className="w-full border rounded p-2">
                        <option value="">-- اختر الشريك --</option>
                        {partners.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                     </select>
                  </div>
                  <div>
                     <label className="block text-sm font-bold text-gray-700">المبلغ ($)</label>
                     <input required type="number" min="1" value={transactionForm.amount} onChange={e => setTransactionForm({...transactionForm, amount: e.target.value})} className="w-full border rounded p-2 font-bold text-lg" />
                  </div>
                  <div>
                     <label className="block text-sm font-bold text-gray-700">{actionType === 'inject' ? 'إلى الصندوق' : 'من الصندوق'}</label>
                     <select required value={transactionForm.cashBoxId} onChange={e => setTransactionForm({...transactionForm, cashBoxId: e.target.value})} className="w-full border rounded p-2">
                        <option value="">-- اختر الصندوق --</option>
                        {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name} ({b.balance}$)</option>)}
                     </select>
                  </div>
                  <div>
                     <label className="block text-sm font-bold text-gray-700">ملاحظات / بيان</label>
                     <input type="text" value={transactionForm.description} onChange={e => setTransactionForm({...transactionForm, description: e.target.value})} className="w-full border rounded p-2" />
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                     <button type="button" onClick={() => setIsActionModalOpen(false)} className="px-4 py-2 bg-gray-100 rounded text-gray-600">إلغاء</button>
                     <button type="submit" disabled={isSubmitting} className={`px-6 py-2 text-white rounded font-bold ${actionType === 'inject' ? 'bg-green-600' : 'bg-red-600'}`}>{isSubmitting ? 'جاري...' : 'تأكيد العملية'}</button>
                  </div>
               </form>
            </div>
         </div>
      )}
    </div>
  );
};

export default Partners;
