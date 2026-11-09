import assert from "node:assert/strict";
import { test } from "node:test";
import { isSingleDayTimelineTask } from "./timeline-marker";

const base = { start_on: null, due_on: null, is_milestone: false };

test("isSingleDayTimelineTask treats same-day tasks as single day", () => {
  assert.equal(
    isSingleDayTimelineTask({ ...base, start_on: "2026-11-18", due_on: "2026-11-18" }),
    true,
  );
});

test("isSingleDayTimelineTask treats due-only and start-only tasks as single day", () => {
  assert.equal(isSingleDayTimelineTask({ ...base, due_on: "2026-11-29" }), true);
  assert.equal(isSingleDayTimelineTask({ ...base, start_on: "2026-11-29" }), true);
});

test("isSingleDayTimelineTask keeps multi-day tasks and milestones distinct", () => {
  assert.equal(
    isSingleDayTimelineTask({ ...base, start_on: "2026-11-10", due_on: "2026-11-15" }),
    false,
  );
  assert.equal(isSingleDayTimelineTask({ ...base, is_milestone: true }), true);
  assert.equal(isSingleDayTimelineTask({ ...base }), false);
});
