import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  FileText,
  BarChart3,
  Users,
  Landmark,
  Settings,
  Handshake,
  LogOut,
  Zap,
  Wifi,
  WifiOff,
  Building2,
  RefreshCcw,
  X,
  ChevronRight,
  ChevronLeft,
  Factory,
  ListTree,
  TrendingDown,
  Globe,
  ChevronDown,
  Check,
  ShieldAlert,
  GitBranch,
  Loader2,
  UtensilsCrossed,
} from 'lucide-react';
import { AppSettings, AppUser, DEFAULT_LABELS, Institution, PERMISSIONS } from '../types';
import { useSyncQueue } from '../hooks/useSyncQueue';
import { getCurrentBranchId, getCurrentOrgId, getSessionBranches, refreshCompaniesCacheFromSession, switchBranchContext, switchCompanyContext } from '../lib/api';
import { isSyncedMode } from '../lib/appMode';
import useResponsiveLayout from '../hooks/useResponsiveLayout';
import { shouldUseLocalApiRuntime } from '../lib/runtimeContext';
import { getProfileNavOrder, getProjectProfileDefinition, resolveProjectProfile } from '../lib/projectProfiles';
import { isRestaurantModuleEnabled } from '../lib/restaurantFeature';
import { setRestaurantHash } from '../lib/restaurantHash';
import { getEffectiveVisibleTabs } from '../lib/systemModules';
import { getUserScopedVisibleTabs, isRestrictedTextileWarehouseUser } from '../lib/userAccess';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  isCollapsed: boolean;
  toggleSidebar: () => void;
  toggleCollapse: () => void;
  onLogout: () => void;
  onManageOrgs: () => void;
  currentUser?: AppUser | null;
  settings?: AppSettings;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  isCollapsed,
  toggleSidebar,
  toggleCollapse,
  onLogout,
  onManageOrgs,
  currentUser,
  settings,
}) => {
  const { isNetworkAvailable } = useSyncQueue();
  const isSynced = isSyncedMode();
  const statusLabel = isSynced ? (isNetworkAvailable ? 'السيرفر متصل' : 'غير متصل') : 'الوضع المحلي';
  const statusClass = isSynced ? (isNetworkAvailable ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700') : 'bg-slate-100 text-slate-500';
  const layout = useResponsiveLayout();
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [availableCompanies, setAvailableCompanies] = useState<Institution[]>([]);
  const [availableBranches, setAvailableBranches] = useState<Array<{ id: string; name: string; code?: string; isMain?: boolean }>>([]);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [restaurantExpanded, setRestaurantExpanded] = useState(
    () => String(activeTab || '').startsWith('restaurant_'),
  );
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(event.target as Node)) {
        setOrgDropdownOpen(false);
      }
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
        setBranchDropdownOpen(false);
      }
    };

    if (orgDropdownOpen || branchDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [branchDropdownOpen, orgDropdownOpen]);

  useEffect(() => {
    let active = true;
    const loadCompanies = async () => {
      if (!currentUser) {
        if (active) setAvailableCompanies([]);
        return;
      }
      try {
        const companies = await refreshCompaniesCacheFromSession();
        if (active) setAvailableCompanies(companies);
      } catch {
        if (active) setAvailableCompanies([]);
      }
    };
    loadCompanies();
    return () => {
      active = false;
    };
  }, [currentUser?.id, currentUser?.companyId]);

  useEffect(() => {
    let active = true;
    const loadBranches = async () => {
      if (!currentUser) return;
      try {
        const response = await getSessionBranches();
        if (!active) return;
        const rows = Array.isArray(response?.branches) ? response.branches : [];
        setAvailableBranches(rows.map((branch: any) => ({
          id: String(branch.id),
          name: String(branch.name || branch.id || ''),
          code: branch.code ? String(branch.code) : undefined,
          isMain: Boolean(branch.isMain),
        })));
      } catch {
        if (active) setAvailableBranches([]);
      }
    };
    loadBranches();
    return () => {
      active = false;
    };
  }, [currentUser?.id, currentUser?.companyId, currentUser?.currentBranchId]);

  useEffect(() => {
    if (String(activeTab || '').startsWith('restaurant_')) {
      setRestaurantExpanded(true);
    }
  }, [activeTab]);

  const can = (perm: string) => currentUser?.role === 'admin' || currentUser?.permissions?.includes(perm);
  const posPerms = new Set<string>([
    PERMISSIONS.ACCESS_POS,
    PERMISSIONS.POS_ONLY,
    PERMISSIONS.POS_CASHIER,
    PERMISSIONS.MANAGE_POS_CURRENCY,
    PERMISSIONS.AUTO_PRINT_POS_RECEIPT,
    PERMISSIONS.CREATE_SALE_INVOICE,
    PERMISSIONS.MANAGE_CLIENTS,
  ]);
  const perms = currentUser?.permissions || [];
  const posOnly =
    currentUser?.role !== 'admin' && (
      perms.includes(PERMISSIONS.POS_ONLY) ||
      (perms.length > 0 && perms.every((perm) => posPerms.has(perm)) && perms.includes(PERMISSIONS.ACCESS_POS))
    );
  const textileRestricted = isRestrictedTextileWarehouseUser(currentUser);

  const labels = {
    ...DEFAULT_LABELS,
    ...(settings?.labels || {}),
    menu: {
      ...DEFAULT_LABELS.menu,
      ...((settings?.labels as any)?.menu || {}),
    },
  };

  const currentOrgId = getCurrentOrgId();
  const currentOrg = availableCompanies.find((org) => org.id === currentOrgId);
  const currentBranchId = currentUser?.currentBranchId || getCurrentBranchId();
  const currentBranch = availableBranches.find((branch) => branch.id === currentBranchId);
  const resolvedProjectProfile = resolveProjectProfile(settings);
  const profileDefinition = getProjectProfileDefinition(resolvedProjectProfile.id);
  const effectiveVisibleTabs = getUserScopedVisibleTabs(
    currentUser,
    getEffectiveVisibleTabs(resolvedProjectProfile.id, settings?.moduleControl),
  );
  const navOrder = getProfileNavOrder(resolvedProjectProfile.id);
  const orderIndex = new Map<string, number>(navOrder.map((id, index) => [id, index]));
  type MenuLeaf = {
    kind: 'leaf';
    id: string;
    label: string;
    icon: React.ReactNode;
    requiredPerm: string | null;
  };
  type MenuGroup = {
    kind: 'group';
    id: string;
    label: string;
    icon: React.ReactNode;
    requiredPerm: string | null;
    children: { id: string; label: string }[];
  };

  const showRestaurant = isRestaurantModuleEnabled() && can(PERMISSIONS.VIEW_RESTAURANT_MODULE);

  const monitoringMenuItem = currentUser?.role === 'admin' && !shouldUseLocalApiRuntime()
    ? [{ id: 'system_monitoring', label: 'مركز المراقبة', icon: <ShieldAlert size={22} className="text-rose-500" />, requiredPerm: PERMISSIONS.MANAGE_SETTINGS }]
    : [];

  const menuEntriesUnfiltered: (MenuLeaf | MenuGroup)[] = [
    { kind: 'leaf', id: 'dashboard', label: labels.menu.dashboard, icon: <LayoutDashboard size={22} />, requiredPerm: null },
    ...monitoringMenuItem.map((m) => ({
      kind: 'leaf' as const,
      id: m.id,
      label: m.label,
      icon: m.icon,
      requiredPerm: m.requiredPerm,
    })),
    {
      kind: 'leaf',
      id: 'branches_radar',
      label: 'رادار الفروع',
      icon: <Globe size={22} className="text-blue-500 animate-pulse" />,
      requiredPerm: PERMISSIONS.MANAGE_SETTINGS,
    },
    {
      kind: 'leaf',
      id: 'pos',
      label: 'نقطة بيع سريعة',
      icon: <Zap size={22} className="text-yellow-500" />,
      requiredPerm: PERMISSIONS.ACCESS_POS,
    },
    { kind: 'leaf', id: 'inventory', label: labels.menu.inventory, icon: <Package size={22} />, requiredPerm: PERMISSIONS.VIEW_INVENTORY },
    { kind: 'leaf', id: 'invoices', label: labels.menu.invoices, icon: <FileText size={22} />, requiredPerm: PERMISSIONS.CREATE_SALE_INVOICE },
    {
      kind: 'leaf',
      id: 'manufacturing',
      label: 'قسم التصنيع',
      icon: <Factory size={22} className="text-blue-500" />,
      requiredPerm: PERMISSIONS.VIEW_INVENTORY,
    },
    ...(showRestaurant
      ? [
          {
                kind: 'group' as const,
                id: 'restaurant',
                label: 'المطبخ',
                icon: <UtensilsCrossed size={22} className="text-orange-600" />,
                requiredPerm: PERMISSIONS.VIEW_RESTAURANT_MODULE,
                children: [
                  { id: 'restaurant_tables', label: 'الطاولات' },
                  { id: 'restaurant_settings', label: 'إعدادات المطعم' },
                  { id: 'restaurant_qr', label: 'رموز QR للطاولات' },
                  { id: 'restaurant_menu_qr', label: 'منيو QR' },
                  { id: 'restaurant_reports', label: 'تقارير المطعم' },
                ],
              },
            ]
      : []),
    { kind: 'leaf', id: 'funds', label: labels.menu.funds, icon: <Landmark size={22} />, requiredPerm: PERMISSIONS.VIEW_FUNDS },
    {
      kind: 'leaf',
      id: 'accounts',
      label: 'شجرة الحسابات',
      icon: <ListTree size={22} className="text-emerald-600" />,
      requiredPerm: PERMISSIONS.VIEW_FUNDS,
    },
    {
      kind: 'leaf',
      id: 'expenses',
      label: 'إدارة المصاريف',
      icon: <TrendingDown size={22} className="text-rose-600" />,
      requiredPerm: PERMISSIONS.VIEW_FUNDS,
    },
    { kind: 'leaf', id: 'partners', label: labels.menu.partners, icon: <Handshake size={22} />, requiredPerm: PERMISSIONS.MANAGE_PARTNERS },
    { kind: 'leaf', id: 'clients', label: 'العملاء والموردين', icon: <Users size={22} />, requiredPerm: PERMISSIONS.MANAGE_CLIENTS },
    { kind: 'leaf', id: 'stocktaking', label: labels.menu.stocktaking, icon: <ClipboardList size={22} />, requiredPerm: PERMISSIONS.MANAGE_STOCKTAKING },
    { kind: 'leaf', id: 'reports', label: labels.menu.reports, icon: <BarChart3 size={22} />, requiredPerm: PERMISSIONS.VIEW_REPORTS },
    { kind: 'leaf', id: 'settings', label: labels.menu.settings, icon: <Settings size={22} />, requiredPerm: PERMISSIONS.MANAGE_SETTINGS },
  ];

  const filteredMenuEntries = menuEntriesUnfiltered
    .filter((e) => {
      if (e.requiredPerm && !can(e.requiredPerm)) return false;
      if (e.kind === 'leaf') return effectiveVisibleTabs.has(e.id);
      const groupVisible = effectiveVisibleTabs.has(e.id) || e.children.some((child) => effectiveVisibleTabs.has(child.id));
      if (!groupVisible) return false;
      e.children = e.children.filter((child) => effectiveVisibleTabs.has(child.id));
      return e.children.length > 0;
    })
    .sort((a, b) => {
      const aOrder = orderIndex.get(a.id) ?? 999;
      const bOrder = orderIndex.get(b.id) ?? 999;
      return aOrder - bOrder;
    });

  const visibleMenuEntries = posOnly
    ? filteredMenuEntries.filter((e) => e.kind === 'leaf' && e.id === 'pos')
    : textileRestricted
      ? filteredMenuEntries.filter((e) => e.kind === 'leaf' && e.id === 'delivery_notices')
    : filteredMenuEntries;

  const isDesktopSidebar = layout.isDesktop;
  const expanded = isDesktopSidebar ? true : isOpen;
  const compactDesktop = isDesktopSidebar && isCollapsed;
  const showOverlay = !isDesktopSidebar && isOpen;
  const drawerWidthClass = layout.isMobile ? 'w-[calc(100vw-1rem)] max-w-[22rem]' : 'w-[22rem]';

  return (
    <>
      {showOverlay && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-opacity"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={`${
          isDesktopSidebar ? 'static' : 'fixed inset-y-0 right-0'
        } z-[110] flex flex-col border-l border-gray-100 shadow-2xl transition-all duration-300 ease-in-out ${
          isDesktopSidebar
            ? compactDesktop
              ? 'w-20 translate-x-0'
              : 'w-72 translate-x-0'
            : `${drawerWidthClass} ${expanded ? 'translate-x-0' : 'translate-x-full'}`
        }`}
        style={{ backgroundColor: 'var(--color-sidebar-bg)' }}
      >
        <div
          className={`relative flex shrink-0 flex-col items-center justify-center border-b bg-primary text-white transition-all duration-300 ${
            compactDesktop ? 'h-24' : 'h-auto'
          } ${layout.isMobile ? 'px-4 py-4' : 'p-6'}`}
        >
          {!isDesktopSidebar && (
            <button
              onClick={toggleSidebar}
              className="absolute left-4 top-4 text-white/50 transition-colors hover:text-white min-h-[44px] min-w-[44px] tap-feedback"
            >
              <X size={24} />
            </button>
          )}

          {isDesktopSidebar && (
            <button
              onClick={toggleCollapse}
              className="absolute -left-4 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-primary shadow-lg transition-all hover:scale-110 hover:bg-gray-50 active:scale-90 lg:flex"
            >
              {compactDesktop ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          )}

          <div className={`rounded-2xl bg-white/20 p-2.5 shadow-inner ${compactDesktop ? 'scale-75' : 'mb-3'}`}>
            <Building2 size={compactDesktop ? 24 : 32} />
          </div>

          {(!compactDesktop || !isDesktopSidebar) && (
            <div className="animate-fadeIn text-center">
              <h1 className="line-clamp-1 px-2 text-xl font-black leading-tight">{settings?.company?.name || 'العالمية للمحاسبة'}</h1>
              <p className="mt-1 text-[10px] font-bold opacity-85">{profileDefinition.arabicMeaning}</p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-widest opacity-60">{profileDefinition.label}</p>

              <button
                onClick={onManageOrgs}
                className="mx-auto mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] font-bold transition hover:bg-black/40 active:scale-95"
              >
                <RefreshCcw size={10} />
                إدارة المؤسسات
              </button>

              {(() => {
                const orgsList = availableCompanies || [];
                if (orgsList.length <= 1) return null;

                return (
                  <div className="relative mt-2" ref={orgDropdownRef}>
                    <button
                      onClick={() => setOrgDropdownOpen((prev) => !prev)}
                      className="mx-auto flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold transition hover:bg-white/25 active:scale-95"
                    >
                      <Building2 size={10} />
                      {currentOrg?.name || 'اختر مؤسسة'}
                      <ChevronDown size={10} className={`transition-transform ${orgDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {orgDropdownOpen && (
                      <div className="absolute left-1/2 top-full z-[200] mt-1 min-w-[180px] -translate-x-1/2 animate-fadeIn rounded-xl border border-gray-200 bg-white py-1 shadow-2xl">
                        {orgsList.map((org: any) => (
                          <button
                            key={org.id}
                            onClick={async () => {
                              if (org.id !== currentOrgId) {
                                await switchCompanyContext(org.id);
                                window.location.reload();
                              }
                              setOrgDropdownOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold transition-colors ${
                              org.id === currentOrgId ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {org.id === currentOrgId && <Check size={12} className="shrink-0 text-primary" />}
                            <span className="truncate">{org.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {availableBranches.length > 0 && (
                <div className="relative mt-2" ref={branchDropdownRef}>
                  <button
                    onClick={() => setBranchDropdownOpen((prev) => !prev)}
                    className="mx-auto flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold transition hover:bg-white/25 active:scale-95"
                  >
                    <GitBranch size={10} />
                    {currentBranch?.name || currentBranchId || 'اختر فرعاً'}
                    <ChevronDown size={10} className={`transition-transform ${branchDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {branchDropdownOpen && (
                    <div className="absolute left-1/2 top-full z-[200] mt-1 min-w-[200px] -translate-x-1/2 animate-fadeIn rounded-xl border border-gray-200 bg-white py-1 shadow-2xl">
                      {availableBranches.map((branch) => (
                        <button
                          key={branch.id}
                          disabled={isSwitchingBranch}
                          onClick={async () => {
                            if (branch.id === currentBranchId) {
                              setBranchDropdownOpen(false);
                              return;
                            }
                            try {
                              setIsSwitchingBranch(true);
                              await switchBranchContext(branch.id);
                              window.location.reload();
                            } finally {
                              setIsSwitchingBranch(false);
                            }
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold transition-colors ${
                            branch.id === currentBranchId ? 'bg-amber-50 text-amber-700' : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {branch.id === currentBranchId ? (
                            <Check size={12} className="shrink-0 text-amber-600" />
                          ) : isSwitchingBranch ? (
                            <Loader2 size={12} className="shrink-0 animate-spin text-gray-400" />
                          ) : (
                            <GitBranch size={12} className="shrink-0 text-gray-400" />
                          )}
                          <span className="truncate">{branch.name}</span>
                          {branch.code && <span className="mr-auto text-[10px] text-gray-400">{branch.code}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className={`flex items-center justify-between border-b px-4 py-2 text-[9px] font-black uppercase tracking-tighter transition-all ${statusClass} ${compactDesktop ? 'justify-center' : ''}`}
        >
          <div className="flex items-center gap-1.5">
            {isSynced ? (isNetworkAvailable ? <Wifi size={12} /> : <WifiOff size={12} />) : <WifiOff size={12} />}
            {(!compactDesktop || !isDesktopSidebar) && statusLabel}
          </div>
        </div>

        <nav className={`custom-scrollbar ${layout.isMobile ? 'mt-2' : 'mt-4'} flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden px-3 ${layout.isMobile ? 'pb-24' : ''}`}>
          {visibleMenuEntries.map((entry) => {
            if (entry.kind === 'leaf') {
              const item = entry;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-tab-id={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    if (!isDesktopSidebar) toggleSidebar();
                  }}
                  title={compactDesktop ? item.label : ''}
                  className={`group relative flex w-full items-center rounded-xl transition-all duration-200 tap-feedback ${
                    activeTab === item.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                  } ${compactDesktop ? 'justify-center p-3' : layout.isMobile ? 'px-4 py-4' : 'px-4 py-3.5'}`}
                >
                  <span
                    className={`transition-all duration-300 ${
                      activeTab === item.id ? 'text-white' : 'text-gray-400 group-hover:text-primary'
                    } ${compactDesktop ? '' : 'ml-3'}`}
                  >
                    {item.icon}
                  </span>
                  {(!compactDesktop || !isDesktopSidebar) && (
                    <span className="animate-fadeIn truncate text-sm font-bold">{item.label}</span>
                  )}
                </button>
              );
            }

            const group = entry;
            const childActive = String(activeTab || '').startsWith('restaurant_');
            if (compactDesktop) {
              return (
                <button
                  key={group.id}
                  type="button"
                  data-group-id={group.id}
                  title="مطعم — شاشة الطاولات"
                  onClick={() => {
                    setActiveTab('restaurant_tables');
                    setRestaurantHash('tables');
                  }}
                  className={`group relative flex w-full items-center justify-center rounded-xl p-3 transition-all duration-200 tap-feedback ${
                    childActive ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <span className={childActive ? 'text-white' : 'text-gray-400 group-hover:text-primary'}>{group.icon}</span>
                </button>
              );
            }

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  data-group-id={group.id}
                  onClick={() => setRestaurantExpanded((prev) => !prev)}
                  className={`group relative flex w-full items-center rounded-xl transition-all duration-200 tap-feedback ${
                    childActive ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                  } ${layout.isMobile ? 'px-4 py-4' : 'px-4 py-3.5'}`}
                >
                  <span
                    className={`transition-all duration-300 ${childActive ? 'text-primary' : 'text-gray-400 group-hover:text-primary'} ml-3`}
                  >
                    {group.icon}
                  </span>
                  <span className="flex-1 truncate text-right text-sm font-black">{group.label}</span>
                  <ChevronDown
                    size={18}
                    className={`mr-1 shrink-0 transition-transform ${restaurantExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {restaurantExpanded && (
                  <div className="mr-2 space-y-1 border-r-2 border-primary/20 pr-2">
                    {group.children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        data-child-id={child.id}
                        onClick={() => {
                          setActiveTab(child.id);
                          if (child.id === 'restaurant_tables') setRestaurantHash('tables');
                          else if (child.id === 'restaurant_qr') setRestaurantHash('qr');
                          else if (child.id === 'restaurant_menu_qr') setRestaurantHash('qr-menu');
                          if (!isDesktopSidebar) toggleSidebar();
                        }}
                        className={`flex w-full items-center rounded-xl px-4 py-3 text-right text-sm font-bold transition tap-feedback ${
                          activeTab === child.id
                            ? 'bg-primary text-white shadow-md'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className={`shrink-0 border-t border-gray-100 bg-gray-50 p-4 ${compactDesktop ? 'items-center' : ''}`}>
          <button
            onClick={onLogout}
            className={`flex w-full items-center gap-2 rounded-xl border-2 border-transparent font-black text-red-600 transition-all hover:border-red-200 hover:bg-red-100 ${
              compactDesktop ? 'justify-center p-3' : 'justify-center px-4 py-3'
            }`}
          >
            <LogOut size={compactDesktop ? 22 : 20} />
            {(!compactDesktop || !isDesktopSidebar) && <span className="text-sm">خروج نهائي</span>}
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;


