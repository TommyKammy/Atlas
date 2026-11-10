CREATE TABLE project_rule_drafts (
  id UUID PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id BIGINT REFERENCES project_rules(id) ON DELETE CASCADE,
  base_rule_version INTEGER,
  base_rule_updated_at TIMESTAMPTZ,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  definition JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_revision INTEGER CHECK (published_revision > 0 AND published_revision <= revision),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((rule_id IS NULL AND base_rule_version IS NULL AND base_rule_updated_at IS NULL)
    OR (rule_id IS NOT NULL AND base_rule_version IS NOT NULL AND base_rule_updated_at IS NOT NULL))
);

CREATE UNIQUE INDEX project_rule_drafts_user_rule
  ON project_rule_drafts(user_id, rule_id) WHERE rule_id IS NOT NULL;
CREATE INDEX project_rule_drafts_project_user ON project_rule_drafts(project_id, user_id, updated_at DESC);
