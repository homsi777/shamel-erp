import type { Invoice } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const invoiceRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM invoices ORDER BY date DESC, created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Invoice);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM invoices WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? (JSON.parse(rows[0].payload_json) as Invoice) : null;
  },

  async upsert(invoice: Invoice) {
    const timestamp = nowIso();
    const payload = { ...invoice, createdAt: invoice.createdAt || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO invoices
      (id, invoice_number, type, status, client_id, client_name, date, payment_type, currency, total_amount, paid_amount, remaining_amount, target_warehouse_id, target_warehouse_name, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM invoices WHERE id = ?), ?), ?)`,
      [
        payload.id,
        payload.invoiceNumber || '',
        payload.type || 'sale',
        payload.status || 'draft',
        payload.clientId || null,
        payload.clientName || '',
        payload.date,
        payload.paymentType || 'cash',
        payload.currency || 'USD',
        Number(payload.totalAmount || 0),
        Number(payload.paidAmount || 0),
        Number(payload.remainingAmount || 0),
        payload.targetWarehouseId || null,
        payload.targetWarehouseName || null,
        JSON.stringify(payload),
        payload.id,
        payload.createdAt || timestamp,
        timestamp,
      ],
    );

    await runStatement(`DELETE FROM invoice_items WHERE invoice_id = ?`, [payload.id]);
    for (const [index, item] of (payload.items || []).entries()) {
      await runStatement(
        `INSERT INTO invoice_items (id, invoice_id, item_id, item_name, quantity, unit_price, total, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${payload.id}-${index + 1}`,
          payload.id,
          item.itemId || null,
          item.itemName || '',
          Number(item.quantity || 0),
          Number(item.unitPrice || 0),
          Number(item.total || 0),
          JSON.stringify(item),
        ],
      );
    }

    return payload;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM invoice_items WHERE invoice_id = ?`, [id]);
    await runStatement(`DELETE FROM invoices WHERE id = ?`, [id]);
  },
};
