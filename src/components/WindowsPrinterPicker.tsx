import React, { useState, useEffect } from 'react';
import { X, Printer, RefreshCw, Monitor } from 'lucide-react';
import { listWindowsPrinters, type WindowsPrinter, type PaperSize } from '../printing/thermalPrinter';

const PAPER_OPTIONS: PaperSize[] = ['58mm', '80mm', '85mm', 'A5', 'A4'];

interface WindowsPrinterPickerProps {
    open: boolean;
    onClose: () => void;
    onSelect: (printer: WindowsPrinter, paperSize: PaperSize) => void;
    onUseBrowserPrint?: () => void;
    defaultPaperSize?: PaperSize;
}

const WindowsPrinterPicker: React.FC<WindowsPrinterPickerProps> = ({ 
    open, 
    onClose, 
    onSelect, 
    onUseBrowserPrint,
    defaultPaperSize = '80mm'
}) => {
    const [printers, setPrinters] = useState<WindowsPrinter[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [selectedPaperSize, setSelectedPaperSize] = useState<PaperSize>(defaultPaperSize);
    const [customPrinterName, setCustomPrinterName] = useState('');

    const loadPrinters = async () => {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            const list = await listWindowsPrinters();
            setPrinters(list);
        } catch (e: any) {
            setPrinters([]);
            setErrorMsg('فشل في جلب قائمة الطابعات');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadPrinters();
        }
    }, [open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fadeIn">
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold">
                        <Printer size={20} />
                        اختيار الطابعة
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 transition">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Paper Size Selection */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2">حجم الورق</label>
                        <div className="flex gap-2">
                            {PAPER_OPTIONS.map((size) => (
                                <button
                                    key={size}
                                    onClick={() => setSelectedPaperSize(size)}
                                    className={`flex-1 py-2 px-3 rounded-lg font-bold text-sm transition ${
                                        selectedPaperSize === size 
                                            ? 'bg-primary text-white' 
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {size === '58mm' ? '58 مم' : size === '80mm' ? '80 مم' : size === '85mm' ? '85 مم' : size}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Printer List */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-gray-500">الطابعات المتاحة</span>
                            <button
                                onClick={loadPrinters}
                                className="text-xs font-bold text-primary flex items-center gap-1"
                            >
                                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                                تحديث
                            </button>
                        </div>

                        {isLoading && (
                            <div className="text-center py-4 text-gray-500 font-bold text-sm">
                                جاري تحميل الطابعات...
                            </div>
                        )}

                        {!isLoading && printers.length === 0 && (
                            <div className="text-center py-4">
                                <Monitor size={40} className="mx-auto text-gray-300 mb-2" />
                                <p className="text-xs text-gray-500 font-bold">
                                    لا توجد طابعات معرفة
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    الطابعة الافتراضية سيتم استخدامها
                                </p>
                            </div>
                        )}

                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {printers.map((printer) => (
                                <button
                                    key={printer.id}
                                    onClick={() => onSelect(printer, selectedPaperSize)}
                                    className="w-full text-right px-4 py-3 rounded-xl border border-gray-200 hover:border-primary hover:bg-primary/5 transition"
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-gray-800 flex items-center gap-2">
                                                {printer.name}
                                                {printer.isDefault && (
                                                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">
                                                        افتراضية
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 font-mono mt-1">
                                                {printer.id}
                                            </div>
                                        </div>
                                        <Printer size={18} className="text-gray-300" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Manual Printer Name Input */}
                    <div className="border-t pt-4">
                        <label className="block text-xs font-bold text-gray-500 mb-2">
                            أو أدخل اسم الطابعة يدوياً
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="اسم الطابعة..."
                                value={customPrinterName}
                                onChange={(e) => setCustomPrinterName(e.target.value)}
                                className="flex-1 border rounded-lg px-3 py-2 text-sm font-bold"
                            />
                            <button
                                onClick={() => {
                                    if (customPrinterName.trim()) {
                                        onSelect({
                                            id: customPrinterName.trim(),
                                            name: customPrinterName.trim(),
                                            isDefault: false
                                        }, selectedPaperSize);
                                    }
                                }}
                                disabled={!customPrinterName.trim()}
                                className="bg-primary text-white px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                طباعة
                            </button>
                        </div>
                    </div>

                    {/* Browser Print Option */}
                    {onUseBrowserPrint && (
                        <div className="border-t pt-4">
                            <button
                                onClick={onUseBrowserPrint}
                                className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-bold text-sm hover:border-primary hover:text-primary transition flex items-center justify-center gap-2"
                            >
                                <Printer size={16} />
                                استخدام طابعة المتصفح الافتراضية
                            </button>
                        </div>
                    )}

                    {errorMsg && (
                        <div className="text-xs text-red-600 font-bold text-center">
                            {errorMsg}
                        </div>
                    )}

                    <div className="text-[10px] text-gray-400 text-center">
                        سيتم فتح نافذة اختيار الطابعة في المتصفح
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WindowsPrinterPicker;
