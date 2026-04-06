import { ReportData, ReportFilterState } from './report.types';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { apiRequest } from '../../lib/api';

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            resolve(base64String.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const exportToExcel = async (data: ReportData, reportId: string) => {
    if (!data) return;
    if (String(data?.meta?.status || '') === 'requires_dataset' || String(data?.meta?.completeness || '') === 'requires_dataset') {
        alert('هذا التقرير قيد التجهيز ولا يمكن تصديره حاليًا.');
        return;
    }
    const BOM = "\uFEFF";
    let csvContent = BOM;

    const asCsvCell = (value: unknown) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        const escaped = String(value).replace(/"/g, '""');
        return `"${escaped}"`;
    };

    const totals = data.tableHeaders.map((_, colIdx) => {
        let sum = 0;
        let hasNumeric = false;
        data.tableRows.forEach((row) => {
            const v = Number(row[colIdx]);
            if (Number.isFinite(v)) {
                hasNumeric = true;
                sum += v;
            }
        });
        return hasNumeric ? sum : null;
    });

    csvContent += `${asCsvCell(data.title)}\n`;
    if (data.subtitle) csvContent += `${asCsvCell(data.subtitle)}\n`;
    csvContent += "\n";

    data.summary.forEach((s) => {
        const value = `${s.value ?? ''}${s.suffix ? ` ${s.suffix}` : ''}`;
        csvContent += `${asCsvCell(s.title)},${asCsvCell(value)}\n`;
    });
    csvContent += "\n";
    csvContent += data.tableHeaders.map((h) => asCsvCell(h)).join(",") + "\n";
    data.tableRows.forEach((row) => {
        csvContent += row.map((cell) => asCsvCell(cell)).join(",") + "\n";
    });
    if (totals.some((x) => x !== null)) {
        const totalsRow = totals.map((x, idx) => {
            if (idx === 0) return 'الإجمالي';
            return x === null ? '' : x;
        });
        csvContent += totalsRow.map((cell) => asCsvCell(cell)).join(",") + "\n";
    }

    const safeBase = String(data.title || reportId)
        .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
        .trim()
        .replace(/\s+/g, '_') || reportId;
    const fileName = `${safeBase}_${new Date().getTime()}.csv`;

    if (Capacitor.isNativePlatform()) {
        try {
            const result = await Filesystem.writeFile({
                path: fileName,
                data: btoa(unescape(encodeURIComponent(csvContent))),
                directory: Directory.Documents,
                recursive: true
            });
            await Share.share({
                title: 'تصدير تقرير Excel',
                text: 'تم إنشاء ملف Excel ويمكنك مشاركته الآن.',
                url: result.uri,
                dialogTitle: 'مشاركة التقرير'
            });
        } catch {
            alert('فشل تصدير Excel. تحقق من صلاحيات التخزين.');
        }
    } else {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

export const exportToPDF = async (elementId: string, reportId: string, setIsExporting: (v: boolean) => void) => {
    setIsExporting(true);
    const element = document.getElementById(elementId);
    if (!element) { setIsExporting(false); return; }
    const status = String(element.getAttribute('data-report-status') || '');
    if (status === 'requires_dataset') {
      setIsExporting(false);
      alert('هذا التقرير قيد التجهيز ولا يمكن تصديره حاليًا.');
      return;
    }

    const fileName = `Report_${reportId}_${new Date().getTime()}.pdf`;
    const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number],
      filename: fileName,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
    };

    try {
        if (Capacitor.isNativePlatform()) {
            const pdfBlob = await html2pdf().from(element).set(opt).output('blob');
            const base64Data = await blobToBase64(pdfBlob);

            const result = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Documents,
                recursive: true
            });

            await Share.share({
                title: 'تصدير تقرير PDF',
                url: result.uri,
                dialogTitle: 'مشاركة التقرير'
            });
        } else {
            await html2pdf().from(element).set(opt).save();
        }
    } catch (e) {
        console.error('PDF Export Error:', e);
        alert('فشل تصدير PDF');
    } finally {
        setIsExporting(false);
    }
};

export const printInvoiceNative = async (elementId: string, invoiceNumber: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (Capacitor.isNativePlatform()) {
        const fileName = `Invoice_${invoiceNumber}.pdf`;
        const opt = {
            margin: 0,
            filename: fileName,
            image: { type: 'jpeg' as const, quality: 1 },
            html2canvas: { scale: 3, useCORS: true },
            jsPDF: { unit: 'mm', format: [80, 200] as [number, number], orientation: 'portrait' as const }
        };

        try {
            const pdfBlob = await html2pdf().from(element).set(opt).output('blob');
            const base64Data = await blobToBase64(pdfBlob);

            const result = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Cache
            });

            await Share.share({
                title: `طباعة فاتورة ${invoiceNumber}`,
                url: result.uri,
                dialogTitle: 'مشاركة الفاتورة'
            });
        } catch {
            alert('فشل طباعة الفاتورة.');
        }
    } else {
        window.print();
    }
};

export const exportInvoicePDF = async (elementId: string, invoiceNumber: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const fileName = `Invoice_${invoiceNumber}_${new Date().getTime()}.pdf`;
    const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: fileName,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
    };
    try {
        if (Capacitor.isNativePlatform()) {
            const pdfBlob = await html2pdf().from(element).set(opt).output('blob');
            const base64Data = await blobToBase64(pdfBlob);
            const result = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Documents,
                recursive: true
            });
            await Share.share({ title: `تصدير فاتورة ${invoiceNumber}`, url: result.uri, dialogTitle: 'مشاركة الفاتورة' });
        } else {
            await html2pdf().from(element).set(opt).save();
        }
    } catch (e) {
        console.error('Invoice PDF Export Error:', e);
        alert('فشل تصدير PDF للفاتورة');
    }
};

