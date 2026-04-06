-- Idempotent QR submits: client_request_id unique per open session
ALTER TABLE restaurant_table_requests ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_requests_session_client_req
  ON restaurant_table_requests(session_id, client_request_id)
  WHERE client_request_id IS NOT NULL AND trim(client_request_id) != '';
