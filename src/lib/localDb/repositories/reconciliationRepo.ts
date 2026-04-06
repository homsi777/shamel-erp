import type { ReconciliationMark } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

const mapMark = (row: any): ReconciliationMark => JSON.parse(row.payload_json) as ReconciliationMark;

export const reconciliationRepo = {
  async getLatest(scopeType: ReconciliationMark['scopeType'], scopeId: string, reportType: ReconciliationMark['reportType']) {
    const rows = await queryRows<any>(
      `SELECT payload_json FROM reconciliation_marks WHERE scope_type = ? AND scope_id = ? AND report_type = ? AND is_active = 1 ORDER BY mark_at DESC, created_at DESC LIMIT 1`,
      [scopeType, scopeId, reportType],
    );
    return rows[0] ? mapMark(rows[0]) : null;
  },

  async upsert(mark: ReconciliationMark) {
    const timestamp = nowIso();
    const payload = { ...mark, createdAt: mark.createdAt || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO reconciliation_marks
      (id, scope_type, scope_id, report_type, mark_at, row_ref_id, is_active, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM reconciliation_marks WHERE id = ?), ?), ?)`,
      [
        payload.id,
        payload.scopeType,
        payload.scopeId,
        payload.reportType,
        payload.markAt,
        payload.rowRefId || null,
        payload.isActive === false ? 0 : 1,
        JSON.stringify(payload),
        payload.id,
        payload.createdAt,
        timestamp,
      ],
    );
    return payload;
  },
};
