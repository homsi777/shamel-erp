
import React, { useState, useEffect, useRef } from 'react';
import { X, ScanBarcode, Edit, Trash2, RefreshCw, Save, CornerUpLeft, ArrowRightLeft, Printer, Share2, FileText, Eye, UtensilsCrossed } from 'lucide-react';
import { Invoice, InvoiceItem, AppSettings, InventoryItem, formatNumber, formatDate, Client } from '../../types';
import Combobox from '../Combobox';
import { apiRequest } from '../../lib/api';
import { printInvoiceNative, exportInvoicePDF } from '../../modules/reports/report.actions';
import { Capacitor } from '@capacitor/core';
import { printSaleInvoiceBluetooth, printSaleInvoice } from '../../printing/printService';
import { buildThermalReceipt, type PaperSize, type WindowsPrinter } from '../../printing/thermalPrinter';
import { isAndroidNative, scanBarcodeOnce } from '../../lib/barcodeScanner';
import PrinterPicker from '../../components/PrinterPicker';
import WindowsPrinterPicker from '../../components/WindowsPrinterPicker';
import ThermalPrintPreviewModal from '../../components/ThermalPrintPreviewModal';
import { AdaptiveModal, AdaptiveTable } from '../responsive';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';
import {
    BASE_CURRENCY,
    currencySymbol,
    invoiceAmountBase,
    invoiceAmountTransaction,
    invoiceCurrencyCode,
    invoiceExchangeRate,
    lineTotalTransaction,
    lineUnitTransaction
} from '../../lib/currencySemantics';

const normalizeInvoiceItems = (items: unknown): any[] => {
    const toArray = (value: unknown): any[] => {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const maybeRows = (value as any).rows;
            if (Array.isArray(maybeRows)) return maybeRows;
            return [];
        }
        if (typeof value === 'string') {
            try {
                return toArray(JSON.parse(value));
            } catch {
                return [];
            }
        }
        return [];
    };

    return toArray(items).map((item: any) => ({
        ...item,
        quantity: Number(item?.quantity ?? item?.metersSold ?? 0) || 0,
        unitPrice: Number(item?.unitPrice ?? item?.priceAtSale ?? 0) || 0,
        total: Number(item?.total ?? ((Number(item?.quantity ?? item?.metersSold ?? 0) || 0) * (Number(item?.unitPrice ?? item?.priceAtSale ?? 0) || 0))) || 0
    }));
};

