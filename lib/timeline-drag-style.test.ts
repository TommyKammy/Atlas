import assert from "node:assert/strict";
import { test } from "node:test";
import { timelineBarDragStyle } from "./timeline-drag-style";

const base = { x1: "20%", x2: "60%", dx: 24, dy: 40, canReorder: true };

test("timelineBarDragStyle resizes the start edge without translating the bar", () => {
  const style = timelineBarDragStyle({ ...base, mode: "start", axis: "x" });
  assert.equal(style.transform, undefined);
  assert.equal(style.left, "calc(20% + 24px)");
  assert.equal(style.width, "max(2px, calc(60% - 20% - 24px))");
});

test("timelineBarDragStyle resizes the end edge without translating the bar", () => {
  const style = timelineBarDragStyle({ ...base, mode: "end", axis: "x" });
  assert.equal(style.transform, undefined);
  assert.equal(style.left, undefined);
  assert.equal(style.width, "max(2px, calc(60% - 20% + 24px))");
});

test("timelineBarDragStyle translates the bar only for move drags", () => {
  assert.deepEqual(timelineBarDragStyle({ ...base, mode: "move", axis: "x" }), {
    transform: "translateX(24px)",
  });
  assert.deepEqual(timelineBarDragStyle({ ...base, mode: "move", axis: null }), {
    transform: "translate(24px, 40px)",
  });
});

test("timelineBarDragStyle uses translateY for row drags", () => {
  assert.deepEqual(timelineBarDragStyle({ ...base, mode: "move", axis: "row" }), {
    transform: "translateY(40px)",
  });
});
