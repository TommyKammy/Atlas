-- A timeline pin belongs to the task's primary or an explicit secondary home.
-- Remove pins left behind by secondary membership removal before cleanup was atomic.
DELETE FROM task_timeline_rows pin
USING tasks task
WHERE task.id = pin.task_id
  AND task.project_id IS DISTINCT FROM pin.project_id
  AND NOT EXISTS (
    SELECT 1 FROM task_project_memberships membership
    WHERE membership.task_id = pin.task_id AND membership.project_id = pin.project_id
  );
