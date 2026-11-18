import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorProperty,
  findTokenVariantConflicts,
  isSemanticTokenColor,
  parseDarkOverriddenVariants,
  splitVariants,
} from "./check-token-variants.mjs";

const OVERRIDDEN = new Set([
  "hover:bg-white",
  "hover:bg-neutral-50",
  "hover:bg-neutral-100",
  "hover:bg-neutral-200",
  "hover:text-black",
  "hover:text-neutral-700",
  "hover:text-neutral-800",
]);

function conflicts(source, overridden = OVERRIDDEN) {
  return findTokenVariantConflicts(source, { overriddenVariants: overridden }).map((finding) => ({
    stateClass: finding.stateClass,
    token: finding.token,
  }));
}

test("detects a token next to a state variant of the same property", () => {
  assert.deepEqual(conflicts('<button className="text-[12px] text-subtle hover:text-red-600" />'), [
    { stateClass: "hover:text-red-600", token: "text-subtle" },
  ]);
  assert.deepEqual(
    conflicts('<input className="border border-line-strong outline-none focus:border-[#4075cf]" />'),
    [{ stateClass: "focus:border-[#4075cf]", token: "border-line-strong" }],
  );
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-blue-50" />'), [
    { stateClass: "hover:bg-blue-50", token: "bg-surface" },
  ]);
  assert.deepEqual(conflicts('<span className="text-accent-text disabled:text-neutral-300" />'), [
    { stateClass: "disabled:text-neutral-300", token: "text-accent-text" },
  ]);
});

test("does not report state classes that are semantic tokens", () => {
  assert.deepEqual(conflicts('<a className="text-secondary hover:text-text" />'), []);
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-surface-muted" />'), []);
  assert.deepEqual(conflicts('<a className="text-muted hover:text-accent-text" />'), []);
  assert.deepEqual(conflicts('<div className="border-line focus:border-accent" />'), []);
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-danger-soft" />'), []);
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-scrim" />'), []);
  // A legacy palette state class is still reported.
  assert.deepEqual(conflicts('<a className="text-muted hover:text-neutral-900" />'), [
    { stateClass: "hover:text-neutral-900", token: "text-muted" },
  ]);
});

test("classifies semantic token colors", () => {
  assert.equal(isSemanticTokenColor("text-text"), true);
  assert.equal(isSemanticTokenColor("text-secondary"), true);
  assert.equal(isSemanticTokenColor("bg-surface-muted"), true);
  assert.equal(isSemanticTokenColor("bg-accent-soft"), true);
  assert.equal(isSemanticTokenColor("text-accent-text"), true);
  assert.equal(isSemanticTokenColor("border-accent"), true);
  assert.equal(isSemanticTokenColor("border-t-line"), true);
  assert.equal(isSemanticTokenColor("bg-danger-soft"), true);
  assert.equal(isSemanticTokenColor("bg-scrim"), true);
  assert.equal(isSemanticTokenColor("text-red-600"), false);
  assert.equal(isSemanticTokenColor("bg-[#2c60b8]"), false);
  assert.equal(isSemanticTokenColor("text-[13px]"), false);
});

test("ignores state classes that have an unlayered dark override", () => {
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-neutral-50" />'), []);
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-white" />'), []);
  assert.deepEqual(conflicts('<a className="text-muted hover:text-neutral-700" />'), []);
});

test("ignores accent and border-accent, which never had a dark override", () => {
  assert.deepEqual(conflicts('<button className="bg-accent hover:bg-[#24529c]" />'), []);
  assert.deepEqual(conflicts('<button className="border-accent focus:border-[#2c60b8]" />'), []);
});

test("does not mistake sizes, alignment, widths, or gradients for colors", () => {
  assert.deepEqual(conflicts('<p className="text-[13px] hover:text-red-600" />'), []);
  assert.deepEqual(conflicts('<p className="text-sm hover:text-red-600" />'), []);
  assert.deepEqual(conflicts('<p className="text-left hover:text-red-600" />'), []);
  assert.deepEqual(conflicts('<div className="border-2 focus:border-[#4075cf]" />'), []);
  assert.deepEqual(conflicts('<div className="border-b focus:border-[#4075cf]" />'), []);
  assert.deepEqual(conflicts('<div className="bg-gradient-to-r hover:bg-blue-50" />'), []);
  assert.deepEqual(conflicts('<div className="bg-[length:20px] hover:bg-blue-50" />'), []);
});

