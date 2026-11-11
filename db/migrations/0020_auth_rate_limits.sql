-- Database-backed admission is shared across app instances and does not depend
-- on Redis being available. Only hashed subjects are retained.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
  identity_hash TEXT NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  window_id UUID NOT NULL DEFAULT gen_random_uuid(),
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, identity_hash),
  CHECK (expires_at > window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits(expires_at);
