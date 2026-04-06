import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
    Database,
    RotateCcw, Trash2, RefreshCw, AlertTriangle,
    HardDrive, Upload, Download, Layers, ListChecks
} from 'lucide-react';
import { useBackups } from '../../hooks/useBackups';
import { isStandaloneMode } from '../../lib/api';
import {
    canAccessTestingReset,
    isTestingResetFeatureEnabled,
    TESTING_RESET_CONFIRMATION_PHRASE,
} from '../../lib/testingReset';

const BACKUP_SCOPES = [
    { key: 'inventory', label: 'المواد' },
    { key: 'clients', label: 'العملاء' },
    { key: 'invoices', label: 'الفواتير' },
    { key: 'parties', label: 'العملاء والموردين' },
    { key: 'warehouses', label: 'المستودعات' },
    { key: 'categories', label: 'التصنيفات' },
    { key: 'units', label: 'الوحدات' },
    { key: 'cash-boxes', label: 'الصناديق' },
    { key: 'vouchers', label: 'السندات' },
    { key: 'expenses', label: 'المصاريف' },
    { key: 'employees', label: 'الموظفون' },
    { key: 'payroll/transactions', label: 'سجل الرواتب' },
    { key: 'settings', label: 'الإعدادات' }
];

const BackupManager: React.FC = () => {
    const { state, setters, actions } = useBackups(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const storedUser = localStorage.getItem('shamel_user');
    const currentUser = storedUser ? JSON.parse(storedUser) : null;
    const isPostgresRuntime = String(import.meta.env.VITE_DB_DIALECT || 'postgres').toLowerCase() === 'postgres';

    const [backupType, setBackupType] = useState<'json' | 'db'>('json');
    const [backupMode, setBackupMode] = useState<'full' | 'custom'>('full');
    const [backupName, setBackupName] = useState('');
    const [selectedScopes, setSelectedScopes] = useState<string[]>(BACKUP_SCOPES.map(s => s.key));
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [resetConfirmationText, setResetConfirmationText] = useState('');

    useEffect(() => {
        actions.loadBackups();
    }, []);

    const canShowTestingReset = isTestingResetFeatureEnabled() && !isStandaloneMode() && canAccessTestingReset(currentUser);

    const handleResetSystem = async () => {
        try {
            const res = await actions.handleCleanTestingReset(resetConfirmationText);
            alert(res?.backupPath
                ? `تم تصفير المشروع لمرحلة الاختبار النظيف.\nتم حفظ نسخة احتياطية في:\n${res.backupPath}`
                : 'تم تصفير المشروع لمرحلة الاختبار النظيف.');
            setIsResetModalOpen(false);
            setResetConfirmationText('');
            window.location.reload();
        } catch (e: any) {
            alert(e?.message || 'فشل تصفير البيانات');
        }
    };

    const toggleScope = (key: string) => {
        setSelectedScopes(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    };

    const createStoredBackup = async () => {
        const scopes = backupMode === 'full' ? BACKUP_SCOPES.map(s => s.key) : selectedScopes;
        if (backupType === 'json' && scopes.length === 0) {
            alert('الرجاء اختيار عناصر النسخة المخصصة.');
            return;
        }
        await actions.handleCreateStoredBackup(backupType, scopes, currentUser?.name || currentUser?.username || '', backupName.trim() || undefined);
        setBackupName('');
    };

    const createFileBackup = async () => {
        if (backupType === 'db') {
            await actions.handleCreateBackup('db');
        } else {
            await actions.handleCreateBackup('json');
        }
    };

    const backupsList = useMemo(() => state.backups || [], [state.backups]);

    return (
        <div className="space-y-8 animate-fadeIn">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex items-center gap-5">
                    <div className="bg-primary/10 p-4 rounded-[2rem] text-primary shadow-inner">
                        <Database size={40}/>
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-gray-900">مركز النسخ الاحتياطي والاستعادة</h3>
                        <p className="text-gray-500 text-sm font-bold uppercase tracking-widest mt-1">Backup, Restore & Smart Versions</p>
                    </div>
                </div>
                <button
                    onClick={() => setters.setIsRestoreModalOpen(true)}
                    className="bg-white text-rose-600 border-2 border-rose-100 px-6 py-3 rounded-2xl font-black shadow-sm hover:bg-rose-50 transition transform active:scale-95 flex items-center gap-2"
                >
                    <Upload size={20}/>
                    استعادة من ملف
                </button>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-6">
                    <div className="bg-primary/10 p-3 rounded-2xl text-primary"><Layers size={20}/></div>
                    <div>
                        <h4 className="text-lg font-black text-gray-900">إنشاء نسخة احتياطية</h4>
                        <p className="text-xs text-gray-400 font-bold">اختر النوع والنطاق ثم احفظها في ملف أو داخل النظام</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-500">نوع النسخة</label>
                        <select value={backupType} onChange={e => setBackupType(e.target.value as any)} className="w-full border rounded-xl p-3 text-sm font-bold bg-white">
                            <option value="json">JSON (قابل للتخصيص)</option>
                            <option value="db">{isPostgresRuntime ? 'PostgreSQL Dump (.dump)' : 'DB (كاملة فقط)'}</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-500">وضع النسخة</label>
                        <select value={backupMode} onChange={e => setBackupMode(e.target.value as any)} className="w-full border rounded-xl p-3 text-sm font-bold bg-white" disabled={backupType === 'db'}>
                            <option value="full">نسخة شاملة</option>
                            <option value="custom">نسخة مخصصة</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-500">اسم النسخة (اختياري)</label>
                        <input value={backupName} onChange={e => setBackupName(e.target.value)} placeholder="مثال: نسخة نهاية الشهر" className="w-full border rounded-xl p-3 text-sm" />
                    </div>
                </div>

                {backupType === 'json' && backupMode === 'custom' && (
                    <div className="mt-6">
                        <div className="flex items-center gap-2 mb-3 text-gray-700 font-black text-sm">
                            <ListChecks size={16} className="text-primary" /> اختيار عناصر النسخة
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {BACKUP_SCOPES.map(scope => (
                                <label key={scope.key} className="border rounded-xl p-3 text-xs font-bold flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={selectedScopes.includes(scope.key)} onChange={() => toggleScope(scope.key)} />
                                    {scope.label}
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={createFileBackup} disabled={state.isProcessing} className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-black shadow-xl hover:bg-black transition flex items-center gap-2">
                        {state.isProcessing ? <RefreshCw className="animate-spin" size={20}/> : <Download size={20}/>}
                        حفظ نسخة في ملف
                    </button>
                    <button onClick={createStoredBackup} disabled={state.isProcessing} className="bg-primary text-white px-6 py-3 rounded-2xl font-black shadow-xl hover:bg-teal-800 transition flex items-center gap-2">
                        {state.isProcessing ? <RefreshCw className="animate-spin" size={20}/> : <HardDrive size={20}/>}
                        حفظ نسخة داخل النظام
                    </button>
                    <div className="text-xs text-gray-400 font-bold self-center">
                        سيتم طلب تحديد مسار الحفظ عند اختيار "حفظ نسخة في ملف".
                    </div>
                </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-3 rounded-2xl text-primary"><Database size={20}/></div>
                        <div>
                            <h4 className="text-lg font-black text-gray-900">النسخ المحفوظة</h4>
                            <p className="text-xs text-gray-400 font-bold">نسخ محفوظة بتاريخ واسم الحساب لسهولة الاستعادة</p>
                        </div>
                    </div>
                    <button onClick={actions.loadBackups} disabled={state.isLoadingBackups} className="px-4 py-2 rounded-xl text-xs font-black bg-gray-100 hover:bg-gray-200 transition">
                        {state.isLoadingBackups ? 'جاري التحديث...' : 'تحديث القائمة'}
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                        <thead className="bg-gray-50 text-gray-500 font-black uppercase tracking-tighter">
                            <tr>
                                <th className="px-4 py-4">الاسم</th>
                                <th className="px-4 py-4">النوع</th>
                                <th className="px-4 py-4">التاريخ</th>
                                <th className="px-4 py-4">المستخدم</th>
                                <th className="px-4 py-4">النطاق</th>
                                <th className="px-4 py-4">الحجم</th>
                                <th className="px-4 py-4">إجراء</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {backupsList.length === 0 ? (
                                <tr><td colSpan={7} className="text-center text-gray-400 py-8">لا توجد نسخ محفوظة</td></tr>
                            ) : (
                                backupsList.map(b => (
                                    <tr key={b.name}>
                                        <td className="px-4 py-3 font-bold text-gray-800">{b.name}</td>
                                        <td className="px-4 py-3">{b.type.toUpperCase()}</td>
                                        <td className="px-4 py-3 text-gray-500 font-mono">{b.createdAt ? new Date(b.createdAt).toLocaleString('ar-IQ') : '-'}</td>
                                        <td className="px-4 py-3 text-gray-500">{b.createdBy || '-'}</td>
                                        <td className="px-4 py-3 text-gray-500">{b.scope?.length ? b.scope.join(', ') : 'شاملة'}</td>
                                        <td className="px-4 py-3 text-gray-500">{Math.round((b.size || 0) / 1024)} KB</td>
                                        <td className="px-4 py-3">
                                            {b.type === 'json' ? (
                                                <button onClick={() => actions.handleRestoreBackupByName(b.name)} className="px-3 py-2 rounded-xl text-xs font-black bg-rose-50 text-rose-700 hover:bg-rose-100 transition">استعادة</button>
                                            ) : (
                                                <button onClick={() => actions.handleRestoreDbFromBackup(b.name)} className="px-3 py-2 rounded-xl text-xs font-black bg-gray-900 text-white hover:bg-black transition">{isPostgresRuntime ? 'استعادة PostgreSQL' : 'استعادة DB'}</button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {canShowTestingReset && (
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-red-200">
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                        <div className="flex items-start gap-4">
                            <div className="bg-red-50 p-3 rounded-2xl text-red-600">
                                <Trash2 size={28}/>
                            </div>
                            <div>
                                <div className="text-[10px] font-black tracking-[0.3em] text-red-500 uppercase mb-2">Temporary Testing Tool</div>
                                <h4 className="text-lg font-black text-gray-900">Reset Project for Clean Testing</h4>
                                <p className="text-xs text-gray-500 font-bold leading-relaxed">
                                    يحذف البيانات التشغيلية القديمة ويُبقي فقط حسابات الوصول والإعدادات الأساسية اللازمة لمواصلة الاختبار على بيئة PostgreSQL نظيفة.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsResetModalOpen(true)}
                            disabled={state.isProcessing}
                            className="bg-red-600 text-white px-8 py-4 rounded-2xl font-black shadow-xl hover:bg-red-700 transition transform active:scale-95 flex items-center gap-2 disabled:bg-red-300"
                        >
                            {state.isProcessing ? <RefreshCw className="animate-spin" size={20}/> : <RotateCcw size={20}/>}
                            Reset Project for Clean Testing
                        </button>
                    </div>
                    <div className="mt-4 text-[11px] text-gray-400 font-bold">
                        سيتم إنشاء نسخة {isPostgresRuntime ? 'PostgreSQL dump' : 'DB'} تلقائياً قبل التصفير إن أمكن. هذه الأداة مؤقتة ويجب حذفها بعد انتهاء مرحلة الاختبار.
                    </div>
                </div>
            )}

            {state.isRestoreModalOpen && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[500] p-4 animate-fadeIn">
                    <div className="bg-white rounded-[3.5rem] shadow-2xl w-full max-w-xl overflow-hidden border-t-[12px] border-red-600">
                        <div className="p-10 text-center space-y-6">
                            <div className="bg-red-50 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner animate-pulse">
                                <AlertTriangle size={56} className="text-red-600" />
                            </div>
                            <div>
                                <h3 className="text-3xl font-black text-gray-900 mb-2">استعادة قاعدة البيانات</h3>
                                <p className="text-gray-500 font-bold leading-relaxed px-4">
                                    يمكنك اختيار ملف نسخة احتياطية من نوع <code className="font-mono">.json</code> أو <code className="font-mono">{isPostgresRuntime ? '.dump' : '.db'}</code> للبدء بعملية الاستعادة.
                                </p>
                            </div>

                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept={isPostgresRuntime ? '.json,.dump' : '.json,.db'}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) actions.handleRestoreBackup(file);
                                }}
                            />

                            <div className="flex flex-col gap-3 pt-6">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={state.isProcessing}
                                    className="w-full bg-primary text-white py-5 rounded-2xl font-black text-xl shadow-2xl hover:bg-teal-800 transition transform active:scale-95 flex justify-center items-center gap-3 disabled:bg-gray-300"
                                >
                                    {state.isProcessing ? <RefreshCw className="animate-spin"/> : <Upload/>} اختر الملف وابدأ الآن
                                </button>
                                <button
                                    onClick={() => setters.setIsRestoreModalOpen(false)}
                                    className="w-full bg-gray-100 text-gray-500 py-4 rounded-2xl font-black text-sm hover:bg-gray-200 transition"
                                >
                                    إلغاء والعودة
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isResetModalOpen && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[500] p-4 animate-fadeIn">
                    <div className="bg-white rounded-[3.5rem] shadow-2xl w-full max-w-2xl overflow-hidden border-t-[12px] border-red-600">
                        <div className="p-10 space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="bg-red-50 w-20 h-20 rounded-[2rem] flex items-center justify-center shadow-inner">
                                    <AlertTriangle size={42} className="text-red-600" />
                                </div>
                                <div className="space-y-2">
                                    <div className="text-[10px] font-black tracking-[0.3em] text-red-500 uppercase">Temporary Testing Tool</div>
                                    <h3 className="text-3xl font-black text-gray-900">Reset Project for Clean Testing</h3>
                                    <p className="text-sm text-gray-500 font-bold leading-relaxed">
                                        سيؤدي هذا الإجراء إلى حذف البيانات التشغيلية والمخزنية والمحاسبية الحالية مع الإبقاء فقط على حسابات الدخول والإعدادات التأسيسية اللازمة للاستمرار في الاختبار.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-3xl border border-red-200 bg-red-50/70 p-5 space-y-3 text-sm text-red-800 font-bold">
                                <div>سيتم حذف المواد والمخزون والحركات والفواتير والسندات وسجل العملاء والموردين وحركات المندوبين والمخرجات التشغيلية الأخرى.</div>
                                <div>سيتم الاحتفاظ فقط بحسابات الوصول عالية الصلاحية، وإعدادات النظام الأساسية، وكيانات التفعيل/الترخيص اللازمة للإقلاع وتسجيل الدخول.</div>
                                <div>النسخة الاحتياطية ستُنشأ تلقائياً قبل التنفيذ إن كانت بيئة السيرفر تسمح بذلك.</div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black text-gray-500">اكتب العبارة التالية حرفياً للمتابعة</label>
                                <div className="rounded-2xl bg-gray-900 text-white px-4 py-3 font-mono text-sm break-all">
                                    {TESTING_RESET_CONFIRMATION_PHRASE}
                                </div>
                                <input
                                    value={resetConfirmationText}
                                    onChange={(e) => setResetConfirmationText(e.target.value)}
                                    placeholder={TESTING_RESET_CONFIRMATION_PHRASE}
                                    className="w-full border-2 border-red-200 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-red-500"
                                />
                            </div>

                            <div className="flex flex-col md:flex-row gap-3 pt-2">
                                <button
                                    onClick={handleResetSystem}
                                    disabled={state.isProcessing || resetConfirmationText.trim() !== TESTING_RESET_CONFIRMATION_PHRASE}
                                    className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black text-base shadow-xl hover:bg-red-700 transition disabled:bg-red-300 disabled:cursor-not-allowed flex justify-center items-center gap-3"
                                >
                                    {state.isProcessing ? <RefreshCw className="animate-spin" size={20}/> : <RotateCcw size={20}/>}
                                    Execute Clean Testing Reset
                                </button>
                                <button
                                    onClick={() => {
                                        setIsResetModalOpen(false);
                                        setResetConfirmationText('');
                                    }}
                                    disabled={state.isProcessing}
                                    className="flex-1 bg-gray-100 text-gray-500 py-4 rounded-2xl font-black text-sm hover:bg-gray-200 transition"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BackupManager;
