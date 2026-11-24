-- Phase 3 write tools need three pieces of shared infrastructure:
--   1. the execution source (web, MCP, automation) on audit and task history,
--   2. a short-lived idempotency record for create tools,
--   3. the database-backed write rate limit (see lib/auth-rate-limit.ts).

-- Existing rows predate MCP writes and are attributed to the web UI.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS mcp_token_id BIGINT REFERENCES mcp_tokens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_name TEXT;

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_via_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_via_check
  CHECK (via IN ('web', 'mcp', 'automation'));

ALTER TABLE task_events
  ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS client_name TEXT;

ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_via_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_via_check
  CHECK (via IN ('web', 'mcp', 'automation'));

-- One row per successful idempotent tool call. A row with response IS NULL is
-- an in-flight reservation: concurrent retries must not execute the tool a
-- second time. Failed calls delete their reservation so a retry can proceed.
-- The janitor removes rows after 24 hours.
CREATE TABLE IF NOT EXISTS mcp_idempotency (
  id            BIGSERIAL PRIMARY KEY,
  token_id      BIGINT NOT NULL REFERENCES mcp_tokens(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_idempotency_key_length
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT mcp_idempotency_request_hash_format
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_idempotency_key_uidx
  ON mcp_idempotency(token_id, tool_name, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_mcp_idempotency_created
  ON mcp_idempotency(created_at);
