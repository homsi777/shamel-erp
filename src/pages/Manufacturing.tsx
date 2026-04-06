
import React, { useState, useEffect, useMemo } from 'react';
// Added missing icons to imports
import { 
  Factory, Plus, Search, RefreshCw, Layers, CheckCircle2, 
  XCircle, Trash2, Info, History, BookOpen, Save, Hammer, Eye, DollarSign, X
} from 'lucide-react';
import { InventoryItem, Recipe, ManufacturingOrder, RecipeLine, Warehouse, formatNumber, formatDate } from '../types';
import { apiRequest } from '../lib/api';
import { AdaptiveModal } from '../components/responsive';
import { confirmDialog } from '../lib/confirm';
import Combobox from '../components/Combobox';

const Manufacturing: React.FC<{ inventory: InventoryItem[], warehouses: Warehouse[], refreshData: () => Promise<void> }> = ({ inventory, warehouses, refreshData }) => {
  const [activeView, setActiveView] = useState<'orders' | 'recipes'>('orders');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<ManufacturingOrder[]>([]);
  
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [viewingOrder, setViewingOrder] = useState<ManufacturingOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Recipe Form
  const [recipeForm, setRecipeForm] = useState<Partial<Recipe>>({ name: '', code: '', outputItemId: '', outputQty: 1, unitName: '', notes: '', lines: [] });
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);

  // Order Form
  const [orderForm, setOrderForm] = useState<Partial<ManufacturingOrder>>({
    code: `MFG-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString().split('T')[0],
    warehouseId: warehouses[0]?.id || '',
    outputItemId: '',
    outputQty: 1,
    expenseType: 'FIXED',
    expenseValue: 0,
    notes: '',
    items: []
  });

  const loadData = async () => {
    try {
      const [r, o] = await Promise.all([
        apiRequest('manufacturing/recipes'),
        apiRequest('manufacturing/orders')
      ]);
      setRecipes(r);
      setOrders(o);
    } catch (e) { console.error("MFG load error", e); }
  };

  useEffect(() => { loadData(); }, []);

  // --- RE-CALCULATE Quantities when Output Qty changes ---
  useEffect(() => {
    if (orderForm.items && orderForm.items.length > 0) {
        recomputeOrderItems();
    }
  }, [orderForm.outputQty, orderForm.warehouseId]);

  const recomputeOrderItems = () => {
      const currentItems = orderForm.items || [];
      const updated = currentItems.map(item => {
          // Find original recipe line to get qtyPerOutput and wastagePct
          const recipe = recipes.find(r => r.outputItemId === orderForm.outputItemId);
          const line = recipe?.lines.find(l => l.inputItemId === item.inputItemId);
          
          const qtyPerUnit = line?.qtyPerOutput || 1;
          const wastage = line?.wastagePct || 0;
          const newQty = qtyPerUnit * (orderForm.outputQty || 1) * (1 + wastage / 100);
          
          const invItem = inventory.find(i => i.id === item.inputItemId && i.warehouseId === orderForm.warehouseId);
          const cost = invItem?.costPrice || 0;

          return { ...item, inputQty: newQty, unitCostAtTime: cost, lineTotalCost: newQty * cost };
      });
      setOrderForm(prev => ({ ...prev, items: updated }));
  };

  // --- RECIPE LOGIC ---
  const handleAddRecipeLine = () => {
      setRecipeLines([...recipeLines, { id: Date.now().toString(), recipeId: '', inputItemId: '', inputItemName: '', qtyPerOutput: 1, wastagePct: 0 }]);
  };

  const updateRecipeLine = (idx: number, field: keyof RecipeLine, val: any) => {
      const newLines = [...recipeLines];
      (newLines[idx] as any)[field] = val;
      if (field === 'inputItemId') {
          newLines[idx].inputItemName = inventory.find(i => i.id === val)?.name || '';
      }
      setRecipeLines(newLines);
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeForm.outputItemId || recipeLines.length === 0) return;
    setIsSubmitting(true);
    const payload = {
        ...recipeForm,
        id: recipeForm.id || `rec-${Date.now()}`,
        outputItemName: inventory.find(i => i.id === recipeForm.outputItemId)?.name || '',
        lines: recipeLines,
        createdAt: new Date().toISOString()
    };
    try {
        await apiRequest('manufacturing/recipes', { method: 'POST', body: JSON.stringify(payload) });
        await loadData();
        setIsRecipeModalOpen(false);
        setRecipeForm({ name: '', code: '', outputItemId: '', outputQty: 1, unitName: '', notes: '', lines: [] });
        setRecipeLines([]);
    } catch (e) { alert("فشل حفظ الوصفة"); }
    finally { setIsSubmitting(false); }
  };

  // --- ORDER LOGIC ---
  const handleLoadRecipeToOrder = (recipeId: string) => {
      const recipe = recipes.find(r => r.id === recipeId);
      if (!recipe) return;
      
      const newItems = recipe.lines.map(line => {
          const invItem = inventory.find(i => i.id === line.inputItemId && i.warehouseId === orderForm.warehouseId);
          const unitCost = invItem?.costPrice || 0;
          const inputQty = line.qtyPerOutput * (orderForm.outputQty || 1) * (1 + line.wastagePct / 100);
          return {
              id: `item-${Math.random()}`,
              inputItemId: line.inputItemId,
              inputItemName: line.inputItemName,
              inputQty,
              unitCostAtTime: unitCost,
              lineTotalCost: inputQty * unitCost
          };
      });

      setOrderForm(prev => ({ 
          ...prev, 
          outputItemId: recipe.outputItemId, 
          outputItemName: recipe.outputItemName,
          items: newItems 
      }));
  };

  const orderCalculations = useMemo(() => {
      const items = orderForm.items || [];
      const materialCost = items.reduce((sum, i) => sum + i.lineTotalCost, 0);
      let expenseAmt = 0;
      if (orderForm.expenseType === 'FIXED') expenseAmt = Number(orderForm.expenseValue || 0);
      else expenseAmt = materialCost * (Number(orderForm.expenseValue || 0) / 100);
      
      const total = materialCost + expenseAmt;
      const unit = (orderForm.outputQty || 1) > 0 ? total / (orderForm.outputQty || 1) : 0;
      
      return { materialCost, expenseAmt, total, unit };
  }, [orderForm]);

  const hasInsufficientStock = useMemo(() => {
    return (orderForm.items || []).some(item => {
        const invItem = inventory.find(i => i.id === item.inputItemId && i.warehouseId === orderForm.warehouseId);
        return !invItem || invItem.quantity < item.inputQty;
    });
  }, [orderForm.items, orderForm.warehouseId, inventory]);

  const handlePostOrder = async () => {
    if (!orderForm.outputItemId || !orderForm.items?.length || orderForm.outputQty! <= 0) return;
    if (hasInsufficientStock) { alert("لا يمكن المتابعة: يوجد مواد برصيد غير كافٍ في المستودع"); return; }
    
    if (!(await confirmDialog(`سيتم خصم المكونات من المستودع وإضافة ${orderForm.outputQty} قطعة من المنتج النهائي. هل أنت متأكد؟`))) return;

    setIsSubmitting(true);
    const warehouse = warehouses.find(w => w.id === orderForm.warehouseId);
    const payload = {
        ...orderForm,
        id: `mfg-${Date.now()}`,
        warehouseName: warehouse?.name,
        outputItemName: inventory.find(i => i.id === orderForm.outputItemId)?.name || 'منتج نهائي',
        status: 'POSTED',
        createdAt: new Date().toISOString()
    };

    try {
        await apiRequest('manufacturing/process', { method: 'POST', body: JSON.stringify(payload) });
        await loadData();
        await refreshData();
        setIsOrderModalOpen(false);
        setOrderForm({
            code: `MFG-${Date.now().toString().slice(-6)}`,
            date: new Date().toISOString().split('T')[0],
            warehouseId: warehouses[0]?.id || '',
            outputItemId: '',
            outputQty: 1,
            expenseType: 'FIXED',
            expenseValue: 0,
            notes: '',
            items: []
        });
        alert("تم التصنيع وترحيل المخزون بنجاح ✅");
    } catch (e: any) { alert(e.message || "فشل الاعتماد"); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-6">
            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                <Factory className="text-blue-600" size={32} /> قسم عمليات التصنيع
            </h2>
            <div className="flex bg-gray-100 p-1 rounded-xl border">
                <button onClick={() => setActiveView('orders')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'orders' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>سجل العمليات</button>
                <button onClick={() => setActiveView('recipes')} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'recipes' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>وصفات الإنتاج (BOM)</button>
            </div>
        </div>
        <div className="flex gap-2">
            <button onClick={() => { setRecipeForm({ name: '', code: '', outputItemId: '', outputQty: 1, unitName: '', notes: '', lines: [] }); setRecipeLines([]); setIsRecipeModalOpen(true); }} className="bg-white text-gray-700 border border-gray-200 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-gray-50 transition">
                <BookOpen size={18} /> وصفة جديدة
            </button>
            <button onClick={() => setIsOrderModalOpen(true)} className="bg-blue-600 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-lg shadow-blue-200 active:scale-95">
              <Plus size={18} /> عملية إنتاج سريعة
            </button>
        </div>
      </div>

      {activeView === 'orders' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
              <div className="p-6 border-b flex justify-between items-center bg-gray-50/50">
                  <h3 className="font-bold text-gray-700 flex items-center gap-2"><History size={20} className="text-blue-500"/> أرشيف الإنتاج والتجميع</h3>
                  <div className="relative w-64">
                      <Search className="absolute right-3 top-2.5 text-gray-400" size={16}/>
                      <input type="text" placeholder="بحث برقم العملية..." className="w-full pr-10 pl-4 py-2 border rounded-xl text-xs" />
                  </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                    <thead className="bg-gray-100/50 text-gray-500 font-black uppercase">
                        <tr>
                            <th className="px-6 py-4">رقم العملية</th>
                            <th className="px-4 py-4">المنتج الناتج</th>
                            <th className="px-4 py-4 text-center">الكمية</th>
                            <th className="px-4 py-4 text-center">تكلفة الوحدة</th>
                            <th className="px-4 py-4 text-center">إجمالي التكلفة</th>
                            <th className="px-4 py-4">المستودع</th>
                            <th className="px-4 py-4 text-center">الحالة</th>
                            <th className="px-6 py-4 text-center">عرض</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {orders.length === 0 ? (
                            <tr><td colSpan={8} className="p-20 text-center text-gray-400 font-bold">لا يوجد عمليات تصنيع مسجلة حالياً</td></tr>
                        ) : (
                            orders.map(order => (
                                <tr key={order.id} className="hover:bg-blue-50/5 transition">
                                    <td className="px-6 py-4 font-mono font-bold text-blue-700">{order.code}</td>
                                    <td className="px-4 py-4 font-black text-gray-800">{order.outputItemName}</td>
                                    <td className="px-4 py-4 text-center font-bold font-numeric text-blue-600 text-sm">{order.outputQty}</td>
                                    <td className="px-4 py-4 text-center font-bold font-numeric">{formatNumber(order.unitCost)} $</td>
                                    <td className="px-4 py-4 text-center font-bold font-numeric text-gray-900">{formatNumber(order.totalCost)} $</td>
                                    <td className="px-4 py-4 text-gray-500 font-bold">{order.warehouseName}</td>
                                    <td className="px-4 py-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${order.status === 'POSTED' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                                            {order.status === 'POSTED' ? 'معتمد' : 'مسودة'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button onClick={() => setViewingOrder(order)} className="p-2 bg-gray-100 text-gray-400 hover:bg-primary hover:text-white rounded-lg transition"><Eye size={16}/></button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
              </div>
          </div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fadeIn">
              {recipes.map(recipe => (
                  <div key={recipe.id} className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 hover:shadow-xl transition-all group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full -translate-x-10 -translate-y-10 group-hover:scale-150 transition-transform"></div>
                      <div className="flex justify-between items-start mb-6">
                        <div className="bg-blue-50 p-3 rounded-2xl text-blue-600 shadow-inner"><BookOpen size={24}/></div>
                        <button onClick={async () => { if (await confirmDialog('حذف الوصفة؟')) { await apiRequest(`manufacturing/recipes/${recipe.id}`, {method:'DELETE'}); loadData(); } }} className="text-gray-200 hover:text-red-500 transition"><Trash2 size={18}/></button>
                      </div>
                      <h3 className="text-lg font-black text-gray-900 mb-1">{recipe.name}</h3>
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4">ينتج: {recipe.outputItemName}</p>
                      
                      <div className="space-y-2 border-t pt-4">
                          <p className="text-[9px] font-black text-gray-400 uppercase mb-2">المكونات ({recipe.lines.length}):</p>
                          <div className="max-h-24 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                              {recipe.lines.map((l, idx) => (
                                  <div key={idx} className="flex justify-between text-[10px] bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                                      <span className="font-bold text-gray-600">{l.inputItemName}</span>
                                      <span className="font-numeric text-blue-700">{l.qtyPerOutput}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              ))}
          </div>
      )}

      {/* --- PRODUCTION ORDER MODAL --- */}
      {isOrderModalOpen && (
          <AdaptiveModal open={isOrderModalOpen} onClose={() => setIsOrderModalOpen(false)} size="xl" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div>
              <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-5xl overflow-hidden animate-fadeIn border-t-8 border-blue-600 flex flex-col max-h-[95vh]">
                  <div className="p-8 bg-gray-900 text-white flex justify-between items-center relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full translate-x-20 -translate-y-20"></div>
                      <div className="relative z-10 flex items-center gap-5">
                          <div className="bg-blue-600 p-4 rounded-[1.5rem] shadow-xl shadow-blue-500/20"><Hammer size={32}/></div>
                          <div>
                            <h3 className="text-2xl font-black">تشغيل عملية إنتاج وتجميع</h3>
                            <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">Short Manufacturing Run v1.1</p>
                          </div>
                      </div>
                      <button onClick={() => setIsOrderModalOpen(false)} className="p-2 hover:bg-rose-500 rounded-full transition relative z-10"><XCircle size={28}/></button>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-10 space-y-10 bg-gray-50/50">
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">رقم التشغيل</label>
                            <input readOnly value={orderForm.code} className="w-full bg-gray-100 border-none rounded-2xl p-4 font-mono font-black text-blue-700" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">تاريخ العملية</label>
                            <input type="date" value={orderForm.date} onChange={e => setOrderForm({...orderForm, date: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-numeric font-bold" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">المستودع (المصدر والهدف)</label>
                            <select value={orderForm.warehouseId} onChange={e => setOrderForm({...orderForm, warehouseId: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-white">
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">الكمية المراد إنتاجها</label>
                            <input type="number" min="1" value={orderForm.outputQty} onChange={e => setOrderForm({...orderForm, outputQty: Number(e.target.value)})} className="w-full border-2 border-blue-200 bg-blue-50/20 rounded-2xl p-4 font-black text-2xl text-center text-blue-900 outline-none focus:border-blue-500 font-numeric" />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h4 className="font-black text-gray-800 flex items-center gap-3"><Layers className="text-blue-500" size={20}/> مواد الاستهلاك والتجميع (BOM)</h4>
                            <select onChange={e => handleLoadRecipeToOrder(e.target.value)} className="bg-white border-2 border-blue-500 text-blue-600 px-6 py-2 rounded-xl font-bold text-xs shadow-sm outline-none">
                                <option value="">-- تحميل من الوصفات المحفوظة --</option>
                                {recipes.map(r => <option key={r.id} value={r.id}>{r.name} ({r.outputItemName})</option>)}
                            </select>
                        </div>
                        
                        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 font-black text-gray-500">
                                    <tr>
                                        <th className="px-8 py-4">المادة الخام</th>
                                        <th className="px-4 py-4 text-center">الكمية المستهلكة</th>
                                        <th className="px-4 py-4 text-center">تكلفة الوحدة</th>
                                        <th className="px-4 py-4 text-center">الإجمالي</th>
                                        <th className="px-8 py-4 text-center">الرصيد المتاح بالمستودع</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {(orderForm.items || []).length === 0 ? (
                                        <tr><td colSpan={5} className="p-10 text-center text-gray-400 font-bold">يرجى اختيار وصفة لبدء التحميل</td></tr>
                                    ) : (
                                        (orderForm.items || []).map((item, idx) => {
                                            const invItem = inventory.find(i => i.id === item.inputItemId && i.warehouseId === orderForm.warehouseId);
                                            const isLow = (invItem?.quantity || 0) < item.inputQty;
                                            return (
                                                <tr key={idx} className={`${isLow ? 'bg-rose-50/50' : ''}`}>
                                                    <td className="px-8 py-4 font-bold text-gray-700">{item.inputItemName}</td>
                                                    <td className="px-4 py-4 text-center font-black font-numeric text-blue-600">{formatNumber(item.inputQty, 2)}</td>
                                                    <td className="px-4 py-4 text-center font-bold text-gray-400">{formatNumber(item.unitCostAtTime)}</td>
                                                    <td className="px-4 py-4 text-center font-black text-gray-900">{formatNumber(item.lineTotalCost)}</td>
                                                    <td className="px-8 py-4 text-center">
                                                        <span className={`px-3 py-1 rounded-lg font-black font-numeric ${isLow ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                                            {invItem?.quantity || 0}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                            <h4 className="font-black text-gray-800 border-b pb-4 flex items-center gap-2"><DollarSign size={18} className="text-orange-500"/> مصاريف تشغيلية إضافية</h4>
                            <div className="flex gap-4">
                                <button type="button" onClick={() => setOrderForm({...orderForm, expenseType: 'FIXED'})} className={`flex-1 py-4 rounded-2xl font-black transition-all ${orderForm.expenseType === 'FIXED' ? 'bg-orange-500 text-white shadow-lg' : 'bg-gray-50 text-gray-400'}`}>مبلغ ثابت</button>
                                <button type="button" onClick={() => setOrderForm({...orderForm, expenseType: 'PERCENT'})} className={`flex-1 py-4 rounded-2xl font-black transition-all ${orderForm.expenseType === 'PERCENT' ? 'bg-orange-500 text-white shadow-lg' : 'bg-gray-50 text-gray-400'}`}>نسبة %</button>
                            </div>
                            <div className="relative">
                                <input type="number" value={orderForm.expenseValue} onChange={e => setOrderForm({...orderForm, expenseValue: Number(e.target.value)})} className="w-full p-5 bg-gray-50 border-2 border-gray-100 rounded-2xl font-black text-2xl text-center outline-none focus:border-orange-500" placeholder="0.00" />
                                <span className="absolute left-6 top-6 font-black text-orange-300">{orderForm.expenseType === 'FIXED' ? '$' : '%'}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 font-bold leading-relaxed flex items-start gap-2 bg-orange-50/30 p-3 rounded-xl">
                                <Info size={16} className="text-orange-400 shrink-0"/> يتم توزيع المصروف آلياً على تكلفة المنتج النهائي بناءً على تكلفة المواد الخام.
                            </p>
                        </div>

                        <div className="bg-gray-900 text-white p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col justify-center">
                            <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-400 to-transparent"></div>
                            <div className="relative z-10 space-y-6">
                                <div className="flex justify-between items-center text-gray-400 text-xs font-black uppercase tracking-widest">
                                    <span>إجمالي تكلفة المواد</span>
                                    <span className="font-numeric text-white">{formatNumber(orderCalculations.materialCost)} $</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-400 text-xs font-black uppercase tracking-widest">
                                    <span>مصروف الإنتاج المحمل</span>
                                    <span className="font-numeric text-orange-400">+{formatNumber(orderCalculations.expenseAmt)} $</span>
                                </div>
                                <div className="border-t border-white/10 pt-6 flex justify-between items-end">
                                    <div>
                                        <p className="text-[10px] font-black text-blue-400 uppercase mb-1">تكلفة الوحدة الواحدة</p>
                                        <h3 className="text-4xl font-black font-numeric text-blue-400">{formatNumber(orderCalculations.unit)} <span className="text-lg opacity-50">$</span></h3>
                                    </div>
                                    <div className="text-left">
                                        <p className="text-[10px] font-black text-gray-500 uppercase mb-1">صافي تكلفة التشغيل</p>
                                        <h3 className="text-2xl font-black font-numeric">{formatNumber(orderCalculations.total)} $</h3>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                  </div>

                  <div className="p-8 bg-white border-t flex justify-end gap-4 shrink-0">
                      <button onClick={() => setIsOrderModalOpen(false)} className="px-10 py-4 text-sm font-black text-gray-400 hover:text-gray-600 transition">إلغاء التشغيل</button>
                      <button onClick={handlePostOrder} disabled={isSubmitting || !orderForm.items?.length || hasInsufficientStock} className="bg-blue-600 text-white px-20 py-5 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-blue-700 transition active:scale-95 disabled:bg-rose-900/50 disabled:cursor-not-allowed">
                          {isSubmitting ? <RefreshCw className="animate-spin" size={24}/> : <CheckCircle2 size={24}/>} 
                          {hasInsufficientStock ? 'لا يمكن الاعتماد: رصيد غير كاف' : 'اعتماد وترحيل الإنتاج'}
                      </button>
                  </div>
              </div>
          </div>
          </AdaptiveModal>
      )}

      {/* --- VIEW ORDER MODAL --- */}
      {viewingOrder && (
          <AdaptiveModal open={!!viewingOrder} onClose={() => setViewingOrder(null)} size="lg" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div>
              <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-4xl overflow-hidden animate-fadeIn border-t-8 border-gray-900">
                  <div className="p-8 bg-gray-50 border-b flex justify-between items-center">
                      <div>
                          <h3 className="text-xl font-black">تفاصيل عملية التصنيع: {viewingOrder.code}</h3>
                          <p className="text-xs text-gray-400 font-bold uppercase">{formatDate(viewingOrder.date)} | {viewingOrder.warehouseName}</p>
                      </div>
                      <button onClick={() => setViewingOrder(null)} className="p-2 hover:bg-rose-100 text-rose-600 rounded-full transition"><X size={24}/></button>
                  </div>
                  <div className="p-8 space-y-8">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                              <p className="text-[10px] font-black text-blue-400 uppercase mb-1">المنتج النهائي</p>
                              <p className="font-bold text-gray-800">{viewingOrder.outputItemName}</p>
                          </div>
                          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                              <p className="text-[10px] font-black text-blue-700 font-numeric">{viewingOrder.outputQty}</p>
                          </div>
                          <div className="bg-gray-900 p-4 rounded-2xl text-white">
                              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">تكلفة الوحدة</p>
                              <p className="font-black text-primary font-numeric">{formatNumber(viewingOrder.unitCost)} $</p>
                          </div>
                          <div className="bg-gray-900 p-4 rounded-2xl text-white">
                              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">إجمالي العملية</p>
                              <p className="font-black text-white font-numeric">{formatNumber(viewingOrder.totalCost)} $</p>
                          </div>
                      </div>

                      <div className="space-y-4">
                          <h4 className="font-black text-gray-700 text-sm">المواد الخام المخصومة (BOM):</h4>
                          <table className="w-full text-right text-xs border rounded-xl overflow-hidden">
                              <thead className="bg-gray-50 text-gray-500 font-black">
                                  <tr>
                                      <th className="p-3">المادة</th>
                                      <th className="p-3 text-center">الكمية</th>
                                      <th className="p-3 text-center">التكلفة وقتها</th>
                                      <th className="px-3 text-center">الإجمالي</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y">
                                  {viewingOrder.items.map((it, idx) => (
                                      <tr key={idx}>
                                          <td className="p-3 font-bold">{it.inputItemName}</td>
                                          <td className="p-3 text-center font-numeric font-bold">{it.inputQty}</td>
                                          <td className="p-3 text-center font-numeric">{formatNumber(it.unitCostAtTime)}</td>
                                          <td className="p-3 text-center font-numeric font-bold">{formatNumber(it.lineTotalCost)}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          </div>
          </AdaptiveModal>
      )}

      {/* --- RECIPE MODAL --- */}
      {isRecipeModalOpen && (
          <div>
              <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl overflow-hidden animate-fadeIn border-t-8 border-gray-800">
                  <div className="p-8 bg-gray-50 border-b flex justify-between items-center">
                      <h3 className="text-xl font-black flex items-center gap-3"><BookOpen size={24}/> إنشاء وصفة تجميع (BOM)</h3>
                      <button onClick={() => setIsRecipeModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition"><XCircle size={24}/></button>
                  </div>
                  <form onSubmit={handleSaveRecipe} className="p-8 space-y-8">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">اسم الوصفة</label>
                            <input required value={recipeForm.name} onChange={e => setRecipeForm({...recipeForm, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary" placeholder="مثلاً: قميص رجالي فاخر..." />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">كود الوصفة</label>
                            <input value={recipeForm.code || ''} onChange={e => setRecipeForm({ ...recipeForm, code: e.target.value })} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary" placeholder="REC-001" />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">المنتج النهائي الناتج</label>
                            <Combobox 
                                items={inventory.map(i => ({ id: i.id, label: i.name, subLabel: i.code }))} 
                                selectedId={recipeForm.outputItemId || ''} 
                                onSelect={(id) => setRecipeForm({...recipeForm, outputItemId: id})} 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">كمية المنتج النهائي</label>
                            <input type="number" step="0.01" value={recipeForm.outputQty || 1} onChange={e => setRecipeForm({ ...recipeForm, outputQty: Number(e.target.value) || 1 })} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary text-center" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">وحدة المنتج</label>
                            <input value={recipeForm.unitName || ''} onChange={e => setRecipeForm({ ...recipeForm, unitName: e.target.value })} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary" placeholder="وحدة" />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase block ml-2">ملاحظات</label>
                            <textarea rows={2} value={recipeForm.notes || ''} onChange={e => setRecipeForm({ ...recipeForm, notes: e.target.value })} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary" />
                        </div>

                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h4 className="font-black text-xs text-gray-500 uppercase tracking-widest">خطوط المكونات (المواد الخام)</h4>
                            <button type="button" onClick={handleAddRecipeLine} className="bg-primary text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase shadow-lg">+ إضافة مكون</button>
                        </div>
                        <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar p-2 bg-gray-50 rounded-2xl border border-gray-100 shadow-inner">
                            {recipeLines.map((line, idx) => (
                                <div key={line.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                                    <div className="md:col-span-6">
                                        <Combobox 
                                            items={inventory.map(i => ({ id: i.id, label: i.name, subLabel: i.code }))} 
                                            selectedId={line.inputItemId} 
                                            onSelect={(id) => updateRecipeLine(idx, 'inputItemId', id)} 
                                        />
                                    </div>
                                    <div className="md:col-span-3">
                                        <input type="number" step="0.01" value={line.qtyPerOutput} onChange={e => updateRecipeLine(idx, 'qtyPerOutput', Number(e.target.value))} className="w-full border-2 border-gray-100 rounded-xl p-2 font-bold text-center" placeholder="الكمية لكل قطعة" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <input type="number" value={line.wastagePct} onChange={e => updateRecipeLine(idx, 'wastagePct', Number(e.target.value))} className="w-full border-2 border-gray-100 rounded-xl p-2 font-bold text-center" placeholder="هدر %" />
                                    </div>
                                    <div className="md:col-span-1 text-center">
                                        <button type="button" onClick={() => setRecipeLines(recipeLines.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 transition"><Trash2 size={18}/></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-6 border-t">
                        <button type="button" onClick={() => setIsRecipeModalOpen(false)} className="px-8 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition">إلغاء</button>
                        <button type="submit" disabled={isSubmitting} className="bg-gray-900 text-white px-12 py-3 rounded-xl font-black shadow-xl hover:bg-black transition flex items-center gap-2">
                           {isSubmitting ? <RefreshCw className="animate-spin" size={20}/> : <Save size={20}/>} حفظ الوصفة
                        </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

export default Manufacturing;

