/**
 * Template Designer
 *
 * Visual editor for print templates with:
 *   - Section toggles (logo, address, QR, discount, footer, signature)
 *   - Custom text fields (header, footer)
 *   - Font size selector
 *   - Format selector
 *   - Live preview via backend /print/preview
 */
import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Eye, Save, Plus, ToggleLeft, ToggleRight, RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchTemplates, saveTemplate, previewDocument } from '../../lib/printEngine';

interface TemplateForm {
  id?: string;
  name: string;
  templateType: string;
  format: string;
  isDefault: boolean;
  showLogo: boolean;
  showCompanyName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showTaxNumber: boolean;
  showQrCode: boolean;
  showDiscount: boolean;
  showTaxBreakdown: boolean;
  showFooter: boolean;
  showSignatureLine: boolean;
  headerTitle: string;
  headerSubtitle: string;
  footerText: string;
  fontSize: 'sm' | 'md' | 'lg';
  templateHtml: string;
}

const EMPTY: TemplateForm = {
  name: '', templateType: 'sale_invoice', format: 'A4', isDefault: false,
  showLogo: true, showCompanyName: true, showAddress: true, showPhone: true,
  showTaxNumber: false, showQrCode: false, showDiscount: true, showTaxBreakdown: false,
  showFooter: true, showSignatureLine: false,
  headerTitle: '', headerSubtitle: '', footerText: 'شكراً لتعاملكم معنا',
  fontSize: 'md', templateHtml: '',
};

const DOC_TYPES = [
  { value: 'sale_invoice',     label: 'فاتورة مبيعات' },
  { value: 'purchase_invoice', label: 'فاتورة شراء' },
  { value: 'pos_receipt',      label: 'إيصال نقطة البيع' },
  { value: 'voucher',          label: 'سند مالي' },
  { value: 'report',           label: 'تقرير' },
];

const FORMATS = ['A4', 'A5', '80mm', '58mm'];

interface Props { companyId?: string; }

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
    <span className="text-sm text-gray-700">{label}</span>
    <button onClick={() => onChange(!value)} className={`flex items-center gap-1 text-sm font-semibold transition-colors ${value ? 'text-green-600' : 'text-gray-400'}`}>
      {value ? <ToggleRight size={24} className="text-green-500"/> : <ToggleLeft size={24}/>}
    </button>
  </div>
);

