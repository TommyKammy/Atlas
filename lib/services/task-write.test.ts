import assert from "node:assert/strict";
import { test } from "node:test";
import type { Queryable } from "../db";
import { insertNextOccurrence, validateTaskPatch } from "./task-write";

const current = { start_on: "2026-11-01", due_on: "2026-11-30" };

test("validateTaskPatch accepts and normalizes valid fields", () => {
  const result = validateTaskPatch(
    {
      name: "  要件定義  ",
      description: null,
      completed: true,
      progress: "50",
      position: 1000,
      status: "  進行中  ",
      recurrence: "",
      is_milestone: true,
      start_on: "2026-11-02",
      due_on: "2026-11-20",
    },
    current,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.values, {
    name: "要件定義",
    description: "",
    completed: true,
    progress: 50,
    position: 1000,
    status: "進行中",
    recurrence: "none",
    is_milestone: true,
    start_on: "2026-11-02",
    due_on: "2026-11-20",
  });
});

test("validateTaskPatch rejects invalid progress values", () => {
  for (const progress of [-1, 101, 1.5, "abc", null]) {
    const result = validateTaskPatch({ progress }, current);
    assert.equal(result.ok, false, `progress=${String(progress)}`);
  }
});

test("validateTaskPatch rejects invalid dates and reversed ranges", () => {
  const invalidDate = validateTaskPatch({ due_on: "2026-02-31" }, current);
  assert.equal(invalidDate.ok, false);

  const reversed = validateTaskPatch({ start_on: "2026-12-01" }, current);
  assert.equal(reversed.ok, false);

  const reversedDue = validateTaskPatch({ due_on: "2026-10-01" }, current);
  assert.equal(reversedDue.ok, false);
});

test("validateTaskPatch clears dates with null or empty strings", () => {
  const result = validateTaskPatch({ start_on: "", due_on: null }, current);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.start_on, null);
  assert.equal(result.values.due_on, null);
});

test("validateTaskPatch rejects empty name/status and invalid enum values", () => {
  assert.equal(validateTaskPatch({ name: "   " }, current).ok, false);
  assert.equal(validateTaskPatch({ status: "" }, current).ok, false);
  assert.equal(validateTaskPatch({ recurrence: "yearly" }, current).ok, false);
  assert.equal(validateTaskPatch({ completed: "true" }, current).ok, false);
  assert.equal(validateTaskPatch({ description: 42 }, current).ok, false);
  assert.equal(validateTaskPatch({ position: -1 }, current).ok, false);
  assert.equal(validateTaskPatch({ is_milestone: "true" }, current).ok, false);
});

test("validateTaskPatch returns an empty payload when no fields are present", () => {
  const result = validateTaskPatch({ expected_updated_at: "2026-11-09T00:00:00Z" }, current);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.values, {});
});

test("insertNextOccurrence writes the next daily occurrence", async () => {
  let captured: unknown[] = [];
  const q = {
    query: async (_text: string, params?: unknown[]) => {
      captured = params ?? [];
      return { rows: [{ id: 99 }], rowCount: 1 };
    },
  } as unknown as Queryable;

  const id = await insertNextOccurrence(q, {
    project_id: 1,
    section_id: 2,
    name: "日次",
    description: "",
    assignee_id: null,
    start_on: "2026-01-31",
    due_on: "2026-01-31",
    status: "未着手",
    recurrence: "daily",
    is_milestone: true,
  });

  assert.equal(id, 99);
  assert.equal(captured[5], "2026-02-01");
  assert.equal(captured[6], "2026-02-01");
  assert.equal(captured[9], true);
});

test("insertNextOccurrence skips non-recurring tasks", async () => {
  let called = false;
  const q = {
    query: async () => {
      called = true;
      return { rows: [{ id: 1 }], rowCount: 1 };
    },
  } as unknown as Queryable;

  const id = await insertNextOccurrence(q, {
    project_id: 1,
    section_id: null,
    name: "単発",
    description: "",
    assignee_id: null,
    start_on: null,
    due_on: null,
    status: "未着手",
    recurrence: "none",
  });

  assert.equal(id, null);
  assert.equal(called, false);
});
