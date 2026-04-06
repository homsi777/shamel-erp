
import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingDown, Plus, Search, RefreshCw, Layers, CheckCircle2, 
  XCircle, Trash2, Info, History, FileText, Save, Calculator, 
  Building2, Wallet, Factory, Eye, Printer, AlertTriangle
} from 'lucide-react';
import { 
  Expense, ExpenseLine, Account, CashBox, Warehouse, 
  ManufacturingOrder, formatNumber, formatDate 
} from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import AccountPicker from '../components/AccountPicker';
import Combobox from '../components/Combobox';
import { SmartLink } from '../components/smart';
import { extractAccountsFromResponse } from '../lib/accounts-response';

const Expenses: React.FC<{ cashBoxes: CashBox[], warehouses: Warehouse[], refreshData: () => Promise<void>, setActiveTab?: (tab: string) => void }> = ({ cashBoxes, warehouses, refreshData, setActiveTab }) => {
  const [activeView, setActiveView] = useState<'list' | 'create'>('list');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mfgOrders, setMfgOrders] = useState<ManufacturingOrder[]>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);

  // Expense Form State
  const [form, setForm] = useState<Partial<Expense>>({
    code: `EXP-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString().split('T')[0],
    description: '',
    totalAmount: 0,
    currency: 'USD',
    paymentType: 'CASH',
    cashBoxId: cashBoxes[0]?.id || '',
    warehouseId: '',
    manufacturingOrderId: '',
    status: 'DRAFT',
    lines: []
  });

  const [lines, setLines] = useState<ExpenseLine[]>([]);

  const loadData = async () => {
    try {
      const [exps, accs, mfg] = await Promise.all([
        apiRequest('expenses'),
        apiRequest('accounts'),
        apiRequest('manufacturing/orders').catch(() => [])
      ]);
      setExpenses(exps);
      setAccounts(extractAccountsFromResponse(accs));
      setMfgOrders(mfg);
    } catch (e) { console.error("Expense load error", e); }
  };

  useEffect(() => { loadData(); }, []);

  // Filter only Leaf Expense accounts for lines
  const leafExpenseAccounts = useMemo(() => {
    return accounts.filter(a => a.accountType === 'expenses' && !a.isParent);
  }, [accounts]);

  // Calculations
  const linesTotal = useMemo(() => lines.reduce((s, l) => s + (l.amount || 0), 0), [lines]);
  const difference = useMemo(() => (form.totalAmount || 0) - linesTotal, [form.totalAmount, linesTotal]);

  // Handlers
  const handleAddLine = () => {
    setLines([...lines, { id: Date.now().toString(), expenseId: '', accountId: '', accountName: '', amount: 0, notes: '' }]);
  };

  const updateLine = (idx: number, field: keyof ExpenseLine, val: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = val;
    if (field === 'accountId') {
        newLines[idx].accountName = accounts.find(a => a.id === Number(val))?.nameAr || '';
    }
    setLines(newLines);
  };

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleSaveDraft = async () => {
    if (!form.description || (form.totalAmount || 0) <= 0) return;
    setIsSubmitting(true);
    const payload = {
        ...form,
        id: form.id || `exp-${Date.now()}`,
        status: 'DRAFT',
        lines,
        createdAt: new Date().toISOString()
    };
    try {
        await apiRequest('expenses', { method: 'POST', body: JSON.stringify(payload) });
        await loadData();
        setActiveView('list');
        resetForm();
    } catch (e) { alert("فشل حفظ المسودة"); }
    finally { setIsSubmitting(false); }
  };

  const handlePostExpense = async () => {
    if (Math.abs(difference) > 0.01) { alert("لا يمكن الاعتماد: مجموع السطور لا يساوي إجمالي المصروف"); return; }
    if (form.paymentType === 'CASH' && !form.cashBoxId) { alert("يرجى اختيار الصندوق للدفع"); return; }
    
    if (!(await confirmDialog('سيتم ترحيل المصروف وخصمه من الصندوق وتحديث شجرة الحسابات. هل أنت متأكد؟'))) return;

    setIsSubmitting(true);
    const payload = {
        ...form,
        id: form.id || `exp-${Date.now()}`,
        status: 'DRAFT', // It will be posted by the /post endpoint
        lines,
        createdAt: new Date().toISOString()
    };

    try {
        // 1. Save as latest version
        await apiRequest('expenses', { method: 'POST', body: JSON.stringify(payload) });
        // 2. Post it (Accounting Engine)
        await apiRequest(`expenses/${payload.id}/post`, { method: 'POST' });
        
        await loadData();
        await refreshData();
        setActiveView('list');
        resetForm();
        alert("تم ترحيل المصروف بنجاح ✅");
    } catch (e: any) { alert(e.message || "فشل الاعتماد"); }
    finally { setIsSubmitting(false); }
  };

  const resetForm = () => {
    setForm({
        code: `EXP-${Date.now().toString().slice(-6)}`,
        date: new Date().toISOString().split('T')[0],
        description: '',
        totalAmount: 0,
        currency: 'USD',
        paymentType: 'CASH',
        cashBoxId: cashBoxes[0]?.id || '',
        warehouseId: '',
        manufacturingOrderId: '',
        status: 'DRAFT',
        lines: []
    });
    setLines([]);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header Strategy */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-6">
            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                <TrendingDown className="text-rose-600" size={32} /> إدارة المصاريف التشغيلية
            </h2>
            <div className="flex bg-gray-100 p-1 rounded-xl border">
                <button onClick={() => setActiveView('list')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'list' ? 'bg-white shadow text-rose-600' : 'text-gray-500'}`}>سجل المصاريف</button>
                <button onClick={() => { resetForm(); setActiveView('create'); }} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'create' ? 'bg-white shadow text-rose-600' : 'text-gray-500'}`}>تسجيل مصروف جديد</button>
            </div>
        </div>
        <div className="flex gap-2">
            {setActiveTab && (
              <button onClick={() => setActiveTab('payroll')} className="bg-rose-50 text-rose-700 border border-rose-200 px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-rose-100 transition">
                <Building2 size={18} /> الرواتب والأجور
              </button>
            )}
            <button onClick={() => { resetForm(); setActiveView('create'); }} className="bg-rose-600 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-rose-700 transition shadow-lg shadow-rose-200 active:scale-95">
              <Plus size={18} /> إضافة مصروف جديد
            </button>
        </div>
      </div>

      {activeView === 'list' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
              <div className="p-6 border-b flex justify-between items-center bg-gray-50/50">
                  <h3 className="font-bold text-gray-700 flex items-center gap-2"><History size={20} className="text-rose-500"/> أرشيف المصروفات والنثريات</h3>
                  <div className="relative w-64">
                      <Search className="absolute right-3 top-2.5 text-gray-400" size={16}/>
                      <input type="text" placeholder="بحث بالمصروف أو البيان..." className="w-full pr-10 pl-4 py-2 border rounded-xl text-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                    <thead className="bg-gray-100/50 text-gray-500 font-black uppercase">
                        <tr>
                            <th className="px-6 py-4">رقم السند</th>
                            <th className="px-4 py-4">التاريخ</th>
                            <th className="px-4 py-4">البيان / الوصف</th>
                            <th className="px-4 py-4 text-center">المبلغ</th>
                            <th className="px-4 py-4">طريقة الدفع</th>
                            <th className="px-4 py-4 text-center">الحالة</th>
                            <th className="px-6 py-4 text-center">خيارات</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {expenses.length === 0 ? (
                            <tr><td colSpan={7} className="p-20 text-center text-gray-400 font-bold">لا يوجد مصاريف مسجلة حالياً</td></tr>
                        ) : (
                            expenses.filter(e => e.description.toLowerCase().includes(searchTerm.toLowerCase())).map(exp => (
                                <tr key={exp.id} className="hover:bg-rose-50/5 transition">
                                    <td className="px-6 py-4 font-mono font-bold text-rose-700"><SmartLink type="expense" id={exp.id}>{exp.code}</SmartLink></td>
                                    <td className="px-4 py-4 font-numeric font-bold text-gray-500">{formatDate(exp.date)}</td>
                                    <td className="px-4 py-4 font-bold text-gray-800 truncate max-w-xs">{exp.description}</td>
                                    <td className="px-4 py-4 text-center font-black font-numeric text-rose-600 text-sm">{formatNumber(exp.totalAmount)} $</td>
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-2">
                                            {exp.paymentType === 'CASH' ? <Wallet size={14} className="text-green-500"/> : <Building2 size={14} className="text-blue-500"/>}
                                            <span className="font-bold text-gray-600">{exp.paymentType === 'CASH' ? `نقدي (${exp.cashBoxName || 'الصندوق'})` : (exp.paymentType === 'ACCRUED' ? 'مصروف مستحق' : 'بنك')}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${exp.status === 'POSTED' ? 'bg-green-50 text-green-600' : exp.status === 'CANCELLED' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}>
                                            {exp.status === 'POSTED' ? 'معتمد' : exp.status === 'CANCELLED' ? 'ملغى' : 'مسودة'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button onClick={() => setViewingExpense(exp)} className="p-2 bg-gray-100 text-gray-400 hover:bg-rose-600 hover:text-white rounded-lg transition shadow-sm"><Eye size={16}/></button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
              </div>
          </div>
      ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fadeIn">
              {/* Form Section */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-8">
                    <div className="flex justify-between items-center border-b pb-6">
                        <h3 className="text-xl font-black text-gray-800 flex items-center gap-3"><FileText className="text-rose-500"/> بيانات سند المصروف</h3>
                        <div className="bg-rose-50 text-rose-600 px-4 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">نمط الإدخال المتعدد</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">رقم المصروف</label>
                            <input readOnly value={form.code} className="w-full bg-gray-50 border-none rounded-2xl p-4 font-mono font-black text-rose-700" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">تاريخ المصروف</label>
                            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-numeric font-bold" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">المبلغ الإجمالي ($)</label>
                            <input type="number" step="0.01" value={form.totalAmount} onChange={e => setForm({...form, totalAmount: Number(e.target.value)})} className="w-full border-2 border-rose-200 bg-rose-50/20 rounded-2xl p-4 font-black text-2xl text-center text-rose-900 outline-none focus:border-rose-500 font-numeric" />
                        </div>
                        <div className="md:col-span-3 space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">البيان / الوصف العام للمصروف</label>
                            <input required type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary" placeholder="مثلاً: فواتير الكهرباء والماء لشهر مايو، أجور نقل البضائع..." />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">طريقة الدفع</label>
                            <select value={form.paymentType} onChange={e => setForm({...form, paymentType: e.target.value as any})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-white outline-none">
                                <option value="CASH">نقدي (Cash)</option>
                                <option value="ACCRUED">مستحق (Accrued)</option>
                                <option value="BANK">بنك (Bank Transfer)</option>
                            </select>
                        </div>
                        {form.paymentType === 'CASH' && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">يخصم من الصندوق</label>
                                <select value={form.cashBoxId} onChange={e => setForm({...form, cashBoxId: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-white outline-none">
                                    {cashBoxes.map(b => <option key={b.id} value={b.id}>{b.name} (رصيد: {formatNumber(b.balance)}$)</option>)}
                                </select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">مرتبط بمستودع (اختياري)</label>
                            <select value={form.warehouseId} onChange={e => setForm({...form, warehouseId: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-white outline-none">
                                <option value="">-- بدون ربط مكاني --</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="bg-blue-50/50 p-6 rounded-3xl border border-blue-100 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <Factory className="text-blue-500" size={20}/>
                            <h4 className="font-black text-blue-900 text-sm">تحميل على عملية تصنيع</h4>
                        </div>
                        <p className="text-[10px] text-blue-400 font-bold mb-4 leading-relaxed">إذا كان هذا المصروف (نقل، صيانة ماكينة، عمالة خارجية) مرتبطاً بعملية تصنيع محددة، قم باختيارها لتحميل التكلفة آلياً على المنتج النهائي.</p>
                        <select value={form.manufacturingOrderId} onChange={e => setForm({...form, manufacturingOrderId: e.target.value})} className="w-full border-2 border-blue-200 rounded-2xl p-4 font-bold bg-white outline-none focus:border-blue-500">
                            <option value="">-- اختر أمر التصنيع المستهدف --</option>
                            {mfgOrders.map(m => <option key={m.id} value={m.id}>{m.code} - {m.outputItemName} ({formatDate(m.date)})</option>)}
                        </select>
                    </div>
                </div>

                {/* Expense Lines Section */}
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-6">
                    <div className="flex justify-between items-center">
                        <h4 className="font-black text-gray-800 flex items-center gap-3"><Calculator className="text-rose-500" size={20}/> التوزيع المحاسبي (التوجيه المالي)</h4>
                        <button type="button" onClick={handleAddLine} className="bg-rose-50 text-rose-600 px-6 py-2 rounded-xl text-xs font-black uppercase hover:bg-rose-600 hover:text-white transition shadow-sm">+ إضافة سطر توزيع</button>
                    </div>

                    <div className="space-y-4">
                        {lines.length === 0 ? (
                            <div className="py-12 text-center text-gray-300 border-2 border-dashed rounded-3xl flex flex-col items-center gap-3">
                                <Calculator size={48} className="opacity-20"/>
                                <p className="font-bold">يرجى إضافة سطر توزيع واحد على الأقل من شجرة الحسابات</p>
                            </div>
                        ) : (
                            lines.map((line, idx) => (
                                <div key={line.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-gray-50 p-4 rounded-2xl border border-gray-100 group">
                                    <div className="md:col-span-5">
                                        <label className="text-[9px] font-black text-gray-400 uppercase mb-1 block mr-2">حساب المصروف (Leaf Expense)</label>
                                        <Combobox 
                                            items={leafExpenseAccounts.map(a => ({ id: String(a.id), label: a.nameAr, subLabel: a.code }))} 
                                            selectedId={line.accountId ? String(line.accountId) : ''} 
                                            onSelect={(id) => updateLine(idx, 'accountId', Number(id))} 
                                            placeholder="اختر حساباً..."
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="text-[9px] font-black text-gray-400 uppercase mb-1 block mr-2">المبلغ</label>
                                        <input type="number" step="0.01" value={line.amount} onChange={e => updateLine(idx, 'amount', Number(e.target.value))} className="w-full border-2 border-gray-200 rounded-xl p-2.5 font-numeric font-black text-center text-rose-700 outline-none focus:border-rose-500" placeholder="0.00" />
                                    </div>
                                    <div className="md:col-span-4">
                                        <label className="text-[9px] font-black text-gray-400 uppercase mb-1 block mr-2">ملاحظات السطر</label>
                                        <input type="text" value={line.notes} onChange={e => updateLine(idx, 'notes', e.target.value)} className="w-full border-2 border-gray-200 rounded-xl p-2.5 text-xs font-bold outline-none" placeholder="بيان تفصيلي لهذا السطر..." />
                                    </div>
                                    <div className="md:col-span-1 text-center pt-5">
                                        <button type="button" onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"><Trash2 size={20}/></button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
              </div>

              {/* Sidebar Summary Card */}
              <div className="lg:col-span-4 space-y-6">
                  <div className="bg-gray-900 text-white p-8 rounded-[2.5rem] shadow-2xl sticky top-6 overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-rose-600/10 rounded-full translate-x-10 -translate-y-10"></div>
                      <h3 className="text-xl font-black mb-8 border-b border-white/10 pb-4">موجز السند المالي</h3>
                      
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">إجمالي المصروف</span>
                            <span className="text-2xl font-black font-numeric text-rose-400">{formatNumber(form.totalAmount || 0)} $</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">مجموع التوزيع</span>
                            <span className="text-xl font-black font-numeric text-white">{formatNumber(linesTotal)} $</span>
                        </div>
                        <div className={`p-4 rounded-2xl border-2 border-dashed flex justify-between items-center transition-colors ${Math.abs(difference) < 0.01 ? 'bg-green-500/10 border-green-500/50' : 'bg-red-500/10 border-red-500/50'}`}>
                            <span className="text-[10px] font-black uppercase">الفرق / المتبقي</span>
                            <span className="font-black font-numeric text-lg">{formatNumber(difference)} $</span>
                        </div>

                        <div className="pt-8 space-y-4">
                            <button 
                                onClick={handlePostExpense}
                                disabled={isSubmitting || Math.abs(difference) > 0.01 || lines.length === 0}
                                className="w-full bg-rose-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-rose-900/40 hover:bg-rose-700 transition transform active:scale-95 disabled:bg-gray-700 disabled:shadow-none disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? <RefreshCw className="animate-spin" size={24}/> : <CheckCircle2 size={24}/>} اعتماد وترحيل السند
                            </button>
                            <button 
                                onClick={handleSaveDraft}
                                disabled={isSubmitting}
                                className="w-full bg-white/5 text-gray-400 py-4 rounded-2xl font-black text-sm hover:bg-white/10 transition"
                            >
                                حفظ كمسودة (Draft)
                            </button>
                        </div>
                      </div>

                      <div className="mt-8 p-4 bg-white/5 rounded-2xl text-[10px] font-bold text-gray-500 leading-relaxed">
                          <Info size={14} className="inline ml-1 mb-1"/> 
                          تنبيه: الترحيل النهائي يؤدي لخصم المبلغ من الصندوق فوراً وتسجيل قيود مدينة في الحسابات المختارة. لا يمكن التراجع إلا بإلغاء السند (Reversal).
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- VIEW EXPENSE MODAL --- */}
      {viewingExpense && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-4xl overflow-hidden animate-fadeIn border-t-8 border-gray-900">
                  <div className="p-8 bg-gray-50 border-b flex justify-between items-center">
                      <div className="flex items-center gap-5">
                          <div className="bg-white p-3 rounded-2xl shadow-sm border text-rose-500"><TrendingDown size={32}/></div>
                          <div>
                            <h3 className="text-xl font-black">سند مصروف: {viewingExpense.code}</h3>
                            <p className="text-xs text-gray-400 font-bold uppercase">{formatDate(viewingExpense.date)} | {viewingExpense.status}</p>
                          </div>
                      </div>
                      <div className="flex gap-2">
                          <button onClick={() => window.print()} className="p-2 hover:bg-gray-200 text-gray-600 rounded-full transition"><Printer size={24}/></button>
                          <button onClick={() => setViewingExpense(null)} className="p-2 hover:bg-rose-100 text-rose-600 rounded-full transition"><XCircle size={24}/></button>
                      </div>
                  </div>
                  
                  <div className="p-10 space-y-10">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">القيمة الإجمالية</p>
                              <p className="text-xl font-black text-rose-600 font-numeric">{formatNumber(viewingExpense.totalAmount)} $</p>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">طريقة الدفع</p>
                              <p className="font-bold text-gray-800">{viewingExpense.paymentType === 'CASH' ? 'نقدي' : 'مستحق'}</p>
                          </div>
                          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">من صندوق</p>
                              <p className="font-bold text-gray-800">{viewingExpense.cashBoxName || '---'}</p>
                          </div>
                          <div className="bg-gray-900 p-4 rounded-2xl text-white">
                              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">المستودع المحمل</p>
                              <p className="font-bold">{viewingExpense.warehouseName || 'عام / غير محدد'}</p>
                          </div>
                      </div>

                      <div className="space-y-4">
                          <h4 className="font-black text-gray-700 text-sm">التوزيع المحاسبي التفصيلي (Expense Lines):</h4>
                          <table className="w-full text-right text-xs border rounded-2xl overflow-hidden">
                              <thead className="bg-gray-50 text-gray-500 font-black">
                                  <tr>
                                      <th className="p-4">حساب المصروف</th>
                                      <th className="p-4 text-center">المبلغ</th>
                                      <th className="p-4">بيان السطر</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y">
                                  {viewingExpense.lines.map((line, i) => (
                                      <tr key={i} className="hover:bg-gray-50 transition">
                                          <td className="p-4 font-bold text-gray-800">{line.accountName}</td>
                                          <td className="p-4 text-center font-numeric font-black text-rose-600 text-sm">{formatNumber(line.amount)} $</td>
                                          <td className="p-4 text-gray-500 italic">{line.notes || '---'}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>

                      {viewingExpense.description && (
                          <div className="bg-rose-50/30 p-6 rounded-3xl border border-rose-100">
                              <p className="text-[10px] font-black text-rose-400 uppercase mb-2">البيان العام للسند</p>
                              <p className="text-sm font-bold text-gray-600 leading-loose">{viewingExpense.description}</p>
                          </div>
                      )}

                      {viewingExpense.status === 'POSTED' && (
                          <div className="flex items-center gap-3 text-green-600 bg-green-50 p-4 rounded-2xl border border-green-100">
                              <CheckCircle2 size={24}/>
                              <div className="text-xs font-bold">تم ترحيل هذا المصروف محاسبياً بتاريخ {formatDate(viewingExpense.postedAt || '')}. جميع الحسابات والصناديق محدثة.</div>
                          </div>
                      )}
                  </div>

                  <div className="p-8 border-t bg-gray-50 flex justify-end gap-3">
                        {viewingExpense.status === 'DRAFT' && (
                            <button onClick={async () => { if (await confirmDialog('ترحيل السند الآن؟')) { await apiRequest(`expenses/${viewingExpense.id}/post`, {method: 'POST'}); loadData(); setViewingExpense(null); }}} className="bg-rose-600 text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-rose-700 transition">ترحيل السند الآن</button>
                        )}
                        {viewingExpense.status === 'POSTED' && (
                            <button onClick={() => alert('ميزة الإلغاء القيدي (Reverse Entry) قيد التطوير في التحديث القادم.')} className="bg-red-50 text-red-600 border border-red-100 px-8 py-3 rounded-xl font-black hover:bg-red-100 transition">إلغاء السند (Reversal)</button>
                        )}
                        <button onClick={() => setViewingExpense(null)} className="px-6 py-3 font-bold text-gray-400">إغلاق</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Expenses;
