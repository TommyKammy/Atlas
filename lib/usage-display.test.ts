import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldLabelUsagePoint, usageDayLabel, usageValueLabel } from "./usage-display";

test("short usage series label every point", () => {
  for (let index = 0; index < 7; index++) {
    assert.equal(shouldLabelUsagePoint(index, 7), true);
    assert.equal(usageDayLabel("2026-11-17", index, 7), "11-17");
    assert.equal(usageValueLabel(3, index, 7), "3");
  }
});

test("14-day usage series labels every third point and omits zero values", () => {
  assert.deepEqual(
    Array.from({ length: 14 }, (_, index) => shouldLabelUsagePoint(index, 14)),
    [true, false, false, true, false, false, true, false, false, true, false, false, true, false],
  );
  assert.equal(usageDayLabel("2026-11-07", 0, 14), "11-07");
  assert.equal(usageDayLabel("2026-11-08", 1, 14), "");
  assert.equal(usageValueLabel(0, 0, 14), "");
  assert.equal(usageValueLabel(5, 1, 14), "");
  assert.equal(usageValueLabel(5, 3, 14), "5");
});
