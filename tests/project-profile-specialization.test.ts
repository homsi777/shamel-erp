import test from 'node:test';
import assert from 'node:assert/strict';

const profileLib = await import('../src/lib/projectProfiles.ts');

const {
  DEFAULT_PROJECT_PROFILE_ID,
  getProjectProfileDefinition,
  getProfileLandingTab,
  getVisibleTabsForProfile,
  inferProjectProfileFromLegacy,
  resolveProjectProfile,
} = profileLib;

test('default project profile remains comprehensive general', () => {
  const profile = getProjectProfileDefinition(DEFAULT_PROJECT_PROFILE_ID);
  assert.equal(profile.id, 'COMPREHENSIVE_GENERAL');
  assert.equal(getProfileLandingTab(profile.id), 'dashboard');
});

test('restaurant profile prioritizes restaurant flows and hides manufacturing and agents', () => {
  const visible = getVisibleTabsForProfile('COMPREHENSIVE_RESTAURANT');

  assert.equal(getProfileLandingTab('COMPREHENSIVE_RESTAURANT'), 'restaurant_tables');
  assert.equal(visible.has('restaurant_tables'), true);
  assert.equal(visible.has('restaurant_reports'), true);
  assert.equal(visible.has('manufacturing'), false);
  assert.equal(visible.has('agents'), false);
});

test('manufacturing profile prioritizes production and hides restaurant sections', () => {
  const visible = getVisibleTabsForProfile('COMPREHENSIVE_MANUFACTURING');

  assert.equal(getProfileLandingTab('COMPREHENSIVE_MANUFACTURING'), 'manufacturing');
  assert.equal(visible.has('manufacturing'), true);
  assert.equal(visible.has('restaurant_tables'), false);
  assert.equal(visible.has('pos'), false);
});

test('legacy business types map into the new project profile model', () => {
  assert.equal(inferProjectProfileFromLegacy('restaurants').id, 'COMPREHENSIVE_RESTAURANT');
  assert.equal(inferProjectProfileFromLegacy('general_trade').id, 'COMPREHENSIVE_COMMERCIAL');
  assert.equal(inferProjectProfileFromLegacy('factories').id, 'COMPREHENSIVE_MANUFACTURING');
});

test('runtime profile resolution falls back to legacy company type when projectProfile is missing', () => {
  const resolved = resolveProjectProfile({
    company: {
      name: 'Factory One',
      address: '',
      email: '',
      phone1: '',
      phone2: '',
      type: 'factories',
    } as any,
  });

  assert.equal(resolved.id, 'COMPREHENSIVE_MANUFACTURING');
});
