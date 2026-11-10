import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { validateRuleDefinition } from "@/lib/automation/validate";
import { validateRuleConditionScope } from "@/lib/automation/condition-validation";
import { validateRuleCustomFieldActions } from "@/lib/automation/custom-field-actions";
import {
  createProjectRule,
  getProjectRules,
} from "@/lib/automation/repository";
import { db } from "@/lib/db";

export const GET = withProject("view", async (_req, { projectId, uid }) => {
  return NextResponse.json({ rules: await getProjectRules(projectId, uid) });
});

export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const payload = (body ?? {}) as {
      name?: unknown;
      description?: unknown;
      definition?: unknown;
      enabled?: unknown;
    };
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name === "") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const validated = validateRuleDefinition(payload.definition);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const conditions = await validateRuleConditionScope(validated.definition, { projectId }, uid);
    if (!conditions.ok) return NextResponse.json({ error: conditions.error }, { status: 400 });
    const customFields = await validateRuleCustomFieldActions(validated.definition, uid);
    if (!customFields.ok) return NextResponse.json({ error: customFields.error }, { status: customFields.status });
    const project = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [
      projectId,
    ]);
    if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    try {
      const id = await createProjectRule({
        workspaceId: Number(project.rows[0].workspace_id),
        projectId,
        name,
        description: typeof payload.description === "string" ? payload.description.trim() : "",
        definition: validated.definition,
        ownerId: uid,
        enabled: payload.enabled as boolean | undefined,
      });
      await audit(uid, "rule.create", {
        entity: "rule",
        entityId: id,
        projectId,
        summary: name,
      });
      await notifyProject(projectId);
      return NextResponse.json({ id }, { status: 201 });
    } catch (caught) {
      return NextResponse.json(
        { error: caught instanceof Error ? caught.message : "rule creation failed" },
        { status: 400 },
      );
    }
  },
  { body: true },
);
