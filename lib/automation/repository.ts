import { db, withTransaction, type Queryable } from "../db";
import type {
  ProjectRule,
  RuleDefinition,
  RuleRun,
  RuleRunActionDetail,
  ManualRuleExecution,
} from "./types";
import { RULE_LIMITS } from "./types";
import { assignWebhookActionIds, redactWebhookDefinition, redactWebhookRun } from "./webhook-credentials";
import { historyRuleEvaluation, type RuleEvaluationTrace } from "./evaluation";

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

async function loadProjectRules(
  projectId: number,
  includePortfolioReplicas = false,
  q: Queryable = db,
): Promise<ProjectRule[]> {
  const r = await q.query(
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
       AND ($2::boolean OR r.portfolio_rule_id IS NULL)
     ORDER BY r.id`,
    [projectId, includePortfolioReplicas],
  );
  return r.rows.map(toRule);
}

export async function getProjectRules(projectId: number, viewerId: number): Promise<ProjectRule[]> {
  return (await loadProjectRules(projectId)).map((rule) => ({
    ...rule,
    definition: redactWebhookDefinition(rule.definition,
      rule.owner_id === viewerId ? `project:${rule.id}:${rule.version}` : undefined),
  }));
}

export function getExecutableProjectRules(projectId: number, q?: Queryable): Promise<ProjectRule[]> {
  return loadProjectRules(projectId, true, q);
}

export async function getProjectRule(
  ruleId: number,
  projectId: number,
  q: Queryable = db,
): Promise<ProjectRule | null> {
  const r = await q.query(
    `SELECT r.id, r.workspace_id, r.project_id, r.name, r.description, r.definition,
       r.owner_id, u.name AS owner_name, r.enabled, r.version,
       r.created_at::text AS created_at, r.updated_at::text AS updated_at,
       NULL::text AS last_run_at, NULL::text AS last_run_status
     FROM project_rules r LEFT JOIN users u ON u.id = r.owner_id
     WHERE r.id = $1::bigint AND r.project_id = $2::bigint
       AND r.portfolio_rule_id IS NULL`,
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
  enabled?: boolean;
}, q: Queryable = db): Promise<number> {
  if (q === db) return withTransaction((writer) => createProjectRule(input, writer));
  await q.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('atlas:project-rules:' || $1::text, 0))",
    [input.projectId],
  );
  const count = await q.query(
    "SELECT COUNT(*)::int AS n FROM project_rules WHERE project_id = $1::bigint",
    [input.projectId],
  );
  if (Number(count.rows[0].n) >= RULE_LIMITS.rulesPerProject) {
    throw new Error(`プロジェクトあたり${RULE_LIMITS.rulesPerProject}件までです`);
  }
  const r = await q.query(
    `INSERT INTO project_rules (
       workspace_id, project_id, name, description, definition, owner_id, enabled
     ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint, $7::boolean)
     RETURNING id`,
    [
      input.workspaceId,
      input.projectId,
      input.name.slice(0, 120),
      input.description.slice(0, 1000),
      JSON.stringify(assignWebhookActionIds(input.definition)),
      input.ownerId,
      input.enabled ?? true,
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
  expectedVersion?: number,
  expectedUpdatedAt?: string,
  q: Queryable = db,
): Promise<boolean> {
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
  const ruleParam = values.length + 1;
  values.push(ruleId, projectId, expectedVersion ?? null, expectedUpdatedAt ?? null);
  const updated = await q.query(
    `UPDATE project_rules SET ${sets.join(", ")},
       updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
     WHERE id = $${ruleParam}::bigint AND project_id = $${ruleParam + 1}::bigint
       AND portfolio_rule_id IS NULL
       AND ($${ruleParam + 2}::integer IS NULL OR version = $${ruleParam + 2}::integer)
       AND ($${ruleParam + 3}::text IS NULL OR updated_at::text = $${ruleParam + 3}::text)`,
    values,
  );
  return updated.rowCount !== 0;
}

export async function deleteProjectRule(ruleId: number, projectId: number): Promise<void> {
  await db.query(
    "DELETE FROM project_rules WHERE id = $1::bigint AND project_id = $2::bigint AND portfolio_rule_id IS NULL",
    [ruleId, projectId],
  );
}

export async function recordRuleRun(input: {
  rule: Pick<ProjectRule, "name" | "version" | "owner_id"> & { id: number | null };
  eventId: number | null;
  source: string;
  status: "success" | "failed" | "skipped";
  details: RuleRunActionDetail[];
  plannedActions?: number;
  evaluation?: RuleEvaluationTrace;
  error?: string | null;
}, q: Queryable = db): Promise<number> {
  const history = redactWebhookRun(input);
  const succeeded = input.details.filter((detail) => detail.status === "success").length;
  const failed = input.details.filter((detail) => detail.status === "failed").length;
  const r = await q.query(
    `INSERT INTO rule_runs (
       rule_id, event_id, rule_name, rule_version, owner_id, source, status,
       actions_total, actions_succeeded, actions_failed, error, details, finished_at, evaluation
     ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::bigint, $6, $7,
       $8, $9, $10, $11, $12::jsonb, now(), $13::jsonb)
     RETURNING id`,
    [
      input.rule.id,
      input.eventId,
      input.rule.name,
      input.rule.version,
      input.rule.owner_id,
      input.source,
      input.status,
      input.plannedActions ?? input.details.length,
      succeeded,
      failed,
      history.error ?? null,
      JSON.stringify(history.details),
      input.evaluation ? JSON.stringify(historyRuleEvaluation(input.evaluation)) : null,
    ],
  );
  return Number(r.rows[0].id);
}

export async function getRuleRuns(
  projectId: number,
  ruleId?: number,
  limit = 50,
  eventId?: number,
): Promise<RuleRun[]> {
  const r = await db.query(
    `SELECT rr.id, rr.rule_id, rr.event_id, rr.rule_name, rr.rule_version,
       rr.owner_id, u.name AS owner_name, rr.source, rr.status,
       rr.actions_total, rr.actions_succeeded, rr.actions_failed, rr.error,
       rr.details, rr.started_at::text AS started_at, rr.finished_at::text AS finished_at, rr.evaluation
     FROM rule_runs rr
     JOIN project_rules pr ON pr.id = rr.rule_id
     LEFT JOIN users u ON u.id = rr.owner_id
     WHERE pr.project_id = $1::bigint
       AND pr.portfolio_rule_id IS NULL
       AND ($2::bigint IS NULL OR rr.rule_id = $2::bigint)
       AND ($4::bigint IS NULL OR rr.event_id = $4::bigint)
     ORDER BY rr.id DESC
     LIMIT $3`,
    [projectId, ruleId ?? null, Math.min(200, Math.max(1, limit)), eventId ?? null],
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
    ...(Array.isArray(row.details) ? {} : { details: [] }),
    evaluation: row.evaluation ? historyRuleEvaluation(row.evaluation as RuleEvaluationTrace) : undefined,
  })) as RuleRun[];
}

/** An execution receipt is scoped to the exact rule and its manual event. */
export async function getManualRuleExecution(
  projectId: number,
  ruleId: number,
  eventId: number,
): Promise<ManualRuleExecution | null> {
  const result = await db.query(
    `SELECT e.id, e.processed_at, e.failed_at, rr.status, rr.error, rr.details
     FROM domain_events e
     LEFT JOIN rule_runs rr ON rr.event_id = e.id AND rr.rule_id = $2::bigint
     WHERE e.id = $3::bigint AND e.project_id = $1::bigint
       AND e.type = 'task.manual_rule' AND e.data->>'target_rule_id' = $2::text`,
    [projectId, ruleId, eventId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const status = row.status ?? (row.failed_at ? "failed" : row.processed_at ? "skipped" : "queued");
  return {
    event_id: Number(row.id), status,
    error: row.status ? redactWebhookRun(row).error ?? null
      : row.failed_at ? "ルールの処理に失敗しました。実行履歴を確認してください。" : null,
  };
}
