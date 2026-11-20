import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectViolations,
  countColorLiterals,
  exitCodeForScan,
  findColorLiterals,
  listTargetFiles,
  scanTree,
} from "./check-color-literals.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./check-color-literals.mjs", import.meta.url));

function values(source) {
  return findColorLiterals(source).map((match) => match.value);
}

test("detects Tailwind default palette classes", () => {
  const source =
    '<div className="bg-red-500 text-neutral-700 border-blue-200 divide-slate-100 ring-emerald-400 outline-cyan-600 fill-purple-300 stroke-zinc-800 from-pink-500 via-rose-400 to-orange-300 placeholder-amber-200 decoration-lime-400 caret-teal-500 accent-indigo-600 shadow-violet-700" />';
  const matches = findColorLiterals(source);
  assert.equal(matches.length, 16);
  assert.ok(matches.every((match) => match.kind === "palette"));
  assert.ok(values(source).includes("bg-red-500"));
  assert.ok(values(source).includes("text-neutral-700"));
});

test("detects palette classes with opacity modifiers", () => {
  const source = '<div className="bg-red-500/25 text-blue-700/50 border-neutral-200/75" />';
  assert.deepEqual(values(source), ["bg-red-500/25", "text-blue-700/50", "border-neutral-200/75"]);
});

test("detects -white and -black palette classes", () => {
  const source = '<div className="bg-white text-black border-white/20 fill-black/10" />';
  assert.deepEqual(values(source), ["bg-white", "text-black", "border-white/20", "fill-black/10"]);
  assert.ok(findColorLiterals(source).every((match) => match.kind === "palette"));
});

test("detects Tailwind arbitrary color values exactly once", () => {
  const source =
    'className="bg-[#fff] text-[#2C60B8] border-[rgba(0,0,0,0.5)] ring-[hsl(210_40%_20%)]"';
  const counts = countColorLiterals(source);
  assert.equal(counts.total, 4);
  assert.deepEqual(counts.byKind, { palette: 0, arbitrary: 4, hex: 0 });
  assert.deepEqual(values(source), ["[#fff]", "[#2C60B8]", "[rgba(0,0,0,0.5)]", "[hsl(210_40%_20%)]"]);
});

test("detects hex colors in style objects and strings", () => {
  const source = [
    'const style = { color: "#2c60b8", backgroundColor: "#FFF" };',
    '<div style={{ borderColor: "#ffffffff" }} />',
  ].join("\n");
  const counts = countColorLiterals(source);
  assert.equal(counts.total, 3);
  assert.deepEqual(counts.byKind, { palette: 0, arbitrary: 0, hex: 3 });
  assert.deepEqual(values(source), ["#2c60b8", "#FFF", "#ffffffff"]);
});

test("reports every violation with 1-based line and column", () => {
  const source = [
    '<div className="bg-red-500" />',
    '  <p style={{ color: "#abc" }} />',
  ].join("\n");
  assert.deepEqual(
    findColorLiterals(source).map(({ line, column, value, kind }) => ({ line, column, value, kind })),
    [
      { line: 1, column: 17, value: "bg-red-500", kind: "palette" },
      { line: 2, column: 23, value: "#abc", kind: "hex" },
    ],
  );
});

test("does not count token-derived classes", () => {
  const source =
    'className="bg-surface text-muted border-line bg-surface-subtle bg-surface-muted bg-surface-strong text-accent-text bg-accent-soft border-line-strong text-secondary text-subtle bg-bg text-text"';
  assert.equal(countColorLiterals(source).total, 0);
});

test("does not count href fragments, url() references, entities, or selectors", () => {
  const source = [
    '<a href="#top">top</a>',
    '<a href="#abc">hex-like fragment</a>',
    '<a href={"/docs#abc"}>jsx fragment</a>',
    'const link = { href: "#abc" };',
    '<div style="mask-image: url(#fff)" />',
    "<p>&#169; &amp;</p>",
    'document.querySelector("#abc");',
    'location.hash = "#fff";',
    "const selector = '#abc {';",
  ].join("\n");
  assert.equal(countColorLiterals(source).total, 0);
});

test("still counts a 3-digit hex outside fragment contexts", () => {
  const source = '<div style={{ color: "#abc" }} />';
  assert.deepEqual(values(source), ["#abc"]);
});

test("excludes lib/data-colors.ts by path but scans other lib files", () => {
  const root = mkdtempSync(join(tmpdir(), "check-color-literals-"));
  try {
    mkdirSync(join(root, "lib"), { recursive: true });
    mkdirSync(join(root, "components"), { recursive: true });
    writeFileSync(join(root, "lib", "data-colors.ts"), 'export const dataColor = "#fff";\n');
    writeFileSync(join(root, "lib", "tokens.ts"), "export const uiColor = 'bg-surface';\n");
    writeFileSync(join(root, "components", "Probe.tsx"), '<div className="bg-red-500" />\n');

    assert.deepEqual(
      listTargetFiles(root).map((file) => relative(root, file)),
      ["components/Probe.tsx", "lib/tokens.ts"],
    );

    const scan = scanTree(root);
    assert.equal(scan.totals.total, 1);
    assert.deepEqual(scan.files.map((file) => file.path), ["components/Probe.tsx"]);
    assert.deepEqual(collectViolations(scan), [
      { path: "components/Probe.tsx", line: 1, column: 17, value: "bg-red-500", kind: "palette" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exit code is 0 for a clean scan and 1 when any literal is present", () => {
  assert.equal(exitCodeForScan({ files: [], totals: { total: 0 } }), 0);
  assert.equal(
    exitCodeForScan({
      files: [{ path: "app/a.tsx", total: 1, violations: [] }],
      totals: { total: 1 },
    }),
    1,
  );
});

test("--update is a usage error (exit code 2)", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--update"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--update was removed/);
});
