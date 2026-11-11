import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPaneCloseHref } from "./task-pane-navigation";

test("closing a dashboard task retains its exact selection and extra list conditions", () => {
  const selection = JSON.stringify({ v: 1, title: "期限 & Status", filters: { status: "review & QA" } });
  const query = new URLSearchParams({ view: "list", dashboard: selection, task: "8", mine: "1", due: "week", group: "assignee", sort: "due", saved: "99" });
  const href = taskPaneCloseHref(7, "list", query.toString());
  const actual = new URL(href, "http://atlas.local");
  assert.equal(actual.pathname, "/projects/7");
  query.delete("task");
  assert.equal(actual.searchParams.toString(), query.toString());
  assert.equal(actual.searchParams.get("dashboard"), selection);
});

test("malformed, empty and repeated dashboard selections remain fail-closed on close", () => {
  for (const dashboard of ["{malformed", "", "null"]) {
    const query = new URLSearchParams({ view: "list", dashboard, task: "1", mine: "1" });
    const result = new URL(taskPaneCloseHref(2, "list", query.toString()), "http://atlas.local");
    assert.equal(result.searchParams.has("dashboard"), true);
    assert.equal(result.searchParams.get("dashboard"), dashboard);
    assert.equal(result.searchParams.get("mine"), "1");
    assert.equal(result.searchParams.has("task"), false);
  }
  const query = "view=list&dashboard=first&dashboard=second&task=1&task=2";
  const result = new URL(taskPaneCloseHref(2, "list", query), "http://atlas.local");
  assert.deepEqual(result.searchParams.getAll("dashboard"), ["first", "second"]);
  assert.equal(result.searchParams.has("task"), false);
});

test("an ordinary list retains its previous close destination", () => {
  assert.equal(taskPaneCloseHref(3, "list", "view=list&task=1&mine=1"), "/projects/3?view=list");
  assert.equal(taskPaneCloseHref(3, "list", ""), "/projects/3?view=list");
});

test("other views retain their previous destination even with a dashboard parameter", () => {
  for (const view of ["board", "timeline", "calendar", "dashboard"]) {
    assert.equal(taskPaneCloseHref(3, view, `view=${view}&dashboard=anything&task=1&mine=1`), `/projects/3?view=${view}`);
  }
});


test("ordinary list snapshots and saved views retain their conditions on detail close", () => {
  for (const query of ["view=list&list_state=1&task=1&mine=1&tab=custom%3A1", "view=list&saved=99&task=1&sortdir=desc"]) {
    const expected = new URLSearchParams(query);
    expected.delete("task");
    assert.equal(taskPaneCloseHref(3, "list", query), `/projects/3?${expected}`);
  }
});
