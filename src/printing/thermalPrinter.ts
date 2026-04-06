/**
 * Thermal Printer Service - Windows/Web Version
 * Provides direct Windows printer integration using browser's native print dialog
 */

export type PaperSize = '58mm' | '80mm' | '85mm' | 'A4' | 'A5';

export interface BluetoothPrinter {
    id: string;
    name: string;
    address?: string;
}

// ================================
// WINDOWS PRINTER SERVICE
// ================================

export interface WindowsPrinter {
    id: string;
    name: string;
    isDefault: boolean;
}

export interface WindowsPrintJob {
    printerId: string;
    data: any;
    paperSize: PaperSize;
}

/** Inner width ? same as htmlRenderer thermal strip; @page symmetric 2.5mm L+R (centered) */
const THERMAL_CONTENT_WIDTH: Record<'58mm' | '80mm' | '85mm', string> = {
    '58mm': '50mm',
    '80mm': '72mm',
    '85mm': '76mm',
};

const escapeReceiptHtml = (value: unknown): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const normalizeThermalTextileDecomposition = (payload: unknown) => {
    const source = typeof payload === 'string'
        ? (() => {
            try { return JSON.parse(payload); } catch { return []; }
        })()
        : payload;
    return Array.isArray(source) ? source : [];
};

const renderThermalTextileMeta = (item: any): string => {
    const color = String(item?.textileColorName || '').trim();
    const rollCount = Number(item?.textileRollCount || 0);
    const baseUom = String(item?.textileBaseUom || item?.unit || '').trim();
    const decomposition = normalizeThermalTextileDecomposition(item?.textileDecompositionPayload);
    const parts: string[] = [];
    if (color) parts.push(`اللون: ${escapeReceiptHtml(color)}`);
    if (rollCount > 0) parts.push(`الرولات: ${rollCount}`);
    if (decomposition.length > 0) {
        const details = decomposition
            .map((entry: any, index: number) => {
                const seq = Number(entry?.sequence || index + 1);
                const lengthValue = Number(entry?.lengthValue ?? entry?.length ?? 0);
                const unit = String(entry?.unit || baseUom || '').trim();
                if (!(lengthValue > 0)) return '';
                return `${seq}) ${lengthValue.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${unit ? ` ${escapeReceiptHtml(unit)}` : ''}`;
            })
            .filter(Boolean)
            .join(' | ');
        if (details) parts.push(`تفنيد الأطوال: ${details}`);
    }
    return parts.length
        ? `<div style="margin-top:1.2mm;font-size:7.3px;line-height:1.45;color:#475569">${parts.join(' | ')}</div>`
        : '';
};

/**
 * Get list of Windows printers (simulated - browser doesn't have direct access)
 * In a real Electron app, this would use electron API
 * For web, we use a heuristic approach
 */
export const listWindowsPrinters = async (): Promise<WindowsPrinter[]> => {
    // In browser environment, we can't directly list printers
    // This would be replaced with Electron IPC call in desktop app
    // For now, we'll use a mock that returns common Windows printer names
    
    // Check if we're in Electron
    const isElectron = !!(window as any).electronAPI;
    
    if (isElectron) {
        try {
            const printers = await (window as any).electronAPI.listPrinters();
            return printers.map((name: string, index: number) => ({
                id: name,
                name: name,
                isDefault: index === 0
            }));
        } catch (e) {
            console.warn('Failed to list printers from Electron:', e);
        }
    }
    
    // Return mock list - user can type their printer name
    return [
        { id: 'thermal-printer', name: 'طابعة حرارية (Thermal Printer)', isDefault: true },
        { id: 'pos-receipt', name: 'إيصال نقطة البيع (POS Receipt)', isDefault: false },
        { id: 'microsoft-print-to-pdf', name: 'Microsoft Print to PDF', isDefault: false },
        { id: 'fax', name: 'Fax', isDefault: false }
    ];
};

/**
 * Open native print dialog with the invoice content
 * This uses the browser's print functionality which shows all Windows printers
 */
