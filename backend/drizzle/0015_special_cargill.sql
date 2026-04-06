CREATE TABLE `party_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_number` text NOT NULL,
	`date` text NOT NULL,
	`from_party_id` text NOT NULL,
	`from_party_name` text,
	`to_party_id` text NOT NULL,
	`to_party_name` text,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD',
	`note` text,
	`voucher_id` text,
	`status` text DEFAULT 'active',
	`created_by_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`from_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voucher_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
