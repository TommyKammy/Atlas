CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_id ON task_dependencies(depends_on_id);
