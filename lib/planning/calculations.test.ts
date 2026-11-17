import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateScenario,
  type CalculationCapacity,
  type CalculationDemand,
  type CalculationInitiative,
  type CalculationRole,
} from "./calculations";

const roles: CalculationRole[] = [
  { id: 1, name: "DB担当" },
  { id: 2, name: "開発担当" },
  { id: 3, name: "QA担当" },
];

function demands(
  rows: [number, number, number][],
): CalculationDemand[] {
  return roles.flatMap((role, roleIndex) =>
    ([1, 2, 3] as const).map((monthIndex) => ({
      roleId: role.id,
      monthIndex,
      days: rows[roleIndex][monthIndex - 1],
    })),
  );
}

function capacities(db: [number, number, number]): CalculationCapacity[] {
  return roles.flatMap((role) =>
    ([1, 2, 3] as const).map((monthIndex) => ({
      roleId: role.id,
      monthIndex,
      days: role.id === 1 ? db[monthIndex - 1] : 100,
    })),
  );
}

const initiatives: CalculationInitiative[] = [
  {
    id: 1,
    name: "基盤更改",
    ownerName: "佐藤",
    expectedEffect: "保守期限までに基盤を移行",
    kind: "fixed",
    linkedProjectId: null,
    linkedProjectName: null,
    costYen: 6_000_000,
    demands: demands([
      [12, 5, 3],
      [8, 8, 5],
      [2, 3, 4],
    ]),
  },
  {
    id: 2,
    name: "申請自動化",
    ownerName: "田中",
    expectedEffect: "申請処理を平均5日から2日に短縮",
    kind: "candidate",
    linkedProjectId: null,
    linkedProjectName: null,
    costYen: 4_000_000,
    demands: demands([
      [10, 4, 2],
      [8, 7, 5],
      [2, 3, 4],
    ]),
  },
  {
    id: 3,
    name: "顧客分析",
    ownerName: "鈴木",
    expectedEffect: "顧客レポートの集計を月20時間削減",
    kind: "candidate",
    linkedProjectId: null,
    linkedProjectName: null,
    costYen: 3_000_000,
    demands: demands([
      [6, 4, 2],
      [6, 6, 4],
      [2, 2, 3],
    ]),
  },
];

function scenario(selected: number[], dbCapacity: [number, number, number] = [18, 18, 18]) {
  return calculateScenario({
    slot: 0,
    name: "A案",
    initiatives,
    selectedCandidateIds: selected,
    roles,
    capacities: capacities(dbCapacity),
    budgetYen: 10_000_000,
  });
}

test("acceptance example: A is 1,000万円 with a 4-person-day January DB shortfall", () => {
  const result = scenario([2]);
  assert.equal(result.knownCostYen, 10_000_000);
  assert.equal(result.budgetRemainingYen, 0);
  assert.equal(result.overBudget, false);
  assert.deepEqual(result.included.map((item) => item.name), ["基盤更改", "申請自動化"]);
  assert.deepEqual(result.skipped.map((item) => item.name), ["顧客分析"]);
  const cell = result.cells.find((entry) => entry.roleId === 1 && entry.monthIndex === 1);
  assert.ok(cell);
  assert.equal(cell.demandDays, 22);
  assert.equal(cell.capacityDays, 18);
  assert.equal(cell.gapDays, -4);
  assert.equal(cell.shortageDays, 4);
  assert.equal(result.status, "needs_attention");
  assert.equal(result.hasMissing, false);
});

test("acceptance example: B is 900万円, 100万円 remaining and January DB is exactly at capacity", () => {
  const result = scenario([3]);
  assert.equal(result.knownCostYen, 9_000_000);
  assert.equal(result.budgetRemainingYen, 1_000_000);
  assert.equal(result.included.map((item) => item.name).join(","), "基盤更改,顧客分析");
  const cell = result.cells.find((entry) => entry.roleId === 1 && entry.monthIndex === 1);
  assert.ok(cell);
  assert.equal(cell.demandDays, 18);
  assert.equal(cell.gapDays, 0);
  assert.equal(cell.shortageDays, 0);
  assert.equal(result.status, "within");
});

test("acceptance example: adding both candidates to B overruns budget and January DB without changing A", () => {
  const beforeA = scenario([2]);
  const beforeB = scenario([3]);
  const changedB = scenario([2, 3]);
  assert.equal(changedB.knownCostYen, 13_000_000);
  assert.equal(changedB.overBudget, true);
  assert.equal(changedB.budgetRemainingYen, -3_000_000);
  const jan = changedB.cells.find((entry) => entry.roleId === 1 && entry.monthIndex === 1);
  assert.ok(jan);
  assert.equal(jan.demandDays, 28);
  assert.equal(jan.shortageDays, 10);
  assert.equal(changedB.status, "needs_attention");

  assert.deepEqual(scenario([2]), beforeA);
  assert.deepEqual(scenario([3]), beforeB);
});

