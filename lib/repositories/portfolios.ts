import { db, withTransaction, type Queryable } from "../db";
import type { Portfolio, PortfolioProject, PortfolioRule } from "../portfolios";
import { RULE_LIMITS, type RuleDefinition } from "../automation/types";
import type { ProjectRule } from "../automation/types";
import { assignWebhookActionIds, redactWebhookDefinition, redactWebhookRun } from "../automation/webhook-credentials";
import { forbidden } from "../api/errors";
import { getProjectPolicyAccess } from "../project-policy-access";
import { normalizeProjectSettings } from "../project-settings";
import { canEditProject } from "../project-roles";
import { getProjectAccess } from "./projects";
import { historyRuleEvaluation, type RuleEvaluationTrace } from "../automation/evaluation";

function toRule(row: Record<string, unknown>): PortfolioRule {
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    project_id: 0,
    portfolio_id: Number(row.portfolio_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    definition: (row.definition ?? {}) as RuleDefinition,
    owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    owner_name: row.owner_name === null || row.owner_name === undefined ? null : String(row.owner_name),
    enabled: row.enabled === true,
    version: Number(row.version ?? 1),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    last_run_at:
      row.last_run_at === null || row.last_run_at === undefined ? null : String(row.last_run_at),
    last_run_status:
      row.last_run_status === null || row.last_run_status === undefined
        ? null
        : String(row.last_run_status),
  };
}

export async function getPortfolios(
  workspaceId: number,
  viewerId: number,
): Promise<Portfolio[]> {
  const r = await db.query(
    `SELECT p.id, p.workspace_id, p.name, p.description, p.owner_id,
       u.name AS owner_name,
       (SELECT COUNT(*)::int FROM portfolio_items i WHERE i.portfolio_id = p.id) AS project_count,
       (SELECT COUNT(*)::int FROM portfolio_rules pr WHERE pr.portfolio_id = p.id) AS rule_count,
       (EXISTS (SELECT 1 FROM users v WHERE v.id = $2 AND v.is_admin) OR p.owner_id = $2) AS can_edit,
       (EXISTS (SELECT 1 FROM users v WHERE v.id = $2 AND v.is_admin)
         OR p.owner_id = $2
         OR EXISTS (SELECT 1 FROM portfolio_plan_viewers pv
                    WHERE pv.portfolio_id = p.id AND pv.user_id = $2)) AS can_view_plan,
       p.created_at::text AS created_at, p.updated_at::text AS updated_at
     FROM portfolios p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.workspace_id = $1::bigint
     ORDER BY p.id`,
    [workspaceId, viewerId],
  );
  return r.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    owner_id: row.owner_id === null ? null : Number(row.owner_id),
    project_count: Number(row.project_count ?? 0),
    rule_count: Number(row.rule_count ?? 0),
    can_edit: row.can_edit === true,
    can_view_plan: row.can_view_plan === true,
  })) as Portfolio[];
}

export async function getPortfolio(
  portfolioId: number,
  workspaceId: number,
  viewerId: number,
): Promise<Portfolio | null> {
  const r = await db.query(
    `SELECT p.id, p.workspace_id, p.name, p.description, p.owner_id,
       u.name AS owner_name,
       (SELECT COUNT(*)::int FROM portfolio_items i WHERE i.portfolio_id = p.id) AS project_count,
       (SELECT COUNT(*)::int FROM portfolio_rules pr WHERE pr.portfolio_id = p.id) AS rule_count,
       (EXISTS (SELECT 1 FROM users v WHERE v.id = $3 AND v.is_admin) OR p.owner_id = $3) AS can_edit,
       (EXISTS (SELECT 1 FROM users v WHERE v.id = $3 AND v.is_admin)
         OR p.owner_id = $3
         OR EXISTS (SELECT 1 FROM portfolio_plan_viewers pv
                    WHERE pv.portfolio_id = p.id AND pv.user_id = $3)) AS can_view_plan,
       p.created_at::text AS created_at, p.updated_at::text AS updated_at
     FROM portfolios p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = $1::bigint AND p.workspace_id = $2::bigint`,
    [portfolioId, workspaceId, viewerId],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    ...row,
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    owner_id: row.owner_id === null ? null : Number(row.owner_id),
    project_count: Number(row.project_count ?? 0),
    rule_count: Number(row.rule_count ?? 0),
    can_edit: row.can_edit === true,
    can_view_plan: row.can_view_plan === true,
  } as Portfolio;
}

