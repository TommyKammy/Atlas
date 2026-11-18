import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  colorConflictProperty,
  colorProperty,
  findTokenVariantConflicts,
  isSemanticTokenColor,
  parseDarkOverriddenVariants,
  parseDarkOverrides,
  parseFormControlProperties,
  parseFormControlRules,
  parseTokenDarkValues,
  splitVariants,
} from "./check-token-variants.mjs";

const GLOBALS_CSS = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// Keep the legacy-overlap cases covered even though the migration removed most
// real overrides. globals.css itself is checked separately below.
const DARK_OVERRIDE_CSS = [
  'html[data-theme="dark"] .bg-white { background-color: #242424; }',
  'html[data-theme="dark"] .border-neutral-200 { border-color: #3a3a3a; }',
  'html[data-theme="dark"] .text-neutral-700 { color: #dedede; }',
  'html[data-theme="dark"] .text-blue-700 { color: #a9ccff; }',
  'html[data-theme="dark"] .bg-violet-400 { color: #171717; }',
].join("\n");
const DARK_OVERRIDES = parseDarkOverrides(DARK_OVERRIDE_CSS);
// globals.css keeps the form-control colors in @layer base as a fallback, so
// the unlayered parser should find nothing there. The rule shape is still
// covered by this sample.
const FORM_CONTROL_CSS = [
  'html[data-theme="dark"] input,',
  'html[data-theme="dark"] select,',
  'html[data-theme="dark"] textarea {',
  "  background-color: #2b2b2b;",
  "  color: #ededed;",
  "}",
].join("\n");
const FORM_CONTROLS = parseFormControlProperties(FORM_CONTROL_CSS);
const FORM_CONTROL_RULES = parseFormControlRules(FORM_CONTROL_CSS);
const TOKEN_DARK_VALUES = parseTokenDarkValues(GLOBALS_CSS);

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
  return findTokenVariantConflicts(source, {
    overriddenVariants: overridden,
    darkOverrides: DARK_OVERRIDES,
    formControlRules: FORM_CONTROL_RULES,
    tokenDarkValues: TOKEN_DARK_VALUES,
  }).map((finding) => ({
    stateClass: finding.stateClass,
    token: finding.token,
  }));
}

