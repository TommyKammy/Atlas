import assert from "node:assert/strict";
import { test } from "node:test";
import { isSingleDayTimelineTask, usesTimelineExternalLabel } from "./timeline-marker";

const base = {
  start_on: null,
  due_on: null,
  is_milestone: false,
  name: "設計",
  assignee_name: null,
  subtask_count: 0,
};

const multi = { ...base, start_on: "2026-11-10", due_on: "2026-11-15" };
const longName = "とても長いタスク名を一列に収めるための確認用文言";

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

test("usesTimelineExternalLabel keeps short names inside at week zoom", () => {
  assert.equal(usesTimelineExternalLabel(multi, 120, 24), false);
  assert.equal(usesTimelineExternalLabel(multi, 96, 24), false);
  // A 40px bar has no room for a state circle plus a name.
  assert.equal(usesTimelineExternalLabel(multi, 40, 24), true);
  assert.equal(usesTimelineExternalLabel({ ...base, due_on: "2026-11-15" }, 8, 24), true);
  assert.equal(usesTimelineExternalLabel({ ...base, is_milestone: true }, 8, 24), true);
});

test("usesTimelineExternalLabel keeps multi-day names inside at coarse zooms", () => {
  assert.equal(usesTimelineExternalLabel(multi, 40, 12), false);
  assert.equal(usesTimelineExternalLabel(multi, 96, 12), false);
  assert.equal(usesTimelineExternalLabel({ ...multi, name: longName }, 300, 12), false);
  assert.equal(usesTimelineExternalLabel({ ...multi, name: longName }, 24, 4), false);
});

test("wide bars keep long names inside and ellipsize", () => {
  assert.equal(usesTimelineExternalLabel({ ...multi, name: longName }, 120, 24), false);
  assert.equal(usesTimelineExternalLabel({ ...multi, name: longName }, 240, 24), false);
  assert.equal(
    usesTimelineExternalLabel({ ...multi, name: "設計レビュー会" }, 144, 24),
    false,
  );
  // 96px leaves 56px after padding, border and the state circle: less than the
  // five-character floor, so even a five-character name moves outside.
  assert.equal(
    usesTimelineExternalLabel({ ...multi, name: "リスト表示の実装" }, 96, 24),
    true,
  );
  assert.equal(usesTimelineExternalLabel({ ...multi, name: "設計" }, 96, 24), false);
  assert.equal(
    usesTimelineExternalLabel({ ...multi, name: "設計レビュー会" }, 96, 24),
    true,
  );
});

test("usesTimelineExternalLabel keeps five-character names inside wide bars with avatar and subtask", () => {
  const name = "要件定義の再確認";
  assert.equal(usesTimelineExternalLabel({ ...multi, name }, 160, 24), false);
  assert.equal(
    usesTimelineExternalLabel({ ...multi, name, assignee_name: "田中" }, 160, 24),
    false,
  );
  assert.equal(
    usesTimelineExternalLabel({ ...multi, name, subtask_count: 2 }, 160, 24),
    false,
  );
  assert.equal(
    usesTimelineExternalLabel(
      { ...multi, name, assignee_name: "田中", subtask_count: 2 },
      160,
      24,
    ),
    false,
  );
  // The same bar width cannot keep a name that is shorter than the leading
  // items when the available area drops below the five-character floor.
  assert.equal(
    usesTimelineExternalLabel({ ...multi, name: "設計レビュー" }, 80, 24),
    true,
  );
});
