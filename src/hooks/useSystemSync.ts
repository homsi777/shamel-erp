import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getRestaurantSocketOrigin } from '../modules/restaurant/public/restaurantPublic.api';
import { getToken } from '../lib/api';

type SystemSyncPayload = {
  companyId: string;
  branchId?: string | null;
  reason?: string;
  scope?: string;
};

export const useSystemSync = (enabled: boolean, onSync: (payload: SystemSyncPayload) => void) => {
  const handlerRef = useRef(onSync);
  handlerRef.current = onSync;

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;

    let socket: Socket | null = null;
    socket = io(getRestaurantSocketOrigin(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    });

    const onSyncEvent = (payload: SystemSyncPayload) => {
      handlerRef.current(payload);
    };

    socket.on('system:sync', onSyncEvent);

    return () => {
      socket?.off('system:sync', onSyncEvent);
      socket?.close();
    };
  }, [enabled]);
};
