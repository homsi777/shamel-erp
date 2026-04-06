import React from 'react';
import {
  Activity,
  AreaChart,
  BarChart2,
  BarChart3,
  BookOpen,
  Boxes,
  Briefcase,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Layers,
  Package,
  PieChart,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  UtensilsCrossed,
} from 'lucide-react';
import { LabelSettings } from '../../types';

export type ReportCategoryId =
  | 'financial'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'parties'
  | 'users'
  | 'agents'
  | 'partners'
  | 'analytics'
  | 'misc'
  | 'restaurant';

export type ReportBackendKind = 'financial' | 'canonical' | 'hub' | 'local';

export type ReportFilterKey =
  | 'date_range'
  | 'as_of_date'
  | 'branch'
  | 'warehouse'
  | 'party'
  | 'party_type'
  | 'item'
  | 'category'
  | 'user'
  | 'delegate'
  | 'currency'
  | 'invoice_type'
  | 'status'
  | 'top_n'
  | 'cashbox'
  | 'account'
  | 'movement_type';

export interface ReportCategoryDefinition {
  id: ReportCategoryId;
  label: string;
  description: string;
  icon: React.ReactElement;
  order: number;
}

export interface ReportDefinition {
  id: string;
  categoryId: ReportCategoryId;
  name: string;
  description: string;
  icon: React.ReactElement;
  backend: {
    kind: ReportBackendKind;
    mode?: string;
  };
  filters: ReportFilterKey[];
  priority: 1 | 2 | 3;
  quickAccess?: boolean;
  hidden?: boolean;
  availability?: 'ready' | 'requires_dataset';
  availabilityNote?: string;
  tags?: string[];
}

export const REPORT_CATEGORIES: ReportCategoryDefinition[] = [
  { id: 'financial', label: 'التقارير المالية', description: 'القوائم المالية والحسابات والأرصدة', icon: <Wallet className="text-emerald-600" />, order: 1 },
  { id: 'sales', label: 'تقارير المبيعات', description: 'تحليل فواتير وعمليات المبيعات', icon: <TrendingUp className="text-green-600" />, order: 2 },
  { id: 'purchases', label: 'تقارير المشتريات', description: 'تحليل فواتير وعمليات المشتريات', icon: <ShoppingCart className="text-blue-600" />, order: 3 },
  { id: 'inventory', label: 'تقارير المخزون والمواد', description: 'حركة المواد والجرد وقيمة المخزون', icon: <Package className="text-violet-600" />, order: 4 },
  { id: 'parties', label: 'تقارير العملاء والموردين', description: 'كشف الحساب والذمم والأرصدة', icon: <Users className="text-teal-600" />, order: 5 },
  { id: 'users', label: 'تقارير المستخدمين والمندوبين', description: 'الأداء والنشاط والتحصيلات', icon: <Activity className="text-cyan-600" />, order: 6 },
  { id: 'agents', label: 'تقارير المناديب', description: 'مبيعات ومخزون وتحركات ونشاط المندوبين', icon: <Briefcase className="text-sky-600" />, order: 6.5 },
  { id: 'partners', label: 'تقارير الشركاء والأرباح', description: 'تقاسم الأرباح وحركة الشركاء', icon: <HandCoins className="text-amber-600" />, order: 7 },
  { id: 'analytics', label: 'التقارير الإحصائية والتحليلية', description: 'لوحات ومؤشرات تحليلية', icon: <AreaChart className="text-indigo-600" />, order: 8 },
  { id: 'misc', label: 'تقارير متنوعة', description: 'تقارير تشغيلية وعامة قابلة للتوسع', icon: <Wrench className="text-slate-600" />, order: 9 },
  { id: 'restaurant', label: 'تقارير المطعم', description: 'تشغيل الطاولات والجلسات (دون محاسبة أو مخزون)', icon: <UtensilsCrossed className="text-orange-600" />, order: 10 },
];

