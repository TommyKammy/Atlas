-- OAuth 2.1 authorization server storage for MCP.
--
-- Clients are either CIMD (client_id is the https metadata URL) or DCR
-- (client_id is a random opaque value). CIMD rows cache the fetched metadata
-- for 24 hours; DCR rows are written once at registration. Secrets are never
-- stored: authorization codes and refresh tokens keep SHA-256 hashes only.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id        TEXT PRIMARY KEY,
  source           TEXT NOT NULL CHECK (source IN ('cimd', 'dcr')),
  client_name      TEXT,
  redirect_uris    TEXT[] NOT NULL CHECK (cardinality(redirect_uris) > 0),
  application_type TEXT NOT NULL CHECK (application_type IN ('native', 'web')),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_source
  ON oauth_clients(source, created_at);

-- Short-lived authorization codes. Only the hash is stored. family_id links
-- the code to the refresh-token family issued from it so a replayed code can
-- revoke that family (tokens.issueTokens receives it from consume).
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id            BIGSERIAL PRIMARY KEY,
  code_hash     TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id     TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  redirect_uri  TEXT NOT NULL,
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes        TEXT[] NOT NULL
                CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND 'read' = ANY(scopes)),
  resource      TEXT NOT NULL,
  family_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_family
  ON oauth_authorization_codes(family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expires
  ON oauth_authorization_codes(expires_at);

-- Rotating refresh tokens. Every refresh issues a new token in the same
-- family (30 days from issue). Reuse of a used token revokes the whole family.
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id           BIGSERIAL PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  family_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  client_id    TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scopes       TEXT[] NOT NULL
               CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND 'read' = ANY(scopes)),
  resource     TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  used_at      TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family
  ON oauth_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_user
  ON oauth_refresh_tokens(user_id, id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires
  ON oauth_refresh_tokens(expires_at);

-- OAuth access tokens live in mcp_tokens alongside PATs. resource is the
-- RFC 8707 audience (…/mcp or …/mcp/readonly); PATs keep it NULL. The client
-- and family references allow logout-and-revoke to invalidate the whole
-- refresh-token family.
ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS resource TEXT,
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT
    REFERENCES oauth_clients(client_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS oauth_family_id UUID;

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_oauth_family
  ON mcp_tokens(oauth_family_id) WHERE oauth_family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_oauth_client
  ON mcp_tokens(oauth_client_id) WHERE oauth_client_id IS NOT NULL;
