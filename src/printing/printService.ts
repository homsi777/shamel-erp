/**
 * Print Service - Unified printing for POS and Invoices
 * Supports both Windows (browser) and Bluetooth (Cordova) printers
 */

import { 
    openPrintDialog, 
    buildThermalReceipt, 
    type PaperSize,
    type WindowsPrinter 
} from './thermalPrinter';
import { printEscPos } from '../lib/printEngine';

// Receipt data interface
export interface ReceiptData {
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
}

export interface PrintOptions {
    printer?: WindowsPrinter;
    paperSize?: PaperSize;
    showPreview?: boolean;
}

/**
 * Print sale invoice receipt using the appropriate method
 */
export const printSaleInvoice = async (
    data: ReceiptData,
    options: PrintOptions = {}
): Promise<boolean> => {
    const { paperSize = '80mm' } = options;
    
    // Build the receipt HTML content
    const receiptContent = buildThermalReceipt(data, paperSize);
    
    // Open native print dialog
    try {
        const success = await openPrintDialog(
            receiptContent,
            options.printer?.name,
            paperSize
        );
        return success;
    } catch (error) {
        console.error('Print failed:', error);
        return false;
    }
};

/**
 * Print thermal receipt with preview
 */
export const printThermalReceiptWithPreview = async (
    data: ReceiptData,
    paperSize: PaperSize = '80mm'
): Promise<void> => {
    const receiptContent = buildThermalReceipt(data, paperSize);
    const printWindow = window.open('', '_blank');
    
    if (!printWindow) {
        throw new Error('يرجى السماح بنوافذ منبثقة للطباعة');
    }
    
    const dimensions: Record<PaperSize, string> = {
        '58mm': '58mm',
        '80mm': '80mm',
        '85mm': '85mm',
        'A4': '210mm',
        'A5': '148mm'
    };
    
    const width = dimensions[paperSize] || '80mm';
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <title>طباعة فاتورة - ${data.invoiceNo}</title>
            <meta charset="UTF-8">
            <style>
                @page {
                    size: ${width} auto;
                    margin: 0;
                }
                html, body {
                    width: ${width};
                    max-width: ${width};
                    margin: 0 auto;
                    padding: 0;
                    background: #fff;
                }
                body {
                    font-family: Tahoma, Arial, sans-serif;
                    direction: rtl;
                    overflow: hidden;
                }
                .receipt-container {
                    background: white;
                    width: 100%;
                    max-width: ${width};
                    margin: 0 auto;
                    padding: 0;
                    box-shadow: none;
                }
                * {
                    visibility: visible;
                }
                @media print {
                    body {
                        background: white;
                        padding: 0;
                    }
                    .receipt-container {
                        box-shadow: none;
                        padding: 0;
                    }
                }
            </style>
        </head>
        <body>
            <div class="receipt-container">
                ${receiptContent}
            </div>
            <script>
                window.onload = function() {
                    // Auto-print after user confirms
                    setTimeout(function() {
                        if (confirm('هل تريد طباعة الفاتورة؟\\n\\nاضغط OK للطباعة أو Cancel للإلغاء.')) {
                            window.print();
                        }
                        window.close();
                    }, 500);
                };
                
                window.onafterprint = function() {
                    window.close();
                };
            </script>
        </body>
        </html>
    `);
    
    printWindow.document.close();
};

/**
 * Print via Bluetooth (for Cordova/Mobile)
 */
export const printSaleInvoiceBluetooth = async (params: {
    printerIdOrMac: string;
    paper: PaperSize;
    data: ReceiptData;
}): Promise<void> => {
    const fmt = params.paper === '58mm' ? '58mm' : '80mm';
    const r = await printEscPos({
        receiptData: params.data,
        format: fmt,
        copies: 1,
        printer: {
            connectionType: 'bluetooth',
            address: params.printerIdOrMac,
            type: 'thermal',
        },
    });
    if (!r.success) {
        throw new Error(r.error || 'Bluetooth ESC/POS print failed');
    }
};

/**
 * Export invoice as PDF
 */
export const exportInvoicePDF = async (
    elementId: string,
    invoiceNumber: string
): Promise<void> => {
    const element = document.getElementById(elementId);
    if (!element) {
        throw new Error('Invoice element not found');
    }
    
    // Use browser print to PDF
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        throw new Error('يرجى السماح بنوافذ منبثقة');
    }
    
    // Clone the element content
    const clone = element.cloneNode(true) as HTMLElement;
    clone.style.display = 'block';
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>فاتورة - ${invoiceNumber}</title>
            <meta charset="UTF-8">
            <style>
                @page { size: A4; margin: 10mm; }
                body { font-family: Arial, sans-serif; margin: 0; }
                * { visibility: visible; }
            </style>
        </head>
        <body>
            ${clone.innerHTML}
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
    
    printWindow.document.close();
};

/**
 * Use browser's native print (simplest approach)
 */
export const printWithBrowser = async (elementId?: string): Promise<void> => {
    if (elementId) {
        // Print specific element
        const element = document.getElementById(elementId);
        if (!element) {
            throw new Error('Element not found');
        }
        
        // Create a print window
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            throw new Error('يرجى السماح بنوافذ منبثقة');
        }
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>طباعة</title>
                <meta charset="UTF-8">
                <style>
                    @page { size: auto; margin: 10mm; }
                    body { font-family: Arial, sans-serif; margin: 0; }
                    * { visibility: visible; }
                </style>
            </head>
            <body>
                ${element.innerHTML}
                <script>
                    window.onload = function() {
                        window.print();
                        window.close();
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    } else {
        // Print entire page
        window.print();
    }
};

/**
 * Test thermal printer connection (Bluetooth)
 */
export const testThermalPrint = async (
    printerId: string,
    paperSize: PaperSize,
    testText?: string
): Promise<void> => {
    if (typeof (window as any).BluetoothPrinter !== 'undefined') {
        await (window as any).BluetoothPrinter.connect({
            address: printerId,
            timeout: 10000
        });
        
        const text = testText || `
╔══════════════════════════════╗
║     اختبار الطابعة الحرارية      ║
╠══════════════════════════════╣
║   تم الاتصال بنجاح ✓          ║
║   ${new Date().toLocaleString('ar-EG')}  ║
╚══════════════════════════════╝
`;
        
        await (window as any).BluetoothPrinter.printText(text);
        await (window as any).BluetoothPrinter.disconnect();
    } else {
        throw new Error('Bluetooth printer plugin not available');
    }
};

/**
 * Print delivery notice (Bluetooth)
 */
export const printDeliveryNoticeBluetooth = async (params: {
    printerIdOrMac: string;
    paper: PaperSize;
    data: {
        storeName?: string;
        noticeNo?: string;
        dateText?: string;
        warehouseName?: string;
        receiverName?: string;
        items?: Array<{name?: string; qty?: number; unit?: string}>;
        totalQty?: number;
        notes?: string;
    };
}): Promise<void> => {
    if (typeof (window as any).BluetoothPrinter !== 'undefined') {
        await (window as any).BluetoothPrinter.connect({
            address: params.printerIdOrMac,
            timeout: 10000
        });
        
        const content = `
╔══════════════════════════════╗
║         إذن تسليم              ║
╠══════════════════════════════╣
║ رقم الإذن: ${params.data.noticeNo || ''}      ║
║ التاريخ: ${params.data.dateText || ''}         ║
║ المستودع: ${params.data.warehouseName || ''}         ║
║ المستلم: ${params.data.receiverName || ''}          ║
╠══════════════════════════════╣
${(params.data.items || []).map(item => `║ ${item.name || ''} x${item.qty || 0} ${item.unit || ''}`).join('\n')}
╠══════════════════════════════╣
║ الإجمالي: ${params.data.totalQty || 0}         ║
${params.data.notes ? `║ ملاحظة: ${params.data.notes}` : ''}
╚══════════════════════════════╝
`;
        
        await (window as any).BluetoothPrinter.printText(content);
        await (window as any).BluetoothPrinter.disconnect();
    } else {
        throw new Error('Bluetooth printer plugin not available');
    }
};
