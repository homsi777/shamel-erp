import { Capacitor } from '@capacitor/core';
import { getActivationMission, getActivationType, getAppMode } from './appMode';
import { getResolvedDeploymentConfig } from './deployment';

export type RuntimeMode =
  | 'android_local_standalone'
  | 'android_trial_standalone'
  | 'desktop_local_standalone'
  | 'desktop_trial_standalone'
  | 'cloud_synced'
  | 'branch_synced'
  | 'unresolved';

export type DataMode = 'local_embedded' | 'remote_sync';
export type ApiMode = 'local' | 'remote';

export interface RuntimeContext {
  activationType: string | null;
  activationMission: string | null;
  appMode: 'standalone' | 'synced';
  deploymentMode: 'standalone' | 'local_network';
  deviceRole: 'standalone' | 'host' | 'terminal';
  runtimeMode: RuntimeMode;
  dataMode: DataMode;
  apiMode: ApiMode;
  platform: 'android' | 'native' | 'web';
  usesLocalApi: boolean;
  usesRemoteApi: boolean;
  requiresServerAddress: boolean;
}

const getPlatform = (): RuntimeContext['platform'] => {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') return 'android';
  if (Capacitor.isNativePlatform()) return 'native';
  return 'web';
};

export const getRuntimeContext = (): RuntimeContext => {
  const activationType = getActivationType();
  const activationMission = getActivationMission();
  const appMode = getAppMode();
  const platform = getPlatform();
  const deployment = getResolvedDeploymentConfig();

  if (appMode === 'synced') {
    const runtimeMode = activationType === 'branch' ? 'branch_synced' : 'cloud_synced';
    return {
      activationType,
      activationMission,
      appMode,
      deploymentMode: deployment.mode,
      deviceRole: deployment.role,
      runtimeMode,
      dataMode: 'remote_sync',
      apiMode: 'remote',
      platform,
      usesLocalApi: false,
      usesRemoteApi: true,
      requiresServerAddress: true,
    };
  }

  if (activationType === 'local' || activationType === 'trial') {
    const onAndroid = platform === 'android';
    return {
      activationType,
      activationMission,
      appMode,
      deploymentMode: deployment.mode,
      deviceRole: deployment.role,
      runtimeMode: onAndroid
        ? activationType === 'trial'
          ? 'android_trial_standalone'
          : 'android_local_standalone'
        : activationType === 'trial'
          ? 'desktop_trial_standalone'
          : 'desktop_local_standalone',
      dataMode: 'local_embedded',
      apiMode: onAndroid ? 'local' : 'remote',
      platform,
      usesLocalApi: onAndroid,
      usesRemoteApi: !onAndroid,
      requiresServerAddress: false,
    };
  }

  return {
    activationType,
    activationMission,
    appMode,
    deploymentMode: deployment.mode,
    deviceRole: deployment.role,
    runtimeMode: 'unresolved',
    dataMode: 'local_embedded',
    apiMode: 'remote',
    platform,
    usesLocalApi: false,
    usesRemoteApi: true,
    requiresServerAddress: false,
  };
};

export const shouldUseLocalApiRuntime = () => getRuntimeContext().usesLocalApi;
export const shouldUseRemoteApiRuntime = () => getRuntimeContext().usesRemoteApi;
