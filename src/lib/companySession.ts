import type { AppUser } from '../types';

export const SESSION_TOKEN_KEY = 'shamel_token';
export const SESSION_USER_KEY = 'shamel_user';
export const ACTIVE_COMPANY_KEY = 'shamel_active_org';
export const SELECTED_COMPANY_KEY = 'selected_company_id';
export const ACTIVE_BRANCH_KEY = 'shamel_active_branch';
export const SELECTED_BRANCH_KEY = 'selected_branch_id';
export const HAS_COMPANY_KEY = 'shamel_has_org';
export const PRELOGIN_COMPANY_SELECTION_KEY = 'shamel_prelogin_company_select';

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type CompanyRoute = 'select-company' | 'login' | 'select-branch' | 'app';

export type SessionValidationResult = {
  isValid: boolean;
  reason:
    | 'valid'
    | 'missing_company_selection'
    | 'company_not_found'
    | 'missing_token'
    | 'missing_user'
    | 'missing_user_company'
    | 'company_mismatch'
    | 'branch_required';
  selectedCompanyId: string | null;
  selectedBranchId: string | null;
  user: AppUser | null;
  token: string | null;
};

const resolveStorage = (storage?: StorageLike | null): StorageLike | null => {
  if (storage) return storage;
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
};

const resolveSessionStorage = (storage?: StorageLike | null): StorageLike | null => {
  if (storage) return storage;
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
};

export const normalizeCompanyId = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

export const buildCompanyRouteHash = (route: CompanyRoute) => {
  if (route === 'app') return '#/';
  return `#/${route}`;
};

export const getCompanyRouteFromHash = (hash?: string | null): CompanyRoute => {
  const normalized = String((hash ?? (typeof window !== 'undefined' ? window.location.hash : '')) || '')
    .trim()
    .toLowerCase();
  if (normalized.includes('select-company')) return 'select-company';
  if (normalized.includes('select-branch')) return 'select-branch';
  if (normalized.includes('login')) return 'login';
  return 'app';
};

export const getStoredToken = (storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  return store ? String(store.getItem(SESSION_TOKEN_KEY) || '').trim() || null : null;
};

export const setStoredToken = (token: string, storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return;
  const normalized = String(token || '').trim();
  if (normalized) store.setItem(SESSION_TOKEN_KEY, normalized);
  else store.removeItem(SESSION_TOKEN_KEY);
};

export const getStoredUser = (storage?: StorageLike | null): AppUser | null => {
  const store = resolveStorage(storage);
  if (!store) return null;
  const raw = store.getItem(SESSION_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as AppUser;
  } catch {
    return null;
  }
};

export const setStoredUser = (user: AppUser | null, storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return;
  if (!user) {
    store.removeItem(SESSION_USER_KEY);
    return;
  }
  store.setItem(SESSION_USER_KEY, JSON.stringify(user));
  const currentBranchId = normalizeCompanyId((user as any)?.currentBranchId);
  if (currentBranchId) {
    store.setItem(SELECTED_BRANCH_KEY, currentBranchId);
    store.setItem(ACTIVE_BRANCH_KEY, currentBranchId);
  } else {
    store.removeItem(SELECTED_BRANCH_KEY);
    store.removeItem(ACTIVE_BRANCH_KEY);
  }
};

export const getSelectedCompanyId = (storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return null;
  return normalizeCompanyId(store.getItem(SELECTED_COMPANY_KEY) || store.getItem(ACTIVE_COMPANY_KEY));
};

export const setSelectedCompanyId = (companyId: string | null, storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return;
  const normalized = normalizeCompanyId(companyId);
  if (!normalized) {
    store.removeItem(SELECTED_COMPANY_KEY);
    store.removeItem(ACTIVE_COMPANY_KEY);
    return;
  }
  store.setItem(SELECTED_COMPANY_KEY, normalized);
  store.setItem(ACTIVE_COMPANY_KEY, normalized);
  store.removeItem(SELECTED_BRANCH_KEY);
  store.removeItem(ACTIVE_BRANCH_KEY);
  store.setItem(HAS_COMPANY_KEY, '1');
};

export const getSelectedBranchId = (storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return null;
  return normalizeCompanyId(store.getItem(SELECTED_BRANCH_KEY) || store.getItem(ACTIVE_BRANCH_KEY));
};

