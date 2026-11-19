import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldIgnoreSingleKeyShortcut } from "./keyboard-shortcuts";

const body = { tagName: "BODY" };

test("single-key shortcuts are ignored while an IME composition is active", () => {
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "g", target: body, isComposing: true }), true);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "b", target: body, keyCode: 229 }), true);
  assert.equal(
    shouldIgnoreSingleKeyShortcut({
      key: "?",
      target: body,
      isComposing: false,
      nativeEvent: { isComposing: true, keyCode: 229 },
    }),
    true,
  );
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "j", target: body, isComposing: false, keyCode: 74 }), false);
});

test("single-key shortcuts are ignored with meta, ctrl or alt modifiers", () => {
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "g", target: body, metaKey: true }), true);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "b", target: body, ctrlKey: true }), true);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "j", target: body, altKey: true }), true);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "?", target: body, shiftKey: true }), false);
});

test("single-key shortcuts are ignored while a text input is focused", () => {
  for (const type of [undefined, "text", "search", "email", "number", "date", "url", "password", "TEL"]) {
    assert.equal(
      shouldIgnoreSingleKeyShortcut({ key: "g", target: { tagName: "INPUT", type } }),
      true,
      `input type ${type ?? "(default)"}`,
    );
  }
  for (const type of ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]) {
    assert.equal(
      shouldIgnoreSingleKeyShortcut({ key: "g", target: { tagName: "INPUT", type } }),
      false,
      `input type ${type}`,
    );
  }
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "b", target: { tagName: "TEXTAREA" } }), true);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "b", target: { tagName: "SELECT" } }), true);
});

test("single-key shortcuts are ignored in contenteditable and ARIA text widgets", () => {
  assert.equal(
    shouldIgnoreSingleKeyShortcut({ key: "l", target: { tagName: "DIV", isContentEditable: true } }),
    true,
  );
  assert.equal(
    shouldIgnoreSingleKeyShortcut({
      key: "l",
      target: { tagName: "DIV", getAttribute: (name: string) => (name === "contenteditable" ? "true" : null) },
    }),
    true,
  );
  for (const role of ["textbox", "combobox", "searchbox", "spinbutton"]) {
    assert.equal(
      shouldIgnoreSingleKeyShortcut({
        key: "n",
        target: { tagName: "DIV", getAttribute: (name: string) => (name === "role" ? role : null) },
      }),
      true,
      `role ${role}`,
    );
  }
});

test("single-key shortcuts are ignored inside an editable ancestor", () => {
  const target = {
    tagName: "P",
    closest: (selector: string) =>
      selector.includes('[contenteditable="true"]') ? { tagName: "DIV" } : null,
  };
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "g", target }), true);
  const plain = { tagName: "DIV", closest: () => null };
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "g", target: plain }), false);
});

test("single-key shortcuts respect the active element when the event target is not editable", () => {
  assert.equal(
    shouldIgnoreSingleKeyShortcut(
      { key: "g", target: { tagName: "DIV", closest: () => null } },
      { tagName: "INPUT", type: "text" },
    ),
    true,
  );
  assert.equal(
    shouldIgnoreSingleKeyShortcut(
      { key: "g", target: { tagName: "DIV", closest: () => null } },
      { tagName: "DIV", closest: () => null },
    ),
    false,
  );
});

test("single-key shortcuts are ignored after another handler prevents the key", () => {
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "?", target: body, defaultPrevented: true }), true);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "?", target: body, defaultPrevented: false }), false);
});

test("non-editable surfaces such as body, buttons and list rows keep shortcuts enabled", () => {
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "g", target: body }), false);
  assert.equal(shouldIgnoreSingleKeyShortcut({ key: "?", target: { tagName: "BUTTON" } }), false);
  assert.equal(
    shouldIgnoreSingleKeyShortcut({
      key: "j",
      target: { tagName: "DIV", getAttribute: () => null, closest: () => null },
    }),
    false,
  );
});
