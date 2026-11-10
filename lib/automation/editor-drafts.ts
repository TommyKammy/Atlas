import { randomUUID } from "node:crypto";
import { db, withTransaction, type Queryable } from "../db";
import { ApiError, badRequest, forbidden, notFound } from "../api/errors";
import { canEditProject } from "../project-roles";
import { getProjectAccess } from "../repositories/projects";
import { audit } from "../audit";
import { notifyProject } from "../notify";
import { createProjectRule, getProjectRule, updateProjectRule } from "./repository";
import { validateRuleDefinition } from "./validate";
import { validateRuleConditionScope } from "./condition-validation";
import { validateRuleCustomFieldActions } from "./custom-field-actions";
import { redactWebhookDefinition, retainWebhookSecrets } from "./webhook-credentials";
import type { ProjectRule, RuleDefinition } from "./types";

export type RuleEditorDraftData = {
  id: string;
  project_id: number;
  rule_id: number | null;
  name: string;
  description: string;
  definition: RuleDefinition;
  enabled: boolean;
  revision: number;
  published_revision: number | null;
  base_rule_version: number | null;
  base_rule_updated_at: string | null;
  updated_at: string;
  has_unpublished_changes: boolean;
};

/** List projections never include the rule definition or Webhook destinations. */
export type RuleEditorDraftSummary = Pick<RuleEditorDraftData,
  "id" | "project_id" | "rule_id" | "name" | "updated_at" | "has_unpublished_changes"
>;

type DraftRow = Omit<RuleEditorDraftData, "has_unpublished_changes"> & { user_id: number };
type DraftPatch = { name?: string; description?: string; definition?: RuleDefinition; enabled?: boolean };

const DRAFT_COLUMNS = `id, project_id, user_id, rule_id, name, description, definition, enabled,
  revision, published_revision, base_rule_version, base_rule_updated_at::text AS base_rule_updated_at,
  updated_at::text AS updated_at`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DEFINITION_BYTES = 256_000;

function credentialScope(draft: DraftRow): string {
  return draft.rule_id === null
    ? `draft:${draft.id}`
    : `project:${draft.rule_id}:${draft.base_rule_version}`;
}

function publicDraft(draft: DraftRow): RuleEditorDraftData {
  return {
    id: draft.id,
    project_id: Number(draft.project_id),
    rule_id: draft.rule_id === null ? null : Number(draft.rule_id),
    name: draft.name,
    description: draft.description,
    definition: redactWebhookDefinition(draft.definition, credentialScope(draft)),
    enabled: draft.enabled,
    revision: draft.revision,
    published_revision: draft.published_revision,
    base_rule_version: draft.base_rule_version,
    base_rule_updated_at: draft.base_rule_updated_at,
    updated_at: draft.updated_at,
    has_unpublished_changes: draft.published_revision !== draft.revision,
  };
}

function draftConflict(): ApiError {
  return new ApiError(409, "下書きが更新されました。最新の下書きを読み込んでください", "draft_conflict");
}

function ruleConflict(): ApiError {
  return new ApiError(409, "公開版が更新されました。公開版から読み直してください", "rule_conflict");
}

export function ruleDraftId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw badRequest("invalid draft id");
  return value.toLowerCase();
}

export function ruleDraftRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw badRequest("expected_revision is required");
  }
  return value;
}

/** Saving is deliberately permissive so unfinished cards can be restored later. */
function draftPatch(value: unknown): DraftPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("invalid draft");
  const input = value as Record<string, unknown>;
  const patch: DraftPatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.length > 120) throw badRequest("invalid draft name");
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 1000) throw badRequest("invalid draft description");
    patch.description = input.description;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw badRequest("enabled must be a boolean");
    patch.enabled = input.enabled;
  }
  if (input.definition !== undefined) {
    if (!input.definition || typeof input.definition !== "object" || Array.isArray(input.definition)) {
      throw badRequest("invalid draft definition");
    }
    if (Buffer.byteLength(JSON.stringify(input.definition)) > MAX_DEFINITION_BYTES) {
      throw badRequest("draft definition is too large");
    }
    patch.definition = { version: 1, triggers: [], ...input.definition } as RuleDefinition;
  }
  if (Object.keys(patch).length === 0) throw badRequest("no draft fields supplied");
  return patch;
}

