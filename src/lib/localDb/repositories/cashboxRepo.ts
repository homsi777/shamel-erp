import type { CashBox } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const cashboxRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM cashboxes ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as CashBox);
  },

  async upsert(cashbox: CashBox) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO cashboxes (id, name, type, currency, balance, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cashbox.id, cashbox.name || '', cashbox.type || 'main', cashbox.currency || 'USD', Number(cashbox.balance || 0), JSON.stringify(cashbox), timestamp],
    );
    return cashbox;
  },

  async updateBalance(id: string, nextBalance: number) {
    const rows = await queryRows<any>(`SELECT payload_json FROM cashboxes WHERE id = ? LIMIT 1`, [id]);
    if (!rows[0]) return null;
    const cashbox = JSON.parse(rows[0].payload_json) as CashBox;
    return this.upsert({ ...cashbox, balance: nextBalance });
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM cashboxes WHERE id = ?`, [id]);
  },
};
