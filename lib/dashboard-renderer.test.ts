import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChartRenderer from "../components/dashboard/ChartRenderer";
import type { DashboardWidgetData } from "./dashboard-compute";
import type { DashboardChartType, DashboardDrilldown } from "./dashboard-types";

function selection(title: string): DashboardDrilldown {
  return {
    v: 1, title, filters: {}, metric: "count", chartType: "bar", groupBy: "section",
    asOfDay: "2026-11-10",
  };
}

const hrefFor = (value: DashboardDrilldown) => `/projects/1?pick=${encodeURIComponent(value.title)}`;

function fixture(chartType: DashboardChartType): DashboardWidgetData {
  const series = chartType === "stacked_bar" || chartType === "grouped_bar" || chartType === "line" || chartType === "burnup"
    ? ["未完了", "完了"] : ["件数"];
  return {
    kind: chartType === "number" ? "number" : "chart",
    categories: [
      { key: "first", label: "分類", values: series.map((_, index) => index + 3),
        drilldowns: series.map((_, index) => selection(`first-${index}`)) },
      { key: "second", label: "別の分類", values: series.map((_, index) => index + 1),
        drilldowns: series.map((_, index) => selection(`second-${index}`)) },
    ],
    series, value: 4, matched: 4, dataLabels: true, drilldown: selection("total"),
  };
}

function render(data: DashboardWidgetData, chartType: DashboardChartType, resolver?: typeof hrefFor) {
  return renderToStaticMarkup(createElement(ChartRenderer, {
    data, chartType, title: "検証チャート", hrefFor: resolver,
  }));
}

test("dashboard zero number remains a native link to its contributing task set", () => {
  const data = { ...fixture("number"), value: 0 };
  const html = render(data, "number", hrefFor);
  assert.match(html, /<a[^>]*href="\/projects\/1\?pick=total"/);
  assert.match(html, /data-dashboard-chart-link="total"/);
  assert.match(html, /aria-label="検証チャート、0、対象のタスクをリストで表示"/);
  assert.match(html, />0<\/a>/);
});

test("donut positive slice retains its descriptor when an earlier zero slice is omitted", () => {
  const data = fixture("donut");
  // Equal labels make label-based reverse lookup incapable of finding the ID.
  data.categories = [
    { key: "section:11", label: "同名", values: [0], drilldowns: [selection("zero")] },
    { key: "section:22", label: "同名", values: [4], drilldowns: [selection("positive")] },
  ];
  const html = render(data, "donut", hrefFor);
  assert.equal((html.match(/href="\/projects\/1\?pick=positive"/g) ?? []).length, 2, "arc and legend use the positive category");
  assert.doesNotMatch(html, /href="\/projects\/1\?pick=zero"/);
  assert.equal((html.match(/data-dashboard-chart-category="section:22"/g) ?? []).length, 2);
  assert.match(html, /data-dashboard-chart-link="legend"/);
  assert.match(html, /data-dashboard-chart-link="total"/);
  assert.match(html, /data-dashboard-chart-data/);
  assert.doesNotMatch(html, /<table/, "closed data alternative adds no eager table markup");
});

test("stacked segments and their numeric labels link independently and fit the total-scaled axis", () => {
  const data = fixture("stacked_bar");
  data.categories = [{
    key: "stack", label: "分類", values: [7, 9],
    drilldowns: [selection("open"), selection("done")],
  }];
  const html = render(data, "stacked_bar", hrefFor);
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter((match) => match[1].includes('data-dashboard-chart-link="cell"'));
  assert.equal(links.length, 2);
  for (const [index, value] of [7, 9].entries()) {
    const link = links[index];
    assert.match(link[1], new RegExp(`data-dashboard-chart-series="${index}"`));
    assert.match(link[1], new RegExp(`href="/projects/1\\?pick=${index === 0 ? "open" : "done"}"`));
    assert.match(link[2], new RegExp(`<text[^>]*>${value}</text>`), "the displayed number belongs to the same link as its segment");
    const rect = /<rect\b([^>]*)>/.exec(link[2]);
    assert.ok(rect);
    const y = Number(/\by="([^"]+)"/.exec(rect[1])?.[1]);
    const height = Number(/\bheight="([^"]+)"/.exec(rect[1])?.[1]);
    assert.ok(Number.isFinite(y) && y >= 20, "the stack must not overflow above the plot");
    assert.ok(Number.isFinite(height) && height > 0 && y + height <= 214.0001);
  }
});

const chartTypes: DashboardChartType[] = [
  "bar", "stacked_bar", "grouped_bar", "line", "burnup", "burndown", "donut", "number", "lollipop",
];

for (const chartType of chartTypes) {
  test(`${chartType} delegates native link targets to original descriptors and supports callers without hrefFor`, () => {
    const data = fixture(chartType);
    const known = new Set([data.drilldown!, ...data.categories.flatMap((category) => category.drilldowns)]);
    const seen: DashboardDrilldown[] = [];
    const html = render(data, chartType, (descriptor) => {
      seen.push(descriptor);
      return hrefFor(descriptor);
    });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((descriptor) => known.has(descriptor)), "labels must not be converted back into selection conditions");
    if (chartType !== "number") {
      for (const category of data.categories) {
        for (const descriptor of category.drilldowns) {
          assert.ok(html.includes(`href="${hrefFor(descriptor)}"`));
        }
      }
      assert.match(html, /data-dashboard-chart-data/);
    }
    assert.match(html, /<a[^>]+href=/, "native links provide keyboard and new-tab navigation");
    const legacy = render(data, chartType);
    assert.doesNotMatch(legacy, /<a\b|data-dashboard-chart-data/);
  });
}

test("disabled status, text, and empty charts expose no task navigation", () => {
  const data = fixture("bar");
  for (const kind of ["disabled-status", "text"] as const) {
    assert.doesNotMatch(render({ ...data, kind }, "bar", hrefFor), /<a\b|data-dashboard-chart-data/);
  }
  assert.doesNotMatch(render({ ...data, categories: [] }, "bar", hrefFor), /<a\b|data-dashboard-chart-data/);
});
