import React, { useMemo } from 'react';
import Combobox from './Combobox';
import { Account, AccountType } from '../types';

type AccountPickerProps = {
  accounts: Account[];
  value: number | '';
  onChange: (accountId: number | '') => void;
  placeholder?: string;
  filterType?: AccountType;
  allowParent?: boolean;
};

const flattenAccounts = (accounts: Account[], parentId: number | null, level: number, allowParent: boolean) => {
  const rows: Account[] = [];
  const children = accounts
    .filter(a => a.parentId === parentId)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  for (const acc of children) {
    if (allowParent || !acc.isParent) rows.push({ ...acc, level });
    rows.push(...flattenAccounts(accounts, acc.id, level + 1, allowParent));
  }
  return rows;
};

const AccountPicker: React.FC<AccountPickerProps> = ({
  accounts,
  value,
  onChange,
  placeholder = 'اختر حسابًا...',
  filterType,
  allowParent = false,
}) => {
  const list = useMemo(() => {
    const filtered = filterType ? accounts.filter(a => a.accountType === filterType) : accounts;
    return flattenAccounts(filtered, null, 1, allowParent).map(acc => {
      const prefix = acc.level && acc.level > 1 ? `${'--'.repeat(acc.level - 1)} ` : '';
      return {
        id: String(acc.id),
        label: `${prefix}${acc.nameAr}`,
        subLabel: acc.code
      };
    });
  }, [accounts, filterType, allowParent]);

  return (
    <Combobox
      items={list}
      selectedId={value ? String(value) : ''}
      onSelect={(id) => onChange(id ? Number(id) : '')}
      placeholder={placeholder}
    />
  );
};

export default AccountPicker;
