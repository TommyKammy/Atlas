ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS mfa_enrollment_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS saml_cache (
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_saml_cache_expiry ON saml_cache(expires_at);
