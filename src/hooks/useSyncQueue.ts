
import { useState, useEffect, useCallback } from 'react';
import { SyncQueueItem, isOnline } from '../types';
import { apiRequest, NetworkError, checkServerConnection } from '../lib/api';
import { isSyncedMode, setLastSyncAt } from '../lib/appMode';

const QUEUE_STORAGE_KEY = 'shamel_offline_queue';
const LOGS_STORAGE_KEY = 'shamel_sync_logs';

export const useSyncQueue = () => {
  const [queue, setQueue] = useState<SyncQueueItem[]>(() => {
    const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [syncLogs, setSyncLogs] = useState<any[]>(() => {
    const saved = localStorage.getItem(LOGS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [isNetworkAvailable, setIsNetworkAvailable] = useState(isOnline());

  const verifyServer = useCallback(async () => {
    if (!isSyncedMode()) {
      setIsNetworkAvailable(false);
      return false;
    }
    if (!navigator.onLine) {
      setIsNetworkAvailable(false);
      return false;
    }
    const ok = await checkServerConnection().catch(() => false);
    setIsNetworkAvailable(!!ok);
    return !!ok;
  }, []);

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(syncLogs));
  }, [syncLogs]);

  useEffect(() => {
    if (!isSyncedMode()) return;
    const handleOnline = () => {
        verifyServer().then((ok) => {
          if (ok) setTimeout(() => processQueue(), 500);
        });
    };
    const handleOffline = () => setIsNetworkAvailable(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const addToQueue = (endpoint: string, method: 'POST' | 'PUT' | 'DELETE', payload: any, delta?: any) => {
    if (!isSyncedMode()) return;
    const newItem: SyncQueueItem = {
      id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      endpoint,
      method,
      payload,
      delta,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0
    };

    setQueue(prev => [...prev, newItem]);
    if (isNetworkAvailable && !isSyncing) {
        setTimeout(processQueue, 500); 
    }
  };

  const logSuccess = (item: SyncQueueItem) => {
      setLastSyncAt(new Date().toISOString());
      const logEntry = {
          id: item.id,
          endpoint: item.endpoint,
          method: item.method,
          syncedAt: Date.now(),
          payloadSummary: JSON.stringify(item.payload).substring(0, 100) + '...'
      };
      setSyncLogs(prev => [logEntry, ...prev].slice(0, 50));
  };

  const processQueue = useCallback(async () => {
    if (!isSyncedMode()) return;
    if (isSyncing) return;
    const ok = await verifyServer();
    if (!ok) return;

    const savedQueue = localStorage.getItem(QUEUE_STORAGE_KEY);
    const currentQueue: SyncQueueItem[] = savedQueue ? JSON.parse(savedQueue) : [];

    if (currentQueue.length === 0) return;

    setIsSyncing(true);
    const failedItems: SyncQueueItem[] = [];
    const successIds: string[] = [];

    currentQueue.sort((a, b) => a.createdAt - b.createdAt);

    for (const item of currentQueue) {
        if (successIds.includes(item.id)) continue;

        try {
            setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'syncing' } : i));

            await apiRequest(item.endpoint, {
                method: item.method,
                body: JSON.stringify(item.payload),
                headers: {
                    'X-Sync-ID': item.id,
                    'X-Is-Sync-Retry': item.retryCount > 0 ? 'true' : 'false'
                }
            });

            successIds.push(item.id);
            logSuccess(item);

        } catch (error: any) {
            if (error instanceof NetworkError || error.name === 'NetworkError') {
                setIsNetworkAvailable(false);
                failedItems.push({
                    ...item,
                    status: 'pending',
                    retryCount: (item.retryCount || 0) + 1,
                    lastError: error.message
                });
                break; 
            } else {
                failedItems.push({
                    ...item,
                    status: 'failed',
                    lastError: error.message || 'Unknown Error'
                });
            }
        }
    }

    setQueue(prev => {
        const remaining = prev.filter(i => !successIds.includes(i.id));
        return remaining.map(i => {
            const updated = failedItems.find(f => f.id === i.id);
            return updated || i;
        });
    });

    setIsSyncing(false);
  }, [isSyncing, verifyServer]);

  useEffect(() => {
    if (!isSyncedMode()) return;
    if (isNetworkAvailable && queue.length === 0) return;
    const id = window.setInterval(() => {
      verifyServer().then((ok) => {
        if (ok && queue.length > 0) processQueue();
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, [isNetworkAvailable, queue.length, verifyServer, processQueue]);

  const performOfflineAction = async (endpoint: string, method: 'POST' | 'PUT' | 'DELETE', payload: any): Promise<{ success: boolean, queued: boolean }> => {
      if (!isSyncedMode()) {
          await apiRequest(endpoint, { method, body: JSON.stringify(payload) });
          return { success: true, queued: false };
      }
      try {
          await apiRequest(endpoint, { method, body: JSON.stringify(payload) });
          return { success: true, queued: false };
      } catch (error: any) {
          if (error instanceof NetworkError || error.name === 'NetworkError' || error.message === 'OFFLINE_ACTION_REQUIRED') {
              addToQueue(endpoint, method, payload);
              return { success: true, queued: true };
          }
          throw error;
      }
  };

  const clearLogs = () => setSyncLogs([]);

  return {
    queue,
    syncLogs,
    isSyncing,
    isNetworkAvailable,
    addToQueue,
    processQueue,
    performOfflineAction,
    clearLogs
  };
};
