DROP TABLE `partner_transactions`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE employees ADD `email` text;--> statement-breakpoint
ALTER TABLE employees ADD `id_number` text;--> statement-breakpoint
ALTER TABLE employees ADD `salary_frequency` text DEFAULT 'monthly';--> statement-breakpoint
ALTER TABLE invoices ADD `target_warehouse_id` text;--> statement-breakpoint
ALTER TABLE salary_transactions ADD `currency` text DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE salary_transactions ADD `period` text;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `unit_name`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `currency`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `dimensions`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `color`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `origin`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `manufacturer`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `gross_weight`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `net_weight`;--> statement-breakpoint
ALTER TABLE `partners` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `partners` DROP COLUMN `join_date`;--> statement-breakpoint
ALTER TABLE `partners` DROP COLUMN `linked_client_id`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `created_by`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `reference_number`;