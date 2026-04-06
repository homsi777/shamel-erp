
import React, { useState, useEffect } from 'react';
import { InventoryItem, Invoice, Client, Warehouse, CashBox, Voucher, AppSettings, DEFAULT_LABELS, Branch, Partner, PartnerTransaction, Employee, SalaryTransaction, Account, Category, AppUser, Agent } from '../types';
import ReportSelectionGrid from '../components/reports/ReportSelectionGrid';
import ReportFilters from '../components/reports/ReportFilters';
import ReportHeader from '../components/reports/ReportHeader';
import ReportResults from '../components/reports/ReportResults';
import { ResponsivePage } from '../components/responsive';
import { useReports } from '../hooks/useReports';
import { apiRequest } from '../lib/api';
import { extractAccountsFromResponse } from '../lib/accounts-response';

interface ReportsProps {
  inventory: InventoryItem[];
  invoices: Invoice[];
  clients: Client[];
  warehouses: Warehouse[];
  cashBoxes: CashBox[];
  vouchers: Voucher[];
  settings?: AppSettings;
  setActiveTab?: (tab: string) => void;
}

const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent('shamel-alert', { detail: { message } }));
};

const Reports: React.FC<ReportsProps> = ({ inventory, invoices, clients, warehouses, cashBoxes, vouchers, settings, setActiveTab }) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerTransactions, setPartnerTransactions] = useState<PartnerTransaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryTransactions, setSalaryTransactions] = useState<SalaryTransaction[]>([]);
  const [stockTransfers, setStockTransfers] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partyTransactions, setPartyTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  
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
        apiRequest('agents').catch(() => [])
    ]).then(([b, p, pt, emp, sal, st, acc, partyTx, cats, usersList, agentsList]) => {
        setBranches(b);
        setPartners(p);
        setPartnerTransactions(pt);
        setEmployees(emp);
        setSalaryTransactions(sal);
        setStockTransfers(st);
        setAccounts(extractAccountsFromResponse(acc));
        setPartyTransactions(partyTx);
        setCategories(cats);
        setUsers(usersList);
        setAgents(agentsList);
    });
  }, []);

  const dataContext = { 
    inventory, invoices, clients, warehouses, cashBoxes, vouchers, branches, partners, partnerTransactions,
    employees, salaryTransactions, stockTransfers, accounts, partyTransactions, categories, users, agents
  };
  const labels = settings?.labels || DEFAULT_LABELS;
  
  const { state, setters, actions } = useReports(dataContext, settings);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shamel_report_prefill');
      if (raw) {
        const pref = JSON.parse(raw);
        if (pref?.reportId === 'employee_payroll') {
          setters.setSelectedReportId('employee_payroll');
          setters.setFilters(prev => ({ ...prev, selectedEntityId: pref.entityId || '' }));
          actions.handleApply();
        }
        localStorage.removeItem('shamel_report_prefill');
      }
    } catch {}
  }, []);

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="py-3 md:py-6">
      {!state.selectedReportId ? (
        <ReportSelectionGrid onSelect={setters.setSelectedReportId} labels={labels} />
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
                onSearchChange={(val) => setters.setFilters(prev => ({...prev, reportSearchQuery: val}))}
                settings={settings}
                reportId={state.selectedReportId || undefined}
                allowPrint={state.reportRuntime?.printReady !== false}
                printBlockReason={state.reportRuntime?.exportBlockReason || ''}
                onNavigateToRecord={setActiveTab ? async (referenceType: string, referenceId: string) => {
                  try {
                    if (referenceType === 'invoice') {
                      await apiRequest(`invoices/${referenceId}`);
                      try { localStorage.setItem('shamel_invoice_view_prefill', JSON.stringify({ id: referenceId })); } catch {}
                      setActiveTab('invoices');
                      return;
                    }
                    if (referenceType === 'consignment') {
                      await apiRequest(`consignments/${referenceId}`);
                      try { localStorage.setItem('shamel_consignment_drill', JSON.stringify({ tab: 'customers', id: referenceId })); } catch {}
                      setActiveTab('consignments');
                      return;
                    }
                    if (referenceType === 'settlement') {
                      await apiRequest(`consignment-settlements/${referenceId}`);
                      try { localStorage.setItem('shamel_consignment_drill', JSON.stringify({ tab: 'settlements', id: referenceId })); } catch {}
                      setActiveTab('consignments');
                      return;
                    }
                    if (referenceType === 'voucher') {
                      await apiRequest(`vouchers/${referenceId}`);
                      setActiveTab('funds');
                      return;
                    }
                    if (referenceType === 'party') {
                      await apiRequest(`parties/${referenceId}`);
                      setActiveTab('clients');
                      return;
                    }
                  } catch (_e: any) {
                    showToast('السجل غير موجود أو تم حذفه. لا يمكن فتحه.');
                  }
                } : undefined}
             />
          )}
        </div>
      )}
    </ResponsivePage>
  );
};

export default Reports;
