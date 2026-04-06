import React, { useEffect, useMemo, useState } from 'react';
import { ResponsivePage } from '../../components/responsive';
import ReportHeader from '../../components/reports/ReportHeader';
import ReportFilters from '../../components/reports/ReportFilters';
import ReportResults from '../../components/reports/ReportResults';
import { useReports } from '../../hooks/useReports';
import { extractAccountsFromResponse } from '../../lib/accounts-response';
import { apiRequest } from '../../lib/api';
import { getReportsByCategory, getCategoryById } from '../../modules/reports/report.definitions';
import type {
  Branch,
  Partner,
  PartnerTransaction,
  CashBox,
  Category,
  Employee,
  Invoice,
  Account,
  InventoryItem,
  SalaryTransaction,
  Voucher,
  AppUser,
  AppSettings,
  Warehouse,
} from '../../types';
import { FileText } from 'lucide-react';

const RestaurantReports: React.FC<{
  inventory: InventoryItem[];
  invoices: Invoice[];
  clients: any[];
  warehouses: Warehouse[];
  cashBoxes: CashBox[];
  vouchers: Voucher[];
  settings?: AppSettings;
  currentUser?: AppUser;
  setActiveTab?: (tab: string) => void;
}> = ({ inventory, invoices, clients, warehouses, cashBoxes, vouchers, settings, setActiveTab }) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerTransactions, setPartnerTransactions] = useState<PartnerTransaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryTransactions, setSalaryTransactions] = useState<SalaryTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partyTransactions, setPartyTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);

  useEffect(() => {
    Promise.all([
      apiRequest('branches').catch(() => []),
      apiRequest('partners').catch(() => []),
      apiRequest('partner-transactions').catch(() => []),
      apiRequest('employees').catch(() => []),
      apiRequest('payroll/transactions').catch(() => []),
      apiRequest('inventory/transfers').catch(() => []),
      apiRequest('accounts').catch(() => []),
      apiRequest('party-transactions').catch(() => []),
      apiRequest('categories').catch(() => []),
      apiRequest('users').catch(() => []),
    ]).then(([b, p, pt, emp, sal, st, acc, partyTx, cats, usersList]) => {
      setBranches(b);
      setPartners(p);
      setPartnerTransactions(pt);
      setEmployees(emp);
      setSalaryTransactions(sal);
      setAccounts(extractAccountsFromResponse(acc));
      setPartyTransactions(partyTx);
      setCategories(cats);
      setUsers(usersList);
    });
  }, []);

  const dataContext = {
    inventory,
    invoices,
    clients,
    warehouses,
    cashBoxes,
    vouchers,
    branches,
    partners,
    partnerTransactions,
    employees,
    salaryTransactions,
    stockTransfers: [],
    accounts,
    partyTransactions,
    categories,
    users,
  };

  const labels = settings?.labels || ({} as any);

  const { state, setters, actions } = useReports(dataContext, settings);

  const restaurantReports = useMemo(() => getReportsByCategory('restaurant' as any), []);
  const restaurantCategory = useMemo(() => getCategoryById('restaurant' as any), []);

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="py-3 md:py-6">
      {!state.selectedReportId ? (
        <div className="animate-fadeIn" dir="rtl">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
              <FileText className="text-orange-600" /> تقارير المطعم
            </h1>
            <p className="text-sm text-gray-500 mt-2">{restaurantCategory?.description || 'تقارير تشغيلية خاصة بالمطعم.'}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {restaurantReports.map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                <button type="button" className="w-full text-right" onClick={() => setters.setSelectedReportId(r.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-gray-800">{r.name}</div>
                      <div className="mt-1 text-xs text-gray-500 line-clamp-2">{r.description}</div>
                      <div className="mt-3 flex items-center gap-2">
                        {React.cloneElement(r.icon as any, { size: 18 })}
                        <span className="text-[11px] font-bold text-gray-600">تشغيل</span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="animate-fadeIn">
          <ReportHeader
            reportId={state.selectedReportId}
            showResult={state.showResult}
            dateFrom={state.filters.dateFrom}
            dateTo={state.filters.dateTo}
            onBack={actions.handleBack}
            onPrint={actions.handlePrint}
            onExcel={actions.handleExcel}
            onPDF={actions.handlePDF}
            isExporting={state.isExporting}
            canPrint={state.reportRuntime?.printReady !== false}
            canExcel={state.reportRuntime?.excelReady !== false}
            canPDF={state.reportRuntime?.pdfReady !== false}
            disableReason={state.reportRuntime?.exportBlockReason || ''}
            labels={labels}
          />

          {!state.showResult && (
            <ReportFilters
              reportId={state.selectedReportId}
              filters={state.filters}
              setFilters={setters.setFilters}
              onApply={actions.handleApply}
              onBack={actions.handleBack}
              onSearchContainer={actions.handleSearchContainer}
              data={dataContext}
              labels={labels}
            />
          )}

          {state.showResult && (
            <ReportResults
              data={state.reportData}
              searchQuery={state.filters.reportSearchQuery}
              onSearchChange={(val) => setters.setFilters((prev) => ({ ...prev, reportSearchQuery: val }))}
              settings={settings}
              reportId={state.selectedReportId || undefined}
              allowPrint={state.reportRuntime?.printReady !== false}
              printBlockReason={state.reportRuntime?.exportBlockReason || ''}
            />
          )}
        </div>
      )}
    </ResponsivePage>
  );
};

export default RestaurantReports;

