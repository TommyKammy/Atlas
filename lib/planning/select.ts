import { calculateScenario, type CalculationInitiative, type PlanningScenarioResult } from "./calculations";
import type {
  PlanningCapacity,
  PlanningComparisonProjection,
  PlanningInitiative,
  PlanningRole,
  PlanningScenario,
  PlanningState,
} from "./types";

export function toCalculationInitiative(
  initiative: PlanningInitiative,
): CalculationInitiative {
  return {
    id: initiative.id,
    name: initiative.name,
    ownerName: initiative.ownerName,
    expectedEffect: initiative.expectedEffect,
    kind: initiative.kind,
    linkedProjectId: initiative.linkedProjectId,
    linkedProjectName: initiative.linkedProjectName,
    costYen: initiative.costYen,
    demands: initiative.demands.map((demand) => ({
      roleId: demand.roleId,
      monthIndex: demand.monthIndex,
      days: demand.days,
    })),
  };
}

/**
 * Build the single server-authored comparison projection from the same period
 * inputs and shared calculation functions used by the editable screens.
 */
export function buildPlanningComparison(input: {
  revision: number;
  budgetYen: number;
  initiatives: PlanningInitiative[];
  roles: PlanningRole[];
  capacities: PlanningCapacity[];
  scenarios: [PlanningScenario, PlanningScenario];
}): PlanningComparisonProjection {
  const initiatives = input.initiatives.map(toCalculationInitiative);
  const calculateSlot = (slot: 0 | 1): PlanningScenarioResult => {
    const scenario = input.scenarios.find((entry) => entry.slot === slot);
    if (!scenario) throw new Error(`planning scenario ${slot} is missing`);
    return calculateScenario({
      slot,
      name: scenario.name,
      initiatives,
      selectedCandidateIds: scenario.selectedInitiativeIds,
      roles: input.roles,
      capacities: input.capacities,
      budgetYen: input.budgetYen,
    });
  };
  return {
    revision: input.revision,
    budgetYen: input.budgetYen,
    fixed: calculateScenario({
      slot: 0,
      name: "固定案件",
      initiatives,
      selectedCandidateIds: [],
      roles: input.roles,
      capacities: input.capacities,
      budgetYen: input.budgetYen,
    }),
    scenarios: [calculateSlot(0), calculateSlot(1)],
  };
}

/** Reuse the server projection so every editable screen reads one calculation. */
export function scenarioCalculation(
  state: PlanningState,
  slot: 0 | 1,
): PlanningScenarioResult | null {
  return state.comparison?.scenarios[slot] ?? null;
}

export function fixedCalculation(state: PlanningState): PlanningScenarioResult | null {
  return state.comparison?.fixed ?? null;
}
