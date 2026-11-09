import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOrNull } from "./task-dates";
import { assignTimelineLanes, timelineInterval } from "./timeline-lanes";

test("timelineInterval treats milestones as their due date", () => {
  assert.deepEqual(
    timelineInterval({
      id: 1,
      start_on: "2026-11-10",
      due_on: "2026-11-20",
      is_milestone: true,
    }),
    { start: dayOrNull("2026-11-20"), end: dayOrNull("2026-11-20") },
  );
});

test("timelineInterval treats due-only and start-only tasks as single days", () => {
  const due = dayOrNull("2026-11-29");
  const start = dayOrNull("2026-11-29");
  assert.deepEqual(timelineInterval({ id: 1, start_on: null, due_on: "2026-11-29", is_milestone: false }), { start: due, end: due });
  assert.deepEqual(timelineInterval({ id: 2, start_on: "2026-11-29", due_on: null, is_milestone: false }), { start, end: start });
});

test("timelineInterval returns null without dates", () => {
  assert.equal(timelineInterval({ id: 1, start_on: null, due_on: null, is_milestone: false }), null);
});

test("assignTimelineLanes packs non-overlapping tasks into the same lane", () => {
  const result = assignTimelineLanes([
    { id: 1, start: 10, end: 15 },
    { id: 2, start: 18, end: 22 },
  ]);
  assert.equal(result.laneById.get(1), 0);
  assert.equal(result.laneById.get(2), 0);
  assert.equal(result.laneCount, 1);
});

test("assignTimelineLanes separates overlapping and touching tasks", () => {
  const overlap = assignTimelineLanes([
    { id: 1, start: 10, end: 15 },
    { id: 2, start: 12, end: 20 },
  ]);
  assert.equal(overlap.laneById.get(1), 0);
  assert.equal(overlap.laneById.get(2), 1);
  assert.equal(overlap.laneCount, 2);

  const touching = assignTimelineLanes([
    { id: 1, start: 10, end: 15 },
    { id: 2, start: 15, end: 20 },
  ]);
  assert.equal(touching.laneById.get(1), 0);
  assert.equal(touching.laneById.get(2), 1);
});

test("assignTimelineLanes packs milestones on different days", () => {
  const result = assignTimelineLanes([
    { id: 1, start: 10, end: 10 },
    { id: 2, start: 10, end: 10 },
    { id: 3, start: 11, end: 11 },
  ]);
  assert.equal(result.laneById.get(1), 0);
  assert.equal(result.laneById.get(2), 1);
  assert.equal(result.laneById.get(3), 0);
  assert.equal(result.laneCount, 2);
});

test("assignTimelineLanes handles empty input", () => {
  const result = assignTimelineLanes([]);
  assert.equal(result.laneCount, 0);
  assert.equal(result.laneById.size, 0);
});
