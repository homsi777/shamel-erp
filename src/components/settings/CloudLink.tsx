
import React, { useState, useEffect } from 'react';
import { Cloud, Wifi, RefreshCw, CheckCircle2, XCircle, ShieldCheck, Server } from 'lucide-react';
import { getStoredServerIP, setApiUrl, checkServerConnection } from '../../lib/api';

const CloudLink: React.FC = () => {
    const [ip, setIp] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null);
    const [currentStatus, setCurrentStatus] = useState<boolean | null>(null);

    useEffect(() => {
        const storedIp = getStoredServerIP();
        setIp(storedIp);
        // فحص أولي للاتصال الحالي
        if (storedIp) {
            checkServerConnection().then(setCurrentStatus);
        }
    }, []);

    const handleTest = async () => {
        if (!ip.trim()) return;
        setIsTesting(true);
        setTestResult(null);
        
        // محاولة الاتصال بالعنوان المدخل
        const isOk = await checkServerConnection(ip);
        
        setIsTesting(false);
        setTestResult(isOk ? 'success' : 'failed');
        
        if (isOk) {
            setApiUrl(ip); // حفظ العنوان إذا كان ناجحاً
            setCurrentStatus(true);
        }
    };

    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn space-y-8">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Cloud className="text-blue-500"/> اتصال وربط سحابي</h3>
                    <p className="text-gray-500 text-sm mt-1">ربط التطبيق بالخادم المعتمد ضمن الشبكة الافتراضية (ZeroTier أو عنوان داخلي).</p>
                </div>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${currentStatus ? 'bg-green-50 text-green-600 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                    <div className={`w-2 h-2 rounded-full ${currentStatus ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    {currentStatus ? 'متصل بالخادم' : 'غير متصل بالخادم'}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                <div className="space-y-6">
                    <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                        <label className="block text-xs font-black text-blue-600 mb-3 uppercase tracking-widest">عنوان الخادم</label>
                        <div className="relative">
                            <input 
                                dir="ltr"
                                type="text" 
                                value={ip} 
                                onChange={e => setIp(e.target.value)}
                                className="w-full p-4 border-2 border-white rounded-xl font-mono text-center text-2xl focus:border-blue-500 outline-none shadow-sm" 
                                placeholder="192.168.1.100"
                            />
                            <div className="absolute right-3 top-4 text-gray-300">
                                <Wifi size={20}/>
                            </div>
                        </div>
                        <p className="text-[10px] text-blue-400 mt-3 font-medium">* أدخل عنوان الخادم المعتمد لنسختك السحابية/الفرعية (ZeroTier أو عنوان داخلي).</p>
                    </div>

                    <button 
                        onClick={handleTest}
                        disabled={isTesting || !ip}
                        className={`w-full py-4 rounded-xl font-black text-lg shadow-xl transition-all transform active:scale-95 flex items-center justify-center gap-3 ${isTesting ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                    >
                        {isTesting ? <RefreshCw className="animate-spin" /> : <Wifi />}
                        {isTesting ? 'جاري محاولة الاتصال...' : 'اختبار الاتصال وحفظ'}
                    </button>

                    {testResult === 'success' && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-700 animate-fadeIn">
                            <CheckCircle2 />
                            <span className="font-bold">تم الاتصال بنجاح! التطبيق الآن مرتبط بالسيرفر.</span>
                        </div>
                    )}

                    {testResult === 'failed' && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 animate-fadeIn">
                            <XCircle />
                            <span className="font-bold">فشل الاتصال. تأكد من أن السيرفر يعمل ومن أنك على نفس الشبكة.</span>
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <div className="border rounded-2xl p-6 bg-gray-50 flex flex-col items-center text-center">
                        <div className="bg-white p-3 rounded-2xl shadow-sm mb-4">
                            <Server className="text-gray-400" size={32}/>
                        </div>
                        <h4 className="font-bold text-gray-700">كيفية الربط السحابي؟</h4>
                        <ul className="text-right w-full mt-4 space-y-2 text-xs text-gray-500 font-medium">
                            <li className="flex gap-2"><span>1.</span> تأكد من تشغيل نسخة الكمبيوتر الرئيسية.</li>
                            <li className="flex gap-2"><span>2.</span> تأكد من أن الهاتف والكمبيوتر متصلان بنفس شبكة الواي فاي.</li>
                            <li className="flex gap-2"><span>3.</span> أدخل عنوان الـ IP الذي يظهر في شاشة الـ Dashboard بالكمبيوتر.</li>
                        </ul>
                    </div>
                    
                    <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-xl flex items-start gap-3">
                        <ShieldCheck className="text-yellow-600 shrink-0" size={20}/>
                        <div className="text-[10px] text-yellow-800 leading-relaxed font-bold">
                            سيقوم النظام تلقائياً بتشفير بياناتك عند إرسالها عبر الشبكة المحلية لضمان أمان مخزونك.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CloudLink;
