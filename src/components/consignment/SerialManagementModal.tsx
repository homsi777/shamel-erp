import React, { useState, useEffect, useMemo } from 'react';
import { X, Copy, Trash2, Layers } from 'lucide-react';

/** Parse pasted text: newlines, commas, trim, remove empty */
export function parsePastedSerials(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Remove duplicates, preserve order */
export function removeDuplicateSerials(serials: string[]): string[] {
  const seen = new Set<string>();
  return serials.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

interface SerialManagementModalProps {
  title?: string;
  itemName?: string;
  requiredCount: number;
  serials: string[];
  onChange: (serials: string[]) => void;
  onClose: () => void;
  readonly?: boolean;
}

const SerialManagementModal: React.FC<SerialManagementModalProps> = ({
  title = 'إدارة السيريالات',
  itemName,
  requiredCount,
  serials,
  onChange,
  onClose,
  readonly = false,
}) => {
  const [text, setText] = useState(serials.join('\n'));

  useEffect(() => {
    setText(serials.join('\n'));
  }, [serials]);

  const parsed = useMemo(() => parsePastedSerials(text), [text]);
  const unique = useMemo(() => removeDuplicateSerials(parsed), [parsed]);
  const duplicates = parsed.length - unique.length;
  const required = Math.max(0, Math.floor(requiredCount));
  const status =
    required === 0
      ? 'لا يتطلب'
      : unique.length === 0
        ? 'لا يوجد'
        : unique.length < required
          ? 'ناقص'
          : duplicates > 0
            ? 'فيه تكرار'
            : 'مكتمل';

  const handleApply = () => {
    onChange(unique);
    onClose();
  };

  const handleClear = () => {
    setText('');
    if (!readonly) onChange([]);
  };

  const handleRemoveDuplicates = () => {
    setText(unique.join('\n'));
    if (!readonly) onChange(unique);
  };

  const handleCopy = () => {
    const out = unique.join('\n');
    if (out) navigator.clipboard?.writeText(out);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/50"
      dir="rtl"
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]"
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            {itemName && <p className="text-sm text-gray-500 mt-0.5">{itemName}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X size={22} />
          </button>
        </div>

        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <label className="block text-sm font-bold text-gray-700">السيريالات (سطر واحد أو مفصولة بفاصلة)</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={readonly}
            placeholder="الصق أو اكتب سيريالاً في كل سطر..."
            rows={8}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl font-mono text-sm resize-y"
          />

          <div className="flex flex-wrap items-center gap-2">
            {!readonly && (
              <>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-bold"
                >
                  <Trash2 size={14} />
                  مسح القائمة
                </button>
                {duplicates > 0 && (
                  <button
                    type="button"
                    onClick={handleRemoveDuplicates}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-bold"
                  >
                    <Layers size={14} />
                    إزالة التكرار ({duplicates})
                  </button>
                )}
              </>
            )}
            {readonly && unique.length > 0 && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-bold"
              >
                <Copy size={14} />
                نسخ
              </button>
            )}
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1 text-sm">
            <div className="font-bold text-gray-700">ملخص التحقق</div>
            <div className="grid grid-cols-2 gap-2 font-numeric">
              <span className="text-gray-600">العدد المطلوب:</span>
              <span>{required}</span>
              <span className="text-gray-600">العدد المدخل:</span>
              <span>{unique.length}</span>
              <span className="text-gray-600">المكرر:</span>
              <span className={duplicates > 0 ? 'text-amber-600 font-bold' : ''}>{duplicates}</span>
              <span className="text-gray-600">الصالح:</span>
              <span className={unique.length === required && duplicates === 0 ? 'text-green-600 font-bold' : ''}>
                {duplicates > 0 ? unique.length : unique.length}
              </span>
            </div>
            <div className="pt-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${
                  status === 'مكتمل'
                    ? 'bg-green-100 text-green-800'
                    : status === 'ناقص'
                      ? 'bg-amber-100 text-amber-800'
                      : status === 'فيه تكرار'
                        ? 'bg-orange-100 text-orange-800'
                        : status === 'لا يوجد'
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-gray-100 text-gray-500'
                }`}
              >
                {status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 border-t border-gray-200">
          {!readonly && (
            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700"
            >
              تطبيق
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-xl font-bold hover:bg-gray-50"
          >
            {readonly ? 'إغلاق' : 'إلغاء'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SerialManagementModal;
