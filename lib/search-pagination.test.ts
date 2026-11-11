import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SearchResults from "../components/search/SearchResults";
import { emptySearchPage, parseSearchPage, searchCriteria, searchDateParam, searchPageHref, searchPageRequest } from "./search-pagination";

test("search pages reject malformed, repeated and overflow input and normalize bounds", () => {
  for (const value of [undefined, "", "0", "-1", "1.1", "2e3", "Infinity", "999999999999999999999", "2147483648", ["2", "3"]]) {
    assert.equal(parseSearchPage(value), 1);
  }
  assert.equal(parseSearchPage("2"), 2);
  assert.equal(parseSearchPage("2147483647"), 2147483647);
  assert.deepEqual(searchPageRequest(Infinity, 501), { page: 1, pageSize: 100 });
  assert.deepEqual(searchPageRequest(2, 0), { page: 2, pageSize: 1 });
  assert.deepEqual(emptySearchPage(20), { items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 });
});

test("paging preserves all standard/custom filters and the other sections' pages", () => {
  const params = { q: "a&日本語", project: "12", assignee: "none", status: "完了", completed: "open", from: "2026-01-01", to: "2026-12-31", created_from: "2026-02-01", completed_to: "2026-09-01", cf_9: "A&B", tasks_page: "2", files_page: "3", unknown: ["a", "b"] };
  const url = new URL(searchPageHref(params, "tasks_page", 3), "http://local");
  assert.equal(url.searchParams.get("tasks_page"), "3");
  assert.equal(url.searchParams.get("files_page"), "3");
  for (const [key, value] of Object.entries(params)) {
    if (key !== "tasks_page") assert.deepEqual(url.searchParams.getAll(key), Array.isArray(value) ? value : [value]);
  }
  assert.equal(url.hash, "#search-tasks");
  assert.equal(new URL(searchPageHref(params, "tasks_page", 1), "http://local").searchParams.has("tasks_page"), false);
});

test("saved criteria discard every section's paging state and retain active filters", () => {
  assert.deepEqual(searchCriteria({ q: "x", cf_7: "Keep", from: "2026-01-01", tasks_page: "2", projects_page: "3", messages_page: "4", knowledge_page: "5", files_page: "6" }), { q: "x", cf_7: "Keep", from: "2026-01-01" });
});

test("date parameters reject impossible dates before PostgreSQL casts", () => {
  assert.equal(searchDateParam("2024-02-29"), "2024-02-29");
  for (const value of ["0000-01-01", "2025-02-29", "2026-13-01", "2026-01-32", "2026-1-1", "not-a-date"]) assert.equal(searchDateParam(value), null);
});

test("full result pagination reports total and range and supports accessible native next/previous links", () => {
  const task = { id: 12, name: "A", completed: false, due_on: null, assignee_name: null, project_id: 1, project_name: "P" };
  const html = renderToStaticMarkup(createElement(SearchResults, {
    q: "A", searched: true, total: 205, tasks: [task], projects: [], messages: [], knowledge: [], files: [],
    pagination: { tasks: { total: 205, page: 2, pageSize: 100, pageCount: 3 }, projects: emptySearchPage(20), messages: emptySearchPage(20), knowledge: emptySearchPage(20), files: emptySearchPage(20) },
    searchParams: { q: "A", cf_1: "value", tasks_page: "2" },
  }));
  assert.match(html, /data-search-section-total="205"/);
  assert.match(html, /101–200 \/ 205件/);
  assert.match(html, /aria-label="タスクの検索結果ページ"/);
  assert.match(html, /data-search-page="previous"/);
  assert.match(html, /data-search-page="next"/);
  assert.match(html, /tasks_page=3/);
  assert.match(html, /cf_1=value/);
});

test("zero search has no misleading range or pagination controls", () => {
  const html = renderToStaticMarkup(createElement(SearchResults, {
    q: "", searched: true, total: 0, tasks: [], projects: [], messages: [], knowledge: [], files: [],
    pagination: { tasks: emptySearchPage(100), projects: emptySearchPage(20), messages: emptySearchPage(20), knowledge: emptySearchPage(20), files: emptySearchPage(20) },
    searchParams: {},
  }));
  assert.match(html, /data-search-empty/);
  assert.doesNotMatch(html, /data-search-pagination/);
});
