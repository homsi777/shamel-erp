-- Restaurant operational core: tables + table sessions (no POS/accounting coupling)

CREATE TABLE IF NOT EXISTS "restaurant_tables" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "zone_name" text,
  "capacity" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" integer DEFAULT true NOT NULL,
  "notes" text,
  "public_qr_token" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_restaurant_tables_company_branch_code"
  ON "restaurant_tables" ("company_id", "branch_id", "code");

CREATE INDEX IF NOT EXISTS "idx_restaurant_tables_company_branch"
  ON "restaurant_tables" ("company_id", "branch_id");

CREATE INDEX IF NOT EXISTS "idx_restaurant_tables_active_sort"
  ON "restaurant_tables" ("company_id", "branch_id", "is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "restaurant_table_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "table_id" text NOT NULL,
  "opened_by_user_id" text NOT NULL,
  "closed_by_user_id" text,
  "session_status" text DEFAULT 'open' NOT NULL,
  "guest_count" integer,
  "opened_at" text NOT NULL,
  "last_activity_at" text NOT NULL,
  "closed_at" text,
  "preliminary_total" real DEFAULT 0 NOT NULL,
  "notes" text,
  "source" text DEFAULT 'cashier' NOT NULL,
  "unread_request_count" integer DEFAULT 0,
  "final_invoice_id" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON UPDATE no action ON DELETE no action
);

CREATE INDEX IF NOT EXISTS "idx_table_sessions_company_branch_status"
  ON "restaurant_table_sessions" ("company_id", "branch_id", "session_status");

CREATE INDEX IF NOT EXISTS "idx_table_sessions_table_open"
  ON "restaurant_table_sessions" ("table_id", "session_status");

CREATE INDEX IF NOT EXISTS "idx_table_sessions_last_activity"
  ON "restaurant_table_sessions" ("last_activity_at");
