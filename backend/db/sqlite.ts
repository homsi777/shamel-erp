
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Single Source of Truth for DB path ───────────────────────────────────────
const getArg = (flag: string) => {
    const idx = (process as any).argv.indexOf(flag);
    return idx > -1 ? (process as any).argv[idx + 1] : null;
};

function resolveDbPath(): string {
    // Priority: CLI arg > DB_PATH env > DB_PATH_FROM_ELECTRON env > auto-detect
    const fromArg = getArg('--dbPath');
    if (fromArg) return fromArg;
    if (process.env.DB_PATH) return process.env.DB_PATH;
    if (process.env.DB_PATH_FROM_ELECTRON) return process.env.DB_PATH_FROM_ELECTRON;

    // Auto-detect: Electron packaged → ~/ShamelERP/data, else → <cwd>/data
    const isElectron = !!(process.versions as any)?.electron || process.env.ELECTRON_IS_PACKAGED;
    const baseDir = isElectron
        ? path.join(os.homedir(), 'ShamelERP', 'data')
        : path.join((process as any).cwd(), 'data');

    return path.join(baseDir, 'shamel.db');
}

let dbPath = resolveDbPath();

// Ensure directory exists (once)
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// ─── Open SQLite ──────────────────────────────────────────────────────────────
let sqlite: Database.Database;
try {
    sqlite = new Database(dbPath, { timeout: 10000 });
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
} catch (e: any) {
    console.error(`❌ CRITICAL: Failed to open database at ${dbPath}: ${e.message}`);

    // Last-resort fallback for Electron
    if (process.env.DB_PATH_FROM_ELECTRON || process.env.ELECTRON_IS_PACKAGED) {
        const fallbackDir = path.join(os.homedir(), 'ShamelERP', 'data');
        if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
        const fallbackPath = path.join(fallbackDir, 'shamel.db');
        console.warn(`🔄 Trying fallback path: ${fallbackPath}`);
        sqlite = new Database(fallbackPath, { timeout: 10000 });
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('foreign_keys = ON');
        dbPath = fallbackPath;
    } else {
        throw e;
    }
}

// ─── Startup diagnostic (once) ────────────────────────────────────────────────
console.log(`📂 DB path: ${dbPath}`);

type ColumnDef = {
    name: string;
    type: 'TEXT' | 'INTEGER' | 'REAL';
    notNull?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    default?: string;
};

type TableDef = {
    name: string;
    columns: ColumnDef[];
};

