CREATE TABLE IF NOT EXISTS task_approvals (
  task_id BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  approver_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  requester_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  round INTEGER NOT NULL CHECK (round > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_task_approvals_approver_pending
  ON task_approvals(approver_id, task_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS task_approval_history (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('request', 'approve', 'reject', 'request_changes', 'resubmit', 'reassign')),
  round INTEGER NOT NULL CHECK (round > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  approver_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approver_name TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  event_id BIGINT REFERENCES task_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, version)
);

CREATE INDEX IF NOT EXISTS idx_task_approval_history_task
  ON task_approval_history(task_id, version);

-- Approval alerts use the existing event/read UI but only notify the named users.
CREATE TABLE IF NOT EXISTS task_event_recipients (
  event_id BIGINT NOT NULL REFERENCES task_events(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_event_recipients_user
  ON task_event_recipients(user_id, event_id);

-- Application mutations lock the task before its approval row. Deferred checks
-- allow the two rows to be updated atomically, including during resubmission.
-- They also protect writes from bulk, automation, import and future SQL paths.
CREATE OR REPLACE FUNCTION enforce_task_approval_state() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_id BIGINT;
  task_state RECORD;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    target_id := NEW.id;
  ELSE
    target_id := COALESCE(NEW.task_id, OLD.task_id);
  END IF;

  SELECT t.completed, t.is_milestone, t.recurrence, a.status
  INTO task_state
  FROM tasks t JOIN task_approvals a ON a.task_id = t.id
  WHERE t.id = target_id;

  IF FOUND AND (
    task_state.completed IS DISTINCT FROM (task_state.status = 'approved') OR
    task_state.is_milestone OR task_state.recurrence IS DISTINCT FROM 'none'
  ) THEN
    RAISE EXCEPTION 'approval tasks must use approval decisions for completion and cannot be milestones or recurring'
      USING ERRCODE = '23514', CONSTRAINT = 'task_approval_state_guard';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_approval_state_guard ON tasks;
CREATE CONSTRAINT TRIGGER tasks_approval_state_guard
AFTER UPDATE ON tasks DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (
  OLD.completed IS DISTINCT FROM NEW.completed OR
  OLD.is_milestone IS DISTINCT FROM NEW.is_milestone OR
  OLD.recurrence IS DISTINCT FROM NEW.recurrence
) EXECUTE FUNCTION enforce_task_approval_state();

DROP TRIGGER IF EXISTS approvals_task_state_guard ON task_approvals;
CREATE CONSTRAINT TRIGGER approvals_task_state_guard
AFTER INSERT OR UPDATE OR DELETE ON task_approvals DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_task_approval_state();
