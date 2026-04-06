import { queryRows, runStatement } from '../database';

export const nowIso = () => new Date().toISOString();

export const toJson = (value: any) => JSON.stringify(value);
export const fromJson = <T,>(value: any, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

export const mapPayloadRows = <T,>(rows: Array<{ payload_json: string }>) => {
  return rows.map((row) => fromJson<T>(row.payload_json, {} as T));
};

export const listPayloadTable = async <T,>(table: string, orderBy = 'updated_at DESC') => {
  const rows = await queryRows<{ payload_json: string }>(`SELECT payload_json FROM ${table} ORDER BY ${orderBy}`);
  return mapPayloadRows<T>(rows);
};

export const findPayloadById = async <T,>(table: string, id: string | number) => {
  const rows = await queryRows<{ payload_json: string }>(`SELECT payload_json FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  if (!rows[0]) return null;
  return fromJson<T>(rows[0].payload_json, {} as T);
};

export const deleteById = async (table: string, id: string | number) => {
  await runStatement(`DELETE FROM ${table} WHERE id = ?`, [id]);
};
