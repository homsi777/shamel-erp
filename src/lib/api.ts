
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Currency, Institution, OpeningBalanceLine, OpeningStockLine, SystemEvent, SystemEventsResponse } from '../types';
import { getAppMode, isStandaloneMode as isStandaloneAppMode, isSyncedMode } from './appMode';
import { getResolvedDeploymentConfig, normalizeApiBaseUrl } from './deployment';
import { localRuntimeRequest } from './localRuntime';
import { shouldUseLocalApiRuntime } from './runtimeContext';
import {
  clearStoredSessionAndCompany,
  getSelectedBranchId,
  getSelectedCompanyId as getSelectedCompanyIdFromSession,
  getStoredToken,
  navigateToCompanyRoute,
  reloadApplication,
  setSelectedBranchId,
  setSelectedCompanyId as setSelectedCompanyIdInSession,
  setStoredToken,
  setStoredUser,
  switchBranchSession,
} from './companySession';
import { clearSuperAdminSession, getStoredSuperAdminToken } from './superAdminSession';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const isNative = Capacitor.isNativePlatform();

// خطأ الشبكة المخصص
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * 250);
const upper = (v: any) => String(v || '').toUpperCase();
const COMPANY_CONTEXT_OPTIONAL_ENDPOINTS = new Set([
  'login',
  'session/companies',
  'session/company-context',
  'session/branches',
  'session/branch-context',
  'public/companies',
  'setup/status',
  'setup/complete',
  'activation/status',
  'activation/activate',
  'activation/notify-success',
  'backups/list',
  'backups/create/json',
  'backups/create/db',
  'backups/restore/json',
  'backups/restore/from-backup',
  'backups/restore/db-upload',
  'backups/restore/db-from-backup',
  'system/status',
  'system/db-status',
]);

const BOOTSTRAP_PUBLIC_ENDPOINTS = new Set([
  'public/companies',
  'setup/status',
  'setup/complete',
  'activation/status',
  'activation/activate',
  'activation/notify-success',
]);

const sanitizeBootstrapHeaders = (headers: Record<string, any> = {}) => {
  const next = { ...headers };
  delete next.Authorization;
  delete next.authorization;
  delete next['X-Active-Org'];
  delete next['x-active-org'];
  delete next['X-Company-Id'];
  delete next['x-company-id'];
  delete next['X-Branch-Id'];
  delete next['x-branch-id'];
  return next;
};

const isAxiosNetworkError = (error: any) => {
  if (!error) return false;
  if (error instanceof NetworkError || error?.name === 'NetworkError') return true;
  if (error?.code === 'ECONNABORTED') return true;
  if (!error?.response && error?.request) return true;
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('network error') || msg.includes('timeout') || msg.includes('failed to fetch') || msg.includes('load failed');
};

const isNativeNetworkError = (error: any) => {
  if (!error) return false;
  if (error instanceof NetworkError || error?.name === 'NetworkError') return true;
  if (error?.response || error?.status) return false;
  const msg = String(error?.message || error?.error || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('network') || msg.includes('failed') || msg.includes('offline') || msg.includes('not connected') || msg.includes('connection');
};

const shouldRetryRequest = (method: string, endpoint: string, headers: Record<string, any>, attempt: number, maxRetries: number, error: any) => {
  if (attempt >= maxRetries) return false;
  const m = upper(method);
  const hasSync = !!(headers as any)?.['X-Sync-ID'] || !!(headers as any)?.['x-sync-id'];
  const allowUnsafe = endpoint === 'login' || hasSync;
  const isSafe = m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  if (!(isSafe || allowUnsafe)) return false;
  if (isAxiosNetworkError(error) || isNativeNetworkError(error)) return true;
  const status = Number(error?.response?.status || error?.status || 0);
  return status === 408 || status === 429 || status >= 500;
};

export const isStandaloneMode = () => isStandaloneAppMode();

export const formatUrl = (ip: string) => {
  const normalized = normalizeApiBaseUrl(ip);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (!url.port) {
      url.port = '3111';
    }
    return `${url.origin}/api`;
  } catch {
    return normalized;
  }
};

