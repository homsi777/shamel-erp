import React, { useMemo, useState } from 'react';
import { FileDigit, History, ScanBarcode, Archive, RotateCcw, Plus, Trash2, Coins } from 'lucide-react';
import { Invoice, Client, Partner, CashBox, Warehouse as WarehouseType, AppSettings, AppUser, PERMISSIONS, DEFAULT_LABELS, formatNumber, InventoryItem, Voucher, DEFAULT_CURRENCY_RATES } from '../types';
import { useInvoice } from '../hooks/useInvoice';
import { calculateGrandTotal } from '../modules/invoices/invoice.calculations';
import Combobox from '../components/Combobox';
import { apiRequest } from '../lib/api';
import { reprintInvoicePosThermal } from '../lib/printEngine';
import { confirmDialog } from '../lib/confirm';
import { BASE_CURRENCY, invoiceAmountBase } from '../lib/currencySemantics';
import { isTextileModeEnabled } from '../lib/textileMode';

// Components
import InvoiceHeader from '../components/invoices/InvoiceHeader';
import InvoicePOSEntry from '../components/invoices/InvoicePOSEntry';
import InvoiceCartTable from '../components/invoices/InvoiceCartTable';
import InvoiceSummary from '../components/invoices/InvoiceSummary';
import InvoiceHistory from '../components/invoices/InvoiceHistory';
import { InvoiceInquiryModal, InvoiceViewModal, InvoiceEditModal, InvoicePrintModal } from '../components/invoices/InvoiceModals';
import { AdaptiveTable, ResponsiveActionBar, ResponsivePage } from '../components/responsive';

interface InvoicesProps {
  inventory: InventoryItem[];
  invoices: Invoice[];
  clients: Client[];
  partners: Partner[];
  cashBoxes: CashBox[];
  warehouses: WarehouseType[];
  refreshData: () => Promise<void>;
  settings?: AppSettings;
}

