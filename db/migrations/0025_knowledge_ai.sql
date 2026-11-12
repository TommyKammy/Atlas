-- Additive only: AI never rewrites existing notes or their history.
CREATE TABLE llm_connections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'compatible')),
  base_url text NOT NULL,
  model text NOT NULL,
  key_cipher text,
  enabled boolean NOT NULL DEFAULT false,
  external_allowed boolean NOT NULL DEFAULT false,
  project_ids bigint[] NOT NULL DEFAULT '{}',
  max_input_chars integer NOT NULL DEFAULT 20000 CHECK (max_input_chars BETWEEN 100 AND 100000),
  max_output_tokens integer NOT NULL DEFAULT 2048 CHECK (max_output_tokens BETWEEN 128 AND 8192),
  timeout_seconds integer NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 5 AND 180),
  daily_limit integer NOT NULL DEFAULT 50 CHECK (daily_limit BETWEEN 1 AND 1000),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE llm_runs (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES llm_connections(id),
  connection_revision integer NOT NULL,
  user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  project_id bigint REFERENCES projects(id) ON DELETE SET NULL,
  note_id bigint REFERENCES project_knowledge(id) ON DELETE SET NULL,
  note_revision integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('summary', 'improve')),
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz NOT NULL
);
CREATE INDEX llm_runs_user_created ON llm_runs(user_id, created_at DESC);
