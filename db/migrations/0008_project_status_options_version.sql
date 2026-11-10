ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_options_version integer NOT NULL DEFAULT 0;
