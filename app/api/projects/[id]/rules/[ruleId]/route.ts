import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { validateRuleDefinition } from "@/lib/automation/validate";
import { validateRuleConditionScope } from "@/lib/automation/condition-validation";
import { validateRuleCustomFieldActions } from "@/lib/automation/custom-field-actions";
import type { RuleDefinition } from "@/lib/automation/types";
import { retainWebhookSecrets } from "@/lib/automation/webhook-credentials";
import {
  deleteProjectRule,
  getProjectRule,
  updateProjectRule,
} from "@/lib/automation/repository";

function ruleId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const PATCH = withProject(
  "edit",
  async (_req, { uid, projectId, params, body }) => {
    const id = ruleId(params.ruleId);
    if (id === null) return NextResponse.json({ error: "invalid rule id" }, { status: 400 });
    const existing = await getProjectRule(id, projectId);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    const payload = (body ?? {}) as {
      name?: unknown;
      description?: unknown;
      definition?: unknown;
      enabled?: unknown;
      webhookActionIds?: unknown;
      expected_updated_at?: unknown;
    };
    if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    // The definition executes with the owner's permissions.
    if (existing.owner_id !== uid && (payload.definition !== undefined || payload.enabled === true)) {
      return NextResponse.json(
        { error: "ルールの定義を変更・有効化できるのは所有者のみです" },
        { status: 403 },
      );
    }
    if (payload.expected_updated_at !== undefined &&
        (typeof payload.expected_updated_at !== "string" || payload.expected_updated_at.trim() === "")) {
      return NextResponse.json({ error: "invalid expected_updated_at" }, { status: 400 });
    }
    if (payload.expected_updated_at !== undefined && payload.expected_updated_at !== existing.updated_at) {
      return NextResponse.json({ error: "ルールが更新されました。最新のルールを読み込んでください" }, { status: 409 });
    }
    const patch: {
      name?: string;
      description?: string;
      definition?: RuleDefinition;
      enabled?: boolean;
    } = {};
    if (typeof payload.name === "string" && payload.name.trim() !== "") {
      patch.name = payload.name.trim();
    }
    if (typeof payload.description === "string") {
      patch.description = payload.description.trim();
    }
    if (payload.enabled === true && payload.definition === undefined) {
      const validated = validateRuleDefinition(existing.definition);
      if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    if (payload.definition !== undefined) {
      const validated = validateRuleDefinition(payload.definition);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      const conditions = await validateRuleConditionScope(validated.definition, { projectId }, uid);
      if (!conditions.ok) return NextResponse.json({ error: conditions.error }, { status: 400 });
      const retained = retainWebhookSecrets(validated.definition, existing.definition,
        `project:${existing.id}:${existing.version}`, payload.webhookActionIds === true);
      if (!retained.ok) return NextResponse.json({ error: retained.error }, { status: 400 });
      patch.definition = retained.definition;
      const customFields = await validateRuleCustomFieldActions(patch.definition, uid);
      if (!customFields.ok) return NextResponse.json({ error: customFields.error }, { status: customFields.status });
    }
    if (typeof payload.enabled === "boolean") patch.enabled = payload.enabled;
    // Protect the loaded owner, definition and retained credentials until the write.
    const updated = await updateProjectRule(id, projectId, patch, existing.version, existing.updated_at);
    if (!updated) {
      return NextResponse.json({ error: "ルールが更新されました。最新のルールを読み込んでください" }, { status: 409 });
    }
    await audit(uid, "rule.update", {
      entity: "rule",
      entityId: id,
      projectId,
      summary: Object.keys(patch).join(","),
    });
    await notifyProject(projectId);
    return NextResponse.json({ id });
  },
  { body: true },
);

export const DELETE = withProject("edit", async (_req, { uid, projectId, params }) => {
  const id = ruleId(params.ruleId);
  if (id === null) return NextResponse.json({ error: "invalid rule id" }, { status: 400 });
  const existing = await getProjectRule(id, projectId);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteProjectRule(id, projectId);
  await audit(uid, "rule.delete", { entity: "rule", entityId: id, projectId });
  await notifyProject(projectId);
  return NextResponse.json({ deleted: id });
});
