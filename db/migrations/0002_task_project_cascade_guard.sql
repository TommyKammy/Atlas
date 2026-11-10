-- Keep new parent links within a project. Defer the check so a transaction
-- can move a whole tree, as when preserving multi-homed tasks on project trash.
CREATE FUNCTION check_task_parent_project() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  task_project bigint;
  parent_id bigint;
  parent_project bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.project_id IS NOT DISTINCT FROM NEW.project_id
       AND OLD.parent_task_id IS NOT DISTINCT FROM NEW.parent_task_id THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT project_id, parent_task_id INTO task_project, parent_id
    FROM tasks WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF parent_id IS NOT NULL THEN
    -- Serialize a new or changed link with concurrent moves of its parent.
    SELECT project_id INTO parent_project FROM tasks WHERE id = parent_id FOR SHARE;
  END IF;
  IF (task_project IS NOT NULL AND parent_project IS NOT NULL AND parent_project <> task_project)
     OR EXISTS (
       SELECT 1 FROM tasks
       WHERE parent_task_id = NEW.id AND project_id <> task_project
     ) THEN
    RAISE EXCEPTION 'task hierarchy crosses projects'
      USING ERRCODE = '23514', CONSTRAINT = 'task_project_cascade_guard';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER task_parent_project_guard
AFTER INSERT OR UPDATE OF project_id, parent_task_id ON tasks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_task_parent_project();

-- Existing mixed trees remain readable. Check every cascaded row as well as
-- the original DELETE, including deletes initiated by project FK or retention.
CREATE FUNCTION prevent_cross_project_task_cascade() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  task_project bigint;
BEGIN
  SELECT COALESCE(
    OLD.project_id,
    (SELECT project_id FROM task_project_memberships WHERE task_id = OLD.id ORDER BY project_id LIMIT 1),
    (SELECT project_id FROM tasks WHERE id = OLD.parent_task_id)
  ) INTO task_project;
  IF EXISTS (
    SELECT 1 FROM tasks child
    WHERE child.parent_task_id = OLD.id
      AND COALESCE(
        child.project_id,
        (SELECT project_id FROM task_project_memberships WHERE task_id = child.id ORDER BY project_id LIMIT 1),
        OLD.project_id
      ) IS DISTINCT FROM task_project
  ) THEN
    RAISE EXCEPTION 'task hierarchy crosses projects'
      USING ERRCODE = '23514', CONSTRAINT = 'task_project_cascade_guard';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER task_project_delete_guard
BEFORE DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION prevent_cross_project_task_cascade();