export const openPrintDialog = async (
    content: string, 
    printerName?: string,
    paperSize: PaperSize = '80mm'
): Promise<boolean> => {
    const dimensions: Record<PaperSize, { width: string; minHeight: string }> = {
        '58mm': { width: '58mm', minHeight: '200mm' },
        '80mm': { width: '80mm', minHeight: '200mm' },
        '85mm': { width: '85mm', minHeight: '200mm' },
        'A4': { width: '210mm', minHeight: '297mm' },
        'A5': { width: '148mm', minHeight: '210mm' }
    };
    const dim = dimensions[paperSize] || dimensions['80mm'];
    const isNarrow = paperSize === '58mm' || paperSize === '80mm' || paperSize === '85mm';
    const narrowSize = (paperSize === '58mm' || paperSize === '80mm' || paperSize === '85mm') ? paperSize : '80mm';
    const contentWidth = isNarrow ? THERMAL_CONTENT_WIDTH[narrowSize] : dim.width;
    const fullHtml = `
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <title>\u0625\u064a\u0635\u0627\u0644 \u0628\u064a\u0639</title>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                <style>
                    @charset "UTF-8";
                    @page {
                        size: ${dim.width} auto;
                        margin: ${isNarrow ? '0 2.5mm 0 2.5mm' : '0'};
                    }
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    html, body {
                        width: 100%;
                        background: #fff;
                    }
                    body {
                        font-family: 'Segoe UI', 'Segoe UI Arabic', Tahoma, 'Arial Unicode MS', 'Simplified Arabic', Arial, sans-serif;
                        font-size: ${isNarrow ? '9.5pt' : '11pt'};
                        line-height: 1.15;
                        direction: rtl;
                        /* Use contentWidth (not full page width) so @page margins are the safe zone */
                        width: ${isNarrow ? contentWidth : dim.width};
                        max-width: ${isNarrow ? contentWidth : dim.width};
                        margin: 0 auto;
                        padding: ${isNarrow ? '0' : '8mm'};
                        overflow: visible;
                        -webkit-font-smoothing: antialiased;
                    }
                    .receipt {
                        width: 100%;
                        max-width: ${contentWidth};
                        margin: 0 auto;
                        overflow: visible;
                    }
                    @media print {
                        body {
                            margin: 0;
                            padding: ${isNarrow ? '0' : '5mm'};
                        }
                        @page {
                            size: ${dim.width} auto;
                            margin: ${isNarrow ? '0 2.5mm 0 2.5mm' : '0'};
                        }
                    }
                </style>
            </head>
            <body>
                <div class="receipt">
                    ${content}
                </div>
                <script>
                    window.onload = function() {
                        setTimeout(function() {
                            window.print();
                        }, 250);
                    };
                    window.onafterprint = function() {
                        window.close();
                    };
                </script>
            </body>
            </html>
    `;

    const electron = (window as any).electronAPI;
    if (printerName && electron?.printToPrinter) {
        try {
            const ok = await electron.printToPrinter(printerName, fullHtml, paperSize);
            return !!ok;
        } catch (e) {
            console.warn('printToPrinter failed, falling back to dialog', e);
        }
    }

    return new Promise((resolve) => {
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        if (!printWindow) {
            alert('تعذر فتح نافذة الطباعة الحرارية');
            resolve(false);
            return;
        }
        printWindow.document.write(fullHtml);
        printWindow.document.close();
        const checkClosed = setInterval(() => {
            if (printWindow.closed) {
                clearInterval(checkClosed);
                resolve(true);
            }
        }, 500);
        setTimeout(() => {
            clearInterval(checkClosed);
            resolve(false);
        }, 30000);
    });
};

/**
 * Build thermal receipt HTML content
 */
