import { withTransaction } from "../db";
import { notifyProject } from "../notify";
import { CAPABILITY_HANDLERS } from "./handlers";
import type { CapabilityContext, CapabilityResult } from "./shared";
export type { CapabilityContext,CapabilityResult,CapabilitySource } from "./shared";

/**
 * Public capability gateway. Automation and the future AI assistant call
 * these commands instead of writing to domain tables directly.
 */
export async function executeCapability(
  capability: string,
  params: Record<string, unknown>,
  ctx: CapabilityContext,
): Promise<CapabilityResult> {
  if (!ctx.q && capability !== "webhook.post") {
    const projectIds = new Set<number>();
    const result = await withTransaction((q) => executeCapability(capability, params, {
      ...ctx,
      q,
      notifyAfterCommit: (id) => projectIds.add(id),
    }));
    await Promise.all([...projectIds].map((id) => notifyProject(id)));
    return result;
  }
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_HANDLERS, capability)) throw new Error(`unknown capability: ${capability}`);
  return CAPABILITY_HANDLERS[capability as keyof typeof CAPABILITY_HANDLERS](params, ctx);
}
