export const formatAccountingNumber = (value: number, currencyCode = 'SYP'): string => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || Math.abs(num) < 0.000001) return '—';

  const formatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  if (num < 0) return `(${formatted})`;
  return formatted;
};

export const formatSignedAccountingNumber = (value: number): string => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || Math.abs(num) < 0.000001) return '0';
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export const accountingNumberClass = (value: number): string => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || Math.abs(num) < 0.000001) return 'text-gray-400';
  if (num < 0) return 'text-red-600';
  return 'text-gray-800';
};

export const formatPercent = (value: number): string => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(1)}%`;
};
