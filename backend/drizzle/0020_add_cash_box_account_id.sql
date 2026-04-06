ALTER TABLE cash_boxes ADD COLUMN account_id INTEGER REFERENCES accounts(id);
