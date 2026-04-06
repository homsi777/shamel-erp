CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`position` text,
	`base_salary` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD',
	`status` text DEFAULT 'active',
	`join_date` text DEFAULT CURRENT_TIMESTAMP,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `salary_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text,
	`employee_name` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`date` text DEFAULT CURRENT_TIMESTAMP,
	`cash_box_id` text,
	`voucher_id` text,
	`notes` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
