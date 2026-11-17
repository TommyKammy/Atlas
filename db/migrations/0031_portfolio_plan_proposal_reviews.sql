-- Optional feasibility review before the final decision. Additive: the frozen
-- submission payload and existing approval settings are unchanged.
--
-- A proposal with a reviewer waits in 'under_review'. Without one it is ready
-- for the final decision immediately ('pending_decision'). review_outcome makes
-- the path explicit: 'passed' or 'not_required' both reach pending_decision,
-- while 'returned' closes the version and allows a new submission for the quarter.

ALTER TABLE portfolio_plan_proposals
  DROP CONSTRAINT IF EXISTS portfolio_plan_proposals_status_check;

ALTER TABLE portfolio_plan_proposals
  ADD COLUMN review_outcome TEXT
    CHECK (review_outcome IS NULL OR review_outcome IN ('passed', 'returned', 'not_required')),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_request_id TEXT
    CHECK (review_request_id IS NULL OR review_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$');

-- Phase 1 always stored 'submitted'. Preserve reviewer assignment while making
-- the two paths explicit, including rows that are already in flight.
UPDATE portfolio_plan_proposals
SET status = CASE
      WHEN reviewer_user_id IS NULL THEN 'pending_decision'
      ELSE 'under_review'
    END,
    review_outcome = CASE
      WHEN reviewer_user_id IS NULL THEN 'not_required'
      ELSE review_outcome
    END
WHERE status = 'submitted';

ALTER TABLE portfolio_plan_proposals
  ADD CONSTRAINT portfolio_plan_proposals_status_check CHECK (status IN (
    'submitted', 'under_review', 'pending_decision',
    'returned', 'approved', 'rejected', 'withdrawn', 'superseded'
  ));

DROP INDEX IF EXISTS idx_portfolio_plan_proposals_one_open;
CREATE UNIQUE INDEX idx_portfolio_plan_proposals_one_open
  ON portfolio_plan_proposals(period_id)
  WHERE status IN ('submitted', 'under_review', 'pending_decision');

DROP INDEX IF EXISTS idx_portfolio_plan_proposals_approver_open;
CREATE INDEX idx_portfolio_plan_proposals_approver_open
  ON portfolio_plan_proposals(final_approver_user_id, status)
  WHERE status IN ('submitted', 'under_review', 'pending_decision');

DROP INDEX IF EXISTS idx_portfolio_plan_proposals_reviewer_open;
CREATE INDEX idx_portfolio_plan_proposals_reviewer_open
  ON portfolio_plan_proposals(reviewer_user_id, status)
  WHERE status IN ('submitted', 'under_review', 'pending_decision');
