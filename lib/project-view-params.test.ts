import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBoardInitial,
  buildBoardInitialGroup,
  buildCalendarInitial,
  buildListInitial,
  parseProjectViewSearch,
  searchParamString,
} from "./project-view-params";

test("parseProjectViewSearch normalizes valid URL parameters", () => {
  const parsed = parseProjectViewSearch(
    {
      view: "calendar",
      task: "42",
      month: "2026-03",
      zoom: "week",
      week: "2026-03-09",
      saved: "7",
      sort: "due",
      sortdir: "desc",
      due: "week",
      from: "2026-03-01",
      group: "status",
    },
    new Date("2026-11-09T00:00:00Z"),
  );

  assert.equal(parsed.explicitView, "calendar");
  assert.equal(parsed.view, "calendar");
  assert.equal(parsed.taskId, 42);
  assert.equal(parsed.month, "2026-03");
  assert.equal(parsed.week, "2026-03-09");
  assert.equal(parsed.savedId, 7);
  assert.equal(parsed.sortRaw, "due");
  assert.equal(parsed.sortDirParam, "desc");
  assert.equal(parsed.dueParam, "week");
  assert.equal(parsed.fromDay, Math.floor(Date.parse("2026-03-01") / 86_400_000));
  assert.equal(parsed.groupRaw, "status");
});

test("parseProjectViewSearch ignores invalid values", () => {
  const parsed = parseProjectViewSearch(
    {
      view: "unknown",
      task: "abc",
      month: "2026-13-99",
      zoom: "week",
      week: "not-a-day",
      saved: "-1",
      sortdir: "sideways",
      due: "someday",
      from: "not-a-day",
    },
    new Date("2026-11-09T12:00:00Z"),
  );

  assert.equal(parsed.explicitView, null);
  assert.equal(parsed.view, "list");
  assert.equal(parsed.taskId, null);
  assert.equal(parsed.month, "2026-11");
  assert.equal(parsed.week, null);
  assert.equal(parsed.savedId, null);
  assert.equal(parsed.sortDirParam, "asc");
  assert.equal(parsed.dueParam, "");
  assert.equal(parsed.fromDay, null);
});

test("searchParamString only returns string values", () => {
  assert.equal(searchParamString({ a: "x", b: ["y"], c: undefined }, "a"), "x");
  assert.equal(searchParamString({ b: ["y"] }, "b"), "");
  assert.equal(searchParamString({}, "missing"), "");
});

test("buildListInitial prefers URL over persisted state", () => {
  const initial = buildListInitial({
    searchParams: {
      hide: "1",
      completed: "done",
      mine: "1",
      assignee: "5",
      status: "進行中",
      due: "today",
      start: "7",
      creator: "none",
      created: "30",
      updated: "today",
      completed_on: "7",
      sort: "due",
      sortdir: "desc",
      group: "assignee",
      group2: "status",
      groupdir: "desc",
      subtasks: "collapsed",
    },
    stored: {
      hide_completed: false,
      completed_only: false,
      mine_only: false,
      assignee: "1",
      status: "未着手",
      due: "month",
      start: "30",
      creator: "1",
      created: "today",
      updated: "30",
      completed_on: "30",
      sort: "name",
      sortdir: "asc",
      group: "section",
      group2: "assignee",
      groupdir: "asc",
      subtasks_collapsed: false,
    },
    statusFieldEnabled: true,
  });

  assert.equal(initial.hide_completed, true);
  assert.equal(initial.completed_only, true);
  assert.equal(initial.mine_only, true);
  assert.equal(initial.assignee, "5");
  assert.equal(initial.status, "進行中");
  assert.equal(initial.due, "today");
  assert.equal(initial.start, "7");
  assert.equal(initial.creator, "none");
  assert.equal(initial.created, "30");
  assert.equal(initial.updated, "today");
  assert.equal(initial.completed_on, "7");
  assert.equal(initial.sort, "due");
  assert.equal(initial.sortdir, "desc");
  assert.equal(initial.group, "assignee");
  assert.equal(initial.group2, "status");
  assert.equal(initial.groupdir, "desc");
  assert.equal(initial.subtasks_collapsed, true);
});

test("buildListInitial falls back to persisted state", () => {
  const initial = buildListInitial({
    searchParams: {},
    stored: {
      hide_completed: true,
      completed_only: false,
      mine_only: true,
      assignee: "3",
      status: "Done",
      due: "month",
      start: "30",
      creator: "2",
      created: "7",
      updated: "today",
      completed_on: "30",
      sort: "likes",
      sortdir: "desc",
      group: "status",
      group2: "assignee",
      groupdir: "desc",
      subtasks_collapsed: true,
    },
    statusFieldEnabled: true,
  });

  assert.equal(initial.hide_completed, true);
  assert.equal(initial.mine_only, true);
  assert.equal(initial.assignee, "3");
  assert.equal(initial.due, "month");
  assert.equal(initial.sort, "likes");
  assert.equal(
    buildListInitial({
      searchParams: { due: "bogus" },
      stored: { due: "month" },
      statusFieldEnabled: true,
    }).due,
    "month",
  );
  assert.equal(initial.sortdir, "desc");
  assert.equal(initial.group, "status");
  assert.equal(initial.group2, "assignee");
  assert.equal(initial.groupdir, "desc");
  assert.equal(initial.subtasks_collapsed, true);
});

