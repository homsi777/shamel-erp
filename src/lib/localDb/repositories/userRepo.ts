import type { AppUser } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export interface LocalUserRecord extends AppUser {
  password: string;
}

const mapUser = (row: any): LocalUserRecord => ({
  id: row.id,
  username: row.username,
  password: row.password,
  name: row.name,
  role: row.role,
  permissions: JSON.parse(row.permissions_json || '[]'),
  posWarehouseId: row.pos_warehouse_id || undefined,
  posWarehouseName: row.pos_warehouse_name || undefined,
});

export const userRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT * FROM users ORDER BY created_at ASC`);
    return rows.map(mapUser);
  },

  async findByCredentials(username: string, password: string) {
    const rows = await queryRows<any>(
      `SELECT * FROM users WHERE username = ? AND password = ? LIMIT 1`,
      [username, password],
    );
    return rows[0] ? mapUser(rows[0]) : null;
  },

  async upsert(user: LocalUserRecord) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO users
      (id, username, password, name, role, permissions_json, pos_warehouse_id, pos_warehouse_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM users WHERE id = ?), ?), ?)`,
      [
        user.id,
        user.username,
        user.password,
        user.name,
        user.role,
        JSON.stringify(user.permissions || []),
        user.posWarehouseId || null,
        user.posWarehouseName || null,
        user.id,
        timestamp,
        timestamp,
      ],
    );
    return user;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM users WHERE id = ?`, [id]);
  },
};
