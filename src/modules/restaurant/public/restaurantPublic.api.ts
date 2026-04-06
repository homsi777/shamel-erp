import type { PublicMenuPayload } from './restaurantPublic.types';
import { mapRestaurantPublicErrorCode } from './restaurantPublic.errors';

const apiRoot = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3111/api';
  const envBase = String(import.meta?.env?.VITE_API_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/$/, '').replace(/\/api$/i, '') + '/api';
  const saved = localStorage.getItem('shamel_api_url');
  if (saved) return saved.replace(/\/$/, '');
  const h = window.location.hostname || '127.0.0.1';
  return `http://${h}:3111/api`;
};

export const getRestaurantSocketOrigin = (): string => apiRoot().replace(/\/api$/, '');

export class RestaurantPublicApiError extends Error {
  code?: string;
  details?: unknown;
  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'RestaurantPublicApiError';
    this.code = code;
    this.details = details;
  }
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = (data as any)?.error || (data as any)?.message || `خطأ ${res.status}`;
    const code = (data as any)?.code as string | undefined;
    const msg = mapRestaurantPublicErrorCode(code, String(raw));
    throw new RestaurantPublicApiError(msg, code, (data as any)?.details);
  }
  return data;
}

export async function fetchPublicMenu(
  publicToken: string,
  customerSessionToken?: string | null,
): Promise<PublicMenuPayload> {
  const q = customerSessionToken ? `?customerSessionToken=${encodeURIComponent(customerSessionToken)}` : '';
  const res = await fetch(
    `${apiRoot()}/restaurant/public/menu/${encodeURIComponent(publicToken)}${q}`,
    { headers: { Accept: 'application/json' } },
  );
  return parseJson(res) as Promise<PublicMenuPayload>;
}

export async function fetchPublicSession(
  publicToken: string,
  customerSessionToken?: string | null,
): Promise<Omit<PublicMenuPayload, 'table' | 'publicToken'> & { table: PublicMenuPayload['table']; notice: string }> {
  const q = customerSessionToken ? `?customerSessionToken=${encodeURIComponent(customerSessionToken)}` : '';
  const res = await fetch(
    `${apiRoot()}/restaurant/public/menu/${encodeURIComponent(publicToken)}/session${q}`,
    { headers: { Accept: 'application/json' } },
  );
  return parseJson(res) as any;
}

export async function submitPublicRequest(
  publicToken: string,
  body: {
    clientRequestId: string;
    customerSessionToken?: string | null;
    note?: string | null;
    items: Array<{ itemId: string; quantity: number; note?: string | null }>;
  },
): Promise<{
  customerSessionToken: string;
  requestId: string;
  requestStatus: string;
  sessionStatus: string;
  unreadCount: number;
  submittedAt: string;
  idempotentReplay?: boolean;
}> {
  const res = await fetch(
    `${apiRoot()}/restaurant/public/menu/${encodeURIComponent(publicToken)}/request`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return parseJson(res) as any;
}
