-- Portfolio investment proposal approvals. Additive only: the existing direct
-- adoption path, adopted decision snapshots and history are untouched.
--
-- A portfolio has at most one approval configuration row. When approvals are
-- enabled, the compare screen submits an immutable copy of both scenarios to
-- the assigned final approver instead of adopting directly. The reviewer is an
-- optional feasibility reviewer and is stored on each submission so a later
-- settings change cannot silently redirect an in-flight review.

CREATE TABLE portfolio_plan_approval_settings (
  portfolio_id             BIGINT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  workspace_id             BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  approvals_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  final_approver_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  default_reviewer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_portfolio_plan_approval_settings_approver
  ON portfolio_plan_approval_settings(final_approver_user_id)
  WHERE final_approver_user_id IS NOT NULL;
CREATE INDEX idx_portfolio_plan_approval_settings_reviewer
  ON portfolio_plan_approval_settings(default_reviewer_user_id)
  WHERE default_reviewer_user_id IS NOT NULL;

-- A submission freezes both scenarios exactly like an adopted decision. Status
-- values for review/decision are present now so the follow-up slices can append
-- workflow transitions without rewriting submission data.
CREATE TABLE portfolio_plan_proposals (
  id                        BIGSERIAL PRIMARY KEY,
  workspace_id              BIGINT NOT NULL,
  portfolio_id              BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  period_id                 BIGINT NOT NULL,
  version                   INTEGER NOT NULL CHECK (version > 0),
  status                    TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                              'submitted', 'under_review', 'returned',
                              'approved', 'rejected', 'withdrawn', 'superseded'
                            )),
  recommended_slot          SMALLINT NOT NULL CHECK (recommended_slot IN (0, 1)),
  reason                    TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  request_id                TEXT NOT NULL CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  -- Stable audit identities without FKs: deactivating or deleting an account
  -- must never rewrite a frozen submission or block on history.
  submitted_by              BIGINT NOT NULL,
  submitted_by_name         TEXT NOT NULL CHECK (char_length(btrim(submitted_by_name)) BETWEEN 1 AND 120),
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  final_approver_user_id    BIGINT NOT NULL,
  final_approver_name       TEXT NOT NULL CHECK (char_length(btrim(final_approver_name)) BETWEEN 1 AND 120),
  reviewer_user_id          BIGINT,
  reviewer_name             TEXT CHECK (reviewer_name IS NULL OR char_length(btrim(reviewer_name)) BETWEEN 1 AND 120),
  period_revision           INTEGER NOT NULL CHECK (period_revision > 0),
  budget_yen                BIGINT NOT NULL CHECK (budget_yen >= 0),
  snapshot                  JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256           TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (submitted_by <> final_approver_user_id),
  -- Prepared for the optional review and the final decision.
  review_started_by         BIGINT,
  review_started_at         TIMESTAMPTZ,
  review_note               TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 2000),
  decided_by                BIGINT,
  decided_by_name           TEXT CHECK (decided_by_name IS NULL OR char_length(btrim(decided_by_name)) BETWEEN 1 AND 120),
  decided_at                TIMESTAMPTZ,
  decision_id               BIGINT,
  decision_note             TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  superseded_by_id          BIGINT,
  UNIQUE (period_id, version),
  UNIQUE (period_id, request_id),
  FOREIGN KEY (period_id, portfolio_id, workspace_id)
    REFERENCES portfolio_plan_periods(id, portfolio_id, workspace_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_portfolio_plan_proposals_one_open
  ON portfolio_plan_proposals(period_id)
  WHERE status IN ('submitted', 'under_review');
CREATE INDEX idx_portfolio_plan_proposals_period
  ON portfolio_plan_proposals(period_id, version DESC, id DESC);
CREATE INDEX idx_portfolio_plan_proposals_portfolio_open
  ON portfolio_plan_proposals(portfolio_id, status)
  WHERE status IN ('submitted', 'under_review');
CREATE INDEX idx_portfolio_plan_proposals_approver_open
  ON portfolio_plan_proposals(final_approver_user_id, status)
  WHERE status IN ('submitted', 'under_review');
CREATE INDEX idx_portfolio_plan_proposals_reviewer_open
  ON portfolio_plan_proposals(reviewer_user_id, status)
  WHERE status IN ('submitted', 'under_review');
CREATE UNIQUE INDEX idx_portfolio_plan_proposals_decision
  ON portfolio_plan_proposals(decision_id)
  WHERE decision_id IS NOT NULL;

-- The submission payload is append-only. Only workflow columns may change.
CREATE OR REPLACE FUNCTION preserve_portfolio_plan_proposal_submission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.portfolio_id IS DISTINCT FROM OLD.portfolio_id
     OR NEW.period_id IS DISTINCT FROM OLD.period_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.recommended_slot IS DISTINCT FROM OLD.recommended_slot
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_by_name IS DISTINCT FROM OLD.submitted_by_name
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.final_approver_user_id IS DISTINCT FROM OLD.final_approver_user_id
     OR NEW.final_approver_name IS DISTINCT FROM OLD.final_approver_name
     OR NEW.reviewer_user_id IS DISTINCT FROM OLD.reviewer_user_id
     OR NEW.reviewer_name IS DISTINCT FROM OLD.reviewer_name
     OR NEW.period_revision IS DISTINCT FROM OLD.period_revision
     OR NEW.budget_yen IS DISTINCT FROM OLD.budget_yen
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'submitted portfolio plan proposals are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER portfolio_plan_proposals_immutable_submission
  BEFORE UPDATE ON portfolio_plan_proposals
  FOR EACH ROW EXECUTE FUNCTION preserve_portfolio_plan_proposal_submission();

-- A final decision may later reference the submission it adopts. The snapshot
-- remains the authoritative payload; this link is informational.
ALTER TABLE portfolio_plan_decisions
  ADD COLUMN source_proposal_id BIGINT;
CREATE UNIQUE INDEX idx_portfolio_plan_decisions_source_proposal
  ON portfolio_plan_decisions(source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;
