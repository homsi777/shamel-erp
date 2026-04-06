import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const unitRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM units ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async upsert(unit: any) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO units (id, name, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
      [unit.id, unit.name || '', JSON.stringify(unit), timestamp],
    );
    return unit;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM units WHERE id = ?`, [id]);
  },
};
