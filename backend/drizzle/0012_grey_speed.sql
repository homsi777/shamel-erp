CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`phone` text,
	`email` text,
	`address` text,
	`tax_no` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `party_accounts` (
	`party_id` text PRIMARY KEY NOT NULL,
	`ar_account_id` text,
	`ap_account_id` text,
	`credit_limit` real DEFAULT 0,
	`default_currency` text DEFAULT 'USD',
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ar_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ap_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `branches`;--> statement-breakpoint
DROP TABLE `clients`;--> statement-breakpoint
DROP TABLE `employees`;--> statement-breakpoint
DROP TABLE `partner_transactions`;--> statement-breakpoint
DROP TABLE `partners`;--> statement-breakpoint
DROP TABLE `salary_transactions`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE cash_boxes ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE invoices ADD `party_id` text REFERENCES parties(id);--> statement-breakpoint
ALTER TABLE invoices ADD `party_name` text;--> statement-breakpoint
ALTER TABLE vouchers ADD `party_id` text REFERENCES parties(id);--> statement-breakpoint
ALTER TABLE vouchers ADD `party_name` text;--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `client_id`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `client_name`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `client_id`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `client_name`;