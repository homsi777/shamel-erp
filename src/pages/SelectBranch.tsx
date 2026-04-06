import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, GitBranch, Loader2 } from 'lucide-react';
import type { Branch } from '../types';
import { getSessionBranches, switchBranchContext } from '../lib/api';
import { getSelectedBranchId, navigateToCompanyRoute, setSelectedBranchId, setStoredUser } from '../lib/companySession';

interface SelectBranchProps {
  onBranchSelected: (user?: any) => void;
}

const SelectBranch: React.FC<SelectBranchProps> = ({ onBranchSelected }) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(() => getSelectedBranchId());
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getSessionBranches();
        if (!active) return;
        const rows = Array.isArray(response?.branches) ? response.branches : [];
        setBranches(rows);
        const nextSelected = String(response?.currentBranchId || response?.defaultBranchId || '').trim() || null;
        if (nextSelected) {
          setSelectedBranchId(nextSelected);
          setSelectedBranchIdState(nextSelected);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || 'تعذر تحميل الفروع المتاحة.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const sortedBranches = useMemo(() => (
    [...branches].sort((a, b) => {
      if (Boolean(a.isMain) !== Boolean(b.isMain)) return a.isMain ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
  ), [branches]);

  const handleSelect = async (branchId: string) => {
    try {
      setSubmittingId(branchId);
      setError(null);
      setSelectedBranchIdState(branchId);
      const response = await switchBranchContext(branchId);
      if (response?.user) {
        setStoredUser(response.user);
        onBranchSelected(response.user);
        return;
      }
      onBranchSelected();
    } catch (err: any) {
      setError(err?.message || 'تعذر تثبيت سياق الفرع.');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div
      className="min-h-screen px-6 py-10 font-sans"
      style={{ background: 'linear-gradient(150deg, #07111f 0%, #10263d 45%, #04101d 100%)' }}
      dir="rtl"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-4 inline-flex rounded-3xl bg-white/10 p-4 text-amber-300 shadow-2xl shadow-black/20">
              <GitBranch size={34} />
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white">اختر الفرع قبل الدخول للنظام</h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-300">
              الجلسة الحالية مرتبطة بالمؤسسة فقط. يجب تثبيت فرع عمل صالح قبل تحميل المبيعات والمخزون والصندوق والتقارير.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigateToCompanyRoute('login')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-6 py-3 text-sm font-black text-white transition hover:bg-white/15"
          >
            <ArrowLeft size={18} />
            العودة لتسجيل الدخول
          </button>
        </div>

        {loading ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/5 px-8 py-20 text-center shadow-2xl shadow-black/20">
            <Loader2 size={48} className="mx-auto mb-5 animate-spin text-amber-300" />
            <h2 className="text-2xl font-black text-white">جارٍ تحميل الفروع المسموح بها</h2>
          </div>
        ) : error ? (
          <div className="rounded-[2rem] border border-rose-400/25 bg-rose-500/10 px-8 py-16 text-center shadow-2xl shadow-black/20">
            <h2 className="text-2xl font-black text-white">تعذر تحميل الفروع</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 text-rose-100">{error}</p>
          </div>
        ) : sortedBranches.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-white/15 bg-white/5 px-8 py-20 text-center shadow-2xl shadow-black/20">
            <Building2 size={64} className="mx-auto mb-5 text-slate-500" />
            <h2 className="text-2xl font-black text-white">لا توجد فروع متاحة لهذا المستخدم</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 text-slate-400">
              يجب منح المستخدم صلاحية على فرع واحد على الأقل داخل المؤسسة الحالية قبل السماح بالدخول.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {sortedBranches.map((branch) => {
              const branchId = String(branch.id || '');
              const isSelected = branchId === selectedBranchId;
              const isSubmitting = submittingId === branchId;
              return (
                <div
                  key={branchId}
                  className={`group relative overflow-hidden rounded-[2rem] border p-7 shadow-2xl transition ${
                    isSelected
                      ? 'border-amber-400/40 bg-amber-500/10 shadow-amber-950/20'
                      : 'border-white/10 bg-white/5 shadow-black/20 hover:border-amber-300/35 hover:bg-white/[0.08]'
                  }`}
                >
                  <div className="absolute left-0 top-0 h-24 w-24 -translate-x-5 -translate-y-5 rounded-full bg-white/5 transition group-hover:scale-125" />
                  <div className="relative z-10">
                    <div className="mb-6 flex items-start justify-between gap-3">
                      <div className="rounded-3xl bg-white/10 p-4 text-amber-200">
                        <GitBranch size={30} />
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {branch.isMain && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-3 py-1 text-[11px] font-black text-sky-200">
                            الفرع الرئيسي
                          </span>
                        )}
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-black text-emerald-200">
                            <CheckCircle2 size={14} />
                            المحدد حالياً
                          </span>
                        )}
                      </div>
                    </div>

                    <h2 className="text-2xl font-black text-white">{branch.name}</h2>
                    <p className="mt-2 min-h-[48px] text-sm font-bold leading-6 text-slate-300">
                      {branch.location || 'لا يوجد موقع مسجل لهذا الفرع.'}
                    </p>

                    <div className="mt-6 space-y-2 text-xs font-bold text-slate-400">
                      <div>المعرف: {branchId}</div>
                      <div>الرمز: {branch.code || 'غير مسجل'}</div>
                      <div>المدير: {branch.manager || 'غير مسجل'}</div>
                    </div>

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleSelect(branchId)}
                      className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:translate-x-[-2px] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'اختيار هذا الفرع'}
                      <ArrowLeft size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SelectBranch;
