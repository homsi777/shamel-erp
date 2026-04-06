import type { Employee, SalaryTransaction } from '../../../types';
import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const employeeRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM employees ORDER BY join_date DESC, name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json) as Employee);
  },

  async findById(id: string) {
    const rows = await queryRows<any>(`SELECT payload_json FROM employees WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? (JSON.parse(rows[0].payload_json) as Employee) : null;
  },

  async upsert(employee: Employee) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO employees
      (id, name, phone, position, currency, base_salary, status, join_date, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee.id,
        employee.name || '',
        employee.phone || '',
        employee.position || '',
        employee.currency || 'USD',
        Number(employee.baseSalary || 0),
        employee.status || 'active',
        employee.joinDate || timestamp,
        JSON.stringify(employee),
        timestamp,
      ],
    );
    return employee;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM salary_transactions WHERE employee_id = ?`, [id]);
    await runStatement(`DELETE FROM employees WHERE id = ?`, [id]);
  },

  async listSalaryTransactions() {
    const rows = await queryRows<any>(`SELECT payload_json FROM salary_transactions ORDER BY date DESC, created_at DESC`);
    return rows.map((row) => JSON.parse(row.payload_json) as SalaryTransaction);
  },

  async addSalaryTransaction(transaction: SalaryTransaction) {
    const timestamp = nowIso();
    const payload = { ...transaction, date: transaction.date || timestamp };
    await runStatement(
      `INSERT OR REPLACE INTO salary_transactions
      (id, employee_id, employee_name, amount, currency, type, period, cash_box_id, date, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.employeeId,
        payload.employeeName || '',
        Number(payload.amount || 0),
        payload.currency || 'USD',
        payload.type,
        payload.period || null,
        payload.cashBoxId || null,
        payload.date,
        JSON.stringify(payload),
        timestamp,
      ],
    );
    return payload;
  },
};