function findings(source) {
  return findTokenVariantConflicts(source, {
    overriddenVariants: OVERRIDDEN,
    darkOverrides: DARK_OVERRIDES,
    formControlRules: FORM_CONTROL_RULES,
    tokenDarkValues: TOKEN_DARK_VALUES,
  }).map((finding) => ({
    kind: finding.kind,
    conflict: finding.stateClass,
    token: finding.token,
    ...(finding.element ? { element: finding.element } : {}),
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
  assert.deepEqual(conflicts('<div className="bg-surface hover:bg-hover" />'), []);
  // A legacy palette state class is still reported.
  assert.deepEqual(conflicts('<a className="text-muted hover:text-neutral-900" />'), [
    { stateClass: "hover:text-neutral-900", token: "text-muted" },
  ]);
});

test("detects a state token over a base legacy class with a dark override (token-variant-over-legacy)", () => {
  assert.deepEqual(findings('<div className="bg-white hover:bg-hover" />'), [
    { kind: "token-variant-over-legacy", conflict: "hover:bg-hover", token: "bg-white" },
  ]);
  // A state token whose base token is not a migrated base class is still checked.
  assert.deepEqual(findings('<div className="bg-white hover:bg-accent-hover" />'), [
    { kind: "token-variant-over-legacy", conflict: "hover:bg-accent-hover", token: "bg-white" },
  ]);
  assert.deepEqual(findings('<div className="border-neutral-200 focus:border-accent-line" />'), [
    { kind: "token-variant-over-legacy", conflict: "focus:border-accent-line", token: "border-neutral-200" },
  ]);
  assert.deepEqual(findings('<a className="text-neutral-700 hover:text-on-accent" />'), [
    { kind: "token-variant-over-legacy", conflict: "hover:text-on-accent", token: "text-neutral-700" },
  ]);
});

test("does not report state tokens without a base legacy dark override", () => {
  assert.deepEqual(findings('<div className="bg-surface hover:bg-hover" />'), []);
  assert.deepEqual(findings('<div className="hover:bg-hover" />'), []);
  assert.deepEqual(findings('<div className="bg-white hover:bg-neutral-100" />'), []);
  assert.deepEqual(findings('<div className="border-[#eeeeee] hover:border-accent-line" />'), []);
  assert.deepEqual(findings('<div className="bg-white focus:border-accent-line" />'), []);
  assert.deepEqual(findings('<div className="bg-white placeholder:bg-hover" />'), []);
});

test("classifies semantic token colors", () => {
  assert.equal(isSemanticTokenColor("text-text"), true);
  assert.equal(isSemanticTokenColor("text-secondary"), true);
  assert.equal(isSemanticTokenColor("bg-surface-muted"), true);
  assert.equal(isSemanticTokenColor("bg-accent-soft"), true);
  assert.equal(isSemanticTokenColor("text-accent-text"), true);
  assert.equal(isSemanticTokenColor("border-accent"), true);
  assert.equal(isSemanticTokenColor("text-on-accent"), true);
  assert.equal(isSemanticTokenColor("bg-hover"), true);
  assert.equal(isSemanticTokenColor("bg-hover-strong"), true);
  assert.equal(isSemanticTokenColor("border-line-subtle"), true);
  assert.equal(isSemanticTokenColor("border-accent-line"), true);
  assert.equal(isSemanticTokenColor("border-danger-line"), true);
  assert.equal(isSemanticTokenColor("border-warning-line"), true);
  assert.equal(isSemanticTokenColor("border-success-line"), true);
  assert.equal(isSemanticTokenColor("border-t-line"), true);
  assert.equal(isSemanticTokenColor("bg-danger-soft"), true);
  assert.equal(isSemanticTokenColor("bg-scrim"), true);
  assert.equal(isSemanticTokenColor("bg-scrim-soft"), true);
  assert.equal(isSemanticTokenColor("bg-field"), true);
  assert.equal(isSemanticTokenColor("bg-overlay/10"), true);
  assert.equal(isSemanticTokenColor("bg-inverse-surface"), true);
  assert.equal(isSemanticTokenColor("text-inverse-text"), true);
  assert.equal(isSemanticTokenColor("border-inverse-line"), true);
  assert.equal(isSemanticTokenColor("border-data-line"), true);
  assert.equal(isSemanticTokenColor("text-on-strong"), true);
  assert.equal(isSemanticTokenColor("bg-danger-strong"), true);
  assert.equal(isSemanticTokenColor("hover:bg-danger-strong-hover"), false);
  assert.equal(isSemanticTokenColor("bg-success-strong"), true);
  assert.equal(isSemanticTokenColor("bg-accent-soft-hover"), true);
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
  assert.deepEqual(conflicts('<div className="text-subtle placeholder:text-neutral-400" />'), []);
  assert.deepEqual(conflicts('<input className="placeholder:text-neutral-400" />'), []);
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
  assert.equal(colorConflictProperty("text-red-600"), "text");
  assert.equal(colorConflictProperty("bg-surface"), "bg");
  assert.equal(colorConflictProperty("border-line"), "border");
  assert.equal(colorConflictProperty("border-t-line"), "border-t");
  assert.equal(colorConflictProperty("border-x-neutral-200"), "border-x");
  assert.equal(colorConflictProperty("border-[#e1e1e1]"), "border");
  assert.equal(colorConflictProperty("text-[13px]"), null);
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

test("globals.css keeps only the data and AA-waiting dark overrides", () => {
  assert.deepEqual(
    [...parseDarkOverrides(GLOBALS_CSS).keys()].sort(),
    [
      "atlas-mention",
      "atlas-rich-text",
      "bg-[#aaaaaa]",
      "bg-amber-400",
      "bg-emerald-500",
      "bg-red-100",
      "bg-red-200",
      "bg-rose-400",
      "bg-sky-500",
      "bg-violet-400",
      "text-red-500",
      "text-red-700",
    ],
  );
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

test("detects a base token next to a legacy class with a dark override (legacy-overlap)", () => {
  const source = '<button className={`text-muted ${open ? "text-neutral-700" : ""}`} />';
  assert.deepEqual(findings(source), [
    { kind: "legacy-overlap", conflict: "text-neutral-700", token: "text-muted" },
  ]);
  assert.deepEqual(findings('<div className="bg-surface p-2 bg-white" />'), [
    { kind: "legacy-overlap", conflict: "bg-white", token: "bg-surface" },
  ]);
});

test("detects two base color classes of the same property when one is a token (same-property-overlap)", () => {
  assert.deepEqual(findings('<button className="text-secondary text-rose-600" />'), [
    { kind: "same-property-overlap", conflict: "text-rose-600", token: "text-secondary" },
  ]);
  assert.deepEqual(findings('<button className="text-rose-600 text-secondary" />'), [
    { kind: "same-property-overlap", conflict: "text-rose-600", token: "text-secondary" },
  ]);
  // token/token is also order-dependent once one of them moves to the token layer.
  assert.deepEqual(findings('<div className="text-secondary text-text" />'), [
    { kind: "same-property-overlap", conflict: "text-text", token: "text-secondary" },
  ]);
  assert.deepEqual(findings('<div className="border-line border-rose-300" />'), [
    { kind: "same-property-overlap", conflict: "border-rose-300", token: "border-line" },
  ]);
  assert.deepEqual(findings('<div className="bg-surface bg-accent-soft" />'), [
    { kind: "same-property-overlap", conflict: "bg-surface", token: "bg-accent-soft" },
  ]);
  // A base class inherited from a same-file constant is part of the class set.
  const source = [
    'const buttonClass = "border-line text-secondary";',
    "export function Actions() {",
    '  return <button className={`${buttonClass} text-rose-600`}>削除</button>;',
    "}",
  ].join("\n");
  assert.deepEqual(findings(source), [
    { kind: "same-property-overlap", conflict: "text-rose-600", token: "text-secondary" },
  ]);
});

test("detects a token added conditionally to a base color class", () => {
  assert.deepEqual(findings('<div className={`text-secondary ${cond && "text-text"}`} />'), [
    { kind: "same-property-overlap", conflict: "text-text", token: "text-secondary" },
  ]);
});

test("does not report same-property overlaps across mutually exclusive branches", () => {
  assert.deepEqual(findings('<div className={on ? "text-muted" : "text-danger"} />'), []);
  assert.deepEqual(findings('<div className={on ? "text-muted" : cond ? "text-danger" : ""} />'), []);
  assert.deepEqual(findings('<div className="text-muted" />'), []);
});

test("does not report legacy/legacy, direction-specific, or non-color overlaps", () => {
  assert.deepEqual(findings('<a className="text-neutral-500 text-neutral-700" />'), []);
  assert.deepEqual(findings('<div className="text-muted text-neutral-700" />'), [
    { kind: "legacy-overlap", conflict: "text-neutral-700", token: "text-muted" },
  ]);
  // `border-t-line` sets border-top-color, a different longhand; it is an
  // intentional per-side override of `border-line`, so it is not an overlap.
  assert.deepEqual(findings('<div className="border-line border-t-line" />'), []);
  assert.deepEqual(findings('<div className="border-t-line border-t-rose-600" />'), [
    { kind: "same-property-overlap", conflict: "border-t-rose-600", token: "border-t-line" },
  ]);
  // text-[13px] is a size, not a color.
  assert.deepEqual(findings('<div className="text-[13px] text-secondary" />'), []);
  assert.deepEqual(findings('<div className={open ? "text-muted" : "text-neutral-700"} />'), []);
});

test("matches the dark override property, not just the class name", () => {
  // bg-violet-400 has a dark override only for color (avatar initials), so
  // legacy-overlap does not report it. It is still a second background color,
  // so same-property-overlap reports it against the background token.
  assert.deepEqual(findings('<div className="bg-surface bg-violet-400" />'), [
    { kind: "same-property-overlap", conflict: "bg-violet-400", token: "bg-surface" },
  ]);
  assert.deepEqual(findings('<div className="text-muted text-blue-700" />'), [
    { kind: "legacy-overlap", conflict: "text-blue-700", token: "text-muted" },
  ]);
});

test("ignores form-control element rules inside @layer (fallbacks, not conflicts)", () => {
  assert.deepEqual(parseFormControlRules(GLOBALS_CSS), new Map());
  const layered = [
    "@layer base {",
    '  html[data-theme="dark"] input { background-color: #2b2b2b; }',
    "}",
    'html[data-theme="dark"] input { background-color: #222222; }',
  ].join("\n");
  const parsed = parseFormControlRules(layered);
  assert.equal(parsed.get("input").get("bg"), "#222222");
});

test("reads background-color and color values from the dark form-control rule", () => {
  assert.deepEqual(FORM_CONTROLS.get("input"), new Set(["bg", "text"]));
  assert.deepEqual(FORM_CONTROLS.get("select"), new Set(["bg", "text"]));
  assert.deepEqual(FORM_CONTROLS.get("textarea"), new Set(["bg", "text"]));
  assert.equal(FORM_CONTROL_RULES.get("input").get("bg"), "#2b2b2b");
  assert.equal(FORM_CONTROL_RULES.get("input").get("text"), "#ededed");
  assert.deepEqual(
    parseFormControlProperties('html[data-theme="dark"] input { border-color: #000; }').get("input"),
    new Set(["border"]),
  );
});

test("resolves token dark values from the dark variables and @theme inline mapping", () => {
  assert.equal(TOKEN_DARK_VALUES.get("text-text"), "#ededed");
  assert.equal(TOKEN_DARK_VALUES.get("text-foreground"), "#ededed");
  assert.equal(TOKEN_DARK_VALUES.get("text-secondary"), "#cfcfcf");
  assert.equal(TOKEN_DARK_VALUES.get("text-muted"), "#bdbdbd");
  assert.equal(TOKEN_DARK_VALUES.get("bg-surface"), "#242424");
  assert.equal(TOKEN_DARK_VALUES.get("bg-field"), "#2b2b2b");
  assert.equal(TOKEN_DARK_VALUES.get("bg-surface-muted"), "#303030");
  assert.equal(TOKEN_DARK_VALUES.get("bg-hover"), "#363636");
  assert.equal(TOKEN_DARK_VALUES.get("bg-hover-strong"), "#3f3f3f");
  assert.equal(TOKEN_DARK_VALUES.get("border-line-subtle"), "#333333");
  assert.equal(TOKEN_DARK_VALUES.get("border-accent-line"), "#2f4a6d");
  assert.equal(TOKEN_DARK_VALUES.get("border-danger-line"), "#5c3030");
});

test("detects a background/text token on an intrinsic form control (form-control)", () => {
  assert.deepEqual(findings('<input className="text-secondary" />'), [
    { kind: "form-control", conflict: "text-secondary", token: "text-secondary", element: "input" },
  ]);
  assert.deepEqual(findings('<select className="bg-surface" />'), [
    { kind: "form-control", conflict: "bg-surface", token: "bg-surface", element: "select" },
  ]);
  assert.deepEqual(findings('<textarea className="text-muted" />'), [
    { kind: "form-control", conflict: "text-muted", token: "text-muted", element: "textarea" },
  ]);
});

test("does not report a form-control token whose dark value equals the element rule", () => {
  assert.deepEqual(FORM_CONTROL_RULES.get("input").get("text"), "#ededed");
  assert.deepEqual(findings('<input className="text-text" />'), []);
  assert.deepEqual(findings('<input className="text-foreground" />'), []);
  // The comparison is value-based: text-secondary is #cfcfcf, not #ededed.
  assert.deepEqual(findings('<input className="text-secondary" />'), [
    { kind: "form-control", conflict: "text-secondary", token: "text-secondary", element: "input" },
  ]);
});

test("reports a form-control token when its dark value cannot be resolved", () => {
  const [finding] = findTokenVariantConflicts('<input className="text-text" />', {
    formControlRules: FORM_CONTROL_RULES,
    tokenDarkValues: new Map(),
  });
  assert.equal(finding.kind, "form-control");
  assert.equal(finding.stateClass, "text-text");
  assert.equal(finding.element, "input");
});

test("does not report form controls for border tokens, other elements, or inherited tokens", () => {
  assert.deepEqual(findings('<input className="border-line-strong" />'), []);
  assert.deepEqual(findings('<div className="text-secondary" />'), []);
  assert.deepEqual(findings('<div className="text-secondary"><input /></div>'), []);
  assert.deepEqual(findings('<Input className="text-secondary" />'), []);
});

test("detects a form-control token passed through a same-file class constant", () => {
  const source = [
    'const inputClass = "text-secondary";',
    "export function Field() {",
    "  return <input className={inputClass} />;",
    "}",
  ].join("\n");
  assert.deepEqual(findings(source), [
    { kind: "form-control", conflict: "text-secondary", token: "text-secondary", element: "input" },
  ]);
});
