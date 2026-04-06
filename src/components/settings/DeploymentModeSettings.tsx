import React from 'react';
import { AlertTriangle, HardDrive, MonitorSmartphone, Network, Printer, Server } from 'lucide-react';
import type { DeploymentSettings } from '../../types';
import type { DeploymentConfig } from '../../lib/deployment';
import { normalizeApiBaseUrl, normalizeDeploymentConfigInput } from '../../lib/deployment';

interface Props {
  value?: Partial<DeploymentConfig> | DeploymentSettings;
  onChange: (next: DeploymentConfig) => void;
  onApply?: (next: DeploymentConfig) => Promise<void> | void;
  isApplying?: boolean;
  showApplyAction?: boolean;
  title?: string;
  hint?: string | null;
}

const DEFAULT_PORT = '3111';

const parseApiAddress = (value?: string | null) => {
  const normalized = normalizeApiBaseUrl(value || '');
  if (!normalized) return { host: '', port: DEFAULT_PORT };
  try {
    const url = new URL(normalized);
    return {
      host: url.hostname || '',
      port: url.port || DEFAULT_PORT,
    };
  } catch {
    return { host: '', port: DEFAULT_PORT };
  }
};

const optionMeta = {
  standalone: {
    title: 'Standalone',
    subtitle: 'واجهة + backend + قاعدة البيانات على نفس الجهاز.',
    icon: <HardDrive size={22} className="text-emerald-600" />,
  },
  host: {
    title: 'Local Network Host',
    subtitle: 'هذا الجهاز هو الخادم المركزي ومالك قاعدة البيانات داخل الموقع.',
    icon: <Server size={22} className="text-blue-600" />,
  },
  terminal: {
    title: 'Local Network Terminal',
    subtitle: 'هذا الجهاز عميل فقط ويتصل بخادم الموقع عبر الشبكة المحلية.',
    icon: <MonitorSmartphone size={22} className="text-amber-600" />,
  },
} as const;

