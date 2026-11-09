import { assignTimelineLanes, type TimelineLaneInterval } from "../lib/timeline-lanes";

/**
 * Synthetic 1,000-task timeline benchmark. Run with:
 *   npm run bench:timeline
 *
 * The suite is intentionally allocation-heavy so lane assignment regressions
 * show up before real projects grow into the thousands.
 */
const TASKS = Number(process.env.BENCH_TASKS ?? 1000);
const SECTIONS = Number(process.env.BENCH_SECTIONS ?? 10);

function fixtures(): TimelineLaneInterval[][] {
  const perSection = Math.ceil(TASKS / SECTIONS);
  const sections: TimelineLaneInterval[][] = [];
  let id = 1;
  for (let s = 0; s < SECTIONS; s += 1) {
    const items: TimelineLaneInterval[] = [];
    for (let i = 0; i < perSection && id <= TASKS; i += 1) {
      const start = i * 2 + (s % 3);
      const duration = i % 11 === 0 ? 3 : i % 5 === 0 ? 7 : 1;
      items.push({
        id,
        start,
        end: start + duration,
        pinnedRow: i % 37 === 0 ? (i / 37) % 6 : null,
        visualEnd: i % 4 === 0 ? start + duration + 4 : undefined,
      });
      id += 1;
    }
    sections.push(items);
  }
  return sections;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

const sections = fixtures();
const durations: number[] = [];
let lanes = 0;
let overlaps = 0;
for (const items of sections) {
  const started = performance.now();
  const result = assignTimelineLanes(items);
  durations.push(performance.now() - started);
  lanes += result.laneCount;
  overlaps += result.overlappingIds.size;
}

const total = durations.reduce((sum, value) => sum + value, 0);

const overlapItems: TimelineLaneInterval[] = Array.from({ length: TASKS }, (_, index) => ({
  id: index + 1,
  start: 0,
  end: 10,
}));
const overlapStarted = performance.now();
const overlapResult = assignTimelineLanes(overlapItems);
const overlapMs = performance.now() - overlapStarted;

console.log(
  JSON.stringify(
    {
      tasks: TASKS,
      sections: sections.length,
      runs: durations.length,
      total_ms: Number(total.toFixed(2)),
      mean_ms: Number((total / durations.length).toFixed(2)),
      p95_ms: Number(percentile(durations, 0.95).toFixed(2)),
      max_ms: Number(Math.max(...durations).toFixed(2)),
      lanes,
      overlapping_ids: overlaps,
      worst_case: {
        scenario: "all tasks overlap",
        ms: Number(overlapMs.toFixed(2)),
        lanes: overlapResult.laneCount,
      },
    },
    null,
    2,
  ),
);
