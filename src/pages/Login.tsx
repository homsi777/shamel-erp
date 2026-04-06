import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  User,
  Lock,
  Copy,
  Edit3,
  Building2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { apiRequest, setToken, setApiUrl, getStoredServerIP, checkServerConnection } from '../lib/api';
import { isSyncedMode } from '../lib/appMode';
import { AppUser } from '../types';
import { clearStoredSessionAndCompany, getSelectedCompanyId, navigateToCompanyRoute, setStoredUser } from '../lib/companySession';
import { navigateToSuperAdminConsole, setStoredSuperAdminToken, setStoredSuperAdminUser } from '../lib/superAdminSession';

interface LoginProps {
  onLoginSuccess: (user: AppUser) => void;
}

const TEXT = {
  serverRequired: 'يرجى إدخال عنوان الخادم',
  companyRequired: 'يجب اختيار مؤسسة قبل تسجيل الدخول.',
  genericError: 'تعذر الاتصال حالياً. سيتم إعادة المحاولة تلقائياً عند عودة الاتصال.',
  copiedIp: 'تم نسخ عنوان الـ IP',
  title: 'العالمية للمحاسبة',
  subtitle: 'نظام إدارة متكامل',
  trial: 'نسخة تجريبية — 50 مادة — 100 فاتورة بيع وشراء',
  orgLabel: 'المؤسسة المحددة',
  orgMissingName: 'لم يتم اختيار مؤسسة',
  orgMissingId: 'يجب اختيار مؤسسة قبل المتابعة',
  change: 'تغيير',
  serverLabel: 'عنوان الخادم',
  serverOk: 'متصل وجاهز',
  serverFail: 'غير متصل',
  serverChecking: 'جاري التحقق...',
  serverPlaceholder: 'مثال: 10.0.0.2 أو zerotier.local',
  serverHint: 'أدخل عنوان الخادم المرتبط بنسختك السحابية/الفرعية (ZeroTier أو عنوان داخلي).',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  submit: 'دخول للنظام',
  showPassword: 'إظهار كلمة المرور',
  hidePassword: 'إخفاء كلمة المرور',
  loginLocked: 'تم إيقاف تسجيل الدخول مؤقتاً بعد 3 محاولات فاشلة.',
};

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const isSynced = isSyncedMode();
  const selectedCompanyId = getSelectedCompanyId();
  const selectedCompany = (() => {
    try {
      const raw = localStorage.getItem('shamel_orgs_list');
      const companies = raw ? JSON.parse(raw) : [];
      return companies.find((entry: any) => String(entry?.id || '') === String(selectedCompanyId || '')) || null;
    } catch {
      return null;
    }
  })();

  const [serverIp, setServerIp] = useState(getStoredServerIP() || '');

  const [isLoading, setIsLoading] = useState(false);
  const [pingStatus, setPingStatus] = useState<'success' | 'failed' | 'idle'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockedLoginKey, setLockedLoginKey] = useState('');
  const [lockNow, setLockNow] = useState(() => Date.now());
  const hasCompanySelection = Boolean(selectedCompanyId);
  const activeLoginKey = `${String(selectedCompanyId || '').trim().toLowerCase()}::${username.trim().toLowerCase()}`;
  const isLockedOut = Boolean(lockedUntil && lockedLoginKey === activeLoginKey && lockedUntil > lockNow);
  const lockRemainingSeconds = isLockedOut ? Math.max(0, Math.ceil(((lockedUntil as number) - lockNow) / 1000)) : 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => setLockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  useEffect(() => {
    if (lockedUntil && lockedUntil <= lockNow) {
      setLockedUntil(null);
      setLockedLoginKey('');
    }
  }, [lockedUntil, lockNow]);

  const formatLockTime = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remaining = safeSeconds % 60;
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
  };

  const pingNow = async (ip: string) => {
    if (!ip) return;
    try {
      const res = await checkServerConnection(ip);
      setPingStatus(res ? 'success' : 'failed');
    } catch {
      setPingStatus('failed');
    }
  };

  useEffect(() => {
    if (!isSynced) return;
    if (serverIp) {
      setApiUrl(serverIp);
      setPingStatus('idle');
      const timer = setTimeout(() => pingNow(serverIp), 500);
      return () => clearTimeout(timer);
    }
  }, [serverIp]);

  useEffect(() => {
    if (!isSynced) return;
    if (!serverIp) return;
    if (pingStatus === 'success') return;
    const tick = () => pingNow(serverIp);
    const id = window.setInterval(tick, 4000);
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
    };
  }, [serverIp, pingStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

    try {
      if (!hasCompanySelection) {
        setErrorMsg(TEXT.companyRequired);
        navigateToCompanyRoute('select-company');
        setIsLoading(false);
        return;
      }
      if (isSynced) {
        if (!serverIp.trim()) {
          setErrorMsg(TEXT.serverRequired);
          setIsLoading(false);
          return;
        }
        setApiUrl(serverIp);
      }

      const payload: any = { username: username.trim(), password };
      if (selectedCompanyId) {
        payload.companyId = selectedCompanyId;
      }

      const response = await apiRequest('login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if ((response?.scope === 'super_admin') || response?.user?.scope === 'super_admin') {
        if (response?.token && response?.user) {
          clearStoredSessionAndCompany();
          setStoredSuperAdminToken(response.token);
          setStoredSuperAdminUser(response.user);
          navigateToSuperAdminConsole();
          return;
        }
        throw new Error('SUPER_ADMIN_LOGIN_FAILED');
      }

      if (response?.token && response?.user) {
        setLockedUntil(null);
        setLockedLoginKey('');
        setToken(response.token);
        setStoredUser(response.user);
        onLoginSuccess(response.user);
      }
    } catch (err: any) {
      if (err?.code === 'LOGIN_LOCKED') {
        const remainingSeconds = Number(err?.details?.remainingSeconds || err?.details?.retryAfterSeconds || 300);
        setLockedUntil(Date.now() + (remainingSeconds * 1000));
        setLockedLoginKey(activeLoginKey);
        setErrorMsg(`${TEXT.loginLocked} الوقت المتبقي: ${formatLockTime(remainingSeconds)}`);
        return;
      }
      if (err?.code === 'COMPANY_REQUIRED') {
        setErrorMsg(TEXT.companyRequired);
        navigateToCompanyRoute('select-company');
        return;
      }
      if (err?.code === 'INVALID_CREDENTIALS' && Number.isFinite(Number(err?.details?.remainingAttempts))) {
        const remainingAttempts = Number(err.details.remainingAttempts);
        setErrorMsg(`اسم المستخدم أو كلمة المرور غير صحيحة. المحاولات المتبقية: ${remainingAttempts}.`);
        return;
      }
      setErrorMsg(err?.message || TEXT.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  const copyIp = () => {
    navigator.clipboard.writeText(serverIp);
    alert(TEXT.copiedIp);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 font-sans overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 35%, #0f172a 70%, #020617 100%)',
        boxShadow: 'inset 0 0 120px rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full pointer-events-none opacity-20"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(15, 118, 110, 0.35) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute bottom-0 right-0 w-[500px] h-[400px] rounded-full pointer-events-none opacity-15"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(15, 118, 110, 0.25) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      <div className="relative w-full max-w-[440px]">
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-24 h-24 rounded-2xl mb-6 transform transition-transform hover:scale-105"
            style={{
              background: 'linear-gradient(145deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%)',
              boxShadow: `
                0 25px 50px -12px rgba(0, 0, 0, 0.5),
                0 0 0 1px rgba(255,255,255,0.08) inset,
                0 10px 30px -10px rgba(15, 118, 110, 0.5),
                0 -4px 0 0 rgba(0,0,0,0.2)
              `,
            }}
          >
            <ShieldCheck size={44} className="text-white drop-shadow-lg" strokeWidth={2.5} />
          </div>
          <h1
            className="text-4xl font-black tracking-tight mb-2"
            style={{
              color: '#f8fafc',
              textShadow: '0 2px 20px rgba(0,0,0,0.4), 0 0 40px rgba(15,118,110,0.15)',
            }}
          >
            {TEXT.title}
          </h1>
          <p className="text-slate-400 font-bold text-sm tracking-wide">{TEXT.subtitle}</p>
          {localStorage.getItem('shamel_activation_type') === 'trial' && (
            <p
              className="inline-block mt-4 px-5 py-2.5 rounded-xl text-amber-200 text-xs font-black border border-amber-500/40"
              style={{
                background: 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(217,119,6,0.1) 100%)',
                boxShadow: '0 4px 14px rgba(245,158,11,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              {TEXT.trial}
            </p>
          )}
        </div>

        <div
          className="relative rounded-3xl p-8 pb-10 overflow-hidden transition-transform duration-300 hover:scale-[1.01]"
          style={{
            background: 'linear-gradient(165deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
            boxShadow: `
              0 50px 100px -20px rgba(0, 0, 0, 0.6),
              0 30px 60px -30px rgba(0, 0, 0, 0.5),
              0 0 0 1px rgba(255,255,255,0.06) inset,
              0 -2px 0 0 rgba(0,0,0,0.3)
            `,
          }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-px opacity-60"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(15,118,110,0.6), transparent)' }}
          />

          <div
            className="mb-6 rounded-2xl border px-4 py-4"
            style={{
              background: 'linear-gradient(135deg, rgba(15,23,42,0.7) 0%, rgba(30,41,59,0.55) 100%)',
              borderColor: 'rgba(45, 212, 191, 0.22)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-teal-500/15 p-3 text-teal-300">
                  <Building2 size={20} />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">
                    {TEXT.orgLabel}
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-100">
                    {selectedCompany?.name || TEXT.orgMissingName}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-400">
                    {selectedCompanyId || TEXT.orgMissingId}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigateToCompanyRoute('select-company')}
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black text-slate-200 transition hover:bg-white/10"
              >
                <ArrowLeft size={14} />
                {TEXT.change}
              </button>
            </div>
          </div>

          {isSynced && (
            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center px-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  {TEXT.serverLabel}
                </label>
                <div
                  className={`flex items-center gap-1.5 text-[9px] font-bold ${
                    pingStatus === 'success' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {pingStatus === 'success' ? TEXT.serverOk : pingStatus === 'failed' ? TEXT.serverFail : TEXT.serverChecking}
                  <span
                    className={`w-2 h-2 rounded-full ${
                      pingStatus === 'success'
                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                        : pingStatus === 'failed'
                        ? 'bg-red-400'
                        : 'bg-amber-400 animate-pulse'
                    }`}
                  />
                </div>
              </div>

              <div className="relative group">
                <Edit3
                  className="absolute right-4 top-4 text-slate-500 group-focus-within:text-teal-400 transition-colors"
                  size={20}
                />
                <input
                  dir="ltr"
                  type="text"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  className={`w-full pr-12 pl-12 py-4 rounded-2xl outline-none font-mono font-bold text-center transition-all border-2 ${
                    pingStatus === 'success'
                      ? 'bg-slate-800/80 border-emerald-500/30 focus:border-emerald-400/60 text-slate-100'
                      : 'bg-slate-800/60 border-slate-600/50 focus:border-teal-500/60 text-slate-200'
                  }`}
                  placeholder={TEXT.serverPlaceholder}
                  style={{
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03)',
                  }}
                />
                <button
                  type="button"
                  onClick={copyIp}
                  className="absolute left-3 top-3 p-2 rounded-xl text-slate-400 hover:text-teal-400 hover:bg-white/5 transition-all"
                >
                  <Copy size={18} />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 font-medium leading-relaxed px-1">
                {TEXT.serverHint}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className={`space-y-4 ${isSynced ? 'border-t border-slate-600/50 pt-6' : ''}`}>
            {!hasCompanySelection && (
              <div
                className="p-4 rounded-2xl flex items-center gap-2 border border-amber-500/30 text-amber-200 text-xs font-bold"
                style={{
                  background: 'linear-gradient(135deg, rgba(217,119,6,0.15) 0%, rgba(120,53,15,0.12) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 14px rgba(0,0,0,0.2)',
                }}
              >
                <AlertCircle size={18} /> {TEXT.companyRequired}
              </div>
            )}
            <div className="space-y-4">
              <div className="relative group">
                <User
                  className="absolute right-4 top-4 text-slate-500 group-focus-within:text-teal-400 transition-colors pointer-events-none z-10"
                  size={20}
                />
                <input
                  required
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pr-12 pl-4 py-4 rounded-2xl outline-none font-bold transition-all border-2 border-slate-600/50 focus:border-teal-500/60 bg-slate-800/60 text-slate-100 placeholder-slate-500"
                  placeholder={TEXT.username}
                  style={{
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03)',
                  }}
                />
              </div>

              <div className="relative group">
                <Lock
                  className="absolute right-4 top-4 text-slate-500 group-focus-within:text-teal-400 transition-colors pointer-events-none z-10"
                  size={20}
                />
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pr-12 pl-12 py-4 rounded-2xl outline-none font-bold transition-all border-2 border-slate-600/50 focus:border-teal-500/60 bg-slate-800/60 text-slate-100 placeholder-slate-500"
                  placeholder={TEXT.password}
                  style={{
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute left-3 top-3 rounded-xl p-2 text-slate-400 transition hover:bg-white/5 hover:text-teal-400"
                  aria-label={showPassword ? TEXT.hidePassword : TEXT.showPassword}
                  title={showPassword ? TEXT.hidePassword : TEXT.showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div
                className="p-4 rounded-2xl flex items-center gap-2 border border-red-500/30 text-red-300 text-xs font-bold"
                style={{
                  background: 'linear-gradient(135deg, rgba(185,28,28,0.2) 0%, rgba(127,29,29,0.15) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 14px rgba(0,0,0,0.2)',
                }}
              >
                <AlertCircle size={18} /> {errorMsg}
              </div>
            )}

            {isLockedOut && (
              <div
                className="p-4 rounded-2xl flex items-center gap-2 border border-amber-500/30 text-amber-200 text-xs font-bold"
                style={{
                  background: 'linear-gradient(135deg, rgba(217,119,6,0.15) 0%, rgba(120,53,15,0.12) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 14px rgba(0,0,0,0.2)',
                }}
              >
                <AlertCircle size={18} /> {TEXT.loginLocked} الوقت المتبقي: {formatLockTime(lockRemainingSeconds)}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || isLockedOut || !hasCompanySelection || (isSynced && pingStatus !== 'success')}
              className="w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none transform active:scale-[0.98] hover:scale-[1.01] text-white border-0"
              style={{
                background: 'linear-gradient(180deg, #0f766e 0%, #0d9488 50%, #0f766e 100%)',
                boxShadow: '0 20px 40px -10px rgba(15, 118, 110, 0.45), 0 0 0 1px rgba(255,255,255,0.1) inset, 0 -3px 0 0 rgba(0,0,0,0.25)',
              }}
            >
              {isLoading ? (
                <RefreshCw className="animate-spin" size={24} />
              ) : (
                <ArrowRight size={24} className="drop-shadow-sm" />
              )}
              <span>{TEXT.submit}</span>
            </button>
          </form>
        </div>

        <p
          className="text-center mt-8 text-[10px] font-black uppercase tracking-[0.25em] text-slate-500"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
        >
          Comprehensive WMS Enterprise v3.2
        </p>
      </div>
    </div>
  );
};

export default Login;
