-- New events only: installing these triggers does not email historical rows.
CREATE OR REPLACE FUNCTION atlas_notification_projects(target_task BIGINT, channel TEXT)
RETURNS TABLE(project_id BIGINT, project_name TEXT, workspace_id BIGINT)
LANGUAGE SQL STABLE AS $$
  SELECT p.id, p.name, p.workspace_id
  FROM tasks t JOIN LATERAL (
    SELECT t.project_id AS project_id WHERE t.project_id IS NOT NULL
    UNION SELECT m.project_id FROM task_project_memberships m WHERE m.task_id=t.id
    UNION SELECT parent.project_id FROM tasks parent WHERE parent.id=t.parent_task_id
      AND parent.project_id IS NOT NULL AND (t.project_id IS NULL OR t.project_id=parent.project_id)
    UNION SELECT m.project_id FROM tasks parent JOIN task_project_memberships m ON m.task_id=parent.id
      WHERE parent.id=t.parent_task_id AND (t.project_id IS NULL OR t.project_id=parent.project_id)
  ) home ON TRUE JOIN projects p ON p.id=home.project_id AND p.deleted_at IS NULL
  WHERE t.id = target_task AND t.deleted_at IS NULL AND channel IN ('email','in_app')
    AND CASE
      WHEN jsonb_typeof(p.settings->'notifications'->channel)='boolean'
        THEN (p.settings->'notifications'->>channel)::boolean
      ELSE TRUE
    END;
$$;

CREATE TABLE IF NOT EXISTS notification_email_sources (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id BIGINT UNIQUE REFERENCES comments(id) ON DELETE CASCADE,
  event_id BIGINT UNIQUE REFERENCES task_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','expanded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(comment_id,event_id)=1)
);
CREATE INDEX IF NOT EXISTS idx_notification_sources_pending
  ON notification_email_sources(id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS notification_email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES notification_email_sources(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','retry','unconfigured','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  retry_at TIMESTAMPTZ,
  last_error TEXT,
  message_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE(source_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_work
  ON notification_email_deliveries(status,retry_at,id) WHERE status IN ('pending','retry','processing');
CREATE INDEX IF NOT EXISTS idx_notification_delivery_project
  ON notification_email_deliveries(project_id,status,id);

CREATE TABLE IF NOT EXISTS notification_worker_heartbeats (
  instance_id UUID PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('running','stopping')),
  smtp_configured BOOLEAN NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION atlas_queue_notification_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Resolve recipients after commit, when approval recipient rows also exist.
  IF EXISTS(SELECT 1 FROM atlas_notification_projects(NEW.task_id,'email')) THEN
    IF TG_TABLE_NAME='comments' THEN
      INSERT INTO notification_email_sources(task_id,comment_id) VALUES(NEW.task_id,NEW.id)
        ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO notification_email_sources(task_id,event_id) VALUES(NEW.task_id,NEW.id)
        ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS comments_notification_email ON comments;
CREATE TRIGGER comments_notification_email AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION atlas_queue_notification_email();
DROP TRIGGER IF EXISTS task_events_notification_email ON task_events;
CREATE TRIGGER task_events_notification_email AFTER INSERT ON task_events
  FOR EACH ROW EXECUTE FUNCTION atlas_queue_notification_email();
