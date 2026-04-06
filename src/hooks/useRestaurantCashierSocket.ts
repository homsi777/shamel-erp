import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiRequest, getToken } from '../lib/api';
import { getRestaurantSocketOrigin } from '../modules/restaurant/public/restaurantPublic.api';
import { shouldUseLocalApiRuntime } from '../lib/runtimeContext';

export type RestaurantCashierSocketHandlers = {
  onConnect?: () => void;
  onRequestNew?: (payload: Record<string, unknown>) => void;
  onSessionUpdated?: (payload: Record<string, unknown>) => void;
  onRequestSeen?: (payload: Record<string, unknown>) => void;
  onRequestAccepted?: (payload: Record<string, unknown>) => void;
  onRequestRejected?: (payload: Record<string, unknown>) => void;
  onSessionClosed?: (payload: Record<string, unknown>) => void;
};

/**
 * Cashier-side Socket.IO for restaurant QR / sessions (JWT auth.branch in token).
 */
export function useRestaurantCashierSocket(enabled: boolean, handlers: RestaurantCashierSocketHandlers) {
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const didInitialConnectRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;

    didInitialConnectRef.current = false;
    let socket: Socket | null = null;
    try {
      socket = io(getRestaurantSocketOrigin(), {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
      });
      socket.on('connect', () => {
        // Only log resync on reconnect to reduce noise.
        if (didInitialConnectRef.current) {
          if (!shouldUseLocalApiRuntime()) {
            void apiRequest('restaurant/socket/resync', {
              method: 'POST',
              body: JSON.stringify({ reason: 'socket_reconnect' }),
            }).catch(() => {});
          }
        }
        didInitialConnectRef.current = true;
        hRef.current.onConnect?.();
      });
      socket.on('restaurant:request-new', (p) => hRef.current.onRequestNew?.(p as any));
      socket.on('restaurant:session-updated', (p) => hRef.current.onSessionUpdated?.(p as any));
      socket.on('restaurant:request-seen', (p) => hRef.current.onRequestSeen?.(p as any));
      socket.on('restaurant:request-accepted', (p) => hRef.current.onRequestAccepted?.(p as any));
      socket.on('restaurant:request-rejected', (p) => hRef.current.onRequestRejected?.(p as any));
      socket.on('restaurant:session-closed', (p) => hRef.current.onSessionClosed?.(p as any));
    } catch {
      /* optional realtime */
    }

    return () => {
      socket?.close();
    };
  }, [enabled]);
}