async function editorProject(q: Queryable, projectId: number, userId: number, mutation = false) {
  const project = await q.query(
    `SELECT id, workspace_id FROM projects WHERE id = $1::bigint AND deleted_at IS NULL
     ${mutation ? "FOR KEY SHARE" : ""}`,
    [projectId],
  );
  if (project.rowCount === 0) throw notFound("project not found");
  if (!canEditProject((await getProjectAccess(userId, projectId, q)).role)) throw forbidden();
  return project.rows[0] as { id: number; workspace_id: number };
}

async function ownerRule(q: Queryable, projectId: number, userId: number, ruleId: number, lock = false) {
  if (lock) {
    const row = await q.query(
      `SELECT owner_id FROM project_rules
       WHERE id = $1::bigint AND project_id = $2::bigint AND portfolio_rule_id IS NULL FOR UPDATE`,
      [ruleId, projectId],
    );
    if (row.rowCount === 0) throw notFound("rule not found");
    if (Number(row.rows[0].owner_id) !== userId) throw forbidden("only the rule owner can edit a draft");
  }
  const rule = await getProjectRule(ruleId, projectId, q);
  if (!rule) throw notFound("rule not found");
  if (rule.owner_id !== userId) throw forbidden("only the rule owner can edit a draft");
  return rule;
}

async function ownDraft(q: Queryable, projectId: number, userId: number, id: string, lock = false): Promise<DraftRow> {
  const { rows: [draft] } = await q.query(
    `SELECT ${DRAFT_COLUMNS} FROM project_rule_drafts
     WHERE id = $1::uuid AND project_id = $2::bigint AND user_id = $3::bigint
     ${lock ? "FOR UPDATE" : ""}`,
    [ruleDraftId(id), projectId, userId],
  );
  if (!draft) throw notFound("draft not found");
  return draft as DraftRow;
}

/** Published editor data is owner-only and never carries signing secrets. */
export async function getRuleEditorSource(projectId: number, userId: number, ruleId: number): Promise<ProjectRule | null> {
  await editorProject(db, projectId, userId);
  const rule = await getProjectRule(ruleId, projectId);
  if (!rule) return null;
  if (rule.owner_id !== userId) throw forbidden("only the rule owner can edit a draft");
  return { ...rule, definition: redactWebhookDefinition(rule.definition, `project:${rule.id}:${rule.version}`) };
}

export async function getRuleEditorDraft(
  projectId: number,
  userId: number,
  lookup: { draftId?: string; ruleId?: number },
): Promise<RuleEditorDraftData | null> {
  await editorProject(db, projectId, userId);
  if (lookup.draftId) {
    const { rows: [draft] } = await db.query(
      `SELECT ${DRAFT_COLUMNS} FROM project_rule_drafts
       WHERE id = $1::uuid AND project_id = $2::bigint AND user_id = $3::bigint`,
      [ruleDraftId(lookup.draftId), projectId, userId],
    );
    if (!draft) return null;
    if (draft.rule_id !== null) await ownerRule(db, projectId, userId, Number(draft.rule_id));
    return publicDraft(draft as DraftRow);
  }
  if (lookup.ruleId !== undefined) {
    await ownerRule(db, projectId, userId, lookup.ruleId);
    const { rows: [draft] } = await db.query(
      `SELECT ${DRAFT_COLUMNS} FROM project_rule_drafts
       WHERE project_id = $1::bigint AND user_id = $2::bigint AND rule_id = $3::bigint`,
      [projectId, userId, lookup.ruleId],
    );
    return draft ? publicDraft(draft as DraftRow) : null;
  }
  return null;
}

