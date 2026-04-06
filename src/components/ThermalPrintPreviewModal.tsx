import React, { useState, useEffect, useRef } from 'react';
import { X, Printer, Eye, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { buildThermalReceipt, type PaperSize } from '../printing/thermalPrinter';

interface ThermalPrintPreviewModalProps {
    open: boolean;
    onClose: () => void;
    receiptData: {
        storeName: string;
        storePhone?: string;
        storeAddress?: string;
        invoiceNo: string;
        dateText: string;
        customerName: string;
        items: Array<{ name: string; qty: number; price: number }>;
        discount?: number;
        paid?: number;
        currencyLabel: string;
    };
    onPrint?: (paperSize: PaperSize) => void;
    paperSize?: PaperSize;
    title?: string;
}

const ThermalPrintPreviewModal: React.FC<ThermalPrintPreviewModalProps> = ({
    open,
    onClose,
    receiptData,
    onPrint,
    paperSize: initialPaperSize = '80mm',
    title = 'معاينة الفاتورة'
}) => {
    const [paperSize, setPaperSize] = useState<PaperSize>(initialPaperSize);
    const [zoom, setZoom] = useState(1);
    const [previewHtml, setPreviewHtml] = useState('');
    const previewRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open && receiptData) {
            const html = buildThermalReceipt(receiptData, paperSize);
            setPreviewHtml(html);
        }
    }, [open, receiptData, paperSize]);

    if (!open) return null;

    const handlePrint = () => {
        if (onPrint) {
            onPrint(paperSize);
        } else {
            // Default print behavior
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                const dimensions: Record<PaperSize, { width: string }> = {
                    '58mm': { width: '58mm' },
                    '80mm': { width: '80mm' },
                    '85mm': { width: '85mm' },
                    'A4': { width: '210mm' },
                    'A5': { width: '148mm' }
                };
                const dim = dimensions[paperSize] || dimensions['80mm'];
                
                printWindow.document.write(`
                    <!DOCTYPE html>
                    <html dir="rtl" lang="ar">
                    <head>
                        <title>${title}</title>
                        <meta charset="UTF-8">
                        <style>
                            @page { size: ${dim.width} auto; margin: 0; }
                            html, body {
                                width: ${dim.width};
                                max-width: ${dim.width};
                                margin: 0 auto;
                                padding: 0;
                                background: #fff;
                            }
                            body { 
                                font-family: Tahoma, Arial, sans-serif; 
                                direction: rtl; 
                                overflow: hidden;
                            }
                            * { visibility: visible; }
                        </style>
                    </head>
                    <body>
                        ${previewHtml}
                        <script>
                            window.onload = function() {
                                setTimeout(function() {
                                    window.print();
                                    window.close();
                                }, 300);
                            };
                        </script>
                    </body>
                    </html>
                `);
                printWindow.document.close();
            }
        }
    };

    const getPreviewWidth = () => {
        switch (paperSize) {
            case '58mm': return '220px';
            case '80mm': return '280px';
            case '85mm': return '300px';
            case 'A5': return '420px';
            case 'A4': return '595px';
            default: return '280px';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-5xl max-h-[95vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-fadeIn">
                {/* Header */}
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white p-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <Eye size={24} className="text-primary" />
                        <div>
                            <h3 className="font-bold text-lg">{title}</h3>
                            <p className="text-xs text-gray-400">فاتورة رقم: {receiptData.invoiceNo}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Zoom Controls */}
                        <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1 ml-4">
                            <button 
                                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                                className="p-1.5 hover:bg-white/20 rounded transition"
                                title="تصغير"
                            >
                                <ZoomOut size={16} />
                            </button>
                            <span className="text-xs font-bold px-2 min-w-[50px] text-center">
                                {Math.round(zoom * 100)}%
                            </span>
                            <button 
                                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                                className="p-1.5 hover:bg-white/20 rounded transition"
                                title="تكبير"
                            >
                                <ZoomIn size={16} />
                            </button>
                        </div>

                        {/* Paper Size */}
                        <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
                            {(['58mm', '80mm', '85mm', 'A5', 'A4'] as PaperSize[]).map((size) => (
                                <button
                                    key={size}
                                    onClick={() => setPaperSize(size)}
                                    className={`px-3 py-1.5 rounded text-xs font-bold transition ${
                                        paperSize === size 
                                            ? 'bg-primary text-white' 
                                            : 'hover:bg-white/20'
                                    }`}
                                >
                                    {size === '58mm' ? '58مم' : size === '80mm' ? '80مم' : size === '85mm' ? '85مم' : size}
                                </button>
                            ))}
                        </div>

                        {/* Print Button */}
                        {onPrint && (
                            <button
                                onClick={handlePrint}
                                className="bg-primary hover:bg-teal-700 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 transition shadow-lg"
                            >
                                <Printer size={18} />
                                طباعة
                            </button>
                        )}
                        
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Preview Area */}
                <div className="flex-1 overflow-auto bg-gray-100 p-8 flex justify-center custom-scrollbar">
                    <div 
                        ref={previewRef}
                        className="bg-white shadow-2xl transition-all duration-300 overflow-hidden"
                        style={{ 
                            width: getPreviewWidth(),
                            transform: `scale(${zoom})`,
                            transformOrigin: 'top center'
                        }}
                    >
                        <div 
                            className="receipt-content"
                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                            style={{ 
                                padding: paperSize === '58mm' || paperSize === '80mm' || paperSize === '85mm' ? '0' : '15px',
                                fontSize: paperSize === '58mm' || paperSize === '80mm' || paperSize === '85mm' ? '10px' : '12px',
                                background: '#fff'
                            }}
                        />
                    </div>
                </div>

                {/* Footer Info */}
                <div className="bg-gray-50 px-4 py-3 border-t shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-500">
                            المقاس المختار: <strong>{paperSize === '58mm' ? '58 ملم (حرارية)' : paperSize === '80mm' ? '80 ملم (حرارية)' : paperSize === '85mm' ? '85 ملم (حرارية)' : paperSize}</strong>
                        </span>
                        <span className="text-xs text-gray-400">
                            عند الطباعة سيتم فتح نافذة اختيار الطابعة
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handlePrint}
                            className="bg-primary hover:bg-teal-700 text-white px-4 py-1.5 rounded-lg font-bold text-sm flex items-center gap-2 transition"
                        >
                            <Printer size={14} />
                            طباعة الآن
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                .receipt-content table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 10px 0;
                }
                .receipt-content th,
                .receipt-content td {
                    padding: 4px;
                    text-align: right;
                }
                .receipt-content th {
                    background: #f5f5f5;
                    border-bottom: 1px solid #000;
                }
                .receipt-content .grand-total {
                    background: #333;
                    color: white;
                    padding: 8px;
                    font-weight: bold;
                }
            `}</style>
        </div>
    );
};

export default ThermalPrintPreviewModal;
