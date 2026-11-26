-- Workspace-level feature switches (docs/dev-projects-phase0.md §9, §12).
-- Administrators allow optional features under Admin → Features. A missing
-- row means every feature is off.
CREATE TABLE IF NOT EXISTS workspace_features (
  workspace_id  BIGINT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  dev_projects  BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id) ON DELETE SET NULL
);
