import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanningComparison, fixedCalculation, scenarioCalculation } from "./select";
import type { PlanningInitiative, PlanningState } from "./types";

const roles = [{ id: 1, name: "DB担当", position: 0 }];
const capacities = ([1, 2, 3] as const).map((monthIndex) => ({
  roleId: 1,
  monthIndex,
  days: 18,
}));

const fixed: PlanningInitiative = {
  id: 1,
  name: "基盤更改",
  ownerMemberId: 1,
  ownerName: "佐藤",
  expectedEffect: "基盤を移行",
  kind: "fixed",
  linkedProjectId: null,
  linkedProjectName: null,
  costYen: 6_000_000,
  demands: [
    { roleId: 1, monthIndex: 1, days: 12 },
    { roleId: 1, monthIndex: 2, days: 5 },
    { roleId: 1, monthIndex: 3, days: 3 },
  ],
};

const candidate: PlanningInitiative = {
  id: 2,
  name: "申請自動化",
  ownerMemberId: 2,
  ownerName: "田中",
  expectedEffect: "申請処理を短縮",
  kind: "candidate",
  linkedProjectId: null,
  linkedProjectName: null,
  costYen: 4_000_000,
  demands: [
    { roleId: 1, monthIndex: 1, days: 10 },
    { roleId: 1, monthIndex: 2, days: 4 },
    { roleId: 1, monthIndex: 3, days: 2 },
  ],
};

test("server projection returns fixed and both independent scenarios for one revision", () => {
  const projection = buildPlanningComparison({
    revision: 7,
    budgetYen: 10_000_000,
    initiatives: [fixed, candidate],
    roles,
    capacities,
    scenarios: [
      { id: 10, slot: 0, name: "A案", selectedInitiativeIds: [2] },
      { id: 11, slot: 1, name: "B案", selectedInitiativeIds: [] },
    ],
  });

  assert.equal(projection.revision, 7);
  assert.equal(projection.budgetYen, 10_000_000);
  assert.deepEqual(projection.fixed.included.map((item) => item.name), ["基盤更改"]);
  assert.deepEqual(projection.scenarios[0].included.map((item) => item.name), ["基盤更改", "申請自動化"]);
  assert.deepEqual(projection.scenarios[1].included.map((item) => item.name), ["基盤更改"]);
  assert.equal(projection.scenarios[0].knownCostYen, 10_000_000);
  assert.equal(projection.scenarios[0].cells[0].demandDays, 22);
  assert.equal(projection.scenarios[0].shortages[0].shortageDays, 4);
  assert.equal(projection.scenarios[1].knownCostYen, 6_000_000);
  assert.equal(projection.scenarios[1].hasMissing, false);
  assert.equal(projection.scenarios[0].status, "needs_attention");
});

test("client selectors return the server projection instead of recalculating", () => {
  const projection = buildPlanningComparison({
    revision: 3,
    budgetYen: 10_000_000,
    initiatives: [fixed, candidate],
    roles,
    capacities,
    scenarios: [
      { id: 10, slot: 0, name: "A案", selectedInitiativeIds: [2] },
      { id: 11, slot: 1, name: "B案", selectedInitiativeIds: [] },
    ],
  });
  const state = { comparison: projection } as PlanningState;
  assert.equal(scenarioCalculation(state, 0), projection.scenarios[0]);
  assert.equal(scenarioCalculation(state, 1), projection.scenarios[1]);
  assert.equal(fixedCalculation(state), projection.fixed);

  const emptyState = { comparison: null } as PlanningState;
  assert.equal(scenarioCalculation(emptyState, 0), null);
  assert.equal(fixedCalculation(emptyState), null);
});
