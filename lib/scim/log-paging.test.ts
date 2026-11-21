import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginScimLogPage,
  finishScimLogPage,
  type ScimLogPageResult,
  type ScimLogPageState,
} from "./log-paging";

type Row = { id: number };

const empty: ScimLogPageState<Row> = {
  logs: [],
  nextCursor: null,
  loading: false,
  requestId: 0,
};

function result(overrides: Partial<ScimLogPageResult<Row>> = {}): ScimLogPageResult<Row> {
  return { ok: true, reset: false, rows: [], nextCursor: null, ...overrides };
}

test("a stale append cannot leak into a newer reset or clear its loading state", () => {
  const appending = finishScimLogPage(beginScimLogPage(empty, 1), 1,
    result({ reset: true, rows: [{ id: 1 }, { id: 2 }], nextCursor: 2 }));
  assert.deepEqual(appending.logs.map((row) => row.id), [1, 2]);
  assert.equal(appending.nextCursor, 2);

  const appended = beginScimLogPage(appending, 2);
  const resetStarted = beginScimLogPage(appended, 3);

  const lateAppend = finishScimLogPage(resetStarted, 2,
    result({ rows: [{ id: 3 }], nextCursor: 3 }));
  assert.deepEqual(lateAppend.logs, resetStarted.logs);
  assert.equal(lateAppend.nextCursor, resetStarted.nextCursor);
  assert.equal(lateAppend.loading, true);

  const resetFinished = finishScimLogPage(lateAppend, 3,
    result({ reset: true, rows: [{ id: 10 }], nextCursor: 10 }));
  assert.deepEqual(resetFinished.logs.map((row) => row.id), [10]);
  assert.equal(resetFinished.nextCursor, 10);
  assert.equal(resetFinished.loading, false);
});

test("append pages merge in order and only the newest request owns the cursor", () => {
  const first = finishScimLogPage(beginScimLogPage(empty, 1), 1,
    result({ reset: true, rows: [{ id: 4 }, { id: 3 }], nextCursor: 3 }));
  const second = finishScimLogPage(beginScimLogPage(first, 2), 2,
    result({ rows: [{ id: 2 }, { id: 1 }], nextCursor: 1 }));
  assert.deepEqual(second.logs.map((row) => row.id), [4, 3, 2, 1]);
  assert.equal(second.nextCursor, 1);
});

test("a latest failure stops loading without replacing rows or the cursor", () => {
  const first = finishScimLogPage(beginScimLogPage(empty, 1), 1,
    result({ reset: true, rows: [{ id: 2 }], nextCursor: 2 }));
  const failed = finishScimLogPage(beginScimLogPage(first, 2), 2,
    result({ rows: [{ id: 99 }], nextCursor: 99, ok: false }));
  assert.deepEqual(failed.logs.map((row) => row.id), [2]);
  assert.equal(failed.nextCursor, 2);
  assert.equal(failed.loading, false);
});

test("a failed reset drops the previous filter's rows and cursor", () => {
  const all = finishScimLogPage(beginScimLogPage(empty, 1), 1,
    result({ reset: true, rows: [{ id: 9 }, { id: 8 }], nextCursor: 8 }));
  // The failures-only toggle starts a reset that fails.
  const failedReset = finishScimLogPage(beginScimLogPage(all, 2), 2,
    result({ reset: true, ok: false }));
  assert.deepEqual(failedReset.logs, []);
  assert.equal(failedReset.nextCursor, null);
  assert.equal(failedReset.loading, false);
  // With no cursor, "load more" cannot append the new filter to the old list;
  // the next successful reset rebuilds it.
  const retried = finishScimLogPage(beginScimLogPage(failedReset, 3), 3,
    result({ reset: true, rows: [{ id: 7 }], nextCursor: null }));
  assert.deepEqual(retried.logs.map((row) => row.id), [7]);
});

test("an old request id cannot take ownership of newer state", () => {
  const current = finishScimLogPage(beginScimLogPage(empty, 2), 2,
    result({ reset: true, rows: [{ id: 5 }], nextCursor: null }));
  const staleStart = beginScimLogPage(current, 1);
  assert.deepEqual(staleStart, current);
});
