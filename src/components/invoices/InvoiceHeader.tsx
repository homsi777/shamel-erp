
import React, { useState } from 'react';
import { ArrowUpCircle, ArrowDownCircle, RefreshCw, RotateCcw, Archive, Warehouse, FileDigit, Box, Coins, Banknote, FileText, Pencil, Check, X } from 'lucide-react';
import Combobox from '../Combobox';
import { Warehouse as WarehouseType, Client, Partner, LabelSettings, CurrencyRates, DEFAULT_CURRENCY_RATES } from '../../types';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';

interface InvoiceHeaderProps {
  activeMode: string;
  invoiceType: 'sale' | 'purchase' | 'opening_stock';
  setInvoiceType: (type: 'sale' | 'purchase' | 'opening_stock') => void;
  setCart: (cart: any[]) => void;
  canCreatePurchase: boolean;
  labels: LabelSettings;
  customInvoiceNumber: string;
  setCustomInvoiceNumber: (val: string) => void;
  invoiceDate: string;
  setInvoiceDate: (val: string) => void;
  selectedClientId: string;
  setSelectedClientId: (val: string) => void;
  clients: Client[];
  partners: Partner[];
  warehouses: WarehouseType[];
  selectedWarehouseId: string;
  setSelectedWarehouseId: (val: string) => void;
  originalInvoiceNumber: string;
  setOriginalInvoiceNumber: (val: string) => void;
  openingStockType?: 'inventory' | 'financial';
  setOpeningStockType?: (type: 'inventory' | 'financial') => void;
  currency: 'USD' | 'TRY' | 'SYP';
  setCurrency: (val: 'USD' | 'TRY' | 'SYP') => void;
  notes: string;
  setNotes: (val: string) => void;
  currencyRates?: CurrencyRates;
  onRateChange?: (currency: string, newRate: number) => void;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', TRY: '₺', SYP: 'ل.س' };

const InvoiceHeader: React.FC<InvoiceHeaderProps> = ({
  activeMode, invoiceType, setInvoiceType, setCart, canCreatePurchase, labels,
  customInvoiceNumber, setCustomInvoiceNumber, invoiceDate, setInvoiceDate,
  selectedClientId, setSelectedClientId, clients, partners, warehouses,
  selectedWarehouseId, setSelectedWarehouseId, originalInvoiceNumber, setOriginalInvoiceNumber,
  openingStockType, setOpeningStockType,
  currency, setCurrency, notes, setNotes, currencyRates, onRateChange
}) => {
  const layout = useResponsiveLayout();
  const isFinancial = activeMode === 'opening_stock' && openingStockType === 'financial';
  const rates = currencyRates || DEFAULT_CURRENCY_RATES;
  const currentRate = currency === 'USD' ? 1 : Number(rates[currency] || 1);
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const normalizePartyType = (raw: any) => String(raw || '').trim().toUpperCase();
  const invoicePartyType = invoiceType === 'sale' ? 'CUSTOMER' : 'SUPPLIER';
  const filteredPartyItems = clients.filter((c) => {
    const t = normalizePartyType((c as any).type);
    if (t === 'BOTH') return true;
    if (invoicePartyType === 'CUSTOMER') return t === 'CUSTOMER' || t === 'CLIENT';
    return t === 'SUPPLIER' || t === 'VENDOR';
  });
  const partyItemsSource = filteredPartyItems.length > 0 ? filteredPartyItems : clients;
  const modeButtonClass = 'min-h-[44px] flex-1 rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-center gap-2 transition tap-feedback';
  const inputHeightClass = layout.isMobile ? 'min-h-[44px]' : '';

  return (
    <div className={`rounded-2xl border-t-4 bg-white p-4 shadow sm:p-5 lg:p-6 ${activeMode === 'exchange' ? 'border-blue-600' : activeMode === 'return' ? 'border-red-600' : 'border-gray-800'}`}>
      
      {/* Top Bar: Mode Switchers */}
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        
        {activeMode === 'invoice' && (
            <div className="grid w-full gap-2 rounded-2xl bg-gray-100 p-2 sm:grid-cols-2 xl:w-auto xl:min-w-[19rem]">
                <button onClick={() => { setInvoiceType('sale'); setCart([]); }} className={`${modeButtonClass} ${invoiceType === 'sale' ? 'bg-white shadow text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><ArrowUpCircle size={16} /> {labels.invoice.sale_type}</button>
                {canCreatePurchase && <button onClick={() => { setInvoiceType('purchase'); setCart([]); }} className={`${modeButtonClass} ${invoiceType === 'purchase' ? 'bg-white shadow text-yellow-700' : 'text-gray-500 hover:text-gray-700'}`}><ArrowDownCircle size={16} /> {labels.invoice.purchase_type}</button>}
            </div>
        )}

        {activeMode === 'return' && (
            <div className="grid w-full gap-2 rounded-2xl border border-red-100 bg-red-50 p-2 sm:grid-cols-2 xl:w-auto xl:min-w-[21rem]">
                <button onClick={() => { setInvoiceType('sale'); setCart([]); }} className={`${modeButtonClass} ${invoiceType === 'sale' ? 'bg-white shadow text-red-700' : 'text-red-400 hover:text-red-600'}`}><RotateCcw size={16} /> مرتجع مبيعات</button>
                {canCreatePurchase && <button onClick={() => { setInvoiceType('purchase'); setCart([]); }} className={`${modeButtonClass} ${invoiceType === 'purchase' ? 'bg-white shadow text-orange-700' : 'text-orange-400 hover:text-orange-600'}`}><RotateCcw size={16} /> مرتجع مشتريات</button>}
            </div>
        )}

        {activeMode === 'exchange' && (
            <div className="grid w-full gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-2 sm:grid-cols-2 xl:w-auto xl:min-w-[21rem]">
                <button onClick={() => { setInvoiceType('sale'); setCart([]); }} className={`${modeButtonClass} ${invoiceType === 'sale' ? 'bg-white shadow text-blue-700' : 'text-blue-400 hover:text-blue-600'}`}><RefreshCw size={16} /> تبديل مبيعات</button>
                {canCreatePurchase && <button onClick={() => { setInvoiceType('purchase'); setCart([]); }} className={`${modeButtonClass} ${invoiceType === 'purchase' ? 'bg-white shadow text-indigo-700' : 'text-indigo-400 hover:text-indigo-600'}`}><RefreshCw size={16} /> تبديل مشتريات</button>}
            </div>
        )}

        {activeMode !== 'invoice' && (
            <div className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-center font-bold text-white shadow-sm xl:w-auto ${activeMode === 'opening_stock' ? 'bg-indigo-600' : 'bg-gray-700'}`}>
                {activeMode === 'exchange' ? <RefreshCw size={16}/> : activeMode === 'return' ? <RotateCcw size={16}/> : <Archive size={16}/>}
                {activeMode === 'exchange' ? 'نظام التبديل' : activeMode === 'return' ? 'نظام المرتجعات' : 'إدخال رصيد أول المدة'}
            </div>
        )}

        {activeMode === 'opening_stock' && setOpeningStockType && (
            <div className="grid w-full gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 p-2 sm:grid-cols-2 xl:w-auto xl:min-w-[19rem]">
                <button onClick={() => setOpeningStockType('inventory')} className={`${modeButtonClass} ${openingStockType === 'inventory' ? 'bg-white shadow text-indigo-700' : 'text-indigo-400 hover:text-indigo-600'}`}><Box size={16} /> بضاعة (مخزون)</button>
                <button onClick={() => setOpeningStockType('financial')} className={`${modeButtonClass} ${openingStockType === 'financial' ? 'bg-white shadow text-indigo-700' : 'text-indigo-400 hover:text-indigo-600'}`}><Coins size={16} /> ذمم مالية</button>
            </div>
        )}
      </div>

      {/* Input Fields Grid */}
      <div className={`grid grid-cols-1 gap-4 ${layout.isMobile ? '' : 'sm:grid-cols-2'} xl:grid-cols-12 items-end`}>
        
        {!isFinancial && (
            <>
                <div className="xl:col-span-3"><label className="mb-1 block text-xs font-bold text-gray-500">رقم الفاتورة</label><input type="text" value={customInvoiceNumber} onChange={e => setCustomInvoiceNumber(e.target.value)} className={`w-full rounded-xl border bg-gray-50 p-3 text-center font-numeric text-lg font-bold sm:text-xl ${inputHeightClass}`.trim()} placeholder="AUTO" /></div>
                <div className="xl:col-span-3"><label className="mb-1 block text-xs font-bold text-gray-500">{labels.general.date}</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={`w-full rounded-xl border bg-white p-3 font-numeric ${inputHeightClass}`.trim()} /></div>
                
                {/* CURRENCY SELECTOR */}
                <div className="xl:col-span-3">
                    <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500"><Banknote size={12}/> عملة الدفع</label>
                    <select 
                      value={currency} 
                      onChange={e => setCurrency(e.target.value as any)} 
                      className={`w-full rounded-xl border-2 p-3 font-bold outline-none focus:ring-2 focus:ring-blue-400 ${inputHeightClass} ${currency !== 'USD' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-blue-100 bg-blue-50 text-blue-800'}`.trim()}
                    >
                        <option value="USD">دولار ($)</option>
                        <option value="TRY">ليرة تركية (₺)</option>
                        <option value="SYP">ليرة سورية (ل.س)</option>
                    </select>
                    {currency !== 'USD' && (
                        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                            {editingRate ? (
                                <>
                                    <span>1$ =</span>
                                    <input
                                        type="number"
                                        autoFocus
                                        value={rateInput}
                                        onChange={e => setRateInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { const v = Number(rateInput); if (v > 0 && onRateChange) { onRateChange(currency, v); } setEditingRate(false); } if (e.key === 'Escape') setEditingRate(false); }}
                                        className="w-24 border border-amber-400 rounded px-1.5 py-0.5 text-center font-numeric font-bold bg-white text-amber-900 outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                                    />
                                    <span>{CURRENCY_SYMBOLS[currency]}</span>
                                    <button onClick={() => { const v = Number(rateInput); if (v > 0 && onRateChange) { onRateChange(currency, v); } setEditingRate(false); }} className="p-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200"><Check size={10}/></button>
                                    <button onClick={() => setEditingRate(false)} className="p-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200"><X size={10}/></button>
                                </>
                            ) : (
                                <>
                                    <span>سعر الصرف:</span>
                                    <span className="font-numeric">1$ = {currentRate.toLocaleString()} {CURRENCY_SYMBOLS[currency]}</span>
                                    {onRateChange && (
                                        <button
                                            onClick={() => { setRateInput(String(currentRate)); setEditingRate(true); }}
                                            className="p-0.5 bg-amber-200 text-amber-800 rounded hover:bg-amber-300 mr-1"
                                            title="تعديل سعر الصرف"
                                        >
                                            <Pencil size={10}/>
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="xl:col-span-3">
                   <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500"><FileText size={12}/> ملاحظات الفاتورة</label>
                   <input 
                     type="text" 
                     value={notes} 
                     onChange={e => setNotes(e.target.value)} 
                     className={`w-full rounded-xl border bg-white p-3 outline-none focus:ring-2 focus:ring-primary ${inputHeightClass}`.trim()} 
                     placeholder="اكتب ملاحظاتك هنا..."
                   />
                </div>

                <div className="xl:col-span-6"><label className="mb-1 block text-xs font-bold text-gray-500">{activeMode === 'opening_stock' ? 'الشريك / المالك' : invoiceType === 'sale' ? labels.general.client : labels.general.supplier}</label>
                {activeMode === 'opening_stock' ? (
                    <Combobox items={partners.map(p => ({ id: p.id, label: p.name, subLabel: `${p.percentage}%` }))} selectedId={selectedClientId} onSelect={(id) => setSelectedClientId(id)} placeholder="تحديد الشريك (اختياري)..." />
                ) : (
                    <Combobox items={partyItemsSource.map(c => ({ id: c.id, label: c.name, subLabel: c.phone }))} selectedId={selectedClientId} onSelect={(id) => setSelectedClientId(id)} placeholder="بحث عن اسم العميل/المورد..." showAllOnFocus />
                )}
                </div>

                <div className="xl:col-span-3"><label className="mb-1 block text-xs font-bold text-gray-500"><Warehouse size={12}/> إدخال للمستودع</label><select value={selectedWarehouseId} onChange={e => setSelectedWarehouseId(e.target.value)} className={`w-full rounded-xl border border-yellow-200 bg-yellow-50 p-3 font-bold text-yellow-800 ${inputHeightClass}`.trim()}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
                
                {(invoiceType === 'purchase' || activeMode === 'return' || activeMode === 'exchange') && (
                  <div className="xl:col-span-3"><label className="mb-1 block text-xs font-bold text-gray-500"><FileDigit size={12}/> {activeMode === 'return' || activeMode === 'exchange' ? 'رقم الفاتورة الأصلية' : 'رقم فاتورة المصدر'}</label><input type="text" value={originalInvoiceNumber} onChange={e => setOriginalInvoiceNumber(e.target.value)} className={`w-full rounded-xl border-2 p-3 text-center font-numeric font-bold ${inputHeightClass} ${activeMode === 'return' ? 'border-red-200 bg-red-50 text-red-800' : activeMode === 'exchange' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-gray-100 bg-gray-50'} focus:bg-white`.trim()} placeholder="رقم الفاتورة المرجعية" /></div>
                )}
            </>
        )}
      </div>
    </div>
  );
};

export default InvoiceHeader;
