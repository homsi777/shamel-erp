-- QR table requests + menu visibility; public_qr_token uniqueness

CREATE TABLE IF NOT EXISTS "restaurant_menu_items" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "item_id" text NOT NULL,
  "is_visible_in_qr" integer DEFAULT true NOT NULL,
  "display_name_override" text,
  "description" text,
  "image_url" text,
  "category_name" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_available_now" integer DEFAULT true NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_restaurant_menu_company_branch_item"
  ON "restaurant_menu_items" ("company_id", "branch_id", "item_id");

CREATE INDEX IF NOT EXISTS "idx_restaurant_menu_company_branch"
  ON "restaurant_menu_items" ("company_id", "branch_id");

CREATE TABLE IF NOT EXISTS "restaurant_table_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "table_id" text NOT NULL,
  "session_id" text NOT NULL,
  "public_qr_token_snapshot" text,
  "request_status" text NOT NULL DEFAULT 'new',
  "request_source" text NOT NULL DEFAULT 'qr',
  "customer_session_token" text,
  "submitted_at" text NOT NULL,
  "seen_at" text,
  "accepted_at" text,
  "rejected_at" text,
  "archived_at" text,
  "notes" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id"),
  FOREIGN KEY ("session_id") REFERENCES "restaurant_table_sessions"("id")
);

CREATE INDEX IF NOT EXISTS "idx_restaurant_requests_company_branch_status"
  ON "restaurant_table_requests" ("company_id", "branch_id", "request_status");

CREATE INDEX IF NOT EXISTS "idx_restaurant_requests_session_submitted"
  ON "restaurant_table_requests" ("session_id", "submitted_at");

CREATE INDEX IF NOT EXISTS "idx_restaurant_requests_table_session"
  ON "restaurant_table_requests" ("table_id", "session_id");

CREATE INDEX IF NOT EXISTS "idx_restaurant_requests_customer_session"
  ON "restaurant_table_requests" ("customer_session_token");

CREATE TABLE IF NOT EXISTS "restaurant_table_request_items" (
  "id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL,
  "company_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "item_id" text NOT NULL,
  "item_name_snapshot" text NOT NULL,
  "item_code_snapshot" text,
  "unit_name_snapshot" text,
  "quantity" real NOT NULL,
  "base_unit_price" real NOT NULL,
  "line_subtotal" real NOT NULL,
  "customer_note" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("request_id") REFERENCES "restaurant_table_requests"("id")
);

CREATE INDEX IF NOT EXISTS "idx_restaurant_request_items_request"
  ON "restaurant_table_request_items" ("request_id");

CREATE INDEX IF NOT EXISTS "idx_restaurant_request_items_item"
  ON "restaurant_table_request_items" ("item_id");

-- High-entropy tokens for existing tables (single UPDATE cannot vary per row in SQLite easily — use trigger-less approach in app or multiple passes). Here: set via application on first read; migration adds unique index only where token non-null.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_restaurant_tables_public_qr_token"
  ON "restaurant_tables" ("public_qr_token")
  WHERE "public_qr_token" IS NOT NULL AND trim("public_qr_token") != '';
