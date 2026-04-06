import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Boxes, ChevronDown, ChevronLeft, DatabaseBackup, KeyRound, LogOut, Monitor, RefreshCw, ShieldCheck } from 'lucide-react';
import BackupManager from '../components/settings/BackupManager';
import { apiRequest } from '../lib/api';
import { recognizeLicenseMissionFromCode } from '../lib/licenseMission';
import { clearSuperAdminSession, getStoredSuperAdminUser } from '../lib/superAdminSession';
import { navigateToCompanyRoute } from '../lib/companySession';
import { buildControlMatrix, deriveLegacyTabOverrides } from '../lib/systemModules';

type DashboardData = any;
type ActiveTab = 'dashboard' | 'license' | 'modules' | 'backups' | 'diagnostics';

const shellTabs: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'الملخص', icon: <ShieldCheck size={18} /> },
  { id: 'license', label: 'الترخيص', icon: <KeyRound size={18} /> },
  { id: 'modules', label: 'الوحدات', icon: <Boxes size={18} /> },
  { id: 'backups', label: 'النسخ', icon: <DatabaseBackup size={18} /> },
  { id: 'diagnostics', label: 'التشخيصات', icon: <Monitor size={18} /> },
];

const TEXT = {
  loadError: '\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0644\u0648\u062d\u0629 \u0627\u0644\u0645\u0634\u0631\u0641 \u0627\u0644\u0639\u0627\u0645.',
  saveError: '\u062a\u0639\u0630\u0631 \u062d\u0641\u0638 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0648\u062d\u062f\u0627\u062a.',
  applyError: '\u062a\u0639\u0630\u0631 \u062a\u0637\u0628\u064a\u0642 \u0631\u0645\u0632 \u0627\u0644\u062a\u0648\u0633\u0639\u0629.',
  moduleControlTitle: '\u0627\u0644\u062a\u062d\u0643\u0645 \u0628\u0627\u0644\u0648\u062d\u062f\u0627\u062a',
  moduleControlSubtitle: '\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u064a \u064a\u0628\u0642\u0649 \u062e\u0637 \u0627\u0644\u0623\u0633\u0627\u0633\u060c \u0648\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062d\u0629 \u062a\u0637\u0628\u0642 \u062a\u062c\u0627\u0648\u0632\u0627\u062a \u062a\u0641\u0635\u064a\u0644\u064a\u0629 \u0644\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0646\u0638\u0627\u0645.',
  saveControl: '\u062d\u0641\u0638 \u0627\u0644\u062a\u062d\u0643\u0645',
  saving: '\u062c\u0627\u0631\u064a \u0627\u0644\u062d\u0641\u0638...',
  loadingStructure: '\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0647\u064a\u0643\u0644...',
  overrideInherit: '\u0645\u0648\u0631\u0648\u062b',
  overrideEnable: '\u0641\u0631\u0636 \u062a\u0641\u0639\u064a\u0644',
  overrideDisable: '\u0641\u0631\u0636 \u0625\u062e\u0641\u0627\u0621',
  effectiveVisible: '\u0638\u0627\u0647\u0631',
  effectiveHidden: '\u0645\u062e\u0641\u064a',
  baselineVisible: '\u0623\u0633\u0627\u0633: \u0638\u0627\u0647\u0631',
  baselineHidden: '\u0623\u0633\u0627\u0633: \u0645\u062e\u0641\u064a',
  overrideLabel: '\u0627\u0644\u062a\u062c\u0627\u0648\u0632',
  effectiveLabel: '\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629',
  reasonLabel: '\u0627\u0644\u0633\u0628\u0628',
  reasonProfile: '\u0645\u0646 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0623\u0633\u0627\u0633\u064a',
  reasonProfileHidden: '\u0645\u062e\u0641\u064a \u0641\u064a \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0623\u0633\u0627\u0633\u064a',
  reasonForcedEnabled: '\u0645\u062c\u0628\u0648\u0631 \u0641\u062a\u062d',
  reasonForcedHidden: '\u0645\u062c\u0628\u0648\u0631 \u0625\u062e\u0641\u0627\u0621',
  reasonParentHidden: '\u0645\u062e\u0641\u064a \u0628\u0633\u0628\u0628 \u0627\u0644\u0623\u0628',
  reasonParentForcedHidden: '\u0645\u062c\u0628\u0648\u0631 \u0625\u062e\u0641\u0627\u0621 \u0628\u0633\u0628\u0628 \u0627\u0644\u0623\u0628',
  kindGroup: '\u0642\u0633\u0645',
  kindTab: '\u0635\u0641\u062d\u0629',
  kindSetting: '\u0625\u0639\u062f\u0627\u062f',
  expand: '\u062a\u0648\u0633\u064a\u0639',
  collapse: '\u0637\u064a',
};

