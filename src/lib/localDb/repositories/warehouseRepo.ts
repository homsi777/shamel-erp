import type { Branch, Warehouse } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const warehouseRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM warehouses ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Warehouse);
  },

  async upsert(warehouse: Warehouse) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO warehouses (id, name, location, manager, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [warehouse.id, warehouse.name || '', warehouse.location || '', warehouse.manager || '', JSON.stringify(warehouse), timestamp],
    );
    return warehouse;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM warehouses WHERE id = ?`, [id]);
  },
};

export const branchRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM branches ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Branch);
  },

  async upsert(branch: Branch) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO branches (id, name, location, manager, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [branch.id, branch.name || '', branch.location || '', branch.manager || '', JSON.stringify(branch), timestamp],
    );
    return branch;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM branches WHERE id = ?`, [id]);
  },
};
