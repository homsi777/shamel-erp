CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_number` text NOT NULL,
	`from_warehouse_id` text NOT NULL,
	`from_warehouse_name` text,
	`to_warehouse_id` text NOT NULL,
	`to_warehouse_name` text,
	`item_id` text NOT NULL,
	`item_name` text,
	`quantity` real NOT NULL,
	`unit_name` text,
	`notes` text,
	`created_by` text,
	`date` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `sub_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
/*
 SQLite does not support "Drop not null from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
/*
 SQLite does not support "Changing existing column type" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
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
ALTER TABLE invoice_items ADD `item_id` text REFERENCES items(id);--> statement-breakpoint
ALTER TABLE invoice_items ADD `item_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE invoice_items ADD `unit_name` text;--> statement-breakpoint
ALTER TABLE invoice_items ADD `quantity` real NOT NULL;--> statement-breakpoint
ALTER TABLE invoice_items ADD `unit_price` real NOT NULL;--> statement-breakpoint
ALTER TABLE invoices ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE items ADD `barcode` text;--> statement-breakpoint
ALTER TABLE items ADD `serial_number` text;--> statement-breakpoint
ALTER TABLE items ADD `category_id` text REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE items ADD `sub_category_id` text REFERENCES sub_categories(id);--> statement-breakpoint
ALTER TABLE items ADD `unit_id` text REFERENCES units(id);--> statement-breakpoint
ALTER TABLE items ADD `unit_name` text;--> statement-breakpoint
ALTER TABLE items ADD `quantity` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE items ADD `sale_price` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE items ADD `image_url` text;--> statement-breakpoint
ALTER TABLE items ADD `model` text;--> statement-breakpoint
ALTER TABLE items ADD `dimensions` text;--> statement-breakpoint
ALTER TABLE items ADD `origin` text;--> statement-breakpoint
ALTER TABLE items ADD `manufacturer` text;--> statement-breakpoint
ALTER TABLE items ADD `gross_weight` real;--> statement-breakpoint
ALTER TABLE items ADD `net_weight` real;--> statement-breakpoint
ALTER TABLE items ADD `notes` text;--> statement-breakpoint
ALTER TABLE warehouses ADD `code` text;--> statement-breakpoint
ALTER TABLE warehouses ADD `notes` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_num_idx` ON `invoices` (`invoice_number`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `cash_boxes` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `cash_boxes` DROP COLUMN `currency`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `address`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `fabric_id`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `fabric_name`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `rolls_sold`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `meters_sold`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `yards_sold`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `price_at_sale`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `cost_at_sale`;--> statement-breakpoint
ALTER TABLE `invoice_items` DROP COLUMN `is_return`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `original_invoice_number`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `status`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `payment_type`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `target_warehouse_id`;--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `target_warehouse_name`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `rolls_count`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `meters_per_roll`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `price_per_meter`;