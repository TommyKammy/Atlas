import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

/**
 * Pure critical-path CPU benchmark. It never opens a database, HTTP connection,
 * or browser. Compare explicit source snapshots with identical in-memory data:
 *
 * node scripts/bench-critical-path.mjs --baseline /snapshot/lib/critical-path.ts \
 *   --candidate lib/critical-path.ts > /tmp/critical-path-performance.json
 *
 * These timings measure the solver only, not browser rendering or user latency.
 * Output sets can differ because the candidate intentionally corrects semantics.
 */
const args = process.argv.slice(2);
const sources = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!["--baseline", "--candidate"].includes(args[i]) || !args[i + 1] || sources.has(args[i])) {
    throw new Error("usage: node scripts/bench-critical-path.mjs --baseline FILE --candidate FILE");
  }
  sources.set(args[i], resolve(args[i + 1]));
}
if (sources.size !== 2) throw new Error("Both explicit baseline and candidate source files are required");

function count(value, fallback, name) {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > 10_000) {
    throw new Error(`${name} must be an integer from 1 to 10000`);
  }
  return result;
}
const warmup = count(process.env.BENCH_WARMUP, 25, "BENCH_WARMUP");
const samples = count(process.env.BENCH_SAMPLES, 200, "BENCH_SAMPLES");
const variants = await Promise.all(["baseline", "candidate"].map(async (name) => {
  const source = sources.get(`--${name}`);
  const imported = await tsImport(pathToFileURL(source).href, import.meta.url);
  if (typeof imported.criticalPath !== "function") throw new Error(`${source} does not export criticalPath`);
  return { name, source, solve: imported.criticalPath };
}));

const day = (offset) => new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
function fixture(size, shape) {
  const tasks = [];
  const dependencies = [];
  for (let i = 0; i < size; i += 1) {
    const id = i + 1;
    const start = shape === "calendar" ? i % 120 : i * 2;
    tasks.push({
      id,
      start_on: day(start),
      due_on: day(start + (shape === "calendar" && i % 7 === 0 ? 5 : 0)),
      is_milestone: shape === "calendar" && i % 37 === 0,
    });
    if (shape === "calendar") {
      // Independent 30-task chains, with equal-date joins.
      if (i % 30 !== 0) dependencies.push({ task_id: id, depends_on_id: id - 1 });
      if (i % 30 > 3 && i % 4 === 0) dependencies.push({ task_id: id, depends_on_id: id - 3 });
    } else if (i > 0) {
      dependencies.push({ task_id: id, depends_on_id: id - 1 });
      if (shape === "branching" && i > 4) {
        dependencies.push({ task_id: id, depends_on_id: id - 4 });
      }
    }
  }
  // Reverse input order makes recursive depth visible rather than hidden by a
  // memo populated in dependency order; the DAG itself remains unchanged.
  if (shape !== "calendar") tasks.reverse();
  return { tasks, dependencies };
}

function checksum(result) {
  return createHash("sha256").update([...result].sort((a, b) => a - b).join(",")).digest("hex");
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(4));
  return {
    samples: values.length,
    mean_ms: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
    p50_ms: percentile(0.50),
    p95_ms: percentile(0.95),
    max_ms: Number(sorted.at(-1).toFixed(4)),
  };
}

const results = [];
for (const [size, shape] of [[3000, "calendar"], [3000, "chain"], [3000, "branching"], [10000, "chain"]]) {
  const { tasks, dependencies } = fixture(size, shape);
  const inputHash = createHash("sha256").update(JSON.stringify({ tasks, dependencies })).digest("hex");
  const runs = variants.map((variant) => ({ ...variant, durations: [], hash: null, count: null, error: null }));
  for (let iteration = -warmup; iteration < samples; iteration += 1) {
    // Alternate execution order to reduce a systematic warm-cache/thermal bias.
    const order = iteration % 2 === 0 ? runs : [...runs].reverse();
    for (const run of order) {
      if (run.error) continue;
      try {
        const started = performance.now();
        const result = run.solve(tasks, dependencies);
        const elapsed = performance.now() - started;
        if (!(result instanceof Set)) throw new Error("criticalPath must return a Set");
        const hash = checksum(result);
        if (run.hash !== null && run.hash !== hash) throw new Error("Result changed between identical samples");
        run.hash = hash;
        run.count = result.size;
        if (iteration >= 0) run.durations.push(elapsed);
      } catch (error) {
        run.error = `${error.name}: ${error.message}`;
      }
    }
  }
  if (createHash("sha256").update(JSON.stringify({ tasks, dependencies })).digest("hex") !== inputHash) {
    throw new Error(`${shape} solver mutated its fixture`);
  }
  results.push({
    scenario: shape,
    tasks: tasks.length,
    dependencies: dependencies.length,
    input_sha256: inputHash,
    variants: runs.map((run) => ({
      name: run.name,
      source: run.source,
      critical_tasks: run.count,
      output_sha256: run.hash,
      ...(run.error ? { error: run.error } : stats(run.durations)),
    })),
  });
}

console.log(JSON.stringify({
  measurement: "Node criticalPath function CPU time; excludes browser rendering",
  node: process.version,
  cpu: cpus()[0]?.model,
  warmup,
  samples,
  results,
}, null, 2));
