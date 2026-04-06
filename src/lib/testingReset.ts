import type { AppUser } from '../types';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSEY_VALUES = new Set(['0', 'false', 'no', 'off']);

export const TESTING_RESET_CONFIRMATION_PHRASE = 'RESET CLEAN TESTING';

const normalizePermissions = (user?: AppUser | null) =>
  Array.isArray(user?.permissions) ? user.permissions.filter(Boolean) : [];

export const parseTestingResetFlag = (value: unknown, mode = 'development') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSEY_VALUES.has(normalized)) return false;
  return mode !== 'production';
};

export const isTestingResetFeatureEnabled = (env: Record<string, unknown> = (import.meta as any).env || {}) =>
  parseTestingResetFlag(env.VITE_ENABLE_TESTING_RESET, String(env.MODE || 'development'));

export const canAccessTestingReset = (user?: AppUser | null) => {
  if (!user) return false;
  const role = String(user.role || '').trim().toLowerCase();
  const permissions = normalizePermissions(user);
  return role === 'admin' || permissions.includes('*');
};