export const getApiBaseUrl = () => API_CONFIG.baseUrl;

export const buildApiUrl = (path: string) => {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
};

const getInitialBaseUrl = () => {
  const appMode = getAppMode();
  const saved = localStorage.getItem('shamel_api_url');
  const source = localStorage.getItem('shamel_api_url_source');
  const isFileProtocol = window.location.protocol === 'file:';
  const deployment = getResolvedDeploymentConfig();
  const envApiBaseUrl = String(import.meta?.env?.VITE_API_BASE_URL || '').trim();
  const normalizedEnvApiBaseUrl = envApiBaseUrl ? formatUrl(envApiBaseUrl) : '';

  if (normalizedEnvApiBaseUrl) {
    return normalizedEnvApiBaseUrl;
  }

  if (deployment.mode === 'local_network' && deployment.role === 'terminal') {
    const explicit = formatUrl(deployment.apiBaseUrl || saved || '');
    return explicit || '';
  }

  if (appMode === 'synced') {
    if (saved) return saved;
    return '';
  }

  if (isElectron && isFileProtocol) {
    if (saved && source === 'user') return saved;
    if (deployment.mode === 'local_network' && deployment.role === 'host' && deployment.apiBaseUrl) {
      return formatUrl(deployment.apiBaseUrl);
    }
    return 'http://127.0.0.1:3111/api';
  }
  if (saved && source === 'user') return saved;
  const hostname = window.location.hostname || '127.0.0.1';
  return `http://${hostname}:3111/api`;
};

export const API_CONFIG = {
  baseUrl: getInitialBaseUrl(),
  timeout: 8000,
};

const apiClient = axios.create({
  baseURL: API_CONFIG.baseUrl,
  timeout: API_CONFIG.timeout,
});

axiosRetry(apiClient, { retries: 0 });

export const setApiUrl = (ip: string) => {
  const url = formatUrl(ip);
  if (!url) return;
  API_CONFIG.baseUrl = url;
  localStorage.setItem('shamel_api_url', url);
  localStorage.setItem('shamel_api_url_source', 'user');
  apiClient.defaults.baseURL = url;
};

export const getStoredServerIP = () => {
    const deployment = getResolvedDeploymentConfig();
    const fallbackUrl = deployment.mode === 'local_network' && deployment.role === 'terminal'
      ? deployment.apiBaseUrl
      : null;
    if (!isSyncedMode() && !fallbackUrl) return '';
    const url = localStorage.getItem('shamel_api_url') || fallbackUrl;
    if (!url) return '';
    try {
        const u = new URL(url.replace('/api', ''));
        return u.hostname;
    } catch { return ''; }
};

const getBaseUrlOrThrow = () => {
    const base = API_CONFIG.baseUrl;
    if (isSyncedMode() && !base) {
        throw new NetworkError('يرجى تحديد عنوان الخادم أولًا قبل المتابعة.');
    }
    return base;
};

export const checkServerConnection = async (ip?: string): Promise<any> => {
    if (shouldUseLocalApiRuntime()) return { ok: true, mode: 'local' };
    if (isSyncedMode() && !ip && !API_CONFIG.baseUrl) return false;
    const baseUrl = ip ? formatUrl(ip) : API_CONFIG.baseUrl;
    if (!baseUrl) return false;
    const testUrl = `${baseUrl.replace('/api', '')}/api/system/status`;
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (isNative && !isElectron) {
          const response = await CapacitorHttp.request({ method: 'GET', url: testUrl, connectTimeout: 3000 as any, readTimeout: 3000 as any } as any);
          if (response.status === 200) return response.data;
          return false;
        }
        const response = await axios.get(testUrl, { timeout: 3000 });
        if (response.status === 200) return response.data;
        return false;
      } catch (e: any) {
        if (!shouldRetryRequest('GET', 'system/status', {}, attempt, maxRetries, e)) return false;
        await sleep(jitter(250 * Math.pow(2, attempt)));
      }
    }
    return false;
};

