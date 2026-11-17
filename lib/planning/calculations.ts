import type {
  PlanningInitiativeKind,
  PlanningMissingItem,
  PlanningMonth,
  PlanningScenarioSnapshot,
  PlanningSnapshotCell,
  PlanningSnapshotShortage,
  PlanningDecisionSnapshot,
} from "./types";
import { periodLabel } from "./format";

export type CalculationRole = {
  id: number;
  name: string;
};

export type CalculationDemand = {
  roleId: number;
  monthIndex: PlanningMonth;
  days: number | null;
};

export type CalculationCapacity = {
  roleId: number;
  monthIndex: PlanningMonth;
  days: number | null;
};

export type CalculationInitiative = {
  id: number;
  name: string;
  ownerName: string;
  expectedEffect: string;
  kind: PlanningInitiativeKind;
  linkedProjectId: number | null;
  linkedProjectName: string | null;
  costYen: number | null;
  demands: CalculationDemand[];
};

export type PlanningScenarioResult = {
  slot: 0 | 1;
  name: string;
  included: CalculationInitiative[];
  skipped: CalculationInitiative[];
  knownCostYen: number;
  budgetRemainingYen: number;
  overBudget: boolean;
  costMissing: boolean;
  cells: PlanningSnapshotCell[];
  shortages: PlanningSnapshotShortage[];
  missing: PlanningMissingItem[];
  missingCostCount: number;
  missingDemandCount: number;
  missingCapacityCount: number;
  hasMissing: boolean;
  hasShortage: boolean;
  status: "within" | "needs_attention" | "unknown";
};

export type ScenarioCalculationInput = {
  slot: 0 | 1;
  name: string;
  initiatives: readonly CalculationInitiative[];
  selectedCandidateIds: readonly number[];
  roles: readonly CalculationRole[];
  capacities: readonly CalculationCapacity[];
  budgetYen: number;
};

export const MONTHS: readonly PlanningMonth[] = [1, 2, 3];

function toTenths(days: number): number {
  return Math.round(days * 10);
}

function fromTenths(tenths: number): number {
  return tenths / 10;
}

function demandKey(initiativeId: number, roleId: number, monthIndex: PlanningMonth): string {
  return `${initiativeId}:${roleId}:${monthIndex}`;
}

function capacityKey(roleId: number, monthIndex: PlanningMonth): string {
  return `${roleId}:${monthIndex}`;
}

/** Aggregate one scenario using integer tenths so 0.1-day values never drift. */
export function calculateScenario(input: ScenarioCalculationInput): PlanningScenarioResult {
  const selected = new Set(input.selectedCandidateIds);
  const included = input.initiatives.filter(
    (initiative) => initiative.kind === "fixed" || selected.has(initiative.id),
  );
  const includedIds = new Set(included.map((initiative) => initiative.id));
  const skipped = input.initiatives.filter((initiative) => !includedIds.has(initiative.id));

  const demandByKey = new Map<string, number>();
  for (const initiative of included) {
    for (const demand of initiative.demands) {
      if (demand.days === null) continue;
      demandByKey.set(
        demandKey(initiative.id, demand.roleId, demand.monthIndex),
        toTenths(demand.days),
      );
    }
  }
  const capacityByKey = new Map<string, number>();
  for (const capacity of input.capacities) {
    if (capacity.days === null) continue;
    capacityByKey.set(
      capacityKey(capacity.roleId, capacity.monthIndex),
      toTenths(capacity.days),
    );
  }

  const missing: PlanningMissingItem[] = [];
  let missingCostCount = 0;
  for (const initiative of included) {
    if (initiative.costYen === null) {
      missingCostCount += 1;
      missing.push({ kind: "cost", initiativeName: initiative.name });
    }
  }

  const cells: PlanningSnapshotCell[] = [];
  let missingCapacityCount = 0;
  let missingDemandCount = 0;

  for (const role of input.roles) {
    for (const monthIndex of MONTHS) {
      const capTenths = capacityByKey.get(capacityKey(role.id, monthIndex));
      let demandTenths = 0;
      let demandMissing = false;
      for (const initiative of included) {
        const value = demandByKey.get(demandKey(initiative.id, role.id, monthIndex));
        if (value === undefined) {
          demandMissing = true;
          missingDemandCount += 1;
          missing.push({
            kind: "demand",
            initiativeName: initiative.name,
            roleName: role.name,
            monthIndex,
          });
        } else {
          demandTenths += value;
        }
      }
      if (capTenths === undefined) {
        missingCapacityCount += 1;
        missing.push({ kind: "capacity", roleName: role.name, monthIndex });
      }
      const gapTenths = capTenths === undefined ? null : capTenths - demandTenths;
      cells.push({
        roleId: role.id,
        roleName: role.name,
        monthIndex,
        demandDays: fromTenths(demandTenths),
        demandMissing,
        capacityDays: capTenths === undefined ? null : fromTenths(capTenths),
        capacityMissing: capTenths === undefined,
        gapDays: gapTenths === null ? null : fromTenths(gapTenths),
        shortageDays: gapTenths !== null && gapTenths < 0 ? fromTenths(-gapTenths) : 0,
        demandComplete: !demandMissing,
      });
    }
  }

  const shortages: PlanningSnapshotShortage[] = cells
    .filter((cell) => cell.shortageDays > 0)
    .map((cell) => ({
      roleId: cell.roleId,
      roleName: cell.roleName,
      monthIndex: cell.monthIndex,
      shortageDays: cell.shortageDays,
      demandMissing: cell.demandMissing,
    }))
    .sort((a, b) => b.shortageDays - a.shortageDays || a.monthIndex - b.monthIndex);

  const knownCostYen = included.reduce(
    (sum, initiative) => sum + (initiative.costYen ?? 0),
    0,
  );
  const costMissing = missingCostCount > 0;
  const overBudget = knownCostYen > input.budgetYen;
  const hasMissing = missing.length > 0;
  const hasShortage = shortages.length > 0 || overBudget;
  const status = hasShortage ? "needs_attention" : hasMissing ? "unknown" : "within";

  return {
    slot: input.slot,
    name: input.name,
    included,
    skipped,
    knownCostYen,
    budgetRemainingYen: input.budgetYen - knownCostYen,
    overBudget,
    costMissing,
    cells,
    shortages,
    missing,
    missingCostCount,
    missingDemandCount,
    missingCapacityCount,
    hasMissing,
    hasShortage,
    status,
  };
}

