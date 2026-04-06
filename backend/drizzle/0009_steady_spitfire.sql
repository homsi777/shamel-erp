CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text,
	`ref_type` text,
	`ref_id` text,
	`posted_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`debit` real DEFAULT 0 NOT NULL,
	`credit` real DEFAULT 0 NOT NULL,
	`memo` text,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE accounts ADD `path` text;--> statement-breakpoint
ALTER TABLE cash_boxes ADD `currency` text DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE expenses ADD `journal_entry_id` text REFERENCES journal_entries(id);--> statement-breakpoint
ALTER TABLE expenses ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE expenses ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE invoices ADD `journal_entry_id` text REFERENCES journal_entries(id);--> statement-breakpoint
ALTER TABLE partner_transactions ADD `journal_entry_id` text REFERENCES journal_entries(id);--> statement-breakpoint
ALTER TABLE salary_transactions ADD `journal_entry_id` text REFERENCES journal_entries(id);--> statement-breakpoint
ALTER TABLE vouchers ADD `journal_entry_id` text REFERENCES journal_entries(id);--> statement-breakpoint
CREATE INDEX `idx_je_date` ON `journal_entries` (`date`);--> statement-breakpoint
CREATE INDEX `idx_je_ref` ON `journal_entries` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE INDEX `idx_jl_entry` ON `journal_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_jl_account` ON `journal_lines` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_acc_parent` ON `accounts` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_acc_code` ON `accounts` (`code`);--> statement-breakpoint
CREATE INDEX `idx_acc_type` ON `accounts` (`type`);--> statement-breakpoint
CREATE INDEX `idx_exp_date` ON `expenses` (`date`);--> statement-breakpoint
CREATE INDEX `idx_exp_status` ON `expenses` (`status`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/