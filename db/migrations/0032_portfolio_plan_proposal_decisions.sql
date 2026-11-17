-- Final approver decision and applicant withdrawal for portfolio investment
-- proposals. Additive: the frozen submission payload, review fields and the
-- existing adopted-decision table/history remain authoritative.
--
-- 'deferred' is a final "今期は見送る" outcome. It closes the open version
-- without creating an adopted decision, exactly like 'returned', so a new
-- version can be submitted for the same quarter.

ALTER TABLE portfolio_plan_proposals
  DROP CONSTRAINT IF EXISTS portfolio_plan_proposals_status_check;

ALTER TABLE portfolio_plan_proposals
  ADD CONSTRAINT portfolio_plan_proposals_status_check CHECK (status IN (
    'submitted', 'under_review', 'pending_decision', 'deferred',
    'returned', 'approved', 'rejected', 'withdrawn', 'superseded'
  ));

ALTER TABLE portfolio_plan_proposals
  ADD COLUMN IF NOT EXISTS decision_action TEXT
    CHECK (decision_action IS NULL OR decision_action IN ('approve', 'return', 'defer')),
  ADD COLUMN IF NOT EXISTS decision_request_id TEXT
    CHECK (decision_request_id IS NULL OR decision_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  ADD COLUMN IF NOT EXISTS withdraw_reason TEXT
    CHECK (withdraw_reason IS NULL OR char_length(btrim(withdraw_reason)) BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS withdraw_request_id TEXT
    CHECK (withdraw_request_id IS NULL OR withdraw_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  ADD COLUMN IF NOT EXISTS withdrawn_by BIGINT,
  ADD COLUMN IF NOT EXISTS withdrawn_by_name TEXT
    CHECK (withdrawn_by_name IS NULL OR char_length(btrim(withdrawn_by_name)) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

-- Request ids are scoped to one portfolio so a retried action can only replay
-- the exact proposal action it originally recorded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_plan_proposals_decision_request
  ON portfolio_plan_proposals(portfolio_id, decision_request_id)
  WHERE decision_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_plan_proposals_withdraw_request
  ON portfolio_plan_proposals(portfolio_id, withdraw_request_id)
  WHERE withdraw_request_id IS NOT NULL;
