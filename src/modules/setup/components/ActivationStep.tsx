import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  Building2,
  CheckCircle2,
  Cloud,
  CloudOff,
  FlaskConical,
  HardDrive,
  Key,
  Loader2,
  MapPin,
  MonitorSmartphone,
  Phone,
  Server,
  ServerCog,
  ShieldCheck,
  User,
} from 'lucide-react';
import { getStoredServerIP } from '../../../lib/api';
import {
  getLicenseMissionDefinition,
  getLicenseMissionLabel,
  recognizeLicenseMissionFromCode,
  type LicenseMission,
} from '../../../lib/licenseMission';
import {
  ACTIVATION_PROVINCES,
  checkActivationServer,
  runActivationFlow,
  type ActivationFormFields,
} from '../activationService';

export const ACTIVATION_TYPE_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  local: { label: 'تفعيل محلي', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: <HardDrive size={18} /> },
  cloud: { label: 'سحابي مؤجل', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: <Cloud size={18} /> },
  trial: { label: 'تجريبي', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: <FlaskConical size={18} /> },
  branch: { label: 'طرفية فرعية', color: 'text-violet-600 bg-violet-50 border-violet-200', icon: <MonitorSmartphone size={18} /> },
};

export interface ActivationStepProps {
  variant: 'page' | 'wizard';
  onActivationSuccess: (activationType: string, activationMission?: LicenseMission) => void;
}

const emptyFields = (): ActivationFormFields => ({
  code: '',
  orgName: '',
  businessDomain: '',
  activatorName: '',
  activatorPhone: '',
  province: '',
  activationMethod: '',
  serverHost: '',
});

const W = {
  section: 'rounded-2xl border border-gray-700/90 bg-gray-900/25 p-6 sm:p-8 shadow-inner shadow-black/20',
  sectionGap: 'mt-8 sm:mt-10',
  title: 'text-sm font-black text-white tracking-tight border-b border-gray-700/80 pb-3 mb-6',
  fieldGap: 'grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-5',
  label: 'block text-xs font-bold text-gray-400 mb-2',
  input:
    'w-full py-3.5 px-4 pr-11 bg-gray-800/90 border border-gray-600/80 rounded-xl text-sm font-bold text-white placeholder:text-gray-600 outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/40',
  inputMono:
    'w-full py-4 px-4 bg-gray-800/90 border-2 border-gray-600/80 rounded-2xl font-mono font-bold text-center text-base tracking-widest text-white placeholder:text-gray-600 outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/40',
  select:
    'w-full py-3.5 px-4 pr-11 bg-gray-800/90 border border-gray-600/80 rounded-xl text-sm font-bold text-white outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/40 appearance-none cursor-pointer',
  iconIn: 'pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500',
  cta: 'w-full min-h-[56px] mt-8 pt-8 border-t border-gray-700/80',
  ctaBtn:
    'w-full min-h-[52px] rounded-2xl bg-primary text-white font-black text-base shadow-lg shadow-primary/25 hover:brightness-110 active:scale-[0.99] transition flex items-center justify-center gap-3 disabled:opacity-50 disabled:pointer-events-none',
};

const getMissionIcon = (mission: LicenseMission | null) => {
  switch (mission) {
    case 'LOCAL_NETWORK_HOST':
      return ServerCog;
    case 'LOCAL_NETWORK_TERMINAL':
      return MonitorSmartphone;
    case 'CLOUD_PLACEHOLDER':
      return CloudOff;
    case 'TRIAL':
      return FlaskConical;
    default:
      return HardDrive;
  }
};

