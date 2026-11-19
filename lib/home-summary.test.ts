import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatBudgetYen,
  formatRelativeTime,
  homeDueDateLabel,
  homeDueGroupKey,
  homeDueGroups,
  homeDueSummary,
  homeDueSummaryText,
  homeProjectProgressPercent,
  homeProjectProgressText,
  formatProposalSubmittedDate,
} from "./home-summary";

const today = "2026-11-17";

function task(overrides: { id?: number; completed?: boolean; due_on?: string | null }) {
  return {
    id: overrides.id ?? 1,
    completed: overrides.completed ?? false,
    due_on: overrides.due_on === undefined ? today : overrides.due_on,
  };
}

test("homeDueGroupKey uses yesterday for overdue, today, and tomorrow through +6 for this week", () => {
  assert.equal(homeDueGroupKey(task({ due_on: "2026-11-16" }), today), "overdue");
  assert.equal(homeDueGroupKey(task({ due_on: today }), today), "today");
  assert.equal(homeDueGroupKey(task({ due_on: "2026-11-18" }), today), "week");
  assert.equal(homeDueGroupKey(task({ due_on: "2026-11-23" }), today), "week");
  assert.equal(homeDueGroupKey(task({ due_on: "2026-11-24" }), today), null);
});

test("homeDueGroupKey leaves out completed and undated tasks", () => {
  assert.equal(homeDueGroupKey(task({ completed: true, due_on: "2026-11-10" }), today), null);
  assert.equal(homeDueGroupKey(task({ due_on: null }), today), null);
});

test("homeDueGroups keeps order and drops an empty group heading", () => {
  const tasks = [
    task({ id: 1, due_on: "2026-11-20" }),
    task({ id: 2, due_on: "2026-11-10" }),
    task({ id: 3, due_on: today }),
    task({ id: 4, completed: true, due_on: "2026-11-10" }),
    task({ id: 5, due_on: "2026-11-24" }),
  ];
  const groups = homeDueGroups(tasks, today);
  assert.deepEqual(
    groups.map((group) => [group.key, group.label, group.tasks.map((entry) => entry.id)]),
    [
      ["overdue", "期限超過", [2]],
      ["today", "今日", [3]],
      ["week", "今週", [1]],
    ],
  );
});

test("homeDueSummary counts the headline N and omits zero parts from the caption", () => {
  const tasks = [
    task({ due_on: "2026-11-10" }),
    task({ due_on: today }),
    task({ due_on: "2026-11-18" }),
    task({ due_on: "2026-11-19" }),
    task({ due_on: "2026-11-24" }),
    task({ completed: true, due_on: "2026-11-18" }),
    task({ due_on: null }),
  ];
  const summary = homeDueSummary(tasks, today);
  assert.deepEqual(summary, { overdue: 1, today: 1, week: 2, total: 4 });
  assert.equal(homeDueSummaryText(summary), "期限超過 1件 ・ 今日が期日 1件 ・ 今週 2件");

  assert.equal(
    homeDueSummaryText(homeDueSummary([task({ due_on: today })], today)),
    "今日が期日 1件",
  );
  assert.equal(homeDueSummaryText(homeDueSummary([], today)), "");
});

test("project progress rounds to a whole percent and says タスクなし at zero", () => {
  assert.equal(homeProjectProgressPercent(0, 0), null);
  assert.equal(homeProjectProgressPercent(8, 3), 38);
  assert.equal(homeProjectProgressPercent(3, 3), 100);
  assert.equal(homeProjectProgressText(0, 0, 0), "タスクなし");
  assert.equal(homeProjectProgressText(8, 3, 1), "38% ・ 超過 1件");
  assert.equal(homeProjectProgressText(8, 3, 0), "38%");
});

test("budget uses 万円 with up to two decimals", () => {
  assert.equal(formatBudgetYen(8_500_000), "850万円");
  assert.equal(formatBudgetYen(0), "0万円");
  assert.equal(formatBudgetYen(8_505_000), "850.5万円");
});

test("due labels use 今日 for today and month/day otherwise", () => {
  assert.equal(homeDueDateLabel(today, today), "今日");
  assert.equal(homeDueDateLabel("2026-11-07", today), "11月7日");
  assert.equal(homeDueDateLabel(null, today), "–");
});

test("applicant dates use the JST month and day", () => {
  assert.equal(formatProposalSubmittedDate("2026-11-16T03:00:00Z"), "11月16日");
  assert.equal(formatProposalSubmittedDate("not-a-date"), "not-a-date");
});

test("relative notification time crosses minute, hour, day and year boundaries", () => {
  const now = "2026-11-17T10:00:00+09:00";
  assert.equal(formatRelativeTime("2026-11-17T09:59:30+09:00", now), "たった今");
  assert.equal(formatRelativeTime("2026-11-17T09:59:00+09:00", now), "1分前");
  assert.equal(formatRelativeTime("2026-11-17T09:00:00+09:00", now), "1時間前");
  assert.equal(formatRelativeTime("2026-11-16T10:00:00+09:00", now), "1日前");
  assert.equal(formatRelativeTime("2026-11-10T10:00:00+09:00", now), "7日前");
  assert.equal(formatRelativeTime("2024-11-17T10:00:00+09:00", now), "2年前");
  assert.equal(formatRelativeTime("not-a-date", now), "");
});
