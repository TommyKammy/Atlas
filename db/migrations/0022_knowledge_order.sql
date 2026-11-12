-- Freeze the existing displayed order once. Content, history and timestamps stay intact.
ALTER TABLE project_knowledge ADD COLUMN position BIGINT;
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY updated_at DESC, id DESC) AS position
  FROM project_knowledge
)
UPDATE project_knowledge k SET position = r.position FROM ranked r WHERE k.id = r.id;
ALTER TABLE project_knowledge ALTER COLUMN position SET NOT NULL;
ALTER TABLE project_knowledge ALTER COLUMN position SET DEFAULT 0;
CREATE INDEX idx_knowledge_order ON project_knowledge(project_id, position, id);
