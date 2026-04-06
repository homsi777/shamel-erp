ALTER TABLE `parties` ADD COLUMN `account_id` integer REFERENCES accounts(id);
ALTER TABLE `salary_transactions` ADD COLUMN `journal_entry_id` integer;
ALTER TABLE `salary_transactions` ADD COLUMN `journal_entry_number` text;
