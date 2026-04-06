import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Bluetooth } from 'lucide-react';
import { listBluetoothPrinters, requestBluetoothPermissions, type BluetoothPrinter } from '../printing/thermalPrinter';

type PrinterPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (printer: BluetoothPrinter) => void;
};

const PrinterPicker: React.FC<PrinterPickerProps> = ({ open, onClose, onSelect }) => {
  const [printers, setPrinters] = useState<BluetoothPrinter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadPrinters = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await requestBluetoothPermissions();
      const list = await listBluetoothPrinters();
      setPrinters(list);
    } catch (e: any) {
      setPrinters([]);
      const msg = typeof e === 'string' ? e : (e?.message || '');
      setErrorMsg(msg ? `فشل فحص الطابعات: ${msg}` : 'فشل فحص الطابعات.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadPrinters();
    } else {
      setPrinters([]);
      setErrorMsg(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gray-900 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold">
            <Bluetooth size={18} />
            اختيار طابعة بلوتوث
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">الطابعات المتاحة</span>
            <button
              onClick={loadPrinters}
              className="text-xs font-bold text-primary flex items-center gap-1"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>

          {isLoading && (
            <div className="text-xs text-gray-500 font-bold">جاري البحث عن الطابعات...</div>
          )}

          {!isLoading && printers.length === 0 && (
            <div className="text-xs text-gray-500 font-bold">
              لا توجد طابعات متاحة. تأكد من اقتران الطابعة عبر البلوتوث.
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-red-600 font-bold">{errorMsg}</div>
          )}

          <div className="space-y-2">
            {printers.map((printer) => (
              <button
                key={printer.id}
                onClick={() => {
                  if (!printer.id?.trim()) {
                    setErrorMsg('تعذر تحديد معرف الطابعة.');
                    return;
                  }
                  onSelect({ ...printer, id: printer.id.trim() });
                }}
                className="w-full text-right px-4 py-3 rounded-xl border border-gray-200 hover:border-primary hover:bg-primary/5 transition"
              >
                <div className="font-bold text-gray-800">{printer.name || 'طابعة بلوتوث'}</div>
                <div className="text-xs text-gray-500 font-mono">{printer.address || printer.id}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrinterPicker;