export async function listRuleEditorDrafts(projectId: number, userId: number): Promise<RuleEditorDraftSummary[]> {
  await editorProject(db, projectId, userId);
  const { rows } = await db.query(
    `SELECT id, project_id, rule_id, name, revision, published_revision,
       updated_at::text AS updated_at FROM project_rule_drafts d
     WHERE project_id = $1::bigint AND user_id = $2::bigint
       AND (rule_id IS NULL OR published_revision IS DISTINCT FROM revision) AND (
       rule_id IS NULL OR EXISTS (
         SELECT 1 FROM project_rules r WHERE r.id = d.rule_id AND r.project_id = d.project_id
           AND r.owner_id = $2::bigint AND r.portfolio_rule_id IS NULL
       )
     ) ORDER BY d.updated_at DESC, id LIMIT 50`,
    [projectId, userId],
  );
  return rows.map((row) => ({
    id: row.id,
    project_id: Number(row.project_id),
    rule_id: row.rule_id === null ? null : Number(row.rule_id),
    name: row.name,
    updated_at: new Date(row.updated_at).toISOString(),
    has_unpublished_changes: row.published_revision !== row.revision,
  }));
}

export async function createRuleEditorDraft(projectId: number, userId: number, ruleId?: number) {
  return withTransaction(async (q) => {
    await editorProject(q, projectId, userId, true);
    const rule = ruleId === undefined ? null : await ownerRule(q, projectId, userId, ruleId, true);
    if (rule) {
      const { rows: [existing] } = await q.query(
        `SELECT ${DRAFT_COLUMNS} FROM project_rule_drafts
         WHERE user_id = $1::bigint AND rule_id = $2::bigint`,
        [userId, rule.id],
      );
      if (existing) return { draft: publicDraft(existing as DraftRow), created: false };
    }
    const { rows: [draft] } = await q.query(
      `INSERT INTO project_rule_drafts (
         id, project_id, user_id, rule_id, base_rule_version, base_rule_updated_at,
         name, description, definition, enabled, published_revision
       ) VALUES ($1::uuid, $2::bigint, $3::bigint, $4::bigint, $5::int, $6::timestamptz,
         $7, $8, $9::jsonb, $10::boolean, $11::int)
       RETURNING ${DRAFT_COLUMNS}`,
      [randomUUID(), projectId, userId, rule?.id ?? null, rule?.version ?? null, rule?.updated_at ?? null,
        rule?.name ?? "", rule?.description ?? "", JSON.stringify(rule?.definition ?? { version: 1, triggers: [], actions: [] }),
        rule?.enabled ?? true, rule ? 1 : null],
    );
    return { draft: publicDraft(draft as DraftRow), created: true };
  });
}

async function lockedDraft(q: Queryable, projectId: number, userId: number, id: string) {
  // A new draft gains its rule ID on first publish. Serialize that transition
  // before choosing the rule-before-draft row lock order.
  await q.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('atlas:rule-draft:' || $1::text, 0))",
    [ruleDraftId(id)],
  );
  const draft = await ownDraft(q, projectId, userId, id);
  const rule = draft.rule_id === null ? null : await ownerRule(q, projectId, userId, Number(draft.rule_id), true);
  return { draft: await ownDraft(q, projectId, userId, id, true), rule };
}

export async function saveRuleEditorDraft(
  projectId: number, userId: number, id: string, expectedRevision: unknown, value: unknown,
): Promise<RuleEditorDraftData> {
  const revision = ruleDraftRevision(expectedRevision);
  const patch = draftPatch(value);
  return withTransaction(async (q) => {
    await editorProject(q, projectId, userId, true);
    const { draft } = await lockedDraft(q, projectId, userId, id);
    if (draft.revision !== revision) throw draftConflict();
    if (patch.definition !== undefined) {
      const retained = retainWebhookSecrets(patch.definition, draft.definition, credentialScope(draft), true);
      if (!retained.ok) throw badRequest(retained.error);
      patch.definition = retained.definition;
    }
    const { rows: [saved] } = await q.query(
      `UPDATE project_rule_drafts SET name = $4, description = $5, definition = $6::jsonb, enabled = $7,
         revision = revision + 1, updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
       WHERE id = $1::uuid AND project_id = $2::bigint AND user_id = $3::bigint AND revision = $8::int
       RETURNING ${DRAFT_COLUMNS}`,
      [id, projectId, userId, patch.name ?? draft.name, patch.description ?? draft.description,
        JSON.stringify(patch.definition ?? draft.definition), patch.enabled ?? draft.enabled, revision],
    );
    if (!saved) throw draftConflict();
    return publicDraft(saved as DraftRow);
  });
}

