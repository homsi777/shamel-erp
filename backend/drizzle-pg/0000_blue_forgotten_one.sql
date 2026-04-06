CREATE TABLE IF NOT EXISTS "account_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text,
	"account_id" integer NOT NULL,
	"period_key" text NOT NULL,
	"debit_total" numeric(18, 6) DEFAULT 0 NOT NULL,
	"credit_total" numeric(18, 6) DEFAULT 0 NOT NULL,
	"balance" numeric(18, 6) DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'SYP'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text,
	"code" text NOT NULL,
	"lookup_code" text,
	"name_ar" text NOT NULL,
	"name_en" text,
	"parent_id" integer,
	"level" integer DEFAULT 1 NOT NULL,
	"account_type" text NOT NULL,
	"account_nature" text NOT NULL,
	"is_parent" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"currency_code" text DEFAULT 'SYP',
	"branch_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activation_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"activation_type" text DEFAULT 'local' NOT NULL,
	"license_mission" text DEFAULT 'LOCAL_STANDALONE' NOT NULL,
	"is_used" boolean DEFAULT false,
	"used_at" timestamp with time zone,
	"computer_name" text,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "activation_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activation_telegram_dedupe" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"agent_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name" text,
	"unit_name" text,
	"quantity" numeric(18, 6) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"agent_id" text NOT NULL,
	"agent_name" text,
	"warehouse_id" text,
	"warehouse_name" text,
	"items" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"user_id" text,
	"name" text NOT NULL,
	"phone" text,
	"vehicle" text,
	"vehicle_image" text,
	"certificate_image" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"commission_rate" numeric(18, 6) DEFAULT 0,
	"commission_currency" text DEFAULT 'USD',
	"last_lat" numeric(18, 6),
	"last_lng" numeric(18, 6),
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"device_id" text,
	"device_ip" text,
	"employee_id" text,
	"employee_name" text,
	"biometric_id" text,
	"timestamp" timestamp with time zone NOT NULL,
	"event_type" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"user_id" text NOT NULL,
	"operation_type" text NOT NULL,
	"affected_items" text NOT NULL,
	"old_values" text,
	"new_values" text,
	"meta" text,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biometric_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"ip" text NOT NULL,
	"port" integer DEFAULT 4370,
	"location" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_main" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"location" text,
	"manager" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_boxes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"balance" numeric(18, 6) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD',
	"account_id" integer,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consignment_commission_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"applies_to" text NOT NULL,
	"commission_type" text NOT NULL,
	"commission_value" numeric(18, 6) NOT NULL,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consignment_document_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"document_id" text NOT NULL,
	"item_id" text NOT NULL,
	"unit_id" text,
	"unit_name" text,
	"unit_factor" numeric(18, 6),
	"qty" numeric(18, 6) NOT NULL,
	"base_qty" numeric(18, 6) NOT NULL,
	"serial_numbers" text,
	"unit_cost" numeric(18, 6) DEFAULT 0 NOT NULL,
	"reference_price" numeric(18, 6),
	"custom_sale_price" numeric(18, 6),
	"commission_type" text,
	"commission_value" numeric(18, 6) DEFAULT 0,
	"notes" text,
	"settled_sold_qty" numeric(18, 6) DEFAULT 0,
	"settled_returned_qty" numeric(18, 6) DEFAULT 0,
	"remaining_qty" numeric(18, 6) DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consignment_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"document_number" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"party_type" text NOT NULL,
	"party_id" text NOT NULL,
	"source_warehouse_id" text,
	"consignment_warehouse_id" text NOT NULL,
	"issue_date" date NOT NULL,
	"notes" text,
	"currency_id" text,
	"exchange_rate" numeric(18, 6) DEFAULT 1,
	"pricing_policy" text DEFAULT 'MANUAL',
	"commission_type" text DEFAULT 'NONE',
	"commission_value" numeric(18, 6) DEFAULT 0,
	"total_qty" numeric(18, 6) DEFAULT 0,
	"total_amount_reference" numeric(18, 6),
	"created_by" text NOT NULL,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "consignment_documents_document_number_unique" UNIQUE("document_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consignment_settlement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"settlement_id" text NOT NULL,
	"document_line_id" text NOT NULL,
	"action_type" text NOT NULL,
	"unit_id" text,
	"unit_name" text,
	"unit_factor" numeric(18, 6),
	"qty" numeric(18, 6) NOT NULL,
	"base_qty" numeric(18, 6) NOT NULL,
	"serial_numbers" text,
	"unit_price" numeric(18, 6),
	"unit_cost" numeric(18, 6),
	"commission_type" text,
	"commission_value" numeric(18, 6) DEFAULT 0,
	"line_gross_amount" numeric(18, 6) DEFAULT 0,
	"line_commission_amount" numeric(18, 6) DEFAULT 0,
	"line_net_amount" numeric(18, 6) DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consignment_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"settlement_number" text NOT NULL,
	"document_id" text NOT NULL,
	"settlement_date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"total_sold_qty" numeric(18, 6) DEFAULT 0,
	"total_returned_qty" numeric(18, 6) DEFAULT 0,
	"gross_sales_amount" numeric(18, 6) DEFAULT 0,
	"gross_purchase_amount" numeric(18, 6) DEFAULT 0,
	"total_commission" numeric(18, 6) DEFAULT 0,
	"net_amount" numeric(18, 6) DEFAULT 0,
	"created_by" text NOT NULL,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"linked_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "consignment_settlements_settlement_number_unique" UNIQUE("settlement_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_item_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"customer_id" text NOT NULL,
	"item_id" text NOT NULL,
	"unit_id" text,
	"currency_id" text,
	"price" numeric(18, 6) NOT NULL,
	"min_qty" numeric(18, 6),
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"warehouse_id" text NOT NULL,
	"warehouse_name" text,
	"receiver_type" text,
	"receiver_id" text,
	"receiver_name" text,
	"notes" text,
	"date" date NOT NULL,
	"items" text,
	"audit" text,
	"created_by_id" text,
	"created_by_name" text,
	"submitted_by_id" text,
	"submitted_by_name" text,
	"submitted_at" timestamp with time zone,
	"confirmed_by_id" text,
	"confirmed_by_name" text,
	"confirmed_at" timestamp with time zone,
	"rejected_by_id" text,
	"rejected_by_name" text,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"manager_notes" text,
	"reference_number" text,
	"operation_type" text,
	"convert_to_invoice" boolean DEFAULT false,
	"linked_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"sequence_key" text NOT NULL,
	"document_type" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "document_sequences_sequence_key_unique" UNIQUE("sequence_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"id_number" text,
	"birth_date" date,
	"address" text,
	"marital_status" text,
	"biometric_id" text,
	"position" text,
	"base_salary" numeric(18, 6) DEFAULT 0,
	"currency" text DEFAULT 'USD',
	"salary_frequency" text DEFAULT 'monthly',
	"education" text,
	"courses" text,
	"notes" text,
	"image_url" text,
	"id_front_url" text,
	"id_back_url" text,
	"experience" text,
	"status" text DEFAULT 'active',
	"join_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"code" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"total_amount" numeric(18, 6) NOT NULL,
	"currency" text DEFAULT 'USD',
	"payment_type" text DEFAULT 'CASH',
	"cash_box_id" text,
	"cash_box_name" text,
	"warehouse_id" text,
	"warehouse_name" text,
	"manufacturing_order_id" text,
	"status" text DEFAULT 'DRAFT',
	"lines" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closing_journal_entry_id" integer,
	"net_pnl" numeric(18, 6),
	"total_revenue" numeric(18, 6),
	"total_expenses" numeric(18, 6),
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"reopened_by" text,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fx_revaluation_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"run_id" text NOT NULL,
	"item_type" text NOT NULL,
	"party_id" text,
	"party_name" text,
	"invoice_id" text,
	"invoice_number" text,
	"currency" text NOT NULL,
	"outstanding_foreign" numeric(18, 6) NOT NULL,
	"original_rate" numeric(18, 6) NOT NULL,
	"book_value_base" numeric(18, 6) NOT NULL,
	"revaluation_rate" numeric(18, 6) NOT NULL,
	"revalued_base" numeric(18, 6) NOT NULL,
	"unrealized_diff" numeric(18, 6) NOT NULL,
	"diff_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fx_revaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"valuation_date" date NOT NULL,
	"reversal_date" date NOT NULL,
	"rate_syp" numeric(18, 6) NOT NULL,
	"rate_try" numeric(18, 6) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_unrealized_gain" numeric(18, 6) DEFAULT 0,
	"total_unrealized_loss" numeric(18, 6) DEFAULT 0,
	"net_unrealized" numeric(18, 6) DEFAULT 0,
	"items_evaluated" integer DEFAULT 0,
	"revaluation_journal_entry_id" integer,
	"reversal_journal_entry_id" integer,
	"executed_by" text,
	"executed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"warehouse_name" text,
	"document_type" text NOT NULL,
	"document_id" text NOT NULL,
	"document_number" text,
	"document_line_id" text,
	"movement_type" text NOT NULL,
	"unit_id" text,
	"unit_name" text,
	"qty" numeric(18, 6) NOT NULL,
	"base_qty" numeric(18, 6) NOT NULL,
	"textile_color_id" text,
	"textile_roll_delta" numeric(18, 6) DEFAULT 0,
	"textile_length_delta" numeric(18, 6) DEFAULT 0,
	"textile_base_uom" text,
	"user_id" text,
	"user_name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"invoice_id" text NOT NULL,
	"invoice_number" text,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"user_id" text,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"invoice_number" text NOT NULL,
	"type" text NOT NULL,
	"client_id" text,
	"client_name" text,
	"date" date NOT NULL,
	"items" text,
	"total_amount" numeric(18, 6) NOT NULL,
	"total_amount_base" numeric(18, 6),
	"total_amount_transaction" numeric(18, 6),
	"discount" numeric(18, 6),
	"discount_base" numeric(18, 6),
	"discount_transaction" numeric(18, 6),
	"original_amount" numeric(18, 6),
	"exchange_rate" numeric(18, 6),
	"paid_amount" numeric(18, 6) NOT NULL,
	"paid_amount_base" numeric(18, 6),
	"paid_amount_transaction" numeric(18, 6),
	"remaining_amount" numeric(18, 6) NOT NULL,
	"remaining_amount_base" numeric(18, 6),
	"remaining_amount_transaction" numeric(18, 6),
	"payment_type" text,
	"apply_stock" integer DEFAULT 1,
	"currency" text,
	"notes" text,
	"return_type" text,
	"created_by_id" text,
	"created_by_name" text,
	"created_by_role" text,
	"geo_lat" numeric(18, 6),
	"geo_lng" numeric(18, 6),
	"geo_label" text,
	"target_warehouse_id" text,
	"target_warehouse_name" text,
	"source_document_type" text,
	"source_document_id" text,
	"journal_entry_id" integer,
	"correction_audit" text,
	"goods_subtotal" numeric(18, 6),
	"additional_costs_total" numeric(18, 6),
	"queue_number" text,
	"queue_scope" text,
	"queue_date" date,
	"kitchen_printed_at" timestamp with time zone,
	"customer_printed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_barcodes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"item_id" text NOT NULL,
	"barcode" text NOT NULL,
	"unit_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_group_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"group_id" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_serials" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"item_id" text NOT NULL,
	"serial_number" text NOT NULL,
	"warehouse_id" text,
	"status" text DEFAULT 'available' NOT NULL,
	"purchase_invoice_id" text,
	"sales_invoice_id" text,
	"consignment_document_id" text,
	"consignment_settlement_id" text,
	"location_type" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"group_id" text,
	"group_name" text,
	"merged" boolean DEFAULT false,
	"inactive" boolean DEFAULT false,
	"merged_into_item_id" text,
	"barcode" text,
	"serial_number" text,
	"serial_tracking" text DEFAULT 'none',
	"unit_name" text,
	"unit_id" text,
	"quantity" numeric(18, 6) DEFAULT 0 NOT NULL,
	"cost_price" numeric(18, 6) DEFAULT 0 NOT NULL,
	"cost_price_base" numeric(18, 6) DEFAULT 0 NOT NULL,
	"sale_price" numeric(18, 6) DEFAULT 0 NOT NULL,
	"sale_price_base" numeric(18, 6),
	"wholesale_price" numeric(18, 6) DEFAULT 0,
	"wholesale_price_base" numeric(18, 6),
	"pos_price" numeric(18, 6) DEFAULT 0,
	"pos_price_base" numeric(18, 6),
	"price_per_meter" numeric(18, 6) DEFAULT 0,
	"warehouse_id" text,
	"warehouse_name" text,
	"category_id" text,
	"sub_category_id" text,
	"image_url" text,
	"min_stock_alert" integer DEFAULT 5,
	"model" text,
	"dimensions" text,
	"color" text,
	"origin" text,
	"manufacturer" text,
	"gross_weight" numeric(18, 6),
	"net_weight" numeric(18, 6),
	"is_scale_item" boolean DEFAULT false NOT NULL,
	"scale_plu_code" text,
	"scale_barcode_prefix" text,
	"scale_barcode_mode" text,
	"scale_unit" text,
	"scale_price_per_kg" numeric(18, 6),
	"scale_item_code_length" integer,
	"scale_value_length" integer,
	"scale_decimals" integer,
	"wholesale_wholesale_price" numeric(18, 6) DEFAULT 0,
	"wholesale_wholesale_price_base" numeric(18, 6),
	"distribution_price" numeric(18, 6) DEFAULT 0,
	"distribution_price_base" numeric(18, 6),
	"delegate_price" numeric(18, 6) DEFAULT 0,
	"delegate_price_base" numeric(18, 6),
	"item_type" text DEFAULT 'STOCK',
	"price_currency" text DEFAULT 'USD',
	"last_purchase_price_transaction" numeric(18, 6),
	"last_purchase_currency" text,
	"last_purchase_exchange_rate" numeric(18, 6),
	"last_purchase_at" timestamp with time zone,
	"is_textile" boolean DEFAULT false NOT NULL,
	"textile_base_uom" text,
	"supports_color_dimension" boolean DEFAULT false NOT NULL,
	"notes" text,
	"last_updated" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text,
	"entry_number" text NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" integer,
	"total_debit" numeric(18, 6) DEFAULT 0 NOT NULL,
	"total_credit" numeric(18, 6) DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'SYP',
	"exchange_rate" numeric(18, 6) DEFAULT 1,
	"status" text DEFAULT 'draft' NOT NULL,
	"branch_id" text,
	"created_by" integer,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "journal_entries_entry_number_unique" UNIQUE("entry_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entry_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text,
	"journal_entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit" numeric(18, 6) DEFAULT 0 NOT NULL,
	"credit" numeric(18, 6) DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'SYP',
	"exchange_rate" numeric(18, 6) DEFAULT 1,
	"amount_in_currency" numeric(18, 6),
	"description" text,
	"party_id" integer,
	"partner_ref_id" text,
	"cost_center_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "license_extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"extension_type" text NOT NULL,
	"label" text NOT NULL,
	"payload" text NOT NULL,
	"applied_by" text NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "license_extensions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manufacturing_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"code" text NOT NULL,
	"date" date NOT NULL,
	"warehouse_id" text NOT NULL,
	"warehouse_name" text,
	"output_item_id" text NOT NULL,
	"output_item_name" text,
	"output_qty" numeric(18, 6) NOT NULL,
	"unit_cost" numeric(18, 6) DEFAULT 0,
	"total_cost" numeric(18, 6) DEFAULT 0,
	"status" text DEFAULT 'DRAFT',
	"expense_type" text DEFAULT 'FIXED',
	"expense_value" numeric(18, 6) DEFAULT 0,
	"items" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parties" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"tax_no" text,
	"balance" numeric(18, 6) DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"account_id" integer,
	"ar_account_id" text,
	"ap_account_id" text,
	"geo_lat" numeric(18, 6),
	"geo_lng" numeric(18, 6),
	"geo_label" text,
	"default_consignment_allowed" boolean DEFAULT false,
	"default_commission_profile_id" text,
	"default_consignment_warehouse_id" text,
	"default_consignment_pricing_policy" text,
	"default_pricing_mode" text DEFAULT 'retail',
	"allow_last_price_override" boolean DEFAULT true,
	"allow_customer_item_special_prices" boolean DEFAULT true,
	"allow_manual_price_edit" boolean DEFAULT true,
	"preferred_currency_for_sales" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"partner_id" text NOT NULL,
	"partner_name" text,
	"type" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"date" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"percentage" numeric(18, 6) NOT NULL,
	"capital_amount" numeric(18, 6) DEFAULT 0,
	"current_balance" numeric(18, 6) DEFAULT 0,
	"join_date" text,
	"status" text DEFAULT 'active',
	"linked_client_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "party_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"party_id" text NOT NULL,
	"party_type" text,
	"kind" text NOT NULL,
	"ref_id" text,
	"amount" numeric(18, 6) NOT NULL,
	"delta" numeric(18, 6) NOT NULL,
	"currency" text,
	"amount_base" numeric(18, 6),
	"delta_base" numeric(18, 6),
	"amount_transaction" numeric(18, 6),
	"delta_transaction" numeric(18, 6),
	"exchange_rate" numeric(18, 6) DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "party_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"transfer_number" text NOT NULL,
	"from_party_id" text NOT NULL,
	"from_party_name" text,
	"to_party_id" text NOT NULL,
	"to_party_name" text,
	"amount" numeric(18, 6) NOT NULL,
	"currency" text,
	"date" timestamp with time zone DEFAULT now(),
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"invoice_id" text,
	"print_type" text NOT NULL,
	"document_type" text,
	"template_id" text,
	"payload_summary" text,
	"printer_id" text,
	"printer_address" text,
	"printer_connection_type" text,
	"invoice_number" text,
	"copies" integer DEFAULT 1,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"printed_at" timestamp with time zone,
	"source" text,
	"created_by_id" text,
	"created_by_name" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "print_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"template_type" text NOT NULL,
	"format" text DEFAULT 'A4' NOT NULL,
	"name" text NOT NULL,
	"template_json" text,
	"template_html" text,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"show_logo" boolean DEFAULT true,
	"show_company_name" boolean DEFAULT true,
	"show_address" boolean DEFAULT true,
	"show_phone" boolean DEFAULT true,
	"show_tax_number" boolean DEFAULT false,
	"show_qr_code" boolean DEFAULT false,
	"show_discount" boolean DEFAULT true,
	"show_tax_breakdown" boolean DEFAULT false,
	"show_footer" boolean DEFAULT true,
	"show_signature_line" boolean DEFAULT false,
	"header_title" text,
	"header_subtitle" text,
	"footer_text" text,
	"font_size" text DEFAULT 'md',
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "printers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"type" text DEFAULT 'standard' NOT NULL,
	"connection_type" text DEFAULT 'windows' NOT NULL,
	"address" text,
	"paper_size" text DEFAULT 'A4' NOT NULL,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"codepage" text DEFAULT 'UTF8',
	"document_types" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"offer_barcode" text,
	"description" text,
	"discount_type" text NOT NULL,
	"discount_percent" numeric(18, 6) DEFAULT 0,
	"discount_value" numeric(18, 6) DEFAULT 0,
	"special_price" numeric(18, 6) DEFAULT 0,
	"buy_quantity" numeric(18, 6) DEFAULT 0,
	"get_discount_percent" numeric(18, 6) DEFAULT 0,
	"primary_item_id" text,
	"item_ids" text,
	"main_image_url" text,
	"extra_image_urls" text,
	"display_order" integer DEFAULT 0,
	"display_duration_seconds" integer DEFAULT 10,
	"show_on_display" boolean DEFAULT true,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"scope_key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "queue_counters_scope_key_unique" UNIQUE("scope_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"code" text,
	"output_item_id" text NOT NULL,
	"output_item_name" text,
	"output_qty" numeric(18, 6) DEFAULT 1,
	"unit_name" text,
	"lines" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reconciliation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"session_id" text NOT NULL,
	"item_type" text NOT NULL,
	"side" text NOT NULL,
	"ref_id" text,
	"ref_number" text,
	"ref_date" date,
	"party_id" text,
	"party_name" text,
	"currency" text DEFAULT 'USD',
	"amount_foreign" numeric(18, 6) DEFAULT 0,
	"amount_base" numeric(18, 6) NOT NULL,
	"allocated_base" numeric(18, 6) DEFAULT 0,
	"remaining_base" numeric(18, 6) DEFAULT 0,
	"match_group_id" text,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"match_method" text,
	"match_difference" numeric(18, 6) DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reconciliation_marks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"report_type" text NOT NULL,
	"mark_at" timestamp with time zone NOT NULL,
	"row_ref_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reconciliation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"type" text NOT NULL,
	"party_id" text,
	"party_name" text,
	"from_date" date,
	"to_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"total_debit_matched" numeric(18, 6) DEFAULT 0,
	"total_credit_matched" numeric(18, 6) DEFAULT 0,
	"difference_amount" numeric(18, 6) DEFAULT 0,
	"write_off_journal_entry_id" integer,
	"tolerance_amount" numeric(18, 6) DEFAULT 0,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remote_branches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"name" text NOT NULL,
	"employee_name" text,
	"ip_address" text NOT NULL,
	"sync_interval" integer DEFAULT 30,
	"show_financials" boolean DEFAULT true,
	"show_inventory" boolean DEFAULT true,
	"show_invoices" boolean DEFAULT true,
	"connection_mode" text DEFAULT 'server',
	"client_id" text,
	"client_name" text,
	"user_id" text,
	"user_name" text,
	"device_label" text,
	"platform" text,
	"app_version" text,
	"user_agent" text,
	"session_id" text,
	"last_seen" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_menu_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"item_id" text NOT NULL,
	"is_visible_in_qr" boolean DEFAULT true NOT NULL,
	"display_name_override" text,
	"description" text,
	"image_url" text,
	"category_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_available_now" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_table_request_items" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name_snapshot" text NOT NULL,
	"item_code_snapshot" text,
	"unit_name_snapshot" text,
	"quantity" numeric(18, 6) NOT NULL,
	"base_unit_price" numeric(18, 6) NOT NULL,
	"line_subtotal" numeric(18, 6) NOT NULL,
	"customer_note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_table_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"table_id" text NOT NULL,
	"session_id" text NOT NULL,
	"public_qr_token_snapshot" text,
	"request_status" text DEFAULT 'new' NOT NULL,
	"request_source" text DEFAULT 'qr' NOT NULL,
	"customer_session_token" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"notes" text,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_table_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"table_id" text NOT NULL,
	"opened_by_user_id" text NOT NULL,
	"closed_by_user_id" text,
	"session_status" text DEFAULT 'open' NOT NULL,
	"guest_count" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"preliminary_total" numeric(18, 6) DEFAULT 0 NOT NULL,
	"notes" text,
	"source" text DEFAULT 'cashier' NOT NULL,
	"unread_request_count" integer DEFAULT 0,
	"final_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"zone_name" text,
	"capacity" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"public_qr_token" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"employee_id" text NOT NULL,
	"employee_name" text,
	"amount" numeric(18, 6) NOT NULL,
	"currency" text DEFAULT 'USD',
	"type" text NOT NULL,
	"period" text,
	"cash_box_id" text,
	"journal_entry_id" integer,
	"journal_entry_number" text,
	"date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"from_branch_id" text,
	"to_branch_id" text,
	"transfer_number" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name" text,
	"item_code" text,
	"from_item_id" text,
	"to_item_id" text,
	"from_warehouse_id" text,
	"from_warehouse_name" text,
	"to_warehouse_id" text,
	"to_warehouse_name" text,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_name" text,
	"date" timestamp with time zone DEFAULT now(),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sub_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"category_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"source_module" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"requires_manual_review" boolean DEFAULT false NOT NULL,
	"affected_document_type" text,
	"affected_document_id" text,
	"compensation_status" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_super_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_bootstrap" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "system_super_admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "textile_colors" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"code" text,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "textile_stock_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"warehouse_id" text NOT NULL,
	"warehouse_name" text,
	"item_id" text NOT NULL,
	"color_id" text NOT NULL,
	"base_uom" text NOT NULL,
	"roll_count" numeric(18, 6) DEFAULT 0 NOT NULL,
	"total_length" numeric(18, 6) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "textile_stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"warehouse_id" text NOT NULL,
	"warehouse_name" text,
	"item_id" text NOT NULL,
	"color_id" text NOT NULL,
	"base_uom" text NOT NULL,
	"roll_delta" numeric(18, 6) DEFAULT 0 NOT NULL,
	"length_delta" numeric(18, 6) DEFAULT 0 NOT NULL,
	"document_type" text NOT NULL,
	"document_id" text NOT NULL,
	"document_number" text,
	"document_line_id" text,
	"movement_type" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "units" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"is_base" integer DEFAULT 0,
	"base_unit_id" text,
	"factor" numeric(18, 6) DEFAULT 1,
	"multiplier" numeric(18, 6) DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_branch_access" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"role_override" text,
	"permission_override" text,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_company_access" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"role_override" text,
	"permission_override" text,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'warehouse_keeper' NOT NULL,
	"is_active" boolean DEFAULT true,
	"permissions" text,
	"company_id" text,
	"default_branch_id" text,
	"branch_scope" text DEFAULT 'restricted',
	"pos_warehouse_id" text,
	"pos_warehouse_name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vouchers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"type" text NOT NULL,
	"date" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"amount_base" numeric(18, 6),
	"amount_transaction" numeric(18, 6),
	"original_amount" numeric(18, 6),
	"currency" text,
	"exchange_rate" numeric(18, 6),
	"cash_box_id" text,
	"cash_box_name" text,
	"client_id" text,
	"client_name" text,
	"category" text,
	"description" text,
	"reference_number" text,
	"linked_invoice_id" text,
	"journal_entry_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP,
	"settlement_exchange_rate" numeric(18, 6),
	"fx_difference_amount" numeric(18, 6),
	"fx_difference_type" text,
	"fx_journal_entry_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_dispatch_notice_line_decompositions" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_id" text NOT NULL,
	"line_id" text NOT NULL,
	"company_id" text,
	"branch_id" text,
	"sequence" integer NOT NULL,
	"length_value" numeric(18, 6) NOT NULL,
	"unit" text NOT NULL,
	"roll_label" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_dispatch_notice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_id" text NOT NULL,
	"company_id" text,
	"branch_id" text,
	"warehouse_id" text,
	"item_id" text NOT NULL,
	"item_name" text,
	"color_id" text NOT NULL,
	"color_name" text,
	"requested_roll_count" numeric(18, 6) DEFAULT 0 NOT NULL,
	"fulfilled_roll_count" numeric(18, 6) DEFAULT 0 NOT NULL,
	"fulfilled_total_length" numeric(18, 6) DEFAULT 0 NOT NULL,
	"base_uom" text NOT NULL,
	"textile_unit_price_per_length" numeric(18, 6),
	"line_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"source_invoice_line_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_dispatch_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"branch_id" text,
	"warehouse_id" text NOT NULL,
	"warehouse_name" text,
	"customer_id" text,
	"customer_name" text,
	"source_document_type" text,
	"source_document_id" text,
	"dispatch_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" text,
	"requested_by_name" text,
	"prepared_by" text,
	"prepared_by_name" text,
	"approved_by" text,
	"approved_by_name" text,
	"rejected_by" text,
	"rejected_by_name" text,
	"converted_by" text,
	"converted_by_name" text,
	"requested_at" timestamp with time zone,
	"prepared_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"rejected_reason" text,
	"notes" text,
	"print_meta" text,
	"linked_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"code" text,
	"name" text NOT NULL,
	"location" text,
	"manager" text,
	"branch_id" text,
	"is_active" boolean DEFAULT true,
	"warehouse_kind" text DEFAULT 'NORMAL',
	"owner_party_id" text,
	"owner_party_type" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "item_barcodes_barcode_unique" ON "item_barcodes" ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "item_serials_serial_number_unique" ON "item_serials" ("serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "textile_stock_balances_scope_unique" ON "textile_stock_balances" ("company_id","branch_id","warehouse_id","item_id","color_id","base_uom");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_branch_access_user_branch_unique" ON "user_branch_access" ("user_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_company_access_user_company_unique" ON "user_company_access" ("user_id","company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_boxes" ADD CONSTRAINT "cash_boxes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parties" ADD CONSTRAINT "parties_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_table_request_items" ADD CONSTRAINT "restaurant_table_request_items_request_id_restaurant_table_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "restaurant_table_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_table_requests" ADD CONSTRAINT "restaurant_table_requests_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_table_requests" ADD CONSTRAINT "restaurant_table_requests_session_id_restaurant_table_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "restaurant_table_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_table_sessions" ADD CONSTRAINT "restaurant_table_sessions_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