export const buildThermalReceipt = (data: {
    storeName: string;
    storePhone?: string;
    storeAddress?: string;
    invoiceNo: string;
    dateText: string;
    customerName: string;
    items: Array<{ name: string; qty: number; price: number; unit?: string; textileColorName?: string; textileRollCount?: number; textileBaseUom?: string; textileDecompositionPayload?: unknown }>;
    discount?: number;
    paid?: number;
    currencyLabel: string;
}, paperSize: PaperSize = '80mm'): string => {
    const subtotal = data.items.reduce((sum, item) => sum + (item.qty * item.price), 0);
    const discount = data.discount || 0;
    const total = subtotal - discount;
    const paid = data.paid || total;
    const change = Math.max(0, paid - total);
    const formatNum = (num: number) => num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatQty = (num: number) => {
        const x = Number(num);
        if (!Number.isFinite(x)) return '0';
        if (Math.abs(x - Math.round(x)) < 1e-9) {
            return Math.round(x).toLocaleString('ar-EG', { useGrouping: false, maximumFractionDigits: 0 });
        }
        return x.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 6, useGrouping: false });
    };
    const narrowSize = (paperSize === '58mm' || paperSize === '80mm' || paperSize === '85mm') ? paperSize : '80mm';
    const ticketWidth = THERMAL_CONTENT_WIDTH[narrowSize];
    const is58 = narrowSize === '58mm';
    const itemsHtml = data.items.map((item) => `
        <div class="th-item-row">
            <span class="th-col-name">${escapeReceiptHtml(item.name)}${renderThermalTextileMeta(item)}</span>
            <span class="th-col-num"><bdi>${formatQty(item.qty)}</bdi></span>
            <span class="th-col-num"><bdi>${formatNum(item.price)}</bdi></span>
            <span class="th-col-num th-col-line"><bdi>${formatNum(item.qty * item.price)}</bdi></span>
        </div>
    `).join('');

    return `
        <style>
            :root {
                --ticket-width: ${ticketWidth};
                --font-main: ${is58 ? '9px' : '10px'};
                --font-small: ${is58 ? '7.8px' : '8.6px'};
                --font-title: ${is58 ? '12.5px' : '13.5px'};
                --line-tight: 1.18;
            }
            * {
                box-sizing: border-box;
            }
            html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                background: #fff;
            }
            .receipt {
                width: var(--ticket-width);
                max-width: var(--ticket-width);
                margin: 0 auto;
                padding: 1mm 0.35mm 0.5mm;
                direction: rtl;
                text-align: right;
                unicode-bidi: plaintext;
                color: #000;
                font-family: 'Segoe UI', 'Segoe UI Arabic', Tahoma, 'Arial Unicode MS', sans-serif;
                font-size: var(--font-main);
                line-height: var(--line-tight);
                overflow: visible;
            }
            .th-center { text-align: center; }
            .th-store {
                font-size: var(--font-title);
                font-weight: 700;
                line-height: 1.12;
                margin: 0 0 0.5mm;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            .th-sub {
                font-size: var(--font-small);
                margin-top: 0.15mm;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            .th-title {
                margin-top: 1mm;
                font-size: var(--font-main);
                font-weight: 700;
            }
            .th-sep {
                border-top: 1px dashed #000;
                margin: 0.9mm 0;
            }
            .th-meta-row,
            .th-total-row {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 2mm;
                padding: 0.45mm 0;
            }
            .th-meta-label,
            .th-total-label {
                white-space: nowrap;
                font-weight: 700;
                flex: 0 0 auto;
            }
            .th-meta-value,
            .th-total-value {
                flex: 1;
                text-align: left;
                direction: ltr;
                unicode-bidi: plaintext;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .th-customer {
                direction: rtl;
                text-align: right;
                white-space: normal;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            .th-items {
                margin-top: 0.6mm;
            }
            .th-items-head,
            .th-item-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) ${is58 ? '2.6em' : '2.9em'} ${is58 ? '2.8em' : '3em'} ${is58 ? '3em' : '3.2em'};
                column-gap: 0.8mm;
                align-items: center;
                direction: rtl;
            }
            .th-items-head {
                padding: 0 0 0.6mm;
                border-bottom: 1px solid #000;
                font-size: var(--font-small);
                font-weight: 700;
            }
            .th-items-head span {
                text-align: center;
            }
            .th-items-head .th-col-name {
                text-align: right;
            }
            .th-item-row {
                padding: 0.45mm 0;
                border-bottom: 1px dotted #b7b7b7;
                font-size: var(--font-main);
            }
            .th-col-name {
                text-align: right;
                font-weight: 600;
                line-height: 1.2;
                word-break: break-word;
                overflow-wrap: anywhere;
                min-width: 0;
            }
            .th-col-num {
                text-align: center;
                font-weight: 700;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }
            .th-col-num bdi {
                direction: ltr;
                unicode-bidi: isolate;
            }
            .th-col-line {
                font-weight: 800;
            }
            .th-total-row.th-grand {
                font-size: calc(var(--font-main) + 1px);
                font-weight: 800;
                border-top: 1px solid #000;
                padding-top: 1mm;
                margin-top: 0.7mm;
            }
            .th-footer {
                text-align: center;
                font-size: var(--font-small);
                margin-top: 1.2mm;
                line-height: 1.2;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            @media print {
                html, body {
                    width: var(--ticket-width);
                    max-width: var(--ticket-width);
                }
            }
        </style>
        <div class="receipt">
            <div class="th-center th-store">${escapeReceiptHtml(data.storeName)}</div>
            ${data.storePhone ? `<div class="th-center th-sub">${escapeReceiptHtml(data.storePhone)}</div>` : ''}
            ${data.storeAddress ? `<div class="th-center th-sub">${escapeReceiptHtml(data.storeAddress)}</div>` : ''}
            <div class="th-center th-title">\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a</div>
            <div class="th-sep"></div>
            <div class="th-meta-row"><span class="th-meta-label">\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629</span><span class="th-meta-value"><bdi>${escapeReceiptHtml(data.invoiceNo)}</bdi></span></div>
            <div class="th-meta-row"><span class="th-meta-label">\u0627\u0644\u062a\u0627\u0631\u064a\u062e</span><span class="th-meta-value"><bdi>${escapeReceiptHtml(data.dateText)}</bdi></span></div>
            <div class="th-meta-row"><span class="th-meta-label">\u0627\u0644\u0639\u0645\u064a\u0644</span><span class="th-meta-value th-customer">${escapeReceiptHtml(data.customerName || '\u0639\u0645\u064a\u0644 \u0646\u0642\u062f\u064a')}</span></div>
            <div class="th-sep"></div>
            <div class="th-items">
                <div class="th-items-head">
                    <span class="th-col-name">\u0627\u0644\u0645\u0627\u062f\u0629</span>
                    <span>\u0627\u0644\u0643\u0645\u064a\u0629</span>
                    <span>\u0627\u0644\u0633\u0639\u0631</span>
                    <span>\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</span>
                </div>
                ${itemsHtml}
            </div>
            <div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0645\u062c\u0645\u0648\u0639</span><span class="th-total-value"><bdi>${formatNum(subtotal)} ${escapeReceiptHtml(data.currencyLabel)}</bdi></span></div>
            ${discount > 0 ? `<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u062e\u0635\u0645</span><span class="th-total-value"><bdi>- ${formatNum(discount)} ${escapeReceiptHtml(data.currencyLabel)}</bdi></span></div>` : ''}
            <div class="th-total-row th-grand"><span class="th-total-label">\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</span><span class="th-total-value"><bdi>${formatNum(total)} ${escapeReceiptHtml(data.currencyLabel)}</bdi></span></div>
            ${paid > 0 ? `<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0645\u062f\u0641\u0648\u0639</span><span class="th-total-value"><bdi>${formatNum(paid)} ${escapeReceiptHtml(data.currencyLabel)}</bdi></span></div>` : ''}
            ${change > 0 ? `<div class="th-total-row"><span class="th-total-label">\u0627\u0644\u0628\u0627\u0642\u064a</span><span class="th-total-value"><bdi>${formatNum(change)} ${escapeReceiptHtml(data.currencyLabel)}</bdi></span></div>` : ''}
            <div class="th-sep"></div>
            <div class="th-footer">\u0634\u0643\u0631\u0627\u064b \u0644\u062a\u0639\u0627\u0645\u0644\u0643\u0645 \u0645\u0639\u0646\u0627</div>
        </div>
    `;
};

