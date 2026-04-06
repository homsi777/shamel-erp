CREATE TABLE `cash_boxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'sub',
	`balance` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD'
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`type` text NOT NULL,
	`address` text,
	`balance` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text,
	`fabric_id` text,
	`fabric_name` text,
	`rolls_sold` integer NOT NULL,
	`meters_sold` real NOT NULL,
	`yards_sold` real NOT NULL,
	`price_at_sale` real NOT NULL,
	`total` real NOT NULL,
	`cost_at_sale` real,
	`is_return` integer DEFAULT false,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fabric_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_number` text NOT NULL,
	`original_invoice_number` text,
	`type` text NOT NULL,
	`client_id` text,
	`client_name` text,
	`date` text NOT NULL,
	`status` text DEFAULT 'posted',
	`total_amount` real DEFAULT 0 NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`remaining_amount` real DEFAULT 0 NOT NULL,
	`payment_type` text DEFAULT 'cash',
	`target_warehouse_id` text,
	`target_warehouse_name` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`warehouse_name` text,
	`type` text,
	`color` text,
	`rolls_count` integer DEFAULT 0 NOT NULL,
	`meters_per_roll` real DEFAULT 50 NOT NULL,
	`cost_price` real DEFAULT 0 NOT NULL,
	`price_per_meter` real DEFAULT 0 NOT NULL,
	`wholesale_price` real DEFAULT 0,
	`min_stock_alert` integer DEFAULT 3,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `partner_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`partner_name` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`description` text,
	`related_voucher_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`percentage` real DEFAULT 0 NOT NULL,
	`capital_amount` real DEFAULT 0 NOT NULL,
	`current_balance` real DEFAULT 0 NOT NULL,
	`join_date` text NOT NULL,
	`status` text DEFAULT 'active',
	`linked_client_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`type` text NOT NULL,
	`rolls_delta` integer NOT NULL,
	`meters_delta` real NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'warehouse_keeper' NOT NULL,
	`is_active` integer DEFAULT true,
	`permissions` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`cash_box_id` text,
	`cash_box_name` text,
	`client_id` text,
	`client_name` text,
	`category` text,
	`description` text,
	`reference_number` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`cash_box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`manager` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);