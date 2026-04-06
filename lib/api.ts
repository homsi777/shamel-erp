
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { Capacitor } from '@capacitor/core';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const isNative = Capacitor.isNativePlatform();

const getInitialBaseUrl = () => {
    const saved = localStorage.getItem('naseej_api_url');
    if (saved) return saved;

    // Use 127.0.0.1 for local Electron to bypass potential localhost resolution issues
    if (isElectron) return 'http://127.0.0.1:3333/api';
    return isNative ? '' : '/api';
};

export const API_CONFIG = {
  baseUrl: getInitialBaseUrl(),
  timeout: 15000,
};

console.log(`🔌 Initializing API with Base URL: ${API_CONFIG.baseUrl || 'Auto (relative)'}`);

const apiClient = axios.create({
  baseURL: API_CONFIG.baseUrl,
  timeout: API_CONFIG.timeout,
});

axiosRetry(apiClient, { 
  retries: 3, 
  retryDelay: (count) => count * 1000,
  retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED'
});

export const setApiUrl = (ip: string) => {
  let url = ip.trim();
  if (url && !url.startsWith('http')) url = `http://${url}`;
  if (url && !url.includes(':')) url = `${url}:3333`;
  if (url && !url.endsWith('/api')) url = `${url}/api`;
  
  API_CONFIG.baseUrl = url;
  localStorage.setItem('naseej_api_url', url);
  apiClient.defaults.baseURL = url;
  console.log(`📡 API URL Updated to: ${url}`);
};

export const getStoredServerIP = () => {
    const url = localStorage.getItem('naseej_api_url');
    return url ? url.replace('http://', '').replace('/api', '').replace(':3333', '') : '';
};

export const getToken = () => localStorage.getItem('naseej_token');
export const setToken = (token: string) => localStorage.setItem('naseej_token', token);
export const logout = () => {
  localStorage.removeItem('naseej_token');
  window.location.reload();
};

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export const checkServerConnection = async (ip?: string): Promise<boolean> => {
    const baseUrl = ip ? (ip.includes(':') ? `http://${ip}/api` : `http://${ip}:3333/api`) : API_CONFIG.baseUrl;
    const testUrl = `${baseUrl.replace('/api', '')}/api/system/status`;
    
    try {
        const response = await axios.get(testUrl, { timeout: 4000 });
        return response.status === 200;
    } catch (e) {
        return false;
    }
};

export const apiRequest = async (endpoint: string, options: any = {}) => {
  const token = getToken();
  const config = {
    method: options.method || 'GET',
    url: endpoint,
    headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    },
    data: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined,
  };

  try {
    const response = await apiClient(config);
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 401 && !endpoint.includes('login')) {
      logout();
    }
    throw error;
  }
};