const reports: ReportDefinition[] = [];

const add = (r: ReportDefinition) => {
  reports.push(r);
};

const hub = (mode: string) => ({ kind: 'hub' as const, mode });

add({
  id: 'trial_balance',
  categoryId: 'financial',
  name: 'ميزان المراجعة العام',
  description: 'أرصدة الحسابات المدينة والدائنة حتى تاريخ محدد',
  icon: <BarChart2 className="text-emerald-600" />,
  backend: { kind: 'financial' },
  filters: ['as_of_date', 'branch', 'currency'],
  priority: 1,
  quickAccess: true,
});
add({
  id: 'income_statement',
  categoryId: 'financial',
  name: 'تقرير الأرباح العام / قائمة الدخل',
  description: 'الإيرادات والمصروفات وصافي الربح للفترة',
  icon: <FileBarChart className="text-emerald-600" />,
  backend: { kind: 'financial' },
  filters: ['date_range', 'branch', 'currency'],
  priority: 1,
  quickAccess: true,
});
add({
  id: 'balance_sheet',
  categoryId: 'financial',
  name: 'قائمة المركز المالي / الميزانية العمومية',
  description: 'الأصول والخصوم وحقوق الملكية',
  icon: <Layers className="text-orange-600" />,
  backend: { kind: 'financial' },
  filters: ['as_of_date', 'branch', 'currency'],
  priority: 1,
  quickAccess: true,
});

[
  ['financial_balances_summary', 'ملخص الأرصدة (مدينون / دائنون)', 'ملخص ذمم العملاء والموردين المدينة والدائنة', <BookOpen className="text-emerald-600" />, ['date_range', 'currency', 'branch'], 1, true],
  ['financial_net_sales_purchases_cash', 'صافي المبيعات والمشتريات والنقدية', 'صافي العمليات الرئيسية للفترة', <CircleDollarSign className="text-emerald-600" />, ['date_range', 'currency', 'branch'], 2, false],
  ['financial_ending_inventory_value', 'تقرير قيمة بضاعة آخر المدة', 'تقييم المخزون الختامي حسب التكلفة', <Warehouse className="text-emerald-600" />, ['as_of_date', 'warehouse', 'currency', 'category'], 2, false],
  ['financial_profit_by_period', 'تقرير الأرباح حسب الفترة', 'اتجاه الأرباح عبر الفترات الزمنية', <AreaChart className="text-emerald-600" />, ['date_range', 'branch'], 2, false],
  ['financial_expense_revenue_detail', 'تقرير المصروفات والإيرادات التفصيلي', 'تفصيل حسابات الإيرادات والمصروفات', <FileText className="text-emerald-600" />, ['date_range', 'account', 'branch', 'currency'], 1, false],
  ['financial_accounts_balances', 'تقرير أرصدة الحسابات', 'رصيد كل حساب حتى تاريخ محدد', <FileSpreadsheet className="text-emerald-600" />, ['as_of_date', 'account', 'branch', 'currency'], 1, false],
  ['financial_accounts_movement', 'تقرير حركة الحسابات', 'قيود الحسابات المدينة والدائنة خلال الفترة', <Activity className="text-emerald-600" />, ['date_range', 'account', 'branch', 'currency'], 1, false],
].forEach(([id, name, description, icon, filters, priority, quickAccess]) => add({
  id: id as string,
  categoryId: 'financial',
  name: name as string,
  description: description as string,
  icon: icon as React.ReactElement,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: priority as 1 | 2 | 3,
  quickAccess: Boolean(quickAccess),
}));

[
  ['sales_invoices_aggregate', 'تقرير فواتير المبيعات التجميعي', 'عرض فواتير المبيعات مع الإجماليات', <FileBarChart className="text-green-600" />, ['date_range', 'party', 'branch', 'warehouse', 'currency', 'status', 'user'], 1, true],
  ['sales_operations_aggregate', 'تقرير عمليات البيع التجميعي', 'تجميع عمليات البيع يوميًا أو شهريًا', <BarChart3 className="text-green-600" />, ['date_range', 'branch', 'warehouse', 'currency', 'user'], 1, false],
  ['sales_detail', 'تقرير المبيعات التفصيلي', 'تفصيل خطوط فواتير المبيعات', <ClipboardList className="text-green-600" />, ['date_range', 'party', 'item', 'category', 'user', 'warehouse', 'currency'], 1, false],
  ['sales_by_customer', 'تقرير المبيعات حسب العميل', 'إجمالي المبيعات موزعة حسب العملاء', <Users className="text-green-600" />, ['date_range', 'party', 'branch', 'currency', 'user', 'top_n'], 1, false],
  ['sales_by_item', 'تقرير المبيعات حسب المادة', 'تحليل المبيعات على مستوى المواد', <Package className="text-green-600" />, ['date_range', 'item', 'category', 'warehouse', 'top_n'], 1, false],
  ['sales_by_category', 'تقرير المبيعات حسب التصنيف', 'تجميع المبيعات حسب التصنيفات', <Boxes className="text-green-600" />, ['date_range', 'category', 'warehouse', 'top_n'], 1, false],
  ['sales_top_items', 'تقرير المواد الأكثر بيعًا', 'ترتيب المواد الأعلى بيعًا', <TrendingUp className="text-green-600" />, ['date_range', 'category', 'warehouse', 'top_n'], 1, true],
  ['sales_top_customers', 'تقرير العملاء الأكثر شراءً / الأكثر مبيعًا', 'ترتيب العملاء حسب إجمالي الشراء', <Users className="text-green-600" />, ['date_range', 'party', 'top_n', 'currency', 'user'], 1, true],
  ['sales_profit', 'تقرير الأرباح من المبيعات', 'تحليل هامش الربح من عمليات البيع', <CircleDollarSign className="text-green-600" />, ['date_range', 'party', 'item', 'category', 'user', 'currency'], 1, false],
  ['sales_by_user', 'تقرير المبيعات حسب المستخدم / البائع', 'أداء المبيعات على مستوى المستخدمين', <Briefcase className="text-green-600" />, ['date_range', 'user', 'branch', 'currency', 'top_n'], 1, false],
].forEach(([id, name, description, icon, filters, priority, quickAccess]) => add({
  id: id as string,
  categoryId: 'sales',
  name: name as string,
  description: description as string,
  icon: icon as React.ReactElement,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: priority as 1 | 2 | 3,
  quickAccess: Boolean(quickAccess),
}));

[
  ['purchases_invoices_aggregate', 'تقرير فواتير المشتريات التجميعي', 'عرض فواتير المشتريات مع الإجماليات', <FileBarChart className="text-blue-600" />, ['date_range', 'party', 'branch', 'warehouse', 'currency', 'status', 'user']],
  ['purchases_operations_aggregate', 'تقرير عمليات الشراء التجميعي', 'تجميع عمليات الشراء يوميًا أو شهريًا', <BarChart3 className="text-blue-600" />, ['date_range', 'branch', 'warehouse', 'currency', 'user']],
  ['purchases_detail', 'تقرير المشتريات التفصيلي', 'تفصيل خطوط فواتير المشتريات', <ClipboardList className="text-blue-600" />, ['date_range', 'party', 'item', 'category', 'user', 'warehouse', 'currency']],
  ['purchases_by_supplier', 'تقرير المشتريات حسب المورد', 'إجمالي المشتريات موزعة حسب الموردين', <Users className="text-blue-600" />, ['date_range', 'party', 'branch', 'currency', 'user', 'top_n']],
  ['purchases_by_item', 'تقرير المشتريات حسب المادة', 'تحليل المشتريات على مستوى المواد', <Package className="text-blue-600" />, ['date_range', 'item', 'category', 'warehouse', 'top_n']],
  ['purchases_by_category', 'تقرير المشتريات حسب التصنيف', 'تجميع المشتريات حسب التصنيفات', <Boxes className="text-blue-600" />, ['date_range', 'category', 'warehouse', 'top_n']],
  ['purchases_last_prices', 'تقرير آخر أسعار شراء', 'آخر سعر شراء مسجل لكل مادة', <FileText className="text-blue-600" />, ['date_range', 'item', 'category', 'party', 'currency']],
  ['purchases_top_suppliers', 'تقرير الموردين الأكثر توريدًا', 'ترتيب الموردين حسب حجم التوريد', <TrendingUp className="text-blue-600" />, ['date_range', 'party', 'top_n', 'currency']],
].forEach(([id, name, description, icon, filters]) => add({
  id: id as string,
  categoryId: 'purchases',
  name: name as string,
  description: description as string,
  icon: icon as React.ReactElement,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: 1,
  quickAccess: id === 'purchases_invoices_aggregate',
}));

[
  ['inventory_total_movement', 'إجمالي حركة المواد', 'حركة وارد/صادر لكل مادة', <Activity className="text-violet-600" />, ['date_range', 'warehouse', 'category', 'item'], 1, true],
  ['inventory_item_movement', 'كشف حركة مادة', 'تفصيل حركة مادة واحدة خلال الفترة', <ClipboardList className="text-violet-600" />, ['date_range', 'warehouse', 'item', 'movement_type'], 1, false],
  ['inventory_category_stats', 'إحصائيات تصنيفات المواد', 'مؤشرات المخزون على مستوى التصنيف', <PieChart className="text-violet-600" />, ['date_range', 'category', 'warehouse'], 2, true],
  ['inventory_stagnant', 'تقرير المواد الراكدة', 'مواد دون حركة بيع/شراء ضمن الفترة', <TrendingDown className="text-violet-600" />, ['date_range', 'warehouse', 'category', 'top_n'], 1, false],
  ['inventory_fast_moving', 'تقرير المواد سريعة الحركة', 'المواد الأعلى دورانًا خلال الفترة', <TrendingUp className="text-violet-600" />, ['date_range', 'warehouse', 'category', 'top_n'], 1, false],
  ['inventory_current_stock', 'تقرير الجرد الحالي', 'رصيد المخزون الحالي لجميع المواد', <Warehouse className="text-violet-600" />, ['warehouse', 'category', 'item', 'currency'], 1, false],
  ['inventory_available_qty', 'تقرير الكميات المتوفرة', 'الكميات الفعلية المتاحة بالمخزون', <Package className="text-violet-600" />, ['warehouse', 'category', 'item'], 1, false],
  ['inventory_cost', 'تقرير تكلفة المخزون', 'تكلفة المواد ورصيدها الكمي', <CircleDollarSign className="text-violet-600" />, ['warehouse', 'category', 'item', 'currency'], 1, false],
  ['inventory_value', 'تقرير قيمة المخزون', 'القيمة الإجمالية للمخزون حسب التكلفة', <FileBarChart className="text-violet-600" />, ['warehouse', 'category', 'currency'], 2, false],
  ['inventory_commercial_flow_chart', 'مخطط الحركة التجارية', 'اتجاه الوارد والصادر للمخزون', <AreaChart className="text-violet-600" />, ['date_range', 'warehouse', 'category'], 2, true],
  ['inventory_last_movement', 'تقرير آخر حركة على المواد', 'أحدث حركة مسجلة لكل مادة', <FileText className="text-violet-600" />, ['date_range', 'warehouse', 'category', 'item'], 2, false],
  ['inventory_near_out', 'تقرير المواد التي نفدت أو قاربت على النفاد', 'مواد بكمية صفر أو أقل من حد التنبيه', <TrendingDown className="text-violet-600" />, ['warehouse', 'category', 'item'], 1, false],
].forEach(([id, name, description, icon, filters, priority, quickAccess]) => add({
  id: id as string,
  categoryId: 'inventory',
  name: name as string,
  description: description as string,
  icon: icon as React.ReactElement,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: priority as 1 | 2 | 3,
  quickAccess: Boolean(quickAccess),
}));

[
  ['parties_customer_statement', 'كشف حساب عميل', 'حركة عميل مع الرصيد الافتتاحي والختامي', ['date_range', 'party', 'currency'], 1, true],
  ['parties_supplier_statement', 'كشف حساب مورد', 'حركة مورد مع الرصيد الافتتاحي والختامي', ['date_range', 'party', 'currency'], 1, true],
  ['parties_customer_receivables_summary', 'ملخص ذمم العملاء', 'ملخص أرصدة ذمم العملاء المدينة والدائنة', ['date_range', 'currency', 'party'], 1, false],
  ['parties_supplier_payables_summary', 'ملخص ذمم الموردين', 'ملخص أرصدة ذمم الموردين المدينة والدائنة', ['date_range', 'currency', 'party'], 1, false],
  ['parties_customer_balances', 'أرصدة العملاء', 'الرصيد الحالي لكل عميل', ['currency', 'party'], 1, false],
  ['parties_supplier_balances', 'أرصدة الموردين', 'الرصيد الحالي لكل مورد', ['currency', 'party'], 1, false],
  ['parties_customer_movement', 'تقرير حركة العملاء', 'مجاميع الحركة المدينة والدائنة حسب العميل', ['date_range', 'party', 'currency'], 1, false],
  ['parties_supplier_movement', 'تقرير حركة الموردين', 'مجاميع الحركة المدينة والدائنة حسب المورد', ['date_range', 'party', 'currency'], 1, false],
  ['parties_aging_debts', 'تقرير أعمار الديون', 'تحليل أعمار الذمم حسب فئات الأيام', ['as_of_date', 'party_type', 'party', 'currency'], 2, false],
].forEach(([id, name, description, filters, priority, quickAccess]) => add({
  id: id as string,
  categoryId: 'parties',
  name: name as string,
  description: description as string,
  icon: <Users className="text-teal-600" />,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: priority as 1 | 2 | 3,
  quickAccess: Boolean(quickAccess),
}));
add({
  id: 'parties_reconciliation_future',
  categoryId: 'parties',
  name: 'تقرير المطابقة / التسوية (مستقبلي)',
  description: 'هيكل جاهز لتقارير المطابقة المحاسبية',
  icon: <CheckCircle2 className="text-teal-600" />,
  backend: hub('parties_reconciliation_future'),
  filters: ['date_range', 'party_type', 'party', 'currency'],
  priority: 3,
  availability: 'requires_dataset',
  availabilityNote: 'يتطلب بيانات تسوية ومطابقة تفصيلية غير متوفرة حاليًا.',
});

[
  ['users_activity', 'تقرير حركة المستخدمين (البائعين والموزعين)', 'ملخص نشاط المستخدمين حسب العمليات', ['date_range', 'user', 'delegate', 'branch', 'top_n'], 2],
  ['users_delegate_sales', 'تقرير مبيعات المندوبين', 'مبيعات المستخدمين ذوي دور المندوب', ['date_range', 'delegate', 'branch', 'currency', 'top_n'], 2],
  ['users_delegate_collections', 'تقرير تحصيلات المندوبين', 'تحصيلات نقدية مرتبطة بعمليات المندوبين', ['date_range', 'delegate', 'currency', 'top_n'], 2],
  ['users_performance', 'تقرير أداء المستخدمين', 'مؤشرات الأداء والإنتاجية حسب المستخدم', ['date_range', 'user', 'branch', 'currency', 'top_n'], 2],
  ['users_sales_by_seller', 'تقرير المبيعات حسب البائع', 'إجمالي المبيعات حسب البائع', ['date_range', 'user', 'branch', 'currency', 'top_n'], 1],
  ['users_activity_by_user', 'تقرير النشاط حسب المستخدم', 'تفصيل نشاط يومي لكل مستخدم', ['date_range', 'user', 'delegate', 'branch'], 2],
].forEach(([id, name, description, filters, priority]) => add({
  id: id as string,
  categoryId: 'users',
  name: name as string,
  description: description as string,
  icon: <Activity className="text-cyan-600" />,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: priority as 1 | 2 | 3,
}));

