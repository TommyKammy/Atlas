-- Additive only. Legacy bodies and timestamps are deliberately left untouched.
ALTER TABLE project_knowledge ADD COLUMN IF NOT EXISTS body_doc JSONB;
ALTER TABLE project_knowledge ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_knowledge ADD COLUMN IF NOT EXISTS create_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS project_knowledge_create_key ON project_knowledge(create_key);

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id BIGSERIAL PRIMARY KEY,
  knowledge_id BIGINT NOT NULL REFERENCES project_knowledge(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  body_doc JSONB,
  saved_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (knowledge_id, revision)
);
