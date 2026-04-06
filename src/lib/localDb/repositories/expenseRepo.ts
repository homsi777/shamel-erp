import type { Expense } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const expenseRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM expenses ORDER BY date DESC, created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Expense);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM expenses WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? (JSON.parse(rows[0].payload_json) as Expense) : null;
  },

  async upsert(expense: Expense) {
    const timestamp = nowIso();
    const payload = { ...expense, createdAt: expense.createdAt || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO expenses
      (id, code, date, description, total_amount, currency, payment_type, cash_box_id, warehouse_id, status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM expenses WHERE id = ?), ?), ?)`,
      [
        payload.id,
        payload.code || '',
        payload.date,
        payload.description || '',
        Number(payload.totalAmount || 0),
        payload.currency || 'USD',
        payload.paymentType || 'CASH',
        payload.cashBoxId || null,
        payload.warehouseId || null,
        payload.status || 'DRAFT',
        JSON.stringify(payload),
        payload.id,
        payload.createdAt || timestamp,
        timestamp,
      ],
    );

    await runStatement(`DELETE FROM expense_lines WHERE expense_id = ?`, [payload.id]);
    for (const [index, line] of (payload.lines || []).entries()) {
      await runStatement(
        `INSERT INTO expense_lines (id, expense_id, account_id, account_name, amount, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          line.id || `${payload.id}-${index + 1}`,
          payload.id,
          line.accountId || null,
          line.accountName || '',
          Number(line.amount || 0),
          JSON.stringify(line),
        ],
      );
    }

    return payload;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM expense_lines WHERE expense_id = ?`, [id]);
    await runStatement(`DELETE FROM expenses WHERE id = ?`, [id]);
  },
};
