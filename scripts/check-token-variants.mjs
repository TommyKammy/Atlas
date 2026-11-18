#!/usr/bin/env node
// Guard against a token migration that silently changes a dark-theme state.
//
// Why this check exists
// ---------------------
// app/globals.css still carries the legacy dark overrides, e.g.
//   html[data-theme="dark"] .text-neutral-400 { color: #a9a9a9; }
// They are unlayered. An unlayered declaration always beats a utility that
// lives inside Tailwind's @layer utilities, regardless of specificity. So an
// element that used `text-neutral-400` got the dark override in dark mode, and
// a state utility of the same property (`hover:text-red-600`,
// `disabled:text-neutral-300`, `focus:border-[#4075cf]`) had no effect there.
//
// When `text-neutral-400` is replaced with the layered token `text-subtle`, the
// base color in light mode is unchanged, but the state utility starts to win in
// dark mode too. Light stays identical; only the dark state changes. That is a
// visual regression during the "tokenize without changing appearance" step.
//
// The rules implemented here:
//   [variant] Inside one element's class set, if (a) a migrated token utility
//   and (b) a state variant of the same color property (background / text /
//   border) coexist, and (b) has no unlayered dark override in app/globals.css,
//   report the pair. The state class must stay as-is; the token class must be
//   reverted to its legacy class until stage 3 (palette switch) intentionally
//   retunes the dark state.
//
//   [token-variant-over-legacy] The reverse pairing: a state utility that is
//   already a semantic token (`hover:bg-hover`) and a base legacy class of the
//   same property whose unlayered dark override still exists (`bg-white`).
//   The base legacy override always wins over the layered state token in dark
//   mode, so the state stops working there. Migrate the base class in the same
//   change, or revert the state token to its legacy state class.
//
//   [legacy-overlap] Two base classes of the same property can also collide.
//   Example (T17): a chevron has `text-neutral-500` in its base classes and
//   `text-neutral-700` only while the menu is open. Before the migration both
//   were unlayered and declaration order (or specificity) decided. If one of
//   them becomes `text-muted`, the remaining legacy class's unlayered dark
//   override always wins, changing the dark color. Whenever a migrated base
//   token and a non-state legacy class of the same property coexist in one
//   class set, and the legacy class has an unlayered dark override for that
//   property, report the pair. Legacy/legacy and token/token pairs are not
//   reported.
//
//   [form-control] Form controls have an unlayered element rule (T17):
//     html[data-theme="dark"] input, select, textarea {
//       background-color: #2b2b2b; color: #ededed;
//     }
//   Before the migration the legacy class's dark override (a class selector)
//   was more specific than the element selector and won. A layered token loses
//   to the unlayered element rule, so a dark input turns #2b2b2b / #ededed.
//   A background/text token on an intrinsic JSX input, select or textarea is
//   reported, unless the token's own dark value already equals the element
//   rule's value for that property (today `text-text` / `text-foreground` are
//   #ededed, so they look the same with or without the override). The element
//   rule properties and values are read from globals.css, as are the dark
//   `--atlas-*` values and the `@theme inline` `--color-*` mapping. Values are
//   compared as normalised lowercase CSS values; an unresolved token is still
//   reported.
//
// Exceptions encoded below
//   - A state class that is itself a semantic token (`hover:text-text`,
//     `hover:bg-surface-muted`, `hover:text-accent-text`, `focus:border-accent`,
//     ...) is not reported. Its color resolves from --atlas-* variables in both
//     themes, and both the base and the state utility are layered, so the
//     legacy unlayered override is not part of the comparison at all.
//   - `bg-accent` / `border-accent` are not affected: the legacy
//     `bg-[#2c60b8]` / `border-[#2c60b8]` never had a dark override, so the
//     state utility already won before the migration.
//   - A state class that is itself unlayered-overridden in dark mode (today:
//     hover:bg-white, hover:bg-neutral-50, hover:bg-neutral-100,
//     hover:bg-neutral-200, hover:text-black, hover:text-neutral-700,
//     hover:text-neutral-800) looks the same before and after; it is skipped.
//     The list is read from app/globals.css, not hard-coded.
//   - [token-variant-over-legacy] only pairs a state class that is itself a
//     semantic token with a base legacy class that has an unlayered dark
//     override for the same property. Legacy/legacy state pairs and token/token
//     pairs are not reported.
//   - `placeholder:` is out of scope. It colors ::placeholder, not the element's
//     own text, and the legacy dark overrides never targeted it. Pseudo-element
//     variants (before:, after:, file:, marker:, selection:, backdrop:) are
//     skipped for the same reason.
//   - Non-color utilities are not misread as colors: text-[13px], text-sm,
//     text-left, border-b, border-2, border-solid, bg-gradient-*, bg-cover,
//     bg-[url(...)], bg-[length:...], ring-*, outline-*, divide-* and friends.
//   - [legacy-overlap] only considers a legacy class whose dark override
//     actually declares the same property. `bg-violet-400`, for example, is
//     overridden only for color (avatar initials), so it does not conflict with
//     `bg-surface`. A legacy class with a state/breakpoint variant is not a
//     base overlap; the [variant] rule handles state classes.
//   - [form-control] ignores pseudo-element variants (placeholder:, file:, ...)
//     because they do not color the element itself. It also ignores any token
//     whose property is not in the element rule (today: border-color) and any
//     token whose resolved dark value equals the rule value.
//   - [token-variant-over-legacy] does not require the state token's legacy
//     class to have had its own dark override. It reports the pair whenever the
//     base legacy override would block the state token in dark mode, which is
//     conservative: a state whose legacy class was never overridden already
//     lost in dark before the migration.
//
// How class sets are assembled
// ----------------------------
// The file is parsed with the TypeScript parser (not a regex over quoted
// strings). For each JSX `className` attribute and each cn()/clsx()/
// classNames()/cx() call, every static string segment in the expression is
// collected: plain strings, both branches of a conditional, template literal
// chunks, array items, `+` concatenations, and identifiers that resolve to a
// string/template constant declared in the same file (transitively). Segments
// from the same alternative belong to one element's class set.
//
// Conditional branches are kept as separate alternatives, so a token and a
// state class are reported only when they can appear on the element in the same
// branch. Merging `selected ? "bg-accent-soft" : "hover:bg-surface-muted"` into
// one set would invent a conflict that cannot render. Static text outside the
// conditional is added to every alternative. Alternatives are capped at 256; a
// deeper expression falls back to the union, which is conservative (it may
// report a cross-branch pair rather than miss a real one). The cap is high
// enough for class templates such as TimelineBar (5 independent conditionals,
// 80 combinations) so mutually exclusive bar faces are not merged.
//
// Output: `file:line  [kind] <conflict class>  (with <token class> / <element>)`,
// one line per problem, then a count. `kind` is `variant`,
// `token-variant-over-legacy`, `legacy-overlap` or `form-control`. Exit code 1
// when anything is found, 0 when clean. The line points at the string segment
// that contains the class to inspect; for a class inherited from a constant,
// that is the constant's definition line. For `token-variant-over-legacy`,
// `legacy-overlap` and `form-control`, the reported line is the token class to
// revert.
//
// Known limits (accepted; a full type-aware analysis is out of scope)
//   - Classes assembled at runtime from values that are not static strings are
//     invisible. Examples: `className={`text-${tone}`}`, a class map keyed by
//     a variable (`classByState[state]`), a constant imported from another
//     module, or classes returned by an arbitrary helper function.
//   - Identifiers are resolved by name within the file. Two same-named
//     constants in different scopes are merged; the result can be a false
//     positive. Shadowing with a non-string value is ignored.
//   - Conditional branches are kept as alternatives, so mutually exclusive
//     branches are not paired. Separate conditional expressions are still
//     cross-producted: two independent conditionals that correlate in reality
//     (`a ? "bg-accent-soft" : ""` plus `a ? "" : "hover:bg-surface-muted"`)
//     can produce a pair that never renders. That is a possible false positive.
//   - A class split across a template interpolation (`text-${size}`) cannot be
//     reconstructed. A class token split by a newline is fine.
//   - Only color utilities whose property is background-color, color, or
//     border-color are compared. ring/outline/divide/fill/stroke, gradients,
//     shadows, opacity modifiers on the token side, and CSS-in-JS style
//     objects are not inspected. `divide-line` is therefore not covered.
//   - Arbitrary values that hide the color behind a CSS variable
//     (`text-[color:var(--foreground)]`) are skipped: the utility name alone
//     does not prove the property is a color.
//   - The dark-override list is parsed from simple selector forms
//     (`html[data-theme="dark"] .hover\:bg-white:hover` and
//     `[class~="..."]`). A hypothetical override grouped under a different
//     selector shape would be missed.
//   - [legacy-overlap] only pairs a base token with a base legacy class. A
//     token under a state variant (`hover:bg-surface`) next to a base legacy
//     class is not inspected; nor is a token with an opacity modifier
//     (`bg-surface/50`), because it is not in TOKEN_PROPERTIES.
//   - [form-control] only follows intrinsic `<input>`, `<select>` and
//     `<textarea>` JSX elements in the same file. A design-system wrapper
//     (`<Input>`, `<TextField>`) that forwards a class constant, or a class
//     imported from another module, is invisible. The element rule parser only
//     recognises selectors of the exact shape
//     `html[data-theme="dark"] input` (quoted attribute, no `:where()` /
//     `:not()`); pseudo-element rules such as `input::placeholder` are ignored
//     on purpose. The value comparison understands a direct `var(--...)` chain
//     from `--color-*` to `--atlas-*`; a token whose value cannot be resolved
//     through that chain is reported conservatively, and equivalent colours in
//     different syntaxes (`#ededed` vs `rgb(237 237 237)`) are not equated.
//   - A comment or prose string that forms a valid className-like expression is
//     still parsed as source; comments are ignored by the parser, but strings
//     passed to className/cn() in dead code are reported.
//
// Usage:
//   node scripts/check-token-variants.mjs
//   node scripts/check-token-variants.mjs --help

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCAN_ROOTS = ["components", "app"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_DIRS = new Set(["node_modules", "tests", "test", "__tests__", "__mocks__", "fixtures", "__fixtures__"]);
const EXCLUDED_FILE = /(?:\.(?:test|spec))\.(?:[cm]?[jt]sx?)$/;

// Token utilities that replaced a legacy class which has a dark override in
// globals.css (docs/design-tokens.md section 4). `bg-accent` / `border-accent`
// are intentionally absent: their legacy classes had no dark override.
export const TOKEN_PROPERTIES = new Map([
  // Surfaces: bg-white, bg-neutral-50/100/200, bg-[#eaeaea], bg-[#eff4fd],
  // bg-red-50, bg-green-100, bg-amber-50.
  ["bg-surface", "bg"],
  ["bg-surface-subtle", "bg"],
  ["bg-surface-muted", "bg"],
  ["bg-surface-strong", "bg"],
  ["bg-line", "bg"],
  ["bg-accent-soft", "bg"],
  ["bg-danger-soft", "bg"],
  ["bg-warning-soft", "bg"],
  ["bg-success-soft", "bg"],
  // Stage 2 hover surfaces: hover:bg-neutral-100 / hover:bg-neutral-200 had
  // unlayered dark overrides (#363636 / #3f3f3f).
  ["bg-hover", "bg"],
  ["bg-hover-strong", "bg"],
  // Text: text-neutral-900/600/500/400, text-[#050505], text-[#2c60b8],
  // text-red-600, text-green-700, text-amber-800.
  ["text-text", "text"],
  ["text-foreground", "text"], // back-compat alias of text-text
  ["text-secondary", "text"],
  ["text-muted", "text"],
  ["text-subtle", "text"],
  ["text-accent-text", "text"],
  ["text-danger", "text"],
  ["text-warning", "text"],
  ["text-success", "text"],
  // Borders: border-neutral-200/300, border-[#eaeaea].
  ["border-line", "border"],
  ["border-line-strong", "border"],
  // Stage 2 borders: border-neutral-100 / border-blue-200 / border-red-200 had
  // unlayered dark overrides (#333333 / #2f4a6d / #5c3030).
  ["border-line-subtle", "border"],
  ["border-accent-line", "border"],
  ["border-danger-line", "border"],
]);

const PALETTE_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETTE_VALUE = `(?:${PALETTE_NAMES})-(?:50|[1-9]00|950)(?:/\\d{1,3})?`;
const MONOCHROME_VALUE = "(?:white|black|transparent|current|inherit|currentColor)";
const ARBITRARY_COLOR = String.raw`\[(?:color:)?(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^\]]*\))\](?:/\d{1,3})?`;

// Semantic color tokens from docs/design-tokens.md section 3, plus the
// back-compat aliases from section 1. `background` and `foreground` are the
// legacy aliases of `bg` and `text`. `focus-ring` and `scrim` are registered as
// colors as well, even though they are normally used for box-shadow/backdrop.
const SEMANTIC_TOKEN_VALUES = new Set([
  "bg",
  "surface",
  "surface-subtle",
  "surface-muted",
  "surface-strong",
  "hover",
  "hover-strong",
  "scrim",
  "line",
  "line-strong",
  "line-subtle",
  "text",
  "secondary",
  "muted",
  "subtle",
  "on-accent",
  "accent",
  "accent-text",
  "accent-soft",
  "accent-hover",
  "accent-line",
  "danger",
  "danger-soft",
  "danger-line",
  "warning",
  "warning-soft",
  "warning-line",
  "success",
  "success-soft",
  "success-line",
  "focus-ring",
  "background",
  "foreground",
]);
const TOKEN_COLOR_VALUE = `(?:${[...SEMANTIC_TOKEN_VALUES].sort((a, b) => b.length - a.length).join("|")})(?:/\\d{1,3})?`;
const COLOR_VALUE = new RegExp(
  `^(?:${PALETTE_VALUE}|${MONOCHROME_VALUE}|${ARBITRARY_COLOR}|${TOKEN_COLOR_VALUE})$`,
);

// Values that look like `text-*` / `bg-*` / `border-*` but are not a color of
// that property. Matched against the part after the utility prefix.
const BG_NON_COLOR =
  /^(?:none|auto|cover|contain|fixed|local|scroll|repeat(?:-[xy])?|no-repeat|repeat-round|repeat-space|clip-.+|origin-.+|blend-.+|opacity-.+|gradient-.+|linear-gradient\(.+|radial-gradient\(.+|conic-gradient\(.+|\[(?:url|length|position|size|image|linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient)[:(].*)$/;
const TEXT_NON_COLOR =
  /^(?:xs|sm|base|lg|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|opacity-.+|shadow-.+|\[(?:length|size):.*|\[(?:\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|lh|rlh|pt|pc|in|cm|mm|q)|(?:calc|clamp|min|max)\([^\]]*\))\]|\[var\(--[^\]]*\)\])$/;
const BORDER_NON_COLOR =
  /^(?:\d+|\[(?:length:)?\d*\.?\d+(?:px|rem|em|%|pt|pc|in|cm|mm|q)\]|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-.+|opacity-.+|\[length:.*|\[var\(--[^\]]*\)\])$/;

const BORDER_SIDE = /^[trblxyse]-(.+)$/;

/**
 * Classify a base (non-variant) utility as a color utility of one property.
 * Returns "bg" | "text" | "border" | null.
 */
export function colorProperty(utility) {
  const bg = /^bg-(.+)$/.exec(utility);
  if (bg && !BG_NON_COLOR.test(bg[1]) && COLOR_VALUE.test(bg[1])) return "bg";

  const text = /^text-(.+)$/.exec(utility);
  if (text && !TEXT_NON_COLOR.test(text[1]) && COLOR_VALUE.test(text[1])) return "text";

  const border = /^border-(.+)$/.exec(utility);
  if (border) {
    const rest = border[1];
    const side = BORDER_SIDE.exec(rest);
    const value = side ? side[1] : rest;
    if (!BORDER_NON_COLOR.test(rest) && COLOR_VALUE.test(value)) return "border";
  }
  return null;
}

/**
 * True when a base (non-variant) color utility references a semantic token,
 * e.g. `text-text`, `bg-surface-muted`, `border-accent`, `border-t-line`.
 * Such a state class is excluded: it resolves from --atlas-* variables in both
 * themes and is already inside the utilities layer.
 */
export function isSemanticTokenColor(utility) {
  const property = colorProperty(utility);
  if (!property) return false;
  let value = utility.slice(property.length + 1);
  if (property === "border") {
    const side = BORDER_SIDE.exec(value);
    if (side) value = side[1];
  }
  value = value.replace(/\/\d{1,3}$/, "");
  return SEMANTIC_TOKEN_VALUES.has(value);
}

const SIMPLE_STATE_NAMES = new Set([
  "hover",
  "focus",
  "focus-visible",
  "focus-within",
  "active",
  "enabled",
  "disabled",
  "checked",
  "indeterminate",
  "required",
  "valid",
  "invalid",
  "placeholder-shown",
  "autofill",
  "read-only",
  "read-write",
  "open",
  "closed",
  "inert",
  "first",
  "last",
  "odd",
  "even",
  "first-of-type",
  "last-of-type",
  "only",
  "only-of-type",
  "empty",
  "target",
  "visited",
  "link",
  "any-link",
  "default",
  "optional",
  "user-valid",
  "user-invalid",
  "in-range",
  "out-of-range",
]);

// Variants that color something other than the element's own background/text/
// border. A dark override on the element's base class does not compete with
// these, so they are not state conflicts even though they contain a colon.
const NON_ELEMENT_VARIANTS = new Set([
  "placeholder",
  "file",
  "marker",
  "selection",
  "backdrop",
  "before",
  "after",
  "first-letter",
  "first-line",
]);

const BREAKPOINT = /^(?:sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]|dark|print|motion-reduce|motion-safe|contrast-more|contrast-less|portrait|landscape|rtl|ltr|forced-colors)$/;

function isStateVariant(segment) {
  const name = segment.split("/")[0];
  if (SIMPLE_STATE_NAMES.has(name)) return true;
  if (/^(?:group|peer)-/.test(name)) return true;
  if (/^(?:aria|data|has)-/.test(name)) return true;
  // Arbitrary variants such as [&:hover] or [&:focus-visible].
  if (/^\[.*:(?:hover|focus|focus-visible|focus-within|active|disabled|checked|open)\b.*\]$/.test(name)) return true;
  return false;
}

/** Split a utility into variant prefixes and the base utility. */
export function splitVariants(token) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return { variants: parts.slice(0, -1), base: parts[parts.length - 1] };
}

const COLOR_DECLARATION_PROPERTIES = [
  ["background-color", "bg"],
  ["border-color", "border"],
  ["color", "text"],
];

function normalizeCssValue(value) {
  return value
    .replace(/!important\s*$/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Color declarations in a CSS block, keyed bg/text/border, with normalised values. */
function declaredColorValues(body) {
  const values = new Map();
  for (const [declaration, property] of COLOR_DECLARATION_PROPERTIES) {
    // The boundary keeps `background-color` from matching `color` and
    // `border-color`, and skips `scrollbar-color` / `outline-color`.
    const pattern = new RegExp(`(?:^|[;{\\s])${declaration}\\s*:\\s*([^;}]*)`, "g");
    let value;
    for (const match of body.matchAll(pattern)) value = match[1];
    if (value !== undefined) values.set(property, normalizeCssValue(value));
  }
  return values;
}

function declaredColorProperties(body) {
  return new Set(declaredColorValues(body).keys());
}

function parseVariableDeclarations(body) {
  const variables = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
    variables.set(match[1], match[2].trim());
  }
  return variables;
}

function resolveCssValue(value, variables, seen) {
  const text = value.trim();
  const match = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(text);
  if (!match) return normalizeCssValue(text);
  const name = match[1];
  if (seen.has(name)) return null;
  const next = variables.get(name);
  if (next == null) return null;
  return resolveCssValue(next, variables, new Set([...seen, name]));
}

/**
 * Resolve each token utility's dark value from globals.css. The dark
 * `html[data-theme="dark"]` block defines `--atlas-*` (and the
 * `--background` / `--foreground` aliases); `@theme inline` maps
 * `--color-*` to those variables. Returns a Map of utility class -> normalised
 * value. Tokens whose chain cannot be resolved are absent.
 */
export function parseTokenDarkValues(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const darkBlock = /html\[data-theme=["']dark["']\]\s*\{([^{}]*)\}/.exec(withoutComments);
  const themeBlock = /@theme\s+inline\s*\{([^{}]*)\}/.exec(withoutComments);
  if (!darkBlock || !themeBlock) return new Map();

  const themeVariables = parseVariableDeclarations(themeBlock[1]);
  const variables = new Map([...parseVariableDeclarations(darkBlock[1]), ...themeVariables]);
  const values = new Map();

  for (const [token, property] of TOKEN_PROPERTIES) {
    let name = token.slice(property.length + 1);
    if (property === "border") {
      const side = BORDER_SIDE.exec(name);
      if (side) name = side[1];
    }
    const key = `--color-${name}`;
    const reference = themeVariables.get(key);
    if (!reference) continue;
    const value = resolveCssValue(reference, variables, new Set([key]));
    if (value != null) values.set(token, value);
  }
  return values;
}

function unescapeCssClass(value) {
  return value.replace(/\\(.)/g, "$1");
}

function classesInSelector(selectorText, add) {
  for (const attribute of selectorText.matchAll(/\[class~=["']([^"']+)["']\]/g)) {
    add(unescapeCssClass(attribute[1]));
  }
  for (const dotted of selectorText.matchAll(/\.((?:\\.|[^\s,{:.>+~#()])+)/g)) {
    add(unescapeCssClass(dotted[1]));
  }
}

/**
 * Read the unlayered dark overrides from globals.css, keyed by class name.
 * Returns a Map of class name -> Set of color properties ("bg" | "text" |
 * "border") that the override declares. Example:
 *   "text-neutral-500" -> Set(["text"])
 *   "bg-violet-400"    -> Set(["text"])  // only the avatar initials color
 */
export function parseDarkOverrides(css) {
  const overrides = new Map();
  const darkBlock = /html\[data-theme=["']dark["']\]([^{}]*)\{([^{}]*)\}/g;

  for (const block of css.matchAll(darkBlock)) {
    const properties = declaredColorProperties(block[2]);
    if (!properties.size) continue;
    classesInSelector(block[1], (className) => {
      const existing = overrides.get(className) ?? new Set();
      for (const property of properties) existing.add(property);
      overrides.set(className, existing);
    });
  }
  return overrides;
}

/**
 * Read the classes that have any unlayered dark override from globals.css.
 * Returns a Set of class names such as "hover:bg-neutral-50" or "bg-white".
 */
export function parseDarkOverriddenVariants(css) {
  return new Set(parseDarkOverrides(css).keys());
}

/**
 * Read the unlayered dark element rules for form controls from globals.css.
 * Returns a Map of element name -> Map of color property -> normalised value,
 * e.g. "input" -> Map([["bg", "#2b2b2b"], ["text", "#ededed"]]).
 * The selector must be exactly `html[data-theme="dark"] input` (likewise
 * select / textarea); grouped selectors are supported. Pseudo-element rules
 * (`input::placeholder`) and descendant rules (`select option`) are ignored.
 */
export function parseFormControlRules(css) {
  const result = new Map();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const values = declaredColorValues(block[2]);
    if (!values.size) continue;
    for (const part of block[1].split(",")) {
      const selector = part.trim();
      const match = /^html\[data-theme=["']dark["']\]\s+(input|select|textarea)$/.exec(selector);
      if (!match) continue;
      const existing = result.get(match[1]) ?? new Map();
      for (const [property, value] of values) existing.set(property, value);
      result.set(match[1], existing);
    }
  }
  return result;
}

/** The properties (bg/text/border) set by the dark form-control element rules. */
export function parseFormControlProperties(css) {
  const result = new Map();
  for (const [element, values] of parseFormControlRules(css)) {
    result.set(element, new Set(values.keys()));
  }
  return result;
}

function comparePaths(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      if (EXCLUDED_FILE.test(entry.name)) continue;
      files.push(path);
    }
  }
}

function collectStringConstants(sourceFile) {
  const constants = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const list = constants.get(node.name.text) ?? [];
      list.push(node.initializer);
      constants.set(node.name.text, list);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

const MAX_ALTERNATIVES = 256;

function addChunk(chunks, sourceFile, node, text) {
  if (!text) return;
  // Start just after the opening quote/backtick so positions point into `text`.
  const pos = node.getStart(sourceFile) + 1;
  chunks.push({ text, pos });
}

function mergeAlternatives(alternatives) {
  const merged = [];
  const seen = new Set();
  for (const chunks of alternatives) {
    for (const chunk of chunks) {
      const key = `${chunk.pos}\u0000${chunk.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(chunk);
    }
  }
  return [merged];
}

function unionAlternatives(...groups) {
  const all = groups.flat();
  if (all.length <= MAX_ALTERNATIVES) return all;
  return mergeAlternatives(all);
}

function crossAlternatives(left, right) {
  if (left.length * right.length > MAX_ALTERNATIVES) {
    return mergeAlternatives([...left, ...right]);
  }
  const result = [];
  for (const a of left) {
    for (const b of right) result.push([...a, ...b]);
  }
  return result;
}

function crossAll(groups) {
  let result = [[]];
  for (const group of groups) result = crossAlternatives(result, group);
  return result;
}

/**
 * Return every possible class-set alternative for an expression, as an array
 * of chunk lists. Each alternative is one possible rendering of the expression.
 * An unknown/dynamic value contributes an empty alternative.
 */
function collectAlternatives(node, sourceFile, constants, seen) {
  const empty = [[]];
  if (!node) return empty;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const chunks = [];
    addChunk(chunks, sourceFile, node, node.text);
    return [chunks];
  }

  if (ts.isTemplateExpression(node)) {
    let result = [[{ text: node.head.text, pos: node.head.getStart(sourceFile) + 1 }]].filter(
      (chunks) => chunks[0].text,
    );
    if (result.length === 0) result = [[]];
    for (const span of node.templateSpans) {
      const expressionAlternatives = collectAlternatives(span.expression, sourceFile, constants, seen);
      const literalChunks = span.literal.text
        ? [{ text: span.literal.text, pos: span.literal.getStart(sourceFile) + 1 }]
        : [];
      result = crossAlternatives(result, expressionAlternatives);
      if (literalChunks.length) result = crossAlternatives(result, [literalChunks]);
    }
    return result;
  }

  if (ts.isConditionalExpression(node)) {
    return unionAlternatives(
      collectAlternatives(node.whenTrue, sourceFile, constants, seen),
      collectAlternatives(node.whenFalse, sourceFile, constants, seen),
    );
  }

  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.PlusToken) {
      return crossAlternatives(
        collectAlternatives(node.left, sourceFile, constants, seen),
        collectAlternatives(node.right, sourceFile, constants, seen),
      );
    }
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      // `cond && "..."` either contributes nothing or the right side. Union
      // both; do not cross-product, because only one side renders.
      return unionAlternatives(
        collectAlternatives(node.left, sourceFile, constants, seen),
        collectAlternatives(node.right, sourceFile, constants, seen),
      );
    }
    return empty;
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return collectAlternatives(node.expression, sourceFile, constants, seen);
  }

  if (ts.isArrayLiteralExpression(node)) {
    return crossAll([...node.elements].map((element) => collectAlternatives(element, sourceFile, constants, seen)));
  }

  if (ts.isCallExpression(node)) {
    return crossAll([...node.arguments].map((argument) => collectAlternatives(argument, sourceFile, constants, seen)));
  }

  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const initializers = constants.get(node.text);
    if (!initializers) return empty;
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return unionAlternatives(
      ...initializers.map((initializer) => collectAlternatives(initializer, sourceFile, constants, nextSeen)),
    );
  }

  // Anything else (property access, element access, arbitrary runtime value)
  // is intentionally ignored: see the known limits in the header.
  return empty;
}

function classHelperName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

const CLASS_HELPERS = new Set(["cn", "clsx", "classNames", "cx"]);

function tokensWithPositions(sourceFile, chunks) {
  const tokens = new Map();
  for (const chunk of chunks) {
    for (const match of chunk.text.matchAll(/\S+/g)) {
      const token = match[0];
      if (tokens.has(token)) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(chunk.pos + match.index).line + 1;
      tokens.set(token, line);
    }
  }
  return tokens;
}

function inspectClassSet(tokens, { overriddenVariants, darkOverrides, formControlRules, tokenDarkValues, element }) {
  const findings = [];

  // [token-variant-over-legacy] A state token next to a base legacy class whose
  // unlayered dark override wins over the layered state token in dark mode.
  // This runs before the base-token guard: `bg-white hover:bg-accent-hover`
  // has no base token at all, but its dark hover is still wrong.
  for (const [token, line] of tokens) {
    const { variants, base } = splitVariants(token);
    if (variants.length === 0) continue;
    if (variants.some((variant) => NON_ELEMENT_VARIANTS.has(variant.split("/")[0]))) continue;
    const stateful = variants.some((variant) => !BREAKPOINT.test(variant) && isStateVariant(variant));
    if (!stateful) continue;
    if (!isSemanticTokenColor(base)) continue;
    if (overriddenVariants.has(token)) continue;

    const property = colorProperty(base);
    if (!property) continue;
    for (const other of tokens.keys()) {
      if (other === token) continue;
      if (TOKEN_PROPERTIES.has(other) || isSemanticTokenColor(other)) continue;
      const otherParts = splitVariants(other);
      if (otherParts.variants.length) continue;
      if (colorProperty(otherParts.base) !== property) continue;
      if (!darkOverrides.get(other)?.has(property)) continue;
      findings.push({ kind: "token-variant-over-legacy", line, stateClass: token, token: other });
    }
  }

  const tokensByProperty = { bg: [], text: [], border: [] };
  for (const token of tokens.keys()) {
    const property = TOKEN_PROPERTIES.get(token);
    if (property) tokensByProperty[property].push(token);
  }
  if (!tokensByProperty.bg.length && !tokensByProperty.text.length && !tokensByProperty.border.length) {
    return findings;
  }

  // [variant] A state utility of the same property next to a base token.
  for (const [token, line] of tokens) {
    const { variants, base } = splitVariants(token);
    if (variants.length === 0) continue;
    if (variants.some((variant) => NON_ELEMENT_VARIANTS.has(variant.split("/")[0]))) continue;
    const stateful = variants.some((variant) => !BREAKPOINT.test(variant) && isStateVariant(variant));
    if (!stateful) continue;

    const property = colorProperty(base);
    if (!property || !tokensByProperty[property].length) continue;
    if (isSemanticTokenColor(base)) continue;
    if (overriddenVariants.has(token)) continue;

    findings.push({ kind: "variant", line, stateClass: token, token: tokensByProperty[property][0] });
  }

  // [legacy-overlap] A base token next to a base legacy class that has an
  // unlayered dark override for the same property.
  for (const [token, line] of tokens) {
    const property = TOKEN_PROPERTIES.get(token);
    if (!property) continue;
    for (const other of tokens.keys()) {
      if (other === token || TOKEN_PROPERTIES.has(other)) continue;
      const { variants, base } = splitVariants(other);
      if (variants.length) continue;
      if (colorProperty(base) !== property) continue;
      if (!darkOverrides.get(other)?.has(property)) continue;
      findings.push({ kind: "legacy-overlap", line, stateClass: other, token });
    }
  }

  // [form-control] A token of a property that the unlayered dark element rule
  // sets on input / select / textarea. Skip it when the token's own dark value
  // already equals the rule value (e.g. text-text #ededed on color #ededed).
  const formValues = element ? formControlRules.get(element) : null;
  if (formValues) {
    for (const [token, line] of tokens) {
      const { variants, base } = splitVariants(token);
      if (variants.some((variant) => NON_ELEMENT_VARIANTS.has(variant.split("/")[0]))) continue;
      const property = TOKEN_PROPERTIES.get(base);
      if (!property || !formValues.has(property)) continue;
      const tokenValue = tokenDarkValues.get(base);
      const ruleValue = formValues.get(property);
      if (tokenValue != null && ruleValue != null && tokenValue === ruleValue) continue;
      findings.push({ kind: "form-control", line, stateClass: token, token: base, element });
    }
  }

  return findings;
}

function jsxElementName(attribute) {
  const attributes = attribute.parent;
  const element = attributes?.parent;
  if (!element) return null;
  if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return null;
  return ts.isIdentifier(element.tagName) ? element.tagName.text : null;
}

/**
 * Find conflicts in one source file.
 * Returns [{ kind, line, stateClass, token, element? }] in source order.
 */
export function findTokenVariantConflicts(
  source,
  {
    filename = "source.tsx",
    overriddenVariants = new Set(),
    darkOverrides = new Map(),
    formControlRules = new Map(),
    tokenDarkValues = new Map(),
  } = {},
) {
  const scriptKind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, scriptKind);
  const constants = collectStringConstants(sourceFile);
  const classSets = [];

  const addClassSet = (alternatives, element = null) => {
    if (alternatives.some((chunks) => chunks.length)) classSets.push({ alternatives, element });
  };

  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "className") {
      const initializer = node.initializer;
      let alternatives = [];
      if (initializer && ts.isStringLiteral(initializer)) {
        const chunks = [];
        addChunk(chunks, sourceFile, initializer, initializer.text);
        alternatives = [chunks];
      } else if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        alternatives = collectAlternatives(initializer.expression, sourceFile, constants, new Set());
      }
      addClassSet(alternatives, jsxElementName(node));
    }

    if (ts.isCallExpression(node) && CLASS_HELPERS.has(classHelperName(node))) {
      const alternatives = crossAll(
        [...node.arguments].map((argument) => collectAlternatives(argument, sourceFile, constants, new Set())),
      );
      addClassSet(alternatives);
    }

    // Exported class strings (e.g. `export const inputClass = "..."`) are used
    // as className in other modules. Imports are not resolved, so the module
    // that defines the constant must also be checked. This adds only
    // module-scope string/template constants; object values and local strings
    // that never reach a className are picked up only through the className or
    // cn() expression above.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer) || ts.isTemplateExpression(node.initializer)) &&
      ts.isSourceFile(node.parent.parent.parent)
    ) {
      const alternatives = collectAlternatives(node.initializer, sourceFile, constants, new Set([node.name.text]));
      addClassSet(alternatives);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const findings = [];
  const seen = new Set();
  for (const { alternatives, element } of classSets) {
    for (const chunks of alternatives) {
      const tokens = tokensWithPositions(sourceFile, chunks);
      for (const finding of inspectClassSet(tokens, {
        overriddenVariants,
        darkOverrides,
        formControlRules,
        tokenDarkValues,
        element,
      })) {
        const key = [
          finding.kind,
          finding.line,
          finding.stateClass,
          finding.token,
          finding.element ?? "",
        ].join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(finding);
      }
    }
  }
  return findings.sort(
    (a, b) =>
      a.line - b.line ||
      comparePaths(a.stateClass, b.stateClass) ||
      comparePaths(a.kind, b.kind) ||
      comparePaths(a.token, b.token),
  );
}

/** List scannable files (absolute paths) under app/ and components/. */
export function listTargetFiles(root = ROOT) {
  const files = [];
  for (const name of SCAN_ROOTS) {
    const directory = join(root, name);
    if (!existsSync(directory)) continue;
    walk(directory, files);
  }
  return files.sort(comparePaths);
}

/**
 * Scan a project tree.
 * Returns { findings: [{ path, kind, line, stateClass, token, element? }],
 * scannedFileCount }. `path` is POSIX-style and relative to the root.
 */
export function scanTree(root = ROOT) {
  const cssPath = join(root, "app/globals.css");
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const darkOverrides = css ? parseDarkOverrides(css) : new Map();
  const overriddenVariants = new Set(
    [...darkOverrides.keys()].filter((className) => splitVariants(className).variants.length > 0),
  );
  const formControlRules = css ? parseFormControlRules(css) : new Map();
  const tokenDarkValues = css ? parseTokenDarkValues(css) : new Map();
  const targets = listTargetFiles(root);
  const findings = [];
  for (const file of targets) {
    const relativePath = relative(root, file).split(sep).join("/");
    const conflicts = findTokenVariantConflicts(readFileSync(file, "utf8"), {
      filename: relativePath,
      overriddenVariants,
      darkOverrides,
      formControlRules,
      tokenDarkValues,
    });
    for (const conflict of conflicts) findings.push({ path: relativePath, ...conflict });
  }
  findings.sort(
    (a, b) =>
      comparePaths(a.path, b.path) ||
      a.line - b.line ||
      comparePaths(a.stateClass, b.stateClass) ||
      comparePaths(a.kind, b.kind) ||
      comparePaths(a.token, b.token),
  );
  return { findings, scannedFileCount: targets.length };
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Usage: node scripts/check-token-variants.mjs",
        "",
        "Reports migrated token classes that conflict with the unlayered legacy",
        "dark rules: a state variant of the same property, a base legacy class",
        "of the same property, a state token over a base legacy class, or a",
        "form-control background/text token. Revert the token class; see",
        "docs/design-tokens.md section 6.1.",
      ].join("\n"),
    );
    return;
  }
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--help" && argument !== "-h");
  if (unknown.length) {
    console.error(`check-token-variants: unknown argument: ${unknown[0]}`);
    process.exitCode = 2;
    return;
  }

  const { findings, scannedFileCount } = scanTree(ROOT);
  if (findings.length === 0) {
    console.log(`check-token-variants: OK (scanned ${scannedFileCount} file(s))`);
    return;
  }
  console.error("check-token-variants: token conflicts found");
  console.error("");
  for (const finding of findings) {
    const detail = finding.kind === "form-control" ? `<${finding.element}>` : `with ${finding.token}`;
    console.error(`${finding.path}:${finding.line}  [${finding.kind}] ${finding.stateClass}  (${detail})`);
  }
  console.error("");
  console.error(
    `${findings.length} conflict(s) in ${new Set(findings.map((finding) => finding.path)).size} file(s).`,
  );
  const kinds = new Set(findings.map((finding) => finding.kind));
  if (kinds.has("variant")) {
    console.error("variant: revert the base token (with ...) to its legacy class; keep the state class unchanged.");
  }
  if (kinds.has("legacy-overlap")) {
    console.error("legacy-overlap: revert the base token (with ...) to its legacy class.");
  }
  if (kinds.has("form-control")) {
    console.error("form-control: revert the background/text token, or move it off the form control.");
  }
  if (kinds.has("token-variant-over-legacy")) {
    console.error("token-variant-over-legacy: migrate the base legacy class in the same change, or revert the state token.");
  }
  console.error("See docs/design-tokens.md section 4 and 6.1.");
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
