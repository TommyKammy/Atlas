-- New records only. Existing notes, tasks, reports and configuration are untouched.
CREATE TABLE partner_reports (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID UNIQUE REFERENCES llm_runs(id) ON DELETE SET NULL,
  skill TEXT NOT NULL CHECK (skill IN ('project_status','weekly_report')),
  payload JSONB NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX partner_reports_project_page ON partner_reports(project_id,id DESC);

CREATE TABLE partner_action_batches (
  id UUID PRIMARY KEY REFERENCES llm_runs(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_id BIGINT REFERENCES project_knowledge(id) ON DELETE SET NULL,
  source_note_id BIGINT NOT NULL,
  source_revision INTEGER NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX partner_action_batches_project ON partner_action_batches(project_id);

-- Keep the receipt if a task is deleted: retries must never recreate it.
CREATE TABLE partner_action_approvals (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  batch_id UUID REFERENCES partner_action_batches(id) ON DELETE SET NULL,
  action_index INTEGER NOT NULL CHECK (action_index >= 0 AND action_index < 15),
  task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  selection JSONB NOT NULL,
  PRIMARY KEY (project_id,action_key)
);
