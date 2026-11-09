import assert from "node:assert/strict";
import { test } from "node:test";
import { menuIndexForKey } from "./use-menu-keyboard";

test("ArrowDown wraps from the last item to the first", () => {
  assert.equal(menuIndexForKey("ArrowDown", 2, 3), 0);
  assert.equal(menuIndexForKey("ArrowDown", 0, 3), 1);
});

test("ArrowUp wraps from the first item to the last", () => {
  assert.equal(menuIndexForKey("ArrowUp", 0, 3), 2);
  assert.equal(menuIndexForKey("ArrowUp", 2, 3), 1);
});

test("Home and End jump to the menu edges", () => {
  assert.equal(menuIndexForKey("Home", 2, 5), 0);
  assert.equal(menuIndexForKey("End", 1, 5), 4);
});

test("unfocused menus start at the correct edge", () => {
  assert.equal(menuIndexForKey("ArrowDown", -1, 4), 0);
  assert.equal(menuIndexForKey("ArrowUp", -1, 4), 3);
});

test("unhandled keys and empty menus return null", () => {
  assert.equal(menuIndexForKey("Enter", 0, 4), null);
  assert.equal(menuIndexForKey("Escape", 0, 4), null);
  assert.equal(menuIndexForKey("ArrowDown", 0, 0), null);
});