test("ignores placeholder and other pseudo-element variants", () => {
  assert.deepEqual(conflicts('<input className="text-subtle placeholder:text-neutral-400" />'), []);
  assert.deepEqual(conflicts('<div className="bg-surface backdrop:bg-black/25" />'), []);
  assert.deepEqual(conflicts('<div className="bg-surface before:bg-red-500" />'), []);
});

test("composes template literal branches and detects an unconditional state class", () => {
  const source = [
    "<span",
    '  className={`min-w-0 truncate hover:text-blue-700 ${',
    '    done ? "text-subtle line-through" : "text-neutral-800"',
    '  }`}',
    "/>",
  ].join("\n");
  assert.deepEqual(conflicts(source), [{ stateClass: "hover:text-blue-700", token: "text-subtle" }]);
});

test("does not pair classes that can only appear in different conditional branches", () => {
  const source = [
    "<li",
    '  className={`flex ${selected ? "bg-accent-soft" : "hover:bg-surface-muted"}`}',
    "/>",
  ].join("\n");
  assert.deepEqual(conflicts(source), []);
});

test("resolves module-scope and local class string constants", () => {
  const source = [
    'export const inputClass = "border-line-strong focus:border-[#2c60b8]";',
    "function Row() {",
    '  const rowClass = "text-[12px] text-subtle";',
    '  return <button className={cn(rowClass, "hover:text-red-600", active && "font-medium")}>x</button>;',
    "}",
  ].join("\n");
  const found = conflicts(source);
  assert.deepEqual(found, [
    { stateClass: "focus:border-[#2c60b8]", token: "border-line-strong" },
    { stateClass: "hover:text-red-600", token: "text-subtle" },
  ]);
});

test("reports the line of the state class", () => {
  const source = ['<div', '  className="text-subtle', '    hover:text-red-600"', "/>"].join("\n");
  const [finding] = findTokenVariantConflicts(source, { overriddenVariants: OVERRIDDEN });
  assert.equal(finding.line, 3);
});

test("returns no findings for a clean token element", () => {
  assert.deepEqual(conflicts('<div className="rounded bg-surface p-2 text-muted" />'), []);
});

test("classifies only color utilities of the expected property", () => {
  assert.equal(colorProperty("text-red-600"), "text");
  assert.equal(colorProperty("bg-blue-50"), "bg");
  assert.equal(colorProperty("border-[#4075cf]"), "border");
  assert.equal(colorProperty("border-t-red-600"), "border");
  assert.equal(colorProperty("text-[13px]"), null);
  assert.equal(colorProperty("text-left"), null);
  assert.equal(colorProperty("border-b"), null);
  assert.equal(colorProperty("border-2"), null);
  assert.equal(colorProperty("bg-gradient-to-r"), null);
  assert.equal(colorProperty("bg-[length:20px]"), null);
});

test("splits stacked variants and keeps arbitrary variant colons intact", () => {
  assert.deepEqual(splitVariants("disabled:hover:bg-transparent"), {
    variants: ["disabled", "hover"],
    base: "bg-transparent",
  });
  assert.deepEqual(splitVariants("aria-[sort=ascending]:text-danger"), {
    variants: ["aria-[sort=ascending]"],
    base: "text-danger",
  });
  assert.deepEqual(splitVariants("text-subtle"), { variants: [], base: "text-subtle" });
});

test("reads dark overrides from escaped selectors and [class~=...] selectors", () => {
  const css = [
    'html[data-theme="dark"] .hover\\:bg-neutral-50:hover { background-color: #303030; }',
    'html[data-theme="dark"] [class~="hover:bg-white"]:hover { background-color: #2e2e2e; }',
    'html[data-theme="dark"] .bg-white { background-color: #242424; }',
  ].join("\n");
  assert.deepEqual(
    [...parseDarkOverriddenVariants(css)].sort(),
    ["bg-white", "hover:bg-neutral-50", "hover:bg-white"],
  );
});
