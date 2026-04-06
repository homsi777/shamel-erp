import { useState } from 'react';
import {
    buildFinancialReportData,
    buildCanonicalReportData,
    buildHubReportData,
} from '../modules/reports/report.logic';
import {
    exportToExcel,
    exportToPDF,
    fetchTrialBalance,
    fetchAccountStatement,
    fetchJournalBook,
    fetchIncomeStatement,
    fetchBalanceSheet,
    fetchSummaryReport,
    fetchInvoicesReport,
    fetchPartyStatementReport,
    fetchItemMovementReport,
    fetchStockByWarehouseReport,
    fetchCashboxReport,
    fetchAnalyticsReport,
    fetchAgentsSalesReport,
    fetchAgentsStockReport,
    fetchAgentsTransfersReport,
    fetchAgentsActivityReport,
    fetchReportHub,
} from '../modules/reports/report.actions';
import { getReportById } from '../modules/reports/report.definitions';
import { ReportData, ReportFilterState } from '../modules/reports/report.types';
import { resolveReportRuntimeState } from '../modules/reports/report.validation';

const FINANCIAL_REPORT_IDS = ['trial_balance', 'account_statement', 'journal_book', 'income_statement', 'balance_sheet'] as const;
const CANONICAL_REPORT_IDS = ['summary', 'invoices_report', 'party_statement', 'inventory_report_core', 'cashbox_report', 'top_selling', 'top_purchased', 'stagnant_items', 'top_customers', 'agents_sales', 'agents_stock', 'agents_transfers', 'agents_activity'] as const;

const defaultDateFrom = () => new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
const defaultDateTo = () => new Date().toISOString().split('T')[0];

const createDefaultFilters = (): ReportFilterState => ({
    dateFrom: defaultDateFrom(),
    dateTo: defaultDateTo(),
    datePreset: 'last30days',
    selectedBranchId: 'all',
    selectedWarehouseId: 'all',
    selectedEntityId: '',
    selectedPartyId: '',
    selectedItemId: '',
    selectedCategoryId: '',
    selectedUserId: '',
    selectedDelegateId: '',
    selectedCashboxId: '',
    selectedAccountId: '',
    selectedCurrency: 'all',
    reportStatus: 'all',
    invoiceType: 'all',
    inventoryMode: 'item_movement',
    movementType: 'all',
    topN: 20,
    containerSearchQuery: '',
    reportSearchQuery: '',
    reconciliationType: 'fund',
    actualValueInput: '',
    filterModel: '',
    filterOrigin: '',
    filterColor: '',
    filterManufacturer: '',
    partyType: 'all'
});

const mapLegacyReportId = (reportId: string | null): { id: string | null; patch: Partial<ReportFilterState> } => {
    if (!reportId) return { id: null, patch: {} };

    switch (reportId) {
        case 'sales':
            return { id: 'sales_invoices_aggregate', patch: { invoiceType: 'sale' } };
        case 'purchases':
            return { id: 'purchases_invoices_aggregate', patch: { invoiceType: 'purchase' } };
        case 'client_statement':
            return { id: 'parties_customer_statement', patch: { partyType: 'CUSTOMER' } };
        case 'supplier_statement':
            return { id: 'parties_supplier_statement', patch: { partyType: 'SUPPLIER' } };
        case 'product_movement':
            return { id: 'inventory_item_movement', patch: { inventoryMode: 'item_movement' } };
        case 'warehouse_movement':
        case 'inventory_report':
            return { id: 'inventory_total_movement', patch: { inventoryMode: 'stock_by_warehouse' } };
        case 'fund_movement':
        case 'expenses':
            return { id: 'cashbox_report', patch: {} };
        default:
            return { id: reportId, patch: {} };
    }
};

const isFinancialId = (reportId: string) => (FINANCIAL_REPORT_IDS as readonly string[]).includes(reportId);
const isCanonicalId = (reportId: string) => (CANONICAL_REPORT_IDS as readonly string[]).includes(reportId);

