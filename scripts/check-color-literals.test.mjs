import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareCounts,
  countColorLiterals,
  findColorLiterals,
  serializeBaseline,
} from "./check-color-literals.mjs";

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

test("fails when a file exceeds the baseline, including a new file", () => {
  const baseline = { "app/a.tsx": 2, "app/b.tsx": 5, "app/gone.tsx": 4 };
  const result = compareCounts(baseline, {
    "app/a.tsx": 2,
    "app/b.tsx": 7,
    "app/gone.tsx": 4,
    "components/New.tsx": 1,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.increased.map((entry) => [entry.path, entry.before, entry.after, entry.delta]),
    [
      ["app/b.tsx", 5, 7, 2],
      ["components/New.tsx", 0, 1, 1],
    ],
  );
  assert.deepEqual(result.improved, []);
});

test("succeeds when a file decreases or disappears, and reports it as an improvement", () => {
  const baseline = { "app/a.tsx": 2, "app/b.tsx": 5, "app/gone.tsx": 4 };
  const result = compareCounts(baseline, { "app/a.tsx": 1, "app/b.tsx": 5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.increased, []);
  assert.deepEqual(
    result.improved.map((entry) => [entry.path, entry.before, entry.after, entry.delta]),
    [
      ["app/a.tsx", 2, 1, -1],
      ["app/gone.tsx", 4, 0, -4],
    ],
  );
});

test("succeeds when every file matches the baseline", () => {
  const baseline = { "app/a.tsx": 2, "app/b.tsx": 5 };
  const result = compareCounts(baseline, { ...baseline });
  assert.equal(result.ok, true);
  assert.deepEqual(result.increased, []);
  assert.deepEqual(result.improved, []);
});

test("serializes the baseline with sorted keys and stable output", () => {
  const json = serializeBaseline({ "components/Z.tsx": 1, "app/b.tsx": 3, "app/a.tsx": 0 });
  assert.ok(json.endsWith("\n"));
  assert.deepEqual(Object.keys(JSON.parse(json).counts), ["app/a.tsx", "app/b.tsx", "components/Z.tsx"]);
  assert.equal(
    json,
    serializeBaseline({ "app/a.tsx": 0, "components/Z.tsx": 1, "app/b.tsx": 3 }),
  );
});
