#!/usr/bin/env node
// Ratchet for hard-coded colors in app/, components/ and lib/.
//
// One file is excluded by path: lib/data-colors.ts. It is the single home for
// data colors (chart series, progress bars, status dots, avatars, project and
// template colors) whose values identify data and must not follow the theme.
// Keeping those literals in one module lets the rest of the tree stay free of
// hard-coded colors; see docs/design-tokens.md "データの色".
//
// Why: docs/design-tokens.md defines semantic color utilities (bg-surface,
// text-muted, border-line, ...). While components are migrated to those tokens,
// this check freezes the current number of hard-coded colors per file. A file
// may keep (or reduce) its count; it may not increase it, and a new file may
// not introduce literals. That keeps the migration monotonic without a
// big-bang rewrite.
//
// Usage:
//   node scripts/check-color-literals.mjs            # same as --check
//   node scripts/check-color-literals.mjs --check
//   node scripts/check-color-literals.mjs --update   # rewrite the baseline
//   node scripts/check-color-literals.mjs --summary  # totals, kinds, top 20
//
// Exit codes: 0 = no file increased, 1 = at least one file increased,
//             2 = setup / usage error.
//
// Detection (one count per occurrence):
//   a) Tailwind default palette utilities, e.g. bg-red-500, text-neutral-700,
//      border-blue-200/50, ring-white, fill-black/25. Utility prefixes:
//      bg text border divide ring outline fill stroke from via to placeholder
//      decoration caret accent shadow.
//      NOTE: ring-offset-*, inset-ring-*, inset-shadow-*, text-shadow-* are
//      not in this list. They are rare here and can be added later; that is a
//      known miss, not a failure of the ratchet itself.
//   b) Tailwind arbitrary color values: [#fff], [#2c60b8], [rgb(...)],
//      [rgba(...)], [hsl(...)], [hsla(...)].
//   c) Raw hex colors: #fff / #ffffff / #ffffffff. See "Hex false positives"
//      below for the exclusions.
//
// Token-derived utilities (bg-surface, text-muted, border-line,
// text-accent-text, ...) never match (a) because the palette name position is
// restricted to the Tailwind default palette, so they are not counted.
//
// Hex false positives: raw text is scanned, so a naive /#[0-9a-f]{3,8}/ would
// count URL fragments, HTML entities, and CSS/JS selectors. We reduce that:
//   - only 3, 6, or 8 hex digits, with a word boundary on both sides, so
//     "#section", "#decision-history", and the "#dec" prefix of
//     "#decision-history" do not match (s is not hex, and "i" is a word char);
//   - a preceding "&" is rejected, which excludes HTML numeric entities
//     (&#169;) and named entities;
//   - the value of href/src/action/formaction/xlink:href and the body of
//     url(...) are excluded as ranges, so `href="#abc"` and `url(#fff)` are
//     not counted even when the fragment looks like hex;
//   - querySelector("#abc") / matches("#abc") / closest("#abc") and
//     location.hash = "#abc" are treated as selector references;
//   - a candidate directly followed by "{" is treated as an id selector.
// Limits of these heuristics (accepted, documented):
//   - a comment or plain prose string containing "#fff" is counted;
//   - an id/selector that is not in one of the excluded contexts, e.g.
//     `const id = "#abc"` passed to a custom helper, is counted;
//   - 4-digit hex (#abcd) is not counted by rule (c); inside a Tailwind
//     arbitrary value it is still counted by rule (b);
//   - hex inside CSS custom-property fallbacks (var(--x, #fff)) is counted,
//     which is intentional: it is still a hard-coded color.
//
// Counts are per occurrence, not per unique class. Classes in comments and in
// string literals are scanned too (conservative: a false positive freezes one
// extra count instead of letting a literal slip through).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = resolve(ROOT, "tests/fixtures/color-literal-baseline.json");
const SCAN_ROOTS = ["app", "components", "lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
// Directory names that hold tests or fixtures. app/ and components/ currently
// contain none, but excluding them keeps the rule explicit and future-proof.
const EXCLUDED_DIRS = new Set(["node_modules", "tests", "test", "__tests__", "__mocks__", "fixtures", "__fixtures__"]);
const EXCLUDED_FILE = /(?:\.(?:test|spec))\.(?:[cm]?[jt]sx?)$/;
// Data colors identify data or a user's own choice (chart series, progress
// bars, status dots, avatars, project/label colors). They must not follow the
// theme, so their literals live in one module instead of becoming --atlas-*
// tokens. See docs/design-tokens.md "データの色".
const EXCLUDED_FILES = new Set(["lib/data-colors.ts"]);

const PALETTE_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const SHADES = "(?:50|[1-9]00|950)";
const COLOR_UTILITIES =
  "bg|text|border|divide|ring|outline|fill|stroke|from|via|to|placeholder|decoration|caret|accent|shadow";

const PALETTE_PATTERN = new RegExp(
  String.raw`(?<![\w-])(?:${COLOR_UTILITIES})-(?:${PALETTE_NAMES})-${SHADES}(?:\/\d{1,3})?(?![\w-])`,
  "g",
);
const MONOCHROME_PATTERN = new RegExp(
  String.raw`(?<![\w-])(?:${COLOR_UTILITIES})-(?:white|black)(?:\/\d{1,3})?(?![\w-])`,
  "g",
);
const ARBITRARY_HEX_PATTERN = /\[#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\]/g;
const ARBITRARY_FUNCTION_PATTERN = /\[(?:rgba?|hsla?)\([^\]\n]*\)\]/g;
const HEX_PATTERN = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;

// Attribute values / props that hold URLs (their "#..." is a fragment, not a
// color). Covers href="...", href={...}, href: "...", xlink:href, etc.
const URL_ATTRIBUTE_PATTERN =
  /\b(?:href|src|action|formaction|xlink:href)\s*[:=]\s*(?:\{[^}\n]*\}|"[^"\n]*"|'[^'\n]*'|`[^`]*`)/gi;
