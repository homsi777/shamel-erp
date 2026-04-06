import React, { useEffect, useRef, useState } from 'react';
import { Edit, Printer, FileText, Lock, Unlock, Trash2, ChevronDown, ChevronUp, MoreVertical } from 'lucide-react';

type InvoiceRowActionsLabels = {
  view: string;
  print: string;
  pdf: string;
  delete: string;
  items: string;
  lock: string;
  unlock: string;
};

type InvoiceRowActionsProps = {
  mode?: 'buttons' | 'menu';
  showPdf?: boolean;
  showItemsToggle?: boolean;
  itemsExpanded?: boolean;
  showStockToggle?: boolean;
  stockActive?: boolean;
  onView: () => void;
  onPrint: () => void;
  onPdf?: () => void;
  onDelete: () => void;
  onToggleItems?: () => void;
  onToggleStock?: () => void;
  labels?: Partial<InvoiceRowActionsLabels>;
  className?: string;
};

const defaultLabels: InvoiceRowActionsLabels = {
  view: 'تفاصيل',
  print: 'طباعة',
  pdf: 'PDF',
  delete: 'حذف',
  items: 'الأصناف',
  lock: 'قفل',
  unlock: 'تفعيل',
};

const ActionButton: React.FC<{
  title: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}> = ({ title, onClick, className, children }) => (
  <button
    onClick={onClick}
    className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-md ${className}`.trim()}
    title={title}
    aria-label={title}
    type="button"
  >
    {children}
  </button>
);

const InvoiceRowActions: React.FC<InvoiceRowActionsProps> = ({
  mode = 'buttons',
  showPdf = false,
  showItemsToggle = false,
  itemsExpanded = false,
  showStockToggle = false,
  stockActive = false,
  onView,
  onPrint,
  onPdf,
  onDelete,
  onToggleItems,
  onToggleStock,
  labels,
  className = '',
}) => {
  const mergedLabels = { ...defaultLabels, ...(labels || {}) };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const actionItems: Array<{
    key: string;
    label: string;
    onClick: () => void;
    icon: React.ReactNode;
    className?: string;
  }> = [
    { key: 'view', label: mergedLabels.view, onClick: onView, icon: <Edit size={16} /> },
    { key: 'print', label: mergedLabels.print, onClick: onPrint, icon: <Printer size={16} /> },
    ...(showPdf && onPdf ? [{ key: 'pdf', label: mergedLabels.pdf, onClick: onPdf, icon: <FileText size={16} /> }] : []),
    { key: 'delete', label: mergedLabels.delete, onClick: onDelete, icon: <Trash2 size={16} />, className: 'text-red-700' },
    ...(showItemsToggle && onToggleItems
      ? [
          {
            key: 'items',
            label: mergedLabels.items,
            onClick: onToggleItems,
            icon: itemsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />,
          },
        ]
      : []),
    ...(showStockToggle && onToggleStock
      ? [
          {
            key: 'stock',
            label: stockActive ? mergedLabels.lock : mergedLabels.unlock,
            onClick: onToggleStock,
            icon: stockActive ? <Lock size={16} /> : <Unlock size={16} />,
          },
        ]
      : []),
  ];

  if (mode === 'menu') {
    return (
      <div ref={menuRef} className={`relative inline-flex justify-center ${className}`.trim()}>
        <button
          type="button"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="خيارات"
          title="خيارات"
        >
          <MoreVertical size={18} />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-40 mt-1 min-w-[150px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {actionItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  item.onClick();
                  setMenuOpen(false);
                }}
                className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-gray-50 ${item.className || 'text-gray-700'}`.trim()}
                title={item.label}
              >
                {item.icon}
                <span className="font-semibold">{item.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`.trim()}>
      <ActionButton title={mergedLabels.view} onClick={onView} className="bg-blue-100 text-blue-600">
        <Edit size={16} />
      </ActionButton>
      <ActionButton title={mergedLabels.print} onClick={onPrint} className="bg-gray-100 text-gray-600">
        <Printer size={16} />
      </ActionButton>
      {showPdf && onPdf ? (
        <ActionButton title={mergedLabels.pdf} onClick={onPdf} className="bg-red-100 text-red-700">
          <FileText size={16} />
        </ActionButton>
      ) : null}
      <ActionButton title={mergedLabels.delete} onClick={onDelete} className="bg-red-50 text-red-700">
        <Trash2 size={16} />
      </ActionButton>
      {showItemsToggle && onToggleItems ? (
        <ActionButton title={mergedLabels.items} onClick={onToggleItems} className="bg-slate-100 text-slate-700">
          {itemsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </ActionButton>
      ) : null}
      {showStockToggle && onToggleStock ? (
        <ActionButton
          title={stockActive ? mergedLabels.lock : mergedLabels.unlock}
          onClick={onToggleStock}
          className={stockActive ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}
        >
          {stockActive ? <Lock size={16} /> : <Unlock size={16} />}
        </ActionButton>
      ) : null}
    </div>
  );
};

export default InvoiceRowActions;
