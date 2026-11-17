-- Preserve frozen records, including records made before role separation.
ALTER TABLE portfolio_plan_approval_settings ADD CONSTRAINT planning_distinct_assignees
  CHECK (default_reviewer_user_id <> final_approver_user_id) NOT VALID;
-- Keep assigned identities after account deletion. An unavailable assignee
-- blocks the workflow until a separately approved replacement is configured.
ALTER TABLE portfolio_plan_approval_settings
  DROP CONSTRAINT portfolio_plan_approval_settings_default_reviewer_user_id_fkey,
  DROP CONSTRAINT portfolio_plan_approval_settings_final_approver_user_id_fkey;
ALTER TABLE portfolio_plan_proposals ADD CONSTRAINT planning_distinct_reviewer
  CHECK (status = 'withdrawn' OR
         (reviewer_user_id <> submitted_by AND reviewer_user_id <> final_approver_user_id))
  NOT VALID;

CREATE FUNCTION retain_portfolio_plan_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Portfolio planning history must be retained'
    USING ERRCODE = '23514', CONSTRAINT = 'portfolio_plan_history_retained';
END;
$$;
CREATE TRIGGER retain_plan_proposals BEFORE DELETE ON portfolio_plan_proposals
  FOR EACH ROW EXECUTE FUNCTION retain_portfolio_plan_history();
CREATE TRIGGER retain_plan_decisions BEFORE DELETE ON portfolio_plan_decisions
  FOR EACH ROW EXECUTE FUNCTION retain_portfolio_plan_history();

CREATE TABLE portfolio_plan_approval_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portfolio_id bigint NOT NULL UNIQUE REFERENCES portfolios(id) ON DELETE CASCADE,
  requested_by bigint NOT NULL,
  enabled boolean NOT NULL,
  approver_id bigint,
  reviewer_id bigint,
  CHECK ((enabled AND approver_id IS NOT NULL) OR
         (NOT enabled AND approver_id IS NULL AND reviewer_id IS NULL)),
  CHECK (reviewer_id <> approver_id)
);

-- Only recover workspace ownership where the original entity still exists.
WITH entities AS (
  SELECT 'portfolio' AS kind, id, workspace_id FROM portfolios
  UNION ALL SELECT 'portfolio_plan_period', id, workspace_id FROM portfolio_plan_periods
  UNION ALL SELECT 'portfolio_initiative', id, workspace_id FROM portfolio_initiatives
  UNION ALL SELECT 'portfolio_plan_proposal', id, workspace_id FROM portfolio_plan_proposals
  UNION ALL SELECT 'portfolio_plan_decision', id, workspace_id FROM portfolio_plan_decisions
)
UPDATE audit_log a SET workspace_id = e.workspace_id FROM entities e
WHERE a.workspace_id IS NULL AND starts_with(a.action, 'portfolio_plan.')
  AND a.entity = e.kind AND a.entity_id = e.id;