const URL_FUNCTION_PATTERN = /\burl\([^)]*\)/gi;

export const KINDS = ["palette", "arbitrary", "hex"];

// Code-unit order (not localeCompare) keeps the baseline stable across
// platforms and Node ICU builds.
function comparePaths(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function addRange(ranges, start, end) {
  if (end > start) ranges.push([start, end]);
}

function buildExclusionRanges(source) {
  const ranges = [];
  for (const match of source.matchAll(URL_ATTRIBUTE_PATTERN)) {
    addRange(ranges, match.index, match.index + match[0].length);
  }
  for (const match of source.matchAll(URL_FUNCTION_PATTERN)) {
    addRange(ranges, match.index, match.index + match[0].length);
  }
  return ranges;
}

function insideAnyRange(ranges, start, end) {
  return ranges.some(([from, to]) => start >= from && end <= to);
}

function isSelectorReference(source, index) {
  const before = source.slice(Math.max(0, index - 120), index);
  return /(?:querySelector(?:All)?|matches|closest)\s*\(\s*["'`]\s*$/.test(before) ||
    /location\.hash\s*=\s*["'`]\s*$/.test(before);
}

function looksLikeSelectorBlock(source, end) {
  return /^[ \t\r\n]*\{/.test(source.slice(end, end + 16));
}

/**
 * Find every hard-coded color occurrence in a source string.
 * Returns matches in source order: [{ kind, value, index }].
 */
export function findColorLiterals(source) {
  const matches = [];
  const arbitrarySpans = [];
  const excluded = buildExclusionRanges(source);

  for (const pattern of [ARBITRARY_HEX_PATTERN, ARBITRARY_FUNCTION_PATTERN]) {
    for (const match of source.matchAll(pattern)) {
      arbitrarySpans.push([match.index, match.index + match[0].length]);
      matches.push({ kind: "arbitrary", value: match[0], index: match.index });
    }
  }

  for (const pattern of [PALETTE_PATTERN, MONOCHROME_PATTERN]) {
    for (const match of source.matchAll(pattern)) {
      matches.push({ kind: "palette", value: match[0], index: match.index });
    }
  }

  for (const match of source.matchAll(HEX_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    // bg-[#fff] is already counted by rule (b); do not count it twice.
    if (insideAnyRange(arbitrarySpans, start, end)) continue;
    if (insideAnyRange(excluded, start, end)) continue;
    if (isSelectorReference(source, start)) continue;
    if (looksLikeSelectorBlock(source, end)) continue;
    matches.push({ kind: "hex", value: match[0], index: start });
  }

  return matches.sort((a, b) => a.index - b.index);
}

function emptyKindCounts() {
  return { palette: 0, arbitrary: 0, hex: 0 };
}

/**
 * Count hard-coded colors in a source string.
 * Returns { total, byKind: { palette, arbitrary, hex }, matches }.
 */
export function countColorLiterals(source) {
  const matches = findColorLiterals(source);
  const byKind = emptyKindCounts();
  for (const match of matches) byKind[match.kind] += 1;
  return { total: matches.length, byKind, matches };
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

/** List scannable files (absolute paths) under app/ and components/. */
export function listTargetFiles(root = ROOT) {
  const files = [];
  for (const name of SCAN_ROOTS) {
    const directory = join(root, name);
    if (!existsSync(directory)) continue;
    walk(directory, files);
  }
  return files
    .filter((file) => !EXCLUDED_FILES.has(relative(root, file).split(sep).join("/")))
    .sort(comparePaths);
}

/**
 * Scan a project tree.
 * Returns { files: [{ path, total, byKind }], totals, scannedFileCount }.
 * Only files with total > 0 are included in `files`; paths are POSIX-style
 * and relative to the root.
 */
export function scanTree(root = ROOT) {
  const targets = listTargetFiles(root);
  const files = [];
  const totals = { total: 0, byKind: emptyKindCounts() };
  for (const file of targets) {
    const { total, byKind } = countColorLiterals(readFileSync(file, "utf8"));
    if (total === 0) continue;
    files.push({ path: relative(root, file).split(sep).join("/"), total, byKind });
    totals.total += total;
    for (const kind of KINDS) totals.byKind[kind] += byKind[kind];
  }
  files.sort((a, b) => comparePaths(a.path, b.path));
  return { files, totals, scannedFileCount: targets.length };
}

/** Convert scan output to a path -> count map. */
export function countsByFile(scan) {
  const counts = {};
  for (const file of scan.files) counts[file.path] = file.total;
  return counts;
}

/**
 * Serialize a baseline. Keys are sorted so the JSON is byte-for-byte stable
 * for an unchanged tree (no timestamp: re-running --update on a clean tree
 * produces no diff).
 */
export function serializeBaseline(counts) {
  const sorted = {};
  for (const path of Object.keys(counts).sort(comparePaths)) {
    sorted[path] = counts[path];
  }
  return `${JSON.stringify({ version: 1, tool: "check-color-literals", counts: sorted }, null, 2)}\n`;
}

/**
 * Compare current per-file counts with the baseline.
 * An increase (including a new file with a positive count) fails; a decrease
 * is an improvement and does not fail.
 */
export function compareCounts(baseline, current) {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort(comparePaths);
  const increased = [];
  const improved = [];
  for (const path of files) {
    const before = baseline[path] ?? 0;
    const after = current[path] ?? 0;
    if (after > before) increased.push({ path, before, after, delta: after - before });
    else if (after < before) improved.push({ path, before, after, delta: after - before });
  }
  return { ok: increased.length === 0, increased, improved };
}

function fail(message) {
  console.error(`check-color-literals: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  let mode = "check";
  let selected = 0;
  for (const arg of argv) {
    if (arg === "--check") {
      mode = "check";
      selected += 1;
    } else if (arg === "--update") {
      mode = "update";
      selected += 1;
    } else if (arg === "--summary") {
      mode = "summary";
      selected += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/check-color-literals.mjs [--check|--update|--summary]",
          "",
          "  --check    compare per-file counts with tests/fixtures/color-literal-baseline.json (default)",
          "  --update   rewrite the baseline from the current tree",
          "  --summary  print totals by kind and the top 20 files (no baseline check)",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (selected > 1) fail("choose only one of --check, --update, --summary");
  return mode;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    fail(`baseline not found at ${BASELINE_PATH}; run with --update first`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    fail(`baseline is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed?.tool !== "check-color-literals" || typeof parsed.counts !== "object" || parsed.counts === null) {
    fail(`baseline at ${BASELINE_PATH} has an unexpected shape`);
  }
  for (const [path, count] of Object.entries(parsed.counts)) {
    if (!Number.isInteger(count) || count < 0) fail(`baseline has an invalid count for ${path}: ${count}`);
  }
  return parsed.counts;
}

function printSummary(scan) {
  console.log(
    `check-color-literals: ${scan.totals.total} literal(s) in ${scan.files.length} file(s) (scanned ${scan.scannedFileCount} file(s))`,
  );
  for (const kind of KINDS) {
    console.log(`  ${kind.padEnd(9)} ${String(scan.totals.byKind[kind]).padStart(6)}`);
  }
  const top = [...scan.files]
    .sort((a, b) => b.total - a.total || comparePaths(a.path, b.path))
    .slice(0, 20);
  console.log("");
  console.log("Top 20 files:");
  const width = Math.max(...top.map((file) => String(file.total).length), 1);
  for (const file of top) {
    console.log(`  ${String(file.total).padStart(width)}  ${file.path}`);
  }
}

function printCheck(result) {
  console.log(`check-color-literals: baseline ${relative(ROOT, BASELINE_PATH).split(sep).join("/")}`);
  if (result.increased.length > 0) {
    console.error(`FAIL: ${result.increased.length} file(s) increased`);
    for (const entry of result.increased) {
      const state =
        entry.before === 0 ? `new file: 0 -> ${entry.after}` : `${entry.before} -> ${entry.after}`;
      console.error(`  +${entry.delta}  ${entry.path}  (${state})`);
    }
    console.error("Replace the new literals with design tokens, or run --update if the increase is intentional.");
  } else {
    console.log("OK: no file increased");
  }
  if (result.improved.length > 0) {
    console.log(`${result.improved.length} improvement(s) not reflected in the baseline:`);
    for (const entry of result.improved) {
      console.log(`  ${entry.delta}  ${entry.path}  (${entry.before} -> ${entry.after})`);
    }
    console.log("Run --update to lower the baseline.");
  }
}

function main() {
  const mode = parseArgs(process.argv.slice(2));

  if (mode === "update") {
    const scan = scanTree(ROOT);
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, serializeBaseline(countsByFile(scan)));
    console.log(
      `check-color-literals: wrote ${scan.files.length} file(s), ${scan.totals.total} literal(s) to ${relative(ROOT, BASELINE_PATH).split(sep).join("/")}`,
    );
    return;
  }

  const scan = scanTree(ROOT);
  if (mode === "summary") {
    printSummary(scan);
    return;
  }

  const baseline = readBaseline();
  const result = compareCounts(baseline, countsByFile(scan));
  printCheck(result);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
