CREATE TABLE `partner_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`partner_name` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`description` text,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`percentage` real NOT NULL,
	`capital_amount` real DEFAULT 0,
	`current_balance` real DEFAULT 0,
	`join_date` text,
	`status` text DEFAULT 'active',
	`linked_client_id` text
);
--> statement-breakpoint
CREATE TABLE `sub_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `branches`;--> statement-breakpoint
DROP TABLE `journal_entries`;--> statement-breakpoint
DROP TABLE `journal_lines`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_acc_code`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_users_username`;--> statement-breakpoint
ALTER TABLE accounts ADD `balance` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE parties ADD `balance` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `path`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `level`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `is_leaf`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `wholesale_price`;--> statement-breakpoint
ALTER TABLE `parties` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `parties` DROP COLUMN `address`;--> statement-breakpoint
ALTER TABLE `parties` DROP COLUMN `tax_no`;--> statement-breakpoint
ALTER TABLE `parties` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `category`;