const renderTextileInlineMeta = (item: any) => {
    if (!item?.isTextile) return null;
    return (
        <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
            {item.textileColorName && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">لون: {item.textileColorName}</span>}
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">رولات: {formatNumber(item.textileRollCount || 0)}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                طول: {formatNumber(item.textileTotalLength || item.quantity || 0)} {item.textileBaseUom === 'yard' ? 'ياردة' : 'متر'}
            </span>
        </div>
    );
};

// --- PRINT MODAL ---
export const InvoicePrintModal: React.FC<{ invoice: Invoice; settings?: AppSettings; onClose: () => void; autoExportPdf?: boolean }> = ({ invoice, settings, onClose, autoExportPdf }) => {
    const layout = useResponsiveLayout();
    const printSettings = settings?.print;

    const isMobile = Capacitor.isNativePlatform();
    const isAndroid = isAndroidNative();
    const [printerPickerOpen, setPrinterPickerOpen] = useState(false);
    const [windowsPrinterPickerOpen, setWindowsPrinterPickerOpen] = useState(false);
    const [thermalPreviewOpen, setThermalPreviewOpen] = useState(false);
    const [printerPickerResolve, setPrinterPickerResolve] = useState<((id: string | null) => void) | null>(null);
    const macRegex = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
    const profileKey = invoice.type === 'purchase' ? 'purchase_invoice' : 'sale_invoice';
    const profile = printSettings?.profiles?.[profileKey];
    const company = settings?.company;
    const safeCompany = company || { name: '', phone1: '', address: '' };
    const safeItems = normalizeInvoiceItems(invoice.items);
    const hasPrintProfile = Boolean(printSettings && profile && company);
    const isThermal = profile?.paperSize === '80mm' || profile?.paperSize === '85mm';
    const currency = invoiceCurrencyCode(invoice);
    const invoiceTypeLabel = invoice.type === 'sale'
        ? 'فاتورة بيع'
        : invoice.type === 'purchase'
        ? 'فاتورة شراء'
        : invoice.type === 'return'
        ? (invoice.returnType === 'purchase' ? 'فاتورة مرتجع مشتريات' : 'فاتورة مرتجع مبيعات')
        : invoice.type === 'exchange'
        ? 'فاتورة استبدال'
        : 'بضاعة أول المدة';
    const paymentLabel = invoice.paymentType === 'cash' ? 'نقدي' : 'آجل';
    const [isExporting, setIsExporting] = useState(false);

    // Build receipt data for thermal printing
    const buildReceiptData = (): any => ({
        storeName: safeCompany.name,
        storePhone: safeCompany.phone1,
        storeAddress: safeCompany.address,
        invoiceNo: invoice.invoiceNumber,
        dateText: formatDate(invoice.date),
        customerName: invoice.clientName || '',
        items: safeItems.map((item) => ({
            name: item.fabricName || item.itemName || 'صنف',
            qty: Number(item.quantity || 0),
            price: Number(lineUnitTransaction(item, invoice) || 0)
        })),
        discount: Number(invoiceAmountTransaction(invoice, 'discount') || 0) || undefined,
        paid: Number(invoiceAmountTransaction(invoice, 'paid') || 0),
        currencyLabel: currency
    });

    // Windows Printer functions
    const handleWindowsPrinterSelect = async (printer: WindowsPrinter, paperSize: PaperSize) => {
        setWindowsPrinterPickerOpen(false);
        const receiptData = buildReceiptData();
        try {
            await printSaleInvoice(receiptData, { printer, paperSize });
            alert('تم ارسال امر الطباعة');
        } catch (e) {
            alert('فشلت الطباعة');
        }
    };

    const handleWindowsPrinterClose = () => {
        setWindowsPrinterPickerOpen(false);
    };

    const handleWindowsPrint = () => {
        setWindowsPrinterPickerOpen(true);
    };

    const handleShowPreview = () => {
        setThermalPreviewOpen(true);
    };

    const handlePreviewPrint = (paperSize: PaperSize) => {
        setThermalPreviewOpen(false);
        setWindowsPrinterPickerOpen(true);
    };

    const requestPrinterId = () => {
        const existing = printSettings?.thermal?.printerId || '';
        if (existing.trim()) return Promise.resolve(existing.trim());
        return new Promise<string | null>((resolve) => {
            setPrinterPickerResolve(() => resolve);
            setPrinterPickerOpen(true);
        });
    };

    const handlePrinterSelect = (printer: { id: string }) => {
        if (!settings || !printSettings) return;
        const nextId = printer.id.trim();
        const thermal = printSettings?.thermal || { enabled: true, printerId: '', paperSize: '80mm', autoPrintPos: true };
        const next = {
            ...settings,
            print: {
                ...settings.print,
                thermal: { ...thermal, enabled: true, printerId: nextId }
            }
        };
        localStorage.setItem('shamel_settings', JSON.stringify(next));
        setPrinterPickerOpen(false);
        printerPickerResolve?.(nextId);
        setPrinterPickerResolve(null);
    };

    const handlePrinterClose = () => {
        setPrinterPickerOpen(false);
        printerPickerResolve?.(null);
        setPrinterPickerResolve(null);
    };

    const handleAction = () => {
        printInvoiceNative('invoice-print-area', invoice.invoiceNumber);
    };

    const handleExportPDF = async () => {
        if (isExporting) return;
        setIsExporting(true);
        await exportInvoicePDF('invoice-print-area', invoice.invoiceNumber);
        setIsExporting(false);
    };

    const handleExportImage = async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            const el = document.getElementById('invoice-print-area');
            if (!el) { setIsExporting(false); return; }
            const html2canvas = (await import('html2canvas')).default;
            const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const link = document.createElement('a');
            link.download = `invoice-${invoice.invoiceNumber}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) { console.error('Image export failed', err); }
        setIsExporting(false);
    };

    const autoExportedRef = useRef(false);
    useEffect(() => {
        if (autoExportPdf && !autoExportedRef.current) {
            autoExportedRef.current = true;
            (async () => {
                await handleExportPDF();
                onClose();
            })();
        }
    }, [autoExportPdf]);

    if (!hasPrintProfile) return null;
    const activeProfile = profile as NonNullable<typeof profile>;
    const activeCompany = company as NonNullable<typeof company>;

    const handleBluetoothPrint = async () => {
        if (invoice.type !== 'sale') {
            alert('\u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0628\u0644\u0648\u062a\u0648\u062b \u0645\u062a\u0627\u062d\u0629 \u0644\u0641\u0648\u0627\u062a\u064a\u0631 \u0627\u0644\u0628\u064a\u0639 \u0641\u0642\u0637.');
            return;
        }
        const printerId = await requestPrinterId();
        if (!printerId) return;
        if (!macRegex.test(printerId)) { alert('معرف الطابعة غير صالح. استخدم صيغة MAC: 00:11:22:33:44:55'); return; }
        try {
            await printSaleInvoiceBluetooth({
                printerIdOrMac: printerId,
                paper: (printSettings?.thermal?.paperSize || '80mm') as any,
                data: {
                    storeName: safeCompany.name,
                    storePhone: safeCompany.phone1,
                    invoiceNo: invoice.invoiceNumber,
                    dateText: formatDate(invoice.date),
                    customerName: invoice.clientName || '',
                    items: safeItems.map((item) => ({
                        name: item.fabricName || item.itemName || '\u0635\u0646\u0641',
                        qty: Number(item.quantity || 0),
                        price: Number(lineUnitTransaction(item, invoice) || 0)
                    })),
                    discount: Number(invoiceAmountTransaction(invoice, 'discount') || 0) || undefined,
                    paid: Number(invoiceAmountTransaction(invoice, 'paid') || 0),
                    currencyLabel: currency
                }
            });
        } catch (e: any) {
            const msg = typeof e === 'string' ? e : (e?.error || e?.message || '');
            alert(msg ? `فشل الطباعة: ${msg}` : 'فشل الطباعة عبر البلوتوث.');
        }
    };

    return (
        <>
            <AdaptiveModal
                open
                onClose={onClose}
                size="xl"
                zIndex={600}
                panelClassName="flex h-full max-h-[95vh] flex-col overflow-hidden no-print"
            >
                <div className="flex h-full flex-col bg-white">
                    <div className="shrink-0 border-b border-gray-800 bg-gray-900 text-white">
                        <div className="flex items-center justify-between gap-3 p-4 md:p-5">
                            <div className="flex items-center gap-2">
                                <Printer size={20} className="text-primary" />
                                <h3 className="font-bold">معاينة الطباعة - فاتورة رقم {invoice.invoiceNumber}</h3>
                            </div>
                            <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10 transition">
                                <X size={20}/>
                            </button>
                        </div>
                        <div className="px-4 pb-4 md:px-5">
                            <div className={`grid gap-2 ${layout.isMobile ? 'grid-cols-2' : 'grid-flow-col auto-cols-max'} items-center`}>
                                <button
                                    onClick={handleShowPreview}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition"
                                >
                                    <Eye size={18}/>
                                    {layout.isMobile ? 'معاينة' : 'معاينة كاملة'}
                                </button>
                                <button
                                    onClick={handleWindowsPrint}
                                    className="bg-primary hover:bg-teal-700 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg"
                                >
                                    <Printer size={18}/>
                                    {layout.isMobile ? 'Windows' : 'طباعة (Windows)'}
                                </button>
                                <button
                                    onClick={handleAction}
                                    className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition"
                                >
                                    {isMobile ? <Share2 size={18}/> : <Printer size={18}/>} 
                                    {isMobile ? 'مشاركة' : 'طباعة المتصفح'}
                                </button>
                                <button
                                    onClick={handleExportPDF}
                                    className="bg-red-50 hover:bg-red-100 text-red-700 px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition border border-red-200"
                                >
                                    <FileText size={18}/> PDF
                                </button>
                                <button
                                    onClick={handleExportImage}
                                    disabled={isExporting}
                                    className="bg-purple-50 hover:bg-purple-100 text-purple-700 px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition border border-purple-200"
                                >
                                    <Eye size={18}/> صورة
                                </button>
                                {isAndroid && (
                                    <button
                                        onClick={handleBluetoothPrint}
                                        className="bg-gray-800 hover:bg-black text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg transform active:scale-95"
                                    >
                                        <Printer size={18}/> بلوتوث
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={`flex-1 overflow-y-auto bg-gray-100 ${layout.isMobile ? 'p-3 pb-6' : 'p-4 md:p-8'} custom-scrollbar`}>
                        {layout.isMobile && (
                            <div className="mb-4 space-y-3">
                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <div className="mb-3 flex items-center justify-between">
                                        <div className="text-sm font-black text-gray-800">ملخص الفاتورة</div>
                                        <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold text-gray-500">موبايل</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="rounded-xl bg-gray-50 p-3">
                                            <div className="text-[10px] text-gray-500">رقم الفاتورة</div>
                                            <div className="mt-1 font-numeric font-black text-gray-900">{invoice.invoiceNumber}</div>
                                        </div>
                                        <div className="rounded-xl bg-gray-50 p-3">
                                            <div className="text-[10px] text-gray-500">التاريخ</div>
                                            <div className="mt-1 font-numeric font-black text-gray-900">{formatDate(invoice.date)}</div>
                                        </div>
                                        <div className="rounded-xl bg-gray-50 p-3">
                                            <div className="text-[10px] text-gray-500">العميل</div>
                                            <div className="mt-1 font-bold text-gray-900">{invoice.clientName || '-'}</div>
                                        </div>
                                        <div className="rounded-xl bg-gray-50 p-3">
                                            <div className="text-[10px] text-gray-500">نوع الدفع</div>
                                            <div className="mt-1 font-bold text-gray-900">{paymentLabel}</div>
                                        </div>
                                        <div className="rounded-xl bg-emerald-50 p-3">
                                            <div className="text-[10px] text-emerald-700">الإجمالي</div>
                                            <div className="mt-1 font-numeric font-black text-emerald-700">{formatNumber(invoiceAmountTransaction(invoice, 'total'))} {currency}</div>
                                        </div>
                                        <div className="rounded-xl bg-blue-50 p-3">
                                            <div className="text-[10px] text-blue-700">المدفوع</div>
                                            <div className="mt-1 font-numeric font-black text-blue-700">{formatNumber(invoiceAmountTransaction(invoice, 'paid'))} {currency}</div>
                                        </div>
                                    </div>
                                    {currency !== BASE_CURRENCY && (
                                        <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[10px] text-gray-500">
                                            العملة: {currency} (1 {BASE_CURRENCY} = {Number(invoice.exchangeRate || 1).toLocaleString()} {currencySymbol(currency)})
                                        </div>
                                    )}
                                    {invoice.notes && (
                                        <div className="mt-3 rounded-xl border border-gray-100 bg-white px-3 py-2 text-[11px] text-gray-700">
                                            <span className="font-bold">ملاحظات:</span> {invoice.notes}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <div className="mb-3 text-sm font-black text-gray-800">عناصر الفاتورة</div>
                                    <AdaptiveTable
                                        rows={safeItems}
                                        keyExtractor={(item, idx) => `${item.itemId || item.fabricId || 'item'}-${idx}`}
                                        columns={[
                                            {
                                                id: 'item',
                                                header: 'الصنف',
                                                cell: (item: any) => <div><span className="font-bold">{item.fabricName || item.itemName}</span>{renderTextileInlineMeta(item)}</div>,
                                            },
                                            {
                                                id: 'qty',
                                                header: 'الكمية',
                                                cell: (item: any) => <span className="font-numeric font-bold">{item.quantity}</span>,
                                                tdClassName: 'text-center',
                                            },
                                            {
                                                id: 'total',
                                                header: 'الإجمالي',
                                                cell: (item: any) => <span className="font-numeric font-bold text-emerald-700">{formatNumber(lineTotalTransaction(item, invoice))} {currency}</span>,
                                                tdClassName: 'text-left',
                                            },
                                        ]}
                                        mobileCardRender={(item: any) => (
                                            <div className="space-y-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="font-bold text-gray-900">{item.fabricName || item.itemName}</div>
                                                        <div className="mt-1 text-xs text-gray-500">{item.unitName || '-'}</div>
                                                    </div>
                                                    <div className="rounded-xl bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-700">
                                                        {formatNumber(lineTotalTransaction(item, invoice))} {currency}
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                    <div className="rounded-xl bg-gray-50 p-3">
                                                        <div className="text-[11px] text-gray-500">الكمية</div>
                                                        <div className="mt-1 font-numeric font-black text-gray-800">{item.quantity}</div>
                                                    </div>
                                                    <div className="rounded-xl bg-blue-50 p-3">
                                                        <div className="text-[11px] text-blue-700">سعر الوحدة</div>
                                                        <div className="mt-1 font-numeric font-black text-blue-700">{formatNumber(lineUnitTransaction(item, invoice))} {currency}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        desktopWrapperClassName="hidden"
                                        mobileContainerClassName="space-y-3"
                                        mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                                    />
                                </div>
                            </div>
                        )}

                        <div className={`mx-auto bg-white shadow-lg print:shadow-none print:m-0 ${isThermal ? 'w-full max-w-[80mm] p-3 text-[11px]' : 'w-full max-w-[210mm] min-h-[297mm] p-10 text-sm'}`} id="invoice-print-area">
                            <div className={`flex ${isThermal ? 'flex-col items-center text-center gap-2' : 'justify-between items-start'} border-b-2 border-gray-800 pb-4 mb-4`}>
                                {activeProfile.showLogo && activeCompany.logo && (
                                    <img src={activeCompany.logo} alt="Logo" className="h-14 w-14 object-contain mb-2" />
                                )}
                                <div className={isThermal ? 'text-center w-full' : 'text-right'}>
                                    <h1 className="font-bold text-xl">{activeProfile.headerTitle || activeCompany.name}</h1>
                                    {activeProfile.headerSubtitle && <div className="text-gray-600 text-sm mt-1">{activeProfile.headerSubtitle}</div>}
                                    {activeProfile.showPhone && <div className="text-gray-500 mt-1 dir-ltr font-numeric">{activeCompany.phone1}</div>}
                                    {activeProfile.showAddress && <div className="text-gray-400 text-[10px] mt-1">{activeCompany.address}</div>}
                                </div>
                                <div className={isThermal ? 'text-center w-full' : 'text-left'}>
                                    <div className="font-bold text-lg">{invoiceTypeLabel}</div>
                                </div>
                            </div>

                            <div className={`grid ${isThermal ? 'grid-cols-1 gap-1' : 'grid-cols-2 gap-4'} text-xs mb-4`}>
                                <div className="space-y-1">
                                    <div><span className="font-bold">رقم الفاتورة:</span> <span className="font-numeric">{invoice.invoiceNumber}</span></div>
                                    <div><span className="font-bold">التاريخ:</span> <span className="font-numeric">{formatDate(invoice.date)}</span></div>
                                    {invoice.targetWarehouseName && (
                                        <div><span className="font-bold">المستودع:</span> {invoice.targetWarehouseName}</div>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <div><span className="font-bold">العميل:</span> {invoice.clientName || '-'}</div>
                                    <div><span className="font-bold">نوع الدفع:</span> {paymentLabel}</div>
                                    {currency !== BASE_CURRENCY && (
                                        <div><span className="font-bold">العملة:</span> {currency} <span className="text-gray-500 font-numeric">(1 {BASE_CURRENCY} = {Number(invoice.exchangeRate || 1).toLocaleString()} {currencySymbol(currency)})</span></div>
                                    )}
                                    {invoice.notes && <div><span className="font-bold">ملاحظات:</span> {invoice.notes}</div>}
                                </div>
                            </div>

                            <table className="w-full text-right border-collapse">
                                <thead>
                                    <tr className="bg-gray-100 border-y border-gray-300">
                                        {isThermal ? (
                                            <>
                                                <th className="py-2 px-1 text-right">الصنف</th>
                                                <th className="py-2 px-1 text-center">الكمية</th>
                                                <th className="py-2 px-1 text-left">الإجمالي</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="py-2 px-1 text-right">الصنف</th>
                                                <th className="py-2 px-1 text-center">الوحدة</th>
                                                <th className="py-2 px-1 text-center">الكمية</th>
                                                <th className="py-2 px-1 text-left">سعر الوحدة</th>
                                                <th className="py-2 px-1 text-left">الإجمالي</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {safeItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={isThermal ? 3 : 5} className="py-4 text-center text-gray-400">لا توجد مواد</td>
                                        </tr>
                                    ) : (
                                        safeItems.map((item, idx) => (
                                            <tr key={idx}>
                                                {isThermal ? (
                                                    <>
                                                        <td className="py-2 px-1 font-bold">
                                                            {item.fabricName || item.itemName}
                                                            {renderTextileInlineMeta(item)}
                                                            <div className="text-[10px] text-gray-500 font-normal">{item.unitName} - {formatNumber(lineUnitTransaction(item, invoice))} {currency}</div>
                                                        </td>
                                                        <td className="py-2 px-1 text-center font-numeric font-bold">{item.quantity}</td>
                                                        <td className="py-2 px-1 text-left font-numeric font-bold">{formatNumber(lineTotalTransaction(item, invoice))} {currency}</td>
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="py-2 px-1 font-bold">{item.fabricName || item.itemName}{renderTextileInlineMeta(item)}</td>
                                                        <td className="py-2 px-1 text-center">{item.unitName || '-'}</td>
                                                        <td className="py-2 px-1 text-center font-numeric font-bold">{item.quantity}</td>
                                                        <td className="py-2 px-1 text-left font-numeric">{formatNumber(lineUnitTransaction(item, invoice))} {currency}</td>
                                                        <td className="py-2 px-1 text-left font-numeric font-bold">{formatNumber(lineTotalTransaction(item, invoice))} {currency}</td>
                                                    </>
                                                )}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>

                            <div className={`mt-4 ${isThermal ? '' : 'flex justify-end'}`}>
                                <table className={`${isThermal ? 'w-full' : 'w-1/2'} text-sm border-collapse`}>
                                    <tbody>
                                        {Number(invoiceAmountTransaction(invoice, 'discount') || 0) > 0 && (
                                            <tr className="border-t">
                                                <td className="py-1 text-gray-600 font-bold">الحسم</td>
                                                <td className="py-1 text-left font-numeric">-{formatNumber(Number(invoiceAmountTransaction(invoice, 'discount') || 0))} {currency}</td>
                                            </tr>
                                        )}
                                        <tr className={Number(invoiceAmountTransaction(invoice, 'discount') || 0) > 0 ? '' : 'border-t'}>
                                            <td className="py-2 font-bold">{Number(invoiceAmountTransaction(invoice, 'discount') || 0) > 0 ? 'الإجمالي بعد الحسم' : 'الإجمالي'}</td>
                                            <td className="py-2 text-left font-numeric font-bold">{formatNumber(invoiceAmountTransaction(invoice, 'total'))} {currency}</td>
                                        </tr>
                                        {invoiceAmountTransaction(invoice, 'paid') > 0 && (
                                            <tr>
                                                <td className="py-1 text-gray-600 font-bold">المدفوع</td>
                                                <td className="py-1 text-left font-numeric">{formatNumber(invoiceAmountTransaction(invoice, 'paid'))} {currency}</td>
                                            </tr>
                                        )}
                                        {invoiceAmountTransaction(invoice, 'remaining') > 0 && (
                                            <tr>
                                                <td className="py-1 text-gray-600 font-bold">المتبقي</td>
                                                <td className="py-1 text-left font-numeric">{formatNumber(invoiceAmountTransaction(invoice, 'remaining'))} {currency}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-6 pt-4 text-center border-t border-dashed border-gray-300">
                                <div className="font-bold text-gray-800">{activeProfile.footerText || 'شكراً لتعاملكم معنا'}</div>
                                <div className="text-[10px] text-gray-400 font-numeric mt-1">طبع بواسطة نسيج ERP - {new Date().toLocaleString('ar-EG')}</div>
                            </div>
                        </div>
                    </div>

                    {isMobile && (
                        <div className="border-t border-yellow-100 bg-yellow-50 p-4 text-center text-[10px] font-bold text-yellow-800">
                            ملاحظة: عند الضغط على مشاركة، يمكنك اختيار تطبيق "RawBT" أو "Bluetooth Print" لإرسال الفاتورة مباشرة لطابعة البلوتوث.
                        </div>
                    )}
                </div>

                <style dangerouslySetInnerHTML={{ __html: `
                    @media print {
                        @page {
                            size: ${isThermal ? '80mm auto' : 'A4'};
                            margin: ${isThermal ? '0' : '10mm'};
                        }
                        body { margin: 0; }
                        body * { visibility: hidden; }
                        #invoice-print-area, #invoice-print-area * { visibility: visible; }
                        #invoice-print-area {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: ${isThermal ? '80mm' : 'auto'};
                            margin: 0;
                            padding: 0;
                        }
                    }
                `}} />
            </AdaptiveModal>

            <PrinterPicker
                open={printerPickerOpen}
                onClose={handlePrinterClose}
                onSelect={handlePrinterSelect}
            />

            <WindowsPrinterPicker
                open={windowsPrinterPickerOpen}
                onClose={handleWindowsPrinterClose}
                onSelect={handleWindowsPrinterSelect}
                defaultPaperSize={isThermal ? '80mm' : 'A4'}
            />

            <ThermalPrintPreviewModal
                open={thermalPreviewOpen}
                onClose={() => setThermalPreviewOpen(false)}
                receiptData={buildReceiptData()}
                onPrint={handlePreviewPrint}
                paperSize={isThermal ? '80mm' : 'A4'}
                title={`فاتورة ${invoice.invoiceNumber}`}
            />
        </>
    );
};

// Updated inventory type to InventoryItem[]
export const InvoiceInquiryModal: React.FC<{ isOpen: boolean; onClose: () => void; inventory: InventoryItem[]; onSelect: (id: string, name?: string) => void }> = ({ isOpen, onClose, inventory, onSelect }) => {
    const [inquirySearch, setInquirySearch] = useState('');
    const isAndroid = isAndroidNative();
    if (!isOpen) return null;
    const query = inquirySearch.trim();
    const normalizedQuery = query.toLowerCase();
    const filteredInventory = inventory.filter((item) => {
        if (item.inactive || item.merged) return false;
        const name = String(item.name || '').toLowerCase();
        const code = String(item.code || '').toLowerCase();
        return !normalizedQuery || name.includes(normalizedQuery) || code.includes(normalizedQuery);
    });
    return (
        <AdaptiveModal open={isOpen} onClose={onClose} size="lg" zIndex={100} panelClassName="flex h-full max-h-[90vh] flex-col">
            <div className="flex h-full flex-col overflow-hidden bg-white">
                <div className="p-6 bg-teal-600 text-white flex justify-between items-center">
                  <h3 className="text-xl font-bold flex items-center gap-2"><ScanBarcode size={24}/> استعلام عن منتج</h3>
                  <button onClick={onClose} className="text-white/80 hover:text-white bg-teal-700 p-2 rounded-full"><X size={20}/></button>
                </div>
                <div className="p-6 border-b bg-gray-50">
                    <div className="relative">
                        <input autoFocus type="text" placeholder="ابحث عن صنف أو عن طريق الباركود..." className={`w-full p-4 text-lg border-2 border-teal-200 rounded-xl outline-none ${isAndroid ? 'pl-12' : ''}`} value={inquirySearch} onChange={e => setInquirySearch(e.target.value)} />
                        {isAndroid && (
                            <button
                                onClick={async () => {
                                    const code = await scanBarcodeOnce();
                                    if (code) setInquirySearch(code);
                                }}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-600 hover:text-teal-800 transition"
                                title="مسح باركود"
                                type="button"
                            >
                                <ScanBarcode size={20} />
                            </button>
                        )}
                    </div>
</div>
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                        <div>عدد النتائج: <span className="font-bold text-gray-800">{filteredInventory.length}</span></div>
                        {query ? <div>نتائج البحث عن: <span className="font-bold text-gray-800">{query}</span></div> : null}
                    </div>
                    {filteredInventory.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-gray-500">
                            لا توجد نتائج مطابقة.
                        </div>
                    ) : (
                        <AdaptiveTable
                            rows={filteredInventory}
                            keyExtractor={(item) => item.id}
                            columns={[
                                {
                                    id: 'name',
                                    header: 'الصنف',
                                    cell: (item: InventoryItem) => <span className="font-bold">{item.name}</span>,
                                },
                                {
                                    id: 'code',
                                    header: 'الباركود',
                                    cell: (item: InventoryItem) => <span className="font-numeric">{item.code || '-'}</span>,
                                },
                                {
                                    id: 'price',
                                    header: 'السعر',
                                    cell: (item: InventoryItem) => {
                                        const price = (item as any).salePrice ?? (item as any).salePriceBase ?? 0;
                                        return <span className="font-numeric font-bold text-teal-700">{formatNumber(price)} {currencySymbol((item as any).priceCurrency)}</span>;
                                    },
                                    tdClassName: 'text-left',
                                },
                            ]}
                            onRowClick={(item) => { onSelect(item.id, item.name); onClose(); }}
                            mobileCardRender={(item: InventoryItem) => {
                                const price = (item as any).salePrice ?? (item as any).salePriceBase ?? 0;
                                return (
                                    <div className="space-y-2">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-bold text-gray-900">{item.name}</div>
                                                <div className="mt-1 text-xs text-gray-500 font-numeric">{item.code || '-'}</div>
                                            </div>
                                            <div className="rounded-xl bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-700">
                                                {formatNumber(price)} {currencySymbol((item as any).priceCurrency)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }}
                            desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-200 bg-white"
                            mobileContainerClassName="space-y-3"
                            mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                        />
                    )}
                </div>
            </div>
        </AdaptiveModal>
    );
};

export const InvoiceViewModal: React.FC<{
  invoice: Invoice | null;
  onClose: () => void;
  onEdit: (inv: Invoice) => void;
  onReturn: (inv: Invoice, returnType?: 'sale' | 'purchase') => void;
  onExchange: (inv: Invoice) => void;
  onPrint: (inv: Invoice) => void;
  onDelete: (inv: Invoice) => void;
  canCreatePurchase: boolean;
  /** POS thermal reprint (customer / kitchen / both) — optional */
  onPosThermalReprint?: (inv: Invoice, mode: 'customer' | 'kitchen' | 'both') => void | Promise<void>;
  posThermalReprintEnabled?: boolean;
}> = ({ invoice, onClose, onEdit, onReturn, onExchange, onPrint, onDelete, canCreatePurchase, onPosThermalReprint, posThermalReprintEnabled }) => {
    const layout = useResponsiveLayout();
    const safeInvoice = invoice;
    if (!safeInvoice) return null;
    const safeItems = normalizeInvoiceItems(safeInvoice.items);
    const currency = invoiceCurrencyCode(safeInvoice);
    const paymentLabel = safeInvoice.paymentType === 'cash' ? 'نقدي' : 'آجل';
    return (
        <AdaptiveModal open={!!safeInvoice} onClose={onClose} size="xl" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
           <div className="flex h-full flex-col overflow-hidden bg-white">
              <div className="flex items-center justify-between border-b bg-gray-50 p-4 md:p-6">
                 <h3 className="text-lg font-bold text-gray-800 md:text-xl">تفاصيل الفاتورة رقم: <span className="font-numeric">{safeInvoice.invoiceNumber}</span></h3>
                 <button onClick={onClose} className="rounded-full p-1 text-gray-500 transition hover:bg-white hover:text-red-600"><X size={24}/></button>
              </div>
              <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${layout.isMobile ? 'pb-24' : ''}`}>
                  <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 rounded-2xl border bg-gray-50 p-3 md:p-4">
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">العميل</div>
                        <div className="mt-1 font-bold text-gray-900">{safeInvoice.clientName || '-'}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">التاريخ</div>
                        <div className="mt-1 font-numeric font-bold text-gray-900">{formatDate(safeInvoice.date)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">النوع</div>
                        <div className="mt-1 font-bold text-gray-900">{safeInvoice.type === 'sale' ? 'مبيع' : safeInvoice.type === 'purchase' ? 'شراء' : safeInvoice.type === 'return' ? (safeInvoice.returnType === 'purchase' ? 'مرتجع مشتريات' : 'مرتجع مبيعات') : safeInvoice.type === 'exchange' ? (safeInvoice.returnType === 'purchase' ? 'تبديل مشتريات' : 'تبديل مبيعات') : 'أخرى'}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">الإجمالي الكلي</div>
                        <div className="mt-1 font-numeric text-xl font-black text-primary">{formatNumber(invoiceAmountTransaction(safeInvoice, 'total'))} {currency}</div>
                        {currency !== BASE_CURRENCY && <div className="mt-1 text-[10px] font-numeric text-gray-500">{formatNumber(invoiceAmountBase(safeInvoice, 'total'))} {BASE_CURRENCY}</div>}
                      </div>
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">نوع الدفع</div>
                        <div className="mt-1 font-bold text-gray-900">{paymentLabel}</div>
                        {currency !== BASE_CURRENCY && (
                          <div className="mt-1 text-[10px] font-numeric text-gray-500">
                            1 {BASE_CURRENCY} = {Number(safeInvoice.exchangeRate || 1).toLocaleString()} {currencySymbol(currency)}
                          </div>
                        )}
                      </div>
                      {safeInvoice.targetWarehouseName && (
                        <div className="rounded-xl bg-white p-3 shadow-sm">
                          <div className="text-xs font-bold text-gray-500">المستودع</div>
                          <div className="mt-1 font-bold text-gray-900">{safeInvoice.targetWarehouseName}</div>
                        </div>
                      )}
                      {Number(invoiceAmountTransaction(safeInvoice, 'discount') || 0) > 0 && (
                        <div className="rounded-xl bg-red-50 p-3 shadow-sm sm:col-span-2 xl:col-span-1">
                          <div className="text-xs font-bold text-red-500">الحسم</div>
                          <div className="mt-1 font-numeric font-bold text-red-600">-{formatNumber(Number(invoiceAmountTransaction(safeInvoice, 'discount') || 0))} {currency}</div>
                        </div>
                      )}
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">المدفوع</div>
                        <div className="mt-1 font-numeric font-bold text-gray-900">{formatNumber(invoiceAmountTransaction(safeInvoice, 'paid'))} {currency}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="text-xs font-bold text-gray-500">المتبقي</div>
                        <div className="mt-1 font-numeric font-bold text-gray-900">{formatNumber(invoiceAmountTransaction(safeInvoice, 'remaining'))} {currency}</div>
                      </div>
                      {safeInvoice.notes && (
                        <div className="rounded-xl bg-white p-3 shadow-sm sm:col-span-2 xl:col-span-2">
                          <div className="text-xs font-bold text-gray-500">ملاحظات</div>
                          <div className="mt-1 text-sm font-semibold text-gray-800">{safeInvoice.notes}</div>
                        </div>
                      )}
                  </div>
                  <AdaptiveTable
                    rows={safeItems}
                    keyExtractor={(item, index) => `${item.itemId || item.fabricId || 'item'}-${index}`}
                    columns={[
                      {
                        id: 'item',
                        header: 'المادة',
                        cell: (item: any) => <div><span className="font-bold">{item.fabricName || item.itemName}</span>{renderTextileInlineMeta(item)}</div>,
                      },
                      {
                        id: 'unit',
                        header: 'الوحدة',
                        cell: (item: any) => <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold">{item.unitName || '-'}</span>,
                        tdClassName: 'text-center',
                      },
                      {
                        id: 'qty',
                        header: 'الكمية',
                        cell: (item: any) => <span className="font-numeric font-bold">{item.quantity}</span>,
                        tdClassName: 'text-center',
                      },
                      {
                        id: 'price',
                        header: 'السعر',
                        cell: (item: any) => <span className="font-numeric">{formatNumber(lineUnitTransaction(item, safeInvoice))} {currency}</span>,
                        tdClassName: 'text-center',
                      },
                      {
                        id: 'total',
                        header: 'الإجمالي',
                        cell: (item: any) => <span className="font-numeric font-bold">{formatNumber(lineTotalTransaction(item, safeInvoice))} {currency}</span>,
                        tdClassName: 'text-left',
                      },
                    ]}
                    mobileCardRender={(item: any) => (
                      <div className="space-y-3">
                        <div>
                          <div className="font-bold text-gray-900">{item.fabricName || item.itemName}</div>
                          <div className="mt-1 text-xs text-gray-500">{item.unitName || '-'}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="rounded-xl bg-gray-50 p-3">
                            <div className="text-[11px] text-gray-500">الكمية</div>
                            <div className="mt-1 font-numeric font-black text-gray-800">{item.quantity}</div>
                          </div>
                          <div className="rounded-xl bg-blue-50 p-3">
                            <div className="text-[11px] text-blue-700">السعر</div>
                            <div className="mt-1 font-numeric font-black text-blue-700">{formatNumber(lineUnitTransaction(item, safeInvoice))} {currency}</div>
                          </div>
                          <div className="rounded-xl bg-emerald-50 p-3">
                            <div className="text-[11px] text-emerald-700">الإجمالي</div>
                            <div className="mt-1 font-numeric font-black text-emerald-700">{formatNumber(lineTotalTransaction(item, safeInvoice))} {currency}</div>
                          </div>
                        </div>
                      </div>
                    )}
                    desktopWrapperClassName="overflow-hidden rounded-2xl border border-gray-200"
                    mobileContainerClassName="space-y-4"
                    mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                  />
              </div>
              <div className={`border-t bg-gray-50 p-4 ${layout.isMobile ? 'space-y-2 sticky bottom-0 z-10' : 'flex flex-wrap justify-end gap-2'}`}>
                  {((safeInvoice.type === 'purchase' && canCreatePurchase) || safeInvoice.type !== 'purchase') && (
                       <button onClick={() => { onEdit(safeInvoice); onClose(); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-bold text-white md:w-auto"><Edit size={16}/> تعديل</button>
                  )}
                  {safeInvoice.type === 'sale' && (
                       <button onClick={() => { onReturn(safeInvoice, 'sale'); onClose(); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 font-bold text-white md:w-auto"><CornerUpLeft size={16}/> مرتجع مبيعات</button>
                  )}
                  {safeInvoice.type === 'purchase' && canCreatePurchase && (
                       <button onClick={() => { onReturn(safeInvoice, 'purchase'); onClose(); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-bold text-white md:w-auto"><CornerUpLeft size={16}/> مرتجع مشتريات</button>
                  )}
                  {(safeInvoice.type === 'sale' || (safeInvoice.type === 'purchase' && canCreatePurchase)) && (
                       <button onClick={() => { onExchange(safeInvoice); onClose(); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white md:w-auto"><ArrowRightLeft size={16}/> تبديل</button>
                  )}
                  <button onClick={() => { onPrint(safeInvoice); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-800 px-4 py-3 font-bold text-white md:w-auto"><Printer size={16}/> طباعة</button>
                  {safeInvoice.type === 'sale' && posThermalReprintEnabled && onPosThermalReprint && (
                    <>
                      <button
                        type="button"
                        onClick={() => { void onPosThermalReprint(safeInvoice, 'customer'); }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 font-bold text-white md:w-auto"
                      >
                        <Printer size={16}/> إعادة إيصال زبون (حراري)
                      </button>
                      <button
                        type="button"
                        onClick={() => { void onPosThermalReprint(safeInvoice, 'kitchen'); }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white md:w-auto"
                      >
                        <UtensilsCrossed size={16}/> إعادة مطبخ
                      </button>
                      <button
                        type="button"
                        onClick={() => { void onPosThermalReprint(safeInvoice, 'both'); }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 font-bold text-white md:w-auto"
                      >
                        <Printer size={16}/> إعادة زبون + مطبخ
                      </button>
                    </>
                  )}
                  {safeInvoice.type === 'purchase' && (
                       <button onClick={() => { 
                         const items = normalizeInvoiceItems(safeInvoice.items);
                         const labelData = items.map((li: any) => ({
                           itemName: (li.itemName || li.fabricName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
                           barcode: String(li.barcode || '').trim(),
                           unitName: li.unitName || 'قطعة',
                           unitPrice: Number(li.unitPrice || 0),
                           code: li.itemCode || '',
                           qty: Number(li.quantity || 1),
                         }));
                         const w = window.open('', '_blank', 'width=400,height=600');
                         if (!w) return;
                         const labelsHtml = labelData.flatMap((l: any) => Array.from({ length: l.qty }, () => {
                           const barcodePart = l.barcode
                             ? `<svg class="barcode-svg" data-barcode="${l.barcode.replace(/"/g, '&quot;')}" width="180" height="50"></svg>`
                             : '<div class="barcode-placeholder">—</div>';
                           return `<div class="label"><div class="name">${l.itemName}</div><div class="barcode-wrap">${barcodePart}</div><div class="price">${l.unitPrice} $</div><div class="meta">${l.unitName} · ${l.code}</div></div>`;
                         })).join('');
                         const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>لصاقات الباركود</title><style>
                           body{font-family:sans-serif;padding:8px}
                           .label{border:1px solid #ccc;padding:8px;margin:6px 0;text-align:center;page-break-inside:avoid}
                           .name{font-weight:bold;font-size:14px;margin-bottom:4px}
                           .barcode-wrap{margin:6px 0;min-height:40px}
                           .barcode-svg{display:block;margin:0 auto;max-width:100%}
                           .barcode-placeholder{font-family:monospace;font-size:18px;color:#999}
                           .price{font-size:16px;font-weight:bold;color:#222}
                           .meta{font-size:11px;color:#666}
                           @media print{body{padding:0}.label{border:none;border-bottom:1px dashed #ccc}}
                         </style></head><body>${labelsHtml}<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script><script>
                           document.querySelectorAll('.barcode-svg[data-barcode]').forEach(function(el){ var v=el.getAttribute('data-barcode'); if(v) try{ JsBarcode(el, v, {format:'CODE128', width:1.5, height:36, displayValue:true}); }catch(e){} });
                           setTimeout(function(){ window.print(); }, 400);
                         <\/script></body></html>`;
                         w.document.write(html); w.document.close();
                       }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 font-bold text-white md:w-auto"><ScanBarcode size={16}/> طباعة لصاقات</button>
                  )}
                  <button onClick={() => { onDelete(safeInvoice); onClose(); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 font-bold text-white md:w-auto"><Trash2 size={16}/> حذف</button>
                  <button onClick={onClose} className="w-full rounded-xl bg-gray-200 px-4 py-3 font-bold text-gray-700 md:w-auto">إغلاق</button>
              </div>
           </div>
        </AdaptiveModal>
    );
};

// Updated inventory type to InventoryItem[]
export const InvoiceEditModal: React.FC<{ invoice: Invoice | null; onClose: () => void; clients: Client[]; inventory: InventoryItem[]; refreshData: () => Promise<void>; setStatusMsg: (msg: any) => void; }> = ({ invoice, onClose, clients, inventory, refreshData, setStatusMsg }) => {
    const layout = useResponsiveLayout();
    const safeItems = invoice ? normalizeInvoiceItems(invoice.items) : [];
    const normalizedItems = safeItems.map((item: any) => ({
        ...item,
        total: Number(item.total ?? (Number(item.quantity || 0) * Number(item.unitPrice || item.priceAtSale || 0)))
    }));
    const currency = invoice ? invoiceCurrencyCode(invoice) : BASE_CURRENCY;
    const exchangeRate = invoice ? invoiceExchangeRate(invoice) : 1;
    const toBase = (value: number) => currency === BASE_CURRENCY ? value : (value / (exchangeRate || 1));
    const [localCart, setLocalCart] = useState<InvoiceItem[]>(normalizedItems);
    const [localDate, setLocalDate] = useState(invoice ? invoice.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    const [localClient, setLocalClient] = useState(invoice ? invoice.clientId : '');
    const [localPaid, setLocalPaid] = useState(String(invoice ? (invoiceAmountTransaction(invoice, 'paid') || '0') : '0'));
    const [localDiscount, setLocalDiscount] = useState(String(invoice ? (invoiceAmountTransaction(invoice, 'discount') || '0') : '0'));
    const [isUpdating, setIsUpdating] = useState(false);
    const [localEntry, setLocalEntry] = useState({ itemId: '', itemName: '', unitName: 'وحدة', rolls: '', meters: '', yards: '', price: '', total: '' });
    useEffect(() => {
        if (!invoice) return;
        const nextItems = normalizeInvoiceItems(invoice.items).map((item: any) => ({
            ...item,
            total: Number(item.total ?? (Number(item.quantity || 0) * Number(item.unitPrice || item.priceAtSale || 0)))
        }));
        setLocalCart(nextItems);
        setLocalDate(invoice.date.split('T')[0]);
        setLocalClient(invoice.clientId);
        setLocalPaid(String(invoiceAmountTransaction(invoice, 'paid') || '0'));
        setLocalDiscount(String(invoiceAmountTransaction(invoice, 'discount') || '0'));
    }, [invoice?.id]);

    const handleLocalAdd = () => {
        if (!localEntry.itemName) return;
        const newItem: InvoiceItem = {
            itemId: localEntry.itemId || `NEW-${Date.now()}`,
            itemName: localEntry.itemName,
            unitName: localEntry.unitName,
            quantity: parseFloat(localEntry.meters) || parseFloat(localEntry.rolls) || 0,
            unitPrice: parseFloat(localEntry.price) || 0,
            fabricId: localEntry.itemId || `NEW-${Date.now()}`,
            fabricName: localEntry.itemName,
            rollsSold: parseFloat(localEntry.rolls)||0,
            metersSold: parseFloat(localEntry.meters)||0,
            yardsSold: parseFloat(localEntry.yards)||0,
            priceAtSale: parseFloat(localEntry.price)||0,
            total: parseFloat(localEntry.total)||0,
        };
        setLocalCart([...localCart, newItem]);
        setLocalEntry({ itemId: '', itemName: '', unitName: 'وحدة', rolls: '', meters: '', yards: '', price: '', total: '' });
    };

    const handleSaveUpdate = async () => {
        if (!invoice) return;
        if (!localClient || localCart.length === 0) return;
        setIsUpdating(true);
        const rawTotalTransaction = localCart.reduce((s, i) => s + Number(i.total || 0), 0);
        const discountTransaction = Number(localDiscount || 0);
        const totalTransaction = Math.max(0, rawTotalTransaction - discountTransaction);
        const paidInputTransaction = parseFloat(localPaid) || 0;
        const paidTransaction = Math.max(0, Math.min(paidInputTransaction, totalTransaction));
        const remainingTransaction = Math.max(0, totalTransaction - paidTransaction);
        const totalBase = toBase(totalTransaction);
        const discountBase = toBase(discountTransaction);
        const paidBase = toBase(paidTransaction);
        const remainingBase = Math.max(0, totalBase - paidBase);
        const normalizedItemsForPayload = localCart.map((item: any) => {
            const quantity = Number(item?.quantity ?? item?.metersSold ?? 0);
            const unitPriceTransaction = Number((item?.unitPriceTransaction ?? item?.priceAtSale ?? item?.unitPrice) || 0);
            const lineTotalTransaction = Number((item?.lineTotalTransaction ?? item?.total) || (unitPriceTransaction * quantity));
            return {
                ...item,
                quantity,
                baseQuantity: Number(item?.baseQuantity ?? quantity),
                unitPrice: unitPriceTransaction,
                unitPriceTransaction,
                unitPriceBase: toBase(unitPriceTransaction),
                total: lineTotalTransaction,
                lineTotalTransaction,
                lineTotalBase: toBase(lineTotalTransaction),
                currency,
                exchangeRate,
            };
        });
        
        const payload = {
            ...invoice,
            clientId: localClient,
            clientName: clients.find(c=>c.id===localClient)?.name || invoice.clientName,
            date: localDate,
            currency,
            exchangeRate,
            items: normalizedItemsForPayload,
            totalAmount: totalBase,
            totalAmountBase: totalBase,
            totalAmountTransaction: totalTransaction,
            originalAmount: totalTransaction,
            discount: discountBase || 0,
            discountBase: discountBase || 0,
            discountTransaction: discountTransaction || 0,
            paidAmount: paidBase,
            paidAmountBase: paidBase,
            paidAmountTransaction: paidTransaction,
            paidAmountOriginal: paidTransaction,
            remainingAmount: remainingBase,
            remainingAmountBase: remainingBase,
            remainingAmountTransaction: remainingTransaction,
        };

        try {
            // Corrective edit with audit trail
            (payload as any).correctionAudit = {
              editedAt: new Date().toISOString(),
              originalItems: JSON.stringify(normalizedItems),
              reason: 'corrective_edit',
            };
            await apiRequest(`invoices/${invoice.id}`, { 
                method: 'PUT', 
                body: JSON.stringify(payload) 
            });
            await refreshData();
            onClose();
            setStatusMsg({ type: 'success', text: 'تم تعديل الفاتورة بنجاح (تصحيحية)' });
            setTimeout(() => setStatusMsg(null), 3000);
        } catch(e) {
            const err = e as any;
            const code = err?.code;
            const friendlyBlocked =
              'لا يمكن تعديل فاتورة تم ترحيلها أو ربطها بحركات محاسبية/مخزنية. استخدم الإلغاء أو المعالجة المعتمدة.';
            const message =
              code === 'INVOICE_EDIT_BLOCKED' || code === 'POSTED_INVOICE_DIRECT_EDIT_BLOCKED'
                ? friendlyBlocked
                : err?.message || 'فشل التعديل';
            setStatusMsg({ type: 'error', text: message });
            setTimeout(() => setStatusMsg(null), 4000);
        } finally {
            setIsUpdating(false);
        }
    };

    if (!invoice) return null;

    return (
        <AdaptiveModal open={!!invoice} onClose={onClose} size="xl" zIndex={100} panelClassName="flex h-full max-h-[92vh] flex-col">
            <div className="flex h-full flex-col overflow-hidden bg-white">
                <div className="shrink-0 flex items-center justify-between bg-orange-600 p-4 text-white">
                    <div>
                        <h3 className="font-bold text-lg flex items-center gap-2"><Edit size={20}/> تعديل فاتورة رقم: <span className="font-numeric">{invoice.invoiceNumber}</span></h3>
                        <div className="mt-1 text-xs text-orange-100">العملة: {currency}</div>
                    </div>
                    <button onClick={onClose} className="rounded-full p-1 transition hover:bg-white/10 hover:text-black"><X size={24}/></button>
                </div>
                
                <div className={`flex-1 overflow-y-auto bg-gray-50 p-4 md:p-6 ${layout.isMobile ? 'pb-24' : ''}`}>
                    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border bg-white p-4 shadow-sm"><label className="mb-1 block text-xs font-bold text-gray-500">العميل</label><select className="w-full rounded-xl border bg-white p-3" value={localClient} onChange={e=>setLocalClient(e.target.value)}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                        <div className="rounded-2xl border bg-white p-4 shadow-sm"><label className="mb-1 block text-xs font-bold text-gray-500">التاريخ</label><input type="date" className="w-full rounded-xl border p-3 font-numeric" value={localDate} onChange={e=>setLocalDate(e.target.value)}/></div>
                        <div className="rounded-2xl border bg-white p-4 shadow-sm"><label className="mb-1 block text-xs font-bold text-gray-500">المدفوع ({currency})</label><input type="number" className="w-full rounded-xl border p-3 font-numeric" value={localPaid} onChange={e=>setLocalPaid(e.target.value)}/></div>
                        <div className="rounded-2xl border bg-white p-4 shadow-sm"><label className="mb-1 block text-xs font-bold text-gray-500">الحسم ({currency})</label><input type="number" className="w-full rounded-xl border p-3 font-numeric" value={localDiscount} onChange={e=>setLocalDiscount(e.target.value)} /></div>
                    </div>

                    <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
                        <div className="mb-3 flex flex-col gap-1">
                            <h4 className="text-xs font-bold text-gray-700">إضافة / تعديل مادة</h4>
                            <p className="text-[11px] text-gray-500">أضف صنفًا جديدًا أو عدّل الكميات قبل حفظ الفاتورة.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_140px_140px_auto] md:items-end">
                            <div className="min-w-0"><Combobox items={inventory.filter(i => !i.inactive && !i.merged).map(i=>({id:i.id, label:i.name}))} selectedId={localEntry.itemId} onSelect={(id,name)=>{
                                const item = inventory.find(i=>i.id===id && !i.inactive && !i.merged) as any;
                                const salePriceBase = Number((item?.salePriceBase ?? item?.salePrice) || 0);
                                const salePriceTransaction = currency === BASE_CURRENCY ? salePriceBase : (salePriceBase * (exchangeRate || 1));
                                setLocalEntry({...localEntry, itemId:id, itemName: item?.name||name||'', unitName: item?.unitName || 'وحدة', price: salePriceTransaction.toString()||''});
                            }} placeholder="بحث عن مادة..." /></div>
                            <input type="number" placeholder="الكمية" className="w-full rounded-xl border p-3 font-numeric" value={localEntry.meters} onChange={e => {
                                const m = parseFloat(e.target.value)||0;
                                const p = parseFloat(localEntry.price)||0;
                                setLocalEntry({...localEntry, meters:e.target.value, total:(m*p).toFixed(2)});
                            }} />
                            <input type="number" placeholder="سعر" className="w-full rounded-xl border p-3 font-numeric" value={localEntry.price} onChange={e => {
                                const m = parseFloat(localEntry.meters)||0;
                                const p = parseFloat(e.target.value)||0;
                                setLocalEntry({...localEntry, price:e.target.value, total:(m*p).toFixed(2)});
                            }} />
                            <button onClick={handleLocalAdd} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 font-bold text-white"><Save size={16}/> إضافة</button>
                        </div>
                    </div>

                    <AdaptiveTable
                        rows={localCart}
                        keyExtractor={(item, idx) => `${item.itemId || item.fabricId || 'item'}-${idx}`}
                        columns={[
                            {
                                id: 'item',
                                header: 'المادة',
                                cell: (item: any) => <div><span className="font-bold">{item.fabricName || item.itemName}</span>{renderTextileInlineMeta(item)}</div>,
                            },
                            {
                                id: 'unit',
                                header: 'الوحدة',
                                cell: (item: any) => <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold">{item.unitName || '-'}</span>,
                                tdClassName: 'text-center',
                            },
                            {
                                id: 'qty',
                                header: 'الكمية',
                                cell: (item: any) => <span className="font-numeric font-bold">{item.metersSold || item.quantity}</span>,
                                tdClassName: 'text-center',
                            },
                            {
                                id: 'price',
                                header: 'السعر',
                                cell: (item: any) => <span className="font-numeric">{formatNumber(lineUnitTransaction(item, invoice))} {currency}</span>,
                                tdClassName: 'text-center',
                            },
                            {
                                id: 'total',
                                header: 'الإجمالي',
                                cell: (item: any) => <span className="font-numeric font-bold text-primary">{formatNumber(lineTotalTransaction(item, invoice))} {currency}</span>,
                                tdClassName: 'text-center',
                            },
                            {
                                id: 'delete',
                                header: '',
                                cell: (_: any, idx) => <button onClick={()=>setLocalCart(localCart.filter((_,i)=>i!==idx))} className="rounded-lg p-1 text-red-500 hover:bg-red-50"><Trash2 size={16}/></button>,
                                tdClassName: 'text-center',
                            },
                        ]}
                        mobileCardRender={(item: any, idx) => (
                            <div className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-bold text-gray-900">{item.fabricName || item.itemName}</div>
                                        <div className="mt-1 text-xs text-gray-500">{item.unitName || '-'}</div>
                                    </div>
                                    <button onClick={()=>setLocalCart(localCart.filter((_,i)=>i!==idx))} className="rounded-lg bg-red-50 p-2 text-red-500 hover:bg-red-100"><Trash2 size={16}/></button>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-sm">
                                    <div className="rounded-xl bg-gray-50 p-3">
                                        <div className="text-[11px] text-gray-500">الكمية</div>
                                        <div className="mt-1 font-numeric font-black text-gray-800">{item.metersSold || item.quantity}</div>
                                    </div>
                                    <div className="rounded-xl bg-blue-50 p-3">
                                        <div className="text-[11px] text-blue-700">السعر</div>
                                        <div className="mt-1 font-numeric font-black text-blue-700">{formatNumber(lineUnitTransaction(item, invoice))} {currency}</div>
                                    </div>
                                    <div className="rounded-xl bg-emerald-50 p-3">
                                        <div className="text-[11px] text-emerald-700">الإجمالي</div>
                                        <div className="mt-1 font-numeric font-black text-emerald-700">{formatNumber(lineTotalTransaction(item, invoice))} {currency}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    desktopWrapperClassName="overflow-hidden rounded-2xl border bg-white shadow"
                    mobileContainerClassName="space-y-4"
                    mobileCardClassName="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                />
            </div>

            <div className={`shrink-0 border-t bg-white p-4 ${layout.isMobile ? 'space-y-3 sticky bottom-0 z-10' : 'flex items-center justify-between'}`}>
                    <div className="rounded-2xl bg-orange-50 p-3 text-center md:text-right">
                        <div className="text-xs font-bold text-orange-600">المجموع الجديد</div>
                        <div className="font-numeric text-2xl font-black text-primary">{formatNumber(Math.max(0, localCart.reduce((s,i)=>s + Number(i.total || 0),0) - (Number(localDiscount || 0))))} {currency}</div>
                    </div>
                    <button onClick={handleSaveUpdate} disabled={isUpdating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-8 py-3 font-bold text-white shadow-lg hover:bg-orange-700 md:w-auto">
                        {isUpdating ? <RefreshCw className="animate-spin"/> : <Save size={20}/>} حفظ التعديلات
                    </button>
                </div>
            </div>
        </AdaptiveModal>
    );
};