test("buildListInitial lets a saved view override URL and stored values", () => {
  const initial = buildListInitial({
    searchParams: { sort: "due", group: "assignee", hide: "0", completed: "done" },
    stored: { sort: "name", group: "section" },
    saved: {
      id: 9,
      name: "Saved",
      view_type: "list",
      sort_key: "created",
      group_by: "status",
      filters: {
        hide_completed: true,
        completed_only: false,
        mine_only: true,
        assignee: "8",
        status: "進行中",
        due: "week",
        start: "7",
        creator: "4",
        created: "30",
        updated: "today",
        completed_on: "7",
        group2: "section",
        groupdir: "asc",
        subtasks_collapsed: true,
      },
    },
    statusFieldEnabled: true,
  });

  assert.equal(initial.hide_completed, true);
  assert.equal(initial.completed_only, false);
  assert.equal(initial.mine_only, true);
  assert.equal(initial.assignee, "8");
  assert.equal(initial.sort, "created");
  assert.equal(initial.group, "status");
  assert.equal(initial.group2, "section");
  assert.equal(initial.subtasks_collapsed, true);
});

test("buildBoardInitial merges URL and persisted display options", () => {
  const initial = buildBoardInitial({
    searchParams: { hide: "0", completed: "done", mine: "0", sort: "due", sortdir: "desc" },
    stored: {
      assignee: "5",
      status: "進行中",
      sort: "name",
      sortdir: "asc",
      show_assignee: false,
      auto_refresh: false,
    },
  });

  assert.equal(initial.hide_completed, false);
  assert.equal(initial.completed_only, true);
  assert.equal(initial.mine_only, false);
  assert.equal(initial.assignee, "5");
  assert.equal(initial.status, "進行中");
  assert.equal(initial.sort, "due");
  assert.equal(initial.sortdir, "desc");
  assert.equal(initial.show_assignee, false);
  assert.equal(initial.auto_refresh, false);
  assert.equal(initial.show_due, true);
});

test("buildBoardInitialGroup honors URL, stored state and status-field setting", () => {
  assert.equal(
    buildBoardInitialGroup({
      searchParams: { group: "status" },
      stored: { group: "assignee" },
      statusFieldEnabled: false,
    }),
    "section",
  );
  assert.equal(
    buildBoardInitialGroup({
      searchParams: {},
      stored: { group: "assignee" },
      statusFieldEnabled: false,
    }),
    "assignee",
  );
});

test("buildCalendarInitial restores persisted state when the URL is empty", () => {
  const initial = buildCalendarInitial({
    searchParams: {},
    stored: {
      completed: "done",
      assignee: "12",
      status: "Done",
      due: "week",
      created: "7",
      updated: "30",
      completed_on: "today",
      creator: "none",
      weekends: false,
      multi: false,
      color: "status",
      start: "1",
      custom: JSON.stringify({ "3": "A" }),
    },
  });

  assert.deepEqual(initial, {
    completed: "done",
    assignee: "12",
    status: "Done",
    custom: { "3": "A" },
    due: "week",
    created: "7",
    updated: "30",
    completedOn: "today",
    creator: "none",
    weekends: false,
    multi: false,
    color: "status",
    weekStart: 1,
  });
});

test("buildCalendarInitial ignores persisted filters when the URL is explicit", () => {
  const initial = buildCalendarInitial({
    searchParams: { completed: "open", hide: "1", cf_5: "B", weekends: "0", color: "none" },
    stored: {
      completed: "done",
      assignee: "12",
      custom: JSON.stringify({ "3": "A" }),
      weekends: true,
      multi: true,
      color: "status",
    },
  });

  assert.equal(initial.completed, "open");
  assert.equal(initial.assignee, "");
  assert.deepEqual(initial.custom, { "5": "B" });
  assert.equal(initial.weekends, false);
  assert.equal(initial.multi, true);
  assert.equal(initial.color, "none");
});

test("buildCalendarInitial maps hide=1 to open and validates ids", () => {
  const initial = buildCalendarInitial({
    searchParams: { hide: "1", assignee: "none", creator: "abc", start: "1" },
  });

  assert.equal(initial.completed, "open");
  assert.equal(initial.assignee, "none");
  assert.equal(initial.creator, "");
  assert.equal(initial.weekStart, 1);
});
