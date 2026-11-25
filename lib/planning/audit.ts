import { audit } from "../audit";
import type { Queryable } from "../db";
import type { PlanActor } from "./settings-policy";

export async function recordPlanAction(q: Queryable, actor: PlanActor, action: string, entity: string, entityId: number, detail = "") {
  await audit(actor.userId, "portfolio_plan." + action, {
    workspaceId: actor.workspaceId, entity, entityId,
    summary: ["ポートフォリオ #" + actor.portfolioId, detail].filter(Boolean).join(" / "),
  }, q);
}
