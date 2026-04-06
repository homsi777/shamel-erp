import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const transferRepo = {
  async listStockTransfers() {
    const rows = await queryRows<any>(`SELECT payload_json FROM stock_transfers ORDER BY created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async findStockTransferById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM stock_transfers WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? JSON.parse(rows[0].payload_json) : null;
  },

  async addStockTransfer(payload: any) {
    const createdAt = payload.createdAt || nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO stock_transfers (id, item_id, quantity, from_warehouse_id, to_warehouse_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.itemId || null,
        Number(payload.quantity || 0),
        payload.fromWarehouseId || null,
        payload.toWarehouseId || null,
        JSON.stringify({ ...payload, createdAt }),
        createdAt,
      ],
    );
    return { ...payload, createdAt };
  },

  async deleteStockTransfer(id: string) {
    await runStatement(`DELETE FROM stock_transfers WHERE id = ?`, [id]);
  },
};
