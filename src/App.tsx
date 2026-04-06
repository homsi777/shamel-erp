
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import { SmartDrawerProvider, SmartDrawer } from './components/smart';
import { useSmartDrawer } from './hooks/useSmartDrawer';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Invoices from './pages/Invoices';
import POSQuick from './pages/POSQuick';
import StockTaking from './pages/StockTaking';
import Reports from './pages/Reports';
import CustomersSuppliers from './pages/CustomersSuppliers';
import Funds from './pages/Funds';
import Payroll from './pages/Payroll';
import Manufacturing from './pages/Manufacturing';
import Accounts from './pages/Accounts';
import Expenses from './pages/Expenses'; 
import Partners from './pages/Partners'; 
import SettingsPage from './pages/Settings'; 
import Login from './pages/Login';
import OrgManager from './pages/OrgManager';
import SelectCompany from './pages/SelectCompany';
import SelectBranch from './pages/SelectBranch';
import SetupWizard from './pages/SetupWizard';
import SuperAdminLogin from './pages/SuperAdminLogin';
import SuperAdminConsole from './pages/SuperAdminConsole';
import BranchesRadar from './pages/Branches';
import DeliveryNotices from './pages/DeliveryNotices';
import DeliveryApprovals from './pages/DeliveryApprovals';
import Agents from './pages/Agents';
import OpeningBalances from './pages/OpeningBalances';
import OpeningStock from './pages/OpeningStock';
import ConsignmentModule from './pages/consignment/ConsignmentModule';
import SystemMonitoring from './pages/SystemMonitoring';
import CustomerDisplay from './pages/CustomerDisplay';
import PromotionsDisplay from './pages/PromotionsDisplay';
import DeploymentModeSettings from './components/settings/DeploymentModeSettings';
import { Invoice, Client, CashBox, Voucher, Warehouse, AppSettings, AppUser, Partner, PartnerTransaction, DEFAULT_LABELS, DEFAULT_PRINT_SETTINGS, DEFAULT_CURRENCY_RATES, CurrencyRates, InventoryItem, Branch, Agent, PERMISSIONS } from './types';
import { Menu, AlertCircle, ChevronLeft, XCircle, LayoutDashboard, Package, FileText, Users, MoreHorizontal, Zap } from 'lucide-react';
import { useEscapeKey } from './hooks/useEscapeKey';
import {
  apiRequest,
  checkServerConnection,
  getCurrentOrgId,
  getOrgsList,
  logout,
  switchCompanyContext,
} from './lib/api';
import { getActivationMission, getActivationType, getAppModeFromActivationType, isSyncedMode, updateActivationContext } from './lib/appMode';
import { getResolvedDeploymentConfig, normalizeDeploymentConfigInput, persistRuntimeDeploymentConfig, setStoredDeploymentConfig } from './lib/deployment';
import { DEFAULT_PROJECT_PROFILE_ID, normalizeProjectProfile, resolveProjectProfile } from './lib/projectProfiles';
import { getEffectiveVisibleTabs, normalizeModuleControl } from './lib/systemModules';
import { getPreferredLandingTabForUser, getUserScopedVisibleTabs, isAgentRestrictedUser, isRestrictedTextileWarehouseUser } from './lib/userAccess';

const normalizeCurrencyCode = (value: unknown, fallback = 'USD') => {
  const normalized = String(value || fallback).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
};

const normalizeCurrencyRates = (value: unknown): CurrencyRates => {
  const next: Record<string, number> = { USD: 1 };
  if (!value || typeof value !== 'object') return { ...DEFAULT_CURRENCY_RATES, ...next };
  for (const [rawCode, rawRate] of Object.entries(value as Record<string, unknown>)) {
    const code = normalizeCurrencyCode(rawCode, '');
    const rate = Number(rawRate);
    if (!code || !Number.isFinite(rate) || rate <= 0) continue;
    next[code] = rate;
  }
  return { ...DEFAULT_CURRENCY_RATES, ...next };
};
import { useSyncQueue } from './hooks/useSyncQueue';
import { useSystemSync } from './hooks/useSystemSync';
import { useClientHeartbeat } from './hooks/useClientHeartbeat';
import Toast from './components/Toast';
import type { ConfirmOptions } from './lib/confirm';
import useResponsiveLayout from './hooks/useResponsiveLayout';
import { MobileBottomNav } from './components/responsive';
import {
  clearStoredSession,
  clearStoredCompanySelection,
  clearStoredSessionAndCompany,
  getCompanyRouteFromHash,
  getSelectedCompanyId,
  type CompanyRoute,
  navigateToCompanyRoute,
  setSelectedBranchId,
  setSelectedCompanyId,
  setStoredUser,
} from './lib/companySession';
import { collectStartupSnapshot, resolveStartupDecision, sanitizeStartupStorage } from './lib/startupFlow';
import { getSuperAdminRouteFromHash, hasSuperAdminSession } from './lib/superAdminSession';
import { isRestaurantModuleEnabled } from './lib/restaurantFeature';
import { parseRestaurantPublicTokenFromHash, parseRestaurantPublicTokenFromUrl, parseRestaurantViewFromHash, setRestaurantHash } from './lib/restaurantHash';
import { isWebBrowserClient } from './lib/platform';

const RestaurantModule = lazy(() => import('./modules/restaurant/RestaurantModule'));
const RestaurantPublicMenuPage = lazy(() => import('./modules/restaurant/public/RestaurantPublicMenuPage'));
const QrMenuPage = lazy(() => import('./modules/restaurant/qr-menu/QrMenuPage'));
import RestaurantOperationsDashboard from './modules/restaurant/RestaurantOperationsDashboard';
import RestaurantSettings from './modules/restaurant/RestaurantSettings';
import RestaurantReports from './modules/restaurant/RestaurantReports';
import RestaurantQR from './modules/restaurant/RestaurantQR';

const ALERT_EVENT_NAME = 'shamel-alert';
type ToastType = 'success' | 'error' | 'warning';

