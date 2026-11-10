ALTER TABLE domain_events
  ADD COLUMN automation_root_event_id BIGINT,
  ADD COLUMN automation_rule_path BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN automation_actions_started INTEGER NOT NULL DEFAULT 0
    CHECK (automation_actions_started >= 0);

-- Keep the root identity after retention removes an ancestor. A pending child
-- must then stop instead of starting a fresh budget for the same chain.
ALTER TABLE automation_rule_executions
  ADD COLUMN budgeted_action INTEGER NOT NULL DEFAULT -1;
