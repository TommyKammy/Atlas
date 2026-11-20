import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAIN_NAV,
  MOBILE_NAV,
  RAIL_FLYOUTS,
  RAIL_ITEMS,
  visibleNavItems,
} from "./navigation";

test("every portfolio entry point is declared as portfolio-only", () => {
  const entries = [
    ...MAIN_NAV,
    ...MOBILE_NAV,
    ...RAIL_ITEMS,
    ...Object.values(RAIL_FLYOUTS).flat(),
  ];
  for (const entry of entries) {
    if (entry.href.startsWith("/portfolio")) assert.equal(entry.portfolioOnly, true, entry.href);
  }
  assert.equal(MAIN_NAV.some((entry) => entry.key === "portfolio" && entry.portfolioOnly), true);
  assert.equal(MOBILE_NAV.some((entry) => entry.href === "/portfolio" && entry.portfolioOnly), true);
  assert.equal(RAIL_ITEMS.some((entry) => entry.href === "/portfolio" && entry.portfolioOnly), true);
  assert.equal(RAIL_FLYOUTS["/portfolio"].every((entry) => entry.portfolioOnly), true);
});

test("visibility filtering uses the declaration, not the label", () => {
  const items = [
    { href: "/", label: "ホーム" },
    { href: "/portfolio", label: "ポートフォリオ", portfolioOnly: true },
    { href: "/planning", label: "ポートフォリオ計画" },
    { href: "/hidden", label: "別名", portfolioOnly: true },
  ];
  assert.deepEqual(
    visibleNavItems(items, false).map((entry) => entry.href),
    ["/", "/planning"],
  );
  assert.deepEqual(visibleNavItems(items, true), items);
  assert.deepEqual(
    visibleNavItems(MAIN_NAV, false).map((entry) => entry.key),
    ["home", "inbox", "my-tasks"],
  );
  assert.deepEqual(
    visibleNavItems(MAIN_NAV, true).map((entry) => entry.key),
    ["home", "inbox", "my-tasks", "portfolio"],
  );
});
