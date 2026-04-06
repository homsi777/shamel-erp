CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` text,
	`level` integer DEFAULT 0,
	`is_leaf` integer DEFAULT true,
	`is_active` integer DEFAULT true,
	`debit` real DEFAULT 0,
	`credit` real DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `expense_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` real NOT NULL,
	`notes` text,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`date` text NOT NULL,
	`description` text,
	`total_amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD',
	`status` text DEFAULT 'DRAFT',
	`payment_type` text DEFAULT 'CASH',
	`cash_box_id` text,
	`warehouse_id` text,
	`manufacturing_order_id` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`posted_at` text
);
--> statement-breakpoint
CREATE TABLE `partner_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text,
	`partner_name` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`date` text DEFAULT CURRENT_TIMESTAMP,
	`description` text,
	`related_voucher_id` text,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_code_unique` ON `accounts` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_code_unique` ON `expenses` (`code`);