[
  ['agents_sales', 'تقرير مبيعات المناديب', 'إجمالي مبيعات المناديب خلال الفترة', ['date_range', 'branch', 'delegate'], 1, true],
  ['agents_stock', 'تقرير مخزون المناديب', 'ملخص الكميات لدى كل مندوب', ['branch', 'delegate'], 1, false],
  ['agents_transfers', 'تقرير تحويلات المناديب', 'تحويلات المخزون للمناديب والمرتجعات', ['date_range', 'branch', 'delegate'], 2, false],
  ['agents_activity', 'تقرير نشاط المناديب', 'آخر ظهور وحالة الاتصال للمندوبين', ['branch', 'delegate', 'status'], 2, false],
].forEach(([id, name, description, filters, priority, quickAccess]) => add({
  id: id as string,
  categoryId: 'agents',
  name: name as string,
  description: description as string,
  icon: <Briefcase className="text-sky-600" />,
  backend: { kind: 'canonical' },
  filters: filters as ReportFilterKey[],
  priority: priority as 1 | 2 | 3,
  quickAccess: Boolean(quickAccess),
}));

[
  ['partners_profit_sharing', 'تقرير الشركاء وتقاسم الأرباح', 'توزيع صافي الربح على الشركاء حسب النسبة'],
  ['partners_profit_by_period', 'تقرير أرباح الشركاء حسب الفترة', 'اتجاه أرباح الشركاء عبر الفترات'],
  ['partners_profit_distribution', 'تقرير توزيع الأرباح', 'تفصيل التوزيعات الفعلية للمساهمين'],
].forEach(([id, name, description]) => add({
  id: id as string,
  categoryId: 'partners',
  name: name as string,
  description: description as string,
  icon: <HandCoins className="text-amber-600" />,
  backend: hub(id as string),
  filters: ['date_range', 'currency'],
  priority: 3,
}));
add({
  id: 'partners_capital_contributions',
  categoryId: 'partners',
  name: 'تقرير مساهمات الشركاء / رأس المال',
  description: 'حركة رأس المال للشركاء',
  icon: <CircleDollarSign className="text-amber-600" />,
  backend: hub('partners_capital_contributions'),
  filters: ['date_range'],
  priority: 3,
  availability: 'requires_dataset',
  availabilityNote: 'يتطلب تصنيفًا محاسبيًا صريحًا لحركات رأس المال في البيانات.',
});

