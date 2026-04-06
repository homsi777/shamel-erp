/**
 * Smart Card Actions Component
 * أزرار العمليات السريعة
 */
import React, { useState } from 'react';
import { ExternalLink, Pencil, Printer, Download, Copy, Check } from 'lucide-react';
import { SmartQuickViewResponse, SmartOpenPayload } from '../../types/smart';
import { apiRequest, API_CONFIG } from '../../lib/api';
import { isSyncedMode } from '../../lib/appMode';

interface SmartCardActionsProps {
  data: SmartQuickViewResponse;
  payload: SmartOpenPayload;
  onNavigateToFull?: (type: string, id: string) => void;
  onEdit?: (type: string, id: string) => void;
  onClose: () => void;
}

const KeyHint: React.FC<{ hint: string }> = ({ hint }) => (
  <kbd className="ml-2 px-1.5 py-0.5 bg-white/50 rounded text-[10px] font-mono text-gray-500 hidden sm:inline">
    {hint}
  </kbd>
);

const SmartCardActions: React.FC<SmartCardActionsProps> = ({
  data,
  payload,
  onNavigateToFull,
  onEdit,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { actions } = data;

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(payload.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleOpenFull = () => {
    if (onNavigateToFull) {
      onClose();
      onNavigateToFull(payload.type, payload.id);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onClose();
      onEdit(payload.type, payload.id);
    }
  };

  const resolveExportBase = () => {
    const baseUrl = API_CONFIG.baseUrl || (isSyncedMode() ? '' : 'http://localhost:3333/api');
    if (!baseUrl) {
      alert('يرجى إدخال عنوان الخادم أولًا.');
      return null;
    }
    return baseUrl;
  };

  const handlePrint = async () => {
    try {
      const baseUrl = resolveExportBase();
      if (!baseUrl) return;
      const url = `${baseUrl.replace(/\/api$/, '')}/api/smart/export/${payload.type}/${encodeURIComponent(payload.id)}?format=print`;
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
      }
    } catch (err) {
      console.error('Print error:', err);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const baseUrl = resolveExportBase();
      if (!baseUrl) return;
      const url = `${baseUrl.replace(/\/api$/, '')}/api/smart/export/${payload.type}/${encodeURIComponent(payload.id)}?format=pdf`;
      
      // Open in new tab for PDF download
      window.open(url, '_blank');
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Primary Actions */}
      <div className="flex flex-wrap gap-2">
        {actions.canOpen && onNavigateToFull && (
          <button
            onClick={handleOpenFull}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium text-sm"
          >
            <ExternalLink size={16} />
            فتح التفاصيل
            <KeyHint hint="Enter" />
          </button>
        )}

        {actions.canEdit && onEdit && (
          <button
            onClick={handleEdit}
            disabled={!!actions.disabledReason?.edit}
            title={actions.disabledReason?.edit || 'تعديل'}
            className="flex-1 min-w-[100px] flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Pencil size={16} />
            تعديل
            <KeyHint hint="E" />
          </button>
        )}
      </div>

      {/* Secondary Actions */}
      <div className="flex flex-wrap gap-2">
        {actions.canPrint && (
          <button
            onClick={handlePrint}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            <Printer size={16} />
            طباعة
            <KeyHint hint="P" />
          </button>
        )}

        {actions.canExport && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
          >
            <Download size={16} />
            {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
          </button>
        )}

        <button
          onClick={handleCopyId}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
        >
          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
          {copied ? 'تم النسخ' : 'نسخ الرقم'}
        </button>
      </div>
    </div>
  );
};

export default SmartCardActions;