const TemplateDesigner: React.FC<Props> = ({ companyId }) => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selected, setSelected]   = useState<string | null>(null);
  const [form, setForm]           = useState<TemplateForm>(EMPTY);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [showHtmlEditor, setShowHtmlEditor] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchTemplates(companyId);
    setTemplates(data);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [companyId]);

  const selectTemplate = (tpl: any) => {
    setSelected(tpl.id);
    setForm({
      id:              tpl.id,
      name:            tpl.name ?? '',
      templateType:    tpl.templateType ?? tpl.template_type ?? 'sale_invoice',
      format:          tpl.format ?? 'A4',
      isDefault:       !!(tpl.isDefault ?? tpl.is_default),
      showLogo:        tpl.showLogo        ?? tpl.show_logo          ?? true,
      showCompanyName: tpl.showCompanyName ?? tpl.show_company_name  ?? true,
      showAddress:     tpl.showAddress     ?? tpl.show_address        ?? true,
      showPhone:       tpl.showPhone       ?? tpl.show_phone          ?? true,
      showTaxNumber:   tpl.showTaxNumber   ?? tpl.show_tax_number     ?? false,
      showQrCode:      tpl.showQrCode      ?? tpl.show_qr_code        ?? false,
      showDiscount:    tpl.showDiscount    ?? tpl.show_discount       ?? true,
      showTaxBreakdown:tpl.showTaxBreakdown ?? tpl.show_tax_breakdown  ?? false,
      showFooter:      tpl.showFooter      ?? tpl.show_footer         ?? true,
      showSignatureLine:tpl.showSignatureLine ?? tpl.show_signature_line ?? false,
      headerTitle:     tpl.headerTitle    ?? tpl.header_title    ?? '',
      headerSubtitle:  tpl.headerSubtitle ?? tpl.header_subtitle ?? '',
      footerText:      tpl.footerText     ?? tpl.footer_text     ?? '',
      fontSize:        tpl.fontSize       ?? tpl.font_size       ?? 'md',
      templateHtml:    tpl.templateHtml   ?? tpl.template_html   ?? '',
    });
    setMsg(null);
    setPreviewHtml('');
    setShowPreview(false);
  };

  const newTemplate = () => {
    setSelected(null);
    setForm(EMPTY);
    setMsg(null);
    setPreviewHtml('');
    setShowPreview(false);
  };

  const f = (field: keyof TemplateForm, value: unknown) => setForm(p => ({ ...p, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) { setMsg({ type: 'err', text: 'اسم القالب مطلوب' }); return; }
    setSaving(true);
    const result = await saveTemplate({ ...form, companyId });
    setSaving(false);
    if (result) {
      setMsg({ type: 'ok', text: selected ? 'تم تحديث القالب' : 'تم إنشاء القالب' });
      await load();
    } else {
      setMsg({ type: 'err', text: 'فشل حفظ القالب' });
    }
  };

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    // Build sample data for preview
    const sampleInvoice = {
      invoiceNumber: 'INV-2025-001',
      date: new Date().toLocaleDateString('ar-EG'),
      type: form.templateType.includes('purchase') ? 'purchase' : 'sale',
      clientName: 'شركة الأمل للتجارة',
      totalAmount: 1500,
      discount: form.showDiscount ? 50 : 0,
      paidAmount: 1450,
      currency: 'USD',
      items: [
        { name: 'منتج تجريبي أول',  qty: 2, price: 500 },
        { name: 'منتج تجريبي ثاني', qty: 1, price: 550 },
      ],
    };
    const sampleCompany = {
      name: 'شركة شامل للتجارة',
      phone: '+963 11 000 0000',
      address: 'دمشق — سوريا',
      taxNo: '123456789',
    };

    const result = await previewDocument({
      documentType: form.templateType as any,
      format:       form.format as any,
      companyId,
      data: {
        invoice:       sampleInvoice,
        company:       sampleCompany,
        currencyLabel: 'USD',
      },
      templateId: form.id,
    });

    if (!result.success) {
      setMsg({ type: 'err', text: result.error ?? 'فشل المعاينة' });
    }
    setPreviewing(false);
    setShowPreview(true);
  }, [form, companyId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><FileText size={20}/> مصمم القوالب</h3>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-1 rounded"><RefreshCw size={14}/></button>
          <button onClick={newTemplate} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-blue-700">
            <Plus size={16}/> قالب جديد
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Template list */}
        <div className="lg:col-span-1 space-y-2">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide px-1">القوالب المحفوظة</p>
          {loading && <div className="text-center py-4 text-gray-400 text-sm">جار التحميل...</div>}
          {!loading && templates.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm border-2 border-dashed rounded-xl">لا توجد قوالب</div>
          )}
          {templates.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => selectTemplate(tpl)}
              className={`w-full text-right p-3 rounded-xl border transition-all ${selected === tpl.id ? 'border-blue-400 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <div className="font-bold text-sm text-gray-800">{tpl.name}</div>
              <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                <span>{DOC_TYPES.find(d => d.value === (tpl.templateType ?? tpl.template_type))?.label ?? tpl.templateType}</span>
                <span>·</span>
                <span>{tpl.format}</span>
                {(tpl.isDefault ?? tpl.is_default) && <span className="bg-blue-100 text-blue-700 px-1.5 rounded text-xs">افتراضي</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b">
            <h4 className="font-bold text-gray-700">{selected ? 'تعديل القالب' : 'قالب جديد'}</h4>
          </div>

          <div className="p-5 space-y-5 overflow-y-auto max-h-[65vh]">
            {msg && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {msg.type === 'ok' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>} {msg.text}
              </div>
            )}

            {/* Basic fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">اسم القالب *</label>
                <input value={form.name} onChange={e => f('name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="مثال: فاتورة A4 مع الشعار"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">نوع المستند</label>
                <select value={form.templateType} onChange={e => f('templateType', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">حجم الورق</label>
                <select value={form.format} onChange={e => f('format', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">حجم الخط</label>
                <select value={form.fontSize} onChange={e => f('fontSize', e.target.value as any)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="sm">صغير</option>
                  <option value="md">متوسط</option>
                  <option value="lg">كبير</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e => f('isDefault', e.target.checked)} className="w-4 h-4"/>
                <label htmlFor="isDefault" className="text-sm font-semibold text-gray-700">قالب افتراضي</label>
              </div>
            </div>

            {/* Section toggles */}
            <div>
              <p className="text-sm font-bold text-gray-700 mb-2">الأقسام</p>
              <div className="bg-gray-50 rounded-xl p-3 divide-y divide-gray-100">
                <Toggle label="عرض الشعار"               value={form.showLogo}          onChange={v => f('showLogo', v)}/>
                <Toggle label="عرض اسم الشركة"            value={form.showCompanyName}   onChange={v => f('showCompanyName', v)}/>
                <Toggle label="عرض العنوان"               value={form.showAddress}       onChange={v => f('showAddress', v)}/>
                <Toggle label="عرض الهاتف"                value={form.showPhone}         onChange={v => f('showPhone', v)}/>
                <Toggle label="عرض الرقم الضريبي"         value={form.showTaxNumber}     onChange={v => f('showTaxNumber', v)}/>
                <Toggle label="عرض رمز QR"                value={form.showQrCode}        onChange={v => f('showQrCode', v)}/>
                <Toggle label="عرض الخصم"                 value={form.showDiscount}      onChange={v => f('showDiscount', v)}/>
                <Toggle label="تفاصيل الضريبة"            value={form.showTaxBreakdown}  onChange={v => f('showTaxBreakdown', v)}/>
                <Toggle label="عرض التذييل"               value={form.showFooter}        onChange={v => f('showFooter', v)}/>
                <Toggle label="سطر التوقيع"               value={form.showSignatureLine} onChange={v => f('showSignatureLine', v)}/>
              </div>
            </div>

            {/* Custom text */}
            <div className="space-y-3">
              <p className="text-sm font-bold text-gray-700">نصوص مخصصة</p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">عنوان رئيسي إضافي</label>
                <input value={form.headerTitle} onChange={e => f('headerTitle', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="مثال: عروض الصيف 2025"/>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">عنوان فرعي</label>
                <input value={form.headerSubtitle} onChange={e => f('headerSubtitle', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder=""/>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">نص التذييل</label>
                <input value={form.footerText} onChange={e => f('footerText', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="شكراً لتعاملكم معنا"/>
              </div>
            </div>

            {/* Custom HTML override */}
            <div>
              <button onClick={() => setShowHtmlEditor(v => !v)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-semibold">
                {showHtmlEditor ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                قالب HTML مخصص (متقدم)
              </button>
              {showHtmlEditor && (
                <div className="mt-2">
                  <p className="text-xs text-gray-400 mb-2">يدعم متغيرات <code>{'{{invoice.number}}'}</code>، <code>{'{{company.name}}'}</code>، <code>{'{{#each invoice.items}}...{{/each}}'}</code></p>
                  <textarea
                    value={form.templateHtml}
                    onChange={e => f('templateHtml', e.target.value)}
                    rows={10}
                    className="w-full border rounded-lg px-3 py-2 text-xs font-mono"
                    dir="ltr"
                    placeholder="<div>{{company.name}}</div>..."
                  />
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-5 border-t flex gap-3 justify-between">
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <Eye size={16}/> {previewing ? 'جار المعاينة...' : 'معاينة'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={16}/> {saving ? 'جار الحفظ...' : 'حفظ القالب'}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h4 className="font-bold text-gray-800 flex items-center gap-2"><Eye size={18}/> معاينة القالب — {form.name}</h4>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100">
              <div className="bg-white shadow-lg rounded-lg overflow-hidden mx-auto" style={{ maxWidth: form.format === 'A5' ? '500px' : form.format.includes('mm') ? '350px' : '750px' }}>
                <iframe
                  srcDoc={previewHtml || '<p style="padding:20px;color:#888;text-align:center">لا توجد بيانات معاينة. اضغط "معاينة" مرة أخرى بعد الحفظ.</p>'}
                  className="w-full"
                  style={{ minHeight: '500px', border: 'none' }}
                  title="print-preview"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateDesigner;
