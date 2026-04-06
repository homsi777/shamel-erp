import { Capacitor } from '@capacitor/core';

/**
 * Desktop Electron shell (packaged file://, dev with preload, or Electron user agent).
 */
export function isElectronClient(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'file:') return true;
  if ((window as unknown as { electronAPI?: unknown }).electronAPI) return true;
  return navigator.userAgent.toLowerCase().includes('electron');
}

export function isBrowserClient(): boolean {
  return typeof window !== 'undefined' && window.location.protocol.startsWith('http');
}

/** Capacitor iOS/Android — not a LAN web browser tab */
export function isCapacitorNativeClient(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Chrome/Safari/Edge (etc.) loading the app over http(s), e.g. LAN http://192.168.x.x:3111/.
 * Excludes Electron and native Capacitor so setup/activation flows stay on those clients.
 */
export function isWebBrowserClient(): boolean {
  if (typeof window === 'undefined') return false;
  if (isElectronClient()) return false;
  if (isCapacitorNativeClient()) return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export function getClientType(): 'electron' | 'browser' | 'unknown' {
  if (isElectronClient()) return 'electron';
  if (isWebBrowserClient()) return 'browser';
  if (isBrowserClient()) return 'browser';
  return 'unknown';
}
