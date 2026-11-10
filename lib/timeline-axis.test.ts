import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDay } from "./calendar";
import { buildTimelineAxis, clampTimelineDay, timelineDateWindow, ZOOM_PRESETS } from "./timeline-axis";

test("timeline axes retain their keys and clipped boundaries across New Year", () => {
  const start = parseDay("2026-12-31");
  const end = parseDay("2027-01-02");
  const hour = buildTimelineAxis(start, end, "hour");
  assert.deepEqual(hour.axisTop.map(({ label }) => label), ["12/31", "1/1", "1/2"]);
  assert.equal(hour.axisBottom.length, 72);
  assert.equal(hour.axisBottom.at(-1)?.key, `${end}-23`);
  assert.equal(hour.gridLines.length, 69);

  const week = buildTimelineAxis(start, end, "week");
  assert.deepEqual(week.axisTop.map(({ key }) => key), ["2026-11", "2027-0"]);
  assert.deepEqual(week.axisBottom, [{
    key: `w-${start - 4}`,
    start,
    end,
    label: "W53 12月27日 - 2",
    daysWide: 3,
  }]);
  assert.deepEqual(week.weekendDays, [end]);

  const year = buildTimelineAxis(start, end, "year");
  assert.deepEqual(year.axisTop.map(({ key }) => key), ["2026", "2027"]);
  assert.deepEqual(year.axisBottom.map(({ key }) => key), ["2026-Q4", "2027-Q1"]);
  assert.deepEqual(year.gridLines, [start, start + 1]);
  assert.deepEqual(year.weekendDays, []);
});

test("distant task dates bound the active axis while preserving zoom and navigation anchors", () => {
  const oldest = parseDay("1900-01-01");
  const newest = parseDay("9999-12-31");
  const today = parseDay("2026-11-09");
  for (const zoom of ZOOM_PRESETS) {
    const { min, max, navigationDays } = timelineDateWindow(oldest, newest, null, today, today, zoom);
    assert.equal(max - min + 1, zoom.maxDays);
    assert.ok(min <= today && today <= max);
    assert.equal(navigationDays, zoom.maxDays);

    const next = timelineDateWindow(oldest, newest, max + 1, null, today, zoom);
    assert.equal(next.min, max + 1);
    const axis = buildTimelineAxis(min, max, zoom.key);
    assert.ok(axis.axisBottom.length <= 744);
  }

  const hour = ZOOM_PRESETS[0];
  const requested = parseDay("2032-02-10");
  const anchor = requested + 100;
  const range = timelineDateWindow(oldest, newest, requested, anchor, today, hour);
  assert.ok(range.min <= anchor && anchor <= range.max);
  assert.deepEqual(timelineDateWindow(oldest, newest, requested, null, today, hour), {
    min: requested,
    max: requested + 30,
    navigationDays: 31,
  });
  const finalDay = timelineDateWindow(oldest, newest + 10, newest, null, today, hour);
  assert.equal(finalDay.min, newest);
  assert.equal(finalDay.max, newest);
  assert.equal(clampTimelineDay(finalDay.max + finalDay.navigationDays), newest);
  assert.equal(clampTimelineDay(parseDay("0001-01-01") - 30), parseDay("0001-01-01"));
});
