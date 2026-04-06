DROP TABLE `expense_lines`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
DROP TABLE `sub_categories`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
DROP INDEX IF EXISTS `idx_je_date`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_je_ref`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_jl_entry`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_jl_account`;--> statement-breakpoint
/*
 SQLite does not support "Drop default from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
/*
 SQLite does not support "Drop not null from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE clients ADD `address` text;--> statement-breakpoint
ALTER TABLE clients ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `branches` DROP COLUMN `location`;--> statement-breakpoint
ALTER TABLE `branches` DROP COLUMN `manager`;--> statement-breakpoint
ALTER TABLE `branches` DROP COLUMN `phone`;--> statement-breakpoint
ALTER TABLE `branches` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `categories` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `phone`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `id_number`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `birth_date`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `address`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `marital_status`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `currency`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `salary_frequency`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `education`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `courses`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `experience`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `image_url`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `id_front_url`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `id_back_url`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `join_date`;--> statement-breakpoint
ALTER TABLE `employees` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `serial_number`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `category_id`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `sub_category_id`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `unit_id`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `warehouse_name`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `wholesale_price`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `min_stock_alert`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `image_url`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `last_updated`;--> statement-breakpoint
ALTER TABLE `partner_transactions` DROP COLUMN `partner_name`;--> statement-breakpoint
ALTER TABLE `partner_transactions` DROP COLUMN `related_voucher_id`;--> statement-breakpoint
ALTER TABLE `partners` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `salary_transactions` DROP COLUMN `employee_name`;--> statement-breakpoint
ALTER TABLE `salary_transactions` DROP COLUMN `currency`;--> statement-breakpoint
ALTER TABLE `salary_transactions` DROP COLUMN `cash_box_id`;--> statement-breakpoint
ALTER TABLE `salary_transactions` DROP COLUMN `voucher_id`;--> statement-breakpoint
ALTER TABLE `salary_transactions` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `salary_transactions` DROP COLUMN `period`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `from_warehouse_name`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `to_warehouse_name`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `item_name`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `unit_name`;--> statement-breakpoint
ALTER TABLE `system_settings` DROP COLUMN `updated_at`;--> statement-breakpoint
ALTER TABLE `units` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `code`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `branch_id`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `created_at`;