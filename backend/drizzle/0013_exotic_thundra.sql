CREATE TABLE `reconciliation_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`report_type` text NOT NULL,
	`mark_at` text NOT NULL,
	`row_ref_id` text,
	`note` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`is_active` integer DEFAULT true
);
