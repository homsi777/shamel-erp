import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, Plus } from 'lucide-react';
import { getOrgsList, getPublicCompanies, getToken, refreshCompaniesCacheFromSession, saveOrgsList, mapBackendCompanyToInstitution } from '../lib/api';
import { getSelectedCompanyId, navigateToCompanyRoute, setSelectedCompanyId } from '../lib/companySession';
import type { Institution } from '../types';

interface SelectCompanyProps {
  onManageCompanies: () => void;
  onCompanySelected?: (companyId: string) => void;
}

const SelectCompany: React.FC<SelectCompanyProps> = ({ onManageCompanies, onCompanySelected }) => {
  const [companies, setCompanies] = useState<Institution[]>(() => getOrgsList());
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(() => getSelectedCompanyId());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [didAutoAdvance, setDidAutoAdvance] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setCompanies(getOrgsList());
      setSelectedCompanyIdState(getSelectedCompanyId());
      if (!getToken()) {
        try {
          setIsRefreshing(true);
          const response = await getPublicCompanies();
          const mapped = (Array.isArray(response?.companies) ? response.companies : [])
            .map(mapBackendCompanyToInstitution)
            .filter((company) => company.id);
          saveOrgsList(mapped);
          if (active) setCompanies(mapped);
        } catch {
          if (active) setCompanies(getOrgsList());
        } finally {
          if (active) setIsRefreshing(false);
        }
        return;
      }
      try {
        setIsRefreshing(true);
        const nextCompanies = await refreshCompaniesCacheFromSession();
        if (active) setCompanies(nextCompanies);
      } catch {
        if (active) setCompanies(getOrgsList());
      } finally {
        if (active) setIsRefreshing(false);
      }
    };

    refresh();
    const syncFromStorage = () => {
      setCompanies(getOrgsList());
      setSelectedCompanyIdState(getSelectedCompanyId());
    };

    window.addEventListener('storage', syncFromStorage);
    window.addEventListener('focus', syncFromStorage);
    return () => {
      active = false;
      window.removeEventListener('storage', syncFromStorage);
      window.removeEventListener('focus', syncFromStorage);
    };
  }, []);

  useEffect(() => {
    if (didAutoAdvance) return;
    if (companies.length !== 1) return;
    const onlyCompanyId = String(companies[0]?.id || '').trim();
    if (!onlyCompanyId) return;
    setDidAutoAdvance(true);
    if (onCompanySelected) {
      onCompanySelected(onlyCompanyId);
      return;
    }
    setSelectedCompanyId(onlyCompanyId);
    setSelectedCompanyIdState(onlyCompanyId);
    navigateToCompanyRoute('login');
  }, [companies, didAutoAdvance, onCompanySelected]);

  const handleSelect = (companyId: string) => {
    if (onCompanySelected) {
      onCompanySelected(companyId);
      return;
    }
    setSelectedCompanyId(companyId);
    setSelectedCompanyIdState(companyId);
    navigateToCompanyRoute('login');
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
            <div className="mb-4 inline-flex rounded-3xl bg-white/10 p-4 text-teal-300 shadow-2xl shadow-black/20">
              <Building2 size={34} />
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white">اختر الشركة أولاً</h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-300">
              الشركات المعروضة هنا هي شركات النظام الفعلية. تُحدَّث القائمة من الخادم عندما تتوفر جلسة،
              وتبقى النسخة المحلية مجرد ذاكرة واجهة فقط.
            </p>
          </div>

          <button
            onClick={onManageCompanies}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-400/30 bg-teal-500/15 px-6 py-3 text-sm font-black text-teal-100 transition hover:bg-teal-500/25"
          >
            <Plus size={18} />
            إدارة الشركات
          </button>
        </div>

        {isRefreshing && (
          <div className="mb-6 rounded-2xl border border-teal-400/20 bg-teal-500/10 px-5 py-4 text-sm font-bold text-teal-100">
            جارِ مزامنة قائمة الشركات من الخادم...
          </div>
        )}

        {companies.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-white/15 bg-white/5 px-8 py-20 text-center shadow-2xl shadow-black/20">
            <Building2 size={64} className="mx-auto mb-5 text-slate-500" />
            <h2 className="text-2xl font-black text-white">لا توجد شركات جاهزة</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 text-slate-400">
              أكمل الإعداد الأولي أو افتح إدارة الشركات بعد تسجيل الدخول بحساب يملك صلاحية الإدارة.
            </p>
            <button
              onClick={onManageCompanies}
              className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-primary px-7 py-4 text-sm font-black text-white shadow-xl shadow-primary/25 transition hover:scale-[1.02]"
            >
              <Plus size={18} />
              إدارة الشركات
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {companies.map((company) => {
              const isSelected = String(company.id) === String(selectedCompanyId || '');
              return (
                <div
                  key={company.id}
                  className={`group relative overflow-hidden rounded-[2rem] border p-7 shadow-2xl transition ${
                    isSelected
                      ? 'border-emerald-400/40 bg-emerald-500/10 shadow-emerald-950/20'
                      : 'border-white/10 bg-white/5 shadow-black/20 hover:border-teal-300/35 hover:bg-white/[0.08]'
                  }`}
                >
                  <div className="absolute left-0 top-0 h-24 w-24 -translate-x-5 -translate-y-5 rounded-full bg-white/5 transition group-hover:scale-125" />
                  <div className="relative z-10">
                    <div className="mb-6 flex items-start justify-between gap-3">
                      <div className="rounded-3xl bg-white/10 p-4 text-teal-200">
                        <Building2 size={30} />
                      </div>
                      {isSelected && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-black text-emerald-200">
                          <CheckCircle2 size={14} />
                          المحددة حالياً
                        </span>
                      )}
                    </div>

                    <h2 className="text-2xl font-black text-white">{company.name}</h2>
                    <p className="mt-2 min-h-[48px] text-sm font-bold leading-6 text-slate-300">
                      {company.address || 'لا يوجد عنوان مسجل لهذه الشركة.'}
                    </p>

                    <div className="mt-6 space-y-2 text-xs font-bold text-slate-400">
                      <div>المعرّف: {company.id}</div>
                      <div>الهاتف: {company.phone || 'غير مسجل'}</div>
                      <div>العملة الأساسية: {company.primaryCurrency || 'USD'}</div>
                    </div>

                    <button
                      onClick={() => handleSelect(String(company.id))}
                      className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:translate-x-[-2px]"
                    >
                      اختيار والمتابعة
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

export default SelectCompany;
