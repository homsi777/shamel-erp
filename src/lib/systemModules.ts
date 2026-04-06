import type { ModuleControlSettings, ProjectProfileId } from '../types';
import { getVisibleTabsForProfile } from './projectProfiles';

export type SystemModuleId =
  | 'dashboard'
  | 'pos'
  | 'inventory'
  | 'sales'
  | 'restaurant'
  | 'manufacturing'
  | 'finance'
  | 'parties'
  | 'reports'
  | 'agents'
  | 'delivery'
  | 'opening'
  | 'consignments'
  | 'settings'
  | 'system_monitoring';

export interface SystemModuleDefinition {
  id: SystemModuleId;
  label: string;
  description: string;
  tabs: string[];
}

export const DEFAULT_MODULE_CONTROL: ModuleControlSettings = {
  disabledTabs: [],
  forceEnabledTabs: [],
  nodeOverrides: {},
  extensionCodes: [],
};

export type ControlNodeKind = 'group' | 'tab' | 'setting';

export interface ControlNode {
  id: string;
  label: string;
  description?: string;
  kind: ControlNodeKind;
  tabId?: string;
  settingsTabId?: string;
  children?: ControlNode[];
}

const SYSTEM_CONTROL_TREE: ControlNode[] = [
  {
    id: 'dashboard',
    label: 'لوحة التحكم',
    description: 'لوحة البداية ورادار الفروع',
    kind: 'group',
    children: [
      { id: 'dashboard.home', label: 'لوحة البداية', kind: 'tab', tabId: 'dashboard' },
      { id: 'dashboard.branches_radar', label: 'رادار الفروع', kind: 'tab', tabId: 'branches_radar' },
    ],
  },
  {
    id: 'sales',
    label: 'المبيعات',
    description: 'نقطة البيع والفواتير',
    kind: 'group',
    children: [
      { id: 'sales.pos', label: 'نقطة البيع', kind: 'tab', tabId: 'pos' },
      { id: 'sales.invoices', label: 'الفواتير', kind: 'tab', tabId: 'invoices' },
    ],
  },
  {
    id: 'inventory',
    label: 'المخزون',
    description: 'المواد والجرد والافتتاحيات',
    kind: 'group',
    children: [
      { id: 'inventory.items', label: 'المواد والمستودعات', kind: 'tab', tabId: 'inventory' },
      { id: 'inventory.stocktaking', label: 'الجرد', kind: 'tab', tabId: 'stocktaking' },
      { id: 'inventory.opening_stock', label: 'المخزون الافتتاحي', kind: 'tab', tabId: 'opening_stock' },
      { id: 'inventory.opening_balances', label: 'الأرصدة الافتتاحية', kind: 'tab', tabId: 'opening_balances' },
      {
        id: 'inventory.tools',
        label: 'أدوات المخزون',
        description: 'أدوات إضافية لا تُفتح إلا من السوبر أدمن',
        kind: 'group',
        children: [
          { id: 'inventory.delivery_notices', label: 'إشعارات التسليم', kind: 'tab', tabId: 'delivery_notices' },
          { id: 'inventory.delivery_approvals', label: 'اعتماد الإشعارات', kind: 'tab', tabId: 'delivery_approvals' },
          { id: 'inventory.promotions', label: 'العروض والتخفيضات', kind: 'tab', tabId: 'inventory_promotions' },
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'المالية',
    description: 'الصناديق والحسابات والمصاريف',
    kind: 'group',
    children: [
      { id: 'finance.funds', label: 'الصناديق', kind: 'tab', tabId: 'funds' },
      { id: 'finance.accounts', label: 'الحسابات', kind: 'tab', tabId: 'accounts' },
      { id: 'finance.expenses', label: 'المصاريف', kind: 'tab', tabId: 'expenses' },
    ],
  },
  {
    id: 'parties',
    label: 'الأطراف',
    description: 'العملاء والشركاء والمناديب',
    kind: 'group',
    children: [
      { id: 'parties.clients', label: 'العملاء والموردون', kind: 'tab', tabId: 'clients' },
      { id: 'parties.partners', label: 'الشركاء', kind: 'tab', tabId: 'partners' },
      { id: 'parties.agents', label: 'المناديب', kind: 'tab', tabId: 'agents' },
    ],
  },
  {
    id: 'restaurant',
    label: 'المطعم',
    description: 'جلسات وطاولات وQR وتقارير',
    kind: 'group',
    children: [
      { id: 'restaurant.tables', label: 'الطاولات', kind: 'tab', tabId: 'restaurant_tables' },
      { id: 'restaurant.settings', label: 'إعدادات المطعم', kind: 'tab', tabId: 'restaurant_settings' },
      { id: 'restaurant.qr', label: 'رموز QR للطاولات', kind: 'tab', tabId: 'restaurant_qr' },
      { id: 'restaurant.menu_qr', label: 'منيو QR', kind: 'tab', tabId: 'restaurant_menu_qr' },
      { id: 'restaurant.reports', label: 'تقارير المطعم', kind: 'tab', tabId: 'restaurant_reports' },
    ],
  },
  {
    id: 'manufacturing',
    label: 'التصنيع',
    description: 'الوصفات والإنتاج',
    kind: 'group',
    children: [
      { id: 'manufacturing.core', label: 'إدارة التصنيع', kind: 'tab', tabId: 'manufacturing' },
    ],
  },
  {
    id: 'consignments',
    label: 'الأمانات',
    description: 'مستندات وتسويات الأمانات',
    kind: 'group',
    children: [
      { id: 'consignments.core', label: 'الأمانات', kind: 'tab', tabId: 'consignments' },
    ],
  },
  {
    id: 'reports',
    label: 'التقارير',
    description: 'التقارير والتحليلات',
    kind: 'group',
    children: [
      { id: 'reports.core', label: 'التقارير', kind: 'tab', tabId: 'reports' },
    ],
  },
  {
    id: 'settings',
    label: 'الإعدادات',
    description: 'إعدادات النظام والتجهيزات',
    kind: 'group',
    children: [
      { id: 'settings.root', label: 'لوحة الإعدادات', kind: 'tab', tabId: 'settings' },
      { id: 'settings.company', label: 'هوية الشركة', kind: 'setting', settingsTabId: 'company' },
      { id: 'settings.labels', label: 'تسميات النظام', kind: 'setting', settingsTabId: 'labels' },
      { id: 'settings.currency', label: 'أسعار الصرف', kind: 'setting', settingsTabId: 'currency' },
      { id: 'settings.pricing', label: 'إعدادات التسعير', kind: 'setting', settingsTabId: 'pricing_settings' },
      { id: 'settings.invoices', label: 'إعدادات الفواتير', kind: 'setting', settingsTabId: 'invoice_settings' },
      { id: 'settings.items', label: 'إعدادات المواد', kind: 'setting', settingsTabId: 'item_settings' },
      { id: 'settings.printing', label: 'الطباعة والفواتير', kind: 'setting', settingsTabId: 'printing_invoices' },
      { id: 'settings.deployment', label: 'نمط التشغيل', kind: 'setting', settingsTabId: 'deployment' },
      { id: 'settings.devices', label: 'الأجهزة والاتصال', kind: 'setting', settingsTabId: 'devices' },
      { id: 'settings.theme', label: 'المظهر والألوان', kind: 'setting', settingsTabId: 'theme' },
      { id: 'settings.users', label: 'المستخدمون والأمان', kind: 'setting', settingsTabId: 'users' },
      { id: 'settings.dbstatus', label: 'حالة قاعدة البيانات', kind: 'setting', settingsTabId: 'dbstatus' },
      { id: 'settings.backups', label: 'النسخ الاحتياطي', kind: 'setting', settingsTabId: 'backups' },
      { id: 'settings.sync', label: 'سجل المزامنة', kind: 'setting', settingsTabId: 'sync' },
      { id: 'settings.cloud_link', label: 'اتصال وربط سحابي', kind: 'setting', settingsTabId: 'cloud_link' },
    ],
  },
  {
    id: 'system_monitoring',
    label: 'مركز المراقبة',
    description: 'الأحداث والتنبيهات والمراقبة',
    kind: 'group',
    children: [
      { id: 'system_monitoring.core', label: 'مراقبة النظام', kind: 'tab', tabId: 'system_monitoring' },
    ],
  },
];

type ControlIndex = {
  nodeById: Map<string, ControlNode>;
  tabToNode: Map<string, string>;
  settingsToNode: Map<string, string>;
};

const buildControlIndex = () => {
  const nodeById = new Map<string, ControlNode>();
  const tabToNode = new Map<string, string>();
  const settingsToNode = new Map<string, string>();
  const walk = (node: ControlNode) => {
    nodeById.set(node.id, node);
    if (node.tabId) tabToNode.set(node.tabId, node.id);
    if (node.settingsTabId) settingsToNode.set(node.settingsTabId, node.id);
    (node.children || []).forEach(walk);
  };
  SYSTEM_CONTROL_TREE.forEach(walk);
  return { nodeById, tabToNode, settingsToNode } as ControlIndex;
};

const CONTROL_INDEX = buildControlIndex();

const SUPER_ADMIN_ONLY_SETTINGS_NODES = new Set<string>([
  'settings.items',
  'settings.deployment',
  'settings.devices',
  'settings.labels',
]);

type ControlState = {
  node: ControlNode;
  baselineVisible: boolean;
  effectiveVisible: boolean;
  override: 'enabled' | 'disabled' | 'inherit';
  reason: 'forced_enabled' | 'forced_hidden' | 'parent_forced_hidden' | 'parent_hidden' | 'profile' | 'profile_hidden';
  parentId?: string | null;
};

const normalizeOverrideMap = (value: unknown): Record<string, 'enabled' | 'disabled'> => {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, 'enabled' | 'disabled'> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'enabled' || v === 'disabled') next[String(key)] = v;
  }
  return next;
};

const buildOverrideMap = (moduleControl?: Partial<ModuleControlSettings> | null) => {
  const overrides = normalizeOverrideMap(moduleControl?.nodeOverrides);
  for (const tab of moduleControl?.forceEnabledTabs || []) {
    const nodeId = CONTROL_INDEX.tabToNode.get(String(tab));
    if (nodeId && !overrides[nodeId]) overrides[nodeId] = 'enabled';
  }
  for (const tab of moduleControl?.disabledTabs || []) {
    const nodeId = CONTROL_INDEX.tabToNode.get(String(tab));
    if (nodeId && !overrides[nodeId]) overrides[nodeId] = 'disabled';
  }
  return overrides;
};

const computeBaselineVisible = (node: ControlNode, profileTabs: Set<string>): boolean => {
  if (SUPER_ADMIN_ONLY_SETTINGS_NODES.has(node.id)) return false;
  if (node.tabId) return profileTabs.has(node.tabId);
  if (node.settingsTabId) return profileTabs.has('settings');
  return (node.children || []).some((child) => computeBaselineVisible(child, profileTabs));
};

const walkControlTree = (
  nodes: ControlNode[],
  profileTabs: Set<string>,
  overrides: Record<string, 'enabled' | 'disabled'>,
  parent?: { id?: string | null; effective?: boolean; forcedHidden?: boolean; forcedEnabled?: boolean },
) => {
  const states: Record<string, ControlState> = {};
  const visibleTabs = new Set<string>();
  const visibleSettingsTabs = new Set<string>();

  const visit = (node: ControlNode, parentCtx?: { id?: string | null; effective?: boolean; forcedHidden?: boolean; forcedEnabled?: boolean }) => {
    const baselineVisible = computeBaselineVisible(node, profileTabs);
    const rawOverride = overrides[node.id];
    const override: ControlState['override'] = rawOverride ? rawOverride : 'inherit';
    let effectiveVisible = baselineVisible;
    let reason: ControlState['reason'] = baselineVisible ? 'profile' : 'profile_hidden';
    const parentForcedHidden = Boolean(parentCtx?.forcedHidden);
    const parentForcedEnabled = Boolean(parentCtx?.forcedEnabled);
    const parentEffective = parentCtx?.effective ?? true;

    if (override === 'enabled') {
      effectiveVisible = true;
      reason = 'forced_enabled';
    } else if (override === 'disabled') {
      effectiveVisible = false;
      reason = 'forced_hidden';
    } else if (parentForcedHidden) {
      effectiveVisible = false;
      reason = 'parent_forced_hidden';
    } else if (parentForcedEnabled) {
      // If a parent node is explicitly forced on, inherit visibility unless a child is explicitly disabled.
      effectiveVisible = true;
      reason = 'forced_enabled';
    } else if (!parentEffective) {
      effectiveVisible = false;
      reason = 'parent_hidden';
    }

    states[node.id] = {
      node,
      baselineVisible,
      effectiveVisible,
      override,
      reason,
      parentId: parentCtx?.id ?? null,
    };

    if (node.tabId && effectiveVisible) visibleTabs.add(node.tabId);
    if (node.settingsTabId && effectiveVisible) visibleSettingsTabs.add(node.settingsTabId);

    const nextParent = {
      id: node.id,
      effective: effectiveVisible,
      forcedHidden: override === 'disabled',
      forcedEnabled: override === 'enabled' || parentForcedEnabled,
    };
    (node.children || []).forEach((child) => visit(child, nextParent));
  };

  nodes.forEach((node) => visit(node, parent));
  return { states, visibleTabs, visibleSettingsTabs };
};

export const buildControlMatrix = (
  profileId?: ProjectProfileId | null,
  moduleControl?: Partial<ModuleControlSettings> | null,
) => {
  const profileTabs = getVisibleTabsForProfile(profileId);
  const overrides = buildOverrideMap(moduleControl);
  const { states, visibleTabs, visibleSettingsTabs } = walkControlTree(SYSTEM_CONTROL_TREE, profileTabs, overrides);
  return {
    tree: SYSTEM_CONTROL_TREE,
    states,
    visibleTabs,
    visibleSettingsTabs,
    overrides,
    profileTabs,
    index: CONTROL_INDEX,
  };
};

export const deriveLegacyTabOverrides = (
  overrides: Record<string, 'enabled' | 'disabled'>,
) => {
  const disabledTabs: string[] = [];
  const forceEnabledTabs: string[] = [];
  for (const [nodeId, state] of Object.entries(overrides)) {
    const node = CONTROL_INDEX.nodeById.get(nodeId);
    if (!node?.tabId) continue;
    if (state === 'enabled') forceEnabledTabs.push(node.tabId);
    if (state === 'disabled') disabledTabs.push(node.tabId);
  }
  return { disabledTabs, forceEnabledTabs };
};

export const SYSTEM_MODULES: SystemModuleDefinition[] = [
  { id: 'dashboard', label: 'لوحة البداية', description: 'لوحة العمل العامة', tabs: ['dashboard', 'branches_radar'] },
  { id: 'pos', label: 'نقطة البيع', description: 'POS السريع والكاشير', tabs: ['pos'] },
  { id: 'inventory', label: 'المخزون', description: 'المواد والمستودعات والجرد وأدوات المخزون الإضافية', tabs: ['inventory', 'stocktaking', 'opening_stock', 'opening_balances', 'delivery_notices', 'delivery_approvals', 'inventory_promotions'] },
  { id: 'sales', label: 'الفواتير', description: 'البيع والشراء والفواتير', tabs: ['invoices'] },
  { id: 'restaurant', label: 'المطعم', description: 'الجلسات والطاولات وQR وتقارير المطعم', tabs: ['restaurant', 'restaurant_tables', 'restaurant_settings', 'restaurant_qr', 'restaurant_menu_qr', 'restaurant_reports'] },
  { id: 'manufacturing', label: 'التصنيع', description: 'الوصفات والإنتاج', tabs: ['manufacturing'] },
  { id: 'finance', label: 'المالية', description: 'الصناديق والحسابات والمصاريف', tabs: ['funds', 'accounts', 'expenses'] },
  { id: 'parties', label: 'العملاء والشركاء', description: 'العملاء والموردون والشركاء', tabs: ['clients', 'partners'] },
  { id: 'reports', label: 'التقارير', description: 'التقارير والتحليلات', tabs: ['reports'] },
  { id: 'agents', label: 'المناديب', description: 'الوكلاء والتوزيع', tabs: ['agents'] },
  { id: 'opening', label: 'الافتتاحيات', description: 'المخزون والأرصدة الافتتاحية', tabs: ['opening_stock', 'opening_balances'] },
  { id: 'consignments', label: 'الأمانات', description: 'مستندات وتسويات الأمانات', tabs: ['consignments'] },
  { id: 'settings', label: 'الإعدادات', description: 'إعدادات الشركة والطباعة والأجهزة', tabs: ['settings'] },
  { id: 'system_monitoring', label: 'مراقبة النظام', description: 'مركز المراقبة والأحداث', tabs: ['system_monitoring'] },
];

export const normalizeModuleControl = (value?: Partial<ModuleControlSettings> | null): ModuleControlSettings => {
  const disabledTabs = Array.isArray(value?.disabledTabs)
    ? Array.from(new Set(value.disabledTabs.map((entry) => String(entry || '').trim()).filter(Boolean)))
    : [];
  const forceEnabledTabs = Array.isArray(value?.forceEnabledTabs)
    ? Array.from(new Set(value.forceEnabledTabs.map((entry) => String(entry || '').trim()).filter(Boolean)))
    : [];
  const extensionCodes = Array.isArray(value?.extensionCodes)
    ? Array.from(new Set(value.extensionCodes.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)))
    : [];
  const nodeOverrides = normalizeOverrideMap(value?.nodeOverrides);

  return {
    disabledTabs,
    forceEnabledTabs,
    nodeOverrides,
    extensionCodes,
    lastUpdatedAt: value?.lastUpdatedAt,
    lastUpdatedBy: value?.lastUpdatedBy,
  };
};

