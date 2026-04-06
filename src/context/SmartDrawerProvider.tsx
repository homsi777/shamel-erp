/**
 * Smart Drawer Context Provider
 * نظام البطاقة الذكية - Context
 */
import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import { 
  SmartDrawerState, 
  SmartDrawerContextValue, 
  SmartOpenPayload,
  SmartQuickViewResponse
} from '../types/smart';
import { apiRequest } from '../lib/api';

const initialState: SmartDrawerState = {
  isOpen: false,
  isLoading: false,
  error: null,
  payload: null,
  data: null,
};

type Action =
  | { type: 'OPEN'; payload: SmartOpenPayload }
  | { type: 'LOADING' }
  | { type: 'SUCCESS'; data: SmartQuickViewResponse }
  | { type: 'ERROR'; error: string }
  | { type: 'CLOSE' };

function reducer(state: SmartDrawerState, action: Action): SmartDrawerState {
  switch (action.type) {
    case 'OPEN':
      return {
        ...state,
        isOpen: true,
        isLoading: true,
        error: null,
        payload: action.payload,
        data: null,
      };
    case 'LOADING':
      return { ...state, isLoading: true, error: null };
    case 'SUCCESS':
      return { ...state, isLoading: false, data: action.data, error: null };
    case 'ERROR':
      return { ...state, isLoading: false, error: action.error };
    case 'CLOSE':
      return initialState;
    default:
      return state;
  }
}

const SmartDrawerContext = createContext<SmartDrawerContextValue | null>(null);

export const SmartDrawerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const fetchQuickView = useCallback(async (payload: SmartOpenPayload, requestId: number) => {
    try {
      // Build query params from meta
      const params = new URLSearchParams();
      if (payload.meta) {
        Object.entries(payload.meta).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, String(value));
          }
        });
      }
      const queryString = params.toString();
      const url = `smart/quickview/${payload.type}/${encodeURIComponent(payload.id)}${queryString ? `?${queryString}` : ''}`;
      
      const result = await apiRequest(url);
      
      // Only update if this is the latest request (prevent race conditions)
      if (requestId === requestIdRef.current) {
        dispatch({ type: 'SUCCESS', data: result });
      }
    } catch (error: any) {
      if (requestId === requestIdRef.current) {
        const message = error?.response?.data?.error || error?.message || 'تعذر تحميل التفاصيل';
        dispatch({ type: 'ERROR', error: message });
      }
    }
  }, []);

  const open = useCallback((payload: SmartOpenPayload) => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    // Increment request ID to handle race conditions
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;
    
    dispatch({ type: 'OPEN', payload });
    fetchQuickView(payload, currentRequestId);
  }, [fetchQuickView]);

  const close = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    dispatch({ type: 'CLOSE' });
  }, []);

  const retry = useCallback(() => {
    if (!state.payload) return;
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;
    dispatch({ type: 'LOADING' });
    fetchQuickView(state.payload, currentRequestId);
  }, [state.payload, fetchQuickView]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const value: SmartDrawerContextValue = {
    state,
    open,
    close,
    retry,
  };

  return (
    <SmartDrawerContext.Provider value={value}>
      {children}
    </SmartDrawerContext.Provider>
  );
};

export const useSmartDrawerContext = (): SmartDrawerContextValue => {
  const context = useContext(SmartDrawerContext);
  if (!context) {
    throw new Error('useSmartDrawerContext must be used within SmartDrawerProvider');
  }
  return context;
};

export default SmartDrawerProvider;
