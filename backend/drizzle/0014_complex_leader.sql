CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`manager` text,
	`phone` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `sub_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE items ADD `serial_number` text;--> statement-breakpoint
ALTER TABLE items ADD `category_id` text;--> statement-breakpoint
ALTER TABLE items ADD `sub_category_id` text;--> statement-breakpoint
ALTER TABLE items ADD `unit_id` text;--> statement-breakpoint
ALTER TABLE items ADD `wholesale_price` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE items ADD `warehouse_name` text;--> statement-breakpoint
ALTER TABLE items ADD `image_url` text;--> statement-breakpoint
ALTER TABLE items ADD `min_stock_alert` real DEFAULT 5;--> statement-breakpoint
ALTER TABLE items ADD `model` text;--> statement-breakpoint
ALTER TABLE items ADD `dimensions` text;--> statement-breakpoint
ALTER TABLE items ADD `color` text;--> statement-breakpoint
ALTER TABLE items ADD `origin` text;--> statement-breakpoint
ALTER TABLE items ADD `manufacturer` text;--> statement-breakpoint
ALTER TABLE items ADD `gross_weight` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE items ADD `net_weight` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE items ADD `notes` text;--> statement-breakpoint
ALTER TABLE items ADD `last_updated` text DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/