interface Props {
  onLogout: () => void;
}

const SuperAdminConsole: React.FC<Props> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [data, setData] = useState<DashboardData | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [licenseData, setLicenseData] = useState<any>(null);
  const [moduleData, setModuleData] = useState<any>(null);
  const [extensionCode, setExtensionCode] = useState('');
  const [isSavingModules, setIsSavingModules] = useState(false);
  const [isApplyingCode, setIsApplyingCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const user = getStoredSuperAdminUser();

  const loadAll = async () => {
    const [dashboard, license, modules, diagnosticsRes] = await Promise.all([
      apiRequest('super-admin/dashboard'),
      apiRequest('super-admin/license'),
      apiRequest('super-admin/module-control'),
      apiRequest('super-admin/diagnostics'),
    ]);
    setData(dashboard);
    setLicenseData(license);
    setModuleData(modules);
    setDiagnostics(diagnosticsRes);
  };

  useEffect(() => {
    loadAll().catch((error) => {
      setErrorMsg(error?.message || TEXT.loadError);
    });
  }, []);

  const controlMatrix = useMemo(() => {
    if (!moduleData?.projectProfile) return null;
    return buildControlMatrix(moduleData.projectProfile.id, moduleData.moduleControl);
  }, [moduleData]);

  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!controlMatrix) return;
    setExpandedNodes((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, boolean> = {};
      controlMatrix.tree.forEach((node) => {
        next[node.id] = true;
      });
      return next;
    });
  }, [controlMatrix]);

  const setNodeOverride = (nodeId: string, override: 'enabled' | 'disabled' | 'inherit') => {
    if (!moduleData) return;
    const current = moduleData.moduleControl?.nodeOverrides || {};
    const next = { ...current };
    if (override === 'inherit') {
      delete next[nodeId];
    } else {
      next[nodeId] = override;
    }
    setModuleData({
      ...moduleData,
      moduleControl: {
        ...(moduleData.moduleControl || {}),
        nodeOverrides: next,
      },
    });
  };

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const reasonLabels: Record<string, string> = {
    forced_enabled: TEXT.reasonForcedEnabled,
    forced_hidden: TEXT.reasonForcedHidden,
    parent_forced_hidden: TEXT.reasonParentForcedHidden,
    parent_hidden: TEXT.reasonParentHidden,
    profile: TEXT.reasonProfile,
    profile_hidden: TEXT.reasonProfileHidden,
  };

  const saveModules = async () => {
    if (!moduleData) return;
    setIsSavingModules(true);
    setErrorMsg(null);
    try {
      const nodeOverrides = moduleData.moduleControl?.nodeOverrides || {};
      const legacyOverrides = deriveLegacyTabOverrides(nodeOverrides);
      const payload = {
        ...(moduleData.moduleControl || {}),
        ...legacyOverrides,
        nodeOverrides,
      };
      const response = await apiRequest('super-admin/module-control', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setModuleData((current: any) => ({ ...current, moduleControl: response.moduleControl }));
      await loadAll();
    } catch (error: any) {
      setErrorMsg(error?.message || TEXT.saveError);
    } finally {
      setIsSavingModules(false);
    }
  };

  const applyExtension = async () => {
    const normalized = extensionCode.trim().toUpperCase();
    if (!normalized) return;
    setIsApplyingCode(true);
    setErrorMsg(null);
    try {
      if (recognizeLicenseMissionFromCode(normalized)) {
        await apiRequest('activation/activate', {
          method: 'POST',
          body: JSON.stringify({ code: normalized }),
        });
      } else {
        await apiRequest('super-admin/license/apply', {
          method: 'POST',
          body: JSON.stringify({ code: normalized }),
        });
      }
      setExtensionCode('');
      await loadAll();
    } catch (error: any) {
      setErrorMsg(error?.message || TEXT.applyError);
    } finally {
      setIsApplyingCode(false);
    }
  };

  const handleLogout = () => {
    clearSuperAdminSession();
    navigateToCompanyRoute('login');
    onLogout();
  };

  const getKindLabel = (kind: string) => {
    if (kind === 'setting') return TEXT.kindSetting;
    if (kind === 'tab') return TEXT.kindTab;
    return TEXT.kindGroup;
  };

  const getOverrideLabel = (override: 'enabled' | 'disabled' | 'inherit') => {
    if (override === 'enabled') return TEXT.overrideEnable;
    if (override === 'disabled') return TEXT.overrideDisable;
    return TEXT.overrideInherit;
  };

  const renderNode = (node: any, depth: number) => {
    const state = controlMatrix?.states?.[node.id];
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const expanded = expandedNodes[node.id] ?? false;
    const override = (state?.override || 'inherit') as 'enabled' | 'disabled' | 'inherit';
    const effectiveLabel = state?.effectiveVisible ? TEXT.effectiveVisible : TEXT.effectiveHidden;
    const baselineLabel = state?.baselineVisible ? TEXT.baselineVisible : TEXT.baselineHidden;
    const reasonLabel = state?.reason ? reasonLabels[state.reason] : '';

    return (
      <React.Fragment key={node.id}>
        <div className="border-b border-slate-100 last:border-b-0">
          <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4" style={{ paddingInlineStart: depth * 18 }}>
            <div className="flex flex-1 items-start gap-3">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleExpanded(node.id)}
                  className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"
                  aria-label={expanded ? TEXT.collapse : TEXT.expand}
                >
                  {expanded ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                </button>
              ) : (
                <div className="mt-1 h-7 w-7" />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-black text-slate-900">{node.label}</div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{getKindLabel(node.kind)}</span>
                </div>
                {node.description ? (
                  <div className="mt-1 text-xs font-semibold text-slate-500">{node.description}</div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-600">
                  <span className={`rounded-full px-2 py-1 ${state?.baselineVisible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {baselineLabel}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${
                    override === 'inherit'
                      ? 'bg-slate-100 text-slate-600'
                      : override === 'enabled'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700'
                  }`}
                  >
                    {TEXT.overrideLabel}: {getOverrideLabel(override)}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${state?.effectiveVisible ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {TEXT.effectiveLabel}: {effectiveLabel}
                  </span>
                  {reasonLabel ? (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                      {TEXT.reasonLabel}: {reasonLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['inherit', 'enabled', 'disabled'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNodeOverride(node.id, value)}
                  className={`rounded-full px-3 py-2 text-xs font-black transition ${
                    override === value
                      ? value === 'enabled'
                        ? 'bg-emerald-600 text-white'
                        : value === 'disabled'
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {getOverrideLabel(value)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {hasChildren && expanded ? node.children.map((child: any) => renderNode(child, depth + 1)) : null}
      </React.Fragment>
    );
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc,#eef2ff)] p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">System Control Layer</div>
            <h1 className="mt-1 text-3xl font-black">Super Admin Console</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              حساب معزول عن الشركة لإدارة الترخيص والوحدات والنسخ الاحتياطي وتشخيصات التثبيت.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600">
              {user?.displayName || user?.username}
            </div>
            <button
              type="button"
              onClick={() => loadAll().catch(() => undefined)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              تحديث
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-black"
            >
              <LogOut size={16} />
              خروج
            </button>
          </div>
        </div>

        {errorMsg ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{errorMsg}</div>
        ) : null}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-3">
            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="space-y-2">
                {shellTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-right text-sm font-black transition ${
                      activeTab === tab.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-9">
            {activeTab === 'dashboard' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[
                  ['الترخيص الحالي', data?.activation?.missionLabel || 'غير مفعل'],
                  ['الملف التشغيلي', data?.projectProfile?.id || 'غير محدد'],
                  ['وضع النشر', data?.deployment ? `${data.deployment.mode} / ${data.deployment.role}` : 'غير محدد'],
                  ['آخر نسخة احتياطية', data?.lastBackup?.name || 'لا يوجد'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">{label}</div>
                    <div className="mt-3 text-xl font-black text-slate-900">{value}</div>
                  </div>
                ))}
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
                  <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">الوحدات الفعالة</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(data?.modules || []).filter((entry: any) => entry.enabled).map((entry: any) => (
                      <span key={entry.id} className="rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">{entry.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'license' && (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Base License</div>
                      <div className="mt-2 text-lg font-black">{licenseData?.baseLicense?.missionLabel || 'غير مفعل'}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">{licenseData?.baseLicense?.code || 'لا يوجد رمز مفعل'}</div>
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Project Profile</div>
                      <div className="mt-2 text-lg font-black">{licenseData?.projectProfile?.id || 'غير محدد'}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black">إضافة رمز توسعة</div>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    يتم تطبيق التوسعات بشكل إضافي دون مسح الترخيص الأساسي أو بيانات العميل.
                  </p>
                  <div className="mt-4 flex flex-col gap-3 md:flex-row">
                    <input
                      value={extensionCode}
                      onChange={(e) => setExtensionCode(e.target.value.toUpperCase())}
                      className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono font-bold outline-none focus:border-slate-400"
                      placeholder="EXT-REST-XXXX"
                    />
                    <button
                      type="button"
                      onClick={applyExtension}
                      disabled={isApplyingCode}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-black disabled:opacity-60"
                    >
                      {isApplyingCode ? 'جارٍ التطبيق...' : 'تطبيق الرمز'}
                    </button>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black">التوسعات المثبتة</div>
                  <div className="mt-4 space-y-3">
                    {(licenseData?.extensions || []).length === 0 ? (
                      <div className="text-sm font-semibold text-slate-500">لا توجد توسعات مطبقة.</div>
                    ) : (
                      (licenseData?.extensions || []).map((entry: any) => (
                        <div key={entry.code} className="rounded-2xl bg-slate-50 px-4 py-3">
                          <div className="font-black">{entry.label}</div>
                          <div className="text-sm font-semibold text-slate-500">{entry.code}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'modules' && (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-black">{TEXT.moduleControlTitle}</div>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{TEXT.moduleControlSubtitle}</p>
                    </div>
                    <button
                      type="button"
                      onClick={saveModules}
                      disabled={isSavingModules}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-black disabled:opacity-60"
                    >
                      {isSavingModules ? TEXT.saving : TEXT.saveControl}
                    </button>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  {controlMatrix ? (
                    controlMatrix.tree.map((node: any) => renderNode(node, 0))
                  ) : (
                    <div className="p-6 text-sm font-semibold text-slate-500">{TEXT.loadingStructure}</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'backups' && (
              <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                  الاستعادة عملية محمية ومخصصة للمشرف العام فقط. تأكد من إيقاف العمل قبل إعادة قاعدة البيانات.
                </div>
                <BackupManager />
              </div>
            )}

            {activeTab === 'diagnostics' && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    ['الإصدار', diagnostics?.runtime?.version || 'unknown'],
                    ['بيئة التشغيل', diagnostics?.runtime?.nodeEnv || 'unknown'],
                    ['وضع النشر', diagnostics?.deployment ? `${diagnostics.deployment.mode} / ${diagnostics.deployment.role}` : 'غير محدد'],
                    ['مهمة الترخيص', diagnostics?.activationMissionLabel || 'غير محددة'],
                    ['قوة السر', diagnostics?.runtime?.secretStrength || 'unknown'],
                    ['مسار قاعدة البيانات', diagnostics?.runtime?.dbPath || 'unknown'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">{label}</div>
                      <div className="mt-3 break-all text-base font-black text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-black">
                    <Activity size={16} />
                    وحدات النظام الفعالة حالياً
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(data?.modules || []).filter((entry: any) => entry.enabled).map((entry: any) => (
                      <span key={entry.id} className="rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">{entry.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminConsole;




