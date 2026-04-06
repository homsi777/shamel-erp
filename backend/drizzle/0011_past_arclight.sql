DROP TABLE `stock_transfers`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_acc_parent`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_acc_type`;--> statement-breakpoint
/*
 SQLite does not support "Set default to column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
/*
 SQLite does not support "Set not null to column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE branches ADD `location` text;--> statement-breakpoint
ALTER TABLE branches ADD `manager` text;--> statement-breakpoint
ALTER TABLE branches ADD `phone` text;--> statement-breakpoint
ALTER TABLE employees ADD `currency` text DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE employees ADD `salary_frequency` text;--> statement-breakpoint
ALTER TABLE employees ADD `join_date` text;--> statement-breakpoint
ALTER TABLE invoice_items ADD `unit_name` text;--> statement-breakpoint
ALTER TABLE invoices ADD `currency` text DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE partners ADD `join_date` text;--> statement-breakpoint
ALTER TABLE salary_transactions ADD `currency` text;--> statement-breakpoint
ALTER TABLE salary_transactions ADD `notes` text;--> statement-breakpoint
ALTER TABLE warehouses ADD `branch_id` text;--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/