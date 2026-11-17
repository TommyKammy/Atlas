import { createHash } from "node:crypto";
import type { PlanningDecisionSnapshot } from "./types";

/**
 * JSON with deterministically sorted object keys. The adoption hash is computed
 * with this and recomputed on read, so key order inside JSONB does not matter.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return "null";
}

export function hashPlanningSnapshot(snapshot: PlanningDecisionSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

export function isPlanningDecisionSnapshot(value: unknown): value is PlanningDecisionSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlanningDecisionSnapshot>;
  if (candidate.version !== 1) return false;
  if (!candidate.period || typeof candidate.period !== "object") return false;
  if (!Array.isArray(candidate.roles)) return false;
  if (!Array.isArray(candidate.scenarios) || candidate.scenarios.length !== 2) return false;
  if (candidate.chosenSlot !== 0 && candidate.chosenSlot !== 1) return false;
  return candidate.scenarios.every(
    (scenario) =>
      scenario &&
      typeof scenario === "object" &&
      (scenario.slot === 0 || scenario.slot === 1) &&
      Array.isArray(scenario.included) &&
      Array.isArray(scenario.skipped) &&
      Array.isArray(scenario.cells) &&
      Array.isArray(scenario.shortages) &&
      Array.isArray(scenario.missing),
  );
}

export function snapshotProjectIds(snapshot: PlanningDecisionSnapshot): number[] {
  const ids = new Set<number>();
  for (const scenario of snapshot.scenarios) {
    for (const initiative of [...scenario.included, ...scenario.skipped]) {
      if (initiative.linkedProjectId !== null) ids.add(initiative.linkedProjectId);
    }
  }
  return [...ids];
}
