# Timeline dependency rendering

The timeline's critical-path solver uses the complete authorized project graph.
Its inputs and memoization are independent of the viewport. The dependency
drawing cache described here does not change that calculation, date windows,
lane assignment, or dependency authorization.

## Why scrolling previously produced temporary objects

A render-window update rerenders `TimelineView`. Previously the dependency
layer rebuilt every SVG edge, hit target, style object and event closure even
when all dependency coordinates were unchanged. In the 3,000-task / 3,550-edge
fixture this could rebuild 17,750 SVG React elements and 10,650 closures per
layer update. Garbage collection and React work can delay the next frame even
when the actual dependency DOM and Paint work do not change.

The optimization has three boundaries:

- `useTimelineDependencies` keeps hover, leave and delete callbacks stable. The
  delete callback still tracks the current refresh function.
- `TimelineDependencyLayer` and its static SVG subtree use React's default
  shallow memoization. A viewport update does not rebuild unchanged edges;
  moving a draft endpoint does not rebuild the static SVG.
- Each existing edge is memoized by its shape reference, selected state and
  handlers. Hover/focus changes update affected edges. A zoom, date/layout
  change or server refresh that changes the shape array still updates the SVG.

There is no custom comparator, imperative SVG mutation or dependency culling.
DOM order, SVG geometry, pointer hit areas, keyboard focus, delete controls and
the existing `data-*` contracts are preserved. Shape records must remain
immutable; the layout hook creates new records when their inputs change.

## Large scroll jumps and frame timing

The render-window hook coalesces scroll measurements into animation frames.
For a horizontal jump beyond the committed 420px overscan, it uses `flushSync`
inside that frame to commit the new window before its callback returns. This
avoids deferring newly visible bars into a later React render/paint cycle.
Small scrolls, initial measurement and zoom scale changes retain the usual
asynchronous path; synchronous work is not forced on every scroll event.

The hook tracks the last DOM-committed viewport in a layout effect. The most
recent measurement can still be queued for rendering, so it is not sufficient
evidence that the destination is already covered. An urgent jump can therefore
schedule a commit even when a newer pending measurement passes the normal
reuse test. Multiple events are coalesced and checked again at the final scroll
position; cleanup cancels the queued frame.

This does not bypass the browser's wait before an animation frame or guarantee
physical monitor presentation. It limits the extra application-side delay when
the scroll has outrun the mounted window.

## Verification

`tests/browser/timeline-dependencies.spec.ts` uses more than 2,000 dated tasks
to enable the existing render window, scrolls before interacting, then checks
hover/focus/delete, draft movement, creation refresh and zoom geometry updates.
The critical-path and existing timeline interaction suites remain separate
regression checks.
`tests/browser/timeline-windowing.spec.ts` also checks large jumps in both
directions, inspecting destination bars inside the first scroll-frame callback
instead of allowing a locator retry to conceal a delayed commit.

Use `bash tests/run-e2e.sh critical-performance` for a marker-verified fresh
stack with the fixed 3,000-task fixture. Set `BENCH_OUTPUT` for the normal
zoom/scroll JSON result. Set an absolute `BENCH_SCROLL_TRACE` path as well for
the separate scroll-only Chrome trace mode. This runner accepts no existing DB
or retained demo target.

Compare immutable source snapshots with the same browser, viewport, fixture,
warmup and sample counts. Run performance measurements sequentially and full
regressions separately. Record repeated before/after runs, not only the fastest
run. Trace instrumentation adds overhead; do not pool trace and ordinary runs.
The ordinary two-rAF metric includes DOM validation reads and is not a paint
timestamp. Chrome frame-presentation telemetry is also not a physical monitor
measurement. Exclude incomplete frame flows at trace termination rather than
reporting them as completed frames.