export type SnapshotSource = {
  period: {
    id: number;
    year: number;
    quarter: 1 | 2 | 3 | 4;
    budgetYen: number;
    revision: number;
  };
  roles: readonly CalculationRole[];
  initiatives: readonly CalculationInitiative[];
  capacities: readonly CalculationCapacity[];
  scenarios: readonly {
    slot: 0 | 1;
    name: string;
    selectedCandidateIds: readonly number[];
  }[];
  chosenSlot: 0 | 1;
};

function snapshotInitiative(initiative: CalculationInitiative) {
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
      roleName:
        // Filled by the caller through the role lookup below.
        "",
      monthIndex: demand.monthIndex,
      days: demand.days,
    })),
  };
}

/**
 * Freeze both compared plans, their assumptions, totals, gaps and skipped
 * effects. Only called on the server with database-loaded values.
 */
export function buildDecisionSnapshot(source: SnapshotSource): PlanningDecisionSnapshot {
  const roleNames = new Map(source.roles.map((role) => [role.id, role.name]));
  const scenarios = source.scenarios
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((scenario) => {
      const result = calculateScenario({
        slot: scenario.slot,
        name: scenario.name,
        initiatives: source.initiatives,
        selectedCandidateIds: scenario.selectedCandidateIds,
        roles: source.roles,
        capacities: source.capacities,
        budgetYen: source.period.budgetYen,
      });
      const withRoleNames = (initiative: CalculationInitiative) => ({
        ...snapshotInitiative(initiative),
        demands: initiative.demands.map((demand) => ({
          roleId: demand.roleId,
          roleName: roleNames.get(demand.roleId) ?? "",
          monthIndex: demand.monthIndex,
          days: demand.days,
        })),
      });
      return {
        slot: scenario.slot,
        name: scenario.name,
        included: result.included.map(withRoleNames),
        skipped: result.skipped.map(withRoleNames),
        knownCostYen: result.knownCostYen,
        budgetRemainingYen: result.budgetRemainingYen,
        overBudget: result.overBudget,
        costMissing: result.costMissing,
        cells: result.cells,
        shortages: result.shortages,
        missing: result.missing,
        missingCostCount: result.missingCostCount,
        missingDemandCount: result.missingDemandCount,
        missingCapacityCount: result.missingCapacityCount,
        hasMissing: result.hasMissing,
        hasShortage: result.hasShortage,
        status: result.status,
      } satisfies PlanningScenarioSnapshot;
    });

  if (scenarios.length !== 2) {
    throw new Error("a decision snapshot requires exactly two scenarios");
  }

  return {
    version: 1,
    period: {
      id: source.period.id,
      year: source.period.year,
      quarter: source.period.quarter,
      label: periodLabel(source.period.year, source.period.quarter),
      budgetYen: source.period.budgetYen,
      revision: source.period.revision,
    },
    roles: source.roles.map((role) => ({ id: role.id, name: role.name })),
    scenarios: [scenarios[0] as PlanningScenarioSnapshot, scenarios[1] as PlanningScenarioSnapshot],
    chosenSlot: source.chosenSlot,
  };
}
