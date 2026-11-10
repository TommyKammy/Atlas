-- Decision-only traces retain the plan's evaluation across retries without
-- copying task values or webhook credentials into history.
ALTER TABLE automation_rule_executions ADD COLUMN evaluation JSONB;
ALTER TABLE rule_runs ADD COLUMN evaluation JSONB;