export const getEffectiveVisibleTabs = (
  profileId?: ProjectProfileId | null,
  moduleControl?: Partial<ModuleControlSettings> | null,
) => {
  const { visibleTabs } = buildControlMatrix(profileId, moduleControl);
  return visibleTabs;
};

export const getEffectiveVisibleSettingsTabs = (
  profileId?: ProjectProfileId | null,
  moduleControl?: Partial<ModuleControlSettings> | null,
) => {
  const { visibleSettingsTabs } = buildControlMatrix(profileId, moduleControl);
  return visibleSettingsTabs;
};

export const isTabEnabledByModuleControl = (
  tabId: string,
  profileId?: ProjectProfileId | null,
  moduleControl?: Partial<ModuleControlSettings> | null,
) => {
  return getEffectiveVisibleTabs(profileId, moduleControl).has(tabId);
};

export const summarizeEnabledModules = (
  profileId?: ProjectProfileId | null,
  moduleControl?: Partial<ModuleControlSettings> | null,
) => {
  const effectiveTabs = getEffectiveVisibleTabs(profileId, moduleControl);
  return SYSTEM_MODULES.map((module) => ({
    ...module,
    baselineVisible: module.tabs.some((tab) => getVisibleTabsForProfile(profileId).has(tab)),
    enabled: module.tabs.some((tab) => effectiveTabs.has(tab)),
    forced: module.tabs.some((tab) => normalizeModuleControl(moduleControl).forceEnabledTabs.includes(tab)),
    disabled: module.tabs.every((tab) => !effectiveTabs.has(tab)),
  }));
};
