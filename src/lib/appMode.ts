import {
  inferLicenseMissionFromLegacyActivationType,
  normalizeLicenseMission,
  recognizeLicenseMissionFromCode,
  type ActivationTypeLegacy,
  type LicenseMission,
} from './licenseMission';

export type ActivationType = ActivationTypeLegacy;
export type AppMode = 'standalone' | 'synced';

const STORAGE = {
  activationType: 'shamel_activation_type',
  appMode: 'shamel_app_mode',
  serverUrl: 'shamel_api_url',
  serverSource: 'shamel_api_url_source',
  activationMeta: 'shamel_activation_meta',
  activationMission: 'shamel_activation_mission',
  syncEnabled: 'shamel_sync_enabled',
  lastSyncAt: 'shamel_last_sync_at',
} as const;

const normalizeType = (value?: string | null): ActivationType | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'local') return 'local';
  if (raw === 'trial') return 'trial';
  if (raw === 'cloud') return 'cloud';
  if (raw === 'branch') return 'branch';
  return raw as ActivationType;
};

export const getActivationType = (): ActivationType | null => {
  return normalizeType(localStorage.getItem(STORAGE.activationType));
};

export const getActivationMission = (): LicenseMission | null => {
  const stored = localStorage.getItem(STORAGE.activationMission);
  if (stored) return normalizeLicenseMission(stored);
  const activationType = getActivationType();
  return activationType ? inferLicenseMissionFromLegacyActivationType(activationType) : null;
};

export const setActivationType = (type: string) => {
  const normalized = normalizeType(type) || 'local';
  localStorage.setItem(STORAGE.activationType, normalized);
};

export const setActivationMission = (mission: string) => {
  localStorage.setItem(STORAGE.activationMission, normalizeLicenseMission(mission));
};

export const getAppModeFromActivationType = (type?: string | null): AppMode => {
  const normalized = normalizeType(type);
  return normalized === 'cloud' || normalized === 'branch' ? 'synced' : 'standalone';
};

export const getAppMode = (): AppMode => {
  const stored = localStorage.getItem(STORAGE.appMode);
  if (stored === 'synced' || stored === 'standalone') return stored;
  return getAppModeFromActivationType(getActivationType());
};

export const setAppMode = (mode: AppMode) => {
  localStorage.setItem(STORAGE.appMode, mode);
  localStorage.setItem(STORAGE.syncEnabled, mode === 'synced' ? '1' : '0');
};

export const isStandaloneMode = () => getAppMode() === 'standalone';
export const isSyncedMode = () => getAppMode() === 'synced';

export const requiresServerAddress = (activationType?: string | null) => {
  return getAppModeFromActivationType(activationType) === 'synced';
};

export const clearServerAddress = () => {
  localStorage.removeItem(STORAGE.serverUrl);
  localStorage.removeItem(STORAGE.serverSource);
};

export const updateActivationContext = (
  activationType: string,
  serverAddress?: string | null,
  options?: { mission?: string | null; deferred?: boolean },
) => {
  const normalized = normalizeType(activationType) || 'local';
  const mode = getAppModeFromActivationType(normalized);
  const mission = normalizeLicenseMission(options?.mission || inferLicenseMissionFromLegacyActivationType(normalized));
  setActivationType(normalized);
  setActivationMission(mission);
  setAppMode(mode);

  if (mode === 'standalone') {
    clearServerAddress();
  } else if (serverAddress) {
    localStorage.setItem(STORAGE.serverUrl, serverAddress);
    localStorage.setItem(STORAGE.serverSource, 'user');
  }

  const meta = {
    activationType: normalized,
    activationMission: mission,
    appMode: mode,
    serverAddress: mode === 'synced' ? (serverAddress || localStorage.getItem(STORAGE.serverUrl) || '') : '',
    syncEnabled: mode === 'synced',
    deferred: Boolean(options?.deferred),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE.activationMeta, JSON.stringify(meta));
  return meta;
};

export const getActivationTypeHint = (code: string): ActivationType | null => {
  return recognizeLicenseMissionFromCode(code)?.legacyActivationType || null;
};

export const setLastSyncAt = (date: string) => {
  localStorage.setItem(STORAGE.lastSyncAt, date);
};
