import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

export type JournalEntry = {
  id: number;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string;
  referenceId?: number | null;
  totalDebit: number;
  totalCredit: number;
  currencyCode?: string;
  status: 'draft' | 'posted' | 'cancelled';
  createdAt?: string;
  postedAt?: string;
};

export const useJournalEntries = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest('journal-entries');
      setEntries(data || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { entries, isLoading, reload: load };
};
