
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useModalEscape } from '../hooks/useEscapeKey';
import { 
  Package, TrendingUp, Settings, ScanBarcode, 
  Search, X, ArrowRight, BarChart3,
  DollarSign, Users, AlertTriangle, Wallet, Clock,
  FileText, CreditCard, LayoutGrid, ShoppingCart, Boxes, Receipt,
  GripVertical, Check, Briefcase, Factory, ListTree, TrendingDown, Handshake, ClipboardList, Zap, Globe
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { InventoryItem, Invoice, Client, formatNumber } from '../types';
import { BASE_CURRENCY, currencySymbol, invoiceAmountBase, itemCostBase } from '../lib/currencySemantics';
import { ResponsiveActionBar, ResponsivePage } from '../components/responsive';

interface DashboardProps {
  items: InventoryItem[];
  invoices: Invoice[];
  clients: Client[];
  setActiveTab: (tab: string) => void;
}

const ALL_SHORTCUTS: { id: string; label: string; icon: any; color: string }[] = [
  { id: 'invoices', label: 'الفواتير', icon: FileText, color: 'text-green-600 bg-green-50' },
  { id: 'funds', label: 'الصناديق والسندات', icon: CreditCard, color: 'text-emerald-600 bg-emerald-50' },
  { id: 'inventory', label: 'المخزون', icon: Boxes, color: 'text-blue-600 bg-blue-50' },
  { id: 'reports', label: 'التقارير', icon: BarChart3, color: 'text-violet-600 bg-violet-50' },
  { id: 'clients', label: 'العملاء والموردين', icon: Users, color: 'text-orange-600 bg-orange-50' },
  { id: 'stocktaking', label: 'الجرد', icon: ClipboardList, color: 'text-rose-600 bg-rose-50' },
  { id: 'pos', label: 'نقطة البيع', icon: Zap, color: 'text-yellow-600 bg-yellow-50' },
  { id: 'accounts', label: 'شجرة الحسابات', icon: ListTree, color: 'text-emerald-600 bg-emerald-50' },
  { id: 'expenses', label: 'المصاريف', icon: TrendingDown, color: 'text-red-600 bg-red-50' },
  { id: 'partners', label: 'الشركاء', icon: Handshake, color: 'text-indigo-600 bg-indigo-50' },
  { id: 'manufacturing', label: 'التصنيع', icon: Factory, color: 'text-sky-600 bg-sky-50' },
  { id: 'settings', label: 'الإعدادات', icon: Settings, color: 'text-gray-600 bg-gray-100' },
  { id: 'branches_radar', label: 'رادار الفروع', icon: Globe, color: 'text-blue-600 bg-blue-50' },
];

const DEFAULT_SHORTCUTS = ['invoices', 'funds', 'inventory', 'reports', 'clients', 'stocktaking'];

const Dashboard: React.FC<DashboardProps> = ({ items, invoices, clients, setActiveTab }) => {
  const [isInquiryModalOpen, setIsInquiryModalOpen] = useState(false);
  const [inquirySearch, setInquirySearch] = useState('');
  const [selectedInquiryItem, setSelectedInquiryItem] = useState<InventoryItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [time, setTime] = useState(new Date());

  const [lowStockThreshold, setLowStockThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('shamel_low_stock_threshold');
    return saved ? parseInt(saved, 10) : 3;
  });

  const [selectedShortcuts, setSelectedShortcuts] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('shamel_dashboard_shortcuts');
      return saved ? JSON.parse(saved) : DEFAULT_SHORTCUTS;
    } catch { return DEFAULT_SHORTCUTS; }
  });
  const [editingShortcuts, setEditingShortcuts] = useState(false);
  const [chartRange, setChartRange] = useState<'24h' | '7d' | '30d'>('24h');

  useModalEscape(isInquiryModalOpen, useCallback(() => setIsInquiryModalOpen(false), []));
  useModalEscape(showSettings, useCallback(() => setShowSettings(false), []));

  useEffect(() => {
    localStorage.setItem('shamel_low_stock_threshold', lowStockThreshold.toString());
  }, [lowStockThreshold]);

  useEffect(() => {
    localStorage.setItem('shamel_dashboard_shortcuts', JSON.stringify(selectedShortcuts));
  }, [selectedShortcuts]);

  const toggleShortcut = (id: string) => {
    setSelectedShortcuts(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const activeShortcuts = useMemo(() => 
    ALL_SHORTCUTS.filter(s => selectedShortcuts.includes(s.id)),
    [selectedShortcuts]
  );

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getItemQuantity = (item: InventoryItem) => Number(item.quantity ?? item.rollsCount ?? 0);
  const getLowStockLimit = (item: InventoryItem) => Number(item.minStockAlert ?? lowStockThreshold);

  const inventoryValue = useMemo(
    () => items.reduce((sum, item) => sum + (itemCostBase(item) * getItemQuantity(item)), 0),
    [items]
  );
  
  const lowStockCount = useMemo(
    () => items.filter(item => getItemQuantity(item) <= getLowStockLimit(item)).length,
    [items, lowStockThreshold]
  );
  
  const totalEntities = useMemo(() => clients.length, [clients]);
  const totalSales = useMemo(() => invoices.filter(inv => inv.type === 'sale').reduce((sum, inv) => sum + invoiceAmountBase(inv, 'total'), 0), [invoices]);
  const totalPurchases = useMemo(() => invoices.filter(inv => inv.type === 'purchase').reduce((sum, inv) => sum + invoiceAmountBase(inv, 'total'), 0), [invoices]);
  const totalItems = useMemo(() => items.length, [items]);

  const recentInvoices = useMemo(() => {
    return [...invoices]
      .sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime())
      .slice(0, 5);
  }, [invoices]);

  const salesPurchaseTimeline = useMemo(() => {
    const now = new Date();
    const map: Record<string, { sales: number, purchases: number }> = {};

    // Pre-fill all time slots with zeros so the chart always has a full horizontal timeline
    if (chartRange === '24h') {
      for (let i = 23; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 60 * 60 * 1000);
        const key = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}T${String(t.getHours()).padStart(2,'0')}`;
        map[key] = { sales: 0, purchases: 0 };
      }
    } else {
      const days = chartRange === '7d' ? 7 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
        map[key] = { sales: 0, purchases: 0 };
      }
    }

    const cutoff = new Date(now.getTime() - (chartRange === '24h' ? 24 : chartRange === '7d' ? 7 * 24 : 30 * 24) * 60 * 60 * 1000);
    invoices.forEach(inv => {
      const d = inv.date ? new Date(inv.date) : (inv.createdAt ? new Date(inv.createdAt) : null);
      if (!d || isNaN(d.getTime()) || d < cutoff) return;
      let key: string;
      if (chartRange === '24h') {
        key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      if (!map[key]) map[key] = { sales: 0, purchases: 0 };
      const amount = invoiceAmountBase(inv, 'total');
      if (inv.type === 'sale') map[key].sales += amount;
      else if (inv.type === 'purchase') map[key].purchases += amount;
    });

    const sorted = Object.keys(map).sort().map(key => ({ key, ...map[key] }));
    return sorted.map(d => {
      let label: string;
      if (chartRange === '24h') {
        const hour = parseInt(d.key.split('T')[1], 10);
        label = `${hour}:00`;
      } else {
        label = new Date(d.key).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
      }
      return { ...d, label };
    });
  }, [invoices, chartRange]);

  const getInquiryResults = () => {
    if (!inquirySearch) return [];
    const safeSearch = inquirySearch.toLowerCase();
    return (items || []).filter(i => 
      (i?.name || '').toLowerCase().includes(safeSearch) || 
      (i?.code || '').toLowerCase().includes(safeSearch) ||
      (i?.barcode || '').includes(safeSearch)
    );
  };

  const topSellingItems = useMemo(() => {
    const itemNameMap: Record<string, string> = {};
    items.forEach(it => { if (it.id) itemNameMap[it.id] = it.name; });

    const salesMap: Record<string, { name: string, count: number }> = {};
    invoices.filter(inv => inv.type === 'sale').forEach(inv => {
      const parsed = Array.isArray(inv.items) ? inv.items : (() => { try { return JSON.parse(inv.items as any) } catch { return [] } })();
      (parsed || []).forEach((it: any) => {
        const key = it.itemId || it.itemName || it.name;
        const resolvedName = (it.itemId && itemNameMap[it.itemId]) || it.itemName || it.name || key;
        if (!salesMap[key]) salesMap[key] = { name: resolvedName, count: 0 };
        salesMap[key].count += Number(it.quantity || 1);
      });
    });
    return Object.values(salesMap).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [invoices, items]);

  return (
    <ResponsivePage className="bg-gray-50 min-h-full" contentClassName="py-3 md:py-6" maxWidth="wide">
    <div className="space-y-4 md:space-y-5 min-h-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">لوحة التحكم</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500 font-bold flex items-center gap-1.5">
              <Clock size={13} className="text-primary"/>
              {time.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="w-1 h-1 rounded-full bg-gray-300"></span>
            <span className="text-sm text-gray-400 font-bold">
              {new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>
        <ResponsiveActionBar>
          <button onClick={() => { setIsInquiryModalOpen(true); setSelectedInquiryItem(null); setInquirySearch(''); }} className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-xs font-bold hover:bg-black transition active:scale-95 shadow-sm">
            <ScanBarcode size={15}/>
            استعلام سريع
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className={`p-2.5 rounded-xl border transition-all ${showSettings ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 hover:text-gray-700 border-gray-200'}`}>
            <Settings size={18} />
          </button>
        </ResponsiveActionBar>
      </div>

      {showSettings && (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn space-y-4">
          {/* Low stock threshold */}
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-xs font-bold text-gray-500">حد تنبيه النواقص:</label>
            <input type="number" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Math.max(1, parseInt(e.target.value) || 0))} className="border border-gray-200 rounded-lg p-2 w-24 text-center font-bold text-primary bg-white focus:border-primary focus:ring-0 outline-none text-sm" />
            <button onClick={() => setShowSettings(false)} className="text-xs text-gray-400 hover:text-rose-500 font-bold mr-auto">إغلاق</button>
          </div>
          {/* Quick access customization */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-500">تخصيص الوصول السريع:</label>
              <span className="text-[10px] text-gray-400">{selectedShortcuts.length} مختار</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_SHORTCUTS.map(s => {
                const active = selectedShortcuts.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleShortcut(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      active 
                        ? 'border-primary bg-primary/5 text-primary' 
                        : 'border-gray-200 bg-gray-50 text-gray-400 hover:text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {active && <Check size={12}/>}
                    <s.icon size={13}/>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards - 2 rows */}
      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4">
        {/* Inventory Value */}
        <div onClick={() => setActiveTab('inventory')} className="bg-white rounded-2xl p-4 border border-gray-100 hover:border-emerald-200 hover:shadow-lg transition-all cursor-pointer group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-all">
              <Wallet size={20}/>
            </div>
            <ArrowRight size={14} className="text-gray-300 group-hover:text-emerald-500 transition-colors rotate-180"/>
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">قيمة المخزون</p>
          <p className="text-xl font-black text-gray-900 font-numeric">{formatNumber(inventoryValue)} <span className="text-xs text-emerald-500 font-bold">{BASE_CURRENCY}</span></p>
        </div>

        {/* Total Sales */}
        <div onClick={() => setActiveTab('invoices')} className="bg-white rounded-2xl p-4 border border-gray-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
              <TrendingUp size={20}/>
            </div>
            <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors rotate-180"/>
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">إجمالي المبيعات</p>
          <p className="text-xl font-black text-gray-900 font-numeric">{formatNumber(totalSales)} <span className="text-xs text-blue-500 font-bold">{BASE_CURRENCY}</span></p>
        </div>

        {/* Clients */}
        <div onClick={() => setActiveTab('clients')} className="bg-white rounded-2xl p-4 border border-gray-100 hover:border-violet-200 hover:shadow-lg transition-all cursor-pointer group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition-all">
              <Users size={20}/>
            </div>
            <ArrowRight size={14} className="text-gray-300 group-hover:text-violet-500 transition-colors rotate-180"/>
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">العملاء والموردين</p>
          <p className="text-xl font-black text-gray-900 font-numeric">{totalEntities}</p>
        </div>

        {/* Low Stock */}
        <div onClick={() => setActiveTab('stocktaking')} className={`bg-white rounded-2xl p-4 border hover:shadow-lg transition-all cursor-pointer group ${lowStockCount > 0 ? 'border-rose-200' : 'border-gray-100 hover:border-amber-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${lowStockCount > 0 ? 'bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white' : 'bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white'}`}>
              <AlertTriangle size={20}/>
            </div>
            {lowStockCount > 0 && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>}
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">تنبيهات النواقص</p>
          <p className={`text-xl font-black font-numeric ${lowStockCount > 0 ? 'text-rose-600' : 'text-gray-900'}`}>{lowStockCount}</p>
        </div>
      </div>

      {/* Second row: smaller stat pills */}
      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-3">
        <div className="bg-gradient-to-l from-green-50 to-white rounded-xl px-4 py-3 border border-green-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-green-600">فواتير المبيعات</p>
            <p className="font-black text-green-800 font-numeric text-lg">{invoices.filter(i => i.type === 'sale').length}</p>
          </div>
          <ShoppingCart size={18} className="text-green-300"/>
        </div>
        <div className="bg-gradient-to-l from-blue-50 to-white rounded-xl px-4 py-3 border border-blue-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-blue-600">فواتير المشتريات</p>
            <p className="font-black text-blue-800 font-numeric text-lg">{invoices.filter(i => i.type === 'purchase').length}</p>
          </div>
          <Receipt size={18} className="text-blue-300"/>
        </div>
        <div className="bg-gradient-to-l from-purple-50 to-white rounded-xl px-4 py-3 border border-purple-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-purple-600">إجمالي المواد</p>
            <p className="font-black text-purple-800 font-numeric text-lg">{totalItems}</p>
          </div>
          <Boxes size={18} className="text-purple-300"/>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Sales vs Purchases Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
                  <TrendingUp size={16} className="text-primary"/>
                  حركة المبيعات والمشتريات
                </h3>
                <p className="text-[10px] text-gray-400 font-bold mt-0.5">{chartRange === '24h' ? 'آخر 24 ساعة' : chartRange === '7d' ? 'آخر 7 أيام' : 'آخر 30 يوم'}</p>
              </div>
              <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                {([['24h','24س'],['7d','7ي'],['30d','30ي']] as const).map(([val, lbl]) => (
                  <button key={val} onClick={() => setChartRange(val as any)} className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${chartRange === val ? 'bg-white text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>{lbl}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-[3px] rounded-full bg-emerald-500"></span>
                <span className="text-[10px] font-bold text-gray-500">مبيعات</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-[3px] rounded-full bg-rose-500"></span>
                <span className="text-[10px] font-bold text-gray-500">مشتريات</span>
              </div>
            </div>
          </div>
          {salesPurchaseTimeline.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-300">
              <div className="text-center">
                <BarChart3 size={40} className="mx-auto mb-2 opacity-30"/>
                <p className="text-xs font-bold">لا توجد بيانات كافية للرسم البياني</p>
              </div>
            </div>
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="99%" height="100%">
                <AreaChart data={salesPurchaseTimeline} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02}/>
                    </linearGradient>
                    <linearGradient id="gradPurchases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2}/>
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} fontWeight="600" tickLine={false} axisLine={false} />
                  <YAxis stroke="#9ca3af" fontSize={10} fontWeight="600" tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip 
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 8px 30px rgb(0 0 0 / 0.12)', fontWeight: 'bold', fontSize: '11px', direction: 'rtl'}}
                    formatter={(value: number, name: string) => [formatNumber(value) + ` ${BASE_CURRENCY}`, name === 'sales' ? 'المبيعات' : 'المشتريات']}
                    labelFormatter={(label) => label}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="sales" 
                    stroke="#10b981" 
                    strokeWidth={2.5} 
                    fill="url(#gradSales)" 
                    dot={false}
                    activeDot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="purchases" 
                    stroke="#f43f5e" 
                    strokeWidth={2} 
                    strokeDasharray="6 3"
                    fill="url(#gradPurchases)" 
                    dot={false}
                    activeDot={{ r: 4, fill: '#f43f5e', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Quick Navigation + Top Selling */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black text-gray-700">وصول سريع</h3>
              <button onClick={() => { setShowSettings(true); }} className="text-[10px] text-gray-400 hover:text-primary font-bold">تخصيص</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {activeShortcuts.map(item => (
                <button key={item.id} onClick={() => setActiveTab(item.id)} className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all text-right group">
                  <div className={`w-8 h-8 rounded-lg ${item.color} flex items-center justify-center shrink-0`}>
                    <item.icon size={15}/>
                  </div>
                  <span className="text-xs font-bold text-gray-700 group-hover:text-gray-900 transition-colors">{item.label}</span>
                </button>
              ))}
              {activeShortcuts.length === 0 && (
                <p className="col-span-2 text-xs text-gray-400 text-center py-3">اضغط "تخصيص" لاختيار الاختصارات</p>
              )}
            </div>
          </div>

          {/* Recent Invoices */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-black text-gray-700">آخر الفواتير</h3>
              <button onClick={() => setActiveTab('invoices')} className="text-[10px] font-bold text-primary hover:underline">عرض الكل</button>
            </div>
            <div className="space-y-2">
              {recentInvoices.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">لا توجد فواتير</p>
              ) : (
                recentInvoices.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${inv.type === 'sale' ? 'bg-green-50 text-green-600' : inv.type === 'purchase' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                        {inv.type === 'sale' ? 'ب' : inv.type === 'purchase' ? 'ش' : 'م'}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-800 leading-tight">{inv.clientName || 'نقدي'}</p>
                        <p className="text-[10px] text-gray-400">{inv.date ? new Date(inv.date).toLocaleDateString('ar-EG') : ''}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-black font-numeric ${inv.type === 'sale' ? 'text-green-600' : 'text-blue-600'}`}>
                      {formatNumber(invoiceAmountBase(inv, 'total'))} {BASE_CURRENCY}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Top Selling Items */}
      {topSellingItems.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="text-sm font-black text-gray-800 flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-primary"/>
            أكثر المواد مبيعاً
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {topSellingItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-200 text-gray-600' : 'bg-orange-50 text-orange-500'}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-800 truncate">{item.name}</p>
                  <p className="text-[10px] text-gray-400 font-bold font-numeric">{item.count} وحدة</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inquiry Modal */}
      {isInquiryModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[500] animate-fadeIn p-4" onClick={e => e.target === e.currentTarget && setIsInquiryModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-l from-gray-900 to-gray-800 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><ScanBarcode size={18}/></div>
                <div>
                  <h3 className="text-sm font-black">الاستعلام السريع</h3>
                  <p className="text-[10px] text-gray-400 font-bold">بحث في المخزون</p>
                </div>
              </div>
              <button onClick={() => setIsInquiryModalOpen(false)} className="text-white/40 hover:text-white p-2 rounded-lg hover:bg-white/10 transition"><X size={18}/></button>
            </div>
            {/* Search */}
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute right-3.5 top-3 text-gray-400" size={18} />
                <input 
                  autoFocus 
                  type="text" 
                  placeholder="اسم المادة، الكود، أو الباركود..." 
                  className="w-full pr-10 pl-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-primary transition-all bg-gray-50 focus:bg-white font-bold" 
                  value={inquirySearch} 
                  onChange={e => setInquirySearch(e.target.value)} 
                />
              </div>
            </div>
            {/* Results */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className="space-y-2">
                {getInquiryResults().length === 0 ? (
                  <div className="text-center py-12 text-gray-300 flex flex-col items-center gap-3">
                    <Package size={48} className="opacity-20"/>
                    <p className="font-bold text-sm text-gray-400">{inquirySearch ? 'لا توجد نتائج' : 'ابدأ بالكتابة للبحث...'}</p>
                  </div>
                ) : (
                  getInquiryResults().map(item => (
                    <div key={item.id} onClick={() => setSelectedInquiryItem(item)} className={`p-3.5 rounded-xl cursor-pointer border transition-all flex justify-between items-center group ${selectedInquiryItem?.id === item.id ? 'border-primary bg-primary/5' : 'border-gray-100 hover:border-gray-200 bg-white hover:bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 group-hover:text-primary transition-colors"><Package size={18}/></div>
                        <div>
                          <div className="font-bold text-gray-900 text-sm">{item.name}</div>
                          <div className="text-[10px] text-gray-400 font-mono font-bold mt-0.5">{item.code} | {item.warehouseName || 'غير محدد'}</div>
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="font-black text-primary font-numeric text-lg">{getItemQuantity(item)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {/* Detail Footer */}
            {selectedInquiryItem && (
              <div className="p-4 bg-gray-50 border-t border-gray-100 animate-fadeIn shrink-0">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white p-3 rounded-xl text-center border border-gray-100">
                    <div className="text-[9px] text-green-600 font-bold mb-0.5">سعر المفرق</div>
                    <div className="font-black text-green-800 font-numeric text-lg">{selectedInquiryItem.salePrice} {currencySymbol((selectedInquiryItem as any).priceCurrency)}</div>
                  </div>
                  <div className="bg-white p-3 rounded-xl text-center border border-gray-100">
                    <div className="text-[9px] text-orange-600 font-bold mb-0.5">سعر الجملة</div>
                    <div className="font-black text-orange-800 font-numeric text-lg">{selectedInquiryItem.wholesalePrice || selectedInquiryItem.salePrice} {currencySymbol((selectedInquiryItem as any).priceCurrency)}</div>
                  </div>
                  <div className="bg-gray-900 p-3 rounded-xl text-center">
                    <div className="text-[9px] text-gray-400 font-bold mb-0.5">الموديل</div>
                    <div className="font-black text-white font-numeric text-lg">{selectedInquiryItem.model || '---'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </ResponsivePage>
  );
};
export default Dashboard;
