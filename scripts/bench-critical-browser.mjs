import { spawnSync } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

/**
 * Run via bash tests/run-e2e.sh critical-performance. No DATABASE_URL is used.
 * The existing destructive-test guard proves Docker labels, DB marker, HTTP
 * target and an HTTP/DB session challenge before this script opens a browser.
 * Main-thread durations and two-frame presentation proxies are different metrics.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.E2E_BASE_URL;
const projectId = Number(process.env.BENCH_PROJECT_ID);
const traceFile = process.env.BENCH_SCROLL_TRACE;
if (traceFile && !isAbsolute(traceFile)) throw new Error("BENCH_SCROLL_TRACE must be an absolute output path");
if (traceFile && process.env.BENCH_OUTPUT && resolve(traceFile) === resolve(process.env.BENCH_OUTPUT)) {
  throw new Error("Trace and benchmark summary must use different output paths");
}
if (!base || base !== process.env.ATLAS_E2E_BASE || !Number.isSafeInteger(projectId) || projectId <= 0) {
  throw new Error("Only the explicit guarded fresh-stack target and fixture are accepted");
}
const guard = spawnSync("bash", ["-c", "set -euo pipefail; source scripts/e2e-guard.sh; require_e2e_target"], {
  cwd: root,
  encoding: "utf8",
});
if (guard.error) throw guard.error;
if (guard.status !== 0) throw new Error(guard.stderr.trim() || "Fresh-stack guard failed");
const warmup = 10;
const samples = 50;
const viewport = { width: 1440, height: 900 };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: base, viewport, deviceScaleFactor: 1, timezoneId: "Asia/Tokyo" });
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(3));
  return {
    samples: values.length,
    p50: percentile(0.50),
    p95: percentile(0.95),
    max: Number(sorted.at(-1).toFixed(3)),
  };
}
function metricMap(result) {
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}

try {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "admin@example.com", password: "atlas-dev-2026" },
  });
  if (!login.ok()) throw new Error(`Fixture login failed: ${login.status()}`);
  const navStarted = performance.now();
  const response = await page.goto(`/projects/${projectId}?view=timeline&from=2026-11-10`, { waitUntil: "load" });
  if (!response?.ok()) throw new Error(`Fixture navigation failed: ${response?.status()}`);
  const htmlBytes = (await response.body()).length;
  const timeline = page.locator("[data-timeline]");
  await timeline.waitFor({ state: "visible" });
  await timeline.locator("[data-timeline-bar]").first().waitFor({ state: "visible" });
  const firstBarMs = performance.now() - navStarted;
  // Opening a React menu proves hydration before collecting event timings.
  await page.locator("button[data-timeline-zoom-level]").click();
  await page.locator('[data-timeline-zoom-option="週"]').waitFor({ state: "visible" });
  await page.locator('[data-timeline-zoom-option="週"]').click();
  await page.waitForFunction(() => document.querySelector("[data-timeline]")?.getAttribute("data-timeline-zoom-preset") === "week");
  if (await timeline.getAttribute("data-timeline-critical") !== "true") throw new Error("Critical path must be enabled");
  await page.waitForLoadState("networkidle");
  const navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      transfer_bytes: nav.transferSize,
      encoded_body_bytes: nav.encodedBodySize,
      decoded_body_bytes: nav.decodedBodySize,
      dom_content_loaded_ms: nav.domContentLoadedEventEnd,
      load_ms: nav.loadEventEnd,
    };
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  async function collect(action) {
    const before = metricMap(await cdp.send("Performance.getMetrics"));
    const presented = await action();
    const after = metricMap(await cdp.send("Performance.getMetrics"));
    return {
      frame_presented_ms: typeof presented === "number" ? presented : presented.elapsed_ms,
      main_thread_ms: 1000 * (after.TaskDuration - before.TaskDuration),
      script_ms: 1000 * (after.ScriptDuration - before.ScriptDuration),
      layout_ms: 1000 * (after.LayoutDuration - before.LayoutDuration),
      style_ms: 1000 * (after.RecalcStyleDuration - before.RecalcStyleDuration),
      ...(typeof presented === "number" ? {} : { diagnostic: presented }),
    };
  }
  function summarize(rows) {
    const keys = ["frame_presented_ms", "main_thread_ms", "script_ms", "layout_ms", "style_ms"];
    return Object.fromEntries(keys.map((key) => [key, stats(rows.map((row) => row[key]))]));
  }
  const zoomRows = [];
  for (let i = -warmup; !traceFile && i < samples; i += 1) {
    const target = i % 2 === 0 ? "month" : "week";
    const label = target === "month" ? "月" : "週";
    await page.locator("button[data-timeline-zoom-level]").click();
    await page.locator(`[data-timeline-zoom-option="${label}"]`).waitFor({ state: "visible" });
    const row = await collect(() => page.evaluate(async ({ label, target }) => {
      const option = document.querySelector(`[data-timeline-zoom-option="${label}"]`);
      if (!(option instanceof HTMLButtonElement)) throw new Error("Zoom option missing");
      const started = performance.now();
      option.click();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (document.querySelector("[data-timeline]")?.getAttribute("data-timeline-zoom-preset") !== target) {
        throw new Error("Zoom was not committed before the second animation frame");
      }
      return performance.now() - started;
    }, { label, target }));
    if (i >= 0) zoomRows.push(row);
  }
  // End in week mode with the full DAG loaded; keep the vertical viewport fixed.
  await page.locator("button[data-timeline-zoom-level]").click();
  await page.locator('[data-timeline-zoom-option="週"]').click();
  const traceCategories = "devtools.timeline,blink.user_timing,cc";
  if (traceFile) {
    await mkdir(dirname(traceFile), { recursive: true });
    await cdp.send("Tracing.start", { categories: traceCategories, transferMode: "ReturnAsStream" });
  }
  const scrollRows = [];
  const diagnosticWarmupRows = [];
  for (let i = -warmup; i < samples; i += 1) {
    const action = traceFile ? () => page.evaluate(async (index) => {
      const scroller = document.querySelector(".timeline-scroll");
      if (!(scroller instanceof HTMLElement)) throw new Error("Timeline scroller missing");
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max < 500) throw new Error("Fixture must have a horizontal scroll range");
      const direction = index % 2 === 0 ? 25 : 75;
      const target = max * direction / 100;
      const phase = index < 0 ? "warmup" : "sample";
      const markPrefix = `atlas-critical-scroll:${phase}:${index}:${direction}`;
      const started = performance.now();
      performance.mark(`${markPrefix}:start`);
      scroller.scrollLeft = target;
      const frames = await new Promise((done) => requestAnimationFrame((firstTimestamp) => {
        const firstCallback = performance.now();
        performance.mark(`${markPrefix}:first-raf`);
        requestAnimationFrame((secondTimestamp) => {
          const secondCallback = performance.now();
          performance.mark(`${markPrefix}:end`);
          done({ firstTimestamp, firstCallback, secondTimestamp, secondCallback });
        });
      }));
      if (Math.abs(scroller.scrollLeft - target) > 1) throw new Error("Scroll target was not reached");
      return {
        index,
        phase,
        direction_percent: direction,
        mark_prefix: markPrefix,
        start_ms: started,
        first_raf_timestamp_ms: frames.firstTimestamp,
        first_raf_callback_ms: frames.firstCallback,
        second_raf_timestamp_ms: frames.secondTimestamp,
        second_raf_callback_ms: frames.secondCallback,
        start_to_first_raf_ms: frames.firstCallback - started,
        first_to_second_raf_ms: frames.secondCallback - frames.firstCallback,
        elapsed_ms: frames.secondCallback - started,
      };
    }, i) : () => page.evaluate(async (index) => {
      const scroller = document.querySelector(".timeline-scroll");
      if (!(scroller instanceof HTMLElement)) throw new Error("Timeline scroller missing");
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max < 500) throw new Error("Fixture must have a horizontal scroll range");
      const target = max * (index % 2 === 0 ? 0.25 : 0.75);
      const started = performance.now();
      scroller.scrollLeft = target;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (Math.abs(scroller.scrollLeft - target) > 1) throw new Error("Scroll target was not reached");
      return performance.now() - started;
    }, i);
    const row = await collect(action);
    if (i >= 0) scrollRows.push(row);
    else if (traceFile) diagnosticWarmupRows.push(row);
  }
  if (traceFile) {
    const complete = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
    await cdp.send("Tracing.end");
    const { stream } = await complete;
    if (!stream) throw new Error("Chrome trace did not provide its output stream");
    const destination = await open(traceFile, "w");
    try {
      for (;;) {
        const chunk = await cdp.send("IO.read", { handle: stream, size: 1_048_576 });
        await destination.write(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
        if (chunk.eof) break;
      }
    } finally {
      await destination.close();
      await cdp.send("IO.close", { handle: stream });
    }
  }
  if (failures.length > 0) throw new Error(`Browser errors: ${failures.join("; ")}`);
  const output = {
    measurement: {
      frame_presented_ms: traceFile
        ? "Diagnostic event to second rAF callback entry; excludes subsequent validation reads; not a paint timestamp"
        : "In-page event through two rAF callbacks and scroll/zoom validation reads; reads may force layout; not an observed paint timestamp",
      main_thread_ms: "CDP Performance TaskDuration delta around one action, excludes host/driver wall time",
      script_ms: "CDP ScriptDuration delta",
      layout_ms: "CDP LayoutDuration delta",
      style_ms: "CDP RecalcStyleDuration delta",
      caution: "Not directly comparable to earlier benchmarks with different event/timing definitions",
    },
    fixture: { tasks: 3000, sections: 10, dependencies: 3550, origin: "2026-11-10", critical: true },
    browser: browser.version(),
    node: process.version,
    viewport,
    device_scale_factor: 1,
    warmup,
    samples,
    first_bar_ms: Number(firstBarMs.toFixed(3)),
    initial_html_bytes: htmlBytes,
    navigation,
    rendered_bars: await timeline.locator("[data-timeline-bar]").count(),
    ...(traceFile ? {
      diagnostic: {
        mode: "horizontal-scroll trace only; zoom sampling omitted",
        overhead: "Tracing and performance marks add measurement overhead; do not pool with ordinary benchmark runs",
        trace_path: traceFile,
        trace_categories: traceCategories,
        frame_timestamps: "rAF callback argument is the frame timestamp; callback_ms uses performance.now() at callback entry",
      },
    } : { zoom_week_month: summarize(zoomRows) }),
    horizontal_scroll_25_75_percent: summarize(scrollRows),
    raw: { zoom: zoomRows, horizontal_scroll: scrollRows, ...(traceFile ? { diagnostic_warmup: diagnosticWarmupRows } : {}) },
  };
  if (process.env.BENCH_OUTPUT) {
    await mkdir(dirname(resolve(process.env.BENCH_OUTPUT)), { recursive: true });
    await writeFile(process.env.BENCH_OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ...output, raw: undefined }, null, 2));
  await cdp.detach();
} finally {
  await context.close();
  await browser.close();
}
