import { apiRequest } from '../../lib/api';
import type { RestaurantTable, RestaurantTableSession, SessionStatus } from './restaurant.types';

export type RestaurantMonitorEventPayload = {
  eventType: string;
  action: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  status?: 'success' | 'failed' | 'partial' | 'compensated';
  errorCode?: string | null;
  requiresManualReview?: boolean;
  affectedDocumentType?: string | null;
  affectedDocumentId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function getTables(): Promise<{ tables: RestaurantTable[] }> {
  return apiRequest('restaurant/tables');
}

export async function createTable(body: {
  code: string;
  name: string;
  zoneName?: string | null;
  capacity?: number | null;
  sortOrder?: number;
  notes?: string | null;
}): Promise<{ table: RestaurantTable }> {
  return apiRequest('restaurant/tables', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateTable(
  id: string,
  body: {
    name?: string;
    zoneName?: string | null;
    capacity?: number | null;
    sortOrder?: number;
    isActive?: boolean;
    notes?: string | null;
  },
): Promise<{ table: RestaurantTable }> {
  return apiRequest(`restaurant/tables/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function getOpenSessions(): Promise<{ sessions: RestaurantTableSession[] }> {
  return apiRequest('restaurant/sessions/open');
}

export async function openSession(
  tableId: string,
  body: { guestCount?: number | null; notes?: string | null } = {},
): Promise<{ session: RestaurantTableSession }> {
  return apiRequest(`restaurant/tables/${encodeURIComponent(tableId)}/open-session`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** يفتح جلسة يدوية باسم الكاشير لكل طاولة نشطة بلا جلسة حيّة. */
export async function openSessionsForAllEmptyTables(): Promise<{
  openedCount: number;
  sessions: RestaurantTableSession[];
}> {
  return apiRequest('restaurant/sessions/open-all-empty', { method: 'POST', body: '{}' });
}

export async function getSession(id: string): Promise<{
  session: RestaurantTableSession;
  openedByName: string | null;
  closedByName: string | null;
  table: RestaurantTable | null;
}> {
  return apiRequest(`restaurant/sessions/${encodeURIComponent(id)}`);
}

export async function updateSession(
  id: string,
  body: {
    guestCount?: number | null;
    notes?: string | null;
    preliminaryTotal?: number;
    sessionStatus?: SessionStatus | undefined;
  },
): Promise<{ session: RestaurantTableSession }> {
  return apiRequest(`restaurant/sessions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function closeSession(
  id: string,
  opts?: { forceCloseWithUnreadRequests?: boolean },
): Promise<{ session: RestaurantTableSession }> {
  return apiRequest(`restaurant/sessions/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    body: JSON.stringify({
      forceCloseWithUnreadRequests: Boolean(opts?.forceCloseWithUnreadRequests),
    }),
  });
}

export type RestaurantSessionRequestRow = {
  id: string;
  requestStatus: string;
  submittedAt: string;
  notes: string | null;
  items?: Array<{
    itemNameSnapshot: string;
    quantity: number;
    lineSubtotal: number;
    customerNote: string | null;
  }>;
};

export async function getSessionRequests(sessionId: string): Promise<{ requests: RestaurantSessionRequestRow[] }> {
  return apiRequest(`restaurant/sessions/${encodeURIComponent(sessionId)}/requests`);
}

export async function markRequestSeen(requestId: string): Promise<{ unreadCount?: number }> {
  return apiRequest(`restaurant/requests/${encodeURIComponent(requestId)}/mark-seen`, { method: 'POST', body: '{}' });
}

export async function acceptRequest(requestId: string): Promise<{ unreadCount?: number }> {
  return apiRequest(`restaurant/requests/${encodeURIComponent(requestId)}/accept`, { method: 'POST', body: '{}' });
}

export async function rejectRequest(requestId: string): Promise<{ unreadCount?: number }> {
  return apiRequest(`restaurant/requests/${encodeURIComponent(requestId)}/reject`, { method: 'POST', body: '{}' });
}

export async function archiveRequest(requestId: string): Promise<{ unreadCount?: number }> {
  return apiRequest(`restaurant/requests/${encodeURIComponent(requestId)}/archive`, { method: 'POST', body: '{}' });
}

export type RestaurantMenuItemRow = {
  id: string;
  itemId: string;
  isVisibleInQr: boolean;
  categoryName: string | null;
  sortOrder: number;
  displayNameOverride: string | null;
  description: string | null;
  imageUrl: string | null;
  isAvailableNow: boolean;
};

export async function getRestaurantMenuItems(): Promise<{ menuItems: (RestaurantMenuItemRow & { item: Record<string, unknown> | null })[] }> {
  return apiRequest('restaurant/menu-items');
}

export async function upsertRestaurantMenuItem(body: {
  itemId: string;
  isVisibleInQr?: boolean;
  categoryName?: string | null;
  sortOrder?: number;
  displayNameOverride?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  isAvailableNow?: boolean;
}): Promise<{ menuItem: RestaurantMenuItemRow }> {
  return apiRequest('restaurant/menu-items', { method: 'POST', body: JSON.stringify(body) });
}

export async function regenerateTablePublicToken(tableId: string): Promise<{ table: RestaurantTable }> {
  return apiRequest(`restaurant/tables/${encodeURIComponent(tableId)}/regenerate-public-token`, { method: 'POST', body: '{}' });
}

export async function emitRestaurantMonitorEvent(payload: RestaurantMonitorEventPayload): Promise<{ success: boolean; eventId?: string | null }> {
  return apiRequest('restaurant/monitor-event', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