// ================================
// BLUETOOTH PRINTER SERVICE (Mobile/Cordova)
// ================================

/**
 * Request Bluetooth permissions (Cordova)
 */
export const requestBluetoothPermissions = async (): Promise<void> => {
    // The Cordova thermal plugin only exposes USB permission requests.
    // Bluetooth permissions are expected from Android manifest/runtime.
    return Promise.resolve();
};

/**
 * List Bluetooth printers
 */
export const listBluetoothPrinters = async (): Promise<BluetoothPrinter[]> => {
    if (typeof (window as any).BluetoothPrinter !== 'undefined') {
        try {
            const printers = await (window as any).BluetoothPrinter.list();
            return printers.map((p: any) => ({
                id: p.address || p.id,
                name: p.name || 'طابعة حرارية',
                address: p.address
            }));
        } catch (e) {
            console.warn('Failed to list Bluetooth printers:', e);
            return [];
        }
    }
    return [];
};

/**
 * Print via Bluetooth (Cordova thermal-printer plugin)
 */
export const printFormattedTextBluetooth = async (
    printerIdOrMac: string,
    content: string,
    paperSize: PaperSize = '80mm'
): Promise<void> => {
    if (typeof (window as any).BluetoothPrinter !== 'undefined') {
        await (window as any).BluetoothPrinter.connect({
            address: printerIdOrMac,
            timeout: 10000
        });
        await (window as any).BluetoothPrinter.printText(content);
        await (window as any).BluetoothPrinter.disconnect();
    } else {
        throw new Error('Bluetooth printer not available in browser');
    }
};

