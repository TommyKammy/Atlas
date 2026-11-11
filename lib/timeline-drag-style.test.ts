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
    transform: "translate(24px, 40px)",
  });
  assert.deepEqual(timelineBarDragStyle({ ...base, mode: "move", axis: null }), {
    transform: "translate(24px, 40px)",
  });
});

test("timelineBarDragStyle keeps both offsets when the drop intent changes to a row", () => {
  assert.deepEqual(timelineBarDragStyle({ ...base, mode: "move", axis: "row" }), {
    transform: "translate(24px, 40px)",
  });
});

test("timelineBarDragStyle leaves a non-reorderable bar on its original Y axis", () => {
  assert.deepEqual(timelineBarDragStyle({ ...base, mode: "move", axis: "x", canReorder: false }), {
    transform: "translateX(24px)",
  });
});
