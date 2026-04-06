import React, { useEffect, useState } from 'react';
import { Bluetooth, Check, Printer, RefreshCw, X } from 'lucide-react';
import { listBluetoothPrinters, requestBluetoothPermissions, type BluetoothPrinter, type PaperSize } from '../printing/thermalPrinter';

interface BluetoothPrinterPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (printer: BluetoothPrinter, paperSize: PaperSize) => void;
  defaultPaperSize?: PaperSize;
  defaultPrinterId?: string;
}

const BluetoothPrinterPicker: React.FC<BluetoothPrinterPickerProps> = ({
  open,
  onClose,
  onSelect,
  defaultPaperSize = '80mm',
  defaultPrinterId = '',
}) => {
  const [printers, setPrinters] = useState<BluetoothPrinter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedPaperSize, setSelectedPaperSize] = useState<PaperSize>(defaultPaperSize);

  const loadPrinters = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await requestBluetoothPermissions();
      const list = await listBluetoothPrinters();
      setPrinters(list);
      if (list.length === 0) {
        setErrorMsg('لم يتم العثور على طابعات بلوتوث مقترنة.');
      }
    } catch (error: any) {
      setPrinters([]);
      setErrorMsg(error?.message || 'تعذر قراءة طابعات البلوتوث.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedPaperSize(defaultPaperSize);
    loadPrinters();
  }, [open, defaultPaperSize]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-fadeIn">
        <div className="flex items-center justify-between bg-gradient-to-l from-teal-700 to-cyan-700 px-4 py-4 text-white">
          <div className="flex items-center gap-2 font-black">
            <Bluetooth size={18} />
            اختيار طابعة البلوتوث
          </div>
          <button onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-full text-white/80 hover:bg-white/10 hover:text-white tap-feedback">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-2 block text-xs font-black text-gray-500">حجم الورق</label>
            <div className="grid grid-cols-4 gap-2">
              {(['80mm', '85mm', 'A5', 'A4'] as PaperSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setSelectedPaperSize(size)}
                  className={`rounded-xl px-2 py-3 text-sm font-black transition ${
                    selectedPaperSize === size ? 'bg-primary text-white shadow-lg' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {size === '80mm' ? '80 مم' : size === '85mm' ? '85 مم' : size}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-gray-500">الطابعات المقترنة</span>
            <button onClick={loadPrinters} className="flex items-center gap-1 text-xs font-black text-primary tap-feedback">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>

          {isLoading && (
            <div className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-bold text-gray-500">
              جارٍ البحث عن الطابعات...
            </div>
          )}

          {!isLoading && (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {printers.map((printer) => {
                const isDefault = defaultPrinterId && (printer.id === defaultPrinterId || printer.address === defaultPrinterId);
                return (
                  <button
                    key={printer.id}
                    onClick={() => onSelect(printer, selectedPaperSize)}
                    className="flex w-full items-center justify-between rounded-2xl border border-gray-200 px-4 py-3 text-right transition hover:border-primary hover:bg-primary/5 tap-feedback"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-black text-gray-800">
                        <Printer size={16} className="text-gray-300" />
                        <span className="truncate">{printer.name || 'طابعة بلوتوث'}</span>
                        {isDefault && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                            افتراضية
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-[11px] font-mono text-gray-400">
                        {printer.address || printer.id}
                      </div>
                    </div>
                    {isDefault && <Check size={18} className="text-emerald-600" />}
                  </button>
                );
              })}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              {errorMsg}
            </div>
          )}

          <div className="text-[11px] font-bold text-gray-400">
            سيتم حفظ الطابعة المختارة كافتراضية لهذه النسخة على Android.
          </div>
        </div>
      </div>
    </div>
  );
};

export default BluetoothPrinterPicker;