export async function deleteRuleEditorDraft(
  projectId: number, userId: number, id: string, expectedRevision: unknown,
): Promise<void> {
  const revision = ruleDraftRevision(expectedRevision);
  await withTransaction(async (q) => {
    await editorProject(q, projectId, userId, true);
    const { draft } = await lockedDraft(q, projectId, userId, id);
    if (draft.revision !== revision) throw draftConflict();
    await q.query(
      "DELETE FROM project_rule_drafts WHERE id = $1::uuid AND project_id = $2::bigint AND user_id = $3::bigint",
      [id, projectId, userId],
    );
  });
}

export async function publishRuleEditorDraft(
  projectId: number, userId: number, id: string, expectedRevision: unknown,
): Promise<{ draft: RuleEditorDraftData; rule_id: number }> {
  const revision = ruleDraftRevision(expectedRevision);
  const result = await withTransaction(async (q) => {
    const project = await editorProject(q, projectId, userId, true);
    const { draft, rule } = await lockedDraft(q, projectId, userId, id);
    // The worker locks a rule before its source project. Match that order and
    // prevent trashing the source while publishing.
    const active = await q.query(
      "SELECT id FROM projects WHERE id = $1::bigint AND deleted_at IS NULL FOR SHARE",
      [projectId],
    );
    if (active.rowCount === 0) throw notFound("project not found");
    if (draft.revision !== revision) throw draftConflict();
    if (rule && (rule.version !== draft.base_rule_version || rule.updated_at !== draft.base_rule_updated_at)) {
      throw ruleConflict();
    }
    if (rule && draft.published_revision === revision) return { draft: publicDraft(draft), rule_id: rule.id };
    const name = draft.name.trim();
    if (name === "") throw badRequest("name is required");
    const validated = validateRuleDefinition(draft.definition);
    if (!validated.ok) throw badRequest(validated.error);
    const retained = retainWebhookSecrets(validated.definition, draft.definition, credentialScope(draft), true);
    if (!retained.ok) throw badRequest(retained.error);
    const conditions = await validateRuleConditionScope(retained.definition, { projectId }, userId, q);
    if (!conditions.ok) throw badRequest(conditions.error);
    const fields = await validateRuleCustomFieldActions(retained.definition, userId, q);
    if (!fields.ok) throw new ApiError(fields.status, fields.error, "bad_request");
    let publishedId: number;
    if (rule) {
      const updated = await updateProjectRule(rule.id, projectId, {
        name, description: draft.description.trim(), definition: retained.definition, enabled: draft.enabled,
      }, rule.version, rule.updated_at, q);
      if (!updated) throw ruleConflict();
      publishedId = rule.id;
    } else {
      try {
        publishedId = await createProjectRule({
          workspaceId: Number(project.workspace_id), projectId, ownerId: userId,
          name, description: draft.description.trim(), definition: retained.definition, enabled: draft.enabled,
        }, q);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("プロジェクトあたり")) throw badRequest(error.message);
        throw error;
      }
    }
    const published = await ownerRule(q, projectId, userId, publishedId);
    const { rows: [saved] } = await q.query(
      `UPDATE project_rule_drafts SET rule_id = $4::bigint, base_rule_version = $5::int,
         base_rule_updated_at = $6::timestamptz, name = $7, description = $8, definition = $9::jsonb,
         enabled = $10::boolean, published_revision = revision,
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
       WHERE id = $1::uuid AND project_id = $2::bigint AND user_id = $3::bigint RETURNING ${DRAFT_COLUMNS}`,
      [id, projectId, userId, published.id, published.version, published.updated_at,
        published.name, published.description, JSON.stringify(published.definition), published.enabled],
    );
    await audit(userId, rule ? "rule.update" : "rule.create", {
      entity: "rule", entityId: published.id, projectId, summary: "専用エディターから公開",
    }, q);
    return { draft: publicDraft(saved as DraftRow), rule_id: published.id };
  });
  await notifyProject(projectId);
  return result;
}
