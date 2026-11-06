import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { isAutomationAction, isAutomationTrigger } from "@/lib/automations";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

async function requireRule(req: Request, projectId: number, automationId: string) {
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return { ok: false as const, response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  const row = await db.query(
    "SELECT id FROM project_automations WHERE id = $1::bigint AND project_id = $2::bigint",
    [automationId, projectId],
  );
  if (row.rowCount === 0) {
    return { ok: false as const, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { ok: true as const };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; automationId: string }> },
) {
  const { id, automationId } = await params;
  const projectId = Number(id);
  const checked = await requireRule(req, projectId, automationId);
  if (!checked.ok) return checked.response;
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (body.trigger !== undefined) {
    if (!isAutomationTrigger(body.trigger)) {
      return NextResponse.json({ error: "invalid trigger" }, { status: 400 });
    }
    values.push(body.trigger);
    sets.push(`trigger = $${values.length}`);
  }
  if (body.action_type !== undefined) {
    if (!isAutomationAction(body.action_type)) {
      return NextResponse.json({ error: "invalid action_type" }, { status: 400 });
    }
    values.push(body.action_type);
    sets.push(`action_type = $${values.length}`);
  }
  if (typeof body.action_value === "string" && body.action_value.trim() !== "") {
    values.push(body.action_value.trim());
    sets.push(`action_value = $${values.length}`);
  }
  if (typeof body.enabled === "boolean") {
    values.push(body.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(automationId);
  await db.query(
    `UPDATE project_automations SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "automation.update", {
    entity: "automation",
    entityId: Number(automationId),
    projectId,
  });
  return NextResponse.json({ id: Number(automationId) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; automationId: string }> },
) {
  const { id, automationId } = await params;
  const projectId = Number(id);
  const checked = await requireRule(req, projectId, automationId);
  if (!checked.ok) return checked.response;
  await db.query("DELETE FROM project_automations WHERE id = $1::bigint", [automationId]);
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "automation.delete", {
    entity: "automation",
    entityId: Number(automationId),
    projectId,
  });
  return NextResponse.json({ deleted: Number(automationId) });
}
