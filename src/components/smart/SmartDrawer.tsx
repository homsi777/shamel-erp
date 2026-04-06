/**
 * Smart Drawer Component
 * نظام البطاقة الذكية - Drawer الرئيسي
 */
import React, { useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw, Loader2 } from 'lucide-react';
import { useSmartDrawer } from '../../hooks/useSmartDrawer';
import SmartCard from './SmartCard';
import SmartCardActions from './SmartCardActions';
import { SMART_TYPE_LABELS } from '../../types/smart';

interface SmartDrawerProps {
  /** Callback when user wants to navigate to full detail page */
  onNavigateToFull?: (type: string, id: string) => void;
  /** Callback when user wants to edit */
  onEdit?: (type: string, id: string) => void;
}

const SmartDrawer: React.FC<SmartDrawerProps> = ({ onNavigateToFull, onEdit }) => {
  const { isOpen, isLoading, error, data, payload, close, retry } = useSmartDrawer();
  const drawerRef = useRef<HTMLDivElement>(null);

  // Check if an element is an input/editable
  const isInputElement = useCallback((element: Element | null): boolean => {
    if (!element) return false;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
    if ((element as HTMLElement).isContentEditable) return true;
    return false;
  }, []);

  // Keyboard shortcuts handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if drawer is not open
    if (!isOpen) return;

    // Don't handle if modifier keys are pressed (except Shift for Esc)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Don't handle if focus is on an input element
    if (isInputElement(document.activeElement)) return;

    const key = e.key.toLowerCase();

    switch (key) {
      case 'escape':
        e.preventDefault();
        close();
        break;
      
      case 'enter':
        if (data?.actions?.canOpen && onNavigateToFull && payload) {
          e.preventDefault();
          close();
          onNavigateToFull(payload.type, payload.id);
        }
        break;
      
      case 'e':
        if (data?.actions?.canEdit && onEdit && payload) {
          e.preventDefault();
          close();
          onEdit(payload.type, payload.id);
        }
        break;
      
      case 'p':
        if (data?.actions?.canPrint && payload) {
          e.preventDefault();
          handlePrint();
        }
        break;
    }
  }, [isOpen, data, payload, close, onNavigateToFull, onEdit, isInputElement]);

  // Handle print action
  const handlePrint = useCallback(async () => {
    if (!payload) return;
    try {
      const url = `/api/smart/export/${payload.type}/${encodeURIComponent(payload.id)}?format=pdf`;
      window.open(url, '_blank');
    } catch (err) {
      console.error('Print error:', err);
    }
  }, [payload]);

  // Register keyboard event listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  // Focus trap - focus drawer when opened
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const typeLabel = payload?.type ? SMART_TYPE_LABELS[payload.type] : '';

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] transition-opacity duration-200"
        onClick={close}
        aria-hidden="true"
      />
      
      {/* Modal - Centered */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-drawer-title"
        tabIndex={-1}
        className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none"
        style={{ direction: 'rtl' }}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col pointer-events-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-l from-gray-50 to-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <button
              onClick={close}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
              aria-label="إغلاق"
              title="إغلاق (Esc)"
            >
              <X size={20} />
            </button>
            <div>
              <h2 id="smart-drawer-title" className="text-lg font-bold text-gray-800">
                {isLoading ? 'جاري التحميل...' : (data?.title || typeLabel)}
              </h2>
              {data?.subtitle && (
                <p className="text-sm text-gray-500">{data.subtitle}</p>
              )}
              {!data && !isLoading && payload && (
                <p className="text-sm text-gray-500">{typeLabel}</p>
              )}
            </div>
          </div>
          
          {/* Keyboard hint */}
          <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">Esc</kbd>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-gray-500">جاري تحميل التفاصيل...</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <X className="w-8 h-8 text-red-500" />
              </div>
              <div>
                <p className="text-red-600 font-semibold mb-1">تعذر تحميل التفاصيل</p>
                <p className="text-sm text-gray-500">{error}</p>
              </div>
              <button
                onClick={retry}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                <RefreshCw size={16} />
                إعادة المحاولة
              </button>
            </div>
          )}

          {data && !isLoading && (
            <SmartCard data={data} />
          )}
        </div>

        {/* Footer Actions */}
        {data && !isLoading && (
          <div className="border-t bg-gray-50 px-6 py-4 rounded-b-2xl">
            <SmartCardActions
              data={data}
              payload={payload!}
              onNavigateToFull={onNavigateToFull}
              onEdit={onEdit}
              onClose={close}
            />
          </div>
        )}
        </div>
      </div>
    </>
  );
};

export default SmartDrawer;