export const setSelectedBranchId = (branchId: string | null, storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return;
  const normalized = normalizeCompanyId(branchId);
  if (!normalized) {
    store.removeItem(SELECTED_BRANCH_KEY);
    store.removeItem(ACTIVE_BRANCH_KEY);
    return;
  }
  store.setItem(SELECTED_BRANCH_KEY, normalized);
  store.setItem(ACTIVE_BRANCH_KEY, normalized);
};

export const clearStoredSession = (storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return;
  store.removeItem(SESSION_TOKEN_KEY);
  store.removeItem(SESSION_USER_KEY);
  store.removeItem(SELECTED_BRANCH_KEY);
  store.removeItem(ACTIVE_BRANCH_KEY);
};

export const clearStoredCompanySelection = (storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return;
  store.removeItem(SELECTED_COMPANY_KEY);
  store.removeItem(ACTIVE_COMPANY_KEY);
  store.removeItem(SELECTED_BRANCH_KEY);
  store.removeItem(ACTIVE_BRANCH_KEY);
};

export const clearStoredSessionAndCompany = (storage?: StorageLike | null) => {
  clearStoredSession(storage);
  clearStoredCompanySelection(storage);
};

export const switchCompanySession = (companyId: string, storage?: StorageLike | null) => {
  clearStoredSession(storage);
  setSelectedCompanyId(companyId, storage);
};

export const switchBranchSession = (branchId: string, storage?: StorageLike | null) => {
  setSelectedBranchId(branchId, storage);
};

export const validateCompanyBoundSession = (
  companies: Array<{ id: string }> = [],
  storage?: StorageLike | null,
): SessionValidationResult => {
  const selectedCompanyId = getSelectedCompanyId(storage);
  const selectedBranchId = getSelectedBranchId(storage);
  const token = getStoredToken(storage);
  const user = getStoredUser(storage);

  if (!selectedCompanyId) {
    return { isValid: false, reason: 'missing_company_selection', selectedCompanyId, selectedBranchId, user, token };
  }

  if (companies.length > 0 && !companies.some((company) => normalizeCompanyId(company?.id) === selectedCompanyId)) {
    return { isValid: false, reason: 'company_not_found', selectedCompanyId, selectedBranchId, user, token };
  }

  if (!token) {
    return { isValid: false, reason: 'missing_token', selectedCompanyId, selectedBranchId, user, token };
  }

  if (!user) {
    return { isValid: false, reason: 'missing_user', selectedCompanyId, selectedBranchId, user, token };
  }

  const userCompanyId = normalizeCompanyId(user.companyId);
  if (!userCompanyId) {
    return { isValid: false, reason: 'missing_user_company', selectedCompanyId, selectedBranchId, user, token };
  }

  if (userCompanyId !== selectedCompanyId) {
    return { isValid: false, reason: 'company_mismatch', selectedCompanyId, selectedBranchId, user, token };
  }

  const requiresBranchSelection = Boolean((user as any)?.requiresBranchSelection);
  const currentBranchId = normalizeCompanyId((user as any)?.currentBranchId);
  if (requiresBranchSelection && !currentBranchId && !selectedBranchId) {
    return { isValid: false, reason: 'branch_required', selectedCompanyId, selectedBranchId, user, token };
  }

  return { isValid: true, reason: 'valid', selectedCompanyId, selectedBranchId, user, token };
};

export const navigateToCompanyRoute = (route: CompanyRoute) => {
  if (typeof window === 'undefined') return;
  window.location.hash = buildCompanyRouteHash(route);
};

export const reloadApplication = () => {
  if (typeof window === 'undefined') return;
  window.location.reload();
};

export const getPreloginCompanySelectionAllowed = (storage?: StorageLike | null) => {
  const store = resolveSessionStorage(storage);
  if (!store) return false;
  return store.getItem(PRELOGIN_COMPANY_SELECTION_KEY) === '1';
};

export const setPreloginCompanySelectionAllowed = (allow: boolean, storage?: StorageLike | null) => {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  if (allow) {
    store.setItem(PRELOGIN_COMPANY_SELECTION_KEY, '1');
  } else {
    store.removeItem(PRELOGIN_COMPANY_SELECTION_KEY);
  }
};

export const clearPreloginCompanySelectionAllowed = (storage?: StorageLike | null) => {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  store.removeItem(PRELOGIN_COMPANY_SELECTION_KEY);
};
