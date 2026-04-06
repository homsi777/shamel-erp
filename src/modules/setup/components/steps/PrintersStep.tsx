import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, Wifi } from 'lucide-react';
import { listWindowsPrinters, openPrintDialog } from '../../../../printing/thermalPrinter';
import { WIZARD_FIELD_STYLES } from '../../wizardConstants';
import type { SetupWizardData } from '../../wizardTypes';

interface PrintersStepProps {
  data: SetupWizardData;
  onChange: (patch: Partial<SetupWizardData>) => void;
}

type TestTone = 'success' | 'error';

const TEST_RECEIPT_BODY = `
  <div style="font-family: 'IBM Plex Sans Arabic', Arial, sans-serif; direction: rtl; color: #0f172a;">
    <div style="border-bottom: 2px dashed #cbd5e1; padding-bottom: 12px; margin-bottom: 12px;">
      <div style="font-size: 18px; font-weight: 700;">اختبار الطابعة</div>
      <div style="font-size: 13px; color: #475569;">من معالج الإعداد</div>
    </div>
    <div style="font-size: 14px; line-height: 1.8;">
      <div>الوقت: ${new Date().toLocaleString('ar-SY')}</div>
    </div>
  </div>
`;

const PrintersStep: React.FC<PrintersStepProps> = ({ data, onChange }) => {
  const [printerNames, setPrinterNames] = useState<string[]>([]);
  const [testState, setTestState] = useState<{ tone: TestTone; message: string } | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listWindowsPrinters()
      .then((printers) => {
        if (!active) return;
        setPrinterNames(printers.map((printer) => printer.name));
      })
      .catch(() => {
        if (!active) return;
        setPrinterNames([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const datalistId = useMemo(() => `wizard-printers-${Math.random().toString(36).slice(2, 8)}`, []);

  const runTest = async (key: string, printerName: string, paperSize: '80mm' | 'A4') => {
    if (!printerName.trim()) {
      setTestState({ tone: 'error', message: 'أدخل اسم الطابعة أولاً.' });
      return;
    }

    setTestingKey(key);
    setTestState(null);
    try {
      await openPrintDialog(TEST_RECEIPT_BODY, printerName.trim(), paperSize);
      setTestState({ tone: 'success', message: `أُرسل الاختبار إلى: ${printerName}` });
    } catch (error: any) {
      setTestState({
        tone: 'error',
        message: error?.message || 'تعذر الاختبار.',
      });
    } finally {
      setTestingKey(null);
    }
  };

  const cards: Array<{
    key: 'thermalPrinter' | 'a4Printer' | 'networkPrinter';
    title: string;
    description: string;
    value: string;
    paperSize: '80mm' | 'A4';
    icon: typeof Printer | typeof Wifi;
    placeholder: string;
  }> = [
    {
      key: 'thermalPrinter',
      title: 'حرارية',
      description: 'إيصالات / نقطة بيع',
      value: data.thermalPrinter,
      paperSize: '80mm',
      icon: Printer,
      placeholder: 'اسم الطابعة',
    },
    {
      key: 'a4Printer',
      title: 'A4',
      description: 'تقارير وفواتير',
      value: data.a4Printer,
      paperSize: 'A4',
      icon: Printer,
      placeholder: 'اسم الطابعة',
    },
    {
      key: 'networkPrinter',
      title: 'شبكة',
      description: 'IP أو اسم معروف',
      value: data.networkPrinter,
      paperSize: 'A4',
      icon: Wifi,
      placeholder: '192.168.x.x',
    },
  ];

  return (
    <div className="setup-step-inner">
      <datalist id={datalistId}>
        {printerNames.map((printerName) => (
          <option key={printerName} value={printerName} />
        ))}
      </datalist>

      {cards.map((card) => {
        const Icon = card.icon;
        const isTesting = testingKey === card.key;
        return (
          <div key={card.key} className="setup-printer-row">
            <div className="setup-printer-row-head">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-[var(--setup-text-faint)]" aria-hidden>
                  <Icon size={16} />
                </span>
                <div>
                  <div className="setup-printer-row-title">{card.title}</div>
                  <div className="setup-printer-row-desc">{card.description}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => runTest(card.key, card.value, card.paperSize)}
                disabled={isTesting}
                className="setup-btn-secondary shrink-0 py-1.5 text-xs"
              >
                {isTesting ? <Loader2 size={12} className="animate-spin" /> : null}
                اختبار
              </button>
            </div>
            <div className="mt-2">
              <input
                list={datalistId}
                type="text"
                value={card.value}
                onChange={(event) =>
                  onChange({
                    [card.key]: event.target.value,
                  } as Partial<SetupWizardData>)
                }
                className={WIZARD_FIELD_STYLES.input}
                placeholder={card.placeholder}
              />
            </div>
          </div>
        );
      })}

      <div
        className="setup-callout mt-2"
        data-tone={testState?.tone === 'error' ? 'error' : 'blue'}
      >
        {testState?.message || 'يمكن ترك الحقول فارغة وإكمال الإعداد.'}
      </div>
    </div>
  );
};

export default PrintersStep;
