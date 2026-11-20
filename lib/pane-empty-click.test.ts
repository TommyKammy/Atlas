import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isInteractiveClickTarget,
  type ClickTargetNode,
} from "./pane-empty-click";

type NodeOptions = {
  attributes?: Record<string, string>;
  contentEditable?: boolean;
};

function node(
  tagName: string,
  options: NodeOptions = {},
  parentElement: ClickTargetNode | null = null,
): ClickTargetNode {
  const attributes = options.attributes ?? {};
  return {
    tagName,
    parentElement,
    isContentEditable: options.contentEditable ?? false,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => name in attributes,
  };
}

const interactive = (target: ClickTargetNode | null | undefined) =>
  isInteractiveClickTarget(target);

test("form controls and links own their clicks", () => {
  for (const tag of ["a", "button", "input", "label", "select", "option", "summary", "textarea"]) {
    assert.equal(interactive(node(tag)), true, tag);
  }
});

test("interactive roles own their clicks", () => {
  for (const role of [
    "button",
    "menuitem",
    "menuitemcheckbox",
    "option",
    "checkbox",
    "combobox",
    "textbox",
    "tab",
    "dialog",
    "menu",
    "listbox",
  ]) {
    assert.equal(interactive(node("div", { attributes: { role } })), true, role);
  }
});

test("contenteditable owners and their descendants own their clicks", () => {
  assert.equal(interactive(node("div", { attributes: { contenteditable: "" } })), true);
  assert.equal(interactive(node("div", { attributes: { contenteditable: "true" } })), true);
  assert.equal(interactive(node("div", { contentEditable: true })), true);

  const editor = node("div", { attributes: { contenteditable: "true" } });
  const text = node("span", {}, editor);
  assert.equal(interactive(text), true);

  assert.equal(interactive(node("div", { attributes: { contenteditable: "false" } })), false);
});

test("task rows, cards, the pane and overlay targets keep their click behavior", () => {
  for (const attribute of [
    "data-task-pane",
    "data-list-row",
    "data-board-card",
    "data-drag-handle",
    "data-column-resize-handle",
    "data-assignee-picker",
    "data-assignee-menu",
    "data-due-picker",
    "data-due-menu",
    "data-popover-backdrop",
    "data-popover-panel",
    "data-field-type-menu",
    "data-field-dialog",
    "data-list-options-drawer",
    "data-section-menu",
  ]) {
    assert.equal(interactive(node("div", { attributes: { [attribute]: "" } })), true, attribute);
  }
});

test("descendants inherit the owning control through their ancestors", () => {
  const button = node("button");
  const icon = node("svg", {}, button);
  assert.equal(interactive(icon), true);

  const row = node("div", { attributes: { "data-list-row": "12" } });
  assert.equal(interactive(node("span", {}, row)), true);
});

test("empty list and board surfaces do not own clicks", () => {
  assert.equal(interactive(null), false);
  assert.equal(interactive(undefined), false);
  assert.equal(interactive(node("div")), false);
  assert.equal(interactive(node("span")), false);
  assert.equal(interactive(node("section")), false);
  assert.equal(interactive(node("h2")), false);
  // The section heading's drag surface is the empty rest of the header row.
  assert.equal(interactive(node("div", { attributes: { "data-section-drag-handle": "3" } })), false);
  // Generic draggable rows are handled by their data-list-row/data-board-card.
  assert.equal(interactive(node("div", { attributes: { draggable: "true" } })), false);
});

test("a non-interactive child of an empty surface stays empty", () => {
  const header = node("div", { attributes: { "data-list-section-header": "s:1" } });
  assert.equal(interactive(node("span", {}, header)), false);
});
