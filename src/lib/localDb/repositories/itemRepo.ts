import type { InventoryItem } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

const mapItem = (row: any) => JSON.parse(row.payload_json) as InventoryItem;

export const itemRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM items ORDER BY updated_at DESC`);
    return rows.map(mapItem);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM items WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? mapItem(rows[0]) : null;
  },

  async upsert(item: InventoryItem) {
    const timestamp = nowIso();
    const payload = { ...item, lastUpdated: item.lastUpdated || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO items
      (id, name, code, warehouse_id, warehouse_name, category_id, sub_category_id, unit_id, unit_name, quantity, cost_price, sale_price, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.name,
        payload.code || '',
        payload.warehouseId || null,
        payload.warehouseName || null,
        payload.categoryId || null,
        payload.subCategoryId || null,
        payload.unitId || null,
        payload.unitName || null,
        Number(payload.quantity || 0),
        Number(payload.costPrice || 0),
        Number(payload.salePrice || 0),
        JSON.stringify(payload),
        timestamp,
      ],
    );
    return payload;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM items WHERE id = ?`, [id]);
  },
};