const App: React.FC = () => {
  const isCustomerDisplayRoute =
    typeof window !== 'undefined' &&
    String(window.location.hash || '').toLowerCase().includes('customer-display');
  const isPromotionsDisplayRoute =
    typeof window !== 'undefined' &&
    String(window.location.hash || '').toLowerCase().includes('promotions-display');

  const restaurantPublicToken =
    typeof window !== 'undefined'
      ? (parseRestaurantPublicTokenFromHash(window.location.hash) || parseRestaurantPublicTokenFromUrl(window.location.href))
      : null;
  const isRestaurantPublicRoute = Boolean(restaurantPublicToken);
  const restaurantPublicRedirectPort = String(import.meta?.env?.VITE_QR_MENU_PORT || window.location.port || '3111').trim();

  const [isActivated, setIsActivated] = useState(() => localStorage.getItem('shamel_activated') === '1');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser | undefined>(undefined);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRoute, setAuthRoute] = useState<'select-company' | 'login' | 'select-branch' | 'app'>(() => getCompanyRouteFromHash());
  const [superAdminRoute, setSuperAdminRoute] = useState(() => getSuperAdminRouteFromHash());
  const [needsSetup, setNeedsSetup] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false); 
  const [hasOrg, setHasOrg] = useState(false);
  const [isManagingOrgs, setIsManagingOrgs] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isBackendReady, setIsBackendReady] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendReadyAttempts, setBackendReadyAttempts] = useState(0);
  const [startupDeployment, setStartupDeployment] = useState(() => getResolvedDeploymentConfig());
  const [isApplyingStartupDeployment, setIsApplyingStartupDeployment] = useState(false);
  const layout = useResponsiveLayout();
  const startupDebugEnabled = Boolean(import.meta?.env?.DEV);
  const logStartup = useCallback((message: string, payload?: unknown) => {
    if (!startupDebugEnabled) return;
    if (payload === undefined) {
      console.log(`[startup] ${message}`);
    } else {
      console.log(`[startup] ${message}`, payload);
    }
  }, [startupDebugEnabled]);

  const { processQueue } = useSyncQueue();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subCategories, setSubCategories] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerTransactions, setPartnerTransactions] = useState<PartnerTransaction[]>([]);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: ToastType }>>([]);
  const toastIdRef = useRef(0);
  const pendingDeliveryRef = useRef<Set<string>>(new Set());
  const isPosOnlyUser = useCallback((user?: AppUser) => {
    if (!user || user.role === 'admin') return false;
    const posPerms = new Set<string>([
      PERMISSIONS.ACCESS_POS,
      PERMISSIONS.POS_ONLY,
      PERMISSIONS.POS_CASHIER,
      PERMISSIONS.MANAGE_POS_CURRENCY,
      PERMISSIONS.AUTO_PRINT_POS_RECEIPT,
      PERMISSIONS.CREATE_SALE_INVOICE,
      PERMISSIONS.MANAGE_CLIENTS
    ]);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes(PERMISSIONS.POS_ONLY) || (perms.length > 0 && perms.every((perm) => posPerms.has(perm)) && perms.includes(PERMISSIONS.ACCESS_POS));
  }, []);
  const isAgentRestrictedMode = useCallback((user?: AppUser) => isAgentRestrictedUser(user), []);
  const isTextileRestrictedUser = useCallback((user?: AppUser) => isRestrictedTextileWarehouseUser(user), []);
  const hasCachedOrg = () => {
    const flag = localStorage.getItem('shamel_has_org');
    if (flag === '1') return true;
    return !!localStorage.getItem('shamel_settings');
  };
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    message: string;
    title: string;
    confirmText: string;
    cancelText: string;
    resolve?: (value: boolean) => void;
  }>({
    open: false,
    message: '',
    title: 'تأكيد',
    confirmText: 'موافق',
    cancelText: 'إلغاء'
  });

  // ESC key closes confirm dialog
  useEscapeKey(confirmState.open, useCallback(() => {
    confirmState.resolve?.(false);
    setConfirmState((prev) => ({ ...prev, open: false }));
  }, [confirmState.resolve]));

  // Global ESC event for page-level modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('shamel-modal-escape'));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useClientHeartbeat(isRestaurantPublicRoute ? false : (isAuthenticated && !isAgentRestrictedMode(currentUser)));

  const applyStartupDeployment = useCallback(async (nextConfig: AppSettings['deployment']) => {
    const normalized = normalizeDeploymentConfigInput(nextConfig || {});
    setIsApplyingStartupDeployment(true);
    try {
      await persistRuntimeDeploymentConfig(normalized);
      setStartupDeployment(normalized);
      setSettings((current) => {
        const next = { ...current, deployment: normalized };
        localStorage.setItem('shamel_settings', JSON.stringify(next));
        return next;
      });
      if (window.electronAPI?.restartApp) {
        await window.electronAPI.restartApp();
        return;
      }
      window.location.reload();
    } finally {
      setIsApplyingStartupDeployment(false);
    }
  }, []);

  useEffect(() => {
    if (isRestaurantPublicRoute) return;
    const syncHashRoute = () => {
      setAuthRoute(getCompanyRouteFromHash());
      setSuperAdminRoute(getSuperAdminRouteFromHash());
    };
    syncHashRoute();
    window.addEventListener('hashchange', syncHashRoute);
    return () => window.removeEventListener('hashchange', syncHashRoute);
  }, [isRestaurantPublicRoute]);

  /** Deep-link: #/kitchen/tables | #/kitchen/qr-menu (+ legacy #/restaurant/qr). */
  useEffect(() => {
    if (isRestaurantPublicRoute) return;
    if (!isAuthenticated || authRoute !== 'app' || !currentUser) return;
    if (!isRestaurantModuleEnabled()) return;
    if (isPosOnlyUser(currentUser) || isAgentRestrictedMode(currentUser)) return;
    const apply = () => {
      const v = parseRestaurantViewFromHash();
      if (v === 'tables') setActiveTab('restaurant_tables');
      else if (v === 'qr-menu') setActiveTab('restaurant_menu_qr');
      else if (v === 'qr') setActiveTab('restaurant_qr');
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [isAuthenticated, authRoute, currentUser, isPosOnlyUser, isAgentRestrictedMode, isRestaurantPublicRoute]);

  useEffect(() => {
    if (isRestaurantPublicRoute) return;
    if (!isAuthenticated || authRoute !== 'app' || !currentUser) return;
    if (!isRestaurantModuleEnabled()) return;
    if (isPosOnlyUser(currentUser) || isAgentRestrictedMode(currentUser)) return;
    if (!['restaurant_tables', 'restaurant_qr', 'restaurant_menu_qr'].includes(activeTab)) return;
    const v = parseRestaurantViewFromHash();
    const want = activeTab === 'restaurant_tables'
      ? 'tables'
      : activeTab === 'restaurant_menu_qr'
        ? 'qr-menu'
        : 'qr';
    if (v !== want) setRestaurantHash(want);
  }, [activeTab, isAuthenticated, authRoute, currentUser, isPosOnlyUser, isAgentRestrictedMode, isRestaurantPublicRoute]);

  useEffect(() => {
    if (isRestaurantPublicRoute) return;
    if (!isRestaurantModuleEnabled()) return;
    if (!isAuthenticated || authRoute !== 'app' || !currentUser || isPosOnlyUser(currentUser) || isAgentRestrictedMode(currentUser)) return;
    if (['restaurant_tables', 'restaurant_qr', 'restaurant_menu_qr'].includes(activeTab)) return;
    if (parseRestaurantViewFromHash()) {
      window.location.hash = '#/';
    }
  }, [activeTab, isAuthenticated, authRoute, currentUser, isPosOnlyUser, isAgentRestrictedMode, isRestaurantPublicRoute]);

  useEffect(() => {
    if (isRestaurantPublicRoute) return;
    if (isRestaurantModuleEnabled()) return;
    if (['restaurant_tables', 'restaurant_qr', 'restaurant_menu_qr', 'restaurant_settings', 'restaurant_reports'].includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, isRestaurantPublicRoute]);

  const fetchData = async (options?: { restricted?: boolean }) => {
    try {
      // ?????????? ?????????????? ???? try/catch ?????????? ?????? ?????? ?????????? ?????? ???????? ????????????
      const fetchSafe = async (endpoint: string) => {
          try { return await apiRequest(endpoint); } catch (e) { console.warn(`Failed to fetch ${endpoint}`); return []; }
      };
      const buildRestrictedAgentInventory = (catalogRows: any[], agentInventoryRows: any[]) => {
        const catalog = Array.isArray(catalogRows) ? catalogRows : [];
        const lines = Array.isArray(agentInventoryRows) ? agentInventoryRows : [];
        const itemMap = new Map(catalog.map((item: any) => [String(item.id || ''), item]));
        return lines.map((line: any) => {
          const itemId = String(line?.itemId || '');
          const master = itemMap.get(itemId) || line || {};
          const delegatePrice = Number((master as any)?.delegatePrice ?? (line as any)?.delegatePrice ?? (master as any)?.delegatePriceBase ?? 0);
          const fallbackRetailPrice = Number((master as any)?.posPrice ?? (line as any)?.posPrice ?? master?.salePrice ?? (line as any)?.salePrice ?? 0);
          const effectiveAgentPrice = delegatePrice > 0 ? delegatePrice : fallbackRetailPrice;
          const effectiveAgentPriceBase = Number((master as any)?.delegatePriceBase ?? (line as any)?.delegatePriceBase ?? (master as any)?.delegatePrice ?? (line as any)?.delegatePrice ?? 0) > 0
            ? Number((master as any)?.delegatePriceBase ?? (line as any)?.delegatePriceBase ?? (master as any)?.delegatePrice ?? (line as any)?.delegatePrice ?? 0)
            : Number((master as any)?.posPriceBase ?? (line as any)?.posPriceBase ?? (master as any)?.salePriceBase ?? (line as any)?.salePriceBase ?? (master as any)?.posPrice ?? (line as any)?.posPrice ?? master?.salePrice ?? (line as any)?.salePrice ?? 0);
          return {
            ...master,
            id: itemId,
            userId: String(line?.agentId || ''),
            agentId: String(line?.agentId || ''),
            warehouseId: '',
            warehouseName: '',
            name: String(line?.itemName || master?.name || itemId),
            code: String(master?.code || itemId),
            imageUrl: String((master as any)?.imageUrl || (line as any)?.imageUrl || ''),
            unitName: String(line?.unitName || master?.unitName || 'وحدة'),
            quantity: Number(line?.quantity || 0),
            costPrice: Number((master as any)?.costPrice ?? (line as any)?.costPrice ?? 0),
            salePrice: effectiveAgentPrice,
            wholesalePrice: Number((master as any)?.wholesalePrice ?? (line as any)?.wholesalePrice ?? 0),
            distributionPrice: Number((master as any)?.distributionPrice ?? (line as any)?.distributionPrice ?? (master as any)?.distributionPriceBase ?? 0),
            delegatePrice,
            posPrice: effectiveAgentPrice,
            costPriceBase: Number((master as any)?.costPriceBase ?? (line as any)?.costPriceBase ?? (master as any)?.costPrice ?? (line as any)?.costPrice ?? 0),
            salePriceBase: effectiveAgentPriceBase,
            wholesalePriceBase: Number((master as any)?.wholesalePriceBase ?? (line as any)?.wholesalePriceBase ?? (master as any)?.wholesalePrice ?? (line as any)?.wholesalePrice ?? 0),
            distributionPriceBase: Number((master as any)?.distributionPriceBase ?? (line as any)?.distributionPriceBase ?? (master as any)?.distributionPrice ?? (line as any)?.distributionPrice ?? 0),
            delegatePriceBase: Number((master as any)?.delegatePriceBase ?? (line as any)?.delegatePriceBase ?? (master as any)?.delegatePrice ?? (line as any)?.delegatePrice ?? 0),
            posPriceBase: effectiveAgentPriceBase,
            priceCurrency: String(master?.priceCurrency || (line as any)?.priceCurrency || 'USD'),
            itemType: master?.itemType || (line as any)?.itemType || 'STOCK',
            inactive: false,
            merged: false,
            lastUpdated: String(line?.updatedAt || line?.createdAt || master?.lastUpdated || (line as any)?.lastUpdated || new Date().toISOString()),
          };
        });
      };

      const restricted = options?.restricted ?? isAgentRestrictedMode(currentUser);
      if (restricted) {
        const [agentInventoryRows, fetchedBranchPayload, fetchedClients, fetchedBoxes, fetchedCats, fetchedSubCats] = await Promise.all([
          fetchSafe('agent-inventory'),
          fetchSafe('session/branches'),
          fetchSafe('clients'),
          fetchSafe('cash-boxes'),
          fetchSafe('categories'),
          fetchSafe('sub-categories'),
        ]);
        setItems(buildRestrictedAgentInventory([], agentInventoryRows as any[]));
        setWarehouses([]);
        setBranches(Array.isArray((fetchedBranchPayload as any)?.branches) ? (fetchedBranchPayload as any).branches : (Array.isArray(fetchedBranchPayload) ? fetchedBranchPayload : []));
        setClients(fetchedClients);
        setCashBoxes(fetchedBoxes);
        setCategories(fetchedCats);
        setSubCategories(fetchedSubCats);
        return;
      }

      const [fetchedItems, fetchedWarehouses, fetchedBranchPayload, fetchedClients, fetchedInvoices, fetchedBoxes, fetchedVouchers, fetchedPartners, fetchedPartnerTrans, fetchedUsers, fetchedCats, fetchedSubCats, fetchedAgents] = await Promise.all([
        fetchSafe('inventory'),
        fetchSafe('warehouses'),
        fetchSafe('session/branches'),
        fetchSafe('clients'),
        fetchSafe('invoices'),
        fetchSafe('cash-boxes'),
        fetchSafe('vouchers'),
        fetchSafe('partners'),
        fetchSafe('partner-transactions'),
        fetchSafe('users'),
        fetchSafe('categories'),
        fetchSafe('sub-categories'),
        fetchSafe('agents')
      ]);

      setItems(fetchedItems);
      setWarehouses(fetchedWarehouses);
      setBranches(Array.isArray((fetchedBranchPayload as any)?.branches) ? (fetchedBranchPayload as any).branches : (Array.isArray(fetchedBranchPayload) ? fetchedBranchPayload : []));
      setClients(fetchedClients);
      setInvoices(fetchedInvoices);
      setCashBoxes(fetchedBoxes);
      setVouchers(fetchedVouchers);
      setPartners(fetchedPartners);
      setPartnerTransactions(fetchedPartnerTrans);
      setCategories(fetchedCats);
      setSubCategories(fetchedSubCats);
      setUsers(fetchedUsers);
      setAgents(fetchedAgents);
      
      if (navigator.onLine && isSyncedMode()) {
        processQueue();
      }
    } catch (error) {
      console.error("Data Fetch Error:", error);
    }
  };

  const syncInFlightRef = useRef(false);
  const triggerSystemSync = useCallback(async (reason?: string) => {
    if (!isAuthenticated) return;
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    try {
      await fetchData();
      logStartup(`system sync${reason ? `: ${reason}` : ''}`);
    } finally {
      syncInFlightRef.current = false;
    }
  }, [fetchData, isAuthenticated, logStartup]);

  useSystemSync(isAuthenticated, (payload) => {
    void triggerSystemSync(payload?.reason);
  });

  const requiresBranchSelection = useCallback((user?: AppUser | null) => {
    if (!user) return false;
    const allowedBranchIds = Array.isArray(user.allowedBranchIds)
      ? user.allowedBranchIds.filter(Boolean)
      : [];
    if (allowedBranchIds.length <= 1) return false;
    return Boolean(user.requiresBranchSelection || !user.currentBranchId);
  }, []);

  const handleLoginSuccess = async (user: AppUser) => {
    const selectedCompanyId = getSelectedCompanyId();
    if (!selectedCompanyId || !user.companyId || user.companyId !== selectedCompanyId) {
      clearStoredSessionAndCompany();
      setIsAuthenticated(false);
      setCurrentUser(undefined);
      setHasOrg(getOrgsList().length > 0 || hasCachedOrg());
      navigateToCompanyRoute('select-company');
      setAuthRoute('select-company');
      return;
    }
    setStoredUser(user);
    if (user.currentBranchId) {
      setSelectedBranchId(user.currentBranchId);
    }
    if (requiresBranchSelection(user)) {
      setIsAuthenticated(true);
      setCurrentUser(user);
      setAuthRoute('select-branch');
      navigateToCompanyRoute('select-branch');
      return;
    }
    setIsAuthenticated(true);
    setCurrentUser(user);
    const orgId = getCurrentOrgId();
    const isPosOnlyMode = isPosOnlyUser(user);
    const isAgentRestricted = isAgentRestrictedMode(user);
    const isTextileRestrictedMode = isTextileRestrictedUser(user);
    const syncedSettings = isAgentRestricted ? null : await syncSettingsFromServer();
    if (isAgentRestricted) {
      setActiveTab('pos');
      setIsSidebarCollapsed(true);
    } else if (isPosOnlyMode) {
      setActiveTab('pos');
      setIsSidebarCollapsed(true);
    } else if (isTextileRestrictedMode) {
      const projectProfile = resolveProjectProfile(syncedSettings || settings);
      const baseVisibleTabs = getEffectiveVisibleTabs(projectProfile.id, syncedSettings?.moduleControl || settings.moduleControl);
      setActiveTab(getPreferredLandingTabForUser(user, getUserScopedVisibleTabs(user, baseVisibleTabs)));
      setIsSidebarCollapsed(true);
    } else {
      setActiveTab(getPreferredLandingTab(syncedSettings || settings, user));
      setIsSidebarCollapsed(false);
    }
    if (orgId && orgId !== 'default') {
      setHasOrg(true);
      localStorage.setItem('shamel_has_org', '1');
      fetchData({ restricted: isAgentRestricted });
    } else if (syncedSettings) {
      setHasOrg(true);
      localStorage.setItem('shamel_has_org', '1');
      fetchData({ restricted: isAgentRestricted });
    } else if (hasCachedOrg()) {
      setHasOrg(true);
    } else {
      setHasOrg(false);
    }
    navigateToCompanyRoute('app');
    setAuthRoute('app');
  };

  const handleBranchSelectionSuccess = async (user?: AppUser) => {
    const nextUser = user || currentUser;
    if (!nextUser) {
      navigateToCompanyRoute('select-company');
      setAuthRoute('select-company');
      return;
    }
    if (nextUser.currentBranchId) {
      setSelectedBranchId(nextUser.currentBranchId);
    }
    const isPosOnlyMode = isPosOnlyUser(nextUser);
    const isAgentRestricted = isAgentRestrictedMode(nextUser);
    const isTextileRestrictedMode = isTextileRestrictedUser(nextUser);
    pendingDeliveryRef.current.clear();
    setCurrentUser(nextUser);
    setIsAuthenticated(true);
    const syncedSettings = isAgentRestricted ? null : await syncSettingsFromServer();
    if (isAgentRestricted) {
      setActiveTab('pos');
      setIsSidebarCollapsed(true);
    } else if (isPosOnlyMode) {
      setActiveTab('pos');
      setIsSidebarCollapsed(true);
    } else if (isTextileRestrictedMode) {
      const projectProfile = resolveProjectProfile(syncedSettings || settings);
      const baseVisibleTabs = getEffectiveVisibleTabs(projectProfile.id, syncedSettings?.moduleControl || settings.moduleControl);
      setActiveTab(getPreferredLandingTabForUser(nextUser, getUserScopedVisibleTabs(nextUser, baseVisibleTabs)));
      setIsSidebarCollapsed(true);
    } else {
      setActiveTab(getPreferredLandingTab(syncedSettings || settings, nextUser));
      setIsSidebarCollapsed(false);
    }
    navigateToCompanyRoute('app');
    setAuthRoute('app');
    fetchData({ restricted: isAgentRestricted });
  };

  const handleCompanySelection = async (companyId: string) => {
    try {
      const response = await switchCompanyContext(companyId);
      if (!response?.user) {
        throw new Error('COMPANY_CONTEXT_FAILED');
      }
      const nextUser = response.user as AppUser;
      setStoredUser(nextUser);
      setIsAuthenticated(true);
      setCurrentUser(nextUser);
      if (nextUser.currentBranchId) {
        setSelectedBranchId(nextUser.currentBranchId);
      }
      if (requiresBranchSelection(nextUser)) {
        setAuthRoute('select-branch');
        navigateToCompanyRoute('select-branch');
        return;
      }
      const isPosOnlyMode = isPosOnlyUser(nextUser);
      const isAgentRestricted = isAgentRestrictedMode(nextUser);
      const isTextileRestrictedMode = isTextileRestrictedUser(nextUser);
      if (isAgentRestricted) {
        setActiveTab('pos');
        setIsSidebarCollapsed(true);
      } else if (isPosOnlyMode) {
        setActiveTab('pos');
        setIsSidebarCollapsed(true);
      } else if (isTextileRestrictedMode) {
        const projectProfile = resolveProjectProfile(settings);
        const baseVisibleTabs = getEffectiveVisibleTabs(projectProfile.id, settings.moduleControl);
        setActiveTab(getPreferredLandingTabForUser(nextUser, getUserScopedVisibleTabs(nextUser, baseVisibleTabs)));
        setIsSidebarCollapsed(true);
      } else {
        setActiveTab(getPreferredLandingTab(settings, nextUser));
        setIsSidebarCollapsed(false);
      }
      if (!isAgentRestricted) {
        await syncSettingsFromServer();
      }
      fetchData({ restricted: isAgentRestricted });
      navigateToCompanyRoute('app');
      setAuthRoute('app');
    } catch (error) {
      clearStoredSessionAndCompany();
      setIsAuthenticated(false);
      setCurrentUser(undefined);
      setAuthRoute('select-company');
      navigateToCompanyRoute('select-company');
    }
  };

  const handlePreloginCompanySelection = (companyId: string) => {
    if (!companyId) return;
    setSelectedCompanyId(companyId);
    setAuthRoute('login');
    navigateToCompanyRoute('login');
  };

  const handleLogout = () => {
    logout();
    setIsAuthenticated(false);
    setCurrentUser(undefined);
    setAuthRoute('select-company');
  };

  const getToastType = useCallback((message: string): ToastType => {
    const lower = message.toLowerCase();
    if (message.includes('فشل') || message.includes('خطأ') || message.includes('خطا') || lower.includes('error') || lower.includes('fail')) {
      return 'error';
    }
    if (message.includes('يرجى') || message.includes('تحذير') || lower.includes('warning')) {
      return 'warning';
    }
    return 'success';
  }, []);

  const pushToast = useCallback((message: string, type?: ToastType) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message: trimmed, type: type || getToastType(trimmed) }]);
  }, [getToastType]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: any }>).detail;
      const message = typeof detail?.message === 'string' ? detail.message : String(detail?.message ?? '');
      pushToast(message);
    };
    window.addEventListener(ALERT_EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(ALERT_EVENT_NAME, handler as EventListener);
  }, [pushToast]);

  // Navigation handlers for SmartDrawer (must be before any early returns)
  const navigateToEntity = useCallback((type: string, id: string) => {
    const prefill = JSON.stringify({ id, at: Date.now() });
    switch (type) {
      case 'invoice':
        localStorage.setItem('shamel_invoice_view_prefill', prefill);
        setActiveTab('invoices');
        break;
      case 'party':
        localStorage.setItem('shamel_party_view_prefill', prefill);
        setActiveTab('clients');
        break;
      case 'product':
        localStorage.setItem('shamel_product_view_prefill', prefill);
        setActiveTab('inventory');
        break;
      case 'voucher':
        localStorage.setItem('shamel_voucher_view_prefill', prefill);
        setActiveTab('funds');
        break;
      default:
        break;
    }
  }, []);

  const editEntity = useCallback((type: string, id: string) => {
    if (type === 'party') {
      localStorage.setItem('shamel_party_edit_prefill', JSON.stringify({ id, at: Date.now() }));
    }
    if (type === 'voucher') {
      localStorage.setItem('shamel_voucher_edit_prefill', JSON.stringify({ id, at: Date.now() }));
    }
    navigateToEntity(type, id);
  }, [navigateToEntity]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmOptions & { resolve: (value: boolean) => void }>).detail;
      setConfirmState({
        open: true,
        message: detail.message || '',
        title: detail.title || 'تأكيد',
        confirmText: detail.confirmText || 'موافق',
        cancelText: detail.cancelText || 'إلغاء',
        resolve: detail.resolve
      });
    };
    window.addEventListener('shamel-confirm', handler as EventListener);
    return () => window.removeEventListener('shamel-confirm', handler as EventListener);
  }, [])
  useEffect(() => {
    if (!currentUser) return;
    const canApprove = currentUser.role === 'admin' || currentUser.permissions?.includes('approve_delivery_notices');
    if (!canApprove) return;

    const poll = async () => {
      try {
        const data = await apiRequest('delivery-notices?status=SUBMITTED');
        const ids = new Set<string>((data || []).map((n: any) => String(n.id)));
        (data || []).forEach((n: any) => {
          if (!pendingDeliveryRef.current.has(n.id)) {
            alert(`إشعار تسليم جديد: ${n.warehouseName || ''} - ${n.createdByName || ''}`);
          }
        });
        pendingDeliveryRef.current = ids;
      } catch {}
    };

    poll();
    const id = window.setInterval(poll, 15000);
    return () => window.clearInterval(id);
  }, [currentUser]);
