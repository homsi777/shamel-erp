
import React, { useState, useEffect } from 'react';
import { 
    User, Plus, Edit, Trash2, Shield, Calculator, Package, Check, RefreshCw, 
    UserRound, Factory, ListTree, TrendingDown, LayoutGrid, Building2, ShoppingCart, Zap, Scissors
} from 'lucide-react';
import { AppUser, UserRole, Warehouse, Branch, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS, PERMISSIONS } from '../../types';
import { apiRequest } from '../../lib/api';
import { confirmDialog } from '../../lib/confirm';

interface Props {
    users: AppUser[];
    setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
}

const UserManager: React.FC<Props> = ({ users, setUsers }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);

    useEffect(() => {
        apiRequest('warehouses').then((rows) => setWarehouses(rows || [])).catch(() => setWarehouses([]));
        apiRequest('branches').then((rows) => setBranches(rows || [])).catch(() => setBranches([]));
    }, []);
    const [form, setForm] = useState({
        id: '',
        username: '',
        password: '',
        role: 'warehouse_keeper' as UserRole,
        permissions: [] as string[],
        posWarehouseId: '',
        branchScope: 'restricted' as 'restricted' | 'company_wide',
        allowedBranchIds: [] as string[],
        defaultBranchId: '',
    });

    const groupIcons: Record<string, any> = {
        inventory: <Package size={18} className="text-orange-500"/>,
        sales: <ShoppingCart size={18} className="text-emerald-500"/>,
        textile: <Scissors size={18} className="text-amber-600"/>,
        finance: <Calculator size={18} className="text-blue-500"/>,
        hr: <UserRound size={18} className="text-rose-500"/>,
        manufacturing: <Factory size={18} className="text-indigo-500"/>,
        admin: <Shield size={18} className="text-gray-500"/>
    };

    // وظيفة مساعدة لضمان الحصول على مصفوفة صلاحيات
    const getSafePermissions = (perms: any): string[] => {
        if (Array.isArray(perms)) return perms;
        if (typeof perms === 'string' && perms.length > 0) return perms.split(',').filter(Boolean);
        return [];
    };

    const getSafeBranchIds = (branchIds: any): string[] => (
        Array.isArray(branchIds)
            ? Array.from(new Set(branchIds.map((value) => String(value || '').trim()).filter(Boolean)))
            : []
    );

    const normalizeDefaultBranchId = (defaultBranchId: string, allowedBranchIds: string[]) => {
        if (defaultBranchId && allowedBranchIds.includes(defaultBranchId)) return defaultBranchId;
        return allowedBranchIds[0] || '';
    };

    const updateBranchAssignments = (nextBranchIds: string[], nextDefaultBranchId?: string) => {
        const normalizedBranchIds = Array.from(new Set(nextBranchIds.filter(Boolean)));
        setForm(prev => ({
            ...prev,
            allowedBranchIds: normalizedBranchIds,
            defaultBranchId: normalizeDefaultBranchId(
                nextDefaultBranchId === undefined ? prev.defaultBranchId : nextDefaultBranchId,
                normalizedBranchIds,
            ),
        }));
    };

    const handleEdit = (user?: AppUser) => {
        if (user) {
            const branchScope = String(user.branchScope || (user.role === 'admin' ? 'company_wide' : 'restricted')).toLowerCase() === 'company_wide'
                ? 'company_wide'
                : 'restricted';
            const allowedBranchIds = branchScope === 'company_wide'
                ? []
                : getSafeBranchIds(user.allowedBranchIds);
            setForm({ 
                id: user.id, 
                username: user.username, 
                password: '', 
                role: user.role, 
                permissions: getSafePermissions(user.permissions) || DEFAULT_ROLE_PERMISSIONS[user.role],
                posWarehouseId: user.posWarehouseId || '',
                branchScope,
                allowedBranchIds,
                defaultBranchId: branchScope === 'company_wide'
                    ? String(user.defaultBranchId || '')
                    : normalizeDefaultBranchId(String(user.defaultBranchId || ''), allowedBranchIds),
            });
        } else {
            setForm({
                id: '',
                username: '',
                password: '',
                role: 'warehouse_keeper',
                permissions: DEFAULT_ROLE_PERMISSIONS['warehouse_keeper'],
                posWarehouseId: '',
                branchScope: 'restricted',
                allowedBranchIds: [],
                defaultBranchId: '',
            });
        }
        setIsEditing(true);
    };

    const handleSave = async () => {
        const cleanUsername = form.username.trim();
        if (!cleanUsername) return;
        setIsSaving(true);
        try {
            if (form.id) {
                const payload: any = {
                    username: cleanUsername,
                    role: form.role,
                    permissions: form.permissions,
                    posWarehouseId: form.posWarehouseId,
                    posWarehouseName: warehouses.find(w => w.id === form.posWarehouseId)?.name || '',
                    branchScope: form.branchScope,
                    allowedBranchIds: form.branchScope === 'company_wide' ? [] : form.allowedBranchIds,
                    defaultBranchId: form.defaultBranchId || null,
                };
                if(form.password) payload.password = form.password;
                await apiRequest(`users/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                setUsers(prev => prev.map(u => u.id === form.id ? { ...u, ...payload } : u));
            } else {
                if (!form.password) { alert('كلمة المرور مطلوبة'); setIsSaving(false); return; }
                const newUser = {
                    id: Date.now().toString(),
                    username: cleanUsername,
                    password: form.password,
                    name: cleanUsername,
                    role: form.role,
                    permissions: form.permissions,
                    posWarehouseId: form.posWarehouseId,
                    posWarehouseName: warehouses.find(w => w.id === form.posWarehouseId)?.name || '',
                    branchScope: form.branchScope,
                    allowedBranchIds: form.branchScope === 'company_wide' ? [] : form.allowedBranchIds,
                    defaultBranchId: form.defaultBranchId || null,
                    isActive: true,
                };
                await apiRequest('users', { method: 'POST', body: JSON.stringify(newUser) });
                const { password, ...safeUser } = newUser;
                setUsers(prev => [...prev, safeUser]);
            }
            setIsEditing(false);
        } catch (e) { alert("فشل الحفظ"); } 
        finally { setIsSaving(false); }
    };

    const handleDelete = async (id: string) => {
        if (await confirmDialog('هل أنت متأكد من الحذف؟')) {
            try { await apiRequest(`users/${id}`, { method: 'DELETE' }); setUsers(users.filter(u => u.id !== id)); } 
            catch(e) { alert("فشل الحذف"); }
        }
    };

    const togglePermission = (perm: string) => {
        const currentPerms = getSafePermissions(form.permissions);
        const has = currentPerms.includes(perm);
        setForm(prev => ({ ...prev, permissions: has ? currentPerms.filter(p => p !== perm) : [...currentPerms, perm] }));
    };

    const togglePosOnly = () => {
        const currentPerms = getSafePermissions(form.permissions);
        const has = currentPerms.includes(PERMISSIONS.POS_ONLY);
        setForm(prev => ({ ...prev, permissions: has ? currentPerms.filter(p => p !== PERMISSIONS.POS_ONLY) : [...currentPerms, PERMISSIONS.POS_ONLY] }));
    };

    const toggleAgentRestricted = () => {
        const currentPerms = getSafePermissions(form.permissions);
        const has = currentPerms.includes(PERMISSIONS.AGENT_MODE_RESTRICTED);
        setForm(prev => ({ ...prev, permissions: has ? currentPerms.filter(p => p !== PERMISSIONS.AGENT_MODE_RESTRICTED) : [...currentPerms, PERMISSIONS.AGENT_MODE_RESTRICTED] }));
    };

    const toggleAllowedBranch = (branchId: string) => {
        const nextBranchIds = form.allowedBranchIds.includes(branchId)
            ? form.allowedBranchIds.filter((id) => id !== branchId)
            : [...form.allowedBranchIds, branchId];
        updateBranchAssignments(nextBranchIds);
    };

    if (isEditing) {
        return (
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 animate-fadeIn flex flex-col h-full max-h-[85vh]">
                <div className="flex items-center justify-between mb-8 border-b pb-6">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsEditing(false)} className="bg-gray-100 p-2 rounded-xl hover:bg-gray-200 transition text-gray-600 font-bold text-sm">إلغاء</button>
                        <h3 className="text-2xl font-black text-gray-800">{form.id ? 'تعديل بيانات وصلاحيات المستخدم' : 'إضافة مستخدم جديد للنظام'}</h3>
                    </div>
                    <button onClick={handleSave} disabled={isSaving} className="bg-primary text-white px-10 py-3 rounded-xl font-black shadow-xl flex items-center gap-3 transition transform active:scale-95 disabled:bg-gray-300">
                        {isSaving ? <RefreshCw className="animate-spin" size={20}/> : <Check size={20}/>} {form.id ? 'تحديث الآن' : 'حفظ وإضافة'}
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden">
                    <div className="lg:col-span-4 space-y-6 overflow-y-auto custom-scrollbar pr-2">
                        <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 shadow-inner">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">هوية الدخول</h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">اسم المستخدم</label>
                                    <input type="text" value={form.username} onChange={e => setForm({...form, username: e.target.value})} className="w-full border-2 border-white rounded-xl p-3 font-bold shadow-sm outline-none focus:border-primary" disabled={form.username === 'admin'} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور {form.id && '(اختياري)'}</label>
                                    <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="w-full border-2 border-white rounded-xl p-3 shadow-sm outline-none focus:border-primary" placeholder="*****" />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">مستودع نقطة البيع (اختياري)</label>
                                    <select value={form.posWarehouseId} onChange={e => setForm({ ...form, posWarehouseId: e.target.value })} className="w-full border-2 border-white rounded-xl p-3 font-bold shadow-sm outline-none focus:border-primary bg-white">
                                        <option value="">-- بدون تحديد --</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={togglePosOnly} className={`w-10 h-5 rounded-full relative transition-colors ${getSafePermissions(form.permissions).includes(PERMISSIONS.POS_ONLY) ? 'bg-primary' : 'bg-gray-200'}`}>
                                        <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 shadow-sm transition-all ${getSafePermissions(form.permissions).includes(PERMISSIONS.POS_ONLY) ? 'left-6' : 'left-0.5'}`}></div>
                                    </button>
                                    <span className="text-[11px] font-bold text-gray-600">تقييد نقطة بيع فقط (POS)</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={toggleAgentRestricted} className={`w-10 h-5 rounded-full relative transition-colors ${getSafePermissions(form.permissions).includes(PERMISSIONS.AGENT_MODE_RESTRICTED) ? 'bg-primary' : 'bg-gray-200'}`}>
                                        <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 shadow-sm transition-all ${getSafePermissions(form.permissions).includes(PERMISSIONS.AGENT_MODE_RESTRICTED) ? 'left-6' : 'left-0.5'}`}></div>
                                    </button>
                                    <span className="text-[11px] font-bold text-gray-600">وضع المندوب المقيد (شاشة المندوب فقط)</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white border-2 border-gray-50 p-6 rounded-3xl space-y-4">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">عزل الفروع</h4>
                            <div className="space-y-3">
                                <label className="block text-xs font-bold text-gray-600 mb-1">نطاق العمل</label>
                                <select
                                    value={form.branchScope}
                                    onChange={e => {
                                        const nextScope = e.target.value === 'company_wide' ? 'company_wide' : 'restricted';
                                        setForm(prev => ({
                                            ...prev,
                                            branchScope: nextScope,
                                            allowedBranchIds: nextScope === 'company_wide' ? [] : prev.allowedBranchIds,
                                            defaultBranchId: nextScope === 'company_wide'
                                                ? (prev.defaultBranchId || branches[0]?.id || '')
                                                : normalizeDefaultBranchId(prev.defaultBranchId, prev.allowedBranchIds),
                                        }));
                                    }}
                                    className="w-full border-2 border-white rounded-xl p-3 font-bold shadow-sm outline-none focus:border-primary bg-white"
                                >
                                    <option value="restricted">مقيّد بفروع محددة</option>
                                    <option value="company_wide">على مستوى المؤسسة كلها</option>
                                </select>
                            </div>

                            {form.branchScope === 'restricted' ? (
                                <>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-bold text-gray-600 mb-1">الفروع المسموح بها</label>
                                        <div className="max-h-40 overflow-y-auto space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                                            {branches.length === 0 ? (
                                                <div className="text-xs font-bold text-gray-400">لا توجد فروع متاحة حالياً.</div>
                                            ) : (
                                                branches.map((branch) => {
                                                    const checked = form.allowedBranchIds.includes(branch.id);
                                                    return (
                                                        <label key={branch.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-bold transition ${checked ? 'border-primary/30 bg-primary/5 text-primary' : 'border-gray-100 bg-white text-gray-600'}`}>
                                                            <span>{branch.name}</span>
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => toggleAllowedBranch(branch.id)}
                                                                className="h-4 w-4 accent-primary"
                                                            />
                                                        </label>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-bold text-gray-600 mb-1">الفرع الافتراضي بعد تسجيل الدخول</label>
                                        <select
                                            value={form.defaultBranchId}
                                            onChange={e => setForm(prev => ({ ...prev, defaultBranchId: e.target.value }))}
                                            className="w-full border-2 border-white rounded-xl p-3 font-bold shadow-sm outline-none focus:border-primary bg-white"
                                            disabled={form.allowedBranchIds.length === 0}
                                        >
                                            <option value="">-- اختر فرعاً افتراضياً --</option>
                                            {branches.filter(branch => form.allowedBranchIds.includes(branch.id)).map((branch) => (
                                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                                            ))}
                                        </select>
                                        <p className="text-[11px] font-bold text-gray-400">
                                            إذا تُرك بدون اختيار ومعه أكثر من فرع، سيُطلب من المستخدم تحديد الفرع بعد تسجيل الدخول.
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-2">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">الفرع الافتراضي</label>
                                    <select
                                        value={form.defaultBranchId}
                                        onChange={e => setForm(prev => ({ ...prev, defaultBranchId: e.target.value }))}
                                        className="w-full border-2 border-white rounded-xl p-3 font-bold shadow-sm outline-none focus:border-primary bg-white"
                                    >
                                        <option value="">-- بدون فرع افتراضي --</option>
                                        {branches.map((branch) => (
                                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[11px] font-bold text-gray-400">
                                        صلاحية المؤسسة لا تسمح بالخروج من حدود الشركة، بل فقط بالتنقل بين فروعها الداخلية.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="bg-white border-2 border-gray-50 p-6 rounded-3xl space-y-4">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">الدور الوظيفي</h4>
                            <div className="space-y-3">
                                {[
                                    { id: 'admin', label: 'مدير عام', icon: <Shield size={18}/>, color: 'gray' },
                                    { id: 'accountant', label: 'المحاسب المالي', icon: <Calculator size={18}/>, color: 'emerald' },
                                    { id: 'warehouse_keeper', label: 'أمين المستودع', icon: <Package size={18}/>, color: 'orange' },
                                    { id: 'textile_warehouse_keeper', label: 'أمين مستودع الأقمشة', icon: <Scissors size={18}/>, color: 'amber' },
                                    { id: 'agent', label: 'مندوب مبيعات', icon: <Zap size={18}/>, color: 'sky' }
                                ].map(role => (
                                    <button 
                                        key={role.id} 
                                        onClick={() => setForm(prev => ({
                                            ...prev,
                                            role: role.id as UserRole,
                                            permissions: DEFAULT_ROLE_PERMISSIONS[role.id as UserRole],
                                            branchScope: role.id === 'admin' ? 'company_wide' : prev.branchScope,
                                            defaultBranchId: role.id === 'admin' ? (prev.defaultBranchId || branches[0]?.id || '') : prev.defaultBranchId,
                                        }))} 
                                        disabled={form.username === 'admin'} 
                                        className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-right ${form.role === role.id ? `border-gray-800 bg-gray-50 shadow-md` : 'border-gray-50 hover:bg-gray-50'}`}
                                    >
                                        <div className={`p-2 rounded-xl ${form.role === role.id ? `bg-gray-800 text-white` : 'bg-gray-100 text-gray-400'}`}>{role.icon}</div>
                                        <div className={`font-black text-sm ${form.role === role.id ? `text-gray-900` : 'text-gray-500'}`}>{role.label}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-8 overflow-hidden flex flex-col">
                        <div className="bg-white border-2 border-gray-100 rounded-[2.5rem] flex-1 flex flex-col overflow-hidden">
                            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto custom-scrollbar">
                                {Object.entries(PERMISSION_GROUPS).map(([key, group]: [string, any]) => (
                                    <div key={key} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                                        <h5 className="font-black text-gray-900 text-sm border-b pb-3 flex items-center gap-2">
                                            {groupIcons[key]} {group.label}
                                        </h5>
                                        <div className="space-y-2">
                                            {group.keys.map((permKey: string) => (
                                                <label key={permKey} className={`group/item flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all ${getSafePermissions(form.permissions).includes(permKey) ? 'bg-primary/5 border border-primary/10' : 'hover:bg-gray-50'}`}>
                                                    <div 
                                                        onClick={() => { if(form.username !== 'admin') togglePermission(permKey); }} 
                                                        className={`w-10 h-5 rounded-full relative transition-colors ${getSafePermissions(form.permissions).includes(permKey) ? 'bg-primary' : 'bg-gray-200'}`}
                                                    >
                                                        <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 shadow-sm transition-all ${getSafePermissions(form.permissions).includes(permKey) ? 'left-6' : 'left-0.5'}`}></div>
                                                    </div>
                                                    <span className={`text-[11px] font-bold ${getSafePermissions(form.permissions).includes(permKey) ? 'text-primary' : 'text-gray-500'}`}>{PERMISSION_LABELS[permKey]}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn">
            <div className="flex justify-between items-center mb-8 border-b pb-5">
                <div>
                    <h3 className="text-xl font-black text-gray-800 flex items-center gap-3"><User className="text-primary"/> سجل المستخدمين والصلاحيات</h3>
                </div>
                <button onClick={() => handleEdit()} className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-black flex items-center gap-2 shadow-xl hover:bg-black transition transform active:scale-95"><Plus size={20}/> تسجيل مستخدم جديد</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.map(u => {
                    const perms = getSafePermissions(u.permissions);
                    return (
                        <div key={u.id} className="border-2 border-gray-50 rounded-[2rem] p-6 hover:shadow-2xl hover:border-primary/20 transition-all bg-white group">
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex items-center gap-4">
                                    <div className={`p-4 rounded-2xl shadow-inner ${u.role === 'admin' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                        {u.role === 'admin' ? <Shield size={24}/> : <User size={24}/>}
                                    </div>
                                    <div>
                                        <h4 className="font-black text-lg text-gray-900 leading-tight">{u.username}</h4>
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{u.role}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 mb-6">
                                <div className="flex -space-x-2 rtl:space-x-reverse overflow-hidden">
                                    {perms.slice(0, 5).map((p, idx) => (
                                        <div key={idx} className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-gray-200 flex items-center justify-center text-[8px] font-black text-gray-500">{idx + 1}</div>
                                    ))}
                                    {perms.length > 5 && <div className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-primary text-white flex items-center justify-center text-[8px] font-black">+{perms.length - 5}</div>}
                                </div>
                                <span className="text-[10px] font-bold text-gray-400">صلاحية نشطة</span>
                            </div>

                            <div className="mb-6 rounded-2xl bg-gray-50 px-4 py-3">
                                <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Scope</div>
                                <div className="text-xs font-bold text-gray-700">
                                    {String(u.branchScope || (u.role === 'admin' ? 'company_wide' : 'restricted')) === 'company_wide'
                                        ? 'مستوى المؤسسة'
                                        : `فروع محددة: ${(u.allowedBranchIds || []).length || 0}`}
                                </div>
                                {!!u.defaultBranchId && (
                                    <div className="mt-1 text-[11px] font-bold text-gray-500">الافتراضي: {u.defaultBranchId}</div>
                                )}
                            </div>

                            <div className="flex gap-2 pt-4 border-t border-gray-50">
                                <button onClick={() => handleEdit(u)} className="flex-1 bg-blue-50 text-blue-600 py-2.5 rounded-xl font-black text-xs hover:bg-blue-600 hover:text-white transition flex items-center justify-center gap-2"><Edit size={14}/> تعديل</button>
                                {u.username !== 'admin' && ( 
                                    <button onClick={() => handleDelete(u.id)} className="p-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition"><Trash2 size={16}/></button> 
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
export default UserManager;
