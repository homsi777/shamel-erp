import type { AppSettings } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';
import { normalizeSettingValue } from '../../../../backend/lib/settings';

export const settingsRepo = {
  async listRows() {
    return queryRows<{ key: string; value_json: string }>(`SELECT key, value_json FROM settings ORDER BY key ASC`);
  },

  async getValue<T = any>(key: string) {
    const rows = await queryRows<{ value_json: string }>(`SELECT value_json FROM settings WHERE key = ? LIMIT 1`, [key]);
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as T;
  },

  async setValue(key: string, value: any) {
    const normalizedValue = normalizeSettingValue(String(key || ''), value);
    await runStatement(
      `INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
      [key, JSON.stringify(normalizedValue), nowIso()],
    );
  },

  async getAppSettings(): Promise<AppSettings | null> {
    const rows = await this.listRows();
    if (!rows.length) return null;
    const map = new Map(rows.map((row) => [row.key, JSON.parse(row.value_json)]));
    return {
      company: map.get('company'),
      theme: map.get('theme'),
      print: map.get('print'),
      labels: map.get('labels'),
      lowStockThreshold: Number(map.get('lowStockThreshold') ?? 5),
      registeredDevices: map.get('registeredDevices') || [],
      currencyRates: map.get('currencyRates'),
      defaultCurrency: map.get('defaultCurrency') || map.get('primaryCurrency') || 'USD',
    };
  },
};
