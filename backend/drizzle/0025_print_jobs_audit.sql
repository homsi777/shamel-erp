-- Print jobs audit: document type, template, payload summary, connection, source, actor, printed_at, invoice_number
ALTER TABLE print_jobs ADD COLUMN document_type text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN template_id text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN payload_summary text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN printer_connection_type text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN invoice_number text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN printed_at text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN source text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN created_by_id text;--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN created_by_name text;--> statement-breakpoint
