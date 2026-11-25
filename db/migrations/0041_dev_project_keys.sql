-- Development projects and their issue keys (docs/dev-projects-phase0.md §3–§4).
--
-- A development project hands out keys such as ATL-123 to every task whose
-- primary project it is, whichever code path created the task. The key's
-- namespace is fixed when it is issued: moving the task elsewhere or renaming
-- the prefix keeps the key resolvable. Numbers are never reused.

-- Settings and key namespace. The row outlives a hard-deleted project
-- (project_id becomes NULL) so keys of tasks moved elsewhere survive.
CREATE TABLE IF NOT EXISTS dev_projects (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT UNIQUE REFERENCES projects(id) ON DELETE SET NULL,
  workspace_id   BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prefix         TEXT NOT NULL CHECK (prefix ~ '^[A-Z][A-Z0-9]{1,9}$'),
  branch_prefix  TEXT NOT NULL CHECK (branch_prefix ~ '^[a-z][a-z0-9]{1,9}$'),
  start_status   TEXT,
  enabled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_by     BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- The numbering counter is kept apart from the settings row so the key
-- trigger never locks dev_projects (§4.4).
CREATE TABLE IF NOT EXISTS dev_key_counters (
  namespace_id   BIGINT PRIMARY KEY REFERENCES dev_projects(id) ON DELETE CASCADE,
  next_number    INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

-- Every prefix a namespace has used. Old prefixes keep resolving and cannot
-- be taken by another project.
CREATE TABLE IF NOT EXISTS dev_project_prefixes (
  workspace_id   BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prefix         TEXT NOT NULL CHECK (prefix ~ '^[A-Z][A-Z0-9]{1,9}$'),
  namespace_id   BIGINT NOT NULL REFERENCES dev_projects(id) ON DELETE NO ACTION,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, prefix)
);
CREATE INDEX IF NOT EXISTS idx_dev_project_prefixes_namespace
  ON dev_project_prefixes(namespace_id);

CREATE TABLE IF NOT EXISTS task_keys (
  task_id        BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  namespace_id   BIGINT NOT NULL REFERENCES dev_projects(id) ON DELETE NO ACTION,
  number         INTEGER NOT NULL CHECK (number > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (namespace_id, number)
);

-- Assign a key when a task is created in, or moved into, a development
-- project and has none yet (§4.1).
CREATE OR REPLACE FUNCTION atlas_assign_task_key() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ns BIGINT;
  n  INTEGER;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Serialize with enableDevProject, which holds FOR UPDATE on this row while
  -- it backfills (§4.2). Taken explicitly so correctness does not depend on
  -- the foreign-key check trigger firing first.
  PERFORM 1 FROM projects WHERE id = NEW.project_id FOR KEY SHARE;
  IF EXISTS (SELECT 1 FROM task_keys WHERE task_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT d.id INTO ns FROM dev_projects d WHERE d.project_id = NEW.project_id;
  IF ns IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE dev_key_counters SET next_number = next_number + 1
   WHERE namespace_id = ns
   RETURNING next_number - 1 INTO n;
  -- A concurrent enable may have keyed this task already; keep that key.
  INSERT INTO task_keys (task_id, namespace_id, number) VALUES (NEW.id, ns, n)
    ON CONFLICT (task_id) DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tasks_assign_key_insert ON tasks;
CREATE TRIGGER tasks_assign_key_insert
  AFTER INSERT ON tasks
  FOR EACH ROW WHEN (NEW.project_id IS NOT NULL)
  EXECUTE FUNCTION atlas_assign_task_key();

DROP TRIGGER IF EXISTS tasks_assign_key_move ON tasks;
CREATE TRIGGER tasks_assign_key_move
  AFTER UPDATE OF project_id ON tasks
  FOR EACH ROW WHEN (NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id)
  EXECUTE FUNCTION atlas_assign_task_key();

-- Enable a project as a development project and key its existing tasks
-- (§4.2). Runs in the caller's transaction.
--
-- Lock rules, relied on by the regression tests:
-- * FOR UPDATE on the projects row (not FOR NO KEY UPDATE) conflicts with the
--   FOR KEY SHARE taken by the key trigger and by the tasks.project_id foreign
--   key, so in-flight task inserts commit first and later ones wait for us.
-- * We never wait on a task row while holding the projects row. Many paths
--   lock a task FOR UPDATE and then insert a row that references the same
--   project (completing a recurring task inserts the next occurrence; 31
--   tables reference projects). The backfill's task_keys.task_id foreign key
--   takes FOR KEY SHARE on each task row, which conflicts with FOR UPDATE, so
--   waiting there would deadlock with such a path. Instead the rows to key
--   are locked FOR KEY SHARE NOWAIT first: if any is held FOR UPDATE we fail
--   at once with lock_not_available (55P03) and the caller retries. Once we
--   hold them nobody can take FOR UPDATE on them, so the backfill never
--   waits. FOR KEY SHARE does not conflict with FOR SHARE (duplicateTask) or
--   FOR NO KEY UPDATE (ordinary updates and moves).
--
-- Errors use SQLSTATE class 'DK' so the service can map them:
--   DK404 project not found or in trash      DK409 already a development project
--   DK413 too many tasks to key at once      DK422 start_status not in status_options
-- A prefix already used in the workspace raises unique_violation (23505).
CREATE OR REPLACE FUNCTION atlas_enable_dev_project(
  p_project_id   BIGINT,
  p_prefix       TEXT,
  p_start_status TEXT,
  p_enabled_by   BIGINT,
  p_max_tasks    INTEGER
) RETURNS TABLE (namespace_id BIGINT, keyed INTEGER)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_workspace BIGINT;
  v_options   JSONB;
  v_ns        BIGINT;
  v_total     INTEGER;
  v_keyed     INTEGER;
BEGIN
  SELECT p.workspace_id, p.status_options INTO v_workspace, v_options
    FROM projects p
   WHERE p.id = p_project_id AND p.deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'DK404';
  END IF;
  IF EXISTS (SELECT 1 FROM dev_projects d WHERE d.project_id = p_project_id) THEN
    RAISE EXCEPTION 'project is already a development project' USING ERRCODE = 'DK409';
  END IF;
  IF p_start_status IS NOT NULL AND NOT (v_options ? p_start_status) THEN
    RAISE EXCEPTION 'start_status must be one of the project status options' USING ERRCODE = 'DK422';
  END IF;
  SELECT count(*) INTO v_total FROM tasks t WHERE t.project_id = p_project_id;
  IF v_total > p_max_tasks THEN
    RAISE EXCEPTION 'project has too many tasks to enable at once' USING ERRCODE = 'DK413';
  END IF;

  -- Lock the rows the backfill will key without waiting (see above).
  PERFORM 1
     FROM tasks t
    WHERE t.project_id = p_project_id
      AND NOT EXISTS (SELECT 1 FROM task_keys k WHERE k.task_id = t.id)
      FOR KEY SHARE OF t NOWAIT;

  INSERT INTO dev_projects (project_id, workspace_id, prefix, branch_prefix, start_status, enabled_by)
  VALUES (p_project_id, v_workspace, p_prefix, lower(p_prefix), p_start_status, p_enabled_by)
  RETURNING id INTO v_ns;
  INSERT INTO dev_project_prefixes (workspace_id, prefix, namespace_id)
  VALUES (v_workspace, p_prefix, v_ns);

  -- Tasks that already carry a key (moved in from another development
  -- project) keep it. Trashed tasks are keyed too so restore keeps working.
  WITH candidates AS (
    SELECT t.id, row_number() OVER (ORDER BY t.created_at, t.id) AS rn
      FROM tasks t
     WHERE t.project_id = p_project_id
       AND NOT EXISTS (SELECT 1 FROM task_keys k WHERE k.task_id = t.id)
  ), inserted AS (
    INSERT INTO task_keys (task_id, namespace_id, number)
    SELECT c.id, v_ns, c.rn FROM candidates c
    ON CONFLICT (task_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM inserted)
    INTO v_total, v_keyed;

  INSERT INTO dev_key_counters (namespace_id, next_number) VALUES (v_ns, v_total + 1);

  namespace_id := v_ns;
  keyed := v_keyed;
  RETURN NEXT;
END $$;
