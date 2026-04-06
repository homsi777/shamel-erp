CREATE TABLE `remote_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`employee_name` text,
	`ip_address` text NOT NULL,
	`sync_interval` integer DEFAULT 30,
	`show_financials` integer DEFAULT true,
	`show_inventory` integer DEFAULT true,
	`show_invoices` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
DROP TABLE `invoice_items`;--> statement-breakpoint
DROP TABLE `party_accounts`;--> statement-breakpoint
DROP TABLE `party_transfers`;--> statement-breakpoint
DROP TABLE `reconciliation_marks`;--> statement-breakpoint
DROP TABLE `sub_categories`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE invoices ADD `client_id` text;--> statement-breakpoint
ALTER TABLE invoices ADD `client_name` text;--> statement-breakpoint
ALTER TABLE invoices ADD `target_warehouse_name` text;--> statement-breakpoint
ALTER TABLE vouchers ADD `client_id` text;--> statement-breakpoint
ALTER TABLE vouchers ADD `client_name` text;--> statement-breakpoint
ALTER TABLE `branches` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `cash_boxes` DROP COLUMN `account_id`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `party_id`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `party_name`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `journal_entry_id`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `currency`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `serial_number`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `sub_category_id`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `unit_id`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `image_url`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `min_stock_alert`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `dimensions`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `color`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `origin`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `manufacturer`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `gross_weight`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `net_weight`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `party_id`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `party_name`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `journal_entry_id`;