import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { isAutomationAction, isAutomationTrigger } from "@/lib/automations";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withProject("edit", async (_req, { uid, projectId, params, body }) => {
  const automationId = params.automationId;
  const owned = await db.query(
    "SELECT id FROM project_automations WHERE id = $1::bigint AND project_id = $2::bigint",
    [automationId, projectId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const payload = (body ?? {}) as { name?: unknown; trigger?: unknown; action_type?: unknown; action_value?: unknown; enabled?: unknown };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof payload.name === "string" && payload.name.trim() !== "") {
    values.push(payload.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (payload.trigger !== undefined) {
    if (!isAutomationTrigger(payload.trigger)) {
      return NextResponse.json({ error: "invalid trigger" }, { status: 400 });
    }
    values.push(payload.trigger);
    sets.push(`trigger = $${values.length}`);
  }
  if (payload.action_type !== undefined) {
    if (!isAutomationAction(payload.action_type)) {
      return NextResponse.json({ error: "invalid action_type" }, { status: 400 });
    }
    values.push(payload.action_type);
    sets.push(`action_type = $${values.length}`);
  }
  if (typeof payload.action_value === "string" && payload.action_value.trim() !== "") {
    values.push(payload.action_value.trim());
    sets.push(`action_value = $${values.length}`);
  }
  if (typeof payload.enabled === "boolean") {
    values.push(payload.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(automationId);
  await db.query(
    `UPDATE project_automations SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(uid, "automation.update", {
    entity: "automation",
    entityId: Number(automationId),
    projectId,
  });
  return NextResponse.json({ id: Number(automationId) });
}, { body: true });

export const DELETE = withProject("edit", async (_req, { uid, projectId, params }) => {
  const automationId = params.automationId;
  const owned = await db.query(
    "SELECT id FROM project_automations WHERE id = $1::bigint AND project_id = $2::bigint",
    [automationId, projectId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.query("DELETE FROM project_automations WHERE id = $1::bigint", [automationId]);
  await notifyProject(projectId);
  await audit(uid, "automation.delete", {
    entity: "automation",
    entityId: Number(automationId),
    projectId,
  });
  return NextResponse.json({ deleted: Number(automationId) });
});
