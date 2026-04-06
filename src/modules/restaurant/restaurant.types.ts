import type { AppUser } from '../../types';

/** Session lifecycle — operational only; not invoice state. */
export type SessionStatus = 'open' | 'pending_review' | 'ready_to_close' | 'closed';

export interface RestaurantTable {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  name: string;
  zoneName: string | null;
  capacity: number | null;
  sortOrder: number;
  isActive: boolean;
  notes: string | null;
  publicQrToken?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  currentSession?: RestaurantTableSession | null;
}

export interface RestaurantTableSession {
  id: string;
  companyId: string;
  branchId: string;
  tableId: string;
  openedByUserId: string;
  closedByUserId: string | null;
  sessionStatus: SessionStatus;
  guestCount: number | null;
  openedAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  preliminaryTotal: number;
  notes: string | null;
  source: string;
  unreadRequestCount?: number | null;
  finalInvoiceId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Card view model for the tables grid (table + optional live session). */
export interface RestaurantTableStatusCard {
  table: RestaurantTable;
  session: RestaurantTableSession | null;
  /** Derived UX bucket for filters */
  uiStatus: 'available' | 'occupied' | 'pending_review' | 'ready_to_close';
}

export type RestaurantTablesFilter = 'all' | 'available' | 'occupied' | 'pending_review' | 'ready_to_close';

export interface RestaurantModuleUserProps {
  currentUser?: AppUser;
}

/** QR screen placeholder row until QR flow is implemented */
export interface RestaurantQRTablePlaceholder {
  id: string;
  name: string;
}
