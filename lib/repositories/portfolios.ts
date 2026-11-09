import { db, withTransaction } from "../db";
import type { Portfolio, PortfolioProject, PortfolioRule } from "../portfolios";
import { RULE_LIMITS, type RuleDefinition } from "../automation/types";
import type { ProjectRule } from "../automation/types";

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

export async function deletePortfolio(portfolioId: number): Promise<void> {
  await db.query("DELETE FROM portfolios WHERE id = $1::bigint", [portfolioId]);
}

export async function getPortfolioProjects(
  portfolioId: number,
  viewerId?: number,
): Promise<PortfolioProject[]> {
  const r = await db.query(
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

export async function addPortfolioProject(
  portfolioId: number,
  projectId: number,
): Promise<void> {
  await withTransaction(async (q) => {
    const p = await q.query(
      `SELECT p.id, p.workspace_id FROM projects p
       JOIN portfolios po ON po.workspace_id = p.workspace_id
       WHERE p.id = $1::bigint AND po.id = $2::bigint AND p.deleted_at IS NULL`,
      [projectId, portfolioId],
    );
    if (p.rowCount === 0) throw new Error("project not found in portfolio workspace");
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
  });
}

export async function removePortfolioProject(
  portfolioId: number,
  projectId: number,
): Promise<void> {
  await withTransaction(async (q) => {
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

export async function getPortfolioRules(portfolioId: number): Promise<PortfolioRule[]> {
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
  return r.rows.map(toRule);
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
}): Promise<number> {
  const count = await db.query(
    "SELECT COUNT(*)::int AS n FROM portfolio_rules WHERE portfolio_id = $1::bigint",
    [input.portfolioId],
  );
  if (Number(count.rows[0].n) >= RULE_LIMITS.rulesPerProject) {
    throw new Error(`ポートフォリオあたり${RULE_LIMITS.rulesPerProject}件までです`);
  }
  return withTransaction(async (q) => {
    const inserted = await q.query(
      `INSERT INTO portfolio_rules (
         workspace_id, portfolio_id, name, description, definition, owner_id
       ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint)
       RETURNING id`,
      [
        input.workspaceId,
        input.portfolioId,
        input.name.slice(0, 120),
        input.description.slice(0, 1000),
        JSON.stringify(input.definition),
        input.ownerId,
      ],
    );
    const ruleId = Number(inserted.rows[0].id);
    await q.query(
      `INSERT INTO project_rules (
         workspace_id, project_id, name, description, definition, owner_id, enabled, version,
         portfolio_rule_id
       )
       SELECT $1::bigint, i.project_id, $2, $3, $4::jsonb, $5::bigint, TRUE, 1, $6::bigint
       FROM portfolio_items i
       WHERE i.portfolio_id = $7::bigint
       ON CONFLICT DO NOTHING`,
      [
        input.workspaceId,
        input.name.slice(0, 120),
        input.description.slice(0, 1000),
        JSON.stringify(input.definition),
        input.ownerId,
        ruleId,
        input.portfolioId,
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
): Promise<void> {
  await withTransaction(async (q) => {
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
      sets.push("version = version + 1");
    }
    if (patch.enabled !== undefined) {
      values.push(patch.enabled);
      sets.push(`enabled = $${values.length}`);
    }
    if (sets.length === 0) return;
    values.push(ruleId, portfolioId);
    const updated = await q.query(
      `UPDATE portfolio_rules SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${values.length - 1}::bigint AND portfolio_id = $${values.length}::bigint
       RETURNING name, description, definition, enabled, version`,
      values,
    );
    if (updated.rowCount === 0) return;
    const rule = updated.rows[0];
    await q.query(
      `UPDATE project_rules SET
         name = $2, description = $3, definition = $4::jsonb,
         enabled = $5, version = $6, updated_at = now()
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
  });
}

export async function deletePortfolioRule(
  ruleId: number,
  portfolioId: number,
): Promise<void> {
  await db.query(
    "DELETE FROM portfolio_rules WHERE id = $1::bigint AND portfolio_id = $2::bigint",
    [ruleId, portfolioId],
  );
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
       rr.details, rr.started_at::text AS started_at, rr.finished_at::text AS finished_at,
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
    ...row,
    id: Number(row.id),
    rule_id: row.rule_id === null ? null : Number(row.rule_id),
    event_id: row.event_id === null ? null : Number(row.event_id),
    rule_version: Number(row.rule_version),
    owner_id: row.owner_id === null ? null : Number(row.owner_id),
    actions_total: Number(row.actions_total),
    actions_succeeded: Number(row.actions_succeeded),
    actions_failed: Number(row.actions_failed),
    project_id: Number(row.project_id),
    details: Array.isArray(row.details) ? row.details : [],
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
