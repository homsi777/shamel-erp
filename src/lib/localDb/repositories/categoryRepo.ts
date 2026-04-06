import { queryRows, runStatement } from '../database';
import { nowIso } from './helpers';

export const categoryRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM categories ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async upsert(category: any) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO categories (id, name, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
      [category.id, category.name || '', JSON.stringify(category), timestamp],
    );
    return category;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM categories WHERE id = ?`, [id]);
  },
};

export const subCategoryRepo = {
  async list() {
    const rows = await queryRows<any>(`SELECT payload_json FROM sub_categories ORDER BY name ASC`);
    return rows.map((row) => JSON.parse(row.payload_json));
  },

  async upsert(subCategory: any) {
    const timestamp = nowIso();
    await runStatement(
      `INSERT OR REPLACE INTO sub_categories (id, category_id, name, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [subCategory.id, subCategory.categoryId || null, subCategory.name || '', JSON.stringify(subCategory), timestamp],
    );
    return subCategory;
  },

  async delete(id: string) {
    await runStatement(`DELETE FROM sub_categories WHERE id = ?`, [id]);
  },
};
