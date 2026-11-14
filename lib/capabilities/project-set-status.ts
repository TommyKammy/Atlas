import { audit } from "../audit";
import { db } from "../db";
import { emitDomainEvent } from "../domain/events";
import { getProjectPolicyAccess } from "../project-policy-access";
import { isProjectStatusColor } from "../project-status";
import { createProjectStatusUpdate } from "../repositories/home";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { asNumber, assertEdit, asString } from "./shared";

export async function projectSetStatus(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const projectId = asNumber(params.project_id ?? ctx.projectId);
  if (!projectId) throw new Error("project.set_status requires a project");
  await assertEdit(ctx, projectId);
  if (!(await getProjectPolicyAccess(ctx.actorId, projectId, q)).canConfigure) throw new Error("project configuration is restricted");
  const status = asString(params.status);
  if (status === "") throw new Error("status is required");
  const color = isProjectStatusColor(params.status_color) ? params.status_color : "none";
  await createProjectStatusUpdate(
    projectId,
    ctx.actorId,
    "ルールによりプロジェクトステータスを更新しました",
    status.slice(0, 80),
    color,
    q,
  );
  await audit(ctx.actorId, "automation.project.status", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: status,
  }, q);
  ctx.notifyAfterCommit?.(projectId);
  const workspace = await q.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [
    projectId,
  ]);
  if (workspace.rows[0]?.workspace_id) {
    await emitDomainEvent({
      workspaceId: Number(workspace.rows[0].workspace_id),
      projectId,
      actorId: ctx.actorId,
      type: "project.status_changed",
      subjectType: "project",
      subjectId: projectId,
      data: { status, status_color: color },
      causationId: ctx.eventId ?? null,
      automationRuleId: ctx.ruleId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    }, q);
  }
  return { summary: `プロジェクトステータスを${status}に変更しました`, data: { status } };
}
