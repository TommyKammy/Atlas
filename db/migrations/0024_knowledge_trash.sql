-- Additive migration: existing content, order, timestamps and history are untouched.
ALTER TABLE project_knowledge ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE project_knowledge ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS project_knowledge_active_order
  ON project_knowledge(project_id, position, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_knowledge_trash
  ON project_knowledge(project_id, deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;
