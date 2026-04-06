-- POS dual print: queue fields on invoices + queue_counters + print_jobs

ALTER TABLE invoices ADD COLUMN queue_number text;--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN queue_scope text;--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN queue_date text;--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN kitchen_printed_at text;--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN customer_printed_at text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS queue_counters (
  id text PRIMARY KEY NOT NULL,
  company_id text,
  branch_id text,
  scope_key text NOT NULL UNIQUE,
  last_value integer DEFAULT 0 NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS print_jobs (
  id text PRIMARY KEY NOT NULL,
  company_id text,
  branch_id text,
  invoice_id text,
  print_type text NOT NULL,
  printer_id text,
  printer_address text,
  copies integer DEFAULT 1,
  status text DEFAULT 'pending' NOT NULL,
  error_message text,
  created_at text DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_print_jobs_invoice ON print_jobs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_queue_counters_company ON queue_counters(company_id);