const ActivationStep: React.FC<ActivationStepProps> = ({ variant, onActivationSuccess }) => {
  const [fields, setFields] = useState<ActivationFormFields>(() => {
    const stored = getStoredServerIP();
    const initialServer = !stored || stored === 'localhost' || stored === '127.0.0.1' ? '' : stored || '';
    return { ...emptyFields(), serverHost: initialServer };
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activatedType, setActivatedType] = useState<string | null>(null);
  const [activatedMission, setActivatedMission] = useState<LicenseMission | null>(null);

  const recognizedMission = useMemo(() => recognizeLicenseMissionFromCode(fields.code)?.mission || null, [fields.code]);
  const recognizedMissionDefinition = getLicenseMissionDefinition(recognizedMission);
  const requiresServer = recognizedMissionDefinition.requiresHostAddress;
  const MissionIcon = getMissionIcon(recognizedMission);
  const isWizard = variant === 'wizard';

  const setField = <K extends keyof ActivationFormFields>(key: K, value: ActivationFormFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleCheckServer = async () => {
    setIsCheckingServer(true);
    setServerStatus('idle');
    setServerMsg(null);
    try {
      const res = await checkActivationServer(fields.serverHost);
      setServerStatus(res.ok ? 'ok' : 'fail');
      setServerMsg(res.message);
    } catch (e) {
      console.warn('[activation] server check failed', e);
      setServerStatus('fail');
      setServerMsg('فشل التحقق من المضيف.');
    } finally {
      setIsCheckingServer(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    setIsLoading(true);
    try {
      const result = await runActivationFlow(fields);
      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }

      const type = result.activationType;
      const mission = result.activationMission;
      const typeLabel = ACTIVATION_TYPE_INFO[type]?.label || type;
      const missionLabel = getLicenseMissionLabel(mission);

      setActivatedType(type);
      setActivatedMission(mission);
      setSuccessMsg(`تم التعرف على ${missionLabel} وتفعيل النظام بنجاح. (${typeLabel})`);

      if (variant === 'wizard') {
        onActivationSuccess(type, mission);
        return;
      }

      const delay = type !== 'local' && type !== 'trial' ? 2000 : 600;
      setTimeout(() => {
        onActivationSuccess(type, mission);
      }, delay);
    } finally {
      setIsLoading(false);
    }
  };

  const typeInfo = activatedType ? ACTIVATION_TYPE_INFO[activatedType] : null;

  const renderMissionCard = (dark: boolean) => (
    <div className={dark ? 'rounded-2xl border border-gray-700/70 bg-gray-950/40 p-4 mb-6' : 'mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4'}>
      <div className="flex items-start gap-3">
        <div className={`rounded-xl p-2 ${dark ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>
          <MissionIcon size={18} />
        </div>
        <div className="space-y-1.5">
          <div className={dark ? 'text-xs font-black text-white' : 'text-xs font-black text-slate-900'}>طبقة ذكاء الترخيص</div>
          <div className="text-xs font-bold text-primary">
            {recognizedMission ? getLicenseMissionLabel(recognizedMission) : 'سيتم التعرف على المهمة من الرمز'}
          </div>
          <p className={dark ? 'text-[11px] leading-6 text-gray-400' : 'text-[12px] leading-6 text-slate-600'}>
            {recognizedMission
              ? recognizedMissionDefinition.operatorSummary
              : 'رمز التفعيل يحدد المسار التشغيلي للجهاز: مستقل أو مضيف شبكة أو طرفية أو تجربة أو مسار سحابي مؤجل.'}
          </p>
          <p className={dark ? 'text-[11px] leading-6 text-gray-500' : 'text-[12px] leading-6 text-slate-500'}>
            {recognizedMission
              ? recognizedMissionDefinition.nextStepSummary
              : 'لن تحتاج لاختيار نوع الترخيص يدوياً. سيتم توجيه الإعداد تلقائياً بعد قراءة الرمز.'}
          </p>
        </div>
      </div>
    </div>
  );

  const serverPanel = requiresServer && (
    <div className={isWizard ? 'rounded-xl border border-gray-600/60 bg-gray-950/40 p-5 space-y-4' : 'space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4'}>
      <div className={`flex items-center gap-2 ${isWizard ? 'text-gray-400' : 'text-slate-500'}`}>
        <Server size={16} className="shrink-0 opacity-80" />
        <span className={isWizard ? 'text-xs font-bold' : 'text-[10px] font-black uppercase tracking-widest'}>عنوان المضيف</span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          dir="ltr"
          type="text"
          value={fields.serverHost}
          onChange={(e) => {
            setField('serverHost', e.target.value);
            setServerStatus('idle');
            setServerMsg(null);
          }}
          className={
            isWizard
              ? 'flex-1 min-h-[48px] px-4 py-3 bg-gray-800/90 border border-gray-600/80 rounded-xl font-mono font-bold text-sm text-white outline-none focus:border-primary'
              : 'w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-left font-mono font-bold text-sm outline-none transition-all focus:border-amber-500'
          }
          placeholder="مثال: 10.0.0.2 أو server.local"
        />
        <button
          type="button"
          onClick={handleCheckServer}
          disabled={isCheckingServer}
          className={
            isWizard
              ? 'shrink-0 rounded-xl bg-gray-700 px-6 py-3 text-xs font-black text-white transition hover:bg-gray-600 disabled:opacity-60 min-h-[48px]'
              : 'rounded-xl bg-slate-800 px-4 py-3 text-xs font-black text-white transition hover:bg-black disabled:opacity-60'
          }
        >
          {isCheckingServer ? 'جارٍ التحقق...' : 'تحقق'}
        </button>
      </div>
      <p className={isWizard ? 'text-[11px] text-gray-500 leading-relaxed' : 'text-[10px] text-slate-400 font-bold'}>
        هذا الترخيص مخصص لطرفية مرتبطة بمضيف جاهز داخل نفس الموقع.
      </p>
      {serverMsg ? (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-bold ${
            serverStatus === 'ok'
              ? isWizard
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : isWizard
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {serverMsg}
        </div>
      ) : null}
    </div>
  );

  const pageInput = 'w-full py-3.5 px-4 pr-11 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
  const pageSelect = 'w-full py-3.5 px-4 pr-11 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 appearance-none cursor-pointer';
  const pageLabel = 'block text-xs font-bold text-slate-600 mb-2';
  const pageIcon = 'pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400';

  if (isWizard) {
    return (
      <div className="animate-fadeIn">
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex p-2.5 bg-primary/15 text-primary rounded-xl mb-3 ring-1 ring-primary/20">
            <Key size={26} className="opacity-95" />
          </div>
          <h3 className="text-lg sm:text-xl font-black text-white tracking-tight">تفعيل البرنامج</h3>
          <p className="text-gray-500 text-xs sm:text-sm mt-2 max-w-sm mx-auto leading-relaxed">
            أدخل بيانات الجهة المسؤولة ثم رمز التفعيل. النظام سيقرأ مهمة الترخيص ويحدد مسار الإعداد المناسب لهذا الجهاز.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-0">
          <section className={W.section}>
            <h4 className={W.title}>1 — الترخيص والتوجيه</h4>
            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
              <div className="flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/25">
                <HardDrive size={20} className="text-emerald-400" />
                <span className="text-[10px] sm:text-[11px] font-black text-emerald-300/95 text-center leading-tight">Standalone</span>
                <span className="text-[9px] text-emerald-500/70 font-mono">ALM-...</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl bg-blue-500/[0.08] border border-blue-500/25">
                <ServerCog size={20} className="text-blue-400" />
                <span className="text-[10px] sm:text-[11px] font-black text-blue-300/95 text-center leading-tight">Host</span>
                <span className="text-[9px] text-blue-500/70 font-mono">ALM-HST-...</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl bg-violet-500/[0.08] border border-violet-500/25">
                <MonitorSmartphone size={20} className="text-violet-400" />
                <span className="text-[10px] sm:text-[11px] font-black text-violet-300/95 text-center leading-tight">Terminal</span>
                <span className="text-[9px] text-violet-500/70 font-mono">ALM-TRM-...</span>
              </div>
            </div>

            {renderMissionCard(true)}
            {serverPanel}

            <div className={requiresServer ? 'mt-6' : ''}>
              <label className={W.label}>رمز التفعيل</label>
              <div className="relative mt-2">
                <Key className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  dir="ltr"
                  type="text"
                  value={fields.code}
                  onChange={(e) => {
                    setField('code', e.target.value.toUpperCase());
                    setErrorMsg(null);
                  }}
                  className={`${W.inputMono} pr-12`}
                  placeholder="XXXX-XXXX-XXXX"
                  maxLength={30}
                  autoFocus
                />
              </div>
            </div>
          </section>

          <section className={`${W.section} ${W.sectionGap}`}>
            <h4 className={W.title}>2 — معلومات المنشأة</h4>
            <div className={W.fieldGap}>
              <div>
                <label className={W.label}>اسم المؤسسة</label>
                <div className="relative mt-2">
                  <Building2 className={W.iconIn} size={16} />
                  <input type="text" value={fields.orgName} onChange={(e) => setField('orgName', e.target.value)} className={W.input} placeholder="مثال: شركة النور للتجارة" />
                </div>
              </div>
              <div>
                <label className={W.label}>مجال العمل / النشاط</label>
                <div className="relative mt-2">
                  <Briefcase className={W.iconIn} size={16} />
                  <input type="text" value={fields.businessDomain} onChange={(e) => setField('businessDomain', e.target.value)} className={W.input} placeholder="مثال: تجارة عامة، مطعم، مستودع..." />
                </div>
              </div>
            </div>
          </section>

          <section className={`${W.section} ${W.sectionGap}`}>
            <h4 className={W.title}>3 — المسؤول والتواصل</h4>
            <div className={W.fieldGap}>
              <div>
                <label className={W.label}>المسؤول عن التفعيل</label>
                <div className="relative mt-2">
                  <User className={W.iconIn} size={16} />
                  <input type="text" value={fields.activatorName} onChange={(e) => setField('activatorName', e.target.value)} className={W.input} placeholder="الاسم الكامل" />
                </div>
              </div>
              <div>
                <label className={W.label}>رقم الهاتف</label>
                <div className="relative mt-2">
                  <Phone className={W.iconIn} size={16} />
                  <input type="tel" dir="ltr" value={fields.activatorPhone} onChange={(e) => setField('activatorPhone', e.target.value)} className={`${W.input} text-left`} placeholder="09XXXXXXXX" />
                </div>
              </div>
              <div>
                <label className={W.label}>المحافظة</label>
                <div className="relative mt-2">
                  <MapPin className={W.iconIn} size={16} />
                  <select value={fields.province} onChange={(e) => setField('province', e.target.value)} className={W.select}>
                    <option value="">اختر المحافظة</option>
                    {ACTIVATION_PROVINCES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={W.label}>طريقة التفعيل</label>
                <div className="relative mt-2">
                  <Phone className={W.iconIn} size={16} />
                  <input type="text" value={fields.activationMethod} onChange={(e) => setField('activationMethod', e.target.value)} className={W.input} placeholder="مثال: واتساب، زيارة، هاتف" />
                </div>
              </div>
            </div>
          </section>

          {errorMsg ? (
            <div className="flex items-start gap-3 bg-red-500/10 text-red-300 px-5 py-4 rounded-2xl border border-red-500/25 mt-8">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <span className="text-sm font-bold leading-relaxed">{errorMsg}</span>
            </div>
          ) : null}

          {successMsg && typeInfo ? (
            <div className={`flex items-center gap-3 px-5 py-4 rounded-2xl border mt-8 ${typeInfo.color}`}>
              {typeInfo.icon}
              <div className="space-y-1">
                <span className="block text-sm font-bold">{successMsg}</span>
                {activatedMission ? <span className="block text-xs font-semibold opacity-80">{getLicenseMissionDefinition(activatedMission).nextStepSummary}</span> : null}
              </div>
            </div>
          ) : null}

          {!typeInfo && successMsg ? (
            <div className="flex items-center gap-3 bg-emerald-500/10 text-emerald-300 px-5 py-4 rounded-2xl border border-emerald-500/25 mt-8">
              <CheckCircle2 size={20} className="shrink-0" />
              <span className="text-sm font-bold">{successMsg}</span>
            </div>
          ) : null}

          <div className={W.cta}>
            <button type="submit" disabled={isLoading || !!successMsg} className={W.ctaBtn}>
              {isLoading ? <Loader2 className="animate-spin" size={22} /> : <ShieldCheck size={22} />}
              <span>{successMsg ? 'تم التفعيل' : 'تفعيل البرنامج'}</span>
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 font-sans" dir="rtl">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex p-4 bg-primary text-white rounded-2xl shadow-lg shadow-primary/25">
            <ShieldCheck size={36} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">تفعيل البرنامج</h1>
          <p className="text-slate-600 font-bold text-sm">نقطة التفعيل الذكية لتحديد مسار الجهاز قبل بدء الإعداد</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/80 border border-slate-200/90 overflow-hidden">
          <div className="px-6 sm:px-10 pt-8 pb-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                <HardDrive size={22} className="text-emerald-600" />
                <span className="text-[11px] font-black text-emerald-800">Standalone</span>
                <span className="text-[9px] text-emerald-600 font-mono">ALM-...</span>
              </div>
              <div className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-blue-50 border border-blue-100">
                <ServerCog size={22} className="text-blue-600" />
                <span className="text-[11px] font-black text-blue-800">Host</span>
                <span className="text-[9px] text-blue-600 font-mono">ALM-HST-...</span>
              </div>
              <div className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-violet-50 border border-violet-100">
                <MonitorSmartphone size={22} className="text-violet-600" />
                <span className="text-[11px] font-black text-violet-800">Terminal</span>
                <span className="text-[9px] text-violet-600 font-mono">ALM-TRM-...</span>
              </div>
            </div>
            {renderMissionCard(false)}
          </div>

          <form onSubmit={handleSubmit} className="px-6 sm:px-10 pb-10 space-y-10">
            <section className="pt-2 border-t border-slate-100">
              <h2 className="text-sm font-black text-slate-800 border-b border-slate-200 pb-3 mb-6">1 — الترخيص</h2>
              {serverPanel}
              <div className={requiresServer ? 'mt-6' : 'mt-2'}>
                <label className="block text-xs font-bold text-slate-500 mb-2">رمز التفعيل</label>
                <div className="relative group">
                  <Key className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary" size={20} />
                  <input
                    dir="ltr"
                    type="text"
                    value={fields.code}
                    onChange={(e) => {
                      setField('code', e.target.value.toUpperCase());
                      setErrorMsg(null);
                    }}
                    className="w-full pr-12 pl-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:border-amber-500 focus:bg-white font-mono font-bold text-center text-lg tracking-widest transition-all shadow-inner"
                    placeholder="XXXX-XXXX-XXXX"
                    maxLength={30}
                    autoFocus
                  />
                </div>
              </div>
            </section>

            <section className="border-t border-slate-100 pt-10">
              <h2 className="text-sm font-black text-slate-800 border-b border-slate-200 pb-3 mb-6">2 — معلومات المنشأة</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-6">
                <div>
                  <label className={pageLabel}>اسم المؤسسة</label>
                  <div className="relative mt-2">
                    <Building2 className={pageIcon} size={16} />
                    <input type="text" value={fields.orgName} onChange={(e) => setField('orgName', e.target.value)} className={pageInput} placeholder="مثال: شركة النور للتجارة" />
                  </div>
                </div>
                <div>
                  <label className={pageLabel}>مجال العمل / النشاط</label>
                  <div className="relative mt-2">
                    <Briefcase className={pageIcon} size={16} />
                    <input type="text" value={fields.businessDomain} onChange={(e) => setField('businessDomain', e.target.value)} className={pageInput} placeholder="مثال: تجارة عامة، مطعم، مستودع..." />
                  </div>
                </div>
              </div>
            </section>

            <section className="border-t border-slate-100 pt-10">
              <h2 className="text-sm font-black text-slate-800 border-b border-slate-200 pb-3 mb-6">3 — المسؤول والتواصل</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-6">
                <div>
                  <label className={pageLabel}>المسؤول عن التفعيل</label>
                  <div className="relative mt-2">
                    <User className={pageIcon} size={16} />
                    <input type="text" value={fields.activatorName} onChange={(e) => setField('activatorName', e.target.value)} className={pageInput} placeholder="الاسم الكامل" />
                  </div>
                </div>
                <div>
                  <label className={pageLabel}>رقم الهاتف</label>
                  <div className="relative mt-2">
                    <Phone className={pageIcon} size={16} />
                    <input type="tel" dir="ltr" value={fields.activatorPhone} onChange={(e) => setField('activatorPhone', e.target.value)} className={`${pageInput} text-left`} placeholder="09XXXXXXXX" />
                  </div>
                </div>
                <div>
                  <label className={pageLabel}>المحافظة</label>
                  <div className="relative mt-2">
                    <MapPin className={pageIcon} size={16} />
                    <select value={fields.province} onChange={(e) => setField('province', e.target.value)} className={pageSelect}>
                      <option value="">اختر المحافظة</option>
                      {ACTIVATION_PROVINCES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={pageLabel}>طريقة التفعيل</label>
                  <div className="relative mt-2">
                    <Phone className={pageIcon} size={16} />
                    <input type="text" value={fields.activationMethod} onChange={(e) => setField('activationMethod', e.target.value)} className={pageInput} placeholder="مثال: واتساب، زيارة، هاتف" />
                  </div>
                </div>
              </div>
            </section>

            {errorMsg ? (
              <div className="flex items-start gap-3 bg-red-50 text-red-700 px-5 py-4 rounded-2xl border border-red-100">
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <span className="text-sm font-bold leading-relaxed">{errorMsg}</span>
              </div>
            ) : null}

            {successMsg && typeInfo ? (
              <div className={`flex items-center gap-3 px-5 py-4 rounded-2xl border ${typeInfo.color}`}>
                {typeInfo.icon}
                <div className="space-y-1">
                  <span className="block text-sm font-bold">{successMsg}</span>
                  {activatedMission ? <span className="block text-xs font-semibold opacity-80">{getLicenseMissionDefinition(activatedMission).nextStepSummary}</span> : null}
                </div>
              </div>
            ) : null}

            {!typeInfo && successMsg ? (
              <div className="flex items-center gap-3 bg-emerald-50 text-emerald-800 px-5 py-4 rounded-2xl border border-emerald-100">
                <CheckCircle2 size={20} className="shrink-0" />
                <span className="text-sm font-bold">{successMsg}</span>
              </div>
            ) : null}

            <div className="pt-8 mt-4 border-t border-slate-100">
              <button type="submit" disabled={isLoading || !!successMsg} className="w-full min-h-[52px] rounded-2xl bg-primary text-white font-black text-base shadow-lg shadow-primary/25 hover:brightness-110 transition flex items-center justify-center gap-3 disabled:opacity-50">
                {isLoading ? (
                  <>
                    <Loader2 size={22} className="animate-spin" />
                    جارٍ التحقق...
                  </>
                ) : successMsg ? (
                  <>
                    <CheckCircle2 size={22} />
                    تم التفعيل بنجاح
                  </>
                ) : (
                  <>
                    <ShieldCheck size={22} />
                    تفعيل البرنامج
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ActivationStep;
