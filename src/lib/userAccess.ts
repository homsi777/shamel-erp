import type { AppUser } from '../types';
import { PERMISSIONS } from '../types';

const RESTRICTED_TEXTILE_WAREHOUSE_PERMISSIONS = new Set<string>([
  PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE,
  PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT,
  PERMISSIONS.DECOMPOSE_TEXTILE_DISPATCH,
  PERMISSIONS.UPDATE_TEXTILE_DISPATCH_PREPARATION,
  PERMISSIONS.CONFIRM_TEXTILE_DISPATCH_PREPARATION,
  PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT,
  PERMISSIONS.VIEW_TEXTILE_STOCK_CONTEXT,
]);

const normalizePermissions = (user?: AppUser | null) =>
  Array.isArray(user?.permissions) ? user!.permissions.filter(Boolean) : [];

export const hasUserPermission = (user: AppUser | null | undefined, permission: string) =>
  Boolean(user && (user.role === 'admin' || normalizePermissions(user).includes(permission)));

export const canViewTextileDispatchModule = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE)
  || hasUserPermission(user, PERMISSIONS.MANAGE_TEXTILE_DISPATCH_REQUESTS)
  || hasUserPermission(user, PERMISSIONS.APPROVE_TEXTILE_DISPATCH)
  || hasUserPermission(user, PERMISSIONS.CONVERT_TEXTILE_DISPATCH_TO_INVOICE)
  || hasUserPermission(user, PERMISSIONS.MANAGE_DELIVERY_NOTICES)
  || hasUserPermission(user, PERMISSIONS.APPROVE_DELIVERY_NOTICES)
  || hasUserPermission(user, PERMISSIONS.CREATE_SALE_INVOICE);

export const canOpenTextileDispatchDocument = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.OPEN_TEXTILE_DISPATCH_DOCUMENT) || canViewTextileDispatchModule(user);

export const canCreateTextileDispatchRequest = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.MANAGE_TEXTILE_DISPATCH_REQUESTS)
  || hasUserPermission(user, PERMISSIONS.MANAGE_DELIVERY_NOTICES)
  || hasUserPermission(user, PERMISSIONS.CREATE_SALE_INVOICE);

export const canPrepareTextileDispatch = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.DECOMPOSE_TEXTILE_DISPATCH)
  || hasUserPermission(user, PERMISSIONS.UPDATE_TEXTILE_DISPATCH_PREPARATION)
  || hasUserPermission(user, PERMISSIONS.MANAGE_DELIVERY_NOTICES);

export const canConfirmTextileDispatchPreparation = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.CONFIRM_TEXTILE_DISPATCH_PREPARATION)
  || hasUserPermission(user, PERMISSIONS.MANAGE_DELIVERY_NOTICES);

export const canPrintTextileDispatchDocument = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.PRINT_TEXTILE_DISPATCH_DOCUMENT)
  || hasUserPermission(user, PERMISSIONS.MANAGE_DELIVERY_NOTICES)
  || hasUserPermission(user, PERMISSIONS.APPROVE_DELIVERY_NOTICES);

export const canViewTextileStockContext = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.VIEW_TEXTILE_STOCK_CONTEXT)
  || hasUserPermission(user, PERMISSIONS.VIEW_INVENTORY);

export const canApproveTextileDispatch = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.APPROVE_TEXTILE_DISPATCH)
  || hasUserPermission(user, PERMISSIONS.APPROVE_DELIVERY_NOTICES);

export const canConvertTextileDispatchToInvoice = (user?: AppUser | null) =>
  hasUserPermission(user, PERMISSIONS.CONVERT_TEXTILE_DISPATCH_TO_INVOICE)
  || hasUserPermission(user, PERMISSIONS.APPROVE_TEXTILE_DISPATCH)
  || hasUserPermission(user, PERMISSIONS.APPROVE_DELIVERY_NOTICES);

export const isAgentRestrictedUser = (user?: AppUser | null) => {
  if (!user || user.role === 'admin') return false;
  return hasUserPermission(user, PERMISSIONS.AGENT_MODE_RESTRICTED);
};

export const isRestrictedTextileWarehouseUser = (user?: AppUser | null) => {
  if (!user || user.role === 'admin') return false;
  const permissions = normalizePermissions(user);
  if (permissions.length === 0) return false;
  return permissions.includes(PERMISSIONS.VIEW_TEXTILE_DISPATCH_MODULE)
    && permissions.every((permission) => RESTRICTED_TEXTILE_WAREHOUSE_PERMISSIONS.has(permission));
};

export const getUserScopedVisibleTabs = (user: AppUser | null | undefined, baseTabs: Iterable<string>) => {
  const next = new Set<string>(baseTabs);

  next.delete('textile_dispatches');
  next.delete('textile_dispatch_approvals');
  next.delete('textile_inventory');

  if (isAgentRestrictedUser(user)) {
    return new Set(next.has('pos') ? ['pos'] : []);
  }

  if (isRestrictedTextileWarehouseUser(user)) {
    const restrictedTabs = new Set<string>();
    if (next.has('delivery_notices')) restrictedTabs.add('delivery_notices');
    return restrictedTabs;
  }

  return next;
};

export const getPreferredLandingTabForUser = (user: AppUser | null | undefined, visibleTabs: Iterable<string>) => {
  const tabs = Array.from(visibleTabs);
  if (isAgentRestrictedUser(user) && tabs.includes('pos')) return 'pos';
  if (isRestrictedTextileWarehouseUser(user) && tabs.includes('delivery_notices')) return 'delivery_notices';
  return tabs[0] || 'dashboard';
};
