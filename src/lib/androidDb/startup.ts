import { Capacitor } from '@capacitor/core';
import { getAndroidDb } from './database';

export type AndroidDbStartupStatus = 'idle' | 'initializing' | 'ready' | 'failed' | 'skipped';

export type AndroidDbStartupState = {
  platform: 'android' | 'non_android';
  status: AndroidDbStartupStatus;
  initializedAt: string | null;
  error: {
    message: string;
    stack?: string;
  } | null;
};

type Subscriber = (state: AndroidDbStartupState) => void;

const subscribers = new Set<Subscriber>();
let initPromise: Promise<AndroidDbStartupState> | null = null;

const isAndroidCapacitorRuntime = () => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
};

let state: AndroidDbStartupState = {
  platform: isAndroidCapacitorRuntime() ? 'android' : 'non_android',
  status: isAndroidCapacitorRuntime() ? 'idle' : 'skipped',
  initializedAt: null,
  error: null,
};

const log = (event: string, payload?: Record<string, unknown>) => {
  if (payload) {
    console.info(`[android-db-startup] ${event}`, payload);
    return;
  }
  console.info(`[android-db-startup] ${event}`);
};

const emit = () => {
  for (const subscriber of subscribers) {
    try {
      subscriber(state);
    } catch (error) {
      console.error('[android-db-startup] subscriber failed', error);
    }
  }
};

const setState = (next: Partial<AndroidDbStartupState>) => {
  state = { ...state, ...next };
  emit();
};

export const getAndroidDbStartupState = () => state;

export const subscribeAndroidDbStartup = (listener: Subscriber) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};

export const initializeAndroidDbStartup = async () => {
  if (!isAndroidCapacitorRuntime()) {
    setState({
      platform: 'non_android',
      status: 'skipped',
      initializedAt: null,
      error: null,
    });
    return state;
  }

  if (state.status === 'ready') {
    return state;
  }

  if (!initPromise) {
    setState({
      platform: 'android',
      status: 'initializing',
      error: null,
    });
    log('initialization_started');

    initPromise = (async () => {
      try {
        await getAndroidDb();
        const initializedAt = new Date().toISOString();
        setState({
          platform: 'android',
          status: 'ready',
          initializedAt,
          error: null,
        });
        log('initialization_completed', { initializedAt });
        return state;
      } catch (error: any) {
        const message = String(error?.message || error || 'Unknown Android DB bootstrap error');
        setState({
          platform: 'android',
          status: 'failed',
          initializedAt: null,
          error: {
            message,
            stack: typeof error?.stack === 'string' ? error.stack : undefined,
          },
        });
        console.error('[android-db-startup] initialization_failed', {
          message,
          stack: error?.stack,
        });
        return state;
      } finally {
        initPromise = null;
      }
    })();
  }

  return initPromise;
};

export const retryAndroidDbStartup = async () => {
  setState({
    platform: isAndroidCapacitorRuntime() ? 'android' : 'non_android',
    status: isAndroidCapacitorRuntime() ? 'idle' : 'skipped',
    initializedAt: null,
    error: null,
  });
  return initializeAndroidDbStartup();
};

export const waitForAndroidDbReady = async () => {
  const current = await initializeAndroidDbStartup();
  if (current.platform === 'android' && current.status !== 'ready') {
    throw new Error(current.error?.message || 'Android DB is not ready');
  }
  return current;
};
