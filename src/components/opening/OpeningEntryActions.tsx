import React from 'react';
import { Plus, Save, RotateCcw, Lock } from 'lucide-react';

interface OpeningEntryActionsProps {
  canPost: boolean;
  onAddLine: () => void;
  onSaveDraft: () => void;
  onReset: () => void;
}

const OpeningEntryActions: React.FC<OpeningEntryActionsProps> = ({
  canPost,
  onAddLine,
  onSaveDraft,
  onReset
}) => {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 md:p-5 flex flex-wrap items-center gap-3">
      <button
        onClick={onAddLine}
        className="bg-primary text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow hover:opacity-90"
      >
        <Plus size={18} /> إضافة سطر
      </button>
      <button
        onClick={onSaveDraft}
        className="bg-gray-900 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow hover:bg-black"
      >
        <Save size={18} /> حفظ مسودة
      </button>
      <button
        onClick={onReset}
        className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl font-bold flex items-center gap-2 border hover:bg-gray-200"
      >
        <RotateCcw size={18} /> إعادة ضبط
      </button>
      <button
        disabled
        className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 border ${canPost ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-100 text-gray-400 border-gray-200'}`}
        title="الترحيل غير مفعل في الواجهة فقط"
      >
        <Lock size={18} /> ترحيل (غير مفعل)
      </button>
    </div>
  );
};

export default OpeningEntryActions;
