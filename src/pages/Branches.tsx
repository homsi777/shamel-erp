
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
    LayoutGrid, Plus, Globe, Monitor, User, Info, 
    RefreshCw, Wifi, WifiOff, Settings2, Trash2, 
    ArrowUpRight, ShoppingBag, Package, DollarSign, Bell,
    Building2, X, CheckCircle2, AlertCircle, History, TrendingUp, ChevronLeft
} from 'lucide-react';
import { RemoteBranch, formatNumber, formatDate } from '../types';
import { apiRequest } from '../lib/api';

const Branches: React.FC<{ setActiveTab?: (tab: string) => void }> = ({ setActiveTab }) => {
    const [remoteBranches, setRemoteBranches] = useState<RemoteBranch[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState<RemoteBranch | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [form, setForm] = useState<Partial<RemoteBranch>>({
        name: '', employeeName: '', ipAddress: '', syncInterval: 30,
        showFinancials: true, showInventory: true, showInvoices: true,
        connectionMode: 'server'
    });

    const lastStatusRef = useRef<Record<string, string>>({});

    const computeClientStatus = (branch: RemoteBranch) => {
        if (branch.connectionMode !== 'client') return branch.status;
        if (!branch.lastSeen) return 'offline';
        const last = new Date(branch.lastSeen).getTime();
        if (!Number.isFinite(last)) return 'offline';
        const age = Date.now() - last;
        return age <= 90000 ? 'online' : 'offline';
    };

    const loadRemoteBranches = async () => {
        try {
            const data = await apiRequest('remote-branches').catch(() => []);
            const normalized = (data || []).map((branch: RemoteBranch) => ({
                ...branch,
                connectionMode: branch.connectionMode || 'server',
                status: branch.connectionMode === 'client' ? computeClientStatus(branch) : (branch.status || 'offline'),
                employeeName: branch.employeeName || branch.userName || '',
                ipAddress: branch.ipAddress || 'unknown'
            }));
            setRemoteBranches(normalized);
        } catch (e) {}
    };

    useEffect(() => { loadRemoteBranches(); }, []);
    useEffect(() => {
        const timer = setInterval(loadRemoteBranches, 20000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if ("Notification" in window) {
            Notification.requestPermission();
        }
    }, []);

    const sendBranchNotification = (branchName: string) => {
        if (Notification.permission === "granted") {
            new Notification("رادار الفروع: اتصال جديد", {
                body: `الفرع (${branchName}) متصل الآن ونشط على الشبكة.`,
                icon: "/logo.png"
            });
        }
    };

    useEffect(() => {
        const intervals = remoteBranches.map(branch => {
                const ping = async () => {
                    if (branch.connectionMode === 'client') {
                        return;
                    }
                const buildUrl = (addr: string) => {
                    let base = String(addr || '').trim();
                    if (!base) return '';
                    if (!base.startsWith('http')) base = `http://${base}`;
                    try {
                        const u = new URL(base);
                        const port = u.port || '3333';
                        return `${u.protocol}//${u.hostname}:${port}/api/system/summary`;
                    } catch {
                        return `http://${addr}:3333/api/system/summary`;
                    }
                };
                const url = buildUrl(branch.ipAddress);
                if (!url) return;
                try {
                    const response = await axios.get(url, { timeout: 5000 });
                    const newData = response.data;

                    if (newData && !newData.error) {
                        if (lastStatusRef.current[branch.id] === 'offline') {
                            sendBranchNotification(branch.name);
                        }
                        
                        lastStatusRef.current[branch.id] = 'online';
                        setRemoteBranches(prev => prev.map(b => 
                            b.id === branch.id ? { ...b, status: 'online', data: newData, lastSeen: new Date().toISOString() } : b
                        ));

                        // تحديث الفرع المختار إذا كانت نافذة التفاصيل مفتوحة
                        if (selectedBranch?.id === branch.id) {
                            setSelectedBranch(prev => prev ? { ...prev, status: 'online', data: newData } : null);
                        }
                    } else { throw new Error(); }
                } catch (err) {
                    lastStatusRef.current[branch.id] = 'offline';
                    setRemoteBranches(prev => prev.map(b => 
                        b.id === branch.id ? { ...b, status: 'offline' } : b
                    ));
                    if (selectedBranch?.id === branch.id) {
                        setSelectedBranch(prev => prev ? { ...prev, status: 'offline' } : null);
                    }
                }
            };
            ping();
            return setInterval(ping, branch.syncInterval * 1000);
        });
        return () => intervals.forEach(clearInterval);
    }, [remoteBranches.length, selectedBranch?.id]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        const newBranch: RemoteBranch = {
            id: `rb-${Date.now()}`,
            name: form.name!,
            employeeName: form.employeeName!,
            ipAddress: form.ipAddress!,
            syncInterval: Number(form.syncInterval),
            showFinancials: !!form.showFinancials,
            showInventory: !!form.showInventory,
            showInvoices: !!form.showInvoices,
            connectionMode: form.connectionMode || 'server',
            status: 'offline'
        };
        try {
            await apiRequest('remote-branches', { method: 'POST', body: JSON.stringify(newBranch) });
            setRemoteBranches(prev => [...prev, newBranch]);
            setIsModalOpen(false);
            setForm({ name: '', employeeName: '', ipAddress: '', syncInterval: 30, showFinancials: true, showInventory: true, showInvoices: true, connectionMode: 'server' });
        } catch (e) { alert("فشل الحفظ"); }
        finally { setIsSaving(false); }
    };

    const serverBranches = remoteBranches.filter(b => (b.connectionMode || 'server') === 'server');
    const clientBranches = remoteBranches.filter(b => (b.connectionMode || 'server') === 'client');

    return (
        <div className="p-6 space-y-6 bg-gray-50 min-h-screen animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                <div className="flex items-center gap-5">
                    <div className="bg-primary/10 p-4 rounded-3xl text-primary shadow-inner">
                        <Globe size={32} className="animate-pulse" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 tracking-tight">رادار الفروع الموزعة</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">Live Distributed Monitoring System</p>
                    </div>
                </div>
                <button onClick={() => setIsModalOpen(true)} className="bg-gray-900 text-white px-10 py-3 rounded-2xl font-black shadow-xl hover:bg-black transition transform active:scale-95 flex items-center gap-3">
                    <Plus size={20}/> ربط فرع بعيد جديد
                </button>
                {setActiveTab && (
                    <button onClick={() => setActiveTab('agents')} className="bg-sky-50 text-sky-700 px-8 py-3 rounded-2xl font-black shadow-sm border border-sky-200 hover:bg-sky-100 transition flex items-center gap-3">
                        <User size={20}/> المناديب
                    </button>
                )}
            </div>

            {/* Stats Summary Area */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="bg-green-100 text-green-600 p-3 rounded-2xl"><Wifi size={24}/></div>
                    <div><p className="text-[10px] font-black text-gray-400 uppercase">فروع متصلة</p><h3 className="text-2xl font-black text-gray-900 font-numeric">{serverBranches.filter(b=>b.status==='online').length}</h3></div>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="bg-red-100 text-red-600 p-3 rounded-2xl"><WifiOff size={24}/></div>
                    <div><p className="text-[10px] font-black text-gray-400 uppercase">فروع منقطعة</p><h3 className="text-2xl font-black text-gray-900 font-numeric">{serverBranches.filter(b=>b.status==='offline').length}</h3></div>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="bg-emerald-100 text-emerald-600 p-3 rounded-2xl"><Monitor size={24}/></div>
                    <div><p className="text-[10px] font-black text-gray-400 uppercase">أجهزة متصلة</p><h3 className="text-2xl font-black text-gray-900 font-numeric">{clientBranches.filter(b=>b.status==='online').length}</h3></div>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="bg-orange-100 text-orange-600 p-3 rounded-2xl"><Monitor size={24}/></div>
                    <div><p className="text-[10px] font-black text-gray-400 uppercase">أجهزة غير متصلة</p><h3 className="text-2xl font-black text-gray-900 font-numeric">{clientBranches.filter(b=>b.status==='offline').length}</h3></div>
                </div>
            </div>

            {/* Branches Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {remoteBranches.length === 0 ? (
                    <div className="col-span-full py-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-200">
                        <Monitor size={64} className="mx-auto text-gray-100 mb-4"/>
                        <p className="text-gray-400 font-bold">لا توجد فروع بعيدة مضافة حالياً. ابدأ بربط أول فرع للمراقبة الحية.</p>
                    </div>
                ) : (
                    remoteBranches.map(branch => (
                        <div 
                            key={branch.id} 
                            onClick={() => setSelectedBranch(branch)}
                            className={`bg-white rounded-[2.5rem] p-8 shadow-sm border-t-[12px] transition-all group relative overflow-hidden cursor-pointer hover:shadow-2xl hover:scale-[1.02] active:scale-95 ${branch.status === 'online' ? 'border-green-500 shadow-green-100' : 'border-red-500 shadow-red-100 opacity-80'}`}
                        >
                            
                            <div className="absolute top-4 left-4">
                                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${branch.status === 'online' ? 'bg-green-50 text-green-600 animate-pulse' : 'bg-red-50 text-red-600'}`}>
                                    {branch.status === 'online' ? <Wifi size={12}/> : <WifiOff size={12}/>}
                                    {branch.status === 'online' ? 'نشط الآن' : 'غير متصل'}
                                </div>
                            </div>

                            {branch.connectionMode === 'client' && (
                                <div className="absolute top-4 right-4">
                                    <div className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter bg-blue-50 text-blue-600">وضع عميل</div>
                                </div>
                            )}

                            <div className="flex items-center gap-5 mb-8 mt-2">
                                <div className={`p-4 rounded-3xl shadow-inner ${branch.status === 'online' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                    <Building2 size={32}/>
                                </div>
                                <div>
                                    <h3 className="text-2xl font-black text-gray-900 leading-tight">{branch.name}</h3>
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400">
                                        <User size={12}/> المسئول: {branch.employeeName}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 mb-8">
                                <div className="flex items-center justify-between text-xs font-bold text-gray-400 bg-gray-50 p-3 rounded-2xl">
                                    <span className="flex items-center gap-2"><Globe size={14}/> IP العنوان:</span>
                                    <span className="font-mono text-gray-700">{branch.ipAddress}</span>
                                </div>
                            {branch.connectionMode === 'client' && (
                                <div className="grid grid-cols-2 gap-3 animate-fadeIn">
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">آخر نشاط</p>
                                        <div className="font-black text-slate-900 text-sm">{branch.lastSeen ? formatDate(branch.lastSeen) : 'غير معروف'}</div>
                                    </div>
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">نوع الجهاز</p>
                                        <div className="font-black text-slate-900 text-sm">{branch.deviceLabel || branch.clientName || 'متصفح'}</div>
                                    </div>
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">اسم الفرع</p>
                                        <div className="font-black text-slate-900 text-sm">{branch.branchName || 'غير محدد'}</div>
                                    </div>
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">رقم الجلسة</p>
                                        <div className="font-black text-slate-900 text-sm font-mono">{branch.sessionId || '—'}</div>
                                    </div>
                                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 col-span-2">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">آخر عملية بيع</p>
                                        <div className="font-black text-slate-900 text-sm">
                                            {branch.lastInvoiceNumber ? `#${branch.lastInvoiceNumber}` : 'غير متوفر'}
                                            {branch.lastInvoiceAt ? ` • ${formatDate(branch.lastInvoiceAt)}` : ''}
                                        </div>
                                    </div>
                                </div>
                            )}
                                {branch.status === 'online' && branch.data && branch.connectionMode !== 'client' ? (
                                    <div className="grid grid-cols-2 gap-3 animate-fadeIn">
                                        {branch.showFinancials && (
                                            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                                                <p className="text-[9px] font-black text-emerald-600 uppercase mb-1">مبيعات اليوم</p>
                                                <div className="font-black text-emerald-900 font-numeric text-lg">{formatNumber(branch.data.totalSales)} $</div>
                                            </div>
                                        )}
                                        {branch.showInventory && (
                                            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                                                <p className="text-[9px] font-black text-blue-600 uppercase mb-1">أصناف المخزن</p>
                                                <div className="font-black text-blue-900 font-numeric text-lg">{branch.data.itemsCount}</div>
                                            </div>
                                        )}
                                        {branch.data?.agentActiveCount !== undefined && (
                                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                                <p className="text-[9px] font-black text-slate-500 uppercase mb-1">مندوبون نشطون</p>
                                                <div className="font-black text-slate-900 font-numeric text-lg">{branch.data.agentActiveCount}</div>
                                            </div>
                                        )}
                                        {branch.data?.agentOnlineCount !== undefined && (
                                            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                                                <p className="text-[9px] font-black text-emerald-600 uppercase mb-1">مندوبون متصلون</p>
                                                <div className="font-black text-emerald-900 font-numeric text-lg">{branch.data.agentOnlineCount}</div>
                                            </div>
                                        )}
                                    </div>
                                ) : branch.status === 'offline' && (
                                    <div className="p-6 bg-red-50 rounded-2xl text-center border border-red-100">
                                        <AlertCircle className="mx-auto text-red-400 mb-2" size={24}/>
                                        <p className="text-[10px] text-red-600 font-bold uppercase tracking-widest">انتظار الاتصال...</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between pt-6 border-t border-gray-100 group-hover:border-primary/20">
                                <div className="text-[9px] font-bold text-gray-400">تحديث تلقائي: {branch.syncInterval}ث</div>
                                <div className="flex items-center gap-1 text-primary font-black text-[10px] uppercase">عرض التفاصيل <ChevronLeft size={14}/></div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* --- MODAL: BRANCH DEEP DIVE --- */}
            {selectedBranch && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[510] p-4 animate-fadeIn">
                    <div className="bg-white rounded-[3.5rem] shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden relative border-t-[12px] border-primary">
                        
                        <div className="p-8 bg-gray-900 text-white flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-6">
                                <div className={`p-4 rounded-3xl shadow-xl ${selectedBranch.status === 'online' ? 'bg-green-600 animate-pulse' : 'bg-red-600'}`}>
                                    <Building2 size={40}/>
                                </div>
                                <div>
                                    <h2 className="text-3xl font-black">{selectedBranch.name}</h2>
                                    <div className="flex items-center gap-4 text-sm font-bold text-gray-400 mt-1">
                                        <span className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-full"><Globe size={14}/> {selectedBranch.ipAddress}</span>
                                        <span className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-full"><User size={14}/> {selectedBranch.employeeName}</span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setSelectedBranch(null)} className="p-3 bg-white/10 hover:bg-rose-500 rounded-full transition"><X size={28}/></button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-10 bg-gray-50/50 space-y-8">
                            
                            {/* Stats Snapshot */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">إجمالي مبيعات اليوم</p>
                                    <h3 className="text-3xl font-black text-emerald-600 font-numeric">{formatNumber(selectedBranch.data?.totalSales || 0)} $</h3>
                                </div>
                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">عدد الفواتير</p>
                                    <h3 className="text-3xl font-black text-orange-600 font-numeric">{selectedBranch.data?.invoicesCount || 0}</h3>
                                </div>
                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">أصناف المخزن</p>
                                    <h3 className="text-3xl font-black text-blue-600 font-numeric">{selectedBranch.data?.itemsCount || 0}</h3>
                                </div>
                                <div className="bg-gray-900 p-6 rounded-[2rem] shadow-xl flex flex-col justify-center items-center text-center">
                                    <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-2">حالة الاتصال</p>
                                    <div className={`flex items-center gap-2 text-lg font-black ${selectedBranch.status === 'online' ? 'text-green-400' : 'text-red-400'}`}>
                                        {selectedBranch.status === 'online' ? <Wifi/> : <WifiOff/>}
                                        {selectedBranch.status === 'online' ? 'مستقر ومزامن' : 'منقطع'}
                                    </div>
                                </div>
                            </div>

                            {selectedBranch.data?.agentActiveCount !== undefined && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">مندوبون نشطون</p>
                                        <h3 className="text-3xl font-black text-slate-700 font-numeric">{selectedBranch.data?.agentActiveCount || 0}</h3>
                                    </div>
                                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">مندوبون متصلون</p>
                                        <h3 className="text-3xl font-black text-emerald-600 font-numeric">{selectedBranch.data?.agentOnlineCount || 0}</h3>
                                    </div>
                                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col justify-between">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">مخزون المناديب</p>
                                        <h3 className="text-3xl font-black text-blue-600 font-numeric">{formatNumber(selectedBranch.data?.agentInventoryQty || 0)}</h3>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Recent Activity */}
                                <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 flex flex-col space-y-6">
                                    <h4 className="font-black text-gray-800 text-lg flex items-center gap-3 border-b pb-4">
                                        <History size={24} className="text-primary"/> سجل المبيعات الأخيرة بالفرع
                                    </h4>
                                    <div className="space-y-4">
                                        {!selectedBranch.data?.recentInvoices || selectedBranch.data.recentInvoices.length === 0 ? (
                                            <div className="py-12 text-center text-gray-300 italic font-bold">لا يوجد فواتير مسجلة اليوم</div>
                                        ) : (
                                            selectedBranch.data.recentInvoices.map((inv: any) => (
                                                <div key={inv.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl hover:bg-primary/5 transition group">
                                                    <div className="flex items-center gap-4">
                                                        <div className="bg-white p-2.5 rounded-xl shadow-sm group-hover:text-primary transition-colors"><ShoppingBag size={18}/></div>
                                                        <div>
                                                            <div className="font-black text-gray-800 text-sm">#{inv.invoiceNumber}</div>
                                                            <div className="text-[10px] font-bold text-gray-400">{formatDate(inv.createdAt, true)}</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-left">
                                                        <div className="font-black text-lg font-numeric text-primary">{formatNumber(inv.totalAmount)} $</div>
                                                        <div className="text-[9px] font-black text-gray-400 uppercase">{inv.clientName}</div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* Most Sold Items */}
                                <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 flex flex-col space-y-6">
                                    <h4 className="font-black text-gray-800 text-lg flex items-center gap-3 border-b pb-4">
                                        <TrendingUp size={24} className="text-orange-500"/> الأصناف الأكثر حركة (Top Velocity)
                                    </h4>
                                    <div className="space-y-6">
                                        {!selectedBranch.data?.topSelling || selectedBranch.data.topSelling.length === 0 ? (
                                            <div className="py-12 text-center text-gray-300 italic font-bold">بانتظار حركة المبيعات...</div>
                                        ) : (
                                            selectedBranch.data.topSelling.map((item: any, idx: number) => (
                                                <div key={idx} className="space-y-2">
                                                    <div className="flex justify-between items-center text-sm">
                                                        <span className="font-black text-gray-700">{item.name}</span>
                                                        <span className="font-black text-orange-600 font-numeric">{item.qty} قطعة</span>
                                                    </div>
                                                    <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden shadow-inner">
                                                        <div 
                                                            className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-1000 shadow-lg"
                                                            style={{ width: `${Math.min(100, (item.qty / 50) * 100)}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    <div className="mt-auto p-5 bg-orange-50 rounded-[1.5rem] border border-orange-100 flex items-start gap-3">
                                        <Info size={20} className="text-orange-400 shrink-0"/>
                                        <p className="text-[10px] text-orange-800 font-bold leading-relaxed">
                                            ملاحظة: هذه البيانات مستخرجة لحظياً من قاعدة بيانات الفرع البعيد، تعكس أداء آخر 24 ساعة من العمل.
                                        </p>
                                    </div>
                                </div>
                            </div>

                        </div>

                        <div className="p-8 bg-gray-50 border-t flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-tighter">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-ping"></div>
                                تحديث مستمر: كل {selectedBranch.syncInterval} ثانية
                            </div>
                            <button onClick={() => setSelectedBranch(null)} className="bg-gray-900 text-white px-12 py-3 rounded-2xl font-black text-sm shadow-xl hover:bg-black transition transform active:scale-95">إغلاق نافذة المراقبة</button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: ADD REMOTE BRANCH */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[500] p-4 animate-fadeIn">
                    <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
                        <div className="p-8 bg-gray-900 text-white flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-xl font-black flex items-center gap-3"><Globe className="text-primary"/> ربط فرع بعيد عبر الشبكة</h3>
                                <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">Network Node Configuration</p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-rose-500 rounded-full transition"><X size={28}/></button>
                        </div>
                        
                        <form onSubmit={handleSave} className="p-10 space-y-8 bg-white flex-1 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-2">
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase">اسم الفرع (مثلاً: فرع حلب - الجميلية)</label>
                                    <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-black text-lg focus:border-primary outline-none transition" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">اسم الموظف المسئول</label>
                                    <input required value={form.employeeName} onChange={e => setForm({...form, employeeName: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold outline-none focus:border-primary" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">عنوان IP الفرع البعيد</label>
                                    <input required dir="ltr" placeholder="192.168.1.50" value={form.ipAddress} onChange={e => setForm({...form, ipAddress: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-mono font-black text-lg text-center outline-none focus:border-blue-500" />
                                </div>
                            </div>

                            <div className="bg-gray-50 p-8 rounded-[2rem] border border-gray-100 space-y-6">
                                <h4 className="font-black text-gray-700 text-sm flex items-center gap-2 border-b pb-3"><Monitor size={18} className="text-primary"/> تخصيص البيانات المسموحة للمراقبة</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <label className={`flex flex-col items-center gap-3 p-4 border-2 rounded-2xl cursor-pointer transition ${form.showFinancials ? 'bg-white border-primary text-primary shadow-lg' : 'bg-transparent border-gray-100 text-gray-400'}`}>
                                        <input type="checkbox" checked={form.showFinancials} onChange={e => setForm({...form, showFinancials: e.target.checked})} className="hidden" />
                                        <DollarSign size={24}/>
                                        <span className="text-[10px] font-black uppercase">المالية</span>
                                    </label>
                                    <label className={`flex flex-col items-center gap-3 p-4 border-2 rounded-2xl cursor-pointer transition ${form.showInventory ? 'bg-white border-primary text-primary shadow-lg' : 'bg-transparent border-gray-100 text-gray-400'}`}>
                                        <input type="checkbox" checked={form.showInventory} onChange={e => setForm({...form, showInventory: e.target.checked})} className="hidden" />
                                        <Package size={24}/>
                                        <span className="text-[10px] font-black uppercase">المخزون</span>
                                    </label>
                                    <label className={`flex flex-col items-center gap-3 p-4 border-2 rounded-2xl cursor-pointer transition ${form.showInvoices ? 'bg-white border-primary text-primary shadow-lg' : 'bg-transparent border-gray-100 text-gray-400'}`}>
                                        <input type="checkbox" checked={form.showInvoices} onChange={e => setForm({...form, showInvoices: e.target.checked})} className="hidden" />
                                        <ShoppingBag size={24}/>
                                        <span className="text-[10px] font-black uppercase">الفواتير</span>
                                    </label>
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-blue-50 p-6 rounded-2xl border border-blue-100">
                                <div>
                                    <h4 className="font-black text-blue-900 text-sm">سرعة تحديث الرادار</h4>
                                    <p className="text-[10px] text-blue-400 font-bold">كل كم ثانية يتم جلب البيانات؟</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <input type="number" min="5" value={form.syncInterval} onChange={e => setForm({...form, syncInterval: Number(e.target.value)})} className="w-24 p-3 rounded-xl border-2 border-blue-200 font-black text-center text-blue-700 outline-none" />
                                    <span className="text-xs font-black text-blue-400">ثانية</span>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-8 py-3 text-gray-500 font-bold">إلغاء</button>
                                <button type="submit" disabled={isSaving} className="bg-primary text-white px-16 py-4 rounded-[1.5rem] font-black text-lg shadow-xl hover:bg-teal-800 transition transform active:scale-95 disabled:bg-gray-300">
                                    {isSaving ? <RefreshCw className="animate-spin" size={24}/> : <CheckCircle2 size={24}/>} 
                                    بدء المراقبة والربط
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Branches;
