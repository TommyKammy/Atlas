import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatManYen,
  monthLabel,
  parseDaysInput,
  parseManYenInput,
  parsePeriodKey,
  periodLabel,
  periodKey,
  quarterMonths,
  yenToManYenInput,
} from "./format";

test("万円 inputs become exact integer yen and blank stays null", () => {
  assert.deepEqual(parseManYenInput("600"), { ok: true, value: 6_000_000 });
  assert.deepEqual(parseManYenInput("1000.01"), { ok: true, value: 10_000_100 });
  assert.deepEqual(parseManYenInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseManYenInput(" "), { ok: true, value: null });
  assert.deepEqual(parseManYenInput("1,000"), { ok: true, value: 10_000_000 });
  assert.equal(parseManYenInput("-1").ok, false);
  assert.equal(parseManYenInput("1.234").ok, false);
  assert.equal(formatManYen(6_000_000), "600");
  assert.equal(formatManYen(10_000_100), "1,000.01");
  assert.equal(yenToManYenInput(10_000_100), "1000.01");
});

test("人日 accepts only one decimal and keeps null distinct from zero", () => {
  assert.deepEqual(parseDaysInput("0.1"), { ok: true, value: 0.1 });
  assert.deepEqual(parseDaysInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseDaysInput(""), { ok: true, value: null });
  assert.equal(parseDaysInput("0.25").ok, false);
  assert.equal(parseDaysInput("-1").ok, false);
});

test("calendar quarters, labels and period keys are stable", () => {
  assert.deepEqual(quarterMonths(1), [1, 2, 3]);
  assert.deepEqual(quarterMonths(4), [10, 11, 12]);
  assert.equal(periodLabel(2027, 1), "2027年 1月–3月");
  assert.equal(monthLabel(4, 3), "12月");
  assert.equal(periodKey(2027, 1), "2027-Q1");
  assert.deepEqual(parsePeriodKey("2027-Q1"), { year: 2027, quarter: 1 });
  assert.equal(parsePeriodKey("2027-Q5"), null);
  assert.equal(parsePeriodKey("invalid"), null);
});
