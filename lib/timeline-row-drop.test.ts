import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTimelineTaskDrop, resolveTimelineRowDrop, type TimelineRowDropGroup } from "./timeline-row-drop";

const groups: readonly TimelineRowDropGroup[] = [
  { sectionId: 101, top: 49, height: 120, laneCount: 3, collapsed: false },
  { sectionId: 102, top: 169, height: 80, laneCount: 2, collapsed: false },
  { sectionId: 103, top: 249, height: 40, laneCount: 1, collapsed: true },
  { sectionId: null, top: 289, height: 40, laneCount: 1, collapsed: false },
];

test("row drop selects the destination section instead of clamping to the source", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 189, 520), {
    sectionId: 102, row: 0, top: 169,
  });
});

test("row drop includes the first lane immediately below the timeline axis", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 49, 520), {
    sectionId: 101, row: 0, top: 49,
  });
});

test("row drop floors fractional pointer positions and selects exact lane boundaries", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 88.999, 520), {
    sectionId: 101, row: 0, top: 49,
  });
  assert.deepEqual(resolveTimelineRowDrop(groups, 89, 520), {
    sectionId: 101, row: 1, top: 89,
  });
});

test("the entire final row belongs to its visible section, including its bottom four pixels", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 164.999, 520), {
    sectionId: 101, row: 2, top: 129,
  });
  assert.deepEqual(resolveTimelineRowDrop(groups, 165, 520), {
    sectionId: 101, row: 2, top: 129,
  });
  assert.deepEqual(resolveTimelineRowDrop(groups, 168.999, 520), {
    sectionId: 101, row: 2, top: 129,
  });
});

test("an exact section boundary belongs to the following section", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 169, 520), {
    sectionId: 102, row: 0, top: 169,
  });
});

test("a collapsed destination always uses its first row", () => {
  for (const y of [249, 268.5, 285, 288.999]) {
    assert.deepEqual(resolveTimelineRowDrop(groups, y, 520), {
      sectionId: 103, row: 0, top: 249,
    });
  }
});

test("a sectionless destination preserves null instead of leaking a DOM sentinel", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 309, 520), {
    sectionId: null, row: 0, top: 289,
  });
});

test("blank canvas space below all groups appends to the final section", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 390, 520), {
    sectionId: null, row: 1, top: 329,
  });
});

test("the canvas bottom is valid but points outside it are rejected", () => {
  assert.deepEqual(resolveTimelineRowDrop(groups, 520, 520), {
    sectionId: null, row: 1, top: 329,
  });
  assert.equal(resolveTimelineRowDrop(groups, 520.001, 520), null);
});

test("points on the date axis and non-finite geometry do not select a target", () => {
  for (const y of [-1, 0, 48.999, NaN, Infinity, -Infinity]) {
    assert.equal(resolveTimelineRowDrop(groups, y, 520), null);
  }
  for (const height of [0, 48, NaN, Infinity, -Infinity]) {
    assert.equal(resolveTimelineRowDrop(groups, 49, height), null);
  }
});

test("a timeline with no groups has no drop target", () => {
  assert.equal(resolveTimelineRowDrop([], 80, 520), null);
});

test("a gap before a group is not mistaken for a drop within that group", () => {
  const separated = [{ sectionId: 101, top: 89.5, height: 40, laneCount: 1, collapsed: false }];
  assert.equal(resolveTimelineRowDrop(separated, 69.25, 520), null);
  assert.deepEqual(resolveTimelineRowDrop(separated, 89.5, 520), {
    sectionId: 101, row: 0, top: 89.5,
  });
});

test("large sections clamp both normal and appended drops to the API row limit", () => {
  const tall = [{ sectionId: 101, top: 49, height: 12_040, laneCount: 301, collapsed: false }];
  for (const y of [8_069, 12_087, 12_099]) {
    assert.deepEqual(resolveTimelineRowDrop(tall, y, 12_100), {
      sectionId: 101, row: 200, top: 8_049,
    });
  }
});

test("a draft lane does not let a drop pin beyond the final task lane", () => {
  const withDraft = [{ sectionId: 101, top: 49, height: 120, laneCount: 2, collapsed: false }];
  assert.deepEqual(resolveTimelineRowDrop(withDraft, 150, 520), {
    sectionId: 101, row: 2, top: 129,
  });
});


test("moving upward through a section keeps preview and pointer in the same visible row", () => {
  for (let y = 248.5; y >= 169; y -= 0.5) {
    const drop = resolveTimelineRowDrop(groups, y, 520)!;
    assert.equal(drop.sectionId, 102);
    assert.ok(drop.top <= y && y < drop.top + 40);
    assert.ok(drop.top >= 169 && drop.top + 40 <= 249);
  }
});


const occupiedGroups = [{
  sectionId: 1, top: 49, height: 80, laneCount: 2, collapsed: false,
  laneById: new Map([[1, 0], [2, 1]]),
  intervalsById: new Map([[1, { start: 10, end: 20 }], [2, { start: 15, end: 25 }]]),
  occupantsByLane: new Map([[0, [1]], [1, [2]]]),
}];
test("overlapping bars offer insertion above and below the hovered bar", () => {
  assert.deepEqual(resolveTimelineTaskDrop(occupiedGroups, 55, 520, 2, null), { sectionId: 1, row: 0, top: 49, insert: true });
  assert.deepEqual(resolveTimelineTaskDrop(occupiedGroups, 80, 520, 2, null), { sectionId: 1, row: 1, top: 89, insert: true });
});
test("a stationary pointer keeps its insertion without chasing displaced bars", () => {
  for (const y of [55, 80]) {
    const previous = resolveTimelineTaskDrop(occupiedGroups, y, 520, 2, null)!;
    assert.deepEqual(resolveTimelineTaskDrop(occupiedGroups, y, 520, 2, previous), previous);
  }
});
test("dragging through a bar from its upper half to its lower half changes the insertion side", () => {
  const above = resolveTimelineTaskDrop(occupiedGroups, 55, 520, 2, null)!;
  assert.deepEqual(resolveTimelineTaskDrop(occupiedGroups, 80, 520, 2, above), { sectionId: 1, row: 1, top: 89, insert: true });
});
test("non-overlapping dates can share a row without opening an insertion gap", () => {
  const nonoverlap = [{ ...occupiedGroups[0], intervalsById: new Map([[1, { start: 1, end: 3 }], [2, { start: 10, end: 20 }]]) }];
  assert.deepEqual(resolveTimelineTaskDrop(nonoverlap, 55, 520, 2, null), { sectionId: 1, row: 0, top: 49 });
});


test("diagonal insertion uses the shifted span when the original dates did not overlap", () => {
  const separated = [{ ...occupiedGroups[0], intervalsById: new Map([[1, { start: 1, end: 5 }], [2, { start: 9, end: 13 }]]) }];
  assert.deepEqual(resolveTimelineTaskDrop(separated, 55, 520, 2, null, -8), { sectionId: 1, row: 0, top: 49, insert: true });
  assert.deepEqual(resolveTimelineTaskDrop(separated, 80, 520, 2, null, -8), { sectionId: 1, row: 1, top: 89, insert: true });
});

test("a diagonal drop moving clear of another span does not reserve a stale insertion gap", () => {
  const previous = resolveTimelineTaskDrop(occupiedGroups, 55, 520, 2, null)!;
  assert.deepEqual(resolveTimelineTaskDrop(occupiedGroups, 55, 520, 2, previous, 20), { sectionId: 1, row: 0, top: 49 });
});
