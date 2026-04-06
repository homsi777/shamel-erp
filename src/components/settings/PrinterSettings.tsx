import React, { useState, useEffect } from 'react';
import { Printer, Bluetooth, RefreshCw, CheckCircle2, AlertCircle, Info, Monitor } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { AppSettings } from '../../types';
import { testThermalPrint } from '../../printing/printService';
import { listWindowsPrinters, type WindowsPrinter } from '../../printing/thermalPrinter';

interface Props {
    settings: AppSettings;
    updateThermal: (field: string, value: any) => void;
    updatePrintField?: (field: string, value: any) => void;
}

const PrinterSettings: React.FC<Props> = ({ settings, updateThermal, updatePrintField }) => {
    const [isTesting, setIsTesting] = useState(false);
    const [testStatus, setTestStatus] = useState<{type: 'success'|'error', msg: string} | null>(null);
    const [windowsPrinters, setWindowsPrinters] = useState<WindowsPrinter[]>([]);
    const hasElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

    useEffect(() => {
        if (hasElectron) {
            listWindowsPrinters().then(setWindowsPrinters).catch(() => setWindowsPrinters([]));
        }
    }, [hasElectron]);

    const thermal = settings.print?.thermal || { enabled: false, printerId: '', paperSize: '80mm', autoPrintPos: true };
    const isAndroid = Capacitor.getPlatform() === 'android';
    const defaultA4Id = settings.print?.defaultA4PrinterId || '';
    const windowsThermalId = thermal.windowsPrinterId || '';

    const handleTest = async () => {
        if (!thermal.printerId) {
            setTestStatus({ type: 'error', msg: 'يرجى إدخال عنوان الـ MAC للطابعة أولاً' });
            return;
        }
        setIsTesting(true);
        setTestStatus(null);
        try {
            await testThermalPrint(thermal.printerId, thermal.paperSize as any, settings.company.name);
            setTestStatus({ type: 'success', msg: 'تم إرسال أمر الطباعة بنجاح!' });
        } catch (e: any) {
            setTestStatus({ type: 'error', msg: `فشل الاتصال: ${e.message || 'تأكد من تشغيل البلوتوث والطابعة'}` });
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn space-y-8">
            {/* إعدادات الطابعة الافتراضية (ويندوز) - مرة واحدة ثم الطباعة التلقائية من نقطة البيع */}
            {hasElectron && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-6">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Monitor className="text-primary"/> الطابعة الافتراضية (ويندوز)
                    </h3>
                    <p className="text-gray-500 text-sm">اختر الطابعات مرة واحدة هنا، ثم عند حفظ أي فاتورة في نقطة البيع ستُطبع تلقائياً دون اختيار الطابعة.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <label className="block text-xs font-bold text-gray-600">طابعة حرارية افتراضية (فواتير نقطة البيع 80مم / 58مم)</label>
                            <select
                                value={windowsThermalId}
                                onChange={(e) => {
                                    const id = e.target.value;
                                    const p = windowsPrinters.find(x => x.id === id);
                                    updateThermal('windowsPrinterId', id);
                                    updateThermal('windowsPrinterName', p?.name || id);
                                }}
                                className="w-full border-2 border-gray-200 rounded-xl p-3 bg-white outline-none focus:border-primary"
                            >
                                <option value="">— اختر الطابعة الحرارية —</option>
                                {windowsPrinters.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <div className="flex items-center gap-4">
                                <select
                                    value={thermal.paperSize}
                                    onChange={(e) => updateThermal('paperSize', e.target.value)}
                                    className="border-2 border-gray-200 rounded-lg p-2 bg-white text-sm"
                                >
                                    <option value="58mm">58 مم</option>
                                    <option value="80mm">80 مم</option>
                                </select>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={thermal.autoPrintPos} onChange={(e) => updateThermal('autoPrintPos', e.target.checked)} className="w-4 h-4 text-primary rounded" />
                                    <span className="text-sm font-bold text-gray-700">طباعة تلقائية عند حفظ الفاتورة</span>
                                </label>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <label className="block text-xs font-bold text-gray-600">طابعة A4 افتراضية (كشوفات وتقارير)</label>
                            <select
                                value={defaultA4Id}
                                onChange={(e) => {
                                    const id = e.target.value;
                                    const p = windowsPrinters.find(x => x.id === id);
                                    updatePrintField?.('defaultA4PrinterId', id);
                                    updatePrintField?.('defaultA4PrinterName', p?.name || id);
                                }}
                                className="w-full border-2 border-gray-200 rounded-xl p-3 bg-white outline-none focus:border-primary"
                            >
                                <option value="">— اختر طابعة A4 —</option>
                                {windowsPrinters.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-teal-50/80 p-6 rounded-2xl border border-teal-100 space-y-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Printer className="text-primary"/> نقطة البيع — إيصال تلقائي
                </h3>
                <p className="text-gray-600 text-sm">
                    بعد «إتمام البيع»: طباعة مباشرة دون اختيار طابعة (الوضع الافتراضي صامت). عيّن طابعة افتراضية لنوع المستند «pos_receipt» من شاشة إدارة الطابعات، أو استخدم معرّف الطابعة أدناه.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center gap-2 cursor-pointer md:col-span-2">
                        <input
                            type="checkbox"
                            checked={thermal.posAutoPrintAfterSale ?? thermal.autoPrintPos ?? true}
                            onChange={(e) => updateThermal('posAutoPrintAfterSale', e.target.checked)}
                            className="w-4 h-4 text-primary rounded"
                        />
                        <span className="text-sm font-bold text-gray-800">طباعة تلقائية بعد إتمام البيع</span>
                    </label>
                    <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-600">وضع الطباعة</label>
                        <select
                            value={thermal.posPrintMode ?? 'silent'}
                            onChange={(e) => updateThermal('posPrintMode', e.target.value)}
                            className="w-full border-2 border-gray-200 rounded-xl p-2 bg-white text-sm font-bold"
                        >
                            <option value="silent">صامت — مباشر (افتراضي)</option>
                            <option value="preview">معاينة (تشخيص)</option>
                            <option value="disabled">معطّل</option>
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-600">عدد النسخ</label>
                        <select
                            value={String(thermal.posCopies ?? 1)}
                            onChange={(e) => updateThermal('posCopies', Number(e.target.value) as 1 | 2 | 3)}
                            className="w-full border-2 border-gray-200 rounded-xl p-2 bg-white text-sm font-bold"
                        >
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                        </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                        <label className="block text-xs font-bold text-gray-600">طابعة POS الافتراضية (معرّف من قائمة الطابعات — اختياري)</label>
                        <input
                            dir="ltr"
                            type="text"
                            value={thermal.posPrinterId || ''}
                            onChange={(e) => updateThermal('posPrinterId', e.target.value.trim())}
                            placeholder="مثال: prt-173..."
                            className="w-full border-2 border-gray-200 rounded-xl p-2 font-mono text-sm"
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-between items-center border-b pb-4">
                <div>
                    <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Printer className="text-primary"/> طابعة البلوتوث الحرارية
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">إعدادات طابعة الكاشير للأندرويد (ESC/POS).</p>
                </div>
                {isAndroid && (
                <div onClick={() => updateThermal('enabled', !thermal.enabled)} className={`w-14 h-8 rounded-full p-1 cursor-pointer transition-colors ${thermal.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`bg-white w-6 h-6 rounded-full shadow-sm transition-transform ${thermal.enabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </div>
                )}
            </div>

            {isAndroid && thermal.enabled ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeIn">
                    <div className="space-y-6">
                        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                            <label className="block text-xs font-black text-blue-600 mb-3 uppercase tracking-widest">عنوان الطابعة (MAC Address)</label>
                            <div className="relative">
                                <input 
                                    dir="ltr"
                                    type="text" 
                                    value={thermal.printerId} 
                                    onChange={e => updateThermal('printerId', e.target.value.toUpperCase())}
                                    className="w-full p-4 border-2 border-white rounded-xl font-mono text-center text-xl focus:border-blue-500 outline-none shadow-sm" 
                                    placeholder="00:11:22:33:44:55"
                                />
                                <div className="absolute right-3 top-4 text-gray-300">
                                    <Bluetooth size={20}/>
                                </div>
                            </div>
                            <p className="text-[10px] text-blue-400 mt-3 font-medium">
                                * احصل على العنوان من إعدادات البلوتوث في هاتفك بعد اقتران الطابعة.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2">حجم الورق</label>
                                <select 
                                    value={thermal.paperSize} 
                                    onChange={e => updateThermal('paperSize', e.target.value)}
                                    className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-primary"
                                >
                                    <option value="58mm">58 مم (كاشير صغير)</option>
                                    <option value="80mm">80 مم (كاشير عريض)</option>
                                </select>
                            </div>
                            <div className="flex flex-col justify-end">
                                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition h-[52px]">
                                    <input 
                                        type="checkbox" 
                                        checked={thermal.autoPrintPos} 
                                        onChange={e => updateThermal('autoPrintPos', e.target.checked)}
                                        className="w-4 h-4 text-primary rounded" 
                                    />
                                    <span className="text-xs font-bold text-gray-700">طباعة تلقائية عند البيع</span>
                                </label>
                            </div>
                        </div>

                        <button 
                            onClick={handleTest}
                            disabled={isTesting || !thermal.printerId}
                            className={`w-full py-4 rounded-xl font-black text-lg shadow-xl transition-all transform active:scale-95 flex items-center justify-center gap-3 ${isTesting ? 'bg-gray-400' : 'bg-gray-900 hover:bg-black text-white'}`}
                        >
                            {isTesting ? <RefreshCw className="animate-spin" /> : <Printer />}
                            {isTesting ? 'جاري الاختبار...' : 'تجربة الطباعة (Test Print)'}
                        </button>

                        {testStatus && (
                            <div className={`p-4 rounded-xl flex items-center gap-3 animate-fadeIn ${testStatus.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                {testStatus.type === 'success' ? <CheckCircle2 /> : <AlertCircle />}
                                <span className="font-bold text-sm">{testStatus.msg}</span>
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200 h-fit space-y-4">
                        <h4 className="font-bold text-gray-700 flex items-center gap-2"><Info size={18} className="text-blue-500"/> تعليمات التوصيل</h4>
                        <ul className="text-right w-full space-y-3 text-xs text-gray-500 font-medium">
                            <li className="flex gap-2"><span>1.</span> قم بتشغيل الطابعة وتأكد من وجود الورق.</li>
                            <li className="flex gap-2"><span>2.</span> افتح إعدادات البلوتوث في هاتفك وقم بعمل (Pair) مع الطابعة.</li>
                            <li className="flex gap-2"><span>3.</span> انسخ عنوان الـ MAC الذي يظهر بجانب اسم الطابعة.</li>
                            <li className="flex gap-2"><span>4.</span> الصقه في المربع المقابل واضغط "تجربة الطباعة".</li>
                        </ul>
                        <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100 flex items-start gap-2">
                            <AlertCircle className="text-yellow-600 shrink-0" size={16}/>
                            <p className="text-[10px] text-yellow-800 leading-relaxed font-bold">
                                إذا ظهرت اللغة العربية على شكل مربعات، يرجى مراجعة الشركة المصنعة للطابعة لدعم ترميز Arabic (CP864).
                            </p>
                        </div>
                    </div>
                </div>
            ) : isAndroid ? (
                <div className="py-12 text-center text-gray-400 animate-fadeIn">
                    <Printer size={64} className="mx-auto mb-4 opacity-20"/>
                    <p className="font-bold">ميزة الطباعة الحرارية المباشرة معطلة حالياً.</p>
                </div>
            ) : (
                <p className="text-gray-500 text-sm py-4">استخدم قسم «الطابعة الافتراضية (ويندوز)» أعلاه لاختيار طابعة الحرارية وطابعة A4.</p>
            )}
        </div>
    );
};

export default PrinterSettings;
