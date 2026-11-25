-- The task a save_task reservation created, written in the same transaction
-- as the task INSERT (docs/dev-projects-phase0.md §7). While it is set and no
-- response is recorded, the reservation is neither taken over nor deleted, so
-- a retry after a crash between the commit and the response write reads the
-- created task back instead of creating a second one. No foreign key: the
-- reservation is only a pointer for recovery, and a missing task is reported
-- as such.
ALTER TABLE mcp_idempotency ADD COLUMN IF NOT EXISTS created_task_id BIGINT;
