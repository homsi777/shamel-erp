import type { RestaurantTableSession, SessionStatus } from './restaurant.types';

/** consumed by صفحة المخزون عند الانتقال من المطعم */
export const SHAMEL_INVENTORY_FOCUS_ITEM_ID = 'shamel_inventory_focus_item_id';

export function navigateToInventoryItem(itemId: string, setActiveTab?: (tab: string) => void) {
  try {
    sessionStorage.setItem(SHAMEL_INVENTORY_FOCUS_ITEM_ID, String(itemId));
  } catch {
    /* ignore */
  }
  setActiveTab?.('inventory');
}

export const sessionStatusLabel = (status: SessionStatus | string): string => {
  const s = String(status || '').toLowerCase();
  if (s === 'open') return 'مفتوحة';
  if (s === 'pending_review') return 'بانتظار المراجعة';
  if (s === 'ready_to_close') return 'جاهزة للإغلاق';
  if (s === 'closed') return 'مغلقة';
  return s || '—';
};

/** Subtle card accent: border-l-4 class suffix or full border class */
export const sessionStatusCardTone = (status: SessionStatus | string): string => {
  const s = String(status || '').toLowerCase();
  // Operational mapping:
  // - open => busy/occupied (red)
  // - pending_review => review (yellow/amber)
  // - ready_to_close => closing soon (orange)
  // - closed => historical (grey)
  if (s === 'open') return 'border-l-4 border-l-rose-500 border-gray-200';
  if (s === 'pending_review') return 'border-l-4 border-l-amber-500 border-gray-200';
  if (s === 'ready_to_close') return 'border-l-4 border-l-orange-500 border-gray-200';
  if (s === 'closed') return 'border-l-4 border-l-slate-300 border-gray-200';
  return 'border-l-4 border-l-gray-200 border-gray-200';
};

export const sessionBadgeClass = (status: SessionStatus | string): string => {
  const s = String(status || '').toLowerCase();
  if (s === 'open') return 'bg-rose-50 text-rose-900 border-rose-200';
  if (s === 'pending_review') return 'bg-amber-50 text-amber-950 border-amber-200';
  if (s === 'ready_to_close') return 'bg-orange-50 text-orange-950 border-orange-200';
  if (s === 'closed') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-gray-50 text-gray-800 border-gray-200';
};

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('ar', { numeric: 'auto' }) : null;

export const formatRelativeTimeShort = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return '—';
  const diffSec = Math.round((t - Date.now()) / 1000);
  if (!rtf) {
    const mins = Math.round(diffSec / 60);
    if (Math.abs(mins) < 60) return `${mins} د`;
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 48) return `${hours} س`;
    const days = Math.round(hours / 24);
    return `${days} يوم`;
  }
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
};

export const deriveCardUiStatus = (session: RestaurantTableSession | null | undefined) => {
  if (!session || String(session.sessionStatus) === 'closed') return 'available' as const;
  const s = String(session.sessionStatus) as SessionStatus;
  if (s === 'pending_review') return 'pending_review' as const;
  if (s === 'ready_to_close') return 'ready_to_close' as const;
  return 'occupied' as const;
};
