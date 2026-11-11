import assert from "node:assert/strict";
import { test } from "node:test";
import { listFilterSearch, normalizeListFilterInitial } from "./list-filter-state";
import { buildListInitial } from "./project-view-params";
import type { SavedView } from "./repositories/projects";

function parse(search: string) { return Object.fromEntries(new URLSearchParams(search)); }

test("a default history snapshot restores defaults despite newer persisted preferences", () => {
  const state = normalizeListFilterInitial({}, true);
  const search = listFilterSearch("view=list&task=42&tab=custom%3A1&focus=add", state);
  const parsed = new URLSearchParams(search);
  assert.equal(parsed.get("list_state"), "1");
  assert.equal(parsed.get("task"), "42");
  assert.equal(parsed.get("tab"), "custom:1");
  assert.equal(parsed.get("focus"), "add");
  const restored = buildListInitial({ searchParams: parse(search), stored: {
    hide_completed: true, completed_only: true, mine_only: true, assignee: "2", status: "Done", due: "today",
    start: "7", creator: "1", created: "7", updated: "7", completed_on: "7", sort: "due", sortdir: "desc",
    group: "assignee", group2: "status", groupdir: "desc", subtasks_collapsed: true,
  }, statusFieldEnabled: true });
  assert.deepEqual(normalizeListFilterInitial(restored, true), state);
});

test("full list snapshots round-trip filters, groups, ordering and special characters", () => {
  const state = normalizeListFilterInitial({ hide_completed: true, completed_only: true, mine_only: true,
    assignee: "none", status: "レビュー & 確認/#1", due: "nextweek", start: "7", creator: "none", created: "30",
    updated: "today", completed_on: "7", sort: "progress", sortdir: "desc", group: "status", group2: "section",
    groupdir: "desc", subtasks_collapsed: true }, true);
  const search = listFilterSearch("view=list&saved=8&dashboard=%7B%22v%22%3A1%7D&task=4", state);
  const parsed = new URLSearchParams(search);
  assert.equal(parsed.has("saved"), false);
  assert.equal(parsed.get("dashboard"), '{"v":1}');
  assert.equal(parsed.get("task"), "4");
  assert.deepEqual(normalizeListFilterInitial(buildListInitial({ searchParams: parse(search), statusFieldEnabled: true }), true), state);
});

test("clearing conditions replaces stale URL values while retaining task and dashboard context", () => {
  const search = listFilterSearch("view=list&mine=1&status=old&sort=due&group2=status&dashboard=descriptor&task=10", normalizeListFilterInitial({}, true));
  const parsed = new URLSearchParams(search);
  for (const key of ["mine", "status", "sort", "group2"]) assert.equal(parsed.has(key), false);
  assert.equal(parsed.get("dashboard"), "descriptor");
  assert.equal(parsed.get("task"), "10");
});

test("saved sort direction overrides stored and URL preferences, including legacy missing direction", () => {
  const saved: SavedView = { id: 1, name: "Saved", view_type: "list", filters: {}, sort_key: "name", group_by: "section" };
  assert.equal(buildListInitial({ searchParams: { sortdir: "desc" }, stored: { sortdir: "desc" }, saved, statusFieldEnabled: true }).sortdir, "asc");
  assert.equal(buildListInitial({ searchParams: { sortdir: "asc" }, stored: { sortdir: "asc" }, saved: { ...saved, filters: { sortdir: "desc" } }, statusFieldEnabled: true }).sortdir, "desc");
});

test("unmarked entry URLs continue to restore the user's ordinary preferences", () => {
  assert.equal(buildListInitial({ searchParams: { view: "list" }, stored: { mine_only: true, sortdir: "desc" }, statusFieldEnabled: true }).mine_only, true);
  assert.equal(buildListInitial({ searchParams: { view: "list" }, stored: { mine_only: true, sortdir: "desc" }, statusFieldEnabled: true }).sortdir, "desc");
});
