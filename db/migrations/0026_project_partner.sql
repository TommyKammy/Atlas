-- Extend the AI execution ledger only. Domain records are never changed by partner skills.
ALTER TABLE llm_runs DROP CONSTRAINT llm_runs_operation_check;
ALTER TABLE llm_runs ADD CONSTRAINT llm_runs_operation_check
  CHECK (operation IN ('summary', 'improve', 'action_extract', 'project_status', 'weekly_report'));
