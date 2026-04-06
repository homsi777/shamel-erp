export type DeploymentMode = 'standalone' | 'local_network';
export type DeviceRole = 'standalone' | 'host' | 'terminal';

export interface DeploymentConfig {
  mode: DeploymentMode;
  role: DeviceRole;
  apiBaseUrl: string | null;
  canOwnBackend: boolean;
  canOwnDatabase: boolean;
  allowLocalUsbPrinting: boolean;
}

const normalizeMode = (value: any): DeploymentMode => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'local_network' ? 'local_network' : 'standalone';
};

const normalizeRole = (value: any, mode: DeploymentMode): DeviceRole => {
  const raw = String(value || '').trim().toLowerCase();
  if (mode === 'standalone') return 'standalone';
  if (raw === 'terminal') return 'terminal';
  return 'host';
};

const normalizeApiBaseUrl = (value: any): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let normalized = raw.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  normalized = normalized.replace(/\/api$/i, '');
  return `${normalized}/api`;
};

const normalizeBoolean = (value: any, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
};

export const resolveDeploymentConfig = (): DeploymentConfig => {
  const mode = normalizeMode(
    process.env.SHAMEL_DEPLOYMENT_MODE ||
    process.env.APP_DEPLOYMENT_MODE,
  );
  const role = normalizeRole(
    process.env.SHAMEL_DEVICE_ROLE ||
    process.env.APP_DEVICE_ROLE,
    mode,
  );
  const apiBaseUrl = normalizeApiBaseUrl(
    process.env.SHAMEL_API_URL ||
    process.env.SHAMEL_SERVER_URL ||
    process.env.APP_SERVER_URL,
  );
  const canOwnBackend = mode === 'standalone' || role === 'host';
  return {
    mode,
    role,
    apiBaseUrl,
    canOwnBackend,
    canOwnDatabase: canOwnBackend,
    allowLocalUsbPrinting: normalizeBoolean(process.env.SHAMEL_ALLOW_LOCAL_USB_PRINTING, canOwnBackend),
  };
};
