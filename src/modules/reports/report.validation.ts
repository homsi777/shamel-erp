import {
  getAllReportTypes,
  getReportById,
  type ReportBackendKind,
  type ReportDefinition,
  type ReportFilterKey,
} from './report.definitions';

export type ReportCanonicalLevel = 'accounting_canonical' | 'operational_estimate';
export type ReportCompleteness = 'complete' | 'partial' | 'requires_dataset';

export interface ReportValidationMatrixRow {
  reportId: string;
  reportMode: string;
  reportName: string;
  backendKind: ReportBackendKind;
  dataSource: string;
  backendLogicSource: string;
  filterSet: ReportFilterKey[];
  totalsLogic: string;
  canonicalLevel: ReportCanonicalLevel;
  completeness: ReportCompleteness;
  printReady: boolean;
  excelReady: boolean;
  missingDataset?: string;
}

export interface ReportRuntimeState {
  reportId: string;
  reportMode: string;
  canonicalLevel: ReportCanonicalLevel;
  completeness: ReportCompleteness;
  status: string;
  note: string;
  missingDataset: string;
  printReady: boolean;
  pdfReady: boolean;
  excelReady: boolean;
  requiresDataset: boolean;
  exportBlockReason: string;
}

const OPERATIONAL_ESTIMATE_IDS = new Set<string>([
  'sales_profit',
  'financial_balances_summary',
  'financial_net_sales_purchases_cash',
  'financial_ending_inventory_value',
  'financial_profit_by_period',
  'inventory_cost',
  'inventory_value',
  'inventory_current_stock',
  'users_activity',
  'users_delegate_sales',
  'users_activity_by_user',
  'users_performance',
  'users_sales_by_seller',
  'analytics_overview',
  'analytics_overview_print',
  'analytics_sales',
  'analytics_purchases',
  'analytics_items',
  'analytics_customers',
  'analytics_commercial_flow',
  'analytics_dashboards',
  'misc_unclassified',
  'misc_operational',
  'misc_quick',
  'partners_profit_sharing',
  'partners_profit_by_period',
  'partners_profit_distribution',
  'partners_capital_contributions',
  'parties_reconciliation_future',
  'users_delegate_collections',
  'misc_future',
  'restaurant_tables_report',
  'restaurant_orders_report',
  'restaurant_sessions_report',
  'restaurant_qr_activity_report',
  'restaurant_session_request_timeline_report',
  'restaurant_qr_menu_usage_report',
]);

const PARTIAL_IDS = new Set<string>([
  'sales_profit',
  'financial_balances_summary',
  'financial_net_sales_purchases_cash',
  'financial_ending_inventory_value',
  'financial_profit_by_period',
  'inventory_cost',
  'inventory_value',
  'partners_profit_sharing',
  'partners_profit_by_period',
  'partners_profit_distribution',
  'partners_capital_contributions',
]);

const REQUIRES_DATASET_IDS = new Set<string>([
  'parties_reconciliation_future',
  'users_delegate_collections',
  'misc_future',
  'partners_capital_contributions',
]);

const BACKEND_LOGIC_SOURCE: Record<ReportBackendKind, string> = {
  financial: 'backend/routes/reports.routes.ts',
  canonical: 'backend/routes/reports.routes.ts',
  hub: 'backend/routes/reports.hub.ts',
  local: 'src/modules/reports/report.logic.tsx',
};

const DATA_SOURCE_BY_KIND: Record<ReportBackendKind, string> = {
  financial: 'حركات القيود المحاسبية الممرحلة (دفتر الأستاذ)',
  canonical: 'بيانات النظام الأساسية (فواتير/أطراف/مخزون/صندوق)',
  hub: 'تجميع تقارير الخلفية من جداول النظام الأساسية',
  local: 'بيانات محلية في الواجهة (Legacy)',
};

const defaultTotalsLogic = (def: ReportDefinition): string => {
  if (def.id === 'sales_profit') return 'جمع الإيراد ناقص جمع (الكمية × التكلفة الحالية للمادة)';
  if (def.id === 'financial_profit_by_period') return 'صافي شهري مبسط = المبيعات - المشتريات';
  if (def.id === 'financial_ending_inventory_value') return 'جمع (الكمية الحالية × التكلفة الحالية)';
  if (def.id.startsWith('parties_')) return 'افتتاحي + حركة الفترة (مدين/دائن) = ختامي';
  if (def.id.startsWith('inventory_')) return 'تجميع خادمي على الصفوف بعد تطبيق الفلاتر';
  if (def.id.startsWith('sales_') || def.id.startsWith('purchases_')) return 'تجميع خادمي على الفواتير/السطور بعد تطبيق الفلاتر';
  return 'تجميع خادمي على البيانات المفلترة';
};

