import React, { useMemo } from 'react';
import { Building2, Calendar, Filter, Package, User, Warehouse as WarehouseIcon } from 'lucide-react';
import { getReportById, type ReportFilterKey } from '../../modules/reports/report.definitions';
import { ReportFilterState } from '../../modules/reports/report.types';
import { Account, Agent, AppUser, Branch, CashBox, Category, Client, Employee, InventoryItem, LabelSettings, Warehouse } from '../../types';

interface Props {
    reportId: string;
    filters: ReportFilterState;
    setFilters: React.Dispatch<React.SetStateAction<ReportFilterState>>;
    onApply: () => void;
    onBack: () => void;
    onSearchContainer: () => void;
    data: {
        inventory: InventoryItem[];
        clients: Client[];
        warehouses: Warehouse[];
        cashBoxes: CashBox[];
        branches?: Branch[];
        employees?: Employee[];
        accounts?: Account[];
        categories?: Category[];
        users?: AppUser[];
        agents?: Agent[];
    };
    labels: LabelSettings;
}

const ReportFilters: React.FC<Props> = ({ reportId, filters, setFilters, onApply, onBack, data }) => {
    const report = getReportById(reportId);
    const enabled = new Set<ReportFilterKey>(report?.filters || []);
    const show = (key: ReportFilterKey) => enabled.has(key);

    const update = (key: keyof ReportFilterState, val: any) => {
        setFilters((prev) => ({ ...prev, [key]: val }));
    };

    const availableWarehouses = useMemo(
        () => data.warehouses.filter((w) => filters.selectedBranchId === 'all' || w.branchId === filters.selectedBranchId),
        [data.warehouses, filters.selectedBranchId]
    );

    const categoryOptions = useMemo(() => {
        if (data.categories?.length) return data.categories;
        const map = new Map<string, Category>();
        data.inventory.forEach((item) => {
            const categoryId = item.categoryId || '';
            if (!categoryId) return;
            if (!map.has(categoryId)) {
                map.set(categoryId, { id: categoryId, name: categoryId });
            }
        });
        return Array.from(map.values());
    }, [data.categories, data.inventory]);

    const users = data.users || [];
    const delegates = users.filter((u) => String(u.role || '').toLowerCase() === 'agent');
    const agentOptions = (data.agents && data.agents.length > 0)
        ? data.agents.map((agent) => ({ id: agent.id, name: agent.name }))
        : delegates.map((u) => ({ id: u.id, name: u.name || u.username }));
    const isAgentActivityReport = reportId === 'agents_activity';

    const showDateRange = show('date_range');
    const showAsOfDate = show('as_of_date');

    return (
        <div className="mx-auto mb-6 max-w-6xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm animate-fadeIn" dir="rtl">
            <h3 className="mb-6 flex items-center gap-2 border-b pb-4 text-xl font-black text-gray-800">
                <Filter size={22} className="text-primary" /> معايير التقرير
            </h3>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {showDateRange && (
                    <>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 flex items-center gap-2"><Calendar size={14} /> من تاريخ</label>
                            <input
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => update('dateFrom', e.target.value)}
                                className="w-full rounded-xl border border-gray-300 px-3 py-2.5"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500">إلى تاريخ</label>
                            <input
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => update('dateTo', e.target.value)}
                                className="w-full rounded-xl border border-gray-300 px-3 py-2.5"
                            />
                        </div>
                    </>
                )}

                {showAsOfDate && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">حتى تاريخ</label>
                        <input
                            type="date"
                            value={filters.dateTo}
                            onChange={(e) => update('dateTo', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5"
                        />
                    </div>
                )}

                {show('branch') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-2"><Building2 size={14} /> الفرع</label>
                        <select
                            value={filters.selectedBranchId}
                            onChange={(e) => update('selectedBranchId', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="all">كل الفروع</option>
                            {(data.branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                )}

                {show('warehouse') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-2"><WarehouseIcon size={14} /> المستودع</label>
                        <select
                            value={filters.selectedWarehouseId}
                            onChange={(e) => update('selectedWarehouseId', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="all">كل المستودعات</option>
                            {availableWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                    </div>
                )}

                {show('party_type') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">نوع الطرف</label>
                        <select
                            value={filters.partyType || 'all'}
                            onChange={(e) => update('partyType', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="all">الكل</option>
                            <option value="CUSTOMER">عميل</option>
                            <option value="SUPPLIER">مورد</option>
                        </select>
                    </div>
                )}

                {show('party') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-2"><User size={14} /> الطرف</label>
                        <select
                            value={filters.selectedPartyId}
                            onChange={(e) => {
                                update('selectedPartyId', e.target.value);
                                update('selectedEntityId', e.target.value);
                            }}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">كل الأطراف</option>
                            {data.clients
                                .filter((c) => (filters.partyType || 'all') === 'all' || c.type === filters.partyType || c.type === 'BOTH')
                                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}

                {show('item') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-2"><Package size={14} /> المادة</label>
                        <select
                            value={filters.selectedItemId}
                            onChange={(e) => {
                                update('selectedItemId', e.target.value);
                                update('selectedEntityId', e.target.value);
                            }}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">كل المواد</option>
                            {data.inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
                        </select>
                    </div>
                )}

                {show('category') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">التصنيف</label>
                        <select
                            value={filters.selectedCategoryId}
                            onChange={(e) => update('selectedCategoryId', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">كل التصنيفات</option>
                            {categoryOptions.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                        </select>
                    </div>
                )}

                {show('user') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">المستخدم / البائع</label>
                        <select
                            value={filters.selectedUserId}
                            onChange={(e) => update('selectedUserId', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">كل المستخدمين</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
                        </select>
                    </div>
                )}

                {show('delegate') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">المندوب</label>
                        <select
                            value={filters.selectedDelegateId}
                            onChange={(e) => update('selectedDelegateId', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">كل المندوبين</option>
                            {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                        </select>
                    </div>
                )}

                {show('cashbox') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">الصندوق</label>
                        <select
                            value={filters.selectedCashboxId}
                            onChange={(e) => {
                                update('selectedCashboxId', e.target.value);
                                update('selectedEntityId', e.target.value);
                            }}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">كل الصناديق</option>
                            {data.cashBoxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
                        </select>
                    </div>
                )}

                {show('account') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">الحساب</label>
                        <select
                            value={filters.selectedAccountId}
                            onChange={(e) => {
                                update('selectedAccountId', e.target.value);
                                update('selectedEntityId', e.target.value);
                            }}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="">اختر الحساب</option>
                            {(data.accounts || []).filter((a) => !a.isParent).map((a) => <option key={a.id} value={String(a.id)}>{a.code} - {a.nameAr}</option>)}
                        </select>
                    </div>
                )}

                {show('currency') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">العملة</label>
                        <select
                            value={filters.selectedCurrency || 'all'}
                            onChange={(e) => update('selectedCurrency', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="all">كل العملات</option>
                            <option value="SYP">SYP</option>
                            <option value="USD">USD</option>
                            <option value="TRY">TRY</option>
                        </select>
                    </div>
                )}

                {show('invoice_type') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">نوع الفاتورة</label>
                        <select
                            value={filters.invoiceType || 'all'}
                            onChange={(e) => update('invoiceType', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="all">الكل</option>
                            <option value="sale">مبيعات</option>
                            <option value="purchase">مشتريات</option>
                        </select>
                    </div>
                )}

                {show('status') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">الحالة</label>
                        <select
                            value={filters.reportStatus || 'all'}
                            onChange={(e) => update('reportStatus', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            {isAgentActivityReport ? (
                                <>
                                    <option value="all">كل الحالات</option>
                                    <option value="active">نشط</option>
                                    <option value="inactive">غير نشط</option>
                                    <option value="online">متصل</option>
                                    <option value="offline">غير متصل</option>
                                </>
                            ) : (
                                <>
                                    <option value="all">كل الحالات</option>
                                    <option value="open">مفتوحة</option>
                                    <option value="closed">مغلقة</option>
                                    <option value="DRAFT">مسودة</option>
                                    <option value="POSTED">مرحل</option>
                                </>
                            )}
                        </select>
                    </div>
                )}

                {show('movement_type') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">نوع الحركة</label>
                        <select
                            value={filters.movementType || 'all'}
                            onChange={(e) => update('movementType', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                        >
                            <option value="all">كل الحركات</option>
                            <option value="in">وارد</option>
                            <option value="out">صادر</option>
                        </select>
                    </div>
                )}

                {show('top_n') && (
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500">عدد النتائج (Top N)</label>
                        <input
                            type="number"
                            min={1}
                            max={100}
                            value={filters.topN || 20}
                            onChange={(e) => update('topN', Math.max(1, Math.min(100, Number(e.target.value || 20))))}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5"
                        />
                    </div>
                )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-4 android-sticky-actions">
                <button onClick={onBack} className="rounded-xl border border-gray-300 px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-50 transition tap-feedback">
                    رجوع
                </button>
                <button onClick={onApply} className="rounded-xl bg-primary px-6 py-2.5 font-black text-white hover:bg-teal-800 transition tap-feedback">
                    عرض التقرير
                </button>
            </div>
        </div>
    );
};

export default ReportFilters;