test("increasing February capacity never resolves a January shortfall", () => {
  const before = scenario([2], [18, 18, 18]);
  const after = scenario([2], [18, 100, 18]);
  const janBefore = before.cells.find((entry) => entry.roleId === 1 && entry.monthIndex === 1);
  const janAfter = after.cells.find((entry) => entry.roleId === 1 && entry.monthIndex === 1);
  assert.ok(janBefore && janAfter);
  assert.equal(janBefore.shortageDays, 4);
  assert.equal(janAfter.shortageDays, 4);
  assert.equal(after.cells.find((entry) => entry.roleId === 1 && entry.monthIndex === 2)?.shortageDays, 0);
});

test("null is not zero: unset cost/capacity produce 未判定 while explicit zeros are constraint-checked", () => {
  const role: CalculationRole[] = [{ id: 1, name: "DB担当" }];
  const zero: CalculationInitiative = {
    id: 1,
    name: "ゼロ案件",
    ownerName: "担当",
    expectedEffect: "効果",
    kind: "fixed",
    linkedProjectId: null,
    linkedProjectName: null,
    costYen: 0,
    demands: [
      { roleId: 1, monthIndex: 1, days: 0 },
      { roleId: 1, monthIndex: 2, days: 0 },
      { roleId: 1, monthIndex: 3, days: 0 },
    ],
  };
  const zeroResult = calculateScenario({
    slot: 0,
    name: "A案",
    initiatives: [zero],
    selectedCandidateIds: [],
    roles: role,
    capacities: [
      { roleId: 1, monthIndex: 1, days: 0 },
      { roleId: 1, monthIndex: 2, days: 0 },
      { roleId: 1, monthIndex: 3, days: 0 },
    ],
    budgetYen: 0,
  });
  assert.equal(zeroResult.knownCostYen, 0);
  assert.equal(zeroResult.hasMissing, false);
  assert.equal(zeroResult.status, "within");

  const unset = calculateScenario({
    slot: 0,
    name: "A案",
    initiatives: [{ ...zero, costYen: null, demands: [] }],
    selectedCandidateIds: [],
    roles: role,
    capacities: [],
    budgetYen: 0,
  });
  assert.equal(unset.costMissing, true);
  assert.equal(unset.missingCapacityCount, 3);
  assert.equal(unset.missingDemandCount, 3);
  assert.equal(unset.status, "unknown");
  assert.equal(unset.hasMissing, true);
});

test("known gaps remain visible alongside missing values", () => {
  const role: CalculationRole[] = [{ id: 1, name: "DB担当" }];
  const initiative: CalculationInitiative = {
    id: 1,
    name: "一部未設定",
    ownerName: "担当",
    expectedEffect: "効果",
    kind: "fixed",
    linkedProjectId: null,
    linkedProjectName: null,
    costYen: 1_000_000,
    demands: [{ roleId: 1, monthIndex: 1, days: 8 }],
  };
  const result = calculateScenario({
    slot: 0,
    name: "A案",
    initiatives: [initiative],
    selectedCandidateIds: [],
    roles: role,
    capacities: [{ roleId: 1, monthIndex: 1, days: 5 }],
    budgetYen: 10_000_000,
  });
  const jan = result.cells[0];
  assert.equal(jan.demandDays, 8);
  assert.equal(jan.capacityDays, 5);
  assert.equal(jan.shortageDays, 3);
  assert.equal(jan.demandMissing, false);
  assert.equal(result.cells[1].demandMissing, true);
  assert.equal(result.status, "needs_attention");
  assert.equal(result.hasMissing, true);
  assert.ok(result.missing.some((item) => item.kind === "demand"));
  assert.ok(result.missing.some((item) => item.kind === "capacity"));
});

test("a known cost overrun is shown even when other costs are missing", () => {
  const role: CalculationRole[] = [{ id: 1, name: "DB担当" }];
  const fixed: CalculationInitiative = {
    id: 1,
    name: "固定",
    ownerName: "担当",
    expectedEffect: "効果",
    kind: "fixed",
    linkedProjectId: null,
    linkedProjectName: null,
    costYen: 11_000_000,
    demands: [{ roleId: 1, monthIndex: 1, days: 0 }],
  };
  const candidate: CalculationInitiative = {
    ...fixed,
    id: 2,
    name: "未見積もり候補",
    kind: "candidate",
    costYen: null,
  };
  const result = calculateScenario({
    slot: 1,
    name: "B案",
    initiatives: [fixed, candidate],
    selectedCandidateIds: [2],
    roles: role,
    capacities: [
      { roleId: 1, monthIndex: 1, days: 0 },
      { roleId: 1, monthIndex: 2, days: 0 },
      { roleId: 1, monthIndex: 3, days: 0 },
    ],
    budgetYen: 10_000_000,
  });
  assert.equal(result.overBudget, true);
  assert.equal(result.costMissing, true);
  assert.equal(result.status, "needs_attention");
  assert.equal(result.missingCostCount, 1);
});
