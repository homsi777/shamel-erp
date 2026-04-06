import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const runtimeRepo = {
  async get(key: string) {
    const rows = await queryRows<{ value_json: string }>(`SELECT value_json FROM runtime_meta WHERE key = ? LIMIT 1`, [key]);
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json);
  },

  async set(key: string, value: any) {
    await runStatement(
      `INSERT OR REPLACE INTO runtime_meta (key, value_json, updated_at) VALUES (?, ?, ?)`,
      [key, JSON.stringify(value), nowIso()],
    );
  },
};
