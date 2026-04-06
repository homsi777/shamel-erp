import type { Voucher } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const voucherRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM vouchers ORDER BY date DESC, created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Voucher);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM vouchers WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? (JSON.parse(rows[0].payload_json) as Voucher) : null;
  },

  async upsert(voucher: Voucher) {
    const timestamp = nowIso();
    const payload = { ...voucher, createdAt: voucher.createdAt || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO vouchers
      (id, type, status, date, amount, cashbox_id, client_id, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM vouchers WHERE id = ?), ?), ?)`,
      [
        payload.id,
        payload.type,
        payload.status || 'DRAFT',
        payload.date,
        Number(payload.amount || 0),
        payload.cashBoxId || null,
        payload.clientId || null,
        JSON.stringify(payload),
        payload.id,
        payload.createdAt || timestamp,
        timestamp,
      ],
    );
    return payload;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM vouchers WHERE id = ?`, [id]);
  },
};