const TABLES: TableDef[] = [
    {
        name: 'users',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'username', type: 'TEXT', notNull: true, unique: true },
            { name: 'password_hash', type: 'TEXT', notNull: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'role', type: 'TEXT', notNull: true, default: "'warehouse_keeper'" },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'permissions', type: 'TEXT' },
            { name: 'pos_warehouse_id', type: 'TEXT' },
            { name: 'pos_warehouse_name', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'employees',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'phone', type: 'TEXT' },
            { name: 'email', type: 'TEXT' },
            { name: 'id_number', type: 'TEXT' },
            { name: 'birth_date', type: 'TEXT' },
            { name: 'address', type: 'TEXT' },
            { name: 'marital_status', type: 'TEXT' },
            { name: 'biometric_id', type: 'TEXT' },
            { name: 'position', type: 'TEXT' },
            { name: 'base_salary', type: 'REAL', default: '0' },
            { name: 'currency', type: 'TEXT', default: "'USD'" },
            { name: 'salary_frequency', type: 'TEXT', default: "'monthly'" },
            { name: 'education', type: 'TEXT' },
            { name: 'courses', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'image_url', type: 'TEXT' },
            { name: 'id_front_url', type: 'TEXT' },
            { name: 'id_back_url', type: 'TEXT' },
            { name: 'experience', type: 'TEXT' },
            { name: 'status', type: 'TEXT', default: "'active'" },
            { name: 'join_date', type: 'TEXT' },
        ],
    },
    {
        name: 'salary_transactions',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'employee_id', type: 'TEXT', notNull: true },
            { name: 'employee_name', type: 'TEXT' },
            { name: 'amount', type: 'REAL', notNull: true },
            { name: 'currency', type: 'TEXT', default: "'USD'" },
            { name: 'type', type: 'TEXT', notNull: true },
            { name: 'period', type: 'TEXT' },
            { name: 'cash_box_id', type: 'TEXT' },
            { name: 'date', type: 'TEXT', notNull: true },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'biometric_devices',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'ip', type: 'TEXT', notNull: true },
            { name: 'port', type: 'INTEGER', default: '4370' },
            { name: 'location', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'attendance_records',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'device_id', type: 'TEXT' },
            { name: 'device_ip', type: 'TEXT' },
            { name: 'employee_id', type: 'TEXT' },
            { name: 'employee_name', type: 'TEXT' },
            { name: 'biometric_id', type: 'TEXT' },
            { name: 'timestamp', type: 'TEXT', notNull: true },
            { name: 'event_type', type: 'TEXT' },
            { name: 'source', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'parties',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'type', type: 'TEXT', notNull: true },
            { name: 'phone', type: 'TEXT' },
            { name: 'email', type: 'TEXT' },
            { name: 'address', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'tax_no', type: 'TEXT' },
            { name: 'balance', type: 'REAL', default: '0' },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'account_id', type: 'INTEGER' },
            { name: 'ar_account_id', type: 'TEXT' },
            { name: 'ap_account_id', type: 'TEXT' },
            { name: 'geo_lat', type: 'REAL' },
            { name: 'geo_lng', type: 'REAL' },
            { name: 'geo_label', type: 'TEXT' },
            { name: 'default_consignment_allowed', type: 'INTEGER', default: '0' },
            { name: 'default_commission_profile_id', type: 'TEXT' },
            { name: 'default_consignment_warehouse_id', type: 'TEXT' },
            { name: 'default_consignment_pricing_policy', type: 'TEXT' },
            { name: 'default_pricing_mode', type: 'TEXT', default: "'retail'" },
            { name: 'allow_last_price_override', type: 'INTEGER', default: '1' },
            { name: 'allow_customer_item_special_prices', type: 'INTEGER', default: '1' },
            { name: 'allow_manual_price_edit', type: 'INTEGER', default: '1' },
            { name: 'preferred_currency_for_sales', type: 'TEXT' },
        ],
    },
    {
        name: 'party_transactions',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'party_id', type: 'TEXT', notNull: true },
            { name: 'party_type', type: 'TEXT' },
            { name: 'kind', type: 'TEXT', notNull: true },
            { name: 'ref_id', type: 'TEXT' },
            { name: 'amount', type: 'REAL', notNull: true },
            { name: 'delta', type: 'REAL', notNull: true },
            { name: 'currency', type: 'TEXT' },
            { name: 'amount_base', type: 'REAL' },
            { name: 'delta_base', type: 'REAL' },
            { name: 'amount_transaction', type: 'REAL' },
            { name: 'delta_transaction', type: 'REAL' },
            { name: 'exchange_rate', type: 'REAL', default: '1' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'accounts',
        columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true },
            { name: 'code', type: 'TEXT', notNull: true, unique: true },
            { name: 'name_ar', type: 'TEXT', notNull: true },
            { name: 'name_en', type: 'TEXT' },
            { name: 'parent_id', type: 'INTEGER' },
            { name: 'level', type: 'INTEGER', default: '1' },
            { name: 'account_type', type: 'TEXT', notNull: true },
            { name: 'account_nature', type: 'TEXT', notNull: true },
            { name: 'is_parent', type: 'INTEGER', default: '0' },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'is_system', type: 'INTEGER', default: '0' },
            { name: 'currency_code', type: 'TEXT', default: "'SYP'" },
            { name: 'branch_id', type: 'INTEGER' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'journal_entries',
        columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true },
            { name: 'entry_number', type: 'TEXT', notNull: true, unique: true },
            { name: 'entry_date', type: 'TEXT', notNull: true },
            { name: 'description', type: 'TEXT', notNull: true },
            { name: 'reference_type', type: 'TEXT', notNull: true },
            { name: 'reference_id', type: 'INTEGER' },
            { name: 'total_debit', type: 'REAL', notNull: true, default: '0' },
            { name: 'total_credit', type: 'REAL', notNull: true, default: '0' },
            { name: 'currency_code', type: 'TEXT', default: "'SYP'" },
            { name: 'exchange_rate', type: 'REAL', default: '1' },
            { name: 'status', type: 'TEXT', notNull: true, default: "'draft'" },
            { name: 'branch_id', type: 'INTEGER' },
            { name: 'created_by', type: 'INTEGER' },
            { name: 'posted_at', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'journal_entry_lines',
        columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true },
            { name: 'journal_entry_id', type: 'INTEGER', notNull: true },
            { name: 'account_id', type: 'INTEGER', notNull: true },
            { name: 'debit', type: 'REAL', notNull: true, default: '0' },
            { name: 'credit', type: 'REAL', notNull: true, default: '0' },
            { name: 'currency_code', type: 'TEXT', default: "'SYP'" },
            { name: 'exchange_rate', type: 'REAL', default: '1' },
            { name: 'amount_in_currency', type: 'REAL' },
            { name: 'description', type: 'TEXT' },
            { name: 'party_id', type: 'INTEGER' },
            { name: 'cost_center_id', type: 'INTEGER' },
        ],
    },
    {
        name: 'account_balances',
        columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true },
            { name: 'account_id', type: 'INTEGER', notNull: true },
            { name: 'period_key', type: 'TEXT', notNull: true },
            { name: 'debit_total', type: 'REAL', notNull: true, default: '0' },
            { name: 'credit_total', type: 'REAL', notNull: true, default: '0' },
            { name: 'balance', type: 'REAL', notNull: true, default: '0' },
            { name: 'currency_code', type: 'TEXT', default: "'SYP'" },
        ],
    },
    {
        name: 'items',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'code', type: 'TEXT', notNull: true },
            { name: 'group_id', type: 'TEXT' },
            { name: 'group_name', type: 'TEXT' },
            { name: 'merged', type: 'INTEGER', default: '0' },
            { name: 'inactive', type: 'INTEGER', default: '0' },
            { name: 'merged_into_item_id', type: 'TEXT' },
            { name: 'barcode', type: 'TEXT' },
            { name: 'serial_number', type: 'TEXT' },
            { name: 'serial_tracking', type: 'TEXT', default: "'none'" },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'unit_id', type: 'TEXT' },
            { name: 'quantity', type: 'REAL', notNull: true, default: '0' },
            { name: 'cost_price', type: 'REAL', notNull: true, default: '0' },
            { name: 'cost_price_base', type: 'REAL', notNull: true, default: '0' },
            { name: 'sale_price', type: 'REAL', notNull: true, default: '0' },
            { name: 'sale_price_base', type: 'REAL' },
            { name: 'wholesale_price', type: 'REAL', default: '0' },
            { name: 'wholesale_price_base', type: 'REAL' },
            { name: 'pos_price', type: 'REAL', default: '0' },
            { name: 'pos_price_base', type: 'REAL' },
            { name: 'price_per_meter', type: 'REAL', default: '0' },
            { name: 'warehouse_id', type: 'TEXT' },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'category_id', type: 'TEXT' },
            { name: 'sub_category_id', type: 'TEXT' },
            { name: 'image_url', type: 'TEXT' },
            { name: 'min_stock_alert', type: 'INTEGER', default: '5' },
            { name: 'model', type: 'TEXT' },
            { name: 'dimensions', type: 'TEXT' },
            { name: 'color', type: 'TEXT' },
            { name: 'origin', type: 'TEXT' },
            { name: 'manufacturer', type: 'TEXT' },
            { name: 'gross_weight', type: 'REAL', default: '0' },
            { name: 'net_weight', type: 'REAL', default: '0' },
            { name: 'is_scale_item', type: 'INTEGER', notNull: true, default: '0' },
            { name: 'scale_plu_code', type: 'TEXT' },
            { name: 'scale_barcode_prefix', type: 'TEXT' },
            { name: 'scale_barcode_mode', type: 'TEXT' },
            { name: 'scale_unit', type: 'TEXT' },
            { name: 'scale_price_per_kg', type: 'REAL' },
            { name: 'scale_item_code_length', type: 'INTEGER' },
            { name: 'scale_value_length', type: 'INTEGER' },
            { name: 'scale_decimals', type: 'INTEGER' },
            { name: 'wholesale_wholesale_price', type: 'REAL', default: '0' },
            { name: 'wholesale_wholesale_price_base', type: 'REAL' },
            { name: 'distribution_price', type: 'REAL', default: '0' },
            { name: 'distribution_price_base', type: 'REAL' },
            { name: 'delegate_price', type: 'REAL', default: '0' },
            { name: 'delegate_price_base', type: 'REAL' },
            { name: 'item_type', type: 'TEXT', default: "'STOCK'" },
            { name: 'price_currency', type: 'TEXT', default: "'USD'" },
            { name: 'last_purchase_price_transaction', type: 'REAL' },
            { name: 'last_purchase_currency', type: 'TEXT' },
            { name: 'last_purchase_exchange_rate', type: 'REAL' },
            { name: 'last_purchase_at', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'last_updated', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'customer_item_prices',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'customer_id', type: 'TEXT', notNull: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'unit_id', type: 'TEXT' },
            { name: 'currency_id', type: 'TEXT' },
            { name: 'price', type: 'REAL', notNull: true },
            { name: 'min_qty', type: 'REAL' },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'audit_logs',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'user_id', type: 'TEXT', notNull: true },
            { name: 'operation_type', type: 'TEXT', notNull: true },
            { name: 'affected_items', type: 'TEXT', notNull: true },
            { name: 'old_values', type: 'TEXT' },
            { name: 'new_values', type: 'TEXT' },
            { name: 'meta', type: 'TEXT' },
            { name: 'timestamp', type: 'TEXT', notNull: true },
        ],
    },
    {
        name: 'item_groups',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'item_group_items',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'group_id', type: 'TEXT', notNull: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'item_serials',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'serial_number', type: 'TEXT', notNull: true },
            { name: 'warehouse_id', type: 'TEXT' },
            { name: 'status', type: 'TEXT', notNull: true, default: "'available'" },
            { name: 'purchase_invoice_id', type: 'TEXT' },
            { name: 'sales_invoice_id', type: 'TEXT' },
            { name: 'consignment_document_id', type: 'TEXT' },
            { name: 'consignment_settlement_id', type: 'TEXT' },
            { name: 'location_type', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'item_barcodes',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'barcode', type: 'TEXT', notNull: true },
            { name: 'unit_id', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'promotions',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'start_date', type: 'TEXT', notNull: true },
            { name: 'end_date', type: 'TEXT', notNull: true },
            { name: 'offer_barcode', type: 'TEXT' },
            { name: 'description', type: 'TEXT' },
            { name: 'discount_type', type: 'TEXT', notNull: true },
            { name: 'discount_percent', type: 'REAL', default: '0' },
            { name: 'discount_value', type: 'REAL', default: '0' },
            { name: 'special_price', type: 'REAL', default: '0' },
            { name: 'buy_quantity', type: 'REAL', default: '0' },
            { name: 'get_discount_percent', type: 'REAL', default: '0' },
            { name: 'primary_item_id', type: 'TEXT' },
            { name: 'item_ids', type: 'TEXT' },
            { name: 'main_image_url', type: 'TEXT' },
            { name: 'extra_image_urls', type: 'TEXT' },
            { name: 'display_order', type: 'INTEGER', default: '0' },
            { name: 'display_duration_seconds', type: 'INTEGER', default: '10' },
            { name: 'show_on_display', type: 'INTEGER', default: '1' },
            { name: 'status', type: 'TEXT', notNull: true, default: "'active'" },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'warehouses',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'location', type: 'TEXT' },
            { name: 'manager', type: 'TEXT' },
            { name: 'branch_id', type: 'TEXT' },
            { name: 'warehouse_kind', type: 'TEXT', default: "'NORMAL'" },
            { name: 'owner_party_id', type: 'TEXT' },
            { name: 'owner_party_type', type: 'TEXT' },
        ],
    },
    {
        name: 'agents',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'company_id', type: 'TEXT' },
            { name: 'branch_id', type: 'TEXT' },
            { name: 'user_id', type: 'TEXT' },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'phone', type: 'TEXT' },
              { name: 'vehicle', type: 'TEXT' },
              { name: 'vehicle_image', type: 'TEXT' },
              { name: 'certificate_image', type: 'TEXT' },
              { name: 'notes', type: 'TEXT' },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'commission_rate', type: 'REAL', default: '0' },
            { name: 'commission_currency', type: 'TEXT', default: 'USD' },
            { name: 'last_lat', type: 'REAL' },
            { name: 'last_lng', type: 'REAL' },
            { name: 'last_seen_at', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'agent_inventory',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'company_id', type: 'TEXT' },
            { name: 'branch_id', type: 'TEXT' },
            { name: 'agent_id', type: 'TEXT', notNull: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'item_name', type: 'TEXT' },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'quantity', type: 'REAL', notNull: true, default: '0' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'agent_transfers',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'company_id', type: 'TEXT' },
            { name: 'branch_id', type: 'TEXT' },
            { name: 'agent_id', type: 'TEXT', notNull: true },
            { name: 'agent_name', type: 'TEXT' },
            { name: 'transfer_type', type: 'TEXT', default: "'transfer'" },
            { name: 'status', type: 'TEXT', default: "'posted'" },
            { name: 'warehouse_id', type: 'TEXT' },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'created_by_id', type: 'TEXT' },
            { name: 'created_by_name', type: 'TEXT' },
            { name: 'items', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'agent_transfer_lines',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'company_id', type: 'TEXT' },
            { name: 'branch_id', type: 'TEXT' },
            { name: 'transfer_id', type: 'TEXT', notNull: true },
            { name: 'agent_id', type: 'TEXT', notNull: true },
            { name: 'warehouse_id', type: 'TEXT' },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'item_name', type: 'TEXT' },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'quantity', type: 'REAL', notNull: true },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'agent_inventory_movements',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'company_id', type: 'TEXT' },
            { name: 'branch_id', type: 'TEXT' },
            { name: 'agent_id', type: 'TEXT', notNull: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'item_name', type: 'TEXT' },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'qty', type: 'REAL', notNull: true },
            { name: 'base_qty', type: 'REAL', notNull: true },
            { name: 'movement_type', type: 'TEXT', notNull: true },
            { name: 'document_type', type: 'TEXT', notNull: true },
            { name: 'document_id', type: 'TEXT', notNull: true },
            { name: 'document_number', type: 'TEXT' },
            { name: 'document_line_id', type: 'TEXT' },
            { name: 'warehouse_id', type: 'TEXT' },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'user_id', type: 'TEXT' },
            { name: 'user_name', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'stock_transfers',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'transfer_number', type: 'TEXT', notNull: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'item_name', type: 'TEXT' },
            { name: 'item_code', type: 'TEXT' },
            { name: 'from_item_id', type: 'TEXT' },
            { name: 'to_item_id', type: 'TEXT' },
            { name: 'from_warehouse_id', type: 'TEXT' },
            { name: 'from_warehouse_name', type: 'TEXT' },
            { name: 'to_warehouse_id', type: 'TEXT' },
            { name: 'to_warehouse_name', type: 'TEXT' },
            { name: 'quantity', type: 'REAL', notNull: true },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'date', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'notes', type: 'TEXT' },
        ],
    },
    {
        name: 'party_transfers',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'transfer_number', type: 'TEXT', notNull: true },
            { name: 'from_party_id', type: 'TEXT', notNull: true },
            { name: 'from_party_name', type: 'TEXT' },
            { name: 'to_party_id', type: 'TEXT', notNull: true },
            { name: 'to_party_name', type: 'TEXT' },
            { name: 'amount', type: 'REAL', notNull: true },
            { name: 'currency', type: 'TEXT' },
            { name: 'date', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'note', type: 'TEXT' },
        ],
    },
    {
        name: 'delivery_notices',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'status', type: 'TEXT', notNull: true, default: "'DRAFT'" },
            { name: 'warehouse_id', type: 'TEXT', notNull: true },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'receiver_type', type: 'TEXT' },
            { name: 'receiver_id', type: 'TEXT' },
            { name: 'receiver_name', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'date', type: 'TEXT', notNull: true },
            { name: 'items', type: 'TEXT' },
            { name: 'audit', type: 'TEXT' },
            { name: 'created_by_id', type: 'TEXT' },
            { name: 'created_by_name', type: 'TEXT' },
            { name: 'submitted_by_id', type: 'TEXT' },
            { name: 'submitted_by_name', type: 'TEXT' },
            { name: 'submitted_at', type: 'TEXT' },
            { name: 'confirmed_by_id', type: 'TEXT' },
            { name: 'confirmed_by_name', type: 'TEXT' },
            { name: 'confirmed_at', type: 'TEXT' },
            { name: 'rejected_by_id', type: 'TEXT' },
            { name: 'rejected_by_name', type: 'TEXT' },
            { name: 'rejected_at', type: 'TEXT' },
            { name: 'reject_reason', type: 'TEXT' },
            { name: 'manager_notes', type: 'TEXT' },
            { name: 'reference_number', type: 'TEXT' },
            { name: 'operation_type', type: 'TEXT' },
            { name: 'convert_to_invoice', type: 'INTEGER', default: '0' },
            { name: 'linked_invoice_id', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'reconciliation_marks',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'scope_type', type: 'TEXT', notNull: true },
            { name: 'scope_id', type: 'TEXT', notNull: true },
            { name: 'report_type', type: 'TEXT', notNull: true },
            { name: 'mark_at', type: 'TEXT', notNull: true },
            { name: 'row_ref_id', type: 'TEXT' },
            { name: 'note', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'categories',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
        ],
    },
    {
        name: 'sub_categories',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'category_id', type: 'TEXT' },
        ],
    },
        {
        name: 'units',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'is_base', type: 'INTEGER', default: '0' },
            { name: 'base_unit_id', type: 'TEXT' },
            { name: 'factor', type: 'REAL', default: '1' },
            { name: 'multiplier', type: 'REAL', default: '1' },
        ],
    },
    {
        name: 'cash_boxes',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'balance', type: 'REAL', notNull: true, default: '0' },
            { name: 'currency', type: 'TEXT', default: "'USD'" },
            { name: 'account_id', type: 'INTEGER' },
        ],
    },
      {
          name: 'vouchers',
          columns: [
              { name: 'id', type: 'TEXT', primaryKey: true },
              { name: 'type', type: 'TEXT', notNull: true },
              { name: 'date', type: 'TEXT', notNull: true },
              { name: 'amount', type: 'REAL', notNull: true },
              { name: 'amount_base', type: 'REAL' },
              { name: 'amount_transaction', type: 'REAL' },
              { name: 'original_amount', type: 'REAL' },
              { name: 'currency', type: 'TEXT' },
              { name: 'exchange_rate', type: 'REAL' },
              { name: 'cash_box_id', type: 'TEXT' },
              { name: 'cash_box_name', type: 'TEXT' },
              { name: 'client_id', type: 'TEXT' },
              { name: 'client_name', type: 'TEXT' },
              { name: 'category', type: 'TEXT' },
              { name: 'description', type: 'TEXT' },
              { name: 'reference_number', type: 'TEXT' },
              { name: 'linked_invoice_id', type: 'TEXT' },
              { name: 'journal_entry_id', type: 'TEXT' },
              { name: 'status', type: 'TEXT', notNull: true, default: "'DRAFT'" },
              { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'invoices',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'invoice_number', type: 'TEXT', notNull: true },
            { name: 'type', type: 'TEXT', notNull: true },
            { name: 'client_id', type: 'TEXT' },
            { name: 'client_name', type: 'TEXT' },
            { name: 'date', type: 'TEXT', notNull: true },
            { name: 'items', type: 'TEXT' },
            { name: 'total_amount', type: 'REAL', notNull: true },
            { name: 'total_amount_base', type: 'REAL' },
            { name: 'total_amount_transaction', type: 'REAL' },
            { name: 'discount', type: 'REAL' },
            { name: 'discount_base', type: 'REAL' },
            { name: 'discount_transaction', type: 'REAL' },
            { name: 'original_amount', type: 'REAL' },
            { name: 'exchange_rate', type: 'REAL' },
            { name: 'paid_amount', type: 'REAL', notNull: true },
            { name: 'paid_amount_base', type: 'REAL' },
            { name: 'paid_amount_transaction', type: 'REAL' },
            { name: 'remaining_amount', type: 'REAL', notNull: true },
            { name: 'remaining_amount_base', type: 'REAL' },
            { name: 'remaining_amount_transaction', type: 'REAL' },
            { name: 'payment_type', type: 'TEXT' },
            { name: 'apply_stock', type: 'INTEGER', default: '1' },
            { name: 'currency', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'return_type', type: 'TEXT' },
            { name: 'created_by_id', type: 'TEXT' },
            { name: 'created_by_name', type: 'TEXT' },
            { name: 'created_by_role', type: 'TEXT' },
            { name: 'agent_id', type: 'TEXT' },
            { name: 'agent_name', type: 'TEXT' },
            { name: 'agent_user_id', type: 'TEXT' },
            { name: 'geo_lat', type: 'REAL' },
            { name: 'geo_lng', type: 'REAL' },
            { name: 'geo_label', type: 'TEXT' },
            { name: 'target_warehouse_id', type: 'TEXT' },
            { name: 'target_warehouse_name', type: 'TEXT' },
            { name: 'source_document_type', type: 'TEXT' },
            { name: 'source_document_id', type: 'TEXT' },
            { name: 'journal_entry_id', type: 'INTEGER' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
        {
        name: 'invoice_movements',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'invoice_id', type: 'TEXT', notNull: true },
            { name: 'invoice_number', type: 'TEXT' },
            { name: 'action', type: 'TEXT', notNull: true },
            { name: 'from_status', type: 'TEXT' },
            { name: 'to_status', type: 'TEXT' },
            { name: 'reason', type: 'TEXT' },
            { name: 'user_id', type: 'TEXT' },
            { name: 'user_name', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'consignment_documents',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'document_number', type: 'TEXT', notNull: true },
            { name: 'direction', type: 'TEXT', notNull: true },
            { name: 'status', type: 'TEXT', notNull: true, default: "'DRAFT'" },
            { name: 'party_type', type: 'TEXT', notNull: true },
            { name: 'party_id', type: 'TEXT', notNull: true },
            { name: 'source_warehouse_id', type: 'TEXT' },
            { name: 'consignment_warehouse_id', type: 'TEXT', notNull: true },
            { name: 'issue_date', type: 'TEXT', notNull: true },
            { name: 'notes', type: 'TEXT' },
            { name: 'currency_id', type: 'TEXT' },
            { name: 'exchange_rate', type: 'REAL', default: '1' },
            { name: 'pricing_policy', type: 'TEXT' },
            { name: 'commission_type', type: 'TEXT' },
            { name: 'commission_value', type: 'REAL', default: '0' },
            { name: 'total_qty', type: 'REAL', default: '0' },
            { name: 'total_amount_reference', type: 'REAL' },
            { name: 'created_by', type: 'TEXT', notNull: true },
            { name: 'posted_by', type: 'TEXT' },
            { name: 'posted_at', type: 'TEXT' },
            { name: 'cancelled_by', type: 'TEXT' },
            { name: 'cancelled_at', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'consignment_document_lines',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'document_id', type: 'TEXT', notNull: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'unit_id', type: 'TEXT' },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'unit_factor', type: 'REAL' },
            { name: 'qty', type: 'REAL', notNull: true },
            { name: 'base_qty', type: 'REAL', notNull: true },
            { name: 'serial_numbers', type: 'TEXT' },
            { name: 'unit_cost', type: 'REAL', notNull: true, default: '0' },
            { name: 'reference_price', type: 'REAL' },
            { name: 'custom_sale_price', type: 'REAL' },
            { name: 'commission_type', type: 'TEXT' },
            { name: 'commission_value', type: 'REAL', default: '0' },
            { name: 'notes', type: 'TEXT' },
            { name: 'settled_sold_qty', type: 'REAL', default: '0' },
            { name: 'settled_returned_qty', type: 'REAL', default: '0' },
            { name: 'remaining_qty', type: 'REAL', default: '0' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'consignment_settlements',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'settlement_number', type: 'TEXT', notNull: true },
            { name: 'document_id', type: 'TEXT', notNull: true },
            { name: 'settlement_date', type: 'TEXT', notNull: true },
            { name: 'status', type: 'TEXT', notNull: true, default: "'DRAFT'" },
            { name: 'notes', type: 'TEXT' },
            { name: 'total_sold_qty', type: 'REAL', default: '0' },
            { name: 'total_returned_qty', type: 'REAL', default: '0' },
            { name: 'gross_sales_amount', type: 'REAL', default: '0' },
            { name: 'gross_purchase_amount', type: 'REAL', default: '0' },
            { name: 'total_commission', type: 'REAL', default: '0' },
            { name: 'net_amount', type: 'REAL', default: '0' },
            { name: 'created_by', type: 'TEXT', notNull: true },
            { name: 'posted_by', type: 'TEXT' },
            { name: 'posted_at', type: 'TEXT' },
            { name: 'cancelled_by', type: 'TEXT' },
            { name: 'cancelled_at', type: 'TEXT' },
            { name: 'linked_invoice_id', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'consignment_settlement_lines',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'settlement_id', type: 'TEXT', notNull: true },
            { name: 'document_line_id', type: 'TEXT', notNull: true },
            { name: 'action_type', type: 'TEXT', notNull: true },
            { name: 'unit_id', type: 'TEXT' },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'unit_factor', type: 'REAL' },
            { name: 'qty', type: 'REAL', notNull: true },
            { name: 'base_qty', type: 'REAL', notNull: true },
            { name: 'unit_price', type: 'REAL' },
            { name: 'unit_cost', type: 'REAL' },
            { name: 'commission_type', type: 'TEXT' },
            { name: 'commission_value', type: 'REAL', default: '0' },
            { name: 'line_gross_amount', type: 'REAL', default: '0' },
            { name: 'line_commission_amount', type: 'REAL', default: '0' },
            { name: 'line_net_amount', type: 'REAL', default: '0' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'consignment_commission_profiles',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'applies_to', type: 'TEXT', notNull: true },
            { name: 'commission_type', type: 'TEXT', notNull: true },
            { name: 'commission_value', type: 'REAL', notNull: true },
            { name: 'is_active', type: 'INTEGER', default: '1' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
            { name: 'updated_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'inventory_movements',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'item_id', type: 'TEXT', notNull: true },
            { name: 'warehouse_id', type: 'TEXT', notNull: true },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'document_type', type: 'TEXT', notNull: true },
            { name: 'document_id', type: 'TEXT', notNull: true },
            { name: 'document_number', type: 'TEXT' },
            { name: 'document_line_id', type: 'TEXT' },
            { name: 'movement_type', type: 'TEXT', notNull: true },
            { name: 'unit_id', type: 'TEXT' },
            { name: 'unit_name', type: 'TEXT' },
            { name: 'qty', type: 'REAL', notNull: true },
            { name: 'base_qty', type: 'REAL', notNull: true },
            { name: 'user_id', type: 'TEXT' },
            { name: 'user_name', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
{
        name: 'system_settings',
        columns: [
            { name: 'key', type: 'TEXT', primaryKey: true },
            { name: 'value', type: 'TEXT', notNull: true },
        ],
    },
    {
        name: 'branches',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'location', type: 'TEXT' },
            { name: 'manager', type: 'TEXT' },
            { name: 'phone', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'remote_branches',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'employee_name', type: 'TEXT' },
            { name: 'ip_address', type: 'TEXT', notNull: true },
            { name: 'sync_interval', type: 'INTEGER', default: '30' },
            { name: 'show_financials', type: 'INTEGER', default: '1' },
            { name: 'show_inventory', type: 'INTEGER', default: '1' },
            { name: 'show_invoices', type: 'INTEGER', default: '1' },
            { name: 'connection_mode', type: 'TEXT', default: "'server'" },
            { name: 'client_id', type: 'TEXT' },
            { name: 'client_name', type: 'TEXT' },
            { name: 'user_id', type: 'TEXT' },
            { name: 'user_name', type: 'TEXT' },
            { name: 'device_label', type: 'TEXT' },
            { name: 'platform', type: 'TEXT' },
            { name: 'app_version', type: 'TEXT' },
            { name: 'user_agent', type: 'TEXT' },
            { name: 'session_id', type: 'TEXT' },
            { name: 'last_seen', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'partners',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'type', type: 'TEXT', notNull: true },
            { name: 'percentage', type: 'REAL', notNull: true },
            { name: 'capital_amount', type: 'REAL', default: '0' },
            { name: 'current_balance', type: 'REAL', default: '0' },
            { name: 'join_date', type: 'TEXT' },
            { name: 'status', type: 'TEXT', default: "'active'" },
            { name: 'linked_client_id', type: 'TEXT' },
        ],
    },
    {
        name: 'partner_transactions',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'partner_id', type: 'TEXT', notNull: true },
            { name: 'partner_name', type: 'TEXT' },
            { name: 'type', type: 'TEXT', notNull: true },
            { name: 'amount', type: 'REAL', notNull: true },
            { name: 'date', type: 'TEXT', notNull: true },
            { name: 'description', type: 'TEXT' },
        ],
    },
    {
        name: 'recipes',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'output_item_id', type: 'TEXT', notNull: true },
            { name: 'output_item_name', type: 'TEXT' },
            { name: 'lines', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'manufacturing_orders',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'code', type: 'TEXT', notNull: true },
            { name: 'date', type: 'TEXT', notNull: true },
            { name: 'warehouse_id', type: 'TEXT', notNull: true },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'output_item_id', type: 'TEXT', notNull: true },
            { name: 'output_item_name', type: 'TEXT' },
            { name: 'output_qty', type: 'REAL', notNull: true },
            { name: 'unit_cost', type: 'REAL', default: '0' },
            { name: 'total_cost', type: 'REAL', default: '0' },
            { name: 'status', type: 'TEXT', default: "'DRAFT'" },
            { name: 'expense_type', type: 'TEXT', default: "'FIXED'" },
            { name: 'expense_value', type: 'REAL', default: '0' },
            { name: 'items', type: 'TEXT' },
            { name: 'notes', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
    {
        name: 'expenses',
        columns: [
            { name: 'id', type: 'TEXT', primaryKey: true },
            { name: 'code', type: 'TEXT', notNull: true },
            { name: 'date', type: 'TEXT', notNull: true },
            { name: 'description', type: 'TEXT', notNull: true },
            { name: 'total_amount', type: 'REAL', notNull: true },
            { name: 'currency', type: 'TEXT', default: "'USD'" },
            { name: 'payment_type', type: 'TEXT', default: "'CASH'" },
            { name: 'cash_box_id', type: 'TEXT' },
            { name: 'cash_box_name', type: 'TEXT' },
            { name: 'warehouse_id', type: 'TEXT' },
            { name: 'warehouse_name', type: 'TEXT' },
            { name: 'manufacturing_order_id', type: 'TEXT' },
            { name: 'status', type: 'TEXT', default: "'DRAFT'" },
            { name: 'lines', type: 'TEXT' },
            { name: 'posted_at', type: 'TEXT' },
            { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
        ],
    },
];

const buildColumnSql = (col: ColumnDef) => {
    const parts: string[] = [`"${col.name}"`, col.type];
    if (col.primaryKey) parts.push('PRIMARY KEY');
    if (col.unique) parts.push('UNIQUE');
    if (col.notNull) parts.push('NOT NULL');
    if (col.default) parts.push(`DEFAULT ${col.default}`);
    return parts.join(' ');
};

const columnDefaultForType = (col: ColumnDef) => {
    if (col.default) return col.default;
    if (col.type === 'TEXT') return "''";
    return '0';
};

const ensureTables = (db: Database.Database) => {
    const tableExistsStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
    for (const table of TABLES) {
        const exists = tableExistsStmt.get(table.name);
        if (!exists) {
            const cols = table.columns.map(buildColumnSql).join(', ');
            db.exec(`CREATE TABLE IF NOT EXISTS "${table.name}" (${cols})`);
            continue;
        }

        const currentCols = db.prepare(`PRAGMA table_info('${table.name}')`).all() as { name: string }[];
        const currentSet = new Set(currentCols.map(c => c.name));
        for (const col of table.columns) {
            if (currentSet.has(col.name)) continue;
            const parts: string[] = [`"${col.name}"`, col.type];
            const defaultVal = columnDefaultForType(col);
            if (col.notNull) parts.push('NOT NULL');
            if (defaultVal) parts.push(`DEFAULT ${defaultVal}`);
            db.exec(`ALTER TABLE "${table.name}" ADD COLUMN ${parts.join(' ')}`);
        }
    }
};

ensureTables(sqlite);

export const getResolvedDbPath = () => dbPath;
export const getDatabaseStateDir = () => path.dirname(dbPath);

/** The raw better-sqlite3 Database instance – use for rawDb.prepare() */
export const rawSqlite = sqlite;
export const pgPool = null;

export const db = drizzle(sqlite, { schema });
export const verifyDatabaseConnectivity = async () => ({ ok: true, dialect: 'sqlite', target: dbPath });
export const ensureDatabaseReady = async () => undefined;

export const closeDb = () => {
    try { sqlite.close(); } catch {}
};

// ملاحظة: تم إيقاف محرك المزامنة اليدوي والاعتماد على drizzle-kit push لضمان استقرار البنية
