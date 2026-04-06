import React from 'react';
import { ArrowLeft, Printer, FileSpreadsheet, FileText } from 'lucide-react';
import { getCategoryById, getReportById } from '../../modules/reports/report.definitions';
import { DEFAULT_LABELS, LabelSettings } from '../../types';

interface Props {
    reportId: string;
    showResult: boolean;
    dateFrom: string;
    dateTo: string;
    onBack: () => void;
    onPrint: () => void;
    onExcel: () => void;
    onPDF: () => void;
    isExporting: boolean;
    canPrint?: boolean;
    canExcel?: boolean;
    canPDF?: boolean;
    disableReason?: string;
    labels?: LabelSettings;
}

const ReportHeader: React.FC<Props> = ({
    reportId,
    showResult,
    dateFrom,
    dateTo,
    onBack,
    onPrint,
    onExcel,
    onPDF,
    isExporting,
    canPrint = true,
    canExcel = true,
    canPDF = true,
    disableReason = '',
    labels
}) => {
    const safeLabels = {
        ...DEFAULT_LABELS,
        ...(labels || {}),
        invoice: { ...DEFAULT_LABELS.invoice, ...((labels as any)?.invoice || {}) },
        reports: { ...DEFAULT_LABELS.reports, ...((labels as any)?.reports || {}) },
    };

    const report = getReportById(reportId);
    const category = getCategoryById(report?.categoryId);

    return (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" dir="rtl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="rounded-full p-2 text-gray-600 hover:bg-gray-100" aria-label="عودة">
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <p className="text-xs text-gray-500">{category?.label || 'التقارير'}</p>
                        <h2 className="text-xl font-black text-gray-800">{report?.name || reportId}</h2>
                        <p className="text-xs text-gray-500 mt-1">من {dateFrom} إلى {dateTo}</p>
                    </div>
                </div>

                {showResult && (
                    <div className="flex flex-wrap items-center gap-2 no-print md:justify-end">
                        <button
                            onClick={onExcel}
                            disabled={!canExcel}
                            title={!canExcel ? disableReason : 'تصدير إلى Excel'}
                            className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 font-bold text-green-700 hover:bg-green-100 transition disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <FileSpreadsheet size={18} /> {safeLabels.reports.export_excel}
                        </button>
                        <button
                            onClick={onPDF}
                            disabled={isExporting || !canPDF}
                            title={!canPDF ? disableReason : 'تصدير إلى PDF'}
                            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 font-bold text-red-700 hover:bg-red-100 transition disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isExporting ? 'جاري...' : <><FileText size={18} /> {safeLabels.reports.export_pdf}</>}
                        </button>
                        <button
                            onClick={onPrint}
                            disabled={!canPrint}
                            title={!canPrint ? disableReason : 'طباعة'}
                            className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 font-bold text-white hover:bg-black transition disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Printer size={18} /> {safeLabels.invoice.print_btn}
                        </button>
                    </div>
                )}
            </div>
            {showResult && disableReason && (!canPrint || !canExcel || !canPDF) ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {disableReason}
                </div>
            ) : null}
        </div>
    );
};

export default ReportHeader;
