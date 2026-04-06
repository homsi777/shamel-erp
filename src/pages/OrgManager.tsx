import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Globe,
  Loader2,
  Plus,
  Shield,
} from 'lucide-react';
import { Institution } from '../types';
import { apiRequest, getOrgsList, getToken, refreshCompaniesCacheFromSession, switchCompanyContext } from '../lib/api';
import { navigateToCompanyRoute, reloadApplication } from '../lib/companySession';

interface OrgManagerProps {
  onClose?: () => void;
}

const OrgManager: React.FC<OrgManagerProps> = ({ onClose }) => {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    companyName: '',
    companyCode: '',
    branchName: 'Main Branch',
    warehouseName: 'Main Warehouse',
    cashBoxName: 'Main Cash Box',
    primaryCurrency: 'USD',
  });

  const hasSession = Boolean(getToken());

  useEffect(() => {
    let active = true;
    const load = async () => {
      setError(null);
      setIsLoading(true);
      try {
        const rows = hasSession ? await refreshCompaniesCacheFromSession() : getOrgsList();
        if (active) setInstitutions(rows);
      } catch (loadError: any) {
        if (active) {
          setInstitutions(getOrgsList());
          setError(loadError?.message || 'تعذر تحميل الشركات من الخادم.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [hasSession]);

  const activateInstitution = async (institutionId: string) => {
    if (hasSession) {
      await switchCompanyContext(institutionId);
      reloadApplication();
      return;
    }
    navigateToCompanyRoute('login');
    reloadApplication();
  };

  const handleProvision = async () => {
    const companyName = draft.companyName.trim();
    if (!companyName) {
      setError('اسم الشركة مطلوب.');
      return;
    }
    if (!hasSession) {
      setError('إنشاء شركة جديدة يتطلب جلسة مصادقة فعالة.');
      return;
    }

    try {
      setIsProvisioning(true);
      setError(null);
      await apiRequest('companies/provision', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          companyCode: draft.companyCode.trim() || undefined,
          branchName: draft.branchName.trim() || undefined,
          warehouseName: draft.warehouseName.trim() || undefined,
          cashBoxName: draft.cashBoxName.trim() || undefined,
          primaryCurrency: draft.primaryCurrency.trim().toUpperCase() || 'USD',
        }),
      });
      const rows = await refreshCompaniesCacheFromSession();
      setInstitutions(rows);
      setDraft({
        companyName: '',
        companyCode: '',
        branchName: 'Main Branch',
        warehouseName: 'Main Warehouse',
        cashBoxName: 'Main Cash Box',
        primaryCurrency: draft.primaryCurrency.trim().toUpperCase() || 'USD',
      });
    } catch (provisionError: any) {
      setError(provisionError?.message || 'فشل إنشاء الشركة.');
    } finally {
      setIsProvisioning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans" dir="rtl">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-gray-900">إدارة الشركات</h1>
            <p className="mt-2 text-sm font-bold text-gray-500">
              القائمة أدناه تعكس شركات النظام الفعلية. التبديل يتم عبر جلسة الخادم، وليس عبر تخزين محلي وهمي.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700 transition hover:border-primary hover:text-primary"
            >
              إغلاق
            </button>
          )}
        </div>

        {hasSession && (
          <div className="mb-8 rounded-[2rem] border border-primary/15 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <Plus size={22} />
              </div>
              <div>
                <h2 className="text-lg font-black text-gray-900">Provisioning شركة جديدة</h2>
                <p className="text-sm font-bold text-gray-500">
                  هذا النموذج يستدعي مسار التهيئة الخلفي الحقيقي لإنشاء الشركة مع الفرع والمخزن والصندوق والحسابات الافتراضية.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <input
                value={draft.companyName}
                onChange={(event) => setDraft((prev) => ({ ...prev, companyName: event.target.value }))}
                placeholder="اسم الشركة"
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-primary"
              />
              <input
                value={draft.companyCode}
                onChange={(event) => setDraft((prev) => ({ ...prev, companyCode: event.target.value }))}
                placeholder="رمز الشركة الاختياري"
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-primary"
              />
              <input
                value={draft.primaryCurrency}
                onChange={(event) => setDraft((prev) => ({ ...prev, primaryCurrency: event.target.value }))}
                placeholder="العملة الأساسية"
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-primary"
              />
              <input
                value={draft.branchName}
                onChange={(event) => setDraft((prev) => ({ ...prev, branchName: event.target.value }))}
                placeholder="اسم الفرع الرئيسي"
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-primary"
              />
              <input
                value={draft.warehouseName}
                onChange={(event) => setDraft((prev) => ({ ...prev, warehouseName: event.target.value }))}
                placeholder="اسم المخزن الرئيسي"
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-primary"
              />
              <input
                value={draft.cashBoxName}
                onChange={(event) => setDraft((prev) => ({ ...prev, cashBoxName: event.target.value }))}
                placeholder="اسم الصندوق الرئيسي"
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-primary"
              />
            </div>

            <button
              type="button"
              onClick={handleProvision}
              disabled={isProvisioning}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-black text-white shadow-lg shadow-primary/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isProvisioning ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              إنشاء شركة جديدة
            </button>
          </div>
        )}

        {!hasSession && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
            لا توجد جلسة مصادقة فعالة حالياً، لذلك يتم عرض آخر قائمة شركات مخزنة محلياً فقط. بعد تسجيل الدخول ستتم مزامنة الشركات من الخادم.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-[2rem] bg-white p-12 text-center shadow-sm">
            <Loader2 size={36} className="mx-auto mb-4 animate-spin text-primary" />
            <p className="text-sm font-bold text-gray-500">جارِ تحميل الشركات...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {institutions.length === 0 ? (
              <div className="col-span-full rounded-[2rem] border-2 border-dashed border-gray-200 bg-white py-20 text-center">
                <Globe size={64} className="mx-auto mb-4 text-gray-200" />
                <p className="text-lg font-bold text-gray-400">لا توجد شركات متاحة حالياً.</p>
              </div>
            ) : (
              institutions.map((inst) => (
                <div key={inst.id} className="group relative overflow-hidden rounded-[2.5rem] border-2 border-transparent bg-white p-8 shadow-sm transition hover:border-primary">
                  <div className="absolute left-0 top-0 h-32 w-32 -translate-x-10 -translate-y-10 rounded-full bg-primary/5 transition-transform group-hover:scale-150" />
                  <div className="relative z-10">
                    <div className="mb-6 flex items-start justify-between">
                      <div className="rounded-3xl bg-gray-100 p-4 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                        <Shield size={32} />
                      </div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700 uppercase">
                        {inst.primaryCurrency}
                      </span>
                    </div>

                    <h3 className="mb-1 text-2xl font-black text-gray-900">{inst.name}</h3>
                    <p className="truncate text-sm text-gray-500">{inst.address || 'بدون عنوان مسجل'}</p>
                    <p className="mt-2 text-[10px] font-mono text-gray-400">id: {inst.id}</p>

                    <button
                      type="button"
                      onClick={() => activateInstitution(inst.id)}
                      className="mt-8 flex items-center gap-2 font-black text-primary transition-transform group-hover:translate-x-[-5px]"
                    >
                      تفعيل هذه الشركة
                      <ChevronLeft size={20} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrgManager;
