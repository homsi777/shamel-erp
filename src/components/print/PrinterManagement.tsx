/**
 * Printer Management Screen
 * Register, edit, delete, and test physical printers.
 */
import React, { useState, useEffect } from 'react';
import { Printer, Plus, Trash2, Edit3, CheckCircle2, AlertCircle, Wifi, Bluetooth, Usb, Monitor, RefreshCw } from 'lucide-react';
import { fetchPrinters, savePrinter } from '../../lib/printEngine';

interface PrinterRow {
  id: string;
  name: string;
  type: string;
  connectionType: string;
  address?: string;
  paperSize: string;
  isDefault: boolean;
  isActive: boolean;
  codepage: string;
  documentTypes?: string;
  notes?: string;
}

const EMPTY_FORM: Omit<PrinterRow, 'id'> = {
  name: '', type: 'standard', connectionType: 'windows',
  address: '', paperSize: 'A4', isDefault: false, isActive: true,
  codepage: 'UTF8', documentTypes: '', notes: '',
};

const connectionIcon: Record<string, React.ReactNode> = {
  usb:       <Usb       size={14} className="text-blue-500" />,
  bluetooth: <Bluetooth size={14} className="text-indigo-500" />,
  network:   <Wifi      size={14} className="text-green-500" />,
  windows:   <Monitor   size={14} className="text-gray-500" />,
};

interface Props { companyId?: string; }

const PrinterManagement: React.FC<Props> = ({ companyId }) => {
  const [printers, setPrinters]   = useState<PrinterRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<string | null>(null);
  const [form, setForm]           = useState<Omit<PrinterRow, 'id'>>(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchPrinters(companyId);
    setPrinters(data as PrinterRow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [companyId]);

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); setMsg(null); };
  const openEdit = (p: PrinterRow) => {
    setEditing(p.id);
    setForm({ name: p.name, type: p.type, connectionType: p.connectionType, address: p.address ?? '', paperSize: p.paperSize, isDefault: p.isDefault, isActive: p.isActive, codepage: p.codepage, documentTypes: p.documentTypes ?? '', notes: p.notes ?? '' });
    setShowForm(true);
    setMsg(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setMsg({ type: 'err', text: 'اسم الطابعة مطلوب' }); return; }
    setSaving(true);
    const payload = editing ? { ...form, id: editing, companyId } : { ...form, companyId };
    const result = await savePrinter(payload as any);
    setSaving(false);
    if (result) {
      setMsg({ type: 'ok', text: editing ? 'تم تحديث الطابعة' : 'تم إضافة الطابعة' });
      setShowForm(false);
      void load();
    } else {
      setMsg({ type: 'err', text: 'فشل حفظ الطابعة' });
    }
  };

  const f = (field: keyof Omit<PrinterRow, 'id'>, value: unknown) => setForm(p => ({ ...p, [field]: value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Printer size={20} /> إدارة الطابعات</h3>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-1 rounded"><RefreshCw size={14}/> تحديث</button>
          <button onClick={openNew} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors">
            <Plus size={16}/> طابعة جديدة
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-6 text-gray-400">جار التحميل...</div>}

      {!loading && printers.length === 0 && (
        <div className="text-center py-10 text-gray-400 border-2 border-dashed rounded-xl">
          <Printer size={40} className="mx-auto mb-2 opacity-30"/>
          <p>لا توجد طابعات مسجّلة</p>
          <button onClick={openNew} className="mt-3 text-blue-600 text-sm underline">أضف طابعة</button>
        </div>
      )}

      {!loading && printers.length > 0 && (
        <div className="grid gap-3">
          {printers.map(p => (
            <div key={p.id} className={`flex items-center justify-between p-4 rounded-xl border ${p.isDefault ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'} shadow-sm`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.type === 'thermal' ? 'bg-orange-100' : 'bg-gray-100'}`}>
                  <Printer size={20} className={p.type === 'thermal' ? 'text-orange-600' : 'text-gray-600'}/>
                </div>
                <div>
                  <div className="font-bold text-gray-800 flex items-center gap-2">
                    {p.name}
                    {p.isDefault && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">افتراضي</span>}
                    {!p.isActive && <span className="text-xs bg-gray-400 text-white px-2 py-0.5 rounded-full">معطّل</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1">{connectionIcon[p.connectionType] ?? null} {p.connectionType}</span>
                    <span>ورق: {p.paperSize}</span>
                    {p.address && <span className="font-mono">{p.address}</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(p)} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit3 size={16}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h4 className="text-lg font-bold">{editing ? 'تعديل طابعة' : 'إضافة طابعة جديدة'}</h4>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {msg && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {msg.type === 'ok' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>} {msg.text}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">اسم الطابعة *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="مثال: طابعة الكاشير الرئيسية"/>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">النوع</label>
                  <select value={form.type} onChange={e => f('type', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="standard">عادية (A4/A5)</option>
                    <option value="thermal">حرارية (Thermal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">طريقة الاتصال</label>
                  <select value={form.connectionType} onChange={e => f('connectionType', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="windows">ويندوز (Windows)</option>
                    <option value="network">شبكة (Network/IP)</option>
                    <option value="bluetooth">بلوتوث</option>
                    <option value="usb">USB</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">حجم الورق</label>
                  <select value={form.paperSize} onChange={e => f('paperSize', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                    <option value="80mm">80mm (حرارية)</option>
                    <option value="58mm">58mm (حرارية)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">ترميز العربية</label>
                  <select value={form.codepage} onChange={e => f('codepage', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="UTF8">UTF-8 (موصى به)</option>
                    <option value="CP1256">CP1256 (ويندوز)</option>
                    <option value="PC864">PC864 (قديم)</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {form.connectionType === 'network' ? 'عنوان IP' : form.connectionType === 'bluetooth' ? 'عنوان MAC' : 'اسم الطابعة في النظام'}
                  </label>
                  <input value={form.address} onChange={e => f('address', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder={form.connectionType === 'network' ? '192.168.1.100' : form.connectionType === 'bluetooth' ? 'AA:BB:CC:DD:EE:FF' : ''}/>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">أنواع المستندات</label>
                  <input value={form.documentTypes} onChange={e => f('documentTypes', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="pos_receipt,sale_invoice (مفصولة بفاصلة)"/>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e => f('isDefault', e.target.checked)} className="w-4 h-4"/>
                  <label htmlFor="isDefault" className="text-sm font-semibold text-gray-700">طابعة افتراضية</label>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => f('isActive', e.target.checked)} className="w-4 h-4"/>
                  <label htmlFor="isActive" className="text-sm font-semibold text-gray-700">نشطة</label>
                </div>
              </div>
            </div>
            <div className="p-6 border-t flex gap-3 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">إلغاء</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'جار الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrinterManagement;
