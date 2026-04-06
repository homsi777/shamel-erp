
import React, { useState, useMemo } from 'react';
import { 
  Save, ClipboardCheck, CheckCircle, RefreshCw, Warehouse as WHIcon, 
  Building2, AlertTriangle, Sparkles, Search, RotateCcw,
  CheckCircle2, XCircle, Info, ChevronRight, Package, Calculator, DollarSign, X
} from 'lucide-react';
import { InventoryItem, Warehouse, Branch, formatNumber } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import { analyzeAuditResults } from '../services/geminiService';

interface StockTakingProps {
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  warehouses: Warehouse[];
  branches: Branch[];
}

const StockTaking: React.FC<StockTakingProps> = ({ items, setItems, warehouses, branches }) => {
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all');
  const [isAuditActive, setIsAuditActive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [counts, setCounts] = useState<{[key: string]: string}>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{type: 'success'|'error'|'warning', text: string} | null>(null);
  
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const filteredItems = useMemo(() => {
    const safeSearch = (searchTerm || '').toLowerCase();
    return (items || []).filter(item => {
      const wh = warehouses.find(w => w.id === item.warehouseId);
      const matchBranch = selectedBranchId === 'all' || !wh || wh.branchId === selectedBranchId;
      const matchWH = selectedWarehouseId === 'all' || item.warehouseId === selectedWarehouseId;
      
      const name = (item?.name || '').toLowerCase();
      const code = (item?.code || '').toLowerCase();
      const matchSearch = name.includes(safeSearch) || code.includes(safeSearch);
      
      return matchBranch && matchWH && matchSearch;
    });
  }, [items, selectedBranchId, selectedWarehouseId, searchTerm, warehouses]);

  const stats = useMemo(() => {
    let matched = 0, shortage = 0, surplus = 0, totalDiffValue = 0;
    const itemsInAudit = filteredItems.filter(i => counts[i.id] !== undefined);
    
    itemsInAudit.forEach(item => {
        const actual = Number(counts[item.id]);
        const system = item.quantity || 0;
        const diff = actual - system;
        
        if (diff === 0) matched++;
        else if (diff < 0) shortage++;
        else surplus++;

        totalDiffValue += (diff * (item.costPrice || 0));
    });

    return { total: filteredItems.length, audited: itemsInAudit.length, matched, shortage, surplus, totalDiffValue };
  }, [filteredItems, counts]);

  const handleCountChange = (id: string, value: string) => {
    setCounts(prev => ({ ...prev, [id]: value }));
  };

  const handleStartAudit = () => {
    if (selectedWarehouseId === 'all' && selectedBranchId === 'all') {
        setStatusMsg({type: 'warning', text: 'يفضل اختيار مستودع محدد لضمان دقة الجرد'});
    }
    setIsAuditActive(true);
    setCounts({});
    setAiAnalysis(null);
  };

  const handleApplyAudit = async () => {
    const itemsToPost = filteredItems.filter(i => counts[i.id] !== undefined);
    if (itemsToPost.length === 0) {
        setStatusMsg({type: 'error', text: 'لم يتم إدخال أي كميات جرد فعلي'});
        return;
    }
    
    if (!(await confirmDialog(`أنت على وشك اعتماد جرد ${itemsToPost.length} صنف وتحديث الأرصدة في النظام. هل تريد الاستمرار؟`))) return;

    setSubmitting(true);
    setStatusMsg(null);
      
    const auditPayload = itemsToPost.map(item => ({ 
        id: item.id, 
        quantity: Number(counts[item.id]),
        notes: `جرد مخزني بتاريخ ${new Date().toLocaleDateString()}`
    }));

    try {
        await apiRequest('inventory/audit', {
            method: 'POST',
            body: JSON.stringify({ items: auditPayload })
        });

        const updatedItems = items.map(item => {
          const entry = auditPayload.find(p => p.id === item.id);
          return entry ? { ...item, quantity: entry.quantity } : item;
        });
        
        setItems(updatedItems as InventoryItem[]);
        setIsAuditActive(false);
        setCounts({});
        setStatusMsg({type: 'success', text: 'تمت مطابقة الجرد وتحديث المخزون بنجاح ✅'});
        setTimeout(() => setStatusMsg(null), 5000);

    } catch (error) {
        setStatusMsg({type: 'error', text: 'فشل ترحيل الجرد. تأكد من اتصالك بالسيرفر.'});
    } finally {
        setSubmitting(false);
    }
  };

  const autoFillMatching = () => {
    const newCounts: {[key: string]: string} = { ...counts };
    filteredItems.forEach(item => {
      if (newCounts[item.id] === undefined) newCounts[item.id] = (item.quantity || 0).toString();
    });
    setCounts(newCounts);
  };

  const handleAiAnalysis = async () => {
    const discrepancies = filteredItems
        .filter(i => counts[i.id] !== undefined && Number(counts[i.id]) !== (i.quantity || 0))
        .map(i => ({ 
            name: i.name, 
            systemRolls: i.quantity, 
            actualRolls: Number(counts[i.id]), 
            diff: Number(counts[i.id]) - (i.quantity || 0) 
        }));

    if (discrepancies.length === 0) {
        alert("لا توجد فروقات لتحليلها!");
        return;
    }

    setLoadingAi(true);
    const result = await analyzeAuditResults(discrepancies);
    setAiAnalysis(result);
    setLoadingAi(false);
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-2xl text-primary">
                <ClipboardCheck size={32} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">نظام الجرد والتدقيق المخزني</h2>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">Inventory Audit Engine v3.0</p>
            </div>
        </div>

        {!isAuditActive ? (
            <div className="flex flex-wrap gap-3 w-full md:w-auto">
                <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-2xl border">
                    <Building2 size={16} className="text-gray-400"/>
                    <select value={selectedBranchId} onChange={e => {setSelectedBranchId(e.target.value); setSelectedWarehouseId('all');}} className="bg-transparent font-bold text-sm outline-none">
                        <option value="all">كافة الفروع</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-2xl border">
                    <WHIcon size={16} className="text-gray-400"/>
                    <select value={selectedWarehouseId} onChange={e => setSelectedWarehouseId(e.target.value)} className="bg-transparent font-bold text-sm outline-none">
                        <option value="all">كافة المستودعات</option>
                        {warehouses.filter(w => selectedBranchId === 'all' || w.branchId === selectedBranchId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                </div>
                <button onClick={handleStartAudit} className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-black shadow-xl hover:bg-black transition transform active:scale-95 flex items-center gap-2">
                    <RefreshCw size={18}/> بدء دورة جرد جديدة
                </button>
            </div>
        ) : (
            <div className="flex gap-2">
                <button onClick={async () => { if (await confirmDialog('إلغاء جلسة الجرد الحالية؟')) setIsAuditActive(false); }} className="bg-white text-red-600 border border-red-100 px-6 py-3 rounded-2xl font-bold hover:bg-red-50 transition">
                    إلغاء الجلسة
                </button>
                <button onClick={handleApplyAudit} disabled={submitting} className="bg-primary text-white px-10 py-3 rounded-2xl font-black shadow-xl hover:bg-teal-800 transition flex items-center gap-3 disabled:bg-gray-300 transform active:scale-95">
                    {submitting ? <RefreshCw className="animate-spin" size={20}/> : <CheckCircle2 size={20} />}
                    {submitting ? 'جاري الحفظ...' : 'اعتماد وترحيل الفروقات'}
                </button>
            </div>
        )}
      </div>

      {isAuditActive && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 animate-fadeIn">
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">إجمالي المواد</p>
                    <div className="flex justify-between items-end">
                        <h3 className="text-3xl font-black text-gray-900 font-numeric">{stats.total}</h3>
                        <Package className="text-gray-200" size={32}/>
                    </div>
                </div>
                <div className="bg-green-50 p-5 rounded-3xl border border-green-100 flex flex-col justify-between">
                    <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-2">مطابق تماماً</p>
                    <div className="flex justify-between items-end">
                        <h3 className="text-3xl font-black text-green-700 font-numeric">{stats.matched}</h3>
                        <CheckCircle2 className="text-green-200" size={32}/>
                    </div>
                </div>
                <div className="bg-red-50 p-5 rounded-3xl border border-red-100 flex flex-col justify-between">
                    <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-2">يوجد عجز (نقص)</p>
                    <div className="flex justify-between items-end">
                        <h3 className="text-3xl font-black text-red-700 font-numeric">{stats.shortage}</h3>
                        <AlertTriangle className="text-red-200" size={32}/>
                    </div>
                </div>
                <div className="bg-blue-50 p-5 rounded-3xl border border-blue-100 flex flex-col justify-between">
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2">يوجد زيادة</p>
                    <div className="flex justify-between items-end">
                        <h3 className="text-3xl font-black text-blue-700 font-numeric">{stats.surplus}</h3>
                        <RefreshCw className="text-blue-200" size={32}/>
                    </div>
                </div>
                <div className="bg-gray-900 text-white p-5 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-primary/20"></div>
                    <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-2 relative z-10">الفرق المالي التقديري</p>
                    <div className="flex justify-between items-end relative z-10">
                        <h3 className={`text-2xl font-black font-numeric ${stats.totalDiffValue < 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {formatNumber(stats.totalDiffValue)} $
                        </h3>
                        <DollarSign className="text-white/10" size={32}/>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden flex flex-col animate-fadeIn">
                <div className="p-6 bg-gray-50 border-b flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute right-4 top-3 text-gray-400" size={20}/>
                        <input 
                            type="text" 
                            placeholder="بحث سريع باسم المادة أو الكود داخل قائمة الجرد..." 
                            className="w-full pr-12 pl-4 py-3 bg-white border-2 border-gray-100 rounded-2xl font-bold outline-none focus:border-primary transition shadow-sm"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={autoFillMatching} className="bg-white text-gray-700 border-2 border-gray-100 px-5 py-3 rounded-2xl font-bold text-sm hover:bg-gray-50 transition shadow-sm flex items-center gap-2">
                            <CheckCircle size={18} className="text-green-600"/> مطابقة البقية آلياً
                        </button>
                        <button onClick={() => setCounts({})} className="bg-white text-gray-400 border-2 border-gray-100 px-5 py-3 rounded-2xl font-bold text-sm hover:text-red-600 transition shadow-sm">
                            تصفير الإدخالات
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead>
                            <tr className="bg-gray-100/50 text-gray-500 border-b">
                                <th className="px-8 py-5 text-xs font-black uppercase">المادة والمعلومات التقنية</th>
                                <th className="px-4 py-5 text-xs font-black uppercase text-center">المستودع</th>
                                <th className="px-4 py-5 text-xs font-black uppercase text-center bg-gray-100/80">رصيد النظام</th>
                                <th className="px-4 py-5 text-xs font-black uppercase text-center bg-blue-50 text-blue-700">الرصيد الفعلي (الجرد)</th>
                                <th className="px-4 py-5 text-xs font-black uppercase text-center">الفرق</th>
                                <th className="px-4 py-5 text-xs font-black uppercase text-center">قيمة الفرق</th>
                                <th className="px-8 py-5 text-xs font-black uppercase text-center">الحالة</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredItems.length === 0 ? (
                                <tr><td colSpan={7} className="p-20 text-center text-gray-400 font-bold">لا توجد مواد تطابق معايير الجرد المختارة</td></tr>
                            ) : (
                                filteredItems.map(item => {
                                    const actualStr = counts[item.id];
                                    const actual = actualStr === undefined ? undefined : Number(actualStr);
                                    const system = item.quantity || 0;
                                    const diff = actual !== undefined ? actual - system : 0;
                                    const diffValue = diff * (item.costPrice || 0);

                                    return (
                                        <tr key={item.id} className={`group hover:bg-gray-50 transition-colors ${actual !== undefined && diff !== 0 ? (diff < 0 ? 'bg-red-50/30' : 'bg-green-50/30') : ''}`}>
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-white rounded-xl border flex items-center justify-center text-gray-300 group-hover:border-primary group-hover:text-primary transition-all">
                                                        <Package size={20}/>
                                                    </div>
                                                    <div>
                                                        <div className="font-black text-gray-900 text-sm">{item.name}</div>
                                                        <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5 flex gap-2">
                                                            <span className="font-mono">{item.code}</span>
                                                            {item.color && <span>| لون: {item.color}</span>}
                                                            {item.model && <span className="text-blue-500 font-numeric">M: {item.model}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-5 text-center">
                                                <span className="text-[10px] font-black px-2 py-1 bg-gray-100 text-gray-500 rounded-lg">{item.warehouseName}</span>
                                            </td>
                                            <td className="px-4 py-5 text-center bg-gray-50/50">
                                                <div className="text-lg font-black text-gray-600 font-numeric">{system}</div>
                                                <div className="text-[9px] font-bold text-gray-400 uppercase">{item.unitName}</div>
                                            </td>
                                            <td className="px-4 py-5 text-center bg-blue-50/20">
                                                <input 
                                                    type="number" 
                                                    className="w-24 p-3 border-2 border-blue-100 rounded-xl font-black text-xl text-center text-blue-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition shadow-sm bg-white" 
                                                    value={actualStr || ''} 
                                                    onChange={(e) => handleCountChange(item.id, e.target.value)} 
                                                    placeholder="؟" 
                                                />
                                            </td>
                                            <td className="px-4 py-5 text-center">
                                                {actual !== undefined ? (
                                                    <div className={`text-lg font-black font-numeric ${diff === 0 ? 'text-gray-300' : diff < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                        {diff > 0 ? `+${diff}` : diff}
                                                    </div>
                                                ) : <span className="text-gray-200">---</span>}
                                            </td>
                                            <td className="px-4 py-5 text-center">
                                                {actual !== undefined && diff !== 0 ? (
                                                    <div className={`text-sm font-bold font-numeric ${diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                        {formatNumber(diffValue)} $
                                                    </div>
                                                ) : <span className="text-gray-200">-</span>}
                                            </td>
                                            <td className="px-8 py-5 text-center">
                                                {actual === undefined ? (
                                                    <span className="text-[9px] font-black text-gray-300 border border-dashed border-gray-200 px-3 py-1 rounded-full uppercase tracking-tighter">بانتظار الإدخال</span>
                                                ) : diff === 0 ? (
                                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100 uppercase tracking-tighter">
                                                        <CheckCircle size={10}/> مطابق
                                                    </span>
                                                ) : (
                                                    <span className={`inline-flex items-center gap-1 text-[9px] font-black px-3 py-1 rounded-full border uppercase tracking-tighter ${diff < 0 ? 'text-red-600 bg-red-50 border-red-100' : 'text-blue-600 bg-blue-50 border-blue-100'}`}>
                                                        {diff < 0 ? <AlertTriangle size={10}/> : <RotateCcw size={10}/>}
                                                        {diff < 0 ? 'عجز' : 'زيادة'}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* AI Analysis panel - hidden */}
            {false && <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 p-8 rounded-[3rem] shadow-2xl text-white relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-[100px] group-hover:scale-110 transition-transform"></div>
                <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                    <div className="shrink-0 flex flex-col items-center">
                        <div className="bg-white/10 p-5 rounded-[2rem] backdrop-blur-xl border border-white/20 mb-4 shadow-2xl">
                            <Sparkles size={48} className="text-primary animate-pulse" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">Gemini Intelligent Insight</span>
                    </div>
                    <div className="flex-1 text-center md:text-right">
                        <h3 className="text-2xl font-black mb-2">تحليل الجرد الذكي (AI Analysis)</h3>
                        {!aiAnalysis && !loadingAi ? (
                            <>
                                <p className="text-indigo-200 text-sm mb-6 leading-relaxed max-w-2xl">
                                    يمكن لمساعدك الذكي تحليل كافة الفروقات المكتشفة في الجرد الحالي، وتقديم رؤية حول الأسباب المالية أو التشغيلية المحتملة للعجز، بالإضافة لتوصيات فورية لتحسين دقة المخزن.
                                </p>
                                <button onClick={handleAiAnalysis} className="bg-white text-indigo-900 px-10 py-4 rounded-2xl font-black text-lg shadow-xl hover:bg-primary hover:text-white transition-all transform active:scale-95 flex items-center gap-3 mx-auto md:mx-0">
                                    <Calculator size={20}/> ابدأ تحليل الفروقات الآن
                                </button>
                            </>
                        ) : loadingAi ? (
                            <div className="py-10 flex flex-col items-center gap-4">
                                <RefreshCw className="animate-spin text-primary" size={40}/>
                                <p className="font-bold text-indigo-100">جاري فحص الحركات المخزنية وتقاطعها مع بيانات الجرد...</p>
                            </div>
                        ) : (
                            <div className="bg-black/20 p-6 rounded-[2rem] border border-white/10 backdrop-blur-md animate-fadeIn text-sm leading-loose whitespace-pre-line text-right">
                                {aiAnalysis}
                                <div className="mt-6 pt-4 border-t border-white/5 flex justify-between items-center">
                                    <button onClick={() => setAiAnalysis(null)} className="text-[10px] font-bold text-gray-400 hover:text-white transition">تحديث التحليل</button>
                                    <span className="text-[9px] font-bold text-primary italic">* التحليل مبني على الحركات المالية والمخزنية المسجلة</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>}

            <div className="bg-white p-6 rounded-3xl border-2 border-dashed border-gray-200 flex items-center gap-6">
                <div className="bg-blue-50 p-3 rounded-2xl text-blue-600">
                    <Info size={24}/>
                </div>
                <div className="text-xs text-gray-500 font-bold leading-relaxed">
                    <p className="text-gray-900 mb-1">دليل الاعتماد:</p>
                    عند الضغط على "اعتماد وترحيل الفروقات"، سيقوم النظام آلياً بتعديل رصيد الصنف في المستودع ليطابق الكمية الفعلية المدخلة، كما سيتم إنشاء "حركة تسوية مخزنية" (Inventory Adjustment) لكل صنف يوجد به فرق، لضمان صحة التقارير المحاسبية لاحقاً.
                </div>
            </div>
          </>
      )}

      {!isAuditActive && (
          <div className="flex flex-col items-center justify-center py-24 animate-fadeIn">
              <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 flex flex-col items-center text-center max-w-lg">
                  <div className="bg-primary/5 p-8 rounded-[2.5rem] mb-8">
                      <WHIcon size={80} className="text-primary opacity-40" />
                  </div>
                  <h3 className="text-3xl font-black text-gray-900 mb-4">جاهز لبدء دورة الجرد?</h3>
                  <p className="text-gray-500 leading-relaxed mb-8">
                      اختر الفرع والمستودع المستهدف ثم اضغط على زر البدء. سيقوم النظام بأخذ "لقطة" (Snapshot) للأرصدة الحالية لتمكينك من مطابقتها مع الواقع الفعلي.
                  </p>
                  <div className="flex flex-col w-full gap-3">
                      <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-100 flex items-start gap-3 text-right">
                          <AlertTriangle className="text-yellow-600 shrink-0" size={20}/>
                          <p className="text-[10px] text-yellow-800 font-bold">تنبيه: يفضل وقف عمليات البيع والشراء على المستودع المستهدف أثناء عملية الجرد لضمان دقة البيانات.</p>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {statusMsg && (
        <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 p-5 rounded-2xl shadow-2xl z-[200] flex items-center gap-4 animate-slideUp font-black text-white border-2 border-white/20 backdrop-blur-md ${statusMsg.type === 'success' ? 'bg-green-600' : statusMsg.type === 'error' ? 'bg-red-600' : 'bg-orange-50'}`}>
           {statusMsg.type === 'success' ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
           <span className="text-lg">{statusMsg.text}</span>
           <button onClick={() => setStatusMsg(null)} className="p-1 hover:bg-black/10 rounded-full transition"><X size={20}/></button>
        </div>
      )}
    </div>
  );
};

export default StockTaking;
