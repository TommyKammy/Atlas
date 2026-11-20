import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sectionInsertionIndex,
  sectionPositionBetween,
  sectionRenumber,
  type SectionRankRow,
} from "./section-order";

const rows: SectionRankRow[] = [
  { id: 11, position: 1000 },
  { id: 12, position: 2000 },
  { id: 13, position: 3000 },
];

test("section anchors resolve to the slot before or after the target", () => {
  assert.equal(sectionInsertionIndex(rows, null), 3);
  assert.equal(sectionInsertionIndex(rows, { before: 11 }), 0);
  assert.equal(sectionInsertionIndex(rows, { after: 11 }), 1);
  assert.equal(sectionInsertionIndex(rows, { before: 13 }), 2);
  assert.equal(sectionInsertionIndex(rows, { after: 13 }), 3);
  assert.equal(sectionInsertionIndex(rows, { after: 999 }), 3);
});

test("section ranks leave room on the 1000-step grid", () => {
  assert.equal(sectionPositionBetween(null, null), 1000);
  assert.equal(sectionPositionBetween(1000, 2000), 1500);
  assert.equal(sectionPositionBetween(1500, 1600), 1550);
  assert.equal(sectionPositionBetween(3000, null), 4000);
  assert.equal(sectionPositionBetween(null, 1000), 0);
});

test("an exhausted integer gap returns null so the caller renumbers", () => {
  assert.equal(sectionPositionBetween(1500, 1501), null);
  assert.equal(sectionPositionBetween(1000, 1001), null);
  assert.equal(sectionPositionBetween(Number.MAX_VALUE, null), null);
});

test("renumbering keeps the current order and restores 1000 spacing", () => {
  assert.deepEqual(sectionRenumber(rows), [
    { id: 11, position: 1000 },
    { id: 12, position: 2000 },
    { id: 13, position: 3000 },
  ]);
  assert.deepEqual(
    sectionRenumber([
      { id: 21, position: 1000 },
      { id: 22, position: 1001 },
    ]),
    [
      { id: 21, position: 1000 },
      { id: 22, position: 2000 },
    ],
  );
});
