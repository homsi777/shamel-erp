import { appError, isAppError } from './errors';
import { SYSTEM_EVENT_TYPES } from './systemEvents';
import {
  hasBranchAccess,
  normalizeTenantId,
  pickEffectiveBranchId,
  requiresBranchForPath,
  resolveBranchAccessForUser,
} from './tenantScope';

type SecurityDeps = {
  db: any;
  schema: any;
  eq: any;
  systemEventLogger?: { log: (payload: any) => Promise<any> };
};

type RouteRule = {
  methods: string[];
  pattern: RegExp;
  operation: string;
  permissions?: string[] | ((req: any) => string[]);
  roles?: string[];
  allowWhen?: (req: any, deps: SecurityDeps) => Promise<boolean>;
};

type RouteFamilyPolicy = {
  key: string;
  prefixes: string[];
  readOperation?: string;
  writeOperation?: string;
  readMethods?: string[];
  writeMethods?: string[];
  readRoles?: string[];
  writeRoles?: string[];
};

type PolicyCoverageTarget = string | {
  path: string;
  methods?: string[];
  body?: any;
};

const PUBLIC_PATTERNS = [
  /^\/api\/login$/,
  /^\/api\/super-admin\/login$/,
  /^\/api\/system\/status$/,
  /^\/api\/system\/healthz$/,
  /^\/api\/system\/readiness$/,
  /^\/api\/system\/db-status$/,
  /^\/api\/public\/companies$/,
  /^\/api\/setup\/status$/,
  /^\/api\/setup\/complete$/,
  /^\/api\/activation\/status$/,
  /^\/api\/restaurant\/network-ready$/,
  /^\/api\/restaurant\/public\//,
];

const BOOTSTRAP_PUBLIC_PATTERNS = [
  /^\/api\/public\/companies$/,
  /^\/api\/setup\/status$/,
  /^\/api\/setup\/complete$/,
  /^\/api\/activation\/status$/,
  /^\/api\/activation\/activate$/,
  /^\/api\/activation\/notify-success$/,
];