export async function createPortfolio(
  workspaceId: number,
  ownerId: number,
  name: string,
  description: string,
): Promise<number> {
  const r = await db.query(
    `INSERT INTO portfolios (workspace_id, name, description, owner_id)
     VALUES ($1::bigint, $2, $3, $4::bigint) RETURNING id`,
    [workspaceId, name.slice(0, 120), description.slice(0, 1000), ownerId],
  );
  return Number(r.rows[0].id);
}

export async function updatePortfolio(
  portfolioId: number,
  patch: { name?: string; description?: string },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    values.push(patch.name.slice(0, 120));
    sets.push(`name = $${values.length}`);
  }
  if (patch.description !== undefined) {
    values.push(patch.description.slice(0, 1000));
    sets.push(`description = $${values.length}`);
  }
  if (sets.length === 0) return;
  values.push(portfolioId);
  await db.query(
    `UPDATE portfolios SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
}

export async function deletePortfolio(portfolioId: number, actorId: number): Promise<void> {
  await withTransaction(async (q) => {
    await lockPortfolio(q, portfolioId);
    await assertPortfolioConfiguration(q, portfolioId, actorId);
    await q.query("DELETE FROM portfolios WHERE id = $1::bigint", [portfolioId]);
  });
}

export async function getPortfolioProjects(
  portfolioId: number,
  viewerId?: number,
  q: Queryable = db,
): Promise<PortfolioProject[]> {
  const r = await q.query(
    `SELECT p.id, p.name, p.color, p.icon
     FROM portfolio_items i JOIN projects p ON p.id = i.project_id
     WHERE i.portfolio_id = $1::bigint AND p.deleted_at IS NULL
       AND ($2::bigint IS NULL
         OR EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2))
     ORDER BY i.added_at, p.id`,
    [portfolioId, viewerId ?? null],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    color: row.color === null ? null : String(row.color),
    icon: row.icon === null ? null : String(row.icon),
  }));
}

// Serialize changes to portfolio membership with the rules replicated to those projects.
async function lockPortfolio(q: Queryable, portfolioId: number): Promise<void> {
  await q.query("SELECT id FROM portfolios WHERE id = $1 FOR NO KEY UPDATE", [portfolioId]);
}

/** Retain legacy portfolio linking roles while respecting explicitly locked project workflows. */
async function assertPortfolioConfiguration(q: Queryable, portfolioId: number, actorId: number, projectId?: number, creating = false): Promise<void> {
  const projects = await q.query(`SELECT p.id, p.settings FROM projects p
    WHERE p.deleted_at IS NULL AND ($2::bigint IS NULL OR p.id = $2)
      AND (p.id = $2 OR EXISTS (SELECT 1 FROM portfolio_items i WHERE i.portfolio_id = $1 AND i.project_id = p.id))
      AND ($3::boolean OR EXISTS (SELECT 1 FROM portfolio_rules r WHERE r.portfolio_id = $1))`, [portfolioId, projectId ?? null, creating]);
  for (const project of projects.rows) {
    if (normalizeProjectSettings(project.settings).who_can_edit === "admins" &&
        !(await getProjectPolicyAccess(actorId, Number(project.id), q)).canConfigure) {
      throw forbidden("a linked project restricts workflow changes to admins");
    }
  }
}

export async function addPortfolioProject(
  portfolioId: number,
  projectId: number,
  actorId: number,
): Promise<boolean> {
  return withTransaction(async (q) => {
    await lockPortfolio(q, portfolioId);
    const { role } = await getProjectAccess(actorId, projectId, q);
    if (!role) return false;
    const p = await q.query(
      `SELECT p.id FROM projects p
       JOIN portfolios po ON po.workspace_id = p.workspace_id
       WHERE p.id = $1::bigint AND po.id = $2::bigint AND p.deleted_at IS NULL`,
      [projectId, portfolioId],
    );
    if (p.rowCount === 0) throw new Error("project not found in portfolio workspace");
    await assertPortfolioConfiguration(q, portfolioId, actorId, projectId);
    if (!canEditProject(role)) {
      const { rows: [state] } = await q.query(
        `SELECT
           EXISTS (SELECT 1 FROM portfolio_items WHERE portfolio_id = $1 AND project_id = $2) AS already_added,
           EXISTS (
             SELECT 1 FROM portfolio_rules
             WHERE portfolio_id = $1 AND enabled AND owner_id <> $3
           ) AS installs_other_owners_rules`,
        [portfolioId, projectId, actorId],
      );
      // A read-only retry can retain the portfolio item without reinstalling any rule.
      if (state.already_added) return true;
      if (state.installs_other_owners_rules) return false;
    }
    await q.query(
      `INSERT INTO portfolio_items (portfolio_id, project_id)
       VALUES ($1::bigint, $2::bigint) ON CONFLICT DO NOTHING`,
      [portfolioId, projectId],
    );
    await q.query(
      `INSERT INTO project_rules (
         workspace_id, project_id, name, description, definition, owner_id, enabled, version,
         portfolio_rule_id
       )
       SELECT pr.workspace_id, $2::bigint, pr.name, pr.description, pr.definition,
         pr.owner_id, pr.enabled, pr.version, pr.id
       FROM portfolio_rules pr
       WHERE pr.portfolio_id = $1::bigint
       ON CONFLICT DO NOTHING`,
      [portfolioId, projectId],
    );
    return true;
  });
}

export async function removePortfolioProject(
  portfolioId: number,
  projectId: number,
  actorId: number,
): Promise<void> {
  await withTransaction(async (q) => {
    await lockPortfolio(q, portfolioId);
    await assertPortfolioConfiguration(q, portfolioId, actorId, projectId);
    await q.query(
      "DELETE FROM portfolio_items WHERE portfolio_id = $1::bigint AND project_id = $2::bigint",
      [portfolioId, projectId],
    );
    await q.query(
      `DELETE FROM project_rules
       WHERE project_id = $2::bigint AND portfolio_rule_id IN (
         SELECT id FROM portfolio_rules WHERE portfolio_id = $1::bigint
       )`,
      [portfolioId, projectId],
    );
  });
}

export async function getPortfolioRules(portfolioId: number, viewerId: number): Promise<PortfolioRule[]> {
  const r = await db.query(
    `SELECT pr.id, pr.workspace_id, pr.portfolio_id, pr.name, pr.description,
       pr.definition, pr.owner_id, u.name AS owner_name, pr.enabled, pr.version,
       pr.created_at::text AS created_at, pr.updated_at::text AS updated_at,
       lr.started_at::text AS last_run_at, lr.status AS last_run_status
     FROM portfolio_rules pr
     LEFT JOIN users u ON u.id = pr.owner_id
     LEFT JOIN LATERAL (
       SELECT rr.status, rr.started_at
       FROM rule_runs rr
       JOIN project_rules rp ON rp.id = rr.rule_id
       WHERE rp.portfolio_rule_id = pr.id
       ORDER BY rr.id DESC
       LIMIT 1
     ) lr ON TRUE
     WHERE pr.portfolio_id = $1::bigint
     ORDER BY pr.id`,
    [portfolioId],
  );
  return r.rows.map(toRule).map((rule) => ({
    ...rule,
    definition: redactWebhookDefinition(rule.definition,
      rule.owner_id === viewerId ? `portfolio:${rule.id}:${rule.version}` : undefined),
  }));
}

export async function getPortfolioRule(
  ruleId: number,
  portfolioId: number,
): Promise<PortfolioRule | null> {
  const r = await db.query(
    `SELECT pr.id, pr.workspace_id, pr.portfolio_id, pr.name, pr.description,
       pr.definition, pr.owner_id, u.name AS owner_name, pr.enabled, pr.version,
       pr.created_at::text AS created_at, pr.updated_at::text AS updated_at,
       NULL::text AS last_run_at, NULL::text AS last_run_status
     FROM portfolio_rules pr
     LEFT JOIN users u ON u.id = pr.owner_id
     WHERE pr.id = $1::bigint AND pr.portfolio_id = $2::bigint`,
    [ruleId, portfolioId],
  );
  return r.rowCount === 0 ? null : toRule(r.rows[0]);
}

export async function createPortfolioRule(input: {
  workspaceId: number;
  portfolioId: number;
  name: string;
  description: string;
  definition: RuleDefinition;
  ownerId: number;
  enabled?: boolean;
}): Promise<number> {
  return withTransaction(async (q) => {
    await lockPortfolio(q, input.portfolioId);
    await assertPortfolioConfiguration(q, input.portfolioId, input.ownerId, undefined, true);
    const count = await q.query(
      "SELECT COUNT(*)::int AS n FROM portfolio_rules WHERE portfolio_id = $1::bigint",
      [input.portfolioId],
    );
    if (Number(count.rows[0].n) >= RULE_LIMITS.rulesPerProject) {
      throw new Error(`ポートフォリオあたり${RULE_LIMITS.rulesPerProject}件までです`);
    }
    const definition = JSON.stringify(assignWebhookActionIds(input.definition));
    const inserted = await q.query(
      `INSERT INTO portfolio_rules (
         workspace_id, portfolio_id, name, description, definition, owner_id, enabled
       ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint, $7::boolean)
       RETURNING id`,
      [
        input.workspaceId,
        input.portfolioId,
        input.name.slice(0, 120),
        input.description.slice(0, 1000),
        definition,
        input.ownerId,
        input.enabled ?? true,
      ],
    );
    const ruleId = Number(inserted.rows[0].id);
    await q.query(
      `INSERT INTO project_rules (
         workspace_id, project_id, name, description, definition, owner_id, enabled, version,
         portfolio_rule_id
       )
       SELECT $1::bigint, i.project_id, $2, $3, $4::jsonb, $5::bigint, $8::boolean, 1, $6::bigint
       FROM portfolio_items i
       WHERE i.portfolio_id = $7::bigint
       ON CONFLICT DO NOTHING`,
      [
        input.workspaceId,
        input.name.slice(0, 120),
        input.description.slice(0, 1000),
        definition,
        input.ownerId,
        ruleId,
        input.portfolioId,
        input.enabled ?? true,
      ],
    );
    return ruleId;
  });
}

export async function updatePortfolioRule(
  ruleId: number,
  portfolioId: number,
  patch: {
    name?: string;
    description?: string;
    definition?: RuleDefinition;
    enabled?: boolean;
  },
  expectedVersion: number | undefined,
  expectedUpdatedAt: string | undefined,
  actorId: number,
): Promise<boolean> {
  return withTransaction(async (q) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      values.push(patch.name.slice(0, 120));
      sets.push(`name = $${values.length}`);
    }
    if (patch.description !== undefined) {
      values.push(patch.description.slice(0, 1000));
      sets.push(`description = $${values.length}`);
    }
    if (patch.definition !== undefined) {
      values.push(JSON.stringify(patch.definition));
      sets.push(`definition = $${values.length}::jsonb`);
      sets.push(`version = version + CASE WHEN definition IS DISTINCT FROM $${values.length}::jsonb THEN 1 ELSE 0 END`);
    }
    if (patch.enabled !== undefined) {
      values.push(patch.enabled);
      sets.push(`enabled = $${values.length}`);
    }
    if (sets.length === 0) return true;
    await lockPortfolio(q, portfolioId);
    await assertPortfolioConfiguration(q, portfolioId, actorId);
    const ruleParam = values.length + 1;
    values.push(ruleId, portfolioId, expectedVersion ?? null, expectedUpdatedAt ?? null);
    const updated = await q.query(
      `UPDATE portfolio_rules SET ${sets.join(", ")},
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
       WHERE id = $${ruleParam}::bigint AND portfolio_id = $${ruleParam + 1}::bigint
         AND ($${ruleParam + 2}::integer IS NULL OR version = $${ruleParam + 2}::integer)
         AND ($${ruleParam + 3}::text IS NULL OR updated_at::text = $${ruleParam + 3}::text)
       RETURNING name, description, definition, enabled, version`,
      values,
    );
    if (updated.rowCount === 0) return false;
    const rule = updated.rows[0];
    await q.query(
      `UPDATE project_rules SET
         name = $2, description = $3, definition = $4::jsonb,
         enabled = $5, version = $6,
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
       WHERE portfolio_rule_id = $1::bigint`,
      [
        ruleId,
        rule.name,
        rule.description,
        JSON.stringify(rule.definition),
        rule.enabled,
        rule.version,
      ],
    );
    return true;
  });
}

export async function deletePortfolioRule(
  ruleId: number,
  portfolioId: number,
  actorId: number,
): Promise<void> {
  await withTransaction(async (q) => {
    await lockPortfolio(q, portfolioId);
    await assertPortfolioConfiguration(q, portfolioId, actorId);
    await q.query(
      "DELETE FROM portfolio_rules WHERE id = $1::bigint AND portfolio_id = $2::bigint",
      [ruleId, portfolioId],
    );
  });
}

export async function getPortfolioRuleRuns(
  portfolioId: number,
  viewerId: number,
  ruleId?: number,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT rr.id, rr.rule_id, rr.event_id, rr.rule_name, rr.rule_version,
       rr.owner_id, u.name AS owner_name, rr.source, rr.status,
       rr.actions_total, rr.actions_succeeded, rr.actions_failed, rr.error,
       rr.details, rr.started_at::text AS started_at, rr.finished_at::text AS finished_at, rr.evaluation,
       rp.project_id, p.name AS project_name
     FROM rule_runs rr
     JOIN project_rules rp ON rp.id = rr.rule_id
     JOIN portfolio_rules pr ON pr.id = rp.portfolio_rule_id
     JOIN projects p ON p.id = rp.project_id
     LEFT JOIN users u ON u.id = rr.owner_id
     WHERE pr.portfolio_id = $1::bigint
       AND ($2::bigint IS NULL OR rp.portfolio_rule_id = $2::bigint)
       AND (EXISTS (SELECT 1 FROM users v WHERE v.id = $4 AND v.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $4))
     ORDER BY rr.id DESC
     LIMIT $3`,
    [portfolioId, ruleId ?? null, Math.min(200, Math.max(1, limit)), viewerId],
  );
  return r.rows.map((row) => ({
    ...redactWebhookRun(row),
    id: Number(row.id),
    rule_id: row.rule_id === null ? null : Number(row.rule_id),
    event_id: row.event_id === null ? null : Number(row.event_id),
    rule_version: Number(row.rule_version),
    owner_id: row.owner_id === null ? null : Number(row.owner_id),
    actions_total: Number(row.actions_total),
    actions_succeeded: Number(row.actions_succeeded),
    actions_failed: Number(row.actions_failed),
    project_id: Number(row.project_id),
    evaluation: row.evaluation ? historyRuleEvaluation(row.evaluation as RuleEvaluationTrace) : undefined,
    ...(Array.isArray(row.details) ? {} : { details: [] }),
  }));
}

/** Rules replicated for one portfolio, useful for cleanup/assertions. */
export async function getPortfolioReplicaRules(portfolioId: number): Promise<ProjectRule[]> {
  const r = await db.query(
    `SELECT rp.* FROM project_rules rp
     JOIN portfolio_rules pr ON pr.id = rp.portfolio_rule_id
     WHERE pr.portfolio_id = $1::bigint`,
    [portfolioId],
  );
  return r.rows as ProjectRule[];
}
