export const SUPER_ADMIN_TOKEN_KEY = 'shamel_super_admin_token';
export const SUPER_ADMIN_USER_KEY = 'shamel_super_admin_user';

export interface SuperAdminSessionUser {
  id: string;
  username: string;
  displayName: string;
  scope: 'super_admin';
}

export type SuperAdminRoute = 'inactive' | 'login' | 'console';

export const getStoredSuperAdminToken = () => {
  return String(localStorage.getItem(SUPER_ADMIN_TOKEN_KEY) || '').trim() || null;
};

export const setStoredSuperAdminToken = (token: string | null) => {
  const normalized = String(token || '').trim();
  if (normalized) localStorage.setItem(SUPER_ADMIN_TOKEN_KEY, normalized);
  else localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
};

export const getStoredSuperAdminUser = (): SuperAdminSessionUser | null => {
  const raw = localStorage.getItem(SUPER_ADMIN_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SuperAdminSessionUser;
  } catch {
    return null;
  }
};

export const setStoredSuperAdminUser = (user: SuperAdminSessionUser | null) => {
  if (!user) {
    localStorage.removeItem(SUPER_ADMIN_USER_KEY);
    return;
  }
  localStorage.setItem(SUPER_ADMIN_USER_KEY, JSON.stringify(user));
};

export const clearSuperAdminSession = () => {
  localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
  localStorage.removeItem(SUPER_ADMIN_USER_KEY);
};

export const getSuperAdminRouteFromHash = (hash?: string | null): SuperAdminRoute => {
  const normalized = String(hash ?? window.location.hash ?? '').toLowerCase();
  if (normalized.includes('super-admin-login')) return 'login';
  if (normalized.includes('super-admin')) return 'console';
  return 'inactive';
};

export const navigateToSuperAdminLogin = () => {
  window.location.hash = '#/super-admin-login';
};

export const navigateToSuperAdminConsole = () => {
  window.location.hash = '#/super-admin';
};

export const hasSuperAdminSession = () => Boolean(getStoredSuperAdminToken() && getStoredSuperAdminUser());
