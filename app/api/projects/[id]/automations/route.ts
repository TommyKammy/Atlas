import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { getProjectAutomations } from "@/lib/data";
import { isAutomationAction, isAutomationTrigger } from "@/lib/automations";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json(await getProjectAutomations(projectId));
});

export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { name?: unknown; trigger?: unknown; action_type?: unknown; action_value?: unknown };
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const trigger = payload.trigger;
  const actionType = payload.action_type;
  const actionValue = typeof payload.action_value === "string" ? payload.action_value.trim() : "";
  if (
    name === "" ||
    !isAutomationTrigger(trigger) ||
    !isAutomationAction(actionType) ||
    actionValue === ""
  ) {
    return NextResponse.json({ error: "name, trigger, action_type and action_value are required" }, { status: 400 });
  }
  if (actionType === "set_assignee" && !/^\d+$/.test(actionValue)) {
    return NextResponse.json({ error: "assignee must be a user id" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO project_automations (project_id, name, trigger, action_type, action_value, created_by)
     VALUES ($1::bigint, $2, $3, $4, $5, $6) RETURNING id`,
    [projectId, name, trigger, actionType, actionValue, uid],
  );
  await notifyProject(projectId);
  await audit(uid, "automation.create", {
    entity: "automation",
    entityId: r.rows[0].id,
    projectId,
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
