import {
  ACTIVE_BRANCH_KEY,
  ACTIVE_COMPANY_KEY,
  HAS_COMPANY_KEY,
  SELECTED_BRANCH_KEY,
  SELECTED_COMPANY_KEY,
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
  type CompanyRoute,
  type StorageLike,
} from './companySession';

export type StartupAuthState = {
  isAuthenticated: boolean;
  reason: string;
};

export type StartupDecisionInput = {
  setupComplete: boolean;
  auth: StartupAuthState;
  branchSelectionRequired: boolean;
  companySelectionRequired: boolean;
  requestedRoute: CompanyRoute;
};

export type StartupDecision = {
  route: 'setup' | CompanyRoute;
  reason: string;
};

export type StartupSanitizeResult = {
  cleared: string[];
  updated: string[];
};

const resolveStorage = (storage?: StorageLike | null) => {
  if (storage) return storage;
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
};

export const resolveStartupDecision = ({
  setupComplete,
  auth,
  branchSelectionRequired,
  companySelectionRequired,
  requestedRoute,
}: StartupDecisionInput): StartupDecision => {
  if (!setupComplete) {
    return { route: 'setup', reason: 'setup_incomplete' };
  }

  if (!auth.isAuthenticated) {
    return { route: 'select-company', reason: auth.reason || 'unauthenticated' };
  }

  if (branchSelectionRequired) {
    return { route: 'select-branch', reason: 'branch_required' };
  }

  if (companySelectionRequired) {
    return { route: 'select-company', reason: 'company_selection_required' };
  }

  return { route: 'app', reason: 'authenticated' };
};

export const sanitizeStartupStorage = (params: {
  storage?: StorageLike | null;
  setupComplete: boolean;
  hasValidSession: boolean;
}): StartupSanitizeResult => {
  const store = resolveStorage(params.storage);
  const cleared: string[] = [];
  const updated: string[] = [];
  if (!store) return { cleared, updated };

  const remove = (key: string) => {
    if (store.getItem(key) === null) return;
    store.removeItem(key);
    cleared.push(key);
  };

  if (!params.hasValidSession) {
    remove(SESSION_TOKEN_KEY);
    remove(SESSION_USER_KEY);
    remove(SELECTED_COMPANY_KEY);
    remove(ACTIVE_COMPANY_KEY);
    remove(SELECTED_BRANCH_KEY);
    remove(ACTIVE_BRANCH_KEY);
  }

  if (params.setupComplete) {
    if (store.getItem('shamel_setup_done') !== '1') {
      store.setItem('shamel_setup_done', '1');
      updated.push('shamel_setup_done');
    }
    remove('shamel_setup_activation_done');
  } else {
    remove('shamel_setup_done');
  }

  // Guard against stale "has org" flag if no session survived.
  if (!params.hasValidSession) {
    remove(HAS_COMPANY_KEY);
  }

  return { cleared, updated };
};

export const collectStartupSnapshot = (storage?: StorageLike | null) => {
  const store = resolveStorage(storage);
  if (!store) return {};
  const rawOrgs = store.getItem('shamel_orgs_list');
  let orgsCount = 0;
  try {
    orgsCount = rawOrgs ? JSON.parse(rawOrgs).length : 0;
  } catch {
    orgsCount = 0;
  }
  return {
    token: Boolean(store.getItem(SESSION_TOKEN_KEY)),
    user: Boolean(store.getItem(SESSION_USER_KEY)),
    selectedCompanyId: store.getItem(SELECTED_COMPANY_KEY) || store.getItem(ACTIVE_COMPANY_KEY),
    selectedBranchId: store.getItem(SELECTED_BRANCH_KEY) || store.getItem(ACTIVE_BRANCH_KEY),
    hasOrgFlag: store.getItem(HAS_COMPANY_KEY),
    setupDone: store.getItem('shamel_setup_done'),
    setupActivationDone: store.getItem('shamel_setup_activation_done'),
    activated: store.getItem('shamel_activated'),
    activationType: store.getItem('shamel_activation_type'),
    appMode: store.getItem('shamel_app_mode'),
    orgsCount,
  };
};

export const isUnauthorizedError = (error: any) => {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = String(error?.code || error?.response?.data?.code || '').toUpperCase();
  return status === 401 || status === 403 || code === 'UNAUTHENTICATED' || code === 'INVALID_SESSION' || code === 'FORBIDDEN';
};
