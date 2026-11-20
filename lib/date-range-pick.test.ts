import assert from "node:assert/strict";
import { test } from "node:test";
import { initialDateRangeField, pickDateRangeDay } from "./date-range-pick";

test("a calendar click fills the start field and moves the cursor to due", () => {
  assert.deepEqual(pickDateRangeDay("start", "", "", "2026-11-10"), {
    start: "2026-11-10",
    due: "",
    active: "due",
  });
});

test("a calendar click on the due field only fills the due field", () => {
  assert.deepEqual(pickDateRangeDay("due", "2026-11-10", "", "2026-11-12"), {
    start: "2026-11-10",
    due: "2026-11-12",
    active: "due",
  });
});

test("a start after the due moves the due to the same day", () => {
  assert.deepEqual(pickDateRangeDay("start", "2026-11-10", "2026-11-12", "2026-11-20"), {
    start: "2026-11-20",
    due: "2026-11-20",
    active: "due",
  });
});

test("a due before the start moves the start to the same day", () => {
  assert.deepEqual(pickDateRangeDay("due", "2026-11-10", "2026-11-12", "2026-11-05"), {
    start: "2026-11-05",
    due: "2026-11-05",
    active: "due",
  });
});

test("a start before the due keeps the due", () => {
  assert.deepEqual(pickDateRangeDay("start", "", "2026-11-12", "2026-11-10"), {
    start: "2026-11-10",
    due: "2026-11-12",
    active: "due",
  });
});

test("due-only tasks open on the due field while new and ranged tasks open on start", () => {
  assert.equal(initialDateRangeField("", "2026-11-12"), "due");
  assert.equal(initialDateRangeField("", ""), "start");
  assert.equal(initialDateRangeField("2026-11-10", ""), "start");
  assert.equal(initialDateRangeField("2026-11-10", "2026-11-12"), "start");
});
