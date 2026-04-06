import { Capacitor } from '@capacitor/core';
import { getAppModeFromActivationType, type ActivationType } from './appMode';
import { getLicenseMissionLabel, type LicenseMission } from './licenseMission';

const PLATFORM_LABELS: Record<string, string> = {
  android: 'Android',
  electron_windows: 'Windows',
  electron_desktop: 'Desktop',
  native: 'Native',
  web: 'Web',
};

const isElectron = () => navigator.userAgent.toLowerCase().includes('electron');

/**
 * Client context for activation (platform, device, paths). Used to align payloads with the backend.
 * Telegram delivery is handled exclusively on the server (see backend activation routes + activationNotificationService).
 */
export interface ActivationNotificationPayload {
  code: string;
  activationType: ActivationType;
  activationMission: LicenseMission;
  activationMissionLabel: string;
  customerName?: string;
  orgName?: string;
  /** @deprecated prefer businessDomain; kept for older payloads */
  profession?: string;
  businessDomain?: string;
  activatorName?: string;
  activatorPhone?: string;
  province?: string;
  activationMethod?: string;
  platform: string;
  platformLabel: string;
  deviceName: string;
  appMode: 'standalone' | 'synced';
  activationPath: 'local_direct' | 'server_activation';
  sentAt: string;
}

export const getClientActivationContext = (
  activationType: ActivationType,
  activationMission: LicenseMission,
  fields: Partial<
    Omit<
      ActivationNotificationPayload,
      'activationType' | 'activationMission' | 'activationMissionLabel' | 'platform' | 'platformLabel' | 'deviceName' | 'appMode' | 'activationPath' | 'sentAt'
    >
  >,
) => {
  const platform = Capacitor.getPlatform();
  const rawPlatform = typeof navigator !== 'undefined' ? String(navigator.platform || '').toLowerCase() : '';
  const platformKey =
    platform === 'android'
      ? 'android'
      : isElectron()
        ? rawPlatform.includes('win')
          ? 'electron_windows'
          : 'electron_desktop'
        : Capacitor.isNativePlatform()
          ? 'native'
          : 'web';

  const businessDomain = fields.businessDomain?.trim() || fields.profession?.trim();

  return {
    code: String(fields.code || '').trim().toUpperCase(),
    activationType,
    activationMission,
    activationMissionLabel: getLicenseMissionLabel(activationMission),
    customerName: fields.customerName?.trim() || undefined,
    orgName: fields.orgName?.trim() || undefined,
    businessDomain: businessDomain || undefined,
    profession: businessDomain || undefined,
    activatorName: fields.activatorName?.trim() || undefined,
    activatorPhone: fields.activatorPhone?.trim() || undefined,
    province: fields.province?.trim() || undefined,
    activationMethod: fields.activationMethod?.trim() || undefined,
    platform: platformKey,
    platformLabel: PLATFORM_LABELS[platformKey] || platformKey,
    deviceName:
      typeof navigator !== 'undefined'
        ? (((navigator as any).userAgentData?.platform as string | undefined) ||
            navigator.platform ||
            navigator.userAgent ||
            'Unknown Device')
        : 'Unknown Device',
    appMode: getAppModeFromActivationType(activationType),
    activationPath: activationType === 'cloud' || activationType === 'branch' ? 'server_activation' : 'local_direct',
    sentAt: new Date().toISOString(),
  } satisfies ActivationNotificationPayload;
};
