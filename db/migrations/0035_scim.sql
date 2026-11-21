-- SCIM 2.0 user provisioning. Tokens are stored as SHA-256 hashes only; the
-- plaintext value is returned once when an administrator issues it.
ALTER TABLE workspace_security
  ADD COLUMN IF NOT EXISTS scim_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS scim_tokens (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  idp          TEXT NOT NULL DEFAULT 'generic'
               CHECK (idp IN ('entra', 'okta', 'generic')),
  token_hash   TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_tokens_hash_uidx ON scim_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_workspace ON scim_tokens(workspace_id, id);

-- One SCIM binding per Atlas account. The IdP's externalId is distinct from
-- the Atlas user id, and user_name stores the IdP's SCIM userName (often a
-- UPN), which may differ from users.email (CITEXT).
CREATE TABLE IF NOT EXISTS scim_identities (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  idp          TEXT NOT NULL DEFAULT 'generic'
               CHECK (idp IN ('entra', 'okta', 'generic')),
  external_id  TEXT,
  user_name    CITEXT NOT NULL,
  given_name   TEXT,
  family_name  TEXT,
  formatted_name TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
ALTER TABLE scim_identities ADD COLUMN IF NOT EXISTS given_name TEXT;
ALTER TABLE scim_identities ADD COLUMN IF NOT EXISTS family_name TEXT;
ALTER TABLE scim_identities ADD COLUMN IF NOT EXISTS formatted_name TEXT;
ALTER TABLE scim_identities ADD COLUMN IF NOT EXISTS display_name TEXT;
DROP INDEX IF EXISTS scim_identities_external_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS scim_identities_external_uidx
  ON scim_identities(workspace_id, idp, external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;
-- SCIM userName is unique among active bindings (CITEXT is case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS scim_identities_user_name_active_uidx
  ON scim_identities(workspace_id, user_name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scim_identities_workspace
  ON scim_identities(workspace_id, deleted_at);