export const useReports = (dataContext: any, settings: any) => {
    const [selectedReportId, setSelectedReportIdState] = useState<string | null>(null);
    const [showResult, setShowResult] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [reportDataOverride, setReportDataOverride] = useState<ReportData | null>(null);
    const [filters, setFilters] = useState<ReportFilterState>(createDefaultFilters());

    const labels = settings?.labels || {};
    const selectedReportDef = getReportById(selectedReportId || undefined);
    const backendKind = selectedReportDef?.backend?.kind;

    const reportData = reportDataOverride;
    const reportRuntime = resolveReportRuntimeState(selectedReportId, reportData?.meta as any);

    const resetFilters = () => {
        setFilters(createDefaultFilters());
        setShowResult(false);
    };

    const setSelectedReportId = (nextId: string | null) => {
        const mapped = mapLegacyReportId(nextId);
        setSelectedReportIdState(mapped.id);
        setShowResult(false);
        setReportDataOverride(null);
        if (Object.keys(mapped.patch).length > 0) {
            setFilters((prev) => ({ ...prev, ...mapped.patch }));
        }
    };

    const handleBack = () => {
        if (showResult) {
            setShowResult(false);
            setFilters((prev) => ({ ...prev, reportSearchQuery: '', actualValueInput: '' }));
            return;
        }
        setSelectedReportIdState(null);
        resetFilters();
    };

    const fetchFinancialPayload = async (reportId: string) => {
        if (reportId === 'trial_balance') return fetchTrialBalance(filters.dateTo);
        if (reportId === 'account_statement') {
            const accountId = filters.selectedAccountId || filters.selectedEntityId;
            if (!accountId) throw new Error('يرجى اختيار الحساب قبل عرض كشف الحساب.');
            return fetchAccountStatement(accountId, filters.dateFrom, filters.dateTo);
        }
        if (reportId === 'journal_book') return fetchJournalBook(filters.dateFrom, filters.dateTo);
        if (reportId === 'income_statement') return fetchIncomeStatement(filters.dateFrom, filters.dateTo);
        if (reportId === 'balance_sheet') return fetchBalanceSheet(filters.dateTo);
        return null;
    };

    const fetchCanonicalPayload = async (reportId: string) => {
        if (reportId === 'summary') return fetchSummaryReport(filters.dateFrom, filters.dateTo);

        if (reportId === 'invoices_report') {
            return fetchInvoicesReport({
                from: filters.dateFrom,
                to: filters.dateTo,
                invoiceType: filters.invoiceType,
                partyId: filters.selectedPartyId || filters.selectedEntityId,
                currency: filters.selectedCurrency,
                branchId: filters.selectedBranchId,
                status: filters.reportStatus,
            });
        }

        if (reportId === 'party_statement') {
            return fetchPartyStatementReport({
                from: filters.dateFrom,
                to: filters.dateTo,
                partyId: filters.selectedPartyId || filters.selectedEntityId,
                partyType: filters.partyType,
            });
        }

        if (reportId === 'inventory_report_core') {
            return filters.inventoryMode === 'stock_by_warehouse'
                ? fetchStockByWarehouseReport(filters.selectedWarehouseId)
                : fetchItemMovementReport({
                    from: filters.dateFrom,
                    to: filters.dateTo,
                    itemId: filters.selectedItemId || filters.selectedEntityId,
                    warehouseId: filters.selectedWarehouseId,
                });
        }

        if (reportId === 'cashbox_report') {
            return fetchCashboxReport({
                from: filters.dateFrom,
                to: filters.dateTo,
                cashBoxId: filters.selectedCashboxId || filters.selectedEntityId,
                currency: filters.selectedCurrency,
                status: filters.reportStatus,
            });
        }

        if (['top_selling', 'top_purchased', 'stagnant_items', 'top_customers'].includes(reportId)) {
            return fetchAnalyticsReport({
                mode: reportId,
                from: filters.dateFrom,
                to: filters.dateTo,
                limit: filters.topN || 20,
            });
        }

        if (reportId === 'agents_sales') {
            return fetchAgentsSalesReport({
                from: filters.dateFrom,
                to: filters.dateTo,
                branchId: filters.selectedBranchId,
                agentId: filters.selectedDelegateId,
            });
        }

        if (reportId === 'agents_stock') {
            return fetchAgentsStockReport({
                branchId: filters.selectedBranchId,
                agentId: filters.selectedDelegateId,
            });
        }

        if (reportId === 'agents_transfers') {
            return fetchAgentsTransfersReport({
                from: filters.dateFrom,
                to: filters.dateTo,
                branchId: filters.selectedBranchId,
                agentId: filters.selectedDelegateId,
            });
        }

        if (reportId === 'agents_activity') {
            return fetchAgentsActivityReport({
                branchId: filters.selectedBranchId,
                agentId: filters.selectedDelegateId,
                status: filters.reportStatus,
            });
        }

        return null;
    };

    const handleApply = async () => {
        if (!selectedReportId) return;

        const reportDefinition = getReportById(selectedReportId);
        const effectiveKind = reportDefinition?.backend?.kind || (isFinancialId(selectedReportId) ? 'financial' : (isCanonicalId(selectedReportId) ? 'canonical' : 'hub'));

        setShowResult(true);
        setReportDataOverride(null);

        try {
            let payload: any = null;
            let built: ReportData | null = null;

            if (effectiveKind === 'financial') {
                payload = await fetchFinancialPayload(selectedReportId);
                built = buildFinancialReportData(selectedReportId, payload, filters);
            } else if (effectiveKind === 'canonical') {
                payload = await fetchCanonicalPayload(selectedReportId);
                built = buildCanonicalReportData(selectedReportId, payload, filters);
            } else if (effectiveKind === 'hub') {
                const mode = reportDefinition?.backend?.mode || selectedReportId;
                payload = await fetchReportHub(mode, filters);
                built = buildHubReportData(selectedReportId, payload, filters);
            }

            setReportDataOverride(built);
        } catch (e: any) {
            alert(e?.message || 'فشل جلب التقرير.');
            setReportDataOverride(null);
        }
    };

    const handleSearchContainer = () => {
        // Kept for legacy compatibility.
        return;
    };

    const handleExcel = () => {
        if (!reportData || !selectedReportId) return;
        if (reportRuntime && !reportRuntime.excelReady) {
            alert(reportRuntime.exportBlockReason || 'تصدير Excel غير متاح لهذا التقرير.');
            return;
        }
        exportToExcel(reportData, selectedReportId);
    };

    const handlePDF = () => {
        if (!selectedReportId) return;
        if (reportRuntime && !reportRuntime.pdfReady) {
            alert(reportRuntime.exportBlockReason || 'تصدير PDF غير متاح لهذا التقرير.');
            return;
        }
        exportToPDF('report-content', selectedReportId, setIsExporting);
    };

    const handlePrint = () => {
        if (reportRuntime && !reportRuntime.printReady) {
            alert(reportRuntime.exportBlockReason || 'الطباعة غير متاحة لهذا التقرير.');
            return;
        }
        window.print();
    };

    return {
        state: { selectedReportId, showResult, isExporting, filters, reportData, reportRuntime },
        setters: { setSelectedReportId, setFilters },
        actions: { handleBack, handleApply, handleSearchContainer, handleExcel, handlePDF, handlePrint }
    };
};
