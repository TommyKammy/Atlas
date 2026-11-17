import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDecisionSnapshot,
  calculateScenario,
  type CalculationCapacity,
  type CalculationInitiative,
  type CalculationRole,
} from "./calculations";
import {
  hashPlanningSnapshot,
  isPlanningDecisionSnapshot,
  samePlanningPlanContent,
  snapshotProjectIds,
  stableStringify,
} from "./decision-snapshot";
import type { PlanningDecisionSnapshot } from "./types";

const roles: CalculationRole[] = [
  { id: 1, name: "DB担当" },
  { id: 2, name: "開発担当" },
];

const capacities: CalculationCapacity[] = roles.flatMap((role) =>
  ([1, 2, 3] as const).map((monthIndex) => ({
    roleId: role.id,
    monthIndex,
    days: role.id === 1 ? 18 : 50,
  })),
);

const fixed: CalculationInitiative = {
  id: 1,
  name: "基盤更改",
  ownerName: "佐藤",
  expectedEffect: "基盤を移行",
  kind: "fixed",
  linkedProjectId: 901,
  linkedProjectName: "基盤更改PJ",
  costYen: 6_000_000,
  demands: [
    { roleId: 1, monthIndex: 1, days: 12 },
    { roleId: 1, monthIndex: 2, days: 5 },
    { roleId: 1, monthIndex: 3, days: 3 },
    { roleId: 2, monthIndex: 1, days: 8 },
    { roleId: 2, monthIndex: 2, days: 8 },
    { roleId: 2, monthIndex: 3, days: 5 },
  ],
};

const candidate: CalculationInitiative = {
  id: 2,
  name: "申請自動化",
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
    { roleId: 2, monthIndex: 1, days: 8 },
    { roleId: 2, monthIndex: 2, days: 7 },
    { roleId: 2, monthIndex: 3, days: 5 },
  ],
};

const skipped: CalculationInitiative = {
  id: 3,
  name: "顧客分析",
  ownerName: "鈴木",
  expectedEffect: "集計を月20時間削減",
  kind: "candidate",
  linkedProjectId: 902,
  linkedProjectName: "顧客分析PJ",
  costYen: 3_000_000,
  demands: [
    { roleId: 1, monthIndex: 1, days: 6 },
    { roleId: 1, monthIndex: 2, days: 4 },
    { roleId: 1, monthIndex: 3, days: 2 },
    { roleId: 2, monthIndex: 1, days: 6 },
    { roleId: 2, monthIndex: 2, days: 6 },
    { roleId: 2, monthIndex: 3, days: 4 },
  ],
};

function source() {
  return {
    period: { id: 10, year: 2027, quarter: 1 as const, budgetYen: 10_000_000, revision: 7 },
    roles,
    initiatives: [fixed, candidate, skipped].map((initiative) => ({
      ...initiative,
      demands: initiative.demands.map((demand) => ({ ...demand })),
    })),
    capacities,
    scenarios: [
      { slot: 0 as const, name: "A案", selectedCandidateIds: [2] },
      { slot: 1 as const, name: "B案", selectedCandidateIds: [3] },
    ],
    chosenSlot: 1 as const,
  };
}

test("adopted snapshots freeze both plans, totals, gaps and skipped opportunity effects", () => {
  const snapshot = buildDecisionSnapshot(source());
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.chosenSlot, 1);
  assert.equal(snapshot.period.label, "2027年 1月–3月");
  assert.equal(snapshot.scenarios.length, 2);
  const [a, b] = snapshot.scenarios;
  assert.equal(a.knownCostYen, 10_000_000);
  assert.equal(b.knownCostYen, 9_000_000);
  assert.equal(a.included.find((item) => item.id === 1)?.ownerName, "佐藤");
  assert.equal(a.skipped[0].name, "顧客分析");
  assert.equal(a.skipped[0].expectedEffect, "集計を月20時間削減");
  const jan = a.cells.find((cell) => cell.roleId === 1 && cell.monthIndex === 1);
  assert.ok(jan);
  assert.equal(jan.demandDays, 22);
  assert.equal(jan.shortageDays, 4);
  assert.equal(snapshotProjectIds(snapshot).sort().join(","), "901,902");
});

test("snapshot payload is detached from the mutable source", () => {
  const input = source();
  const snapshot = buildDecisionSnapshot(input);
  input.initiatives[0].name = "変更後";
  input.initiatives[0].costYen = 1;
  assert.equal(snapshot.scenarios[0].included.find((item) => item.id === 1)?.name, "基盤更改");
  assert.equal(snapshot.scenarios[0].included.find((item) => item.id === 1)?.costYen, 6_000_000);
});

test("snapshot hash ignores object key ordering and detects tampering", () => {
  const snapshot = buildDecisionSnapshot(source());
  const reordered = {
    ...snapshot,
    period: {
      revision: snapshot.period.revision,
      budgetYen: snapshot.period.budgetYen,
      label: snapshot.period.label,
      quarter: snapshot.period.quarter,
      year: snapshot.period.year,
      id: snapshot.period.id,
    },
  } as PlanningDecisionSnapshot;
  const hash = hashPlanningSnapshot(snapshot);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashPlanningSnapshot(reordered), hash);
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');

  const tampered = {
    ...snapshot,
    period: { ...snapshot.period, budgetYen: 1 },
  };
  assert.notEqual(hashPlanningSnapshot(tampered), hash);
  assert.equal(isPlanningDecisionSnapshot(snapshot), true);
  assert.equal(isPlanningDecisionSnapshot({ version: 1 }), false);
});

test("stale approval compares plan content rather than unrelated revision bumps", () => {
  const submitted = buildDecisionSnapshot(source());

  const unrelatedRevision = source();
  unrelatedRevision.period.revision = 8;
  assert.equal(
    samePlanningPlanContent(submitted, buildDecisionSnapshot(unrelatedRevision)),
    true,
  );

  const changedBudget = source();
  changedBudget.period.budgetYen = 9_000_000;
  assert.equal(
    samePlanningPlanContent(submitted, buildDecisionSnapshot(changedBudget)),
    false,
  );

  const changedCapacity = source();
  changedCapacity.capacities = capacities.map((capacity) =>
    capacity.roleId === 1 && capacity.monthIndex === 1
      ? { ...capacity, days: 12 }
      : capacity,
  );
  assert.equal(
    samePlanningPlanContent(submitted, buildDecisionSnapshot(changedCapacity)),
    false,
  );

  const changedSelection = source();
  changedSelection.scenarios = [
    { slot: 0 as const, name: "A案", selectedCandidateIds: [2, 3] },
    { slot: 1 as const, name: "B案", selectedCandidateIds: [3] },
  ];
  assert.equal(
    samePlanningPlanContent(submitted, buildDecisionSnapshot(changedSelection)),
    false,
  );
});

test("scenario calculation can be reused independently for comparison tests", () => {
  const result = calculateScenario({
    slot: 1,
    name: "B案",
    initiatives: [fixed, candidate, skipped],
    selectedCandidateIds: [3],
    roles,
    capacities,
    budgetYen: 10_000_000,
  });
  assert.equal(result.status, "within");
  assert.equal(result.knownCostYen, 9_000_000);
});
