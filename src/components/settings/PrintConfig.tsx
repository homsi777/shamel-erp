
import React, { useState } from 'react';
import { Eye, LayoutTemplate, QrCode, Image as ImageIcon, MapPin, Phone, AlignCenter, Maximize } from 'lucide-react';
import { AppSettings, DEFAULT_PRINT_SETTINGS, PrintProfile, PaperSize } from '../../types';

interface Props {
    settings: AppSettings;
    updatePrintProfile: (profileId: string, field: keyof PrintProfile, value: any) => void;
}

const PrintConfig: React.FC<Props> = ({ settings, updatePrintProfile }) => {
    const [selectedProfile, setSelectedProfile] = useState<keyof NonNullable<AppSettings['print']>['profiles']>('sale_invoice');
    const safePrint = {
        ...DEFAULT_PRINT_SETTINGS,
        ...(settings.print || {}),
        profiles: {
            ...DEFAULT_PRINT_SETTINGS.profiles,
            ...((settings.print as any)?.profiles || {}),
            sale_invoice: { ...DEFAULT_PRINT_SETTINGS.profiles.sale_invoice, ...((settings.print as any)?.profiles?.sale_invoice || {}) },
            purchase_invoice: { ...DEFAULT_PRINT_SETTINGS.profiles.purchase_invoice, ...((settings.print as any)?.profiles?.purchase_invoice || {}) },
            vouchers: { ...DEFAULT_PRINT_SETTINGS.profiles.vouchers, ...((settings.print as any)?.profiles?.vouchers || {}) },
            reports: { ...DEFAULT_PRINT_SETTINGS.profiles.reports, ...((settings.print as any)?.profiles?.reports || {}) },
        },
    };
    
    const paperSizes: { id: PaperSize, label: string }[] = [
        { id: 'A4', label: 'قياسي A4' },
        { id: 'A5', label: 'متوسط A5' },
        { id: '85mm', label: 'حراري 85مم' },
        { id: '80mm', label: 'حراري 80مم' }
    ];

    // --- محاكي معاينة الطباعة الذكي ---
    const PrintPreview = () => {
        const profile = safePrint.profiles[selectedProfile];
        const company = settings.company;
        const isThermal = profile.paperSize === '80mm' || profile.paperSize === '85mm';
        const isLandscape = profile.orientation === 'landscape';

        // محاكاة الورقة
        const paperClass = isThermal 
            ? 'w-[320px] min-h-[500px]' 
            : isLandscape ? 'w-[800px] h-[565px]' : 'w-[500px] h-[707px]';

        return (
          <div className={`${paperClass} bg-white shadow-2xl mx-auto my-4 text-gray-900 flex flex-col p-6 border-2 border-gray-100 relative transition-all duration-500`}>
            {/* زخرفة خلفية المعاينة */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.02] bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:16px_16px]"></div>
            
            {/* الترويسة العلوية */}
            <div className={`flex ${isThermal ? 'flex-col items-center text-center' : 'justify-between items-start'} mb-6 border-b-2 border-gray-900 pb-4 relative z-10`}>
              {profile.showLogo && (
                  <div className={`${isThermal ? 'w-20 h-20' : 'w-24 h-24'} bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-300 mb-2`}>
                      {company.logo ? <img src={company.logo} className="w-full h-full object-contain" /> : <ImageIcon size={32}/>}
                  </div>
              )}
              
              <div className={`${isThermal ? 'text-center' : 'text-right'} flex-1 px-4`}>
                <h1 className="font-black text-2xl text-gray-900 leading-tight">{profile.headerTitle || company.name}</h1>
                <h2 className="text-gray-600 font-bold text-lg mt-1">{profile.headerSubtitle || 'فاتورة رسمية'}</h2>
                {profile.headerExtra && <p className="text-gray-500 text-sm italic mt-1">{profile.headerExtra}</p>}
                
                <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 ${isThermal ? 'justify-center' : 'justify-end'} text-[11px] font-bold text-gray-400 uppercase tracking-tighter`}>
                  {profile.showPhone && <span className="flex items-center gap-1 font-numeric"><Phone size={10}/> {company.phone1}</span>}
                  {profile.showAddress && <span className="flex items-center gap-1"><MapPin size={10}/> {company.address}</span>}
                </div>
              </div>
            </div>

            {/* بيانات تجريبية للفاتورة */}
            <div className="flex justify-between mb-6 text-[11px] font-bold text-gray-500 border-b border-dashed pb-4">
               <div>
                  <p className="mb-1">رقم المستند: <span className="text-black font-numeric">#2024-0098</span></p>
                  <p>التاريخ: <span className="text-black font-numeric">{new Date().toLocaleDateString('ar-EG')}</span></p>
               </div>
               <div className="text-left">
                  <p className="mb-1">العميل: <span className="text-black italic">شركة النسيج العربية</span></p>
                  <p>الحالة: <span className="text-green-600">مدفوع نقداً</span></p>
               </div>
            </div>

            {/* الجدول (نسخة مصغرة) */}
            <div className="flex-1">
               <table className="w-full text-right text-xs">
                  <thead className="bg-gray-100 text-gray-600 font-black">
                     <tr>
                        <th className="p-2">الصنف</th>
                        <th className="p-2 text-center">الكمية</th>
                        <th className="p-2 text-left">الإجمالي</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                     <tr><td className="p-2 font-bold">حرير طبيعي - كود 01</td><td className="p-2 text-center font-numeric">10 م</td><td className="p-2 text-left font-numeric">120.00</td></tr>
                     <tr><td className="p-2 font-bold">مخمل إيطالي - أحمر</td><td className="p-2 text-center font-numeric">5 توب</td><td className="p-2 text-left font-numeric">450.00</td></tr>
                  </tbody>
               </table>
            </div>

            {/* التذييل والباركود */}
            <div className="mt-6 pt-6 border-t-2 border-gray-900">
               <div className="flex justify-between items-end">
                  <div className="flex-1 text-right">
                     <p className="text-xl font-black text-gray-900 font-numeric tracking-tighter">إجمالي الصافي: 570.00 $</p>
                     <p className="text-[10px] text-gray-400 mt-2 whitespace-pre-line">{profile.footerText || 'نشكركم لثقتكم بنا'}</p>
                  </div>
                  {profile.showQrCode && (
                      <div className="p-2 border-2 border-gray-100 rounded-lg bg-white shadow-sm">
                          <QrCode size={isThermal ? 40 : 56} className="text-gray-800" />
                      </div>
                  )}
               </div>
               <div className="mt-4 text-[9px] text-center text-gray-300 font-numeric tracking-widest uppercase border-t border-gray-50 pt-2">
                   Powered by Comprehensive WMS - Cloud Edition
               </div>
            </div>
          </div>
        );
    };

    return (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-fadeIn">
            
            {/* لوحة التحكم الجانبية */}
            <div className="xl:col-span-5 space-y-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold mb-6 text-gray-800 flex items-center gap-2 border-b pb-3">
                        <LayoutTemplate className="text-primary" size={20}/>
                        تخصيص ملفات الطباعة
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-2 mb-8">
                        {[
                            {id: 'sale_invoice', label: 'فاتورة مبيعات'},
                            {id: 'purchase_invoice', label: 'فاتورة مشتريات'},
                            {id: 'vouchers', label: 'سندات الصرف'},
                            {id: 'reports', label: 'تقارير الجرد'}
                        ].map(type => (
                            <button 
                                key={type.id} 
                                onClick={() => setSelectedProfile(type.id as any)} 
                                className={`px-4 py-3 rounded-xl font-bold text-xs transition-all border-2 ${selectedProfile === type.id ? 'bg-primary text-white border-primary shadow-lg' : 'bg-gray-50 text-gray-500 border-gray-100 hover:border-primary/30'}`}
                            >
                                {type.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-6">
                        {/* إعدادات الورق */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <Maximize size={14}/> حجم الورق والاتجاه
                            </h4>
                            <div className="flex flex-wrap gap-2">
                                {paperSizes.map(size => (
                                    <button 
                                        key={size.id} 
                                        onClick={() => updatePrintProfile(selectedProfile, 'paperSize', size.id)} 
                                        className={`px-4 py-2 rounded-lg text-xs font-bold border-2 transition ${safePrint.profiles[selectedProfile].paperSize === size.id ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-100'}`}
                                    >
                                        {size.label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => updatePrintProfile(selectedProfile, 'orientation', 'portrait')} className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold ${safePrint.profiles[selectedProfile].orientation === 'portrait' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-400 border-gray-100'}`}>رأسي (Portrait)</button>
                                <button onClick={() => updatePrintProfile(selectedProfile, 'orientation', 'landscape')} className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold ${safePrint.profiles[selectedProfile].orientation === 'landscape' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-400 border-gray-100'}`}>أفقي (Landscape)</button>
                            </div>
                        </div>

                        {/* إعدادات الترويسة */}
                        <div className="space-y-4 pt-4 border-t">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <AlignCenter size={14}/> ترويسات المستند المتعددة
                            </h4>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">الترويسة 1 (الاسم التجاري)</label>
                                    <input type="text" value={safePrint.profiles[selectedProfile].headerTitle} onChange={e => updatePrintProfile(selectedProfile, 'headerTitle', e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold text-gray-700 focus:border-primary outline-none transition shadow-sm" placeholder="اسم الشركة الرئيسي..." />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">الترويسة 2 (العنوان الوظيفي)</label>
                                    <input type="text" value={safePrint.profiles[selectedProfile].headerSubtitle} onChange={e => updatePrintProfile(selectedProfile, 'headerSubtitle', e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold text-gray-700 focus:border-primary outline-none transition shadow-sm" placeholder="مثال: تجارة عامة ومستودعات..." />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1">الترويسة 3 (معلومات إضافية)</label>
                                    <input type="text" value={safePrint.profiles[selectedProfile].headerExtra || ''} onChange={e => updatePrintProfile(selectedProfile, 'headerExtra', e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 font-bold text-gray-700 focus:border-primary outline-none transition shadow-sm" placeholder="رقم السجل التجاري أو شعار جانبي..." />
                                </div>
                            </div>
                        </div>

                        {/* الخيارات البصرية */}
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                                <input type="checkbox" checked={safePrint.profiles[selectedProfile].showLogo} onChange={e => updatePrintProfile(selectedProfile, 'showLogo', e.target.checked)} className="w-4 h-4 text-primary rounded" />
                                <span className="text-xs font-bold text-gray-700">إظهار الشعار</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                                <input type="checkbox" checked={safePrint.profiles[selectedProfile].showQrCode} onChange={e => updatePrintProfile(selectedProfile, 'showQrCode', e.target.checked)} className="w-4 h-4 text-primary rounded" />
                                <span className="text-xs font-bold text-gray-700">رمز الـ QR</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                                <input type="checkbox" checked={safePrint.profiles[selectedProfile].showPhone} onChange={e => updatePrintProfile(selectedProfile, 'showPhone', e.target.checked)} className="w-4 h-4 text-primary rounded" />
                                <span className="text-xs font-bold text-gray-700">أرقام الهاتف</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                                <input type="checkbox" checked={safePrint.profiles[selectedProfile].showAddress} onChange={e => updatePrintProfile(selectedProfile, 'showAddress', e.target.checked)} className="w-4 h-4 text-primary rounded" />
                                <span className="text-xs font-bold text-gray-700">العنوان</span>
                            </label>
                        </div>

                        <div className="pt-4 border-t">
                            <label className="block text-[10px] font-bold text-gray-400 mb-1">تذييل الصفحة (Footer)</label>
                            <textarea rows={2} value={safePrint.profiles[selectedProfile].footerText} onChange={e => updatePrintProfile(selectedProfile, 'footerText', e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 text-xs focus:border-primary outline-none transition shadow-sm" placeholder="كلمة شكر، شروط الاستبدال..."></textarea>
                        </div>
                    </div>
                </div>
            </div>

            {/* منطقة المعاينة الحية */}
            <div className="xl:col-span-7 flex flex-col h-full min-h-[700px]">
                <div className="bg-gray-900 text-white p-4 rounded-t-3xl flex justify-between items-center shadow-xl z-20 border-b border-white/5">
                    <h4 className="font-bold flex items-center gap-3 text-sm">
                        <div className="bg-primary p-1.5 rounded-lg"><Eye size={18}/></div>
                        المعاينة الحية للطباعة
                    </h4>
                    <div className="flex gap-2">
                        <span className="text-[10px] font-bold px-2 py-1 bg-white/10 rounded uppercase tracking-widest">{safePrint.profiles[selectedProfile].paperSize}</span>
                        <span className="text-[10px] font-bold px-2 py-1 bg-white/10 rounded uppercase tracking-widest">{safePrint.profiles[selectedProfile].orientation}</span>
                    </div>
                </div>
                
                <div className="bg-gray-200 p-10 rounded-b-3xl border-2 border-gray-300 shadow-inner flex-1 flex items-start justify-center overflow-auto custom-scrollbar bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
                    <div className="animate-fadeIn">
                        <PrintPreview />
                    </div>
                </div>

                <div className="mt-4 p-4 bg-yellow-50 border-2 border-yellow-100 rounded-2xl flex items-center gap-4 text-yellow-800">
                    <div className="bg-yellow-200 p-2 rounded-xl"><LayoutTemplate size={24}/></div>
                    <div className="text-xs leading-relaxed">
                        <p className="font-bold">نصيحة الطباعة:</p>
                        <p className="opacity-80">تأكد من مطابقة حجم الورق الفعلي في الطابعة مع الإعدادات المختارة هنا لتجنب تشوه المحتوى.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default PrintConfig;
