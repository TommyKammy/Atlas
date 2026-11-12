import assert from "node:assert/strict";
import { test } from "node:test";
import { clampSidebarWidth, parseSidebarWidth, sidebarMaxWidth } from "./sidebar-width";

test("sidebar preference rejects malformed and unbounded cookie input", () => {
  for (const value of [undefined, "", "NaN", "Infinity", "-100", "300.5", " 300", "300px", "10000", "1e3", "<script>"]) {
    assert.equal(parseSidebarWidth(value), 244, value);
  }
  assert.equal(parseSidebarWidth("360"), 360);
  assert.equal(parseSidebarWidth("0"), 220);
  assert.equal(parseSidebarWidth("999"), 480);
});

test("sidebar limits preserve room for content at the desktop breakpoint", () => {
  for (const [viewport, max] of [[1440, 480], [960, 480], [800, 320], [768, 288], [375, 220]]) {
    assert.equal(sidebarMaxWidth(viewport), max);
    assert.equal(clampSidebarWidth(480, max), max);
  }
  assert.equal(clampSidebarWidth(260.6), 261);
  assert.equal(clampSidebarWidth(150), 220);
});
