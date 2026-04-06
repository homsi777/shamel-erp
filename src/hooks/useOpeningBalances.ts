import { useMemo, useState } from 'react';
import { Currency, OpeningAccountType, OpeningBalanceLine, CurrencyBalance } from '../types';

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyLine = (): OpeningBalanceLine => ({
  id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  account_type: 'customer',
  account_id: null,
  account_name: '',
  debit: 0,
  credit: 0,
  currency: 'USD',
  notes: ''
});

export const useOpeningBalances = () => {
  const [lines, setLines] = useState<OpeningBalanceLine[]>([emptyLine()]);
  const [fiscalYear, setFiscalYear] = useState('2026');
  const [entryDate, setEntryDate] = useState(todayIso());
  const [entryNumber, setEntryNumber] = useState('OE-2026-001');
  const [description, setDescription] = useState('');

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id: string, field: keyof OpeningBalanceLine, value: any) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  };

  const totals = useMemo(() => {
    const totalsByCurrency = {
      USD: { debit: 0, credit: 0 },
      SYP: { debit: 0, credit: 0 },
      TRY: { debit: 0, credit: 0 }
    } as Record<Currency, { debit: number; credit: number }>;

    lines.forEach((line) => {
      totalsByCurrency[line.currency].debit += Number(line.debit) || 0;
      totalsByCurrency[line.currency].credit += Number(line.credit) || 0;
    });

    const balances: CurrencyBalance[] = (['USD', 'SYP', 'TRY'] as Currency[]).map((currency) => {
      const debit = totalsByCurrency[currency].debit;
      const credit = totalsByCurrency[currency].credit;
      const isUsed = debit > 0 || credit > 0;
      const diff = Number((debit - credit).toFixed(2));
      return {
        currency,
        total_debit: debit,
        total_credit: credit,
        difference: diff,
        is_balanced: !isUsed || diff === 0,
        is_used: isUsed
      };
    });

    return balances;
  }, [lines]);

  const hasInvalidLines = useMemo(() => {
    return lines.some((line) => {
      const hasDebit = Number(line.debit) > 0;
      const hasCredit = Number(line.credit) > 0;
      if (hasDebit && hasCredit) return true;
      if (!hasDebit && !hasCredit) return true;
      return false;
    });
  }, [lines]);

  const canPost = useMemo(() => {
    // لا نتحقق من التوازن - النظام يوازن تلقائياً في الخلفية
    const hasValidLines = lines.some((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
    return hasValidLines && !hasInvalidLines;
  }, [lines, hasInvalidLines]);

  const header = { fiscalYear, entryDate, entryNumber, description };

  return {
    lines,
    setLines,
    header,
    setFiscalYear,
    setEntryDate,
    setEntryNumber,
    setDescription,
    addLine,
    removeLine,
    updateLine,
    totals,
    canPost,
    hasInvalidLines
  };
};

export type { OpeningAccountType };
