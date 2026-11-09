import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { validateRuleDefinition } from "@/lib/automation/validate";
import type { RuleDefinition } from "@/lib/automation/types";
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
    };
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
    if (payload.definition !== undefined) {
      const validated = validateRuleDefinition(payload.definition);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      patch.definition = validated.definition;
    }
    if (typeof payload.enabled === "boolean") patch.enabled = payload.enabled;
    await updateProjectRule(id, projectId, patch);
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
