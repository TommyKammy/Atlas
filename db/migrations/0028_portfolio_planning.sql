-- Portfolio investment planning MVP. Additive only: existing portfolios,
-- portfolio_items, project data and automation rules are untouched.
--
-- Amounts are stored as integer yen. Supply/demand are stored as numeric days
-- with one decimal place; an absent row means "unestimated", while a stored 0
-- means an explicit zero.

CREATE TABLE portfolio_plan_periods (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  year         INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  quarter      SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  budget_yen   BIGINT NOT NULL CHECK (budget_yen >= 0),
  revision     INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, year, quarter),
  UNIQUE (id, portfolio_id, workspace_id)
);
CREATE INDEX idx_portfolio_plan_periods_workspace
  ON portfolio_plan_periods(workspace_id, portfolio_id);

CREATE TABLE portfolio_plan_roles (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, portfolio_id, workspace_id)
);
CREATE UNIQUE INDEX idx_portfolio_plan_roles_name
  ON portfolio_plan_roles(portfolio_id, lower(name));
CREATE INDEX idx_portfolio_plan_roles_order
  ON portfolio_plan_roles(portfolio_id, position, id);

CREATE TABLE portfolio_plan_capacities (
  period_id   BIGINT NOT NULL,
  role_id     BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  portfolio_id BIGINT NOT NULL,
  month_index SMALLINT NOT NULL CHECK (month_index BETWEEN 1 AND 3),
  days        NUMERIC(6,1) NOT NULL CHECK (days >= 0 AND days <= 9999),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, role_id, month_index),
  FOREIGN KEY (period_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_periods(id, portfolio_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (role_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_roles(id, portfolio_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE portfolio_initiatives (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id      BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  owner_name        TEXT NOT NULL CHECK (char_length(btrim(owner_name)) BETWEEN 1 AND 120),
  expected_effect   TEXT NOT NULL CHECK (char_length(btrim(expected_effect)) BETWEEN 1 AND 1000),
  linked_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, portfolio_id, workspace_id)
);
CREATE UNIQUE INDEX idx_portfolio_initiatives_linked_project
  ON portfolio_initiatives(portfolio_id, linked_project_id)
  WHERE linked_project_id IS NOT NULL;
CREATE INDEX idx_portfolio_initiatives_portfolio
  ON portfolio_initiatives(portfolio_id, id);

-- A link may only point at a live project that is already a member of the
-- same portfolio. Removing a project from the portfolio later is allowed;
-- authorization at read time still protects the historical link.
CREATE OR REPLACE FUNCTION validate_portfolio_initiative_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.linked_project_id IS NOT DISTINCT FROM OLD.linked_project_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.linked_project_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM portfolio_items i
    JOIN projects p ON p.id = i.project_id
    WHERE i.portfolio_id = NEW.portfolio_id
      AND i.project_id = NEW.linked_project_id
      AND p.workspace_id = NEW.workspace_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'linked project must be a live member of the portfolio';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER portfolio_initiatives_link_guard
  BEFORE INSERT OR UPDATE ON portfolio_initiatives
  FOR EACH ROW EXECUTE FUNCTION validate_portfolio_initiative_link();

-- Presence of this row means the initiative is in the period's ledger. A NULL
-- cost is unestimated; 0 is an explicit zero-cost initiative. Fixed/candidate
-- is a period decision, so changing next quarter never reclassifies the past.
CREATE TABLE portfolio_initiative_estimates (
  period_id    BIGINT NOT NULL,
  initiative_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  portfolio_id BIGINT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('fixed', 'candidate')),
  cost_yen     BIGINT CHECK (cost_yen IS NULL OR cost_yen >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, initiative_id),
  FOREIGN KEY (period_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_periods(id, portfolio_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (initiative_id, portfolio_id, workspace_id)
    REFERENCES portfolio_initiatives(id, portfolio_id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX idx_portfolio_initiative_estimates_initiative
  ON portfolio_initiative_estimates(initiative_id);
CREATE INDEX idx_portfolio_initiative_estimates_period_kind
  ON portfolio_initiative_estimates(period_id, kind, initiative_id);

CREATE TABLE portfolio_initiative_demands (
  period_id    BIGINT NOT NULL,
  initiative_id BIGINT NOT NULL,
  role_id      BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  portfolio_id BIGINT NOT NULL,
  month_index  SMALLINT NOT NULL CHECK (month_index BETWEEN 1 AND 3),
  days         NUMERIC(6,1) NOT NULL CHECK (days >= 0 AND days <= 9999),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, initiative_id, role_id, month_index),
  FOREIGN KEY (period_id, initiative_id)
    REFERENCES portfolio_initiative_estimates(period_id, initiative_id) ON DELETE CASCADE,
  FOREIGN KEY (period_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_periods(id, portfolio_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (initiative_id, portfolio_id, workspace_id)
    REFERENCES portfolio_initiatives(id, portfolio_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (role_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_roles(id, portfolio_id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX idx_portfolio_initiative_demands_period
  ON portfolio_initiative_demands(period_id, role_id, month_index);

-- Each period has exactly two independent scenarios (slots 0 = A, 1 = B).
CREATE TABLE portfolio_plan_scenarios (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  portfolio_id BIGINT NOT NULL,
  period_id    BIGINT NOT NULL,
  slot         SMALLINT NOT NULL CHECK (slot IN (0, 1)),
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_id, slot),
  UNIQUE (id, portfolio_id, workspace_id),
  FOREIGN KEY (period_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_periods(id, portfolio_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE portfolio_scenario_inclusions (
  scenario_id   BIGINT NOT NULL,
  initiative_id BIGINT NOT NULL,
  workspace_id  BIGINT NOT NULL,
  portfolio_id  BIGINT NOT NULL,
  PRIMARY KEY (scenario_id, initiative_id),
  FOREIGN KEY (scenario_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_scenarios(id, portfolio_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (initiative_id, portfolio_id, workspace_id)
    REFERENCES portfolio_initiatives(id, portfolio_id, workspace_id) ON DELETE CASCADE
);

-- Explicit plan viewers. Workspace admins and the portfolio owner are implicit
-- editors and do not need a row here.
CREATE TABLE portfolio_plan_viewers (
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, user_id)
);
CREATE INDEX idx_portfolio_plan_viewers_user ON portfolio_plan_viewers(user_id);

-- Immutable adoption record. The server builds the snapshot from the database
-- at adoption time; clients only supply the chosen slot, reason and request id.
CREATE TABLE portfolio_plan_decisions (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    BIGINT NOT NULL,
  portfolio_id    BIGINT NOT NULL,
  period_id       BIGINT NOT NULL,
  chosen_slot     SMALLINT NOT NULL CHECK (chosen_slot IN (0, 1)),
  reason          TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  request_id      TEXT NOT NULL CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  -- Stable audit ID without an FK: deleting an account must not rewrite or
  -- block on an immutable adopted decision.
  actor_id        BIGINT NOT NULL,
  actor_name      TEXT NOT NULL CHECK (char_length(btrim(actor_name)) BETWEEN 1 AND 120),
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_revision INTEGER NOT NULL CHECK (period_revision > 0),
  budget_yen      BIGINT NOT NULL CHECK (budget_yen >= 0),
  snapshot        JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (period_id, request_id),
  FOREIGN KEY (period_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_periods(id, portfolio_id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX idx_portfolio_plan_decisions_period
  ON portfolio_plan_decisions(period_id, decided_at DESC, id DESC);

-- Adopted snapshots are append-only. A normal UPDATE is rejected even from
-- application code; history changes only by appending a new decision.
CREATE OR REPLACE FUNCTION preserve_portfolio_plan_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'adopted portfolio plan decisions are immutable';
END;
$$;
CREATE TRIGGER portfolio_plan_decisions_immutable
  BEFORE UPDATE ON portfolio_plan_decisions
  FOR EACH ROW EXECUTE FUNCTION preserve_portfolio_plan_decision();