;

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('shamel_settings');
      if (saved) {
          const parsed = JSON.parse(saved);
          return {
              ...parsed,
              deployment: parsed.deployment || getResolvedDeploymentConfig(),
              projectProfile: normalizeProjectProfile(parsed.projectProfile || { id: DEFAULT_PROJECT_PROFILE_ID }),
              moduleControl: normalizeModuleControl(parsed.moduleControl),
              print: parsed.print || DEFAULT_PRINT_SETTINGS,
              labels: parsed.labels || DEFAULT_LABELS,
              itemSettings: {
                enableServiceItems: true,
                enableBarcodePerUnit: true,
                enableMultiUnitPricing: true,
                autoSyncAlternateCurrencyPrices: false,
                preferredPriceReferenceCurrency: 'USD',
                allowManualLockOfAlternatePrice: true,
                enableTextileMode: false,
                textileRequireWarehousePreparationForSales: true,
                ...(parsed.itemSettings || {}),
              },
          };
      }
    } catch (e) { console.error("Error parsing settings", e); }
    return {
      company: { name: 'نظام إدارة ERP', address: 'دمشق', phone1: '011-123456' },
      theme: { primaryColor: '#0f766e', backgroundColor: '#f3f4f6' },
      labels: DEFAULT_LABELS,
      print: DEFAULT_PRINT_SETTINGS,
      deployment: getResolvedDeploymentConfig(),
      projectProfile: { id: DEFAULT_PROJECT_PROFILE_ID, source: 'legacy_inference' },
      moduleControl: normalizeModuleControl(),
      itemSettings: {
        enableServiceItems: true,
        enableBarcodePerUnit: true,
        enableMultiUnitPricing: true,
        autoSyncAlternateCurrencyPrices: false,
        preferredPriceReferenceCurrency: 'USD',
        allowManualLockOfAlternatePrice: true,
        enableTextileMode: false,
        textileRequireWarehousePreparationForSales: true,
      },
      defaultCurrency: 'USD',
      lowStockThreshold: 5,
      currencyRates: DEFAULT_CURRENCY_RATES
    };
  });

  const getPreferredLandingTab = useCallback((nextSettings?: Partial<AppSettings> | null, user?: AppUser | null) => {
    const projectProfile = resolveProjectProfile(nextSettings || settings);
    const visibleTabs = getUserScopedVisibleTabs(
      user || currentUser,
      getEffectiveVisibleTabs(projectProfile.id, nextSettings?.moduleControl || settings.moduleControl),
    );
    return getPreferredLandingTabForUser(user || currentUser, visibleTabs);
  }, [currentUser, settings]);

  const syncSettingsFromServer = useCallback(async () => {
    if (isAgentRestrictedMode(currentUser)) return null;
    try {
      const rows = await apiRequest('settings');
      if (!Array.isArray(rows) || rows.length == 0) return null;
      const parseSettingValue = (raw: any) => {
        if (typeof raw !== 'string') return raw;
        try { return JSON.parse(raw); } catch { return raw; }
      };
      const map = new Map(rows.map((r: any) => [r.key, parseSettingValue(r.value)]));
      const defaultCurrency = normalizeCurrencyCode(
        map.get('defaultCurrency') ?? map.get('primaryCurrency') ?? settings.defaultCurrency ?? 'USD',
        'USD',
      );
      const savedRates = map.get('currencyRates');
      const currencyRates = normalizeCurrencyRates(
        savedRates && typeof savedRates === 'object' ? savedRates : DEFAULT_CURRENCY_RATES
      );
      if (!currencyRates[defaultCurrency]) {
        currencyRates[defaultCurrency] = 1;
      }
      const next: AppSettings = {
        company: map.get('company') || settings.company,
        theme: map.get('theme') || settings.theme,
        labels: map.get('labels') || DEFAULT_LABELS,
        print: map.get('print') || DEFAULT_PRINT_SETTINGS,
        deployment: getResolvedDeploymentConfig(),
        projectProfile: normalizeProjectProfile(map.get('projectProfile') || resolveProjectProfile(settings)),
        moduleControl: normalizeModuleControl(map.get('moduleControl')),
        itemSettings: {
          enableServiceItems: true,
          enableBarcodePerUnit: true,
          enableMultiUnitPricing: true,
          autoSyncAlternateCurrencyPrices: false,
          preferredPriceReferenceCurrency: 'USD',
          allowManualLockOfAlternatePrice: true,
          enableTextileMode: false,
          textileRequireWarehousePreparationForSales: true,
          ...(map.get('itemSettings') || settings.itemSettings || {}),
        },
        lowStockThreshold: map.get('lowStockThreshold') ?? settings.lowStockThreshold,
        registeredDevices: map.get('registeredDevices') || [],
        defaultCurrency,
        currencyRates
      };
      setSettings(next);
      localStorage.setItem('shamel_settings', JSON.stringify(next));
      return next;
    } catch (e) {
      console.warn('Settings sync failed', e);
      return null;
    }
  }, [currentUser, isAgentRestrictedMode, settings.company, settings.theme, settings.lowStockThreshold, settings.defaultCurrency]);

  useEffect(() => {
    const runtimeDeployment = getResolvedDeploymentConfig();
    setStoredDeploymentConfig(runtimeDeployment);
    setStartupDeployment(runtimeDeployment);
    setSettings((current) => {
      if (
        current.deployment?.mode === runtimeDeployment.mode &&
        current.deployment?.role === runtimeDeployment.role &&
        (current.deployment?.apiBaseUrl || '') === (runtimeDeployment.apiBaseUrl || '') &&
        current.deployment?.allowLocalUsbPrinting === runtimeDeployment.allowLocalUsbPrinting
      ) {
        return current;
      }
      const next = { ...current, deployment: runtimeDeployment };
      localStorage.setItem('shamel_settings', JSON.stringify(next));
      return next;
    });
  }, []);

  const waitForBackend = useCallback(async () => {
    const runtimeDeployment = getResolvedDeploymentConfig();
    const maxAttempts = 12;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setBackendReadyAttempts(attempt);
      try {
        const status = await checkServerConnection();
        if (status && (status.status === 'online' || status.serverIp)) {
          console.log(`✅ Backend readiness confirmed on attempt ${attempt}`);
          setIsBackendReady(true);
          setBackendError(null);
          return true;
        }
      } catch (error: any) {
        console.warn(`⚠️ Backend readiness attempt ${attempt} failed`, error?.message || error);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const errMsg = 'الخادم المحلي غير متوفر. تحقق من تثبيت التطبيق أو إعادة تشغيله.';
    const finalBackendError =
      runtimeDeployment.mode === 'local_network' && runtimeDeployment.role === 'terminal'
        ? runtimeDeployment.apiBaseUrl
          ? 'تعذر على هذه الطرفية الوصول إلى الخادم المركزي. تحقق من عنوان الـ Host ومن تشغيل الخادم داخل نفس الشبكة.'
          : 'هذه الطرفية تحتاج عنوان Host صحيح قبل المتابعة.'
        : errMsg;
    setBackendError(finalBackendError);
    setIsBackendReady(false);
    setIsLoadingAuth(false);
    console.error('❌ Backend readiness gate failed after maximum retries');
    return false;
  }, []);

  useEffect(() => {
    const initialize = async () => {
      try {
        if (isRestaurantPublicRoute) {
          setIsLoadingAuth(false);
          setNeedsSetup(false);
          setBackendError(null);
          return;
        }
        const superAdminActive = superAdminRoute !== 'inactive' || hasSuperAdminSession();
        // Packaged runtime gateway: block setup/activation checks until backend is reachable.
        if (!isBackendReady) {
          const ready = await waitForBackend();
          if (!ready) {
            return;
          }
        }
        if (superAdminActive) {
          setIsLoadingAuth(false);
          return;
        }

        const storedActivated = localStorage.getItem('shamel_activated') === '1';
        const storedActivationType = getActivationType();
        const storedActivationMission = getActivationMission();
        const storedMode = storedActivationType ? getAppModeFromActivationType(storedActivationType) : null;
        if (storedActivated && storedMode === 'standalone' && storedActivationType) {
          setIsActivated(true);
          updateActivationContext(storedActivationType, null, { mission: storedActivationMission });
        }
        // Check if first-time setup is needed (all clients).
        let needsSetupFlag = false;
        try {
          const setupRes = await apiRequest('setup/status');
          logStartup('setup/status', setupRes);
          needsSetupFlag = Boolean(setupRes?.needsSetup);
        } catch (e) {
          logStartup('setup/status failed', e);
          needsSetupFlag = false;
        }
        if (needsSetupFlag) {
          logStartup('entering setup wizard path');
          setNeedsSetup(true);
          sanitizeStartupStorage({ setupComplete: false, hasValidSession: false });
          setIsLoadingAuth(false);
          return; // Skip everything else — wizard handles it all
        }
        setNeedsSetup(false);

        // Verify activation status against the active runtime path.
        try {
          const activationRes = await apiRequest('activation/status');
          logStartup('activation/status', activationRes);
          if (activationRes?.activated) {
            logStartup('activation confirmed by backend');
            setIsActivated(true);
            localStorage.setItem('shamel_activated', '1');
            updateActivationContext(activationRes.activationType || 'local', null, {
              mission: activationRes.activationMission || storedActivationMission,
            });
          } else {
            // In standalone local/trial mode, activation is allowed to remain local-only.
            // Do not clear the user's activation after setup just because the backend does
            // not report a persisted activation record.
            if (storedActivated && storedMode === 'standalone' && storedActivationType) {
              setIsActivated(true);
              updateActivationContext(storedActivationType, null, { mission: storedActivationMission });
            } else {
            // Runtime says not activated — clear stale localStorage
              setIsActivated(false);
              localStorage.removeItem('shamel_activated');
              localStorage.removeItem('shamel_activation_type');
              localStorage.removeItem('shamel_app_mode');
              clearStoredSessionAndCompany();
              localStorage.removeItem('shamel_has_org');
              localStorage.removeItem('shamel_setup_done');
              localStorage.removeItem('shamel_setup_activation_done');
              setIsAuthenticated(false);
              setCurrentUser(undefined);
              setHasOrg(false);
            }
          }
        } catch { /* runtime not reachable yet, keep local state */ }

        const requestedRoute = getCompanyRouteFromHash();
        const startupSnapshot = collectStartupSnapshot();

        const authState = { isAuthenticated: false, reason: 'forced_login' };
        const branchSelectionRequired = false;
        const companySelectionRequired = false;

        const sanitizeResult = sanitizeStartupStorage({
          setupComplete: true,
          hasValidSession: false,
        });

        logStartup('persisted_state', startupSnapshot);
        logStartup('sanitize', sanitizeResult);

        setIsAuthenticated(false);
        setCurrentUser(undefined);
        clearStoredSession();

        const orgs = getOrgsList();
        const hasKnownCompanies = orgs.length > 0 || hasCachedOrg();
        setHasOrg(hasKnownCompanies);
        if (hasKnownCompanies) {
          localStorage.setItem('shamel_has_org', '1');
        } else {
          localStorage.removeItem('shamel_has_org');
        }

        const decision = resolveStartupDecision({
          setupComplete: true,
          auth: authState,
          branchSelectionRequired,
          companySelectionRequired,
          requestedRoute,
        });

        logStartup('decision', {
          ...decision,
          auth: authState,
          companySelectionRequired,
          branchSelectionRequired,
          requestedRoute,
        });

        if (decision.route === 'setup') {
          setNeedsSetup(true);
          setIsLoadingAuth(false);
          return;
        }

        if (decision.route !== requestedRoute) {
          navigateToCompanyRoute(decision.route as CompanyRoute);
        }
        setAuthRoute(decision.route as CompanyRoute);
      } catch (e: any) {
        setAuthError(e.message || "حدث خطأ أثناء تسجيل الدخول");
      } finally {
        setIsLoadingAuth(false);
      }
    };
    initialize();
    // Security reset must happen once per application launch only.
    // Re-running this effect after settings sync logs the user out immediately after a successful login.
  }, [isBackendReady, isPosOnlyUser, isRestaurantPublicRoute, logStartup, requiresBranchSelection, superAdminRoute, waitForBackend]);

  useEffect(() => {
    const isPosOnlyMode = isPosOnlyUser(currentUser);
    const isAgentRestricted = isAgentRestrictedMode(currentUser);
    const isTextileRestrictedMode = isTextileRestrictedUser(currentUser);
    if (isAgentRestricted) {
      setActiveTab('pos');
      setIsSidebarCollapsed(true);
      return;
    }
    if (isPosOnlyMode) {
      setActiveTab('pos');
      setIsSidebarCollapsed(true);
      return;
    }
    if (isTextileRestrictedMode) {
      const projectProfile = resolveProjectProfile(settings);
      const baseVisibleTabs = getEffectiveVisibleTabs(projectProfile.id, settings.moduleControl);
      setActiveTab(getPreferredLandingTabForUser(currentUser, getUserScopedVisibleTabs(currentUser, baseVisibleTabs)));
      setIsSidebarCollapsed(true);
    }
  }, [currentUser, isPosOnlyUser, isAgentRestrictedMode, isTextileRestrictedUser, settings]);

  useEffect(() => {
    if (layout.isDesktop) {
      setIsSidebarOpen(false);
      return;
    }

    setIsSidebarCollapsed(false);
  }, [layout.isDesktop]);

  const renderContent = () => {
    const isPosOnlyMode = isPosOnlyUser(currentUser);
    const isAgentRestricted = isAgentRestrictedMode(currentUser);
    const isTextileRestrictedMode = isTextileRestrictedUser(currentUser);
    const setActiveTabSafe = (tab: string) => {
      if (isPosOnlyMode || isTextileRestrictedMode || isAgentRestricted) return;
      setActiveTab(tab);
    };
    if (isAgentRestricted) {
      return <POSQuick inventory={items} categories={categories} subCategories={subCategories} clients={clients} cashBoxes={cashBoxes} warehouses={warehouses} refreshData={fetchData} setActiveTab={setActiveTabSafe} />;
    }
    if (isPosOnlyMode) {
      return <POSQuick inventory={items} categories={categories} subCategories={subCategories} clients={clients} cashBoxes={cashBoxes} warehouses={warehouses} refreshData={fetchData} setActiveTab={setActiveTabSafe} />;
    }
    switch (activeTab) {
      case 'dashboard': return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
      case 'branches_radar': return <BranchesRadar setActiveTab={setActiveTab} />;
      case 'inventory': return <Inventory items={items} setItems={setItems as any} warehouses={warehouses} refreshData={fetchData} setActiveTab={setActiveTab} settings={settings} />;
      case 'pos': return <POSQuick inventory={items} categories={categories} subCategories={subCategories} clients={clients} cashBoxes={cashBoxes} warehouses={warehouses} refreshData={fetchData} setActiveTab={setActiveTabSafe} />;
      case 'invoices': return <Invoices inventory={items} invoices={invoices} clients={clients} partners={partners} cashBoxes={cashBoxes} warehouses={warehouses} refreshData={fetchData} settings={settings} />;
        case 'funds': return <Funds cashBoxes={cashBoxes} setCashBoxes={setCashBoxes} vouchers={vouchers} setVouchers={setVouchers} clients={clients} setClients={setClients} invoices={invoices} settings={settings} refreshData={fetchData} />;
      case 'payroll': return <Payroll cashBoxes={cashBoxes} refreshData={fetchData} setActiveTab={setActiveTab} />;
      case 'manufacturing': return <Manufacturing inventory={items} warehouses={warehouses} refreshData={fetchData} />;
      case 'delivery_notices': return <DeliveryNotices settings={settings} />;
      case 'delivery_approvals': return <DeliveryApprovals settings={settings} />;
      case 'accounts': return <Accounts />;
      case 'expenses': return <Expenses cashBoxes={cashBoxes} warehouses={warehouses} refreshData={fetchData} setActiveTab={setActiveTab} />; 
      case 'partners': return <Partners partners={partners} setPartners={setPartners} partnerTransactions={partnerTransactions} cashBoxes={cashBoxes} invoices={invoices} inventory={items} vouchers={vouchers} clients={clients} refreshData={fetchData} />;
      case 'clients': return <CustomersSuppliers clients={clients} invoices={invoices} vouchers={vouchers} cashBoxes={cashBoxes} refreshData={fetchData} currentUser={currentUser} navigateToTab={setActiveTab} />;
      case 'stocktaking': return <StockTaking items={items} setItems={setItems as any} warehouses={warehouses} branches={branches} />;
      case 'reports': return <Reports inventory={items} invoices={invoices} clients={clients} warehouses={warehouses} cashBoxes={cashBoxes} vouchers={vouchers} settings={settings} setActiveTab={setActiveTab} />;
      case 'agents': return <Agents agents={agents} setAgents={setAgents} inventory={items} warehouses={warehouses} invoices={invoices} refreshData={fetchData} />;
      case 'opening_stock': return <OpeningStock />;
      case 'opening_balances': return <OpeningBalances />;
      case 'consignments': return <ConsignmentModule clients={clients} warehouses={warehouses} items={items} refreshData={fetchData} setActiveTab={setActiveTab} />;
      case 'system_monitoring': return currentUser?.role === 'admin' ? <SystemMonitoring /> : <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
      case 'settings': return <SettingsPage settings={settings} setSettings={setSettings} users={users} setUsers={setUsers} />;
      case 'restaurant_tables':
        if (!isRestaurantModuleEnabled()) return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
        return <RestaurantOperationsDashboard currentUser={currentUser} setActiveTab={setActiveTab} />;

      case 'restaurant_settings':
        if (!isRestaurantModuleEnabled()) return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
        return <RestaurantSettings currentUser={currentUser} />;

      case 'restaurant_qr':
        if (!isRestaurantModuleEnabled()) return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
        return <RestaurantQR currentUser={currentUser} />;

      case 'restaurant_menu_qr':
        if (!isRestaurantModuleEnabled()) return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
        return (
          <Suspense
            fallback={
              <div className="flex min-h-[240px] items-center justify-center bg-gray-50 text-sm font-bold text-gray-500" dir="rtl">
                جاري تحميل QR Menu…
              </div>
            }
          >
            <QrMenuPage currentUser={currentUser} />
          </Suspense>
        );

      case 'restaurant_reports':
        if (!isRestaurantModuleEnabled()) return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
        return (
          <RestaurantReports
            inventory={items}
            invoices={invoices}
            clients={clients}
            warehouses={warehouses}
            cashBoxes={cashBoxes}
            vouchers={vouchers}
            settings={settings}
            currentUser={currentUser}
            setActiveTab={setActiveTab}
          />
        );
      default: return <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />;
    }
  };

  const isPosOnlyMode = isPosOnlyUser(currentUser);
  const isAgentRestrictedModeActive = isAgentRestrictedMode(currentUser);
  const isTextileRestrictedMode = isTextileRestrictedUser(currentUser);
  const resolvedProjectProfile = resolveProjectProfile(settings);
  const effectiveVisibleTabs = getUserScopedVisibleTabs(
    currentUser,
    getEffectiveVisibleTabs(resolvedProjectProfile.id, settings.moduleControl),
  );
  const menuLabels = {
    ...DEFAULT_LABELS.menu,
    ...((settings?.labels as any)?.menu || {}),
  };
  const hasPermission = (perm: string | null) => !perm || currentUser?.role === 'admin' || currentUser?.permissions?.includes(perm);
  const mobileNavCandidates = [
    { id: 'dashboard', label: menuLabels.dashboard, icon: <LayoutDashboard size={18} />, perm: null },
    { id: 'pos', label: 'نقطة البيع', icon: <Zap size={18} />, perm: PERMISSIONS.ACCESS_POS },
    { id: 'inventory', label: menuLabels.inventory, icon: <Package size={18} />, perm: PERMISSIONS.VIEW_INVENTORY },
    { id: 'invoices', label: menuLabels.invoices, icon: <FileText size={18} />, perm: PERMISSIONS.CREATE_SALE_INVOICE },
    { id: 'clients', label: 'العملاء', icon: <Users size={18} />, perm: PERMISSIONS.MANAGE_CLIENTS },
  ].filter((item) => hasPermission(item.perm) && effectiveVisibleTabs.has(item.id));
  const isImmersiveMode = isPosOnlyMode || isTextileRestrictedMode || isAgentRestrictedModeActive;
  const mobileBottomNavItems = layout.isMobile && !isImmersiveMode
    ? [
        ...mobileNavCandidates.slice(0, 4).map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          active: activeTab === item.id,
          onClick: () => setActiveTab(item.id),
        })),
        {
          id: 'more',
          label: 'المزيد',
          icon: <MoreHorizontal size={18} />,
          active: isSidebarOpen,
          onClick: () => setIsSidebarOpen((prev) => !prev),
        },
      ]
    : [];

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isPosOnlyMode || isAgentRestrictedModeActive) return;
    if (effectiveVisibleTabs.has(activeTab)) return;
    setActiveTab(getPreferredLandingTab(settings, currentUser));
  }, [activeTab, currentUser, effectiveVisibleTabs, getPreferredLandingTab, isAuthenticated, isPosOnlyMode, isAgentRestrictedModeActive, settings]);


  if (isCustomerDisplayRoute) {
    return <CustomerDisplay />;
  }
  if (isPromotionsDisplayRoute) {
    if (!effectiveVisibleTabs.has('inventory_promotions')) {
      return isAuthenticated
        ? <Dashboard items={items} invoices={invoices} clients={clients} setActiveTab={setActiveTab} />
        : null;
    }
    return <PromotionsDisplay />;
  }
  if (restaurantPublicToken) {
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      if (restaurantPublicRedirectPort && restaurantPublicRedirectPort !== '0' && restaurantPublicRedirectPort !== currentPort) {
        const target = `${window.location.protocol}//${window.location.hostname}:${restaurantPublicRedirectPort}${window.location.pathname}${window.location.hash}`;
        window.location.replace(target);
        return null;
      }
    }
    return (
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm font-bold text-stone-500" dir="rtl">
            جاري تحميل منيو الطاولة…
          </div>
        }
      >
        <RestaurantPublicMenuPage publicToken={restaurantPublicToken} />
      </Suspense>
    );
  }
  if (backendError) {
    return (
      <div className="min-h-screen bg-gray-900 px-4 py-8">
        <div className="max-w-5xl mx-auto grid gap-6">
          <div className="rounded-3xl border border-red-500/30 bg-red-950/40 p-8 text-center">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h1 className="text-white font-black text-xl">تعذر تشغيل الاتصال الحالي</h1>
            <p className="text-gray-300 mt-3">{backendError}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  setBackendError(null);
                  setIsLoadingAuth(true);
                  void waitForBackend().then((ready) => {
                    if (ready) {
                      setIsLoadingAuth(false);
                      window.location.reload();
                    } else {
                      setIsLoadingAuth(false);
                    }
                  });
                }}
                className="px-5 py-3 rounded-xl bg-primary text-white font-bold"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>

          <DeploymentModeSettings
            value={startupDeployment}
            onChange={setStartupDeployment as any}
            onApply={applyStartupDeployment}
            isApplying={isApplyingStartupDeployment}
            showApplyAction
            title="تهيئة التشغيل على هذا الجهاز"
            hint="إذا كان هذا الجهاز Terminal فحدّد عنوان Host ثم احفظ. إذا كان هذا الجهاز مستقلاً فاختر Standalone لتجنّب أي اعتماد شبكي."
          />
        </div>
      </div>
    );
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900 gap-4 px-4 text-center">
        <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        <h1 className="text-white font-black text-xl">فشل بدء الخادم المحلي</h1>
        <p className="text-gray-300">{backendError}</p>
        <button
          onClick={() => {
            setBackendError(null);
            setIsLoadingAuth(true);
            void waitForBackend().then((ready) => {
              if (ready) {
                setIsLoadingAuth(false);
                window.location.reload();
              } else {
                setIsLoadingAuth(false);
              }
            });
          }}
          className="mt-4 px-5 py-2 rounded-xl bg-primary text-white font-bold"
        >إعادة المحاولة</button>
      </div>
    );
  }

  if (!isBackendReady || isLoadingAuth) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900 gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="font-bold text-gray-400">جاري تهيئة محرك الخادم المحلي...</p>
        {backendReadyAttempts > 0 && <p className="text-xs text-gray-500">محاولة {backendReadyAttempts} من 12...</p>}
      </div>
    );
  }

  if (superAdminRoute !== 'inactive' || hasSuperAdminSession()) {
    return hasSuperAdminSession()
      ? <SuperAdminConsole onLogout={() => setSuperAdminRoute(getSuperAdminRouteFromHash())} />
      : <SuperAdminLogin onLoginSuccess={() => setSuperAdminRoute(getSuperAdminRouteFromHash())} />;
  }

  // First-time setup wizard (all clients when setup is incomplete).
  // Activation-only setup remains limited to Electron/Capacitor.
  if (needsSetup || (!isWebBrowserClient() && !isActivated)) {
    return (
      <SetupWizard onSetupComplete={() => {
        setNeedsSetup(false);
        setIsActivated(true);
        setIsAuthenticated(false);
        setCurrentUser(undefined);
        setHasOrg(true);
        window.location.reload();
      }} />
    );
  }




  if (!isAuthenticated && isManagingOrgs) {
    return <OrgManager onClose={() => setIsManagingOrgs(false)} />;
  }

  if (isAuthenticated && (!hasOrg || isManagingOrgs) && !isPosOnlyMode && !isAgentRestrictedModeActive) {
    return <OrgManager onClose={hasOrg ? () => setIsManagingOrgs(false) : undefined} />;
  }

  if (isAuthenticated && authRoute === 'select-branch') {
    return <SelectBranch onBranchSelected={handleBranchSelectionSuccess} />;
  }
  if (isAuthenticated && authRoute === 'select-company') {
    return <SelectCompany onManageCompanies={() => setIsManagingOrgs(true)} onCompanySelected={handleCompanySelection} />;
  }

  // تحديد ما إذا كنا في وضع ملء الشاشة (مثل نقطة البيع)
  const parentTabByChild: Record<string, string> = {
    opening_stock: 'inventory',
    delivery_notices: 'inventory',
    delivery_approvals: 'inventory',
    opening_balances: 'clients',
    payroll: 'expenses',
    agents: 'branches_radar',
    restaurant_tables: 'dashboard',
    restaurant_qr: 'dashboard',
    restaurant_settings: 'dashboard',
    restaurant_menu_qr: 'dashboard',
    restaurant_reports: 'dashboard',
  };
  const contextualBackTab = parentTabByChild[activeTab] || 'dashboard';
  const contextualBackTitle = parentTabByChild[activeTab] ? 'رجوع للقسم الرئيسي' : 'الرئيسية';
  const agentDisplayName = currentUser?.name || currentUser?.username || 'مندوب';
  const agentBranchLabel =
    branches.find((branch) => String(branch.id || '') === String(currentUser?.currentBranchId || currentUser?.defaultBranchId || ''))?.name
    || currentUser?.currentBranchId
    || currentUser?.defaultBranchId
    || '—';
  return (
    <SmartDrawerProvider>
      {!isAuthenticated ? (
        authRoute === 'login' && getSelectedCompanyId()
          ? <Login onLoginSuccess={handleLoginSuccess} />
          : <SelectCompany onManageCompanies={() => setIsManagingOrgs(true)} onCompanySelected={handlePreloginCompanySelection} />
      ) : (
        <div className={`flex h-[100dvh] min-h-screen min-w-0 overflow-hidden font-sans bg-gray-50 ${layout.isMobile && !isImmersiveMode ? 'android-shell-safe' : ''}`}>
          {/* Smart Drawer for Quick Views */}
          <SmartDrawer
            onNavigateToFull={navigateToEntity}
            onEdit={editEntity}
          />
          
          {/* إظهار القائمة الجانبية فقط إذا لم نكن في الوضع الغامر */}
          {!isImmersiveMode && (
            <Sidebar 
                activeTab={activeTab} 
                setActiveTab={setActiveTab} 
                isOpen={isSidebarOpen} 
                isCollapsed={isSidebarCollapsed} 
                toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} 
                toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
                onLogout={handleLogout} 
                onManageOrgs={() => setIsManagingOrgs(true)}
                currentUser={currentUser} 
                settings={settings} 
            />
          )}
          
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden transition-all duration-300">
            
          {/* إظهار الهيدر فقط إذا لم نكن في الوضع الغامر */}
          {!isImmersiveMode && (
                <header className={`flex shrink-0 items-center justify-between border-b bg-white shadow-sm z-40 ${layout.isMobile ? 'min-h-[56px] px-3 py-2 android-safe-top' : layout.isTablet ? 'h-16 px-4' : 'h-16 px-6'}`}>
                <div className="flex items-center gap-3">
                    {!layout.isDesktop && (
                      <button onClick={() => setIsSidebarOpen(true)} className="min-h-[44px] min-w-[44px] rounded-xl border bg-gray-50 p-2 text-gray-600 transition-colors hover:bg-gray-100 tap-feedback">
                      <Menu size={24} />
                      </button>
                    )}
                    <h1 className={`font-black text-primary ${layout.isMobile ? 'text-sm line-clamp-1' : 'text-lg'}`}>{settings.company.name}</h1>
                </div>
                
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setActiveTab(contextualBackTab)}
                        className="min-h-[44px] min-w-[44px] text-gray-400 hover:text-primary transition p-2 rounded-lg hover:bg-gray-50 tap-feedback"
                        title={contextualBackTitle}
                    >
                        <ChevronLeft size={24} />
                    </button>
                </div>
                </header>
            )}

            {isAgentRestrictedModeActive && (
              <header className={`flex shrink-0 items-center justify-between border-b bg-white shadow-sm z-40 ${layout.isMobile ? 'min-h-[56px] px-3 py-2 android-safe-top' : layout.isTablet ? 'h-14 px-4' : 'h-14 px-6'}`}>
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-gray-500">المندوب</span>
                  <span className="text-sm font-black text-gray-800">{agentDisplayName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[11px] font-bold text-gray-500">الفرع</div>
                    <div className="text-xs font-black text-gray-700">{agentBranchLabel}</div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 transition"
                  >
                    تسجيل خروج
                  </button>
                </div>
              </header>
            )}

            <main className={`flex-1 overflow-x-hidden overflow-y-auto ${isImmersiveMode ? 'bg-white' : 'bg-gray-50'} ${layout.isMobile ? 'android-scroll-safe' : ''} ${layout.isMobile && !isImmersiveMode ? 'android-main-safe' : ''}`}>
              <div className={`mx-auto w-full min-w-0 ${layout.isDesktopWide ? 'max-w-[1920px]' : layout.isDesktop ? 'max-w-[1720px]' : 'max-w-full'}`}>
                {renderContent()}
              </div>
            </main>

            {/* شريط أخبار ثابت أسفل الشاشة - يظهر فقط للنسخة التجريبية */}
            {!isImmersiveMode && localStorage.getItem('shamel_activation_type') === 'trial' && (
              <div className="shrink-0 bg-amber-500 text-white h-8 flex items-center overflow-hidden relative z-40">
                <div className="animate-marquee whitespace-nowrap font-bold text-xs">
                  ⚠️ هذه نسخة تجريبية - 50 مادة - 100 فاتورة بيع وشراء &nbsp;&nbsp;&nbsp;—&nbsp;&nbsp;&nbsp; العالمية للمحاسبة &nbsp;&nbsp;&nbsp;—&nbsp;&nbsp;&nbsp; ⚠️ هذه نسخة تجريبية - 50 مادة - 100 فاتورة بيع وشراء &nbsp;&nbsp;&nbsp;—&nbsp;&nbsp;&nbsp; العالمية للمحاسبة
                </div>
              </div>
            )}
          </div>

          {mobileBottomNavItems.length > 0 && (
            <MobileBottomNav items={mobileBottomNavItems} />
          )}

          {!isOnline && (
            <div className="fixed bottom-4 left-4 z-[9999] bg-red-600 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg">
              غير متصل - سيتم المزامنة عند عودة الاتصال
            </div>
          )}

          {toasts.length > 0 && (
            <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
              {toasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                  <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
                  />
                </div>
              ))}
            </div>
          )}

          {confirmState.open && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10000] p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fadeIn">
                <div className="p-5 bg-primary text-white flex items-center justify-between">
                  <h3 className="text-lg font-bold">{confirmState.title}</h3>
                  <button
                    onClick={() => {
                      confirmState.resolve?.(false);
                      setConfirmState((prev) => ({ ...prev, open: false }));
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 transition"
                    aria-label="إغلاق"
                  >
                    <XCircle size={20} />
                  </button>
                </div>
                <div className="p-6 text-sm text-gray-700 font-bold">{confirmState.message}</div>
                <div className="p-4 flex justify-end gap-2 bg-gray-50">
                  <button
                    onClick={() => {
                      confirmState.resolve?.(false);
                      setConfirmState((prev) => ({ ...prev, open: false }));
                    }}
                    className="px-6 py-2 rounded-xl font-bold text-gray-600 hover:bg-gray-200 transition"
                  >
                    {confirmState.cancelText}
                  </button>
                  <button
                    onClick={() => {
                      confirmState.resolve?.(true);
                      setConfirmState((prev) => ({ ...prev, open: false }));
                    }}
                    className="px-6 py-2 rounded-xl font-bold bg-primary text-white hover:bg-teal-800 transition"
                  >
                    {confirmState.confirmText}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </SmartDrawerProvider>
  );
};

export default App;

