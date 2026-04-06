import { Account } from '../types';

type AccountsApiPayload = {
  accounts?: Account[];
  usedCurrencies?: string[];
};

export const extractAccountsFromResponse = (payload: unknown): Account[] => {
  if (Array.isArray(payload)) return payload as Account[];
  if (payload && typeof payload === 'object') {
    const maybe = payload as AccountsApiPayload;
    if (Array.isArray(maybe.accounts)) return maybe.accounts;
  }
  return [];
};

export const extractUsedCurrenciesFromResponse = (payload: unknown): string[] => {
  if (!payload || typeof payload !== 'object') return [];
  const maybe = payload as AccountsApiPayload;
  if (!Array.isArray(maybe.usedCurrencies)) return [];
  return maybe.usedCurrencies.filter((c) => typeof c === 'string' && c.trim().length > 0);
};
