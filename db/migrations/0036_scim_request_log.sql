-- One row per SCIM request, including failed authentication. Request and
-- response bodies, Authorization headers and token values are never stored.
CREATE TABLE IF NOT EXISTS scim_request_log (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_id     BIGINT REFERENCES scim_tokens(id) ON DELETE SET NULL,
  idp          TEXT CHECK (idp IN ('entra', 'okta', 'generic')),
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  "filter"     TEXT,
  status       INTEGER NOT NULL,
  scim_type    TEXT,
  detail       TEXT,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  client_ip    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scim_request_log_workspace_id
  ON scim_request_log(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_scim_request_log_created
  ON scim_request_log(created_at);
CREATE INDEX IF NOT EXISTS idx_scim_request_log_token
  ON scim_request_log(token_id) WHERE token_id IS NOT NULL;