const rowForDefinition = (def: ReportDefinition): ReportValidationMatrixRow => {
  const requiresDataset =
    REQUIRES_DATASET_IDS.has(def.id) ||
    def.availability === 'requires_dataset';
  const completeness: ReportCompleteness = requiresDataset
    ? 'requires_dataset'
    : PARTIAL_IDS.has(def.id)
      ? 'partial'
      : 'complete';

  return {
    reportId: def.id,
    reportMode: def.backend.mode || def.id,
    reportName: def.name,
    backendKind: def.backend.kind,
    dataSource: DATA_SOURCE_BY_KIND[def.backend.kind],
    backendLogicSource: BACKEND_LOGIC_SOURCE[def.backend.kind],
    filterSet: def.filters,
    totalsLogic: defaultTotalsLogic(def),
    canonicalLevel: OPERATIONAL_ESTIMATE_IDS.has(def.id) ? 'operational_estimate' : 'accounting_canonical',
    completeness,
    printReady: !requiresDataset,
    excelReady: !requiresDataset,
    missingDataset: def.availability === 'requires_dataset' ? (def.availabilityNote || '') : undefined,
  };
};

const MATRIX_ROWS: ReportValidationMatrixRow[] = getAllReportTypes()
  .filter((def) => !def.hidden)
  .map((def) => rowForDefinition(def))
  .sort((a, b) => a.reportName.localeCompare(b.reportName, 'ar'));

export const REPORT_VALIDATION_MATRIX = MATRIX_ROWS;

export const getReportValidationMatrix = (): ReportValidationMatrixRow[] => REPORT_VALIDATION_MATRIX;

export const getReportValidationRow = (reportId: string): ReportValidationMatrixRow | undefined => {
  return REPORT_VALIDATION_MATRIX.find((row) => row.reportId === reportId);
};

export const getReportIdsByCompleteness = (completeness: ReportCompleteness): string[] => {
  return REPORT_VALIDATION_MATRIX
    .filter((row) => row.completeness === completeness)
    .map((row) => row.reportId);
};

export const getReportIdsByCanonicalLevel = (canonicalLevel: ReportCanonicalLevel): string[] => {
  return REPORT_VALIDATION_MATRIX
    .filter((row) => row.canonicalLevel === canonicalLevel)
    .map((row) => row.reportId);
};

export const resolveReportRuntimeState = (
  reportId: string | null | undefined,
  meta?: Record<string, any>
): ReportRuntimeState | null => {
  if (!reportId) return null;

  const def = getReportById(reportId);
  if (!def) return null;

  const matrix = getReportValidationRow(reportId) || rowForDefinition(def);
  const status = String(meta?.status || 'ok');
  const note = String(meta?.note || '');
  const missingDataset = String(meta?.missingDataset || matrix.missingDataset || '');

  let completeness: ReportCompleteness = matrix.completeness;
  if (status === 'requires_dataset') completeness = 'requires_dataset';
  if (typeof meta?.completeness === 'string') {
    const v = String(meta.completeness);
    if (v === 'complete' || v === 'partial' || v === 'requires_dataset') completeness = v;
  }

  let canonicalLevel: ReportCanonicalLevel = matrix.canonicalLevel;
  if (typeof meta?.canonicalLevel === 'string') {
    const v = String(meta.canonicalLevel);
    if (v === 'accounting_canonical' || v === 'operational_estimate') canonicalLevel = v;
  }

  const runtimeCaps = meta?.exportCapabilities || {};
  const requiresDataset = completeness === 'requires_dataset';
  const printReady = !requiresDataset && Boolean(runtimeCaps.print ?? matrix.printReady);
  const excelReady = !requiresDataset && Boolean(runtimeCaps.excel ?? matrix.excelReady);
  const pdfReady = !requiresDataset && Boolean(runtimeCaps.pdf ?? matrix.printReady);

  const exportBlockReason = requiresDataset
    ? (missingDataset || 'هذا التقرير قيد التجهيز ويتطلب بيانات إضافية.')
    : '';

  return {
    reportId,
    reportMode: matrix.reportMode,
    canonicalLevel,
    completeness,
    status,
    note,
    missingDataset,
    printReady,
    pdfReady,
    excelReady,
    requiresDataset,
    exportBlockReason,
  };
};
