import React, { useEffect, useRef, useState } from 'react';
import { Edit2, MoreVertical, Trash2 } from 'lucide-react';

type InventoryRowActionsProps = {
  mode?: 'buttons' | 'menu';
  onPrimaryEdit: () => void;
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
  onDelete?: () => void;
};

const InventoryRowActions: React.FC<InventoryRowActionsProps> = ({
  mode = 'buttons',
  onPrimaryEdit,
  onSecondaryAction,
  secondaryLabel = 'إجراء إضافي',
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (mode === 'menu') {
    return (
      <div ref={rootRef} className="relative inline-flex justify-center">
        <button
          type="button"
          aria-label="خيارات"
          title="خيارات"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
          onClick={() => setOpen((prev) => !prev)}
        >
          <MoreVertical size={18} />
        </button>
        {open ? (
          <div className="absolute right-0 top-full z-40 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-right text-sm font-semibold text-blue-700 hover:bg-blue-50" onClick={() => { onPrimaryEdit(); setOpen(false); }}>
              <Edit2 size={16} /> تعديل
            </button>
            {onSecondaryAction ? (
              <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-right text-sm font-semibold text-emerald-700 hover:bg-emerald-50" onClick={() => { onSecondaryAction(); setOpen(false); }}>
                <Edit2 size={16} /> {secondaryLabel}
              </button>
            ) : null}
            {onDelete ? (
              <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-right text-sm font-semibold text-red-700 hover:bg-red-50" onClick={() => { onDelete(); setOpen(false); }}>
                <Trash2 size={16} /> حذف
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2">
      <button type="button" onClick={onPrimaryEdit} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-blue-100 text-blue-600" title="تعديل" aria-label="تعديل">
        <Edit2 size={16} />
      </button>
      {onSecondaryAction ? (
        <button type="button" onClick={onSecondaryAction} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-700" title={secondaryLabel} aria-label={secondaryLabel}>
          <Edit2 size={16} />
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={onDelete} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-red-50 text-red-700" title="حذف" aria-label="حذف">
          <Trash2 size={16} />
        </button>
      ) : null}
    </div>
  );
};

export default InventoryRowActions;
