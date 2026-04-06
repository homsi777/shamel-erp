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

const STORAGE_KEY = 'shamel_deployment_config';

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

export const normalizeApiBaseUrl = (value: any): string | null => {
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

export const normalizeDeploymentConfigInput = (input?: Partial<DeploymentConfig> | null): DeploymentConfig => {
  const mode = normalizeMode(input?.mode);
  const role = normalizeRole(input?.role, mode);
  const canOwnBackend = mode === 'standalone' || role === 'host';
  return {
    mode,
    role,
    apiBaseUrl: normalizeApiBaseUrl(input?.apiBaseUrl),
    canOwnBackend,
    canOwnDatabase: canOwnBackend,
    allowLocalUsbPrinting: normalizeBoolean(input?.allowLocalUsbPrinting, canOwnBackend),
  };
};

export const getStoredDeploymentConfig = (): DeploymentConfig | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeDeploymentConfigInput(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const setStoredDeploymentConfig = (input: Partial<DeploymentConfig>) => {
  if (typeof window === 'undefined') return;
  const normalized = normalizeDeploymentConfigInput(input);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
};

export const persistRuntimeDeploymentConfig = async (input: Partial<DeploymentConfig>) => {
  const normalized = normalizeDeploymentConfigInput(input);
  setStoredDeploymentConfig(normalized);
  if (typeof window !== 'undefined' && window.electronAPI?.saveDeploymentConfig) {
    await window.electronAPI.saveDeploymentConfig(normalized);
  }
  return normalized;
};

export const getElectronDeploymentConfig = async (): Promise<DeploymentConfig | null> => {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.getDeploymentConfig) return null;
    const runtime = await window.electronAPI.getDeploymentConfig();
    return runtime ? normalizeDeploymentConfigInput(runtime) : null;
  } catch {
    return null;
  }
};

export const getResolvedDeploymentConfig = (overrides?: Partial<DeploymentConfig> | null): DeploymentConfig => {
  const electron = typeof window !== 'undefined' ? window.electronAPI?.deploymentConfig : null;
  const stored = getStoredDeploymentConfig();
  return normalizeDeploymentConfigInput({
    ...(electron || {}),
    ...(stored || {}),
    ...(overrides || {}),
  });
};
