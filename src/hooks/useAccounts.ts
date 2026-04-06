import { useCallback, useEffect, useState } from 'react';
import { Account } from '../types';
import { apiRequest } from '../lib/api';
import { extractAccountsFromResponse } from '../lib/accounts-response';

export const useAccounts = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest('accounts');
      setAccounts(extractAccountsFromResponse(data));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { accounts, isLoading, reload: load };
};