export const apiRequest = async (endpoint: string, options: any = {}) => {
  const isSuperAdminEndpoint = endpoint.startsWith('super-admin/') || endpoint.startsWith('backups/');
  const isBootstrapEndpoint = BOOTSTRAP_PUBLIC_ENDPOINTS.has(endpoint);
  const optionHeaders = isBootstrapEndpoint ? sanitizeBootstrapHeaders(options.headers || {}) : (options.headers || {});
  const requestBody = options.body
    ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body)
    : undefined;
  const selectedCompanyId = getSelectedCompanyIdFromSession();
  const selectedBranchId = getSelectedBranchId();
  const requestCompanyId = String(requestBody?.companyId || selectedCompanyId || '').trim() || null;
  const requestBranchId = String(requestBody?.branchId || selectedBranchId || '').trim() || null;
  if (!isSuperAdminEndpoint && !COMPANY_CONTEXT_OPTIONAL_ENDPOINTS.has(endpoint) && !requestCompanyId) {
    throw new Error('\u064a\u062c\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0645\u0624\u0633\u0633\u0629 \u0642\u0628\u0644 \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629.');
  }
  if (endpoint === 'login' && requestBody && !requestBody.companyId && requestCompanyId) {
    requestBody.companyId = requestCompanyId;
  }
  if (!isSuperAdminEndpoint && shouldUseLocalApiRuntime()) {
    return localRuntimeRequest(endpoint, {
      ...options,
      headers: {
        ...optionHeaders,
        ...(!isBootstrapEndpoint && requestCompanyId ? { 'X-Active-Org': requestCompanyId, 'X-Company-Id': requestCompanyId } : {}),
        ...(!isBootstrapEndpoint && requestBranchId ? { 'X-Branch-Id': requestBranchId } : {}),
      },
      body: requestBody,
    });
  }
  const token = isBootstrapEndpoint
    ? null
    : (isSuperAdminEndpoint ? (getStoredSuperAdminToken() || getStoredToken()) : getStoredToken());
  const baseUrl = getBaseUrlOrThrow();
  
  const config: any = {
    method: options.method || 'GET',
    url: endpoint,
    headers: {
        'Content-Type': 'application/json',
        ...(!isBootstrapEndpoint && requestCompanyId ? { 'X-Active-Org': requestCompanyId, 'X-Company-Id': requestCompanyId } : {}),
        ...(!isBootstrapEndpoint && requestBranchId ? { 'X-Branch-Id': requestBranchId } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...optionHeaders,
    },
    data: requestBody,
  };

  const maxRetries = typeof options.retries === 'number'
    ? Math.max(0, Math.floor(options.retries))
    : (upper(config.method) === 'GET' ? 3 : 2);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (isNative && !isElectron) {
        const base = baseUrl.replace(/\/$/, '');
        const path = endpoint.replace(/^\//, '');
        const url = endpoint.startsWith('http') ? endpoint : `${base}/${path}`;
        const response = await CapacitorHttp.request({
          method: config.method,
          url,
          headers: config.headers,
          data: config.data
        });
        if (response.status && response.status >= 400) {
          const msg = (response.data && (response.data.error || response.data.message)) ? (response.data.error || response.data.message) : `فشل الطلب (${response.status})`;
          throw Object.assign(new Error(msg), { status: response.status });
        }
        return response.data;
      }

      const response = await apiClient(config);
      return response.data;
    } catch (error: any) {
      const isNet = isAxiosNetworkError(error) || isNativeNetworkError(error);
      if (isNet && !shouldRetryRequest(config.method, endpoint, config.headers || {}, attempt, maxRetries, error)) {
        throw new NetworkError("فشل الاتصال بالسيرفر. يرجى التحقق من الشبكة.");
      }
      if (!shouldRetryRequest(config.method, endpoint, config.headers || {}, attempt, maxRetries, error)) {
        const serverData = error?.response?.data;
        const serverMessage = serverData?.error || serverData?.message;
        if (serverMessage) {
          const err = new Error(serverMessage);
          (err as any).status = error?.response?.status || error?.status;
          (err as any).code = serverData?.code;
          (err as any).details = serverData?.details;
          throw err;
        }
        throw error;
      }
      await sleep(jitter(350 * Math.pow(2, attempt)));
    }
  }
  throw new NetworkError("فشل الاتصال بالسيرفر. يرجى التحقق من الشبكة.");
};

