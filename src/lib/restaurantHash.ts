/**
 * Hash routes for Restaurant module (do not conflict with companySession routes:
 * #/login, #/select-company, #/select-branch — getCompanyRouteFromHash ignores /restaurant/*).
 */
export const RESTAURANT_HASH = {
  tables: '#/kitchen/tables',
  qrMenu: '#/kitchen/qr-menu',
  qrLegacy: '#/restaurant/qr',
} as const;

/** Customer QR deep-link: #/restaurant/public/<public_qr_token> */
export const buildRestaurantPublicHash = (publicToken: string) =>
  `#/restaurant/public/${encodeURIComponent(String(publicToken || '').trim())}`;

export type RestaurantHashView = 'tables' | 'qr-menu' | 'qr';

export const parseRestaurantViewFromHash = (hash?: string | null): RestaurantHashView | null => {
  const h = String((hash ?? (typeof window !== 'undefined' ? window.location.hash : '')) || '')
    .toLowerCase()
    .replace(/^#/, '');
  if (h.includes('restaurant/public')) return null;
  if (h.includes('kitchen/tables') || h.includes('restaurant/tables')) return 'tables';
  if (h.includes('kitchen/qr-menu') || h.includes('restaurant/qr-menu')) return 'qr-menu';
  if (h.includes('restaurant/qr')) return 'qr';
  return null;
};

export const parseRestaurantPublicTokenFromHash = (hash?: string | null): string | null => {
  const raw = String((hash ?? (typeof window !== 'undefined' ? window.location.hash : '')) || '').replace(/^#/, '');
  const m = raw.match(/restaurant\/public\/([^/?&#]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return m[1].trim();
  }
};

export const parseRestaurantPublicTokenFromUrl = (url?: string | null): string | null => {
  const raw = String((url ?? (typeof window !== 'undefined' ? window.location.href : '')) || '');
  const m = raw.match(/restaurant\/public\/([^/?&#]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return m[1].trim();
  }
};

export const setRestaurantHash = (view: RestaurantHashView) => {
  if (typeof window === 'undefined') return;
  if (view === 'tables') {
    window.location.hash = RESTAURANT_HASH.tables;
    return;
  }
  if (view === 'qr-menu') {
    window.location.hash = RESTAURANT_HASH.qrMenu;
    return;
  }
  window.location.hash = RESTAURANT_HASH.qrLegacy;
};
