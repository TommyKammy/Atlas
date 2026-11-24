-- MCP connections are disabled by default. An administrator opts in per
-- workspace, and personal access tokens have a separate switch.
ALTER TABLE workspace_security
  ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mcp_pat_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- MCP bearer tokens (personal access tokens today, OAuth access tokens later).
-- Only the SHA-256 hash is stored; the plaintext value is returned once when
-- the token is issued. PATs do not expire and stay valid until revoked.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('pat', 'oauth')),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[]
               CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND 'read' = ANY(scopes)),
  client_name  TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  -- A PAT has no expiry; only OAuth access tokens carry expires_at.
  CONSTRAINT mcp_tokens_pat_no_expiry CHECK (kind <> 'pat' OR expires_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_hash_uidx ON mcp_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id, id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_workspace ON mcp_tokens(workspace_id, id);

-- One row per MCP request, including failed authentication. Request and
-- response bodies, tool arguments, Authorization headers and token values are
-- never stored here. mcp_request_log is pruned on the same 30-day schedule as
-- scim_request_log.
CREATE TABLE IF NOT EXISTS mcp_request_log (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_id     BIGINT REFERENCES mcp_tokens(id) ON DELETE SET NULL,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  endpoint     TEXT NOT NULL CHECK (endpoint IN ('default', 'readonly')),
  rpc_method   TEXT,
  tool_name    TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'denied', 'unauthenticated')),
  error_code   TEXT,
  duration_ms  INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  client_name  TEXT,
  client_ip    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_workspace
  ON mcp_request_log(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_created
  ON mcp_request_log(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_token
  ON mcp_request_log(token_id) WHERE token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_user
  ON mcp_request_log(user_id) WHERE user_id IS NOT NULL;
