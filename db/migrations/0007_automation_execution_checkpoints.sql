ALTER TABLE domain_events
  ADD COLUMN claim_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN retry_at TIMESTAMPTZ,
  ADD COLUMN processing_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN automation_plan_ready BOOLEAN NOT NULL DEFAULT FALSE;

-- An old in-flight event may already have untracked side effects.
UPDATE domain_events
SET failed_at = now(),
    processing_at = NULL,
    last_error = 'automation was interrupted before checkpoint migration'
WHERE processed_at IS NULL AND failed_at IS NULL AND attempts > 0;

CREATE TABLE automation_rule_executions (
  event_id BIGINT NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  rule_id BIGINT NOT NULL,
  rule_version INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  owner_id BIGINT,
  actions JSONB NOT NULL,
  planned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  planned_attempt INTEGER NOT NULL,
  event_actor_id BIGINT,
  event_causation_id BIGINT,
  delivery_seed UUID NOT NULL,
  next_action INTEGER NOT NULL DEFAULT 0,
  action_attempts INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  error TEXT,
  PRIMARY KEY (event_id, rule_id)
);

CREATE INDEX idx_domain_events_claimable
  ON domain_events(id) WHERE processed_at IS NULL AND failed_at IS NULL;
