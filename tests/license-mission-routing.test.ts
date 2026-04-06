import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, String(value));
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
};

const missionLib = await import('../src/lib/licenseMission.ts');
const appModeLib = await import('../src/lib/appMode.ts');

const {
  recognizeLicenseMissionFromCode,
  getLicenseMissionDefinition,
  inferLicenseMissionFromLegacyActivationType,
} = missionLib;
const {
  updateActivationContext,
  getActivationMission,
  getActivationType,
} = appModeLib;

test('license mission recognition maps host, terminal, trial, cloud, and standalone codes', () => {
  assert.equal(recognizeLicenseMissionFromCode('ALM-HST-1234')?.mission, 'LOCAL_NETWORK_HOST');
  assert.equal(recognizeLicenseMissionFromCode('ALM-TRM-1234')?.mission, 'LOCAL_NETWORK_TERMINAL');
  assert.equal(recognizeLicenseMissionFromCode('TEST-1234')?.mission, 'TRIAL');
  assert.equal(recognizeLicenseMissionFromCode('CLD-1234')?.mission, 'CLOUD_PLACEHOLDER');
  assert.equal(recognizeLicenseMissionFromCode('ALM-1234')?.mission, 'LOCAL_STANDALONE');
});

test('license mission definitions drive the correct setup path expectations', () => {
  assert.equal(getLicenseMissionDefinition('LOCAL_STANDALONE').allowsProjectSetup, true);
  assert.equal(getLicenseMissionDefinition('LOCAL_NETWORK_HOST').deploymentDefault.role, 'host');
  assert.equal(getLicenseMissionDefinition('LOCAL_NETWORK_TERMINAL').requiresHostAddress, true);
  assert.equal(getLicenseMissionDefinition('CLOUD_PLACEHOLDER').setupPath, 'cloud_placeholder');
});

test('activation context persists mission separately from legacy activation type', () => {
  storage.clear();
  updateActivationContext('local', null, { mission: 'LOCAL_NETWORK_HOST' });

  assert.equal(getActivationType(), 'local');
  assert.equal(getActivationMission(), 'LOCAL_NETWORK_HOST');
});

test('legacy activation type fallback remains safe when mission is absent', () => {
  assert.equal(inferLicenseMissionFromLegacyActivationType('local'), 'LOCAL_STANDALONE');
  assert.equal(inferLicenseMissionFromLegacyActivationType('trial'), 'TRIAL');
  assert.equal(inferLicenseMissionFromLegacyActivationType('cloud'), 'CLOUD_PLACEHOLDER');
  assert.equal(inferLicenseMissionFromLegacyActivationType('branch'), 'LOCAL_NETWORK_TERMINAL');
});