export const fetchTrialBalance = async (asOfDate: string) => {
    return apiRequest(`reports/trial-balance?asOfDate=${asOfDate}`);
};

export const fetchAccountStatement = async (accountId: string, from: string, to: string) => {
    return apiRequest(`reports/account-statement/${accountId}?from=${from}&to=${to}`);
};

export const fetchJournalBook = async (from: string, to: string) => {
    return apiRequest(`reports/journal-book?from=${from}&to=${to}`);
};

export const fetchIncomeStatement = async (from: string, to: string) => {
    return apiRequest(`reports/income-statement?from=${from}&to=${to}`);
};

export const fetchBalanceSheet = async (asOfDate: string) => {
    return apiRequest(`reports/balance-sheet?asOfDate=${asOfDate}`);
};

export const fetchSummaryReport = async (from: string, to: string) => {
    return apiRequest(`reports/summary?from=${from}&to=${to}`);
};

export const fetchInvoicesReport = async (params: {
    from: string;
    to: string;
    invoiceType?: string;
    partyId?: string;
    currency?: string;
    branchId?: string;
    status?: string;
}) => {
    const query = new URLSearchParams({
        from: params.from,
        to: params.to,
        invoiceType: params.invoiceType || 'all',
        partyId: params.partyId || '',
        currency: params.currency || 'all',
        branchId: params.branchId || 'all',
        status: params.status || 'all'
    });
    return apiRequest(`reports/invoices?${query.toString()}`);
};

export const fetchPartyStatementReport = async (params: {
    from: string;
    to: string;
    partyId?: string;
    partyType?: string;
}) => {
    const query = new URLSearchParams({
        from: params.from,
        to: params.to,
        partyId: params.partyId || '',
        partyType: params.partyType || 'all'
    });
    return apiRequest(`reports/party-statement?${query.toString()}`);
};

export const fetchItemMovementReport = async (params: {
    from: string;
    to: string;
    itemId?: string;
    warehouseId?: string;
}) => {
    const query = new URLSearchParams({
        from: params.from,
        to: params.to,
        itemId: params.itemId || '',
        warehouseId: params.warehouseId || 'all'
    });
    return apiRequest(`reports/item-movement?${query.toString()}`);
};

export const fetchStockByWarehouseReport = async (warehouseId?: string) => {
    const query = new URLSearchParams({
        warehouseId: warehouseId || 'all'
    });
    return apiRequest(`reports/stock-by-warehouse?${query.toString()}`);
};

export const fetchCashboxReport = async (params: {
    from: string;
    to: string;
    cashBoxId?: string;
    currency?: string;
    status?: string;
}) => {
    const query = new URLSearchParams({
        from: params.from,
        to: params.to,
        cashBoxId: params.cashBoxId || '',
        currency: params.currency || 'all',
        status: params.status || 'all'
    });
    return apiRequest(`reports/cashbox?${query.toString()}`);
};

export const fetchAnalyticsReport = async (params: {
    mode: string;
    from: string;
    to: string;
    limit?: number;
}) => {
    const query = new URLSearchParams({
        mode: params.mode,
        from: params.from,
        to: params.to,
        limit: String(params.limit || 20)
    });
    return apiRequest(`reports/analytics?${query.toString()}`);
};

export const fetchAgentsSalesReport = async (params: {
    from: string;
    to: string;
    branchId?: string;
    agentId?: string;
}) => {
    const query = new URLSearchParams({
        from: params.from,
        to: params.to,
        branchId: params.branchId || 'all',
        agentId: params.agentId || '',
    });
    return apiRequest(`reports/agents/sales?${query.toString()}`);
};

export const fetchAgentsStockReport = async (params: {
    branchId?: string;
    agentId?: string;
}) => {
    const query = new URLSearchParams({
        branchId: params.branchId || 'all',
        agentId: params.agentId || '',
    });
    return apiRequest(`reports/agents/stock?${query.toString()}`);
};

export const fetchAgentsTransfersReport = async (params: {
    from: string;
    to: string;
    branchId?: string;
    agentId?: string;
}) => {
    const query = new URLSearchParams({
        from: params.from,
        to: params.to,
        branchId: params.branchId || 'all',
        agentId: params.agentId || '',
    });
    return apiRequest(`reports/agents/transfers?${query.toString()}`);
};

export const fetchAgentsActivityReport = async (params: {
    branchId?: string;
    agentId?: string;
    status?: string;
}) => {
    const query = new URLSearchParams({
        branchId: params.branchId || 'all',
        agentId: params.agentId || '',
        status: params.status || 'all',
    });
    return apiRequest(`reports/agents/activity?${query.toString()}`);
};

export const fetchReportHub = async (mode: string, filters: ReportFilterState) => {
    const query = new URLSearchParams({
        mode,
        from: filters.dateFrom,
        to: filters.dateTo,
        asOfDate: filters.dateTo,
        branchId: filters.selectedBranchId || 'all',
        warehouseId: filters.selectedWarehouseId || 'all',
        partyId: filters.selectedPartyId || filters.selectedEntityId || '',
        partyType: filters.partyType || 'all',
        itemId: filters.selectedItemId || '',
        category: filters.selectedCategoryId || '',
        userId: filters.selectedUserId || '',
        delegateId: filters.selectedDelegateId || '',
        cashBoxId: filters.selectedCashboxId || '',
        accountId: filters.selectedAccountId || '',
        currency: filters.selectedCurrency || 'all',
        status: filters.reportStatus || 'all',
        invoiceType: filters.invoiceType || 'all',
        movementType: filters.movementType || 'all',
        topN: String(filters.topN || 20),
    });
    return apiRequest(`reports/hub?${query.toString()}`);
};