[
  ['analytics_overview', 'تقرير الإحصائيات الشامل', 'لوحة مؤشرات تحليلية شاملة للفترة', ['date_range', 'branch', 'warehouse', 'currency'], true],
  ['analytics_overview_print', 'طباعة تقرير الإحصائيات الشامل', 'نسخة طباعة جاهزة من المؤشرات الشاملة', ['date_range', 'branch', 'warehouse', 'currency'], false],
  ['analytics_sales', 'تقرير الإحصائيات حسب المبيعات', 'تحليل مبيعات الفترات والعملاء والمواد', ['date_range', 'branch', 'warehouse', 'user', 'currency'], false],
  ['analytics_purchases', 'تقرير الإحصائيات حسب المشتريات', 'تحليل مشتريات الفترات والموردين والمواد', ['date_range', 'branch', 'warehouse', 'currency'], false],
  ['analytics_items', 'تقرير الإحصائيات حسب المواد', 'مؤشرات الدوران والقيمة حسب المادة', ['date_range', 'warehouse', 'category', 'top_n'], false],
  ['analytics_customers', 'تقرير الإحصائيات حسب العملاء', 'تحليل العملاء الأكثر نشاطًا', ['date_range', 'party', 'top_n', 'currency'], false],
  ['analytics_commercial_flow', 'مخطط الحركة التجارية', 'اتجاه المبيعات والمشتريات والمخزون', ['date_range', 'branch', 'warehouse'], true],
  ['analytics_dashboards', 'لوحات تحليلية مختصرة داخل صفحة التقرير', 'بطاقات KPI ولوحات مختصرة جاهزة للطباعة', ['date_range', 'branch', 'currency'], false],
].forEach(([id, name, description, filters, quickAccess]) => add({
  id: id as string,
  categoryId: 'analytics',
  name: name as string,
  description: description as string,
  icon: <AreaChart className="text-indigo-600" />,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: 2,
  quickAccess: Boolean(quickAccess),
}));

[
  ['misc_unclassified', 'تقارير لا تنتمي بوضوح إلى قسم واحد', 'تقارير تشغيلية عابرة للأقسام', ['date_range', 'branch', 'warehouse']],
  ['misc_operational', 'تقارير تشغيلية عامة', 'مؤشرات متابعة التشغيل اليومي', ['date_range', 'branch', 'warehouse', 'status']],
  ['misc_quick', 'تقارير مجمعة سريعة', 'ملخص سريع لأهم أرقام الفترة', ['date_range', 'branch', 'currency']],
].forEach(([id, name, description, filters]) => add({
  id: id as string,
  categoryId: 'misc',
  name: name as string,
  description: description as string,
  icon: <Wrench className="text-slate-600" />,
  backend: hub(id as string),
  filters: filters as ReportFilterKey[],
  priority: 3,
}));
add({
  id: 'misc_future',
  categoryId: 'misc',
  name: 'تقارير مستقبلية قابلة للإضافة بسهولة',
  description: 'مكان مخصص للتقارير المستقبلية',
  icon: <Wrench className="text-slate-600" />,
  backend: hub('misc_future'),
  filters: ['date_range'],
  priority: 3,
  availability: 'requires_dataset',
  availabilityNote: 'هذه مساحة قابلة للتوسعة وتحتاج تحديد مجموعة بيانات التقرير الجديد.',
});

add({
  id: 'restaurant_tables_report',
  categoryId: 'restaurant',
  name: 'لقطة إشغال الطاولات',
  description: 'حالة الطاولات، الجلسات المفتوحة، المتوسطات — بيانات تشغيلية فقط',
  icon: <UtensilsCrossed className="text-orange-600" />,
  backend: hub('restaurant_tables'),
  filters: ['date_range', 'branch'],
  priority: 3,
});
add({
  id: 'restaurant_orders_report',
  categoryId: 'restaurant',
  name: 'استخدام الطاولات',
  description: 'عدد الجلسات وزمن الفتح لكل طاولة (وضع المحرك: restaurant_orders)',
  icon: <UtensilsCrossed className="text-orange-600" />,
  backend: hub('restaurant_orders'),
  filters: ['date_range', 'branch'],
  priority: 3,
});
add({
  id: 'restaurant_sessions_report',
  categoryId: 'restaurant',
  name: 'سجل الجلسات',
  description: 'جلسات بحسب الفترة: فتح، إغلاق، مدة، ضيوف، إجمالي تقديري',
  icon: <UtensilsCrossed className="text-orange-600" />,
  backend: hub('restaurant_sessions'),
  filters: ['date_range', 'branch'],
  priority: 3,
});
add({
  id: 'restaurant_qr_activity_report',
  categoryId: 'restaurant',
  name: 'نشاط طلبات QR',
  description: 'طلبات QR حسب التاريخ — عدد حسب الحالة والطاولة والجلسة (تشغيلي، دون محاسبة)',
  icon: <UtensilsCrossed className="text-orange-600" />,
  backend: hub('restaurant_qr_activity'),
  filters: ['date_range', 'branch'],
  priority: 3,
});
add({
  id: 'restaurant_session_request_timeline_report',
  categoryId: 'restaurant',
  name: 'خط زمني لطلبات الجلسة',
  description: 'دفعات الطلبات عبر الزمن لكل جلسة (أول / آخر طلب، حالات)',
  icon: <UtensilsCrossed className="text-orange-600" />,
  backend: hub('restaurant_session_request_timeline'),
  filters: ['date_range', 'branch'],
  priority: 3,
});
add({
  id: 'restaurant_qr_menu_usage_report',
  categoryId: 'restaurant',
  name: 'استخدام منيو QR',
  description: 'أكثر الأصناف طلبًا من المنيو الظاهر QR (تشغيلي)',
  icon: <UtensilsCrossed className="text-orange-600" />,
  backend: hub('restaurant_qr_menu_usage'),
  filters: ['date_range', 'branch'],
  priority: 3,
});

