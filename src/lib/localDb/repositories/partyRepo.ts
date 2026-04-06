import type { Party } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const partyRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM parties ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Party);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM parties WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? (JSON.parse(rows[0].payload_json) as Party) : null;
  },

  async upsert(party: Party) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO parties (id, name, type, phone, balance, is_active, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        party.id,
        party.name || '',
        party.type || 'CUSTOMER',
        party.phone || '',
        Number(party.balance || 0),
        party.isActive === false ? 0 : 1,
        JSON.stringify(party),
        timestamp,
      ],
    );
    return party;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM parties WHERE id = ?`, [id]);
  },

  async listTransactions() {
    const rows = await queryRows<any>(`SELECT payload_json FROM party_transactions ORDER BY created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async listTransactionsByParty(partyId: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM party_transactions WHERE party_id = ? ORDER BY created_at ASC`, [partyId]);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async addTransaction(payload: any) {
    const createdAt = payload.createdAt || nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO party_transactions (id, party_id, party_name, reference_type, reference_id, amount, currency, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.partyId,
        payload.partyName || '',
        payload.referenceType || null,
        payload.referenceId || null,
        Number(payload.amount || 0),
        payload.currency || 'USD',
        JSON.stringify({ ...payload, createdAt }),
        createdAt,
      ],
    );
  },

  async deleteTransactionsByReference(referenceType: string, referenceId: string) {
    await runStatement(`DELETE FROM party_transactions WHERE reference_type = ? AND reference_id = ?`, [referenceType, referenceId]);
  },

  async listTransfers() {
    const rows = await queryRows<any>(`SELECT payload_json FROM party_transfers ORDER BY created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async addTransfer(payload: any) {
    const createdAt = payload.createdAt || nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO party_transfers (id, from_party_id, to_party_id, amount, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.fromPartyId || null,
        payload.toPartyId || null,
        Number(payload.amount || 0),
        JSON.stringify({ ...payload, createdAt }),
        createdAt,
      ],
    );
  },
};
