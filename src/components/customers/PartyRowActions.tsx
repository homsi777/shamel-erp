import React, { useEffect, useRef, useState } from 'react';
import { Eye, MoreVertical, Trash2 } from 'lucide-react';

type PartyRowActionsProps = {
  mode?: 'buttons' | 'menu';
  onView: () => void;
  onDelete: () => void;
  className?: string;
};

const PartyRowActions: React.FC<PartyRowActionsProps> = ({ mode = 'buttons', onView, onDelete, className = '' }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (mode === 'menu') {
    return (
      <div ref={rootRef} className={`relative inline-flex justify-center ${className}`.trim()}>
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
          <div className="absolute right-0 top-full z-40 mt-1 min-w-[130px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-right text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => { onView(); setOpen(false); }}>
              <Eye size={16} /> عرض
            </button>
            <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-right text-sm font-semibold text-red-700 hover:bg-red-50" onClick={() => { onDelete(); setOpen(false); }}>
              <Trash2 size={16} /> حذف
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center gap-2 ${className}`.trim()}>
      <button type="button" onClick={onView} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-blue-100 text-blue-600" title="عرض" aria-label="عرض">
        <Eye size={16} />
      </button>
      <button type="button" onClick={onDelete} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-red-50 text-red-700" title="حذف" aria-label="حذف">
        <Trash2 size={16} />
      </button>
    </div>
  );
};

export default PartyRowActions;
