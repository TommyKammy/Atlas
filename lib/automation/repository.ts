import { db } from "../db";
import type {
  ProjectRule,
  RuleDefinition,
  RuleRun,
  RuleRunActionDetail,
} from "./types";
import { RULE_LIMITS } from "./types";

function toRule(row: Record<string, unknown>): ProjectRule {
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    project_id: Number(row.project_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    definition: (row.definition ?? {}) as RuleDefinition,
    owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    owner_name: row.owner_name === null || row.owner_name === undefined ? null : String(row.owner_name),
    enabled: row.enabled === true,
    version: Number(row.version ?? 1),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    last_run_at: row.last_run_at === null || row.last_run_at === undefined ? null : String(row.last_run_at),
    last_run_status:
      row.last_run_status === null || row.last_run_status === undefined
        ? null
        : String(row.last_run_status),
  };
}

export async function getProjectRules(projectId: number): Promise<ProjectRule[]> {
  const r = await db.query(
    `SELECT r.id, r.workspace_id, r.project_id, r.name, r.description, r.definition,
       r.owner_id, u.name AS owner_name, r.enabled, r.version,
       r.created_at::text AS created_at, r.updated_at::text AS updated_at,
       lr.started_at::text AS last_run_at, lr.status AS last_run_status
     FROM project_rules r
     LEFT JOIN users u ON u.id = r.owner_id
     LEFT JOIN LATERAL (
       SELECT status, started_at FROM rule_runs
       WHERE rule_id = r.id ORDER BY id DESC LIMIT 1
     ) lr ON TRUE
     WHERE r.project_id = $1::bigint
     ORDER BY r.id`,
    [projectId],
  );
  return r.rows.map(toRule);
}

export async function getProjectRule(
  ruleId: number,
  projectId: number,
): Promise<ProjectRule | null> {
  const r = await db.query(
    `SELECT r.id, r.workspace_id, r.project_id, r.name, r.description, r.definition,
       r.owner_id, u.name AS owner_name, r.enabled, r.version,
       r.created_at::text AS created_at, r.updated_at::text AS updated_at,
       NULL::text AS last_run_at, NULL::text AS last_run_status
     FROM project_rules r LEFT JOIN users u ON u.id = r.owner_id
     WHERE r.id = $1::bigint AND r.project_id = $2::bigint`,
    [ruleId, projectId],
  );
  return r.rowCount === 0 ? null : toRule(r.rows[0]);
}

export async function createProjectRule(input: {
  workspaceId: number;
  projectId: number;
  name: string;
  description: string;
  definition: RuleDefinition;
  ownerId: number;
}): Promise<number> {
  const count = await db.query(
    "SELECT COUNT(*)::int AS n FROM project_rules WHERE project_id = $1::bigint",
    [input.projectId],
  );
  if (Number(count.rows[0].n) >= RULE_LIMITS.rulesPerProject) {
    throw new Error(`プロジェクトあたり${RULE_LIMITS.rulesPerProject}件までです`);
  }
  const r = await db.query(
    `INSERT INTO project_rules (
       workspace_id, project_id, name, description, definition, owner_id
     ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint)
     RETURNING id`,
    [
      input.workspaceId,
      input.projectId,
      input.name.slice(0, 120),
      input.description.slice(0, 1000),
      JSON.stringify(input.definition),
      input.ownerId,
    ],
  );
  return Number(r.rows[0].id);
}

export async function updateProjectRule(
  ruleId: number,
  projectId: number,
  patch: {
    name?: string;
    description?: string;
    definition?: RuleDefinition;
    enabled?: boolean;
  },
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
  values.push(ruleId, projectId);
  await db.query(
    `UPDATE project_rules SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $${values.length - 1}::bigint AND project_id = $${values.length}::bigint`,
    values,
  );
}

export async function deleteProjectRule(ruleId: number, projectId: number): Promise<void> {
  await db.query(
    "DELETE FROM project_rules WHERE id = $1::bigint AND project_id = $2::bigint",
    [ruleId, projectId],
  );
}

export async function recordRuleRun(input: {
  rule: ProjectRule;
  eventId: number | null;
  source: string;
  status: "success" | "failed" | "skipped";
  details: RuleRunActionDetail[];
  error?: string | null;
}): Promise<number> {
  const succeeded = input.details.filter((detail) => detail.status === "success").length;
  const failed = input.details.filter((detail) => detail.status === "failed").length;
  const r = await db.query(
    `INSERT INTO rule_runs (
       rule_id, event_id, rule_name, rule_version, owner_id, source, status,
       actions_total, actions_succeeded, actions_failed, error, details, finished_at
     ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::bigint, $6, $7,
       $8, $9, $10, $11, $12::jsonb, now())
     RETURNING id`,
    [
      input.rule.id,
      input.eventId,
      input.rule.name,
      input.rule.version,
      input.rule.owner_id,
      input.source,
      input.status,
      input.details.length,
      succeeded,
      failed,
      input.error ?? null,
      JSON.stringify(input.details),
    ],
  );
  return Number(r.rows[0].id);
}

export async function getRuleRuns(
  projectId: number,
  ruleId?: number,
  limit = 50,
): Promise<RuleRun[]> {
  const r = await db.query(
    `SELECT rr.id, rr.rule_id, rr.event_id, rr.rule_name, rr.rule_version,
       rr.owner_id, u.name AS owner_name, rr.source, rr.status,
       rr.actions_total, rr.actions_succeeded, rr.actions_failed, rr.error,
       rr.details, rr.started_at::text AS started_at, rr.finished_at::text AS finished_at
     FROM rule_runs rr
     JOIN project_rules pr ON pr.id = rr.rule_id
     LEFT JOIN users u ON u.id = rr.owner_id
     WHERE pr.project_id = $1::bigint
       AND ($2::bigint IS NULL OR rr.rule_id = $2::bigint)
     ORDER BY rr.id DESC
     LIMIT $3`,
    [projectId, ruleId ?? null, Math.min(200, Math.max(1, limit))],
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
    details: Array.isArray(row.details) ? row.details : [],
  })) as RuleRun[];
}