export const postOpeningStock = async (payload: {
  fiscalYear: string;
  warehouseId: string | number;
  currency: Currency;
  date: string;
  lines: OpeningStockLine[];
  exchangeRate?: number;
}) => {
  return apiRequest('opening-stock/post', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getOpeningStock = async () => {
  return apiRequest('opening-stock');
};

export const postOpeningReceivables = async (payload: {
  fiscalYear: string;
  currency: Currency;
  date: string;
  lines: OpeningBalanceLine[];
}) => {
  return apiRequest('opening-receivables/bulk', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getOpeningReceivables = async () => {
  return apiRequest('opening-receivables');
};

export const getItems = async () => {
  return apiRequest('inventory');
};

export const getWarehouses = async () => {
  return apiRequest('warehouses');
};

export const getParties = async () => {
  return apiRequest('parties');
};

export const getCashBoxes = async () => {
  return apiRequest('cash-boxes');
};

const buildQueryString = (params: Record<string, any>) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  return search.toString();
};

export const getSystemEvents = async (filters: Record<string, any> = {}): Promise<SystemEventsResponse> => {
  const query = buildQueryString(filters);
  return apiRequest(`system-events${query ? `?${query}` : ''}`);
};

export const exportSystemEvents = async (filters: Record<string, any> = {}): Promise<SystemEventsResponse> => {
  const query = buildQueryString(filters);
  return apiRequest(`system-events/export${query ? `?${query}` : ''}`);
};

export const getSessionBranches = async (): Promise<{
  branches: any[];
  allowedBranchIds: string[];
  currentBranchId?: string | null;
  defaultBranchId?: string | null;
  requiresBranchSelection?: boolean;
  branchScope?: string;
}> => {
  return apiRequest('session/branches');
};

export const getSessionCompanies = async (): Promise<{
  companies: any[];
  allowedCompanyIds: string[];
  currentCompanyId?: string | null;
  defaultCompanyId?: string | null;
}> => {
  return apiRequest('session/companies');
};

export const getPublicCompanies = async (): Promise<{ companies: any[] }> => {
  return apiRequest('public/companies');
};

export const mapBackendCompanyToInstitution = (company: any): Institution => ({
  id: String(company?.id || '').trim(),
  name: String(company?.name || company?.companyName || company?.code || 'Company').trim(),
  type: String(company?.type || 'company').trim() || 'company',
  primaryCurrency: String(company?.primaryCurrency || company?.currency || 'USD').trim().toUpperCase() || 'USD',
  createdAt: String(company?.createdAt || new Date().toISOString()),
  address: String(company?.address || ''),
  phone: String(company?.phone || ''),
  taxId: company?.taxId ? String(company.taxId) : undefined,
  commercialId: company?.commercialId ? String(company.commercialId) : undefined,
  industrialId: company?.industrialId ? String(company.industrialId) : undefined,
  mode: isSyncedMode() ? 'remote' : 'local',
  activeModules: Array.isArray(company?.activeModules) ? company.activeModules : [],
  config: {
    mainWarehouseName: String(company?.mainWarehouseName || 'Main Warehouse'),
    mainCashBoxName: String(company?.mainCashBoxName || 'Main Cash Box'),
    defaultUnit: String(company?.defaultUnit || 'pcs'),
  },
});

export const refreshCompaniesCacheFromSession = async (): Promise<Institution[]> => {
  const response = await getSessionCompanies();
  const mapped = (Array.isArray(response?.companies) ? response.companies : [])
    .map(mapBackendCompanyToInstitution)
    .filter((company) => company.id);
  saveOrgsList(mapped);
  return mapped;
};

export const switchCompanyContext = async (companyId: string, branchId?: string | null) => {
  const response = await apiRequest('session/company-context', {
    method: 'POST',
    body: JSON.stringify({ companyId, branchId: branchId || undefined }),
  });
  if (response?.token) setStoredToken(response.token);
  if (response?.user) setStoredUser(response.user);
  setSelectedCompanyIdInSession(companyId);
  if ((response?.user as any)?.currentBranchId) {
    setSelectedBranchId(String((response.user as any).currentBranchId));
  } else if (branchId) {
    setSelectedBranchId(String(branchId));
  }
  return response;
};

export const switchBranchContext = async (branchId: string) => {
  const response = await apiRequest('session/branch-context', {
    method: 'POST',
    body: JSON.stringify({ branchId }),
  });
  if (response?.token) setStoredToken(response.token);
  if (response?.user) setStoredUser(response.user);
  setSelectedBranchId(branchId);
  switchBranchSession(branchId);
  return response;
};

export const getSystemEvent = async (id: string): Promise<SystemEvent> => {
  return apiRequest(`system-events/${encodeURIComponent(id)}`);
};

export const resolveSystemEvent = async (id: string, note?: string): Promise<{ success: boolean; item: SystemEvent }> => {
  return apiRequest(`system-events/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
};

export const resolveSystemEventsBulk = async (payload: {
  eventIds?: string[];
  severities?: string[];
    eventType?: string;
    sourceModule?: string;
  resolved?: boolean;
  requiresManualReview?: boolean;
  dateFrom?: string;
  dateTo?: string;
  olderThan?: string;
  note?: string;
}): Promise<{ success: boolean; resolvedCount: number }> => {
  return apiRequest('system-events/resolve-bulk', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
};

export const deleteAllSystemEvents = async (): Promise<{ success: boolean; deletedCount: number }> => {
  return apiRequest('system-events/delete-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const deleteVisibleSystemEvents = async (payload: {
  eventIds?: string[];
  severity?: string;
  eventType?: string;
    sourceModule?: string;
  resolved?: boolean;
  requiresManualReview?: boolean;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ success: boolean; deletedCount: number }> => {
  return apiRequest('system-events/delete-visible', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
};

export const setToken = (token: string) => setStoredToken(token);
export const getToken = () => getStoredToken();
export const logout = () => {
  clearStoredSessionAndCompany();
  clearSuperAdminSession();
  navigateToCompanyRoute('select-company');
  reloadApplication();
};
export const getSelectedCompanyId = () => getSelectedCompanyIdFromSession();
export const getCurrentOrgId = () => getSelectedCompanyIdFromSession();
export const getCurrentBranchId = () => getSelectedBranchId();
export const setActiveInstitutionId = (id: string) => setSelectedCompanyIdInSession(id);
export const getOrgsList = () => {
    const saved = localStorage.getItem('shamel_orgs_list');
    return saved ? JSON.parse(saved) : [];
};
export const saveOrgsList = (list: any[]) => {
  try {
    for (const o of list || []) {
      if (o && (o.id == null || String(o.id).trim() === '')) {
        console.warn('[saveOrgsList] entry without company id ignored for safety', o);
      }
    }
  } catch {
    /* ignore */
  }
  localStorage.setItem('shamel_orgs_list', JSON.stringify(list));
};