const Invoices: React.FC<InvoicesProps> = ({ 
  inventory, invoices, clients, partners, warehouses, cashBoxes, refreshData, settings
}) => {
  const labels = useMemo(() => ({
    ...DEFAULT_LABELS,
    ...(settings?.labels || {}),
    general: { ...DEFAULT_LABELS.general, ...((settings?.labels as any)?.general || {}) },
    menu: { ...DEFAULT_LABELS.menu, ...((settings?.labels as any)?.menu || {}) },
    invoice: { ...DEFAULT_LABELS.invoice, ...((settings?.labels as any)?.invoice || {}) },
    inventory: { ...DEFAULT_LABELS.inventory, ...((settings?.labels as any)?.inventory || {}) },
    reports: { ...DEFAULT_LABELS.reports, ...((settings?.labels as any)?.reports || {}) },
    partners: { ...DEFAULT_LABELS.partners, ...((settings?.labels as any)?.partners || {}) },
    funds: { ...DEFAULT_LABELS.funds, ...((settings?.labels as any)?.funds || {}) },
  }), [settings?.labels]);
  const storedUser = localStorage.getItem('shamel_user');
  const currentUser: AppUser | null = storedUser ? JSON.parse(storedUser) : null;
  const canCreateSale = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.CREATE_SALE_INVOICE);
  const canCreatePurchase = currentUser?.role === 'admin' || currentUser?.permissions?.includes(PERMISSIONS.CREATE_PURCHASE_INVOICE);
  const textileModeEnabled = isTextileModeEnabled(settings);

  const [localRates, setLocalRates] = useState(settings?.currencyRates || DEFAULT_CURRENCY_RATES);
  const { state, setters, handlers } = useInvoice(inventory, invoices, clients, partners, cashBoxes, warehouses, refreshData, currentUser, settings?.defaultCurrency, localRates, textileModeEnabled);
  const [pdfInvoice, setPdfInvoice] = useState<Invoice | null>(null);

  const handleRateChange = async (cur: string, newRate: number) => {
    const updated = { ...localRates, [cur]: newRate };
    setLocalRates(updated);
    try { await apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'currencyRates', value: updated }) }); } catch {}
  };

  // Local state for Financial Entry form
  const [finEntry, setFinEntry] = useState({ clientId: '', amount: '', type: 'debit' as 'debit' | 'credit' });

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('shamel_invoice_view_prefill');
      if (!raw || invoices.length === 0) return;
      const payload = JSON.parse(raw);
      const invoiceId = String(payload?.id || '');
      if (!invoiceId) return;
      const target = invoices.find(inv => inv.id === invoiceId);
      if (!target) return;
      setters.setViewInvoice(target);
      localStorage.removeItem('shamel_invoice_view_prefill');
    } catch {}
  }, [invoices]);

  const handleAddFinancial = () => {
      if (!finEntry.clientId || !finEntry.amount) return;
      const client = clients.find(c => c.id === finEntry.clientId);
      if (client) {
          handlers.handleAddToFinancialCart({
              clientId: client.id,
              clientName: client.name,
              amount: parseFloat(finEntry.amount),
              type: finEntry.type
          });
          setFinEntry({ clientId: '', amount: '', type: 'debit' });
      }
  };

  const handleDeleteInvoice = async (inv: Invoice) => {
      if (!(await confirmDialog('حذف الفاتورة سيؤدي إلى عكس الرصيد والمخزون المرتبط بها. هل أنت متأكد؟'))) return;
      try {
          await apiRequest(`invoices/${inv.id}`, { method: 'DELETE' });
          await refreshData();
          setters.setStatusMsg({ type: 'success', text: 'تم حذف الفاتورة بنجاح' });
          setTimeout(() => setters.setStatusMsg(null), 3000);
      } catch (e: any) {
          setters.setStatusMsg({ type: 'error', text: e?.response?.data?.error || 'فشل حذف الفاتورة' });
      }
  };

  return (
    <ResponsivePage className="bg-gray-50 min-h-screen" contentClassName="py-4 md:py-6" maxWidth="wide">
    <div className="mx-auto">
      {/* Summary Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-gradient-to-br from-green-50 to-green-100 p-3 rounded-xl border border-green-200">
          <div className="text-[10px] font-bold text-green-600 uppercase">المبيعات</div>
          <div className="text-lg font-black text-green-800 font-numeric">{formatNumber(invoices.filter(i => i.type === 'sale').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</div>
          <div className="text-[10px] text-green-600">{invoices.filter(i => i.type === 'sale').length} فاتورة</div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-3 rounded-xl border border-blue-200">
          <div className="text-[10px] font-bold text-blue-600 uppercase">المشتريات</div>
          <div className="text-lg font-black text-blue-800 font-numeric">{formatNumber(invoices.filter(i => i.type === 'purchase').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</div>
          <div className="text-[10px] text-blue-600">{invoices.filter(i => i.type === 'purchase').length} فاتورة</div>
        </div>
        <div className="bg-gradient-to-br from-red-50 to-red-100 p-3 rounded-xl border border-red-200">
          <div className="text-[10px] font-bold text-red-600 uppercase">المرتجعات</div>
          <div className="text-lg font-black text-red-800 font-numeric">{formatNumber(invoices.filter(i => i.type === 'return' || i.type === 'exchange').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</div>
          <div className="text-[10px] text-red-600">{invoices.filter(i => i.type === 'return' || i.type === 'exchange').length} فاتورة</div>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-3 rounded-xl border border-purple-200">
          <div className="text-[10px] font-bold text-purple-600 uppercase">الإجمالي</div>
          <div className="text-lg font-black text-purple-800 font-numeric">{invoices.length}</div>
          <div className="text-[10px] text-purple-600">فواتير مسجلة</div>
        </div>
      </div>

      {/* Navigation */}
      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4 xl:grid-cols-5">
         {(canCreateSale || canCreatePurchase) && (
             <button onClick={() => setters.setActiveMode('invoice')} className={`min-h-[72px] p-3 rounded-xl shadow-sm border-2 flex flex-col items-center justify-center gap-2 transition tap-feedback ${state.activeMode === 'invoice' ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                <FileDigit size={20} /><span className="font-bold text-sm">{labels.invoice.new_invoice}</span>
             </button>
         )}
         
         <button onClick={() => setters.setActiveMode('returns_list')} className={`min-h-[72px] p-3 rounded-xl shadow-sm border-2 flex flex-col items-center justify-center gap-2 transition tap-feedback ${state.activeMode === 'returns_list' || state.activeMode === 'return' ? 'border-red-600 bg-red-600 text-white' : 'border-red-100 bg-white text-red-600 hover:bg-red-50'}`}>
            <RotateCcw size={20} /><span className="font-bold text-sm">المرتجعات</span>
         </button>
         
         <button onClick={() => setters.setActiveMode('history')} className={`min-h-[72px] p-3 rounded-xl shadow-sm border-2 flex flex-col items-center justify-center gap-2 transition tap-feedback ${state.activeMode === 'history' ? 'border-purple-600 bg-purple-600 text-white' : 'border-purple-100 bg-white text-purple-600 hover:bg-purple-50'}`}>
            <History size={20} /><span className="font-bold text-sm">السجل</span>
         </button>
         
         <button onClick={() => setters.setIsInquiryOpen(true)} className="min-h-[72px] p-3 rounded-xl shadow-sm border-2 flex flex-col items-center justify-center gap-2 transition tap-feedback border-teal-100 bg-white text-teal-600 hover:bg-teal-50">
            <ScanBarcode size={20} /><span className="font-bold text-sm">استعلام</span>
         </button>
      </div>

          {state.activeMode === 'history' ? (
          <InvoiceHistory invoices={invoices} setViewInvoice={setters.setViewInvoice} setPrintInvoice={setters.setPrintInvoice} setExportInvoice={setPdfInvoice} onRefresh={refreshData} onDelete={handleDeleteInvoice} />
          ) : state.activeMode === 'returns_list' ? (
          <div className="space-y-5 animate-fadeIn">
              {/* Header with stats */}
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-5 border-b bg-gradient-to-l from-red-50 to-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="text-xl font-black text-gray-800 flex items-center gap-2"><RotateCcw size={22} className="text-red-500" /> المرتجعات والتبديلات</h3>
                    <p className="text-xs text-gray-400 font-bold mt-1">إدارة مرتجعات المبيعات والمشتريات وعمليات التبديل</p>
                  </div>
                  <ResponsiveActionBar>
                    <button onClick={() => { setters.setInvoiceType('sale'); setters.setActiveMode('return'); }} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 shadow-sm transition active:scale-95">
                      <Plus size={16} /> مرتجع جديد
                    </button>
                    <button onClick={() => { setters.setInvoiceType('sale'); setters.setActiveMode('exchange'); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 shadow-sm transition active:scale-95">
                      <Plus size={16} /> تبديل جديد
                    </button>
                  </ResponsiveActionBar>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-x-reverse divide-gray-100">
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold text-red-500 uppercase">مرتجع مبيعات</p>
                    <p className="text-lg font-black text-gray-800 font-numeric">{invoices.filter(i => i.type === 'return' && i.returnType !== 'purchase').length}</p>
                    <p className="text-[10px] text-gray-400 font-numeric font-bold">{formatNumber(invoices.filter(i => i.type === 'return' && i.returnType !== 'purchase').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold text-orange-500 uppercase">مرتجع مشتريات</p>
                    <p className="text-lg font-black text-gray-800 font-numeric">{invoices.filter(i => i.type === 'return' && i.returnType === 'purchase').length}</p>
                    <p className="text-[10px] text-gray-400 font-numeric font-bold">{formatNumber(invoices.filter(i => i.type === 'return' && i.returnType === 'purchase').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold text-blue-500 uppercase">تبديل مبيعات</p>
                    <p className="text-lg font-black text-gray-800 font-numeric">{invoices.filter(i => i.type === 'exchange' && i.returnType !== 'purchase').length}</p>
                    <p className="text-[10px] text-gray-400 font-numeric font-bold">{formatNumber(invoices.filter(i => i.type === 'exchange' && i.returnType !== 'purchase').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold text-indigo-500 uppercase">تبديل مشتريات</p>
                    <p className="text-lg font-black text-gray-800 font-numeric">{invoices.filter(i => i.type === 'exchange' && i.returnType === 'purchase').length}</p>
                    <p className="text-[10px] text-gray-400 font-numeric font-bold">{formatNumber(invoices.filter(i => i.type === 'exchange' && i.returnType === 'purchase').reduce((s, i) => s + invoiceAmountBase(i, 'total'), 0))} {BASE_CURRENCY}</p>
                  </div>
                </div>
              </div>

              {/* History Table */}
              <InvoiceHistory 
                  invoices={invoices.filter(i => i.type === 'return' || i.type === 'exchange')} 
                  setViewInvoice={setters.setViewInvoice} 
                  setPrintInvoice={setters.setPrintInvoice} 
                  setExportInvoice={setPdfInvoice}
                  onRefresh={refreshData}
                  onDelete={handleDeleteInvoice}
              />
          </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 animate-fadeIn">
          
          {/* Main Content Area */}
          <div className="lg:col-span-3 space-y-4">
            
            <InvoiceHeader 
                activeMode={state.activeMode}
                invoiceType={state.invoiceType}
                setInvoiceType={setters.setInvoiceType}
                setCart={setters.setCart}
                canCreatePurchase={canCreatePurchase || false}
                labels={labels}
                customInvoiceNumber={state.customInvoiceNumber}
                setCustomInvoiceNumber={setters.setCustomInvoiceNumber}
                invoiceDate={state.invoiceDate}
                setInvoiceDate={setters.setInvoiceDate}
                selectedClientId={state.selectedClientId}
                setSelectedClientId={setters.setSelectedClientId}
                clients={clients}
                partners={partners}
                warehouses={warehouses}
                selectedWarehouseId={state.selectedWarehouseId}
                setSelectedWarehouseId={setters.setSelectedWarehouseId}
                originalInvoiceNumber={state.originalInvoiceNumber}
                setOriginalInvoiceNumber={setters.setOriginalInvoiceNumber}
                openingStockType={state.openingStockType}
                setOpeningStockType={setters.setOpeningStockType}
                currency={state.currency}
                setCurrency={setters.setCurrency}
                notes={state.notes}
                setNotes={setters.setNotes}
                currencyRates={localRates}
                onRateChange={handleRateChange}
            />

                        {state.activeMode === 'opening_stock' && state.openingStockType === 'financial' ? (
                <div className="animate-fadeIn space-y-4">
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-indigo-900"><Coins size={16}/> إضافة رصيد عميل / مورد سابق</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                            <div className="xl:col-span-5">
                                <label className="mb-1 block text-xs font-bold text-gray-500">العميل / المورد</label>
                                <Combobox items={clients.map(c => ({ id: c.id, label: c.name, subLabel: c.type === 'CUSTOMER' ? 'عميل' : 'مورد' }))} selectedId={finEntry.clientId} onSelect={(id) => setFinEntry({...finEntry, clientId: id})} placeholder="ابحث عن حساب..." />
                            </div>
                            <div className="xl:col-span-3">
                                <label className="mb-1 block text-xs font-bold text-gray-500">المبلغ ($)</label>
                                <input type="number" className="w-full rounded-xl border p-3 font-bold font-numeric" value={finEntry.amount} onChange={e => setFinEntry({...finEntry, amount: e.target.value})} onKeyDown={e => e.key === 'Enter' && handleAddFinancial()} />
                            </div>
                            <div className="xl:col-span-3">
                                <label className="mb-1 block text-xs font-bold text-gray-500">نوع الرصيد</label>
                                <select className="w-full rounded-xl border bg-white p-3 font-bold text-sm" value={finEntry.type} onChange={e => setFinEntry({...finEntry, type: e.target.value as any})}>
                                    <option value="debit">له عندنا (دائن)</option>
                                    <option value="credit">لنا عنده (مدين)</option>
                                </select>
                            </div>
                            <div className="xl:col-span-1">
                                <button onClick={handleAddFinancial} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-white shadow hover:bg-indigo-700"><Plus size={20} className="mx-auto"/></button>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl bg-white shadow">
                        <AdaptiveTable
                            rows={state.financialCart}
                            keyExtractor={(_, idx) => `financial-${idx}`}
                            emptyState={<div className="p-8 text-center text-gray-400">الذمم فارغة</div>}
                            columns={[
                                {
                                    id: 'client',
                                    header: 'الحساب',
                                    cell: (item) => <span className="font-bold">{item.clientName}</span>,
                                },
                                {
                                    id: 'amount',
                                    header: 'المبلغ',
                                    cell: (item) => <span className="font-numeric text-lg font-bold">{formatNumber(item.amount)} $</span>,
                                    tdClassName: 'text-center',
                                },
                                {
                                    id: 'type',
                                    header: 'الحالة',
                                    cell: (item) => (
                                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.type === 'debit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {item.type === 'debit' ? 'لنا عنده' : 'له عندنا'}
                                        </span>
                                    ),
                                    tdClassName: 'text-center',
                                },
                                {
                                    id: 'actions',
                                    header: 'حذف',
                                    cell: (_, idx) => (
                                        <button onClick={() => handlers.handleRemoveFromFinancialCart(idx)} className="text-red-500 hover:text-red-700">
                                            <Trash2 size={16}/>
                                        </button>
                                    ),
                                    tdClassName: 'text-center',
                                },
                            ]}
                            mobileCardRender={(item, idx) => (
                                <div className="space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="font-bold text-gray-900">{item.clientName}</div>
                                            <div className="mt-1 text-sm font-numeric text-gray-500">{formatNumber(item.amount)} $</div>
                                        </div>
                                        <button onClick={() => handlers.handleRemoveFromFinancialCart(idx)} className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100">
                                            <Trash2 size={16}/>
                                        </button>
                                    </div>
                                    <div>
                                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.type === 'debit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {item.type === 'debit' ? 'لنا عنده' : 'له عندنا'}
                                        </span>
                                    </div>
                                </div>
                            )}
                        />
                    </div>
                </div>
            ) : (
                <>
                    <InvoicePOSEntry 
                        entry={state.entry}
                        setEntry={setters.setEntry}
                        inventory={inventory}
                        handleItemSelect={handlers.handleItemSelect}
                        handleAddToCart={handlers.handleAddToCart}
                        selectedWarehouseId={state.selectedWarehouseId}
                        warehouses={warehouses}
                        invoiceType={state.activeMode === 'opening_stock' ? 'opening_stock' : state.invoiceType}
                        textileModeEnabled={textileModeEnabled}
                    />

                    <InvoiceCartTable 
                        cart={state.cart} 
                        setCart={setters.setCart} 
                        invoiceType={state.invoiceType}
                        purchaseCosts={state.purchaseCosts}
                    />
                </>
            )}
          </div>

          {/* Sidebar Summary */}
            <InvoiceSummary 
              cart={state.cart} 
              invoiceType={state.invoiceType}
              purchaseCosts={state.purchaseCosts} 
              setPurchaseCosts={setters.setPurchaseCosts} 
              showExpenses={state.showExpenses}
              setShowExpenses={setters.setShowExpenses}
              discount={state.discount}
              setDiscount={setters.setDiscount}
              activeMode={state.activeMode}
              paymentType={state.paymentType}
              setPaymentType={setters.setPaymentType}
              selectedCashBoxId={state.selectedCashBoxId}
              setSelectedCashBoxId={setters.setSelectedCashBoxId}
              cashBoxes={cashBoxes}
              paidSplit={state.paidSplit}
              setPaidSplit={setters.setPaidSplit}
              statusMsg={state.statusMsg}
              lastSavedInvoice={state.lastSavedInvoice}
              setPrintInvoice={setters.setPrintInvoice}
              handleCreateInvoice={handlers.handleCreateInvoice}
              isSubmitting={state.isSubmitting}
              calculateGrandTotal={() => calculateGrandTotal(state.cart, state.invoiceType, state.purchaseCosts, Number(state.discount || 0))}
              labels={labels}
              currency={state.currency}
              currencyRates={localRates}
            />
        </div>
      )}

      {/* MODALS */}
      <InvoiceInquiryModal 
          isOpen={state.isInquiryOpen}
          onClose={() => setters.setIsInquiryOpen(false)}
          inventory={inventory}
          onSelect={handlers.handleItemSelect}
      />

      <InvoiceViewModal 
          invoice={state.viewInvoice}
          onClose={() => setters.setViewInvoice(null)}
          onEdit={setters.setEditingInvoice}
          onReturn={handlers.handleReturnFromInvoice}
          onExchange={handlers.handleExchangeFromInvoice}
          onPrint={setters.setPrintInvoice}
          onDelete={handleDeleteInvoice}
          canCreatePurchase={canCreatePurchase || false}
          posThermalReprintEnabled={Boolean(settings?.print?.thermal?.enabled)}
          onPosThermalReprint={settings ? async (inv, mode) => {
            const r = await reprintInvoicePosThermal(inv, settings, mode);
            setters.setStatusMsg({ type: r.ok ? 'success' : 'error', text: r.message });
            setTimeout(() => setters.setStatusMsg(null), 5000);
            if (r.ok) await refreshData();
          } : undefined}
      />

      <InvoiceEditModal 
          invoice={state.editingInvoice}
          onClose={() => setters.setEditingInvoice(null)}
          clients={clients}
          inventory={inventory}
          refreshData={refreshData}
          setStatusMsg={setters.setStatusMsg}
      />

      {state.printInvoice && (
          <InvoicePrintModal 
              invoice={state.printInvoice}
              settings={settings}
              onClose={() => setters.setPrintInvoice(null)}
          />
      )}
      {pdfInvoice && (
          <InvoicePrintModal 
              invoice={pdfInvoice}
              settings={settings}
              onClose={() => setPdfInvoice(null)}
              autoExportPdf
          />
      )}
    </div>
    </ResponsivePage>
  );
};

export default Invoices;
