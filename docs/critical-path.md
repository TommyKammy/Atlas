# Timeline critical paths

The solver follows the public [Asana critical-path rules](https://help.asana.com/s/article/critical-path-on-timeline): task duration and calendar gaps contribute to a path, paths must reach the latest project due date, a due date is required but a start date is optional, subtasks are excluded, and a cyclic graph has no highlighted critical path.

## Calculation and boundaries

- Input is the complete, authorized, undeleted top-level project task graph, including secondary project memberships and completed tasks. Subtasks and unavailable dependency endpoints are excluded by the project data boundary. The solver never fetches tasks from another project.
- Only strict `YYYY-MM-DD` due dates are eligible. Ordinary tasks use the due date when their start is absent; invalid or reversed ordinary dates are excluded. Calendar arithmetic uses UTC day numbers, including weekends and leap days.
- Ordinary tasks occupy inclusive calendar dates: `finish = due + 1`, `duration = finish - start`. The gap on a dependency is `max(0, successor.start - predecessor.finish)`.
- Compare accumulated durations and gaps for paths ending on the latest eligible due date. Highlight the union of every equally longest path, including ties between independent endpoints. Input order and task IDs do not break ties.
- A cycle anywhere in the eligible dated project graph suppresses all critical highlighting. Duplicate dependencies have no extra weight. Edges with unavailable or undated endpoints are ignored.

The following are explicit Atlas conventions where the public Asana article does not describe an internal implementation:

- A milestone is a zero-duration event at the end of its due date (`start = finish = due + 1`). A leftover start date from conversion is ignored. A task ending on that date followed by the milestone does not gain an artificial day.
- Overlapping or backward scheduled dependencies contribute zero waiting time, while each task's duration still contributes. The visualization does not reschedule conflicting dates or calculate resource capacity.
- All equally longest paths are highlighted. A milestone-only project can therefore highlight multiple zero-duration endpoints.
- Completed tasks remain part of the historical project schedule. Their existing completed appearance is preserved, even when their IDs belong to the calculated set.

This is calendar-path highlighting, not a resource-constrained schedule or a full early/late-date and total-float scheduling engine. Atlas does not copy Asana's documented 2,000-task display limit.

## Rendering and performance

`TimelineView` memoizes the solver using only the complete task payload, dependency payload and critical-path display toggle. Assignee/status/completion filters, zoom, date windows, sorting and horizontal scrolling affect rendering only. Hiding an earlier task cannot change whether a remaining task is critical.

The solver uses nonrecursive topological traversal and tied-predecessor backtracking, with `O(V + E)` time and space. Date parsing is cached per calculation. The existing timeline render window remains in use; the full project graph does not become full-DOM rendering. Critical milestones retain Atlas's green diamond with an additional red outline, and the bar's accessible description identifies critical status.

## Regression coverage

- `lib/critical-path.test.ts`: calendar gaps, latest due date, equal branches/endpoints, due-only tasks, invalid dates, leap/year boundaries, milestones, cycles, external endpoints, duplicate edges, a 12,000-task chain and an independent exhaustive small-DAG reference.
- `tests/browser/critical-path.spec.ts`: date windows and zoom, assignee/completed filters, all tied paths, milestone indication and display toggle.
- `scripts/bench-critical-path.mjs`: pure before/after CPU measurements with identical explicit source snapshots. Browser performance runs use the guarded disposable runner; CPU timings and frame-presentation latency are reported separately.

Run the browser comparison with `bash tests/run-e2e.sh critical-performance`.
Every invocation creates and removes its own marker-verified stack and fixed
3,000-task fixture. `BENCH_OUTPUT` selects the JSON artifact. For a separate
scroll-only Chrome trace, also set `BENCH_SCROLL_TRACE` to an absolute path.
Trace runs include instrumentation overhead and must not be pooled with normal
runs. The ordinary two-rAF metric includes validation reads that may flush
layout; it is not a measured paint or physical display timestamp. CDP
`TaskDuration` measures main-thread task duration, not OS thread CPU time.
