import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNavigationItems,
  buildPaletteSections,
  filterPaletteItems,
  flattenPaletteSections,
  hasPaletteResults,
  movePaletteIndex,
  normalizeForSearch,
  paletteOptionId,
  type PaletteItem,
} from "./command-palette";
import type { SearchSuggestOption } from "./search-types";

const searchOptions: SearchSuggestOption[] = [
  {
    key: "task-2",
    group: "tasks",
    label: "要件定義",
    sublabel: "デモプロジェクト",
    href: "/projects/1?view=list&task=2",
  },
  {
    key: "project-1",
    group: "projects",
    label: "デモプロジェクト",
    href: "/projects/1?view=list",
  },
  {
    key: "message-1",
    group: "messages",
    label: "要件の確認",
    sublabel: "デモプロジェクト",
    href: "/projects/1?view=messages",
  },
];

test("normalizeForSearch folds katakana, case, width and spacing", () => {
  assert.equal(normalizeForSearch("マイタスク"), "まいたすく");
  assert.equal(normalizeForSearch("まいたすく"), "まいたすく");
  assert.equal(normalizeForSearch("My Tasks"), "mytasks");
  assert.equal(normalizeForSearch("ＡＢＣ"), "abc");
  assert.equal(normalizeForSearch("  受信 トレイ  "), "受信とれい");
});

test("navigation commands follow portfolio and administrator access", () => {
  const member = buildNavigationItems(false, false);
  assert.deepEqual(
    member.map((item) => item.label),
    ["ホーム", "受信トレイ", "マイタスク", "削除済み"],
  );
  assert.equal(member.some((item) => item.label === "ポートフォリオ"), false);
  assert.equal(member.some((item) => item.label === "管理"), false);

  const admin = buildNavigationItems(true, true);
  assert.deepEqual(
    admin.map((item) => item.label),
    ["ホーム", "受信トレイ", "マイタスク", "ポートフォリオ", "管理", "削除済み"],
  );
});

test("navigation filtering is a partial match with Japanese reading aids", () => {
  const items = buildNavigationItems(false, false);
  const labels = (query: string) => filterPaletteItems(items, query).map((item) => item.label);

  assert.deepEqual(labels("タスク"), ["マイタスク"]);
  assert.deepEqual(labels("たすく"), ["マイタスク"]);
  assert.deepEqual(labels("じぶん"), ["マイタスク"]);
  assert.deepEqual(labels("マイ"), ["マイタスク"]);
  assert.deepEqual(labels("my tasks"), ["マイタスク"]);
  assert.deepEqual(labels("存在しない"), []);
});

test("empty query shows navigation only", () => {
  const sections = buildPaletteSections({
    query: "",
    showPortfolio: true,
    isAdmin: true,
    searchOptions,
  });
  assert.deepEqual(
    sections.map((section) => section.key),
    ["navigation"],
  );
  assert.deepEqual(
    sections[0].items.map((item) => item.label),
    ["ホーム", "受信トレイ", "マイタスク", "ポートフォリオ", "管理", "削除済み"],
  );
  assert.equal(hasPaletteResults(sections), true);
});

test("a query keeps matching navigation, groups search hits and ends with search-all", () => {
  const sections = buildPaletteSections({
    query: "要件",
    showPortfolio: false,
    isAdmin: false,
    searchOptions,
  });
  assert.deepEqual(
    sections.map((section) => section.key),
    ["search-tasks", "search-projects", "search-messages", "search-all"],
  );
  assert.deepEqual(
    sections.map((section) => section.label),
    ["タスク", "プロジェクト", "メッセージ", "検索"],
  );

  const all = sections.at(-1)!.items[0];
  assert.equal(all.label, "「要件」をすべての結果で検索");
  assert.equal(all.href, "/search?q=%E8%A6%81%E4%BB%B6");
  assert.equal(hasPaletteResults(sections), true);
});

test("a query filters navigation before the search groups", () => {
  const sections = buildPaletteSections({
    query: "マイ",
    showPortfolio: false,
    isAdmin: false,
    searchOptions: [],
  });
  assert.deepEqual(
    sections.map((section) => section.key),
    ["navigation", "search-all"],
  );
  assert.deepEqual(
    sections[0].items.map((item) => item.label),
    ["マイタスク"],
  );
  assert.equal(hasPaletteResults(sections), true);
});

test("a query with no matches still offers search-all but reports no results", () => {
  const sections = buildPaletteSections({
    query: "該当なし",
    showPortfolio: false,
    isAdmin: false,
    searchOptions: [],
  });
  assert.deepEqual(
    sections.map((section) => section.key),
    ["search-all"],
  );
  assert.equal(hasPaletteResults(sections), false);
});

test("flattening preserves section order for keyboard navigation", () => {
  const sections = buildPaletteSections({
    query: "要件",
    showPortfolio: true,
    isAdmin: false,
    searchOptions,
  });
  const labels = flattenPaletteSections(sections).map((item) => item.label);
  assert.deepEqual(labels, [
    "要件定義",
    "デモプロジェクト",
    "要件の確認",
    "「要件」をすべての結果で検索",
  ]);
});

test("movePaletteIndex wraps and starts from either end", () => {
  assert.equal(movePaletteIndex(-1, 3, 1), 0);
  assert.equal(movePaletteIndex(-1, 3, -1), 2);
  assert.equal(movePaletteIndex(2, 3, 1), 0);
  assert.equal(movePaletteIndex(0, 3, -1), 2);
  assert.equal(movePaletteIndex(0, 0, 1), -1);
  assert.equal(movePaletteIndex(0, 0, -1), -1);
});

test("option ids are stable and unique per index", () => {
  assert.equal(paletteOptionId(0), "command-palette-option-0");
  assert.notEqual(paletteOptionId(0), paletteOptionId(1));
});

test("filterPaletteItems matches sublabels and keywords", () => {
  const items: PaletteItem[] = [
    { key: "a", label: "要件定義", sublabel: "デモ", href: "/a" },
    { key: "b", label: "設計", keywords: ["レビュー"], href: "/b" },
  ];
  assert.deepEqual(
    filterPaletteItems(items, "デモ").map((item) => item.key),
    ["a"],
  );
  assert.deepEqual(
    filterPaletteItems(items, "れびゅー").map((item) => item.key),
    ["b"],
  );
});
