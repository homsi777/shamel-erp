import { useEffect, useRef } from 'react';
import { apiRequest } from '../lib/api';
import { getSelectedCompanyId } from '../lib/companySession';

const HEARTBEAT_INTERVAL_MS = 20000;

const getClientId = () => {
  if (typeof window === 'undefined') return null;
  const key = 'shamel_client_id';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(key, id);
  }
  return id;
};

const getSessionId = () => {
  if (typeof window === 'undefined') return null;
  const key = 'shamel_client_session_id';
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(key, id);
  }
  return id;
};

const buildDeviceLabel = () => {
  if (typeof navigator === 'undefined') return 'Browser';
  const platform = (navigator as any)?.userAgentData?.platform || navigator.platform || '';
  const isMobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent || '');
  if (platform) return `${platform}${isMobile ? ' Mobile' : ''}`.trim();
  return isMobile ? 'Mobile Browser' : 'Browser';
};

export const useClientHeartbeat = (enabled: boolean) => {
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (!getSelectedCompanyId()) return;

    const clientId = getClientId();
    if (!clientId) return;

    const sendHeartbeat = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const deviceLabel = buildDeviceLabel();
        const sessionId = getSessionId();
        await apiRequest('clients/heartbeat', {
          method: 'POST',
          body: JSON.stringify({
            clientId,
            clientName: deviceLabel,
            deviceLabel,
            platform: (navigator as any)?.userAgentData?.platform || navigator.platform || '',
            appVersion: (navigator as any)?.userAgentData?.brands?.map((b: any) => b.brand).join(', ') || '',
            userAgent: navigator.userAgent || '',
            sessionId,
          }),
        });
      } catch {
        // Non-blocking: heartbeat failures should not affect UI.
      } finally {
        inFlight.current = false;
      }
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
};
