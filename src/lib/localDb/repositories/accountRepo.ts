import type { Account } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const accountRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM accounts ORDER BY code ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Account);
  },

  async upsert(account: Account) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO accounts
      (id, code, name_ar, name_en, parent_id, level, account_type, account_nature, is_parent, is_active, is_system, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(account.id),
        account.code || '',
        account.nameAr || '',
        account.nameEn || null,
        account.parentId ?? null,
        Number(account.level || 1),
        account.accountType,
        account.accountNature,
        account.isParent ? 1 : 0,
        account.isActive === false ? 0 : 1,
        account.isSystem ? 1 : 0,
        JSON.stringify(account),
        timestamp,
      ],
    );
    return account;
  },

  async delete(id: number) {
    await runStatement(`DELETE FROM accounts WHERE id = ?`, [id]);
  },

  async listStatement(accountId: number) {
    const accounts = await this.list();
    const targetIds = new Set<number>([Number(accountId)]);
    let expanded = true;

    while (expanded) {
      expanded = false;
      for (const account of accounts) {
        const parentId = Number(account.parentId || 0);
        const currentId = Number(account.id || 0);
        if (parentId && targetIds.has(parentId) && !targetIds.has(currentId)) {
          targetIds.add(currentId);
          expanded = true;
        }
      }
    }

    const journalLines = await queryRows<any>(
      `SELECT journal_entry_id, account_id, debit, credit, currency_code, amount_in_currency, description
       FROM journal_entry_lines
       ORDER BY journal_entry_id ASC, id ASC`,
    );
    const journalEntries = await queryRows<any>(
      `SELECT id, entry_number, entry_date, description, reference_type, reference_id, status
       FROM journal_entries
       ORDER BY entry_date ASC, id ASC`,
    );
    const entryMap = new Map<number, any>(journalEntries.map((entry) => [Number(entry.id), entry]));

    const lines: any[] = [];
    let runningBalance = 0;
    for (const line of journalLines) {
      const lineAccountId = Number(line.account_id || 0);
      if (!targetIds.has(lineAccountId)) continue;
      const entry = entryMap.get(Number(line.journal_entry_id || 0));
      if (!entry || String(entry.status || '').toLowerCase() !== 'posted') continue;
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      runningBalance += debit - credit;
      lines.push({
        entryId: Number(entry.id),
        entryNumber: entry.entry_number,
        entryDate: entry.entry_date,
        description: line.description || entry.description || 'حركة محاسبية',
        referenceType: entry.reference_type,
        referenceId: entry.reference_id,
        debit,
        credit,
        runningBalance,
        currencyCode: line.currency_code || 'USD',
        amountInCurrency: Number(line.amount_in_currency || 0),
        accountId: lineAccountId,
      });
    }

    const balance = lines.reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0);
    return {
      lines,
      balance,
      totalDebit: lines.reduce((sum, row) => sum + Number(row.debit || 0), 0),
      totalCredit: lines.reduce((sum, row) => sum + Number(row.credit || 0), 0),
    };
  },
};