[
  ['summary', 'analytics'],
  ['invoices_report', 'sales'],
  ['party_statement', 'parties'],
  ['inventory_report_core', 'inventory'],
  ['cashbox_report', 'financial'],
  ['employee_payroll', 'users'],
].forEach(([id, categoryId]) => add({
  id: id as string,
  categoryId: categoryId as ReportCategoryId,
  name: 'تقرير تراثي',
  description: 'مخصص للتوافق مع الشاشات القديمة',
  icon: <FileText className="text-slate-400" />,
  backend: id === 'employee_payroll' ? { kind: 'local' } : { kind: 'canonical' },
  filters: ['date_range'],
  priority: 3,
  hidden: true,
}));

export const REPORT_DEFINITIONS: ReportDefinition[] = reports;

export const getReportTypes = (_labels?: LabelSettings): ReportDefinition[] => {
  return REPORT_DEFINITIONS.filter((r) => !r.hidden);
};

export const getAllReportTypes = (): ReportDefinition[] => REPORT_DEFINITIONS;

export const getReportById = (id: string | null | undefined): ReportDefinition | undefined => {
  if (!id) return undefined;
  return REPORT_DEFINITIONS.find((r) => r.id === id);
};

export const getCategoryById = (id: ReportCategoryId | string | null | undefined): ReportCategoryDefinition | undefined => {
  if (!id) return undefined;
  return REPORT_CATEGORIES.find((c) => c.id === id);
};

export const getReportsByCategory = (categoryId: ReportCategoryId): ReportDefinition[] => {
  return getReportTypes().filter((r) => r.categoryId === categoryId);
};

export const getQuickAccessReports = (): ReportDefinition[] => {
  return getReportTypes().filter((r) => r.quickAccess);
};

export const searchReports = (query: string): ReportDefinition[] => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return getReportTypes();
  return getReportTypes().filter((r) => {
    const hay = `${r.name} ${r.description} ${(r.tags || []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
};

export const validateReportRegistry = (): string[] => {
  const visible = getReportTypes();
  const idSeen = new Set<string>();
  const labelSeen = new Set<string>();
  const issues: string[] = [];

  for (const report of visible) {
    if (idSeen.has(report.id)) {
      issues.push(`Duplicate report id: ${report.id}`);
    }
    idSeen.add(report.id);

    const labelKey = `${report.categoryId}:${report.name.trim()}`;
    if (labelSeen.has(labelKey)) {
      issues.push(`Duplicate report label in category: ${report.name}`);
    }
    labelSeen.add(labelKey);
  }

  return issues;
};

const registryIssues = validateReportRegistry();
if (registryIssues.length && typeof console !== 'undefined') {
  console.warn('[reports] Registry validation issues:', registryIssues);
}
