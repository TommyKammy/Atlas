-- Atlas core schema v1: workspace / project / section / task / subtask / comment
-- Derived from Asana passive observation (list/board/timeline/calendar/detail).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS workspaces (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       CITEXT UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT,
  is_guest    BOOLEAN NOT NULL DEFAULT FALSE,
  deactivated_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opaque server-side sessions. Only SHA-256 token hashes are stored.
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  user_agent   TEXT,
  mfa_enrollment_only BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS invitations (
  id          BIGSERIAL PRIMARY KEY,
  email       CITEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('admin', 'member', 'guest')),
  token       TEXT NOT NULL UNIQUE,
  invited_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_open
  ON invitations(token) WHERE accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS projects (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  status_color TEXT NOT NULL DEFAULT 'none',
  status_options JSONB NOT NULL DEFAULT '["未着手","進行中","Done"]',
  status_field_name TEXT NOT NULL DEFAULT 'Status',
  status_field_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor',
  PRIMARY KEY (project_id, user_id)
);

-- Sections are the grouping unit shared by list (group header),
-- board (column) and timeline (row group). Position is fractional-rank friendly.
CREATE TABLE IF NOT EXISTS sections (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);

-- Tasks: parent_task_id IS NULL = top-level task, else subtask.
-- A task may belong to several projects (Asana multi-homing); the primary
-- membership carries section_id, extras go to task_project_memberships.
CREATE TABLE IF NOT EXISTS tasks (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  section_id     BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  parent_task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  assignee_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  start_on       DATE,
  due_on         DATE,
  progress       INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status         TEXT NOT NULL DEFAULT 'inbox',
  is_milestone   BOOLEAN NOT NULL DEFAULT FALSE,
  position       DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_section ON tasks(project_id, section_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_on) WHERE completed = FALSE;

CREATE TABLE IF NOT EXISTS task_project_memberships (
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  PRIMARY KEY (task_id, project_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id        BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id  BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

-- Project-scoped manual timeline rows. Absence means the task is auto-packed.
CREATE TABLE IF NOT EXISTS task_timeline_rows (
  task_id     BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_index   INTEGER NOT NULL CHECK (row_index >= 0),
  updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_task_timeline_rows_project
  ON task_timeline_rows(project_id, row_index);

CREATE TABLE IF NOT EXISTS comments (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);

-- Seed: one workspace + demo project skeleton (disposable dev data).
INSERT INTO workspaces (id, name) VALUES (1, 'Atlas Demo') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS project_messages (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_project ON project_messages(project_id);

CREATE TABLE IF NOT EXISTS project_knowledge (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_project ON project_knowledge(project_id);

CREATE TABLE IF NOT EXISTS project_tabs (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tab_key    TEXT NOT NULL,
  name       TEXT NOT NULL,
  view_type  TEXT NOT NULL,
  position   DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_custom  BOOLEAN NOT NULL DEFAULT false,
  icon       TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, tab_key)
);
CREATE INDEX IF NOT EXISTS idx_project_tabs_project ON project_tabs(project_id, position);

CREATE TABLE IF NOT EXISTS project_forms (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields      JSONB NOT NULL DEFAULT '[]',
  published   BOOLEAN NOT NULL DEFAULT false,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_forms_project ON project_forms(project_id);

CREATE TABLE IF NOT EXISTS form_responses (
  id           BIGSERIAL PRIMARY KEY,
  form_id      BIGINT NOT NULL REFERENCES project_forms(id) ON DELETE CASCADE,
  task_id      BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  answers      JSONB NOT NULL DEFAULT '{}',
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_responses_form ON form_responses(form_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS email_address TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_email_address ON projects(email_address) WHERE email_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_email_messages (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_address TEXT NOT NULL DEFAULT '',
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  task_id      BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_email_messages_project ON project_email_messages(project_id, received_at DESC);

CREATE TABLE IF NOT EXISTS project_apps (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  app_key    TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}',
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, app_key)
);
CREATE INDEX IF NOT EXISTS idx_project_apps_project ON project_apps(project_id);

CREATE TABLE IF NOT EXISTS bundles (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  fields       JSONB NOT NULL DEFAULT '[]',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bundles_workspace ON bundles(workspace_id);

CREATE TABLE IF NOT EXISTS bundle_applications (
  bundle_id  BIGINT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  applied_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, project_id)
);

CREATE TABLE IF NOT EXISTS project_automations (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  trigger      TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  action_value TEXT NOT NULL DEFAULT '',
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_automations_project ON project_automations(project_id);

CREATE TABLE IF NOT EXISTS automation_runs (
  id            BIGSERIAL PRIMARY KEY,
  automation_id BIGINT NOT NULL REFERENCES project_automations(id) ON DELETE CASCADE,
  task_id       BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  trigger       TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id);

CREATE TABLE IF NOT EXISTS saved_searches (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  params       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(workspace_id, user_id, id DESC);

CREATE TABLE IF NOT EXISTS project_view_states (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  view       TEXT NOT NULL,
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id, view)
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('number', 'text', 'select')),
  options    JSONB NOT NULL DEFAULT '[]',
  position   DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON custom_fields(project_id);

CREATE TABLE IF NOT EXISTS task_custom_values (
  task_id      BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id     BIGINT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value_text   TEXT,
  value_number DOUBLE PRECISION,
  PRIMARY KEY (task_id, field_id)
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id          BIGSERIAL PRIMARY KEY,
  task_id     BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes  BIGINT NOT NULL DEFAULT 0,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON task_attachments(task_id);

CREATE TABLE IF NOT EXISTS inbox_reads (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS saved_views (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  view_type  TEXT NOT NULL DEFAULT 'list',
  filters    JSONB NOT NULL DEFAULT '{}',
  sort_key   TEXT NOT NULL DEFAULT 'position',
  group_by   TEXT NOT NULL DEFAULT 'section',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_views_project ON saved_views(project_id);

CREATE TABLE IF NOT EXISTS task_events (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  via        TEXT NOT NULL DEFAULT 'web' CHECK (via IN ('web', 'mcp', 'automation')),
  client_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);

ALTER TABLE inbox_reads ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES task_events(id) ON DELETE CASCADE;
ALTER TABLE inbox_reads DROP CONSTRAINT IF EXISTS inbox_reads_pkey;
ALTER TABLE inbox_reads ALTER COLUMN comment_id DROP NOT NULL;
ALTER TABLE inbox_reads ADD CONSTRAINT inbox_reads_one_target
  CHECK ((comment_id IS NULL) <> (event_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_reads_comment ON inbox_reads(comment_id, user_id) WHERE comment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reads_event ON inbox_reads(event_id, user_id) WHERE event_id IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS out_of_office_from DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS out_of_office_to DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS out_of_office_note TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'
  CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS task_templates (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  title_template TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  assignee_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  due_offset_days INTEGER,
  section_id     BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  subtasks       JSONB NOT NULL DEFAULT '[]',
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_templates_project ON task_templates(project_id);

CREATE TABLE IF NOT EXISTS project_templates (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ptemplates_workspace ON project_templates(workspace_id);

-- Built-in (Asana-style standard) templates are seeded per workspace lazily.
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS builtin_key TEXT;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ptemplates_builtin_key
  ON project_templates(workspace_id, builtin_key);

CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    BIGINT,
  project_id   BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  summary      TEXT NOT NULL DEFAULT '',
  via          TEXT NOT NULL DEFAULT 'web' CHECK (via IN ('web', 'mcp', 'automation')),
  -- mcp_token_id is added after mcp_tokens is created (the table is declared
  -- below, and PostgreSQL requires the referenced table to exist already).
  client_name  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id, id DESC);

CREATE TABLE IF NOT EXISTS project_share_tokens (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_share_project ON project_share_tokens(project_id);

ALTER TABLE project_share_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 12),
  PRIMARY KEY (comment_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS task_likes (
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

ALTER TABLE project_tabs ADD COLUMN IF NOT EXISTS icon TEXT;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS comment_mentions (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS my_task_orders (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position   DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS search_history (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, query)
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS user_recent_projects (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS dashboard_prefs (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  widgets    JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, project_id)
);

-- Workspace home dashboard widgets (per-user layout).
CREATE TABLE IF NOT EXISTS home_widgets (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  widget_type  TEXT NOT NULL,
  size         TEXT NOT NULL DEFAULT 'half' CHECK (size IN ('half', 'full')),
  position     DOUBLE PRECISION NOT NULL DEFAULT 1000,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, widget_type)
);
CREATE INDEX IF NOT EXISTS idx_home_widgets_user
  ON home_widgets(workspace_id, user_id, position, id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_widgets_initialized BOOLEAN NOT NULL DEFAULT FALSE;

-- Home Phase 2: project status updates posted from the home widget and overview.
CREATE TABLE IF NOT EXISTS project_status_updates (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  status       TEXT,
  status_color TEXT NOT NULL DEFAULT 'none',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_status_updates_project
  ON project_status_updates(project_id, created_at DESC, id DESC);

-- Home Phase 2: per-user comment drafts and a private notepad.
CREATE TABLE IF NOT EXISTS comment_drafts (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  body_doc   JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS user_notepad (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Project context menu support (Asana sidebar parity): color/icon,
-- archive, and per-user portfolio membership.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_color TEXT NOT NULL DEFAULT 'none';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_field_name TEXT NOT NULL DEFAULT 'Status';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_field_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived_at) WHERE archived_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS portfolio_projects (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- Admin console: teams, RBAC, authentication and password requirements.
CREATE TABLE IF NOT EXISTS teams (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  privacy      TEXT NOT NULL DEFAULT 'public'
               CHECK (privacy IN ('public', 'private', 'approval')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'approved')),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
             CHECK (role IN ('manager', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_roles (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  base_level   TEXT NOT NULL DEFAULT 'member'
               CHECK (base_level IN ('admin', 'member', 'guest')),
  permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  is_super     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
CREATE INDEX IF NOT EXISTS idx_workspace_roles_workspace ON workspace_roles(workspace_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id BIGINT REFERENCES workspace_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

CREATE TABLE IF NOT EXISTS workspace_security (
  workspace_id            BIGINT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  two_factor_policy       TEXT NOT NULL DEFAULT 'optional'
                          CHECK (two_factor_policy IN ('optional', 'required')),
  saml_mode               TEXT NOT NULL DEFAULT 'off'
                          CHECK (saml_mode IN ('off', 'optional', 'required', 'members_only')),
  saml_signin_url         TEXT NOT NULL DEFAULT '',
  saml_certificate        TEXT NOT NULL DEFAULT '',
  saml_session_days       INTEGER NOT NULL DEFAULT 7
                          CHECK (saml_session_days BETWEEN 1 AND 30),
  saml_jit_provisioning   BOOLEAN NOT NULL DEFAULT TRUE,
  scim_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  mcp_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  mcp_pat_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  password_min_length     INTEGER NOT NULL DEFAULT 8
                          CHECK (password_min_length BETWEEN 8 AND 64),
  password_require_upper  BOOLEAN NOT NULL DEFAULT FALSE,
  password_require_lower  BOOLEAN NOT NULL DEFAULT FALSE,
  password_require_number BOOLEAN NOT NULL DEFAULT FALSE,
  password_require_symbol BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SCIM 2.0 provisioning tokens (hashes only) and IdP bindings.
CREATE TABLE IF NOT EXISTS scim_tokens (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  idp          TEXT NOT NULL DEFAULT 'generic'
               CHECK (idp IN ('entra', 'okta', 'generic')),
  token_hash   TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_tokens_hash_uidx ON scim_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_workspace ON scim_tokens(workspace_id, id);

CREATE TABLE IF NOT EXISTS scim_identities (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  idp          TEXT NOT NULL DEFAULT 'generic'
               CHECK (idp IN ('entra', 'okta', 'generic')),
  external_id  TEXT,
  user_name    CITEXT NOT NULL,
  given_name   TEXT,
  family_name  TEXT,
  formatted_name TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_identities_external_uidx
  ON scim_identities(workspace_id, idp, external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS scim_identities_user_name_active_uidx
  ON scim_identities(workspace_id, user_name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scim_identities_workspace
  ON scim_identities(workspace_id, deleted_at);

-- One row per SCIM request, including failed authentication. Request and
-- response bodies, Authorization headers and token values are never stored.
CREATE TABLE IF NOT EXISTS scim_request_log (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_id     BIGINT REFERENCES scim_tokens(id) ON DELETE SET NULL,
  idp          TEXT CHECK (idp IN ('entra', 'okta', 'generic')),
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  "filter"     TEXT,
  status       INTEGER NOT NULL,
  scim_type    TEXT,
  detail       TEXT,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  client_ip    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scim_request_log_workspace_id
  ON scim_request_log(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_scim_request_log_created
  ON scim_request_log(created_at);
CREATE INDEX IF NOT EXISTS idx_scim_request_log_token
  ON scim_request_log(token_id) WHERE token_id IS NOT NULL;

-- MCP bearer tokens (hashes only; the plaintext is returned once on issue).
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('pat', 'oauth')),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[]
               CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND 'read' = ANY(scopes)),
  client_name  TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  CONSTRAINT mcp_tokens_pat_no_expiry CHECK (kind <> 'pat' OR expires_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_hash_uidx ON mcp_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id, id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_workspace ON mcp_tokens(workspace_id, id);

-- One row per MCP request, including failed authentication. Request and
-- response bodies, tool arguments, Authorization headers and token values are
-- never stored here.
CREATE TABLE IF NOT EXISTS mcp_request_log (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_id     BIGINT REFERENCES mcp_tokens(id) ON DELETE SET NULL,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  endpoint     TEXT NOT NULL CHECK (endpoint IN ('default', 'readonly')),
  rpc_method   TEXT,
  tool_name    TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'denied', 'unauthenticated')),
  error_code   TEXT,
  duration_ms  INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  client_name  TEXT,
  client_ip    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_workspace
  ON mcp_request_log(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_created
  ON mcp_request_log(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_token
  ON mcp_request_log(token_id) WHERE token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_user
  ON mcp_request_log(user_id) WHERE user_id IS NOT NULL;

-- OAuth 2.1 clients: CIMD (client_id is the https metadata URL) and DCR
-- (random opaque client_id). CIMD metadata is cached for 24 hours.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id        TEXT PRIMARY KEY,
  source           TEXT NOT NULL CHECK (source IN ('cimd', 'dcr')),
  client_name      TEXT,
  redirect_uris    TEXT[] NOT NULL CHECK (cardinality(redirect_uris) > 0),
  application_type TEXT NOT NULL CHECK (application_type IN ('native', 'web')),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_source
  ON oauth_clients(source, created_at);

-- Authorization codes keep hashes only. family_id links the code to the
-- refresh-token family issued from it so a replayed code revokes the family.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id            BIGSERIAL PRIMARY KEY,
  code_hash     TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id     TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  redirect_uri  TEXT NOT NULL,
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes        TEXT[] NOT NULL
                CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND 'read' = ANY(scopes)),
  resource      TEXT NOT NULL,
  family_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_family
  ON oauth_authorization_codes(family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expires
  ON oauth_authorization_codes(expires_at);

-- Rotating refresh tokens (hashes only). Reuse of a used token revokes the
-- whole family; a new token is issued on every refresh with a fresh 30 days.
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id           BIGSERIAL PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  family_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  client_id    TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scopes       TEXT[] NOT NULL
               CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND 'read' = ANY(scopes)),
  resource     TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  used_at      TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family
  ON oauth_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_user
  ON oauth_refresh_tokens(user_id, id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires
  ON oauth_refresh_tokens(expires_at);

-- OAuth access tokens share mcp_tokens with PATs. resource is the RFC 8707
-- audience; PATs keep it NULL.
ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS resource TEXT,
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT
    REFERENCES oauth_clients(client_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS oauth_family_id UUID;
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_oauth_family
  ON mcp_tokens(oauth_family_id) WHERE oauth_family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_oauth_client
  ON mcp_tokens(oauth_client_id) WHERE oauth_client_id IS NOT NULL;

-- audit_log is declared before mcp_tokens, so its token reference is added here.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS mcp_token_id BIGINT
  REFERENCES mcp_tokens(id) ON DELETE SET NULL;

-- One row per successful idempotent tool call. A row with response IS NULL is
-- an in-flight reservation. Failed calls delete the row so a retry can run.
-- The janitor removes rows after 24 hours. owner_token changes on every insert
-- and takeover; result writes and deletes match it so a stale execution cannot
-- overwrite or remove the new owner's reservation.
CREATE TABLE IF NOT EXISTS mcp_idempotency (
  id            BIGSERIAL PRIMARY KEY,
  token_id      BIGINT NOT NULL REFERENCES mcp_tokens(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response      JSONB,
  owner_token   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_idempotency_key_length
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT mcp_idempotency_request_hash_format
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_idempotency_key_uidx
  ON mcp_idempotency(token_id, tool_name, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_mcp_idempotency_created
  ON mcp_idempotency(created_at);

CREATE TABLE IF NOT EXISTS saml_cache (
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_saml_cache_expiry ON saml_cache(expires_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;

-- Built-in roles (fixed ids keep seed.sql deterministic).
INSERT INTO workspace_roles (id, workspace_id, key, name, description, base_level, permissions, is_system, is_super) VALUES
  (1, 1, 'super_admin', '特権管理者',
   '組織設定、セキュリティポリシー、データへのアクセスに対して無制限の管理権限を持ちます。',
   'admin', '["members.manage","teams.manage","workspace.manage","security.manage","roles.manage","insights.view","audit.view","projects.create","tasks.create"]'::jsonb, TRUE, TRUE),
  (2, 1, 'admin', '管理者',
   'チームとメンバーを管理できますが、ドメイン設定に関する管理権限は限定的です。',
   'admin', '["members.manage","teams.manage","workspace.manage","security.manage","insights.view","audit.view","projects.create","tasks.create"]'::jsonb, TRUE, FALSE),
  (3, 1, 'member', 'メンバー',
   '共有されたタスクや仕事でコラボレーションできます。',
   'member', '["projects.create","tasks.create"]'::jsonb, TRUE, FALSE),
  (4, 1, 'guest', 'ゲスト',
   '特定のタスクやプロジェクトへの限定的なアクセス権限を持ちます。この役割は外部のコラボレーターが対象です。',
   'guest', '[]'::jsonb, TRUE, FALSE)
ON CONFLICT (workspace_id, key) DO NOTHING;

INSERT INTO workspace_security (workspace_id) VALUES (1)
ON CONFLICT (workspace_id) DO NOTHING;

-- Backfill existing users from the legacy admin/guest flags.
UPDATE users u SET role_id = CASE
  WHEN u.is_admin THEN 1
  WHEN u.is_guest THEN 4
  ELSE 3
END
WHERE u.role_id IS NULL;

-- The assigned role is authoritative, so align the legacy flags with it.
-- Keep this in sync with db/migrations/0037_sync_role_flags.sql.
UPDATE users u
SET is_admin = (r.base_level = 'admin'),
    is_guest = (r.base_level = 'guest')
FROM workspace_roles r
WHERE u.role_id = r.id
  AND (u.is_admin IS DISTINCT FROM (r.base_level = 'admin')
    OR u.is_guest IS DISTINCT FROM (r.base_level = 'guest'));

-- Explicit seed ids above must not collide with the BIGSERIAL sequence.
SELECT setval('workspace_roles_id_seq', (SELECT MAX(id) FROM workspace_roles));

-- Project dashboards: shared widget configurations (Asana-style dashboards).
CREATE TABLE IF NOT EXISTS project_dashboard_widgets (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  widget_type TEXT NOT NULL DEFAULT 'chart'
              CHECK (widget_type IN ('chart', 'text')),
  chart_type  TEXT NOT NULL DEFAULT 'bar'
              CHECK (chart_type IN ('bar', 'stacked_bar', 'grouped_bar', 'line',
                                    'burnup', 'burndown', 'donut', 'number', 'lollipop')),
  group_by    TEXT NOT NULL DEFAULT 'section'
              CHECK (group_by IN ('section', 'assignee', 'status', 'completion',
                                  'due_month', 'created_month')),
  metric      TEXT NOT NULL DEFAULT 'count'
              CHECK (metric IN ('count', 'completed', 'incomplete', 'overdue',
                                'progress_avg', 'progress_sum')),
  filters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  options     JSONB NOT NULL DEFAULT '{}'::jsonb,
  body        TEXT NOT NULL DEFAULT '',
  position    DOUBLE PRECISION NOT NULL DEFAULT 1000,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_project
  ON project_dashboard_widgets(project_id, position, id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dashboard_initialized BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE projects p SET dashboard_initialized = TRUE
  WHERE EXISTS (SELECT 1 FROM project_dashboard_widgets w WHERE w.project_id = p.id);

-- Rich text: canonical ProseMirror JSON. Legacy description/body remain for
-- search, exports, and fallback when a document has not been migrated yet.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description_doc JSONB;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS body_doc JSONB;

-- Custom field metadata: Asana-style description, number formatting and column functions.
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';

-- Additional custom field types: multi-select and date.
ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_field_type_check;
ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_field_type_check
  CHECK (field_type IN ('number', 'text', 'select', 'multi_select', 'date'));
ALTER TABLE task_custom_values ADD COLUMN IF NOT EXISTS value_date DATE;
ALTER TABLE task_custom_values ADD COLUMN IF NOT EXISTS value_json JSONB;

-- Additional built-in/custom field types: people, auto ID and virtual columns.
ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_field_type_check;
ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_field_type_check
  CHECK (field_type IN (
    'number', 'text', 'select', 'multi_select', 'date',
    'people', 'auto_id',
    'project', 'completed_on', 'created_at', 'modified_at', 'created_by',
    'collaborators', 'attachments', 'blocked_by', 'blocking', 'formula',
    'reference', 'lookup', 'rollup', 'timer', 'time_tracking'
  ));

-- Field management: soft delete, per-field edit access and workspace library.
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS editor_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_access_level_check;
ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_access_level_check
  CHECK (access_level IN ('everyone', 'admins', 'custom'));
CREATE TABLE IF NOT EXISTS field_library (
  id          BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  field_type  TEXT NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  config      JSONB NOT NULL DEFAULT '{}',
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_field_library_workspace ON field_library(workspace_id);

-- Project action menu: ownership/team metadata, shared settings, and a
-- soft-delete trash. Soft-deleted projects keep their tasks so restore is
-- lossless; multi-homed tasks are re-parented before a project is trashed.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_on DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id) WHERE team_id IS NOT NULL;

-- Project table conversion (Phase 6 epic): a saved projection of a project's
-- tasks into a spreadsheet-like table. Rows are snapshotted, not mirrored.
CREATE TABLE IF NOT EXISTS project_tables (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  columns     JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows        JSONB NOT NULL DEFAULT '[]'::jsonb,
  options     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_tables_project ON project_tables(project_id, id);

-- Rules/automation engine v2: durable domain events, generic rule definitions,
-- execution history and scheduled-fire deduplication.
CREATE TABLE IF NOT EXISTS domain_events (
  id             BIGSERIAL PRIMARY KEY,
  workspace_id   BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id     BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  actor_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  type           TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  subject_type   TEXT NOT NULL,
  subject_id     BIGINT NOT NULL,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  causation_id   BIGINT REFERENCES domain_events(id) ON DELETE SET NULL,
  chain_depth    INTEGER NOT NULL DEFAULT 0,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_at  TIMESTAMPTZ,
  processed_at   TIMESTAMPTZ,
  failed_at      TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
CREATE INDEX IF NOT EXISTS idx_domain_events_pending
  ON domain_events(id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_domain_events_project
  ON domain_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_subject
  ON domain_events(subject_type, subject_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS project_rules (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  definition   JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_rules_project
  ON project_rules(project_id, id);

CREATE TABLE IF NOT EXISTS rule_runs (
  id                 BIGSERIAL PRIMARY KEY,
  rule_id            BIGINT REFERENCES project_rules(id) ON DELETE SET NULL,
  event_id           BIGINT REFERENCES domain_events(id) ON DELETE SET NULL,
  rule_name          TEXT NOT NULL,
  rule_version       INTEGER NOT NULL DEFAULT 1,
  owner_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source             TEXT NOT NULL DEFAULT 'automation',
  status             TEXT NOT NULL,
  actions_total      INTEGER NOT NULL DEFAULT 0,
  actions_succeeded  INTEGER NOT NULL DEFAULT 0,
  actions_failed     INTEGER NOT NULL DEFAULT 0,
  error              TEXT,
  details            JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rule_runs_rule
  ON rule_runs(rule_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_rule_runs_event
  ON rule_runs(event_id);

CREATE TABLE IF NOT EXISTS automation_fires (
  rule_id      BIGINT NOT NULL REFERENCES project_rules(id) ON DELETE CASCADE,
  fire_key     TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'task',
  subject_id   BIGINT NOT NULL,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, fire_key)
);
CREATE INDEX IF NOT EXISTS idx_automation_fires_subject
  ON automation_fires(subject_type, subject_id, fired_at DESC);

-- First-class portfolios and portfolio-scoped rules. Portfolio rules are
-- projected into project_rules replicas so the same engine and run history
-- remain the single execution path.
CREATE TABLE IF NOT EXISTS portfolios (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  owner_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portfolios_workspace ON portfolios(workspace_id, id);

CREATE TABLE IF NOT EXISTS portfolio_items (
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_items_project ON portfolio_items(project_id);

CREATE TABLE IF NOT EXISTS portfolio_rules (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  definition   JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_rules_portfolio ON portfolio_rules(portfolio_id, id);

ALTER TABLE project_rules ADD COLUMN IF NOT EXISTS portfolio_rule_id BIGINT
  REFERENCES portfolio_rules(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_project_rules_portfolio_rule
  ON project_rules(portfolio_rule_id) WHERE portfolio_rule_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_rules_portfolio_project
  ON project_rules(portfolio_rule_id, project_id) WHERE portfolio_rule_id IS NOT NULL;

ALTER TABLE bundles ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Inbound automation webhooks. The token is used in the public URL; the
-- optional secret enables HMAC-SHA256 request signing.
CREATE TABLE IF NOT EXISTS automation_webhook_endpoints (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  secret       TEXT NOT NULL DEFAULT '',
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_webhooks_project
  ON automation_webhook_endpoints(project_id, id);
