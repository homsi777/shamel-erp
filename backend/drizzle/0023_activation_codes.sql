CREATE TABLE IF NOT EXISTS activation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  activation_type TEXT NOT NULL DEFAULT 'local',
  is_used INTEGER DEFAULT 0,
  used_at TEXT,
  computer_name TEXT,
  app_version TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