const isSystemActivated = async (deps: SecurityDeps) => {
  try {
    const row = await deps.db.select().from(deps.schema.activationCodes)
      .where(deps.eq(deps.schema.activationCodes.isUsed, true))
      .limit(1)
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
};

export const OPERATION_PERMISSION_ALIASES: Record<string, string[]> = {
  'auth.users.manage': ['manage_users'],
  'settings.write': ['manage_settings'],
  'settings.read': ['manage_settings', 'access_pos', 'pos_cashier'],
  'reports.read': ['view_reports'],
  'smart.read': ['view_reports', 'view_inventory', 'view_accounts', 'view_funds', 'manage_clients', 'view_employees', 'manage_partners', 'view_consignments'],
  'accounts.read': ['view_accounts'],
  'accounts.write': ['manage_accounts'],
  'funds.read': ['view_funds', 'manage_vouchers', 'access_pos', 'pos_cashier'],
  'funds.write': ['manage_vouchers'],
  'funds.transfer': ['manage_vouchers', 'view_funds'],
  'vouchers.read': ['view_funds', 'manage_vouchers'],
  'vouchers.write': ['manage_vouchers'],
  'invoices.read': ['create_sale_invoice', 'create_purchase_invoice', 'access_pos', 'manage_invoice_movements'],
  'invoices.create.sale': ['create_sale_invoice', 'access_pos'],
  'invoices.create.purchase': ['create_purchase_invoice'],
  'invoices.create.opening_stock': ['manage_accounts', 'manage_inventory', 'create_purchase_invoice'],
  'invoices.update': ['create_sale_invoice', 'create_purchase_invoice', 'manage_invoice_movements'],
  'invoices.post': ['manage_accounts', 'manage_invoice_movements'],
  'invoices.cancel': ['manage_accounts', 'manage_invoice_movements'],
  'invoices.stock_toggle': ['manage_invoice_movements', 'manage_inventory'],
  'opening.read': ['view_accounts', 'manage_accounts'],
  'opening.write': ['manage_accounts'],
  'delivery.manage': ['manage_delivery_notices'],
  'delivery.approve': ['approve_delivery_notices'],
  'textile.dispatch.view': ['view_textile_dispatch_module', 'open_textile_dispatch_document', 'manage_textile_dispatch_requests', 'approve_textile_dispatch', 'convert_textile_dispatch_to_invoice', 'manage_delivery_notices', 'approve_delivery_notices', 'create_sale_invoice'],
  'textile.dispatch.open': ['open_textile_dispatch_document', 'view_textile_dispatch_module', 'manage_delivery_notices', 'approve_delivery_notices', 'create_sale_invoice'],
  'textile.dispatch.create': ['manage_textile_dispatch_requests', 'manage_delivery_notices', 'create_sale_invoice'],
  'textile.dispatch.prepare': ['decompose_textile_dispatch', 'update_textile_dispatch_preparation', 'manage_delivery_notices'],
  'textile.dispatch.confirm': ['confirm_textile_dispatch_preparation', 'manage_delivery_notices'],
  'textile.dispatch.print': ['print_textile_dispatch_document', 'manage_delivery_notices', 'approve_delivery_notices'],
  'textile.dispatch.approve': ['approve_textile_dispatch', 'approve_delivery_notices'],
  'textile.dispatch.convert': ['convert_textile_dispatch_to_invoice', 'approve_textile_dispatch', 'approve_delivery_notices'],
  'textile.inventory.read': ['view_textile_stock_context', 'view_inventory'],
  'textile.colors.manage': ['manage_textile_dispatch_requests', 'manage_delivery_notices', 'manage_inventory'],
  'inventory.read': ['view_inventory', 'agent_mode_restricted'],
  'inventory.write': ['manage_inventory'],
  'inventory.price': ['price_edit', 'price_bulk_edit', 'exchange_rate_update'],
  'units.read': ['manage_units', 'view_inventory'],
  'units.write': ['manage_units'],
  'agents.read': ['manage_agents', 'manage_inventory'],
  'agents.write': ['manage_agents', 'manage_inventory'],
  'parties.read': ['manage_clients', 'view_accounts', 'view_reports', 'agent_mode_restricted'],
  'parties.write': ['manage_clients'],
  'partners.read': ['manage_partners', 'view_reports'],
  'partners.write': ['manage_partners'],
  'pricing.read': ['price_edit', 'price_bulk_edit', 'exchange_rate_update', 'manage_clients', 'view_inventory', 'agent_mode_restricted'],
  'pricing.write': ['price_edit', 'price_bulk_edit', 'exchange_rate_update', 'manage_clients'],
  'expenses.read': ['manage_expenses', 'view_accounts', 'view_reports'],
  'expenses.write': ['manage_expenses', 'manage_accounts'],
  'employees.read': ['view_employees', 'manage_employees', 'manage_payroll'],
  'employees.write': ['manage_employees', 'manage_payroll'],
  'biometric.read': ['view_employees', 'manage_employees'],
  'biometric.write': ['manage_employees'],
  'consignment.read': ['view_consignments'],
  'consignment.write': ['view_consignments', 'manage_inventory', 'manage_accounts'],
  'payroll.read': ['view_employees', 'manage_payroll'],
  'payroll.write': ['manage_payroll'],
  'manufacturing.read': ['view_recipes'],
  'manufacturing.write': ['manage_recipes', 'manage_production'],
  'backups.read': ['manage_settings'],
  'backups.write': ['manage_settings'],
  'system.admin': ['manage_settings', 'manage_users'],
  'activation.admin': ['manage_settings'],
  'periods.read': ['manage_accounts', 'view_accounts', 'view_reports'],
  'periods.write': ['manage_accounts'],
  'periods.admin': ['manage_accounts'],
  'provisioning.admin': ['manage_settings', 'manage_users'],
  'print.read': ['manage_settings', 'access_pos', 'pos_cashier', 'create_sale_invoice', 'create_purchase_invoice', 'view_inventory'],
  'print.write': ['manage_settings'],
  'restaurant.read': ['view_restaurant_module'],
  'restaurant.tables.write': ['manage_restaurant_tables'],
  'restaurant.sessions.write': ['manage_restaurant_sessions'],
};

const SENSITIVE_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SCOPE_VIOLATION_CODES = new Set([
  'COMPANY_CONTEXT_MISMATCH',
  'COMPANY_ACCESS_DENIED',
  'BRANCH_ACCESS_DENIED',
  'ENTITY_OUTSIDE_COMPANY',
  'NO_COMPANY_CONTEXT',
]);
const AGENT_RESTRICTED_PERMISSION = 'agent_mode_restricted';

const normalizePermissionList = (user: any) => {
  if (!user) return [];
  if (Array.isArray(user.permissions)) {
    return user.permissions.map((entry: any) => String(entry || '').trim()).filter(Boolean);
  }
  return String(user.permissions || '')
    .split(',')
    .map((entry: string) => String(entry || '').trim())
    .filter(Boolean);
};

const hasAnyPermission = (user: any, permissions: string[]) => {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const userPermissions = normalizePermissionList(user);
  if (userPermissions.includes('*')) return true;
  return permissions.some((permission) => userPermissions.includes(permission));
};

const getPath = (req: any) => String(req.raw?.url || req.url || '').split('?')[0];

const isAgentRestrictedUser = (user: any) => {
  if (!user || String(user.role || '').toLowerCase() === 'admin') return false;
  return normalizePermissionList(user).includes(AGENT_RESTRICTED_PERMISSION);
};

const AGENT_RESTRICTED_ALLOWLIST: Array<{ methods: string[]; pattern: RegExp }> = [
  { methods: ['GET'], pattern: /^\/api\/session\/(branches|companies)$/ },
  { methods: ['POST'], pattern: /^\/api\/session\/(company-context|branch-context)$/ },
  { methods: ['GET'], pattern: /^\/api\/inventory(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/agent-inventory(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/agent-transfers(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/items(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/warehouses(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/categories(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/sub-categories(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/pricing(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/clients(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/parties(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/customers(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/suppliers(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/cash-boxes(?:\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/api\/invoices(?:\/|$)/ },
  { methods: ['GET'], pattern: /^\/api\/next-number\/[^/]+$/ },
  { methods: ['POST'], pattern: /^\/api\/agents\/[^/]+\/location$/ },
];

const isAgentRestrictedRequestAllowed = (req: any) => {
  const method = String(req.method || 'GET').toUpperCase();
  const path = getPath(req);
  return AGENT_RESTRICTED_ALLOWLIST.some((entry) => entry.methods.includes(method) && entry.pattern.test(path));
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildPrefixPattern = (prefixes: string[]) =>
  new RegExp(prefixes.map((prefix) => `^${escapeRegex(prefix)}(?:\\/|$)`).join('|'));

export const ROUTE_FAMILY_REGISTRY: RouteFamilyPolicy[] = [
  { key: 'smart', prefixes: ['/api/smart'], readOperation: 'smart.read' },
  { key: 'reports', prefixes: ['/api/reports'], readOperation: 'reports.read' },
  { key: 'accounts', prefixes: ['/api/accounts'], readOperation: 'accounts.read', writeOperation: 'accounts.write' },
  { key: 'funds', prefixes: ['/api/cash-boxes'], readOperation: 'funds.read', writeOperation: 'funds.write' },
  { key: 'vouchers', prefixes: ['/api/vouchers', '/api/receipts', '/api/payments'], readOperation: 'vouchers.read', writeOperation: 'vouchers.write' },
  { key: 'inventory', prefixes: ['/api/inventory', '/api/items', '/api/warehouses', '/api/item-groups', '/api/item-group-items', '/api/promotions', '/api/categories', '/api/sub-categories', '/api/item-serials', '/api/item-barcodes', '/api/inventory/transfers'], readOperation: 'inventory.read', writeOperation: 'inventory.write' },
  { key: 'units', prefixes: ['/api/units'], readOperation: 'units.read', writeOperation: 'units.write' },
  { key: 'agents', prefixes: ['/api/agents', '/api/agent-inventory', '/api/agent-transfers', '/api/agent-transfer-lines', '/api/agent-inventory-movements'], readOperation: 'agents.read', writeOperation: 'agents.write' },
  { key: 'parties', prefixes: ['/api/parties', '/api/clients', '/api/customers', '/api/suppliers', '/api/party-transactions', '/api/parties/transfers'], readOperation: 'parties.read', writeOperation: 'parties.write' },
  { key: 'partners', prefixes: ['/api/partners', '/api/partner-transactions'], readOperation: 'partners.read', writeOperation: 'partners.write' },
  { key: 'pricing', prefixes: ['/api/pricing'], readOperation: 'pricing.read', writeOperation: 'pricing.write' },
  { key: 'expenses', prefixes: ['/api/expenses'], readOperation: 'expenses.read', writeOperation: 'expenses.write' },
  { key: 'employees', prefixes: ['/api/employees'], readOperation: 'employees.read', writeOperation: 'employees.write' },
  { key: 'biometric', prefixes: ['/api/biometric', '/api/biometric-devices', '/api/attendance-records'], readOperation: 'biometric.read', writeOperation: 'biometric.write' },
  { key: 'consignment', prefixes: ['/api/consignments', '/api/consignment-settlements', '/api/settings/consignment'], readOperation: 'consignment.read', writeOperation: 'consignment.write' },
  { key: 'payroll', prefixes: ['/api/payroll'], readOperation: 'payroll.read', writeOperation: 'payroll.write' },
  { key: 'manufacturing', prefixes: ['/api/manufacturing'], readOperation: 'manufacturing.read', writeOperation: 'manufacturing.write' },
  { key: 'backups', prefixes: ['/api/backups'], readOperation: 'backups.read', writeOperation: 'backups.write', writeRoles: ['admin'] },
  { key: 'settings', prefixes: ['/api/settings', '/api/system-settings'], readOperation: 'settings.read', writeOperation: 'settings.write' },
  { key: 'print', prefixes: ['/api/print'], readOperation: 'print.read', writeOperation: 'print.write' },
  { key: 'system-monitoring', prefixes: ['/api/system-events'], readOperation: 'system.admin', writeOperation: 'system.admin', readRoles: ['admin'], writeRoles: ['admin'] },
  { key: 'system-branches', prefixes: ['/api/remote-branches', '/api/branches', '/api/companies', '/api/user-branch-access', '/api/user-company-access'], readOperation: 'system.admin', writeOperation: 'system.admin', writeRoles: ['admin'] },
  { key: 'periods', prefixes: ['/api/periods'], readOperation: 'periods.read', writeOperation: 'periods.write' },
  { key: 'periods-admin', prefixes: ['/api/periods-admin'], readOperation: 'periods.admin', writeOperation: 'periods.admin', readRoles: ['admin'], writeRoles: ['admin'] },
  { key: 'provisioning-admin', prefixes: ['/api/provisioning-admin'], readOperation: 'system.admin', writeOperation: 'system.admin', readRoles: ['admin'], writeRoles: ['admin'] },
];

const buildRegistryRules = (families: RouteFamilyPolicy[]): RouteRule[] => families.flatMap((family) => {
  const pattern = buildPrefixPattern(family.prefixes);
  const rules: RouteRule[] = [];
  if (family.readOperation) {
    rules.push({
      methods: family.readMethods || ['GET'],
      pattern,
      operation: family.readOperation,
      permissions: [family.readOperation],
      roles: family.readRoles,
    });
  }
  if (family.writeOperation) {
    rules.push({
      methods: family.writeMethods || ['POST', 'PUT', 'PATCH', 'DELETE'],
      pattern,
      operation: family.writeOperation,
      permissions: [family.writeOperation],
      roles: family.writeRoles,
    });
  }
  return rules;
});

const CUSTOM_ROUTE_RULES: RouteRule[] = [
  { methods: ['GET'], pattern: /^\/api\/restaurant\/public\/menu\/[^/]+$/, operation: 'restaurant.public.menu', permissions: [] },
  { methods: ['GET'], pattern: /^\/api\/restaurant\/public\/menu\/[^/]+\/session$/, operation: 'restaurant.public.session', permissions: [] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/public\/menu\/[^/]+\/request$/, operation: 'restaurant.public.request', permissions: [] },
  { methods: ['GET'], pattern: /^\/api\/public\/companies$/, operation: 'public.companies', permissions: [] },
  { methods: ['POST'], pattern: /^\/api\/clients\/heartbeat$/, operation: 'clients.heartbeat', permissions: [] },
  {
    methods: ['POST'],
    pattern: /^\/api\/agents\/[^/]+\/location$/,
    operation: 'agents.location',
    permissions: ['agents.write'],
    allowWhen: async (req, deps) => {
      try {
        await req.jwtVerify();
      } catch {
        return false;
      }
      const userId = String(req.user?.id || '').trim();
      if (!userId) return false;
      const user = await deps.db.select().from(deps.schema.users).where(deps.eq(deps.schema.users.id, userId)).get();
      if (!user || user.isActive === false || Number(user.isActive) === 0) return false;
      if (String(user.role || '').toLowerCase() !== 'agent') return false;
      const headerValue = req.headers['x-company-id'] ?? req.headers['x-active-org'];
      const requestCompanyId = Array.isArray(headerValue) ? String(headerValue[0] || '').trim() : String(headerValue || '').trim();
      if (!requestCompanyId || requestCompanyId !== String(user.companyId || '').trim()) return false;
      const agentId = String(req.params?.id || '').trim();
      if (!agentId) return false;
      const agent = await deps.db.select().from(deps.schema.agents).where(deps.eq(deps.schema.agents.id, agentId)).get();
      if (!agent) return false;
      if (String(agent.companyId || '').trim() !== String(user.companyId || '').trim()) return false;
      if (String(agent.userId || agent.id || '').trim() !== userId) return false;
      const branchAccess = await deps.db.select().from(deps.schema.userBranchAccess).where(deps.eq(deps.schema.userBranchAccess.userId, userId)).all();
      if (Array.isArray(branchAccess) && branchAccess.length > 0) {
        const allowed = new Set(
          branchAccess
            .filter((row: any) => row?.isActive !== false && Number(row?.isActive ?? 1) !== 0)
            .map((row: any) => String(row.branchId || '').trim())
            .filter(Boolean),
        );
        if (allowed.size > 0 && agent.branchId && !allowed.has(String(agent.branchId || '').trim())) return false;
      }
      return true;
    },
  },
  { methods: ['POST', 'PUT', 'PATCH'], pattern: /^\/api\/users(?:\/[^/]+)?$/, operation: 'auth.users.manage', permissions: ['auth.users.manage'] },
  { methods: ['DELETE'], pattern: /^\/api\/users\/[^/]+$/, operation: 'auth.users.manage', permissions: ['auth.users.manage'] },
  { methods: ['GET'], pattern: /^\/api\/session\/branches$/, operation: 'auth.session.branches' },
  { methods: ['GET'], pattern: /^\/api\/session\/companies$/, operation: 'auth.session.companies' },
  { methods: ['POST'], pattern: /^\/api\/session\/company-context$/, operation: 'auth.session.company' },
  { methods: ['POST'], pattern: /^\/api\/session\/branch-context$/, operation: 'auth.session.branch' },
  { methods: ['POST'], pattern: /^\/api\/funds\/transfer$/, operation: 'funds.transfer', permissions: ['funds.transfer'] },
  { methods: ['GET'], pattern: /^\/api\/next-number\/[^/]+$|^\/api\/invoices(?:\/|$)/, operation: 'invoices.read', permissions: ['invoices.read'] },
  { methods: ['GET'], pattern: /^\/api\/agent-inventory(?:\/|$)/, operation: 'inventory.read', permissions: ['inventory.read'] },
  { methods: ['GET'], pattern: /^\/api\/agent-transfers(?:\/|$)/, operation: 'inventory.read', permissions: ['inventory.read'] },
  {
    methods: ['POST'],
    pattern: /^\/api\/invoices$/,
    operation: 'invoices.create',
    permissions: (req: any) => {
      const bodyType = String(req.body?.type || '').toLowerCase();
      if (bodyType === 'purchase') return ['invoices.create.purchase'];
      if (bodyType === 'opening_stock') return ['invoices.create.opening_stock'];
      return ['invoices.create.sale'];
    },
  },
  { methods: ['PUT', 'PATCH'], pattern: /^\/api\/invoices\/[^/]+$/, operation: 'invoices.update', permissions: ['invoices.update'] },
  { methods: ['POST'], pattern: /^\/api\/invoices\/[^/]+\/post$/, operation: 'invoices.post', permissions: ['invoices.post'] },
  { methods: ['POST'], pattern: /^\/api\/invoices\/[^/]+\/cancel$/, operation: 'invoices.cancel', permissions: ['invoices.cancel'] },
  { methods: ['POST'], pattern: /^\/api\/invoices\/[^/]+\/stock-toggle$/, operation: 'invoices.stock_toggle', permissions: ['invoices.stock_toggle'] },
  { methods: ['GET'], pattern: /^\/api\/opening-(stock|receivables)(?:\/|$)|^\/api\/opening-balances\//, operation: 'opening.read', permissions: ['opening.read'] },
  { methods: ['POST'], pattern: /^\/api\/opening-(stock|receivables)(?:\/|$)|^\/api\/opening-balances\//, operation: 'opening.write', permissions: ['opening.write'] },
  { methods: ['POST'], pattern: /^\/api\/inventory\/bulk-price-update$/, operation: 'inventory.price', permissions: ['inventory.price'] },
  { methods: ['GET'], pattern: /^\/api\/restaurant\/tables$/, operation: 'restaurant.read', permissions: ['restaurant.read'] },
  { methods: ['GET'], pattern: /^\/api\/restaurant\/sessions\/open$/, operation: 'restaurant.read', permissions: ['restaurant.read'] },
  { methods: ['GET'], pattern: /^\/api\/restaurant\/sessions\/[^/]+$/, operation: 'restaurant.read', permissions: ['restaurant.read'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/tables$/, operation: 'restaurant.tables.write', permissions: ['restaurant.tables.write'] },
  { methods: ['PUT'], pattern: /^\/api\/restaurant\/tables\/[^/]+$/, operation: 'restaurant.tables.write', permissions: ['restaurant.tables.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/sessions\/open-all-empty$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/tables\/[^/]+\/open-session$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['PUT'], pattern: /^\/api\/restaurant\/sessions\/[^/]+$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/sessions\/[^/]+\/close$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['GET'], pattern: /^\/api\/restaurant\/sessions\/[^/]+\/requests$/, operation: 'restaurant.read', permissions: ['restaurant.read'] },
  { methods: ['GET'], pattern: /^\/api\/restaurant\/menu-items$/, operation: 'restaurant.read', permissions: ['restaurant.read'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/menu-items$/, operation: 'restaurant.tables.write', permissions: ['restaurant.tables.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/tables\/[^/]+\/regenerate-public-token$/, operation: 'restaurant.tables.write', permissions: ['restaurant.tables.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/requests\/[^/]+\/mark-seen$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/requests\/[^/]+\/accept$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/requests\/[^/]+\/reject$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/requests\/[^/]+\/archive$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['POST'], pattern: /^\/api\/restaurant\/monitor-event$/, operation: 'restaurant.sessions.write', permissions: ['restaurant.sessions.write'] },
  { methods: ['GET'], pattern: /^\/api\/delivery-notices(?:\/|$)|^\/api\/reconciliation-marks(?:\/|$)/, operation: 'delivery.manage', permissions: ['delivery.manage', 'delivery.approve'] },
  { methods: ['POST'], pattern: /^\/api\/delivery-notices\/[^/]+\/(confirm|reject)$/, operation: 'delivery.approve', permissions: ['delivery.approve'] },
  { methods: ['POST', 'PUT', 'PATCH'], pattern: /^\/api\/delivery-notices(?:$|\/[^/]+$|\/[^/]+\/(submit|warehouse-prepare)$)|^\/api\/reconciliation-marks(?:\/|$)/, operation: 'delivery.manage', permissions: ['delivery.manage'] },
  { methods: ['GET'], pattern: /^\/api\/textile\/colors(?:\/|$)/, operation: 'textile.dispatch.view', permissions: ['textile.dispatch.view'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/colors$/, operation: 'textile.colors.manage', permissions: ['textile.colors.manage'] },
  { methods: ['GET'], pattern: /^\/api\/textile\/inventory(?:\/|$)/, operation: 'textile.inventory.read', permissions: ['textile.inventory.read'] },
  { methods: ['GET'], pattern: /^\/api\/textile\/dispatches(?:\/|$)/, operation: 'textile.dispatch.view', permissions: ['textile.dispatch.view'] },
  { methods: ['GET'], pattern: /^\/api\/textile\/dispatches\/[^/]+$/, operation: 'textile.dispatch.open', permissions: ['textile.dispatch.open'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches$/, operation: 'textile.dispatch.create', permissions: ['textile.dispatch.create'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/start-preparation$/, operation: 'textile.dispatch.open', permissions: ['textile.dispatch.open'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/prepare$/, operation: 'textile.dispatch.prepare', permissions: ['textile.dispatch.prepare'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/send$/, operation: 'textile.dispatch.confirm', permissions: ['textile.dispatch.confirm'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/cancel$/, operation: 'textile.dispatch.create', permissions: ['textile.dispatch.create'] },
  { methods: ['GET'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/print-payload$/, operation: 'textile.dispatch.print', permissions: ['textile.dispatch.print'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/(approve|reject)$/, operation: 'textile.dispatch.approve', permissions: ['textile.dispatch.approve'] },
  { methods: ['POST'], pattern: /^\/api\/textile\/dispatches\/[^/]+\/convert-to-invoice$/, operation: 'textile.dispatch.convert', permissions: ['textile.dispatch.convert'] },
  { methods: ['GET'], pattern: /^\/api\/system\/summary$/, operation: 'system.admin', permissions: ['system.admin'] },
  { methods: ['POST'], pattern: /^\/api\/system\/reset$/, operation: 'system.admin', permissions: ['system.admin'], roles: ['admin'] },
  { methods: ['GET'], pattern: /^\/api\/backups\/list$/, operation: 'backups.read', permissions: [] },
  { methods: ['GET'], pattern: /^\/api\/backups\/export\/(json|db)$/, operation: 'backups.read', permissions: [] },
  { methods: ['POST'], pattern: /^\/api\/backups\/create\/(json|db)$/, operation: 'backups.write', permissions: [] },
  { methods: ['POST'], pattern: /^\/api\/backups\/restore\/(json|from-backup|db-upload|db-from-backup)$/, operation: 'backups.write', permissions: [] },
  {
    methods: ['POST'],
    pattern: /^\/api\/activation\/activate$/,
    operation: 'activation.admin',
    permissions: ['activation.admin'],
    allowWhen: async (_req, deps) => {
      const activated = await isSystemActivated(deps);
      if (!activated) return true;
      let users: any[] = [];
      try {
        users = await deps.db.select().from(deps.schema.users).limit(1).all();
      } catch {
        users = [];
      }
      return (users || []).length === 0;
    },
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/activation\/notify-success$/,
    operation: 'activation.notify_success',
    permissions: ['activation.admin'],
    allowWhen: async () => true,
  },
];

export const getSecurityPolicyRules = (): RouteRule[] => [
  ...CUSTOM_ROUTE_RULES,
  ...buildRegistryRules(ROUTE_FAMILY_REGISTRY),
];

const ROUTE_RULES = getSecurityPolicyRules();

const normalizeCoverageTarget = (target: PolicyCoverageTarget) => (
  typeof target === 'string'
    ? { path: target, methods: ['POST'] as string[], body: undefined }
    : { path: target.path, methods: target.methods || ['POST'], body: target.body }
);

export const DEFAULT_POLICY_COVERAGE_TARGETS: PolicyCoverageTarget[] = [
  ...ROUTE_FAMILY_REGISTRY.flatMap((family) => family.prefixes.map((prefix) => ({
    path: prefix,
    methods: [
      ...(family.readOperation ? ['GET'] : []),
      ...(family.writeOperation ? ['POST'] : []),
    ],
  }))),
  { path: '/api/users', methods: ['POST'] },
  { path: '/api/users/sample-id', methods: ['DELETE'] },
  { path: '/api/funds/transfer', methods: ['POST'] },
  { path: '/api/invoices', methods: ['GET', 'POST'], body: { type: 'sale' } },
  { path: '/api/invoices/sample-id', methods: ['PUT'] },
  { path: '/api/invoices/sample-id/post', methods: ['POST'] },
  { path: '/api/invoices/sample-id/cancel', methods: ['POST'] },
  { path: '/api/invoices/sample-id/stock-toggle', methods: ['POST'] },
  { path: '/api/opening-stock', methods: ['GET', 'POST'] },
  { path: '/api/opening-receivables', methods: ['GET', 'POST'] },
  { path: '/api/opening-balances/parties', methods: ['GET', 'POST'] },
  { path: '/api/delivery-notices', methods: ['GET', 'POST'] },
  { path: '/api/delivery-notices/sample-id/submit', methods: ['POST'] },
  { path: '/api/delivery-notices/sample-id/warehouse-prepare', methods: ['POST'] },
  { path: '/api/delivery-notices/sample-id/confirm', methods: ['POST'] },
  { path: '/api/delivery-notices/sample-id/reject', methods: ['POST'] },
  { path: '/api/reconciliation-marks', methods: ['GET', 'POST'] },
  { path: '/api/textile/colors', methods: ['GET', 'POST'] },
  { path: '/api/textile/inventory', methods: ['GET'] },
  { path: '/api/textile/dispatches', methods: ['GET', 'POST'] },
  { path: '/api/textile/dispatches/sample-id', methods: ['GET'] },
  { path: '/api/textile/dispatches/sample-id/send', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/start-preparation', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/prepare', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/approve', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/reject', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/convert-to-invoice', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/cancel', methods: ['POST'] },
  { path: '/api/textile/dispatches/sample-id/print-payload', methods: ['GET'] },
  { path: '/api/system/summary', methods: ['GET'] },
  { path: '/api/system/reset', methods: ['POST'] },
  { path: '/api/system-events', methods: ['GET'] },
  { path: '/api/system-events/export', methods: ['GET'] },
  { path: '/api/system-events/sample-id', methods: ['GET'] },
  { path: '/api/system-events/sample-id/resolve', methods: ['POST'] },
  { path: '/api/system-events/resolve-bulk', methods: ['POST'] },
  { path: '/api/system-events/delete-all', methods: ['POST'] },
  { path: '/api/system-events/delete-visible', methods: ['POST'] },
  { path: '/api/clients/heartbeat', methods: ['POST'] },
  { path: '/api/companies', methods: ['GET', 'POST'] },
  { path: '/api/user-branch-access', methods: ['GET', 'POST'] },
  { path: '/api/user-company-access', methods: ['GET', 'POST'] },
  { path: '/api/session/branches', methods: ['GET'] },
  { path: '/api/session/companies', methods: ['GET'] },
  { path: '/api/session/company-context', methods: ['POST'] },
  { path: '/api/session/branch-context', methods: ['POST'] },
  { path: '/api/activation/activate', methods: ['POST'] },
  { path: '/api/activation/notify-success', methods: ['POST'] },
  { path: '/api/restaurant/tables', methods: ['GET', 'POST'] },
  { path: '/api/restaurant/tables/sample-id', methods: ['PUT'] },
  { path: '/api/restaurant/sessions/open', methods: ['GET'] },
  { path: '/api/restaurant/sessions/sample-id', methods: ['GET', 'PUT'] },
  { path: '/api/restaurant/tables/sample-id/open-session', methods: ['POST'] },
  { path: '/api/restaurant/sessions/sample-id/close', methods: ['POST'] },
  { path: '/api/restaurant/sessions/sample-id/requests', methods: ['GET'] },
  { path: '/api/restaurant/menu-items', methods: ['GET', 'POST'] },
  { path: '/api/restaurant/tables/sample-id/regenerate-public-token', methods: ['POST'] },
  { path: '/api/restaurant/requests/sample-id/mark-seen', methods: ['POST'] },
  { path: '/api/restaurant/requests/sample-id/accept', methods: ['POST'] },
  { path: '/api/restaurant/requests/sample-id/reject', methods: ['POST'] },
  { path: '/api/restaurant/requests/sample-id/archive', methods: ['POST'] },
  { path: '/api/restaurant/monitor-event', methods: ['POST'] },
  { path: '/api/restaurant/public/menu/sample-token', methods: ['GET'] },
  { path: '/api/restaurant/public/menu/sample-token/session', methods: ['GET'] },
  { path: '/api/restaurant/public/menu/sample-token/request', methods: ['POST'] },
  { path: '/api/public/companies', methods: ['GET'] },
];

export const verifySensitiveRoutePolicyCoverage = (targets: PolicyCoverageTarget[] = DEFAULT_POLICY_COVERAGE_TARGETS) => {
  const missing: Array<{ path: string; method: string }> = [];
  let checked = 0;

  for (const rawTarget of targets) {
    const target = normalizeCoverageTarget(rawTarget);
    for (const method of target.methods) {
      checked += 1;
      const matched = ROUTE_RULES.some((rule) => rule.methods.includes(String(method).toUpperCase()) && rule.pattern.test(target.path));
      if (!matched) {
        missing.push({ path: target.path, method: String(method).toUpperCase() });
      }
    }
  }

  return { checked, missing };
};

const findRule = (req: any) => {
  const method = String(req.method || 'GET').toUpperCase();
  const path = getPath(req);
  return ROUTE_RULES.find((rule) => rule.methods.includes(method) && rule.pattern.test(path));
};

export const createSecurityTools = (deps: SecurityDeps) => {
  const clearBootstrapHeaders = (req: any) => {
    delete req.headers.authorization;
    delete req.headers.Authorization;
    delete req.headers['x-company-id'];
    delete req.headers['x-active-org'];
    delete req.headers['x-branch-id'];
  };

  const getRequestCompanyId = (req: any) => {
    const headerValue = req.headers['x-company-id'] ?? req.headers['x-active-org'];
    if (Array.isArray(headerValue)) {
      return String(headerValue[0] || '').trim() || null;
    }
    return String(headerValue || '').trim() || null;
  };

  const getRequestBranchId = (req: any) => {
    const headerValue = req.headers['x-branch-id'];
    const queryValue = req.query?.branchId ?? req.query?.branch_id;
    const bodyValue = req.body?.branchId ?? req.body?.branch_id;
    const value = Array.isArray(headerValue)
      ? headerValue[0]
      : (headerValue ?? queryValue ?? bodyValue);
    return normalizeTenantId(value);
  };

  const loadUserFromJwt = async (req: any) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) return null;
    const user = await deps.db.select().from(deps.schema.users).where(deps.eq(deps.schema.users.id, userId)).get();
    return user || null;
  };

  const requireSuperAdmin = async (req: any) => {
    try {
      await req.jwtVerify();
    } catch {
      throw appError(401, 'UNAUTHENTICATED', 'غير مصرح.');
    }
    if (String(req.user?.scope || '').trim() !== 'super_admin') {
      throw appError(403, 'SUPER_ADMIN_REQUIRED', 'الوصول محصور بالمشرف العام للنظام.');
    }
    const account = await deps.db.select().from(deps.schema.systemSuperAdmins).where(deps.eq(deps.schema.systemSuperAdmins.id, String(req.user?.id || ''))).get();
    if (!account) {
      throw appError(401, 'UNAUTHENTICATED', 'حساب المشرف العام غير موجود.');
    }
    (req as any).superAdminContext = {
      id: String(account.id || ''),
      username: String(account.username || ''),
      scope: 'super_admin',
    };
    return account;
  };

  const extractAuditContext = (req: any, user?: any) => ({
    userId: String(user?.id || '').trim() || null,
    username: String(user?.username || '').trim() || null,
    role: String(user?.role || '').trim() || null,
    companyId: getRequestCompanyId(req) || String(req.user?.companyId || '').trim() || null,
    ip: String(req.ip || req.headers['x-forwarded-for'] || '').trim() || null,
    userAgent: String(req.headers['user-agent'] || '').trim() || null,
    path: getPath(req),
    method: String(req.method || 'GET').toUpperCase(),
  });

  const assertCompanyContext = (req: any) => {
    const requestCompanyId = getRequestCompanyId(req);
    const tokenCompanyId = String(req.user?.companyId || '').trim() || null;
    const path = getPath(req);
    if (!requestCompanyId && tokenCompanyId && /^\/api\/backups\/export\/(json|db)$/.test(path)) {
      (req.headers as any)['x-company-id'] = tokenCompanyId;
      (req.headers as any)['x-active-org'] = tokenCompanyId;
      return tokenCompanyId;
    }
    if (!requestCompanyId || !tokenCompanyId) {
      throw appError(401, 'NO_COMPANY_CONTEXT', 'يجب تمرير سياق مؤسسة صالح مع كل طلب محمي.');
    }
    if (requestCompanyId !== tokenCompanyId) {
      throw appError(409, 'COMPANY_CONTEXT_MISMATCH', 'سياق المؤسسة في الجلسة لا يطابق سياق الطلب.');
    }
    return tokenCompanyId;
  };

  const assertAuthenticated = async (req: any) => {
    try {
      await req.jwtVerify();
    } catch {
      throw appError(401, 'UNAUTHENTICATED', 'غير مصرح.');
    }
    const companyId = assertCompanyContext(req);
    const user = await loadUserFromJwt(req);
    if (!user) throw appError(401, 'UNAUTHENTICATED', 'غير مصرح.');
    if (user.isActive === false || Number(user.isActive) === 0) {
      throw appError(403, 'INACTIVE_USER', 'المستخدم غير مفعل.');
    }

    const branchAccess = await resolveBranchAccessForUser(deps.db, deps.schema, deps.eq, user, companyId);
    const requestedBranchId = getRequestBranchId(req);
    const tokenBranchId = normalizeTenantId(req.user?.currentBranchId);
    const effectiveBranchId = pickEffectiveBranchId(
      requestedBranchId || tokenBranchId,
      {
        companyId,
        branchScope: branchAccess.branchScope,
        allowedBranchIds: branchAccess.allowedBranchIds,
        defaultBranchId: branchAccess.defaultBranchId,
        currentBranchId: branchAccess.currentBranchId,
        requiresBranchSelection: branchAccess.requiresBranchSelection,
      }
    );

    if (requestedBranchId && !hasBranchAccess({
      companyId,
      branchScope: branchAccess.branchScope,
      allowedBranchIds: branchAccess.allowedBranchIds,
    }, requestedBranchId)) {
      throw appError(403, 'BRANCH_ACCESS_DENIED', 'هذا الفرع غير مسموح للمستخدم الحالي.', {
        branch_id: requestedBranchId,
        allowed_branch_ids: branchAccess.allowedBranchIds,
      });
    }

    if (requiresBranchForPath(getPath(req), String(req.method || 'GET')) && !effectiveBranchId) {
      throw appError(400, 'BRANCH_REQUIRED', 'يجب اختيار فرع صالح قبل متابعة العملية.', {
        allowed_branch_ids: branchAccess.allowedBranchIds,
        requires_branch_selection: branchAccess.requiresBranchSelection,
      });
    }

    (req as any).companyContext = {
      companyId,
      ...branchAccess,
      requestedBranchId,
      currentBranchId: effectiveBranchId || branchAccess.currentBranchId,
    };
    return user;
  };

  const requireAuth = async (req: any) => {
    const user = await assertAuthenticated(req);
    (req as any).authContext = {
      ...extractAuditContext(req, user),
      companyId: (req as any).companyContext?.companyId || null,
      branchId: (req as any).companyContext?.currentBranchId || null,
      allowedBranchIds: (req as any).companyContext?.allowedBranchIds || [],
      defaultBranchId: (req as any).companyContext?.defaultBranchId || null,
      branchScope: (req as any).companyContext?.branchScope || 'restricted',
      requiresBranchSelection: Boolean((req as any).companyContext?.requiresBranchSelection),
    };
    return user;
  };

  const requireRole = async (req: any, roles: string[]) => {
    const user = await requireAuth(req);
    const role = String(user.role || '').toLowerCase();
    if (!roles.map((entry) => entry.toLowerCase()).includes(role)) {
      throw appError(403, 'FORBIDDEN_ROLE', 'الصلاحية المطلوبة غير متاحة لهذا الدور.');
    }
    return user;
  };

  const requirePermission = async (req: any, permissions: string[]) => {
    const user = await requireAuth(req);
    const expandedPermissions = Array.from(new Set(
      permissions.flatMap((permission) => [permission, ...(OPERATION_PERMISSION_ALIASES[permission] || [])])
    ));
    if (!hasAnyPermission(user, expandedPermissions)) {
      throw appError(403, 'FORBIDDEN', 'صلاحيات غير كافية.');
    }
    (req as any).authContext = {
      ...(req as any).authContext,
      operationPermissions: expandedPermissions,
    };
    return user;
  };

  const requireModuleAccess = async (req: any, _moduleName: string, permissions: string[]) => requirePermission(req, permissions);

  const logScopeViolation = async (req: any, error: any) => {
    const code = String(error?.code || '').trim().toUpperCase();
    if (!deps.systemEventLogger || !SCOPE_VIOLATION_CODES.has(code)) return;
    try {
      const authContext = (req as any).authContext || {};
      const companyId = normalizeTenantId(
        authContext.companyId
        || req.user?.companyId
        || getRequestCompanyId(req)
      );
      const branchId = normalizeTenantId(
        authContext.branchId
        || getRequestBranchId(req)
      );
      const severity = code === 'COMPANY_CONTEXT_MISMATCH' || code === 'COMPANY_ACCESS_DENIED'
        ? 'critical'
        : 'warning';

      await deps.systemEventLogger.log({
        eventType: SYSTEM_EVENT_TYPES.CROSS_SCOPE_ACCESS_ATTEMPT,
        companyId: companyId || null,
        branchId: branchId || null,
        severity,
        sourceModule: 'security',
        action: 'pre_handler',
        status: 'failed',
        errorCode: code,
        requiresManualReview: false,
        metadata: {
          method: String(req.method || 'GET').toUpperCase(),
          path: getPath(req),
          userId: String(req.user?.id || authContext.userId || '').trim() || null,
          requestCompanyId: getRequestCompanyId(req),
          requestBranchId: getRequestBranchId(req),
          message: String(error?.message || ''),
          details: error?.details || null,
        },
      });
    } catch {
      // Non-blocking observability hook
    }
  };

  const preHandler = async (req: any, reply: any) => {
    const path = getPath(req);
    if (!path.startsWith('/api/')) return;
    if (BOOTSTRAP_PUBLIC_PATTERNS.some((pattern) => pattern.test(path))) {
      clearBootstrapHeaders(req);
      return;
    }
    if (PUBLIC_PATTERNS.some((pattern) => pattern.test(path))) return;

    if (path.startsWith('/api/super-admin/')) {
      try {
        await requireSuperAdmin(req);
        return;
      } catch (error: any) {
        if (isAppError(error)) {
          return reply.status(error.statusCode).send({
            error: error.message,
            code: error.code,
            details: error.details,
          });
        }
        return reply.status(500).send({
          error: 'فشل التحقق الأمني.',
          code: 'SECURITY_GUARD_FAILURE',
        });
      }
    }

    // Backups are governed by route rules (normal users should access them too).

    try {
      const rule = findRule(req);
      if (!rule) {
        const method = String(req.method || 'GET').toUpperCase();
        const activeUser = await requireAuth(req);
        if (activeUser && isAgentRestrictedUser(activeUser) && !isAgentRestrictedRequestAllowed(req)) {
          throw appError(403, 'AGENT_MODE_RESTRICTED', 'الوصول مقيد بوضع المندوب.');
        }
        if (SENSITIVE_WRITE_METHODS.has(method)) {
          throw appError(403, 'NO_AUTHORIZATION_POLICY', 'لا توجد سياسة تفويض مطابقة لهذا المسار الحساس.');
        }
        return;
      }

      if (rule.allowWhen && await rule.allowWhen(req, deps)) {
        return;
      }

      let activeUser: any = null;
      if (rule.roles?.length) {
        activeUser = await requireRole(req, rule.roles);
      } else {
        activeUser = await requireAuth(req);
      }

      if (activeUser && isAgentRestrictedUser(activeUser) && !isAgentRestrictedRequestAllowed(req)) {
        throw appError(403, 'AGENT_MODE_RESTRICTED', 'الوصول مقيد بوضع المندوب.');
      }

      const requiredPermissions = typeof rule.permissions === 'function'
        ? rule.permissions(req)
        : (rule.permissions || []);

      if (requiredPermissions.length > 0) {
        await requireModuleAccess(req, rule.operation, requiredPermissions);
      }

      (req as any).authContext = {
        ...(req as any).authContext,
        operation: rule.operation,
      };
    } catch (error: any) {
      if (isAppError(error)) {
        await logScopeViolation(req, error);
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return reply.status(500).send({
        error: 'فشل التحقق الأمني.',
        code: 'SECURITY_GUARD_FAILURE',
      });
    }
  };

  return {
    extractAuditContext,
    requireAuth,
    requirePermission,
    requireRole,
    requireActiveUser: requireAuth,
    requireModuleAccess,
    preHandler,
  };
};