const DeploymentModeSettings: React.FC<Props> = ({
  value,
  onChange,
  onApply,
  isApplying = false,
  showApplyAction = false,
  title = 'إعداد نمط التشغيل',
  hint = 'Standalone هو الوضع الافتراضي الآمن. اختر Local Network فقط عند وجود جهاز مركزي واحد يملك الـ backend وقاعدة البيانات.',
}) => {
  const deployment = normalizeDeploymentConfigInput(value || {});
  const [host, setHost] = React.useState(() => parseApiAddress(deployment.apiBaseUrl).host);
  const [port, setPort] = React.useState(() => parseApiAddress(deployment.apiBaseUrl).port);

  React.useEffect(() => {
    const parsed = parseApiAddress(deployment.apiBaseUrl);
    setHost(parsed.host);
    setPort(parsed.port);
  }, [deployment.apiBaseUrl, deployment.mode, deployment.role]);

  const applyChange = (patch: Partial<DeploymentSettings>) => {
    onChange(normalizeDeploymentConfigInput({ ...deployment, ...patch }));
  };

  const setModeRole = (next: 'standalone' | 'host' | 'terminal') => {
    if (next === 'standalone') {
      applyChange({
        mode: 'standalone',
        role: 'standalone',
        apiBaseUrl: null,
        allowLocalUsbPrinting: true,
      });
      return;
    }
    applyChange({
      mode: 'local_network',
      role: next,
      apiBaseUrl: next === 'terminal' ? normalizeApiBaseUrl(`${host || ''}:${port || DEFAULT_PORT}`) : null,
      allowLocalUsbPrinting: next === 'host' ? true : deployment.allowLocalUsbPrinting,
    });
  };

  const updateTerminalAddress = (nextHost: string, nextPort: string) => {
    const cleanHost = nextHost.trim();
    const cleanPort = String(nextPort || DEFAULT_PORT).trim();
    setHost(nextHost);
    setPort(nextPort);
    applyChange({
      apiBaseUrl: cleanHost ? normalizeApiBaseUrl(`${cleanHost}:${cleanPort || DEFAULT_PORT}`) : null,
    });
  };

  const terminalAddressValid =
    deployment.mode !== 'local_network' ||
    deployment.role !== 'terminal' ||
    Boolean(normalizeApiBaseUrl(`${host.trim()}:${String(port || DEFAULT_PORT).trim() || DEFAULT_PORT}`));

  const terminalRequiresElectronUsbNote =
    deployment.mode === 'local_network' &&
    deployment.role === 'terminal' &&
    deployment.allowLocalUsbPrinting &&
    !window.electronAPI;

  const handleApply = async () => {
    if (!onApply) return;
    const next = normalizeDeploymentConfigInput({
      ...deployment,
      apiBaseUrl:
        deployment.mode === 'local_network' && deployment.role === 'terminal'
          ? normalizeApiBaseUrl(`${host.trim()}:${String(port || DEFAULT_PORT).trim() || DEFAULT_PORT}`)
          : null,
    });
    if (next.mode === 'local_network' && next.role === 'terminal' && !next.apiBaseUrl) {
      return;
    }
    await onApply(next);
  };

  return (
    <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-fadeIn">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Network className="text-primary" />
            {title}
          </h3>
          {hint ? <p className="text-sm text-gray-500 mt-2 leading-6 max-w-3xl">{hint}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        {(['standalone', 'host', 'terminal'] as const).map((option) => {
          const selected =
            (option === 'standalone' && deployment.mode === 'standalone') ||
            (option !== 'standalone' && deployment.mode === 'local_network' && deployment.role === option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => setModeRole(option)}
              className={`rounded-2xl border p-5 transition-all text-right ${
                selected ? 'border-primary bg-teal-50 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-right">
                  <div className="text-base font-black text-gray-900">{optionMeta[option].title}</div>
                  <div className="text-sm text-gray-600 mt-2 leading-6">{optionMeta[option].subtitle}</div>
                </div>
                <div>{optionMeta[option].icon}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50">
          <div className="flex items-center gap-2 text-gray-800 font-bold mb-4">
            <Server size={18} className="text-blue-600" />
            ملخص السلوك النهائي
          </div>
          {deployment.mode === 'standalone' && (
            <div className="space-y-2 text-sm text-gray-700 leading-6">
              <p>هذا الجهاز يشغل الواجهة والـ backend وقاعدة البيانات محلياً.</p>
              <p>لا يوجد أي اعتماد إلزامي على LAN أو على جهاز آخر.</p>
              <p>الطباعة USB و IP تبقى محلية ومدعومة حسب التهيئة الحالية.</p>
            </div>
          )}
          {deployment.mode === 'local_network' && deployment.role === 'host' && (
            <div className="space-y-2 text-sm text-gray-700 leading-6">
              <p>هذا الجهاز هو المالك الوحيد للـ backend التشغيلي وقاعدة البيانات.</p>
              <p>أجهزة POS الطرفية تتصل بهذا الجهاز عبر LAN ولا تملك قاعدة بيانات تشغيلية مستقلة.</p>
              <p>طابعات IP مدعومة، وUSB المحلي يبقى متاحاً على هذا الجهاز.</p>
            </div>
          )}
          {deployment.mode === 'local_network' && deployment.role === 'terminal' && (
            <div className="space-y-2 text-sm text-gray-700 leading-6">
              <p>هذا الجهاز عميل فقط. لا يجب أن يملك backend أو SQLite تشغيلي للموقع.</p>
              <p>كل العمليات المحاسبية والمخزنية والفواتير تذهب إلى الخادم المركزي.</p>
              <p>USB المحلي على الطرفية مدعوم فقط عند وجود Electron local print capability بشكل صريح.</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50">
          <div className="flex items-center gap-2 text-gray-800 font-bold mb-4">
            <Printer size={18} className="text-amber-600" />
            الطباعة حسب النمط
          </div>
          <div className="space-y-2 text-sm text-gray-700 leading-6">
            <p>Standalone: USB local supported, IP printer supported.</p>
            <p>Local Network Host: IP printer supported, local USB on host supported.</p>
            <p>Local Network Terminal: IP printer supported. Local USB only if this terminal has explicit local print support.</p>
            <p>Browser terminal + USB: غير مدعوم.</p>
          </div>
        </div>
      </div>

      {deployment.mode === 'local_network' && deployment.role === 'terminal' && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 text-amber-900 font-bold mb-4">
            <AlertTriangle size={18} />
            إعداد الطرفية
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">عنوان الخادم أو IP</label>
              <input
                type="text"
                value={host}
                onChange={(e) => updateTerminalAddress(e.target.value, port)}
                placeholder="192.168.1.10"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white text-left"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">المنفذ</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => updateTerminalAddress(host, e.target.value)}
                placeholder={DEFAULT_PORT}
                className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white text-left"
                dir="ltr"
              />
            </div>
          </div>
          {!terminalAddressValid && (
            <p className="mt-3 text-sm font-bold text-red-700">
              أدخل عنوان خادم صالحاً للطرفية. مثال: 192.168.1.10 والمنفذ 3111.
            </p>
          )}
          <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(deployment.allowLocalUsbPrinting)}
              onChange={(e) => applyChange({ allowLocalUsbPrinting: e.target.checked })}
              className="mt-1"
            />
            <span>
              تفعيل USB المحلي على هذه الطرفية فقط إذا كانت الطباعة المحلية مدعومة فعلاً على الجهاز.
              <span className="block text-xs text-gray-500 mt-1">في browser-only terminal يبقى USB غير مدعوم حتى لو تم تفعيل الخيار.</span>
            </span>
          </label>
          {terminalRequiresElectronUsbNote && (
            <p className="mt-3 text-xs font-bold text-red-700">
              هذه الجلسة ليست Electron. USB المحلي على الطرفية يتطلب عميل Electron محلياً.
            </p>
          )}
        </div>
      )}

      {showApplyAction && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
          <p className="text-sm text-gray-600 leading-6">
            بعد الحفظ سيتم إعادة تشغيل التطبيق حتى يطبّق دور الجهاز الجديد بأمان.
          </p>
          <button
            type="button"
            onClick={() => {
              void handleApply();
            }}
            disabled={isApplying || !terminalAddressValid}
            className="px-5 py-3 rounded-xl bg-gray-900 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying ? 'جاري الحفظ...' : 'حفظ التهيئة وإعادة التشغيل'}
          </button>
        </div>
      )}
    </div>
  );
};

export default DeploymentModeSettings;
