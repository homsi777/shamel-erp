import type { Partner, PartnerTransaction } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const partnerRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM partners ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Partner);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM partners WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? (JSON.parse(rows[0].payload_json) as Partner) : null;
  },

  async upsert(partner: Partner) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO partners
      (id, name, type, percentage, capital_amount, current_balance, linked_client_id, status, join_date, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partner.id,
        partner.name || '',
        partner.type || 'capital',
        Number(partner.percentage || 0),
        Number(partner.capitalAmount || 0),
        Number(partner.currentBalance || 0),
        partner.linkedClientId || null,
        partner.status || 'active',
        partner.joinDate || timestamp,
        JSON.stringify(partner),
        timestamp,
      ],
    );
    return partner;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM partner_transactions WHERE partner_id = ?`, [id]);
    await runStatement(`DELETE FROM partners WHERE id = ?`, [id]);
  },

  async listTransactions() {
    const rows = await queryRows<any>(`SELECT payload_json FROM partner_transactions ORDER BY date DESC, created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json) as PartnerTransaction);
  },

  async addTransaction(transaction: PartnerTransaction) {
    const timestamp = nowIso();
    const payload = { ...transaction, date: transaction.date || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO partner_transactions
      (id, partner_id, partner_name, type, amount, date, related_voucher_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.partnerId,
        payload.partnerName || '',
        payload.type,
        Number(payload.amount || 0),
        payload.date,
        payload.relatedVoucherId || null,
        JSON.stringify(payload),
        timestamp,
      ],
    );
    return payload;
  },
};
