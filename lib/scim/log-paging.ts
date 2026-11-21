export type ScimLogPageState<T> = {
  logs: T[];
  nextCursor: number | null;
  loading: boolean;
  requestId: number;
};

export type ScimLogPageResult<T> = {
  ok: boolean;
  reset: boolean;
  rows: T[];
  nextCursor: number | null;
};

/**
 * Start a new request. The id is monotonically increasing; older in-flight
 * requests must never update loading, rows or the cursor after this point.
 */
export function beginScimLogPage<T>(
  state: ScimLogPageState<T>,
  requestId: number,
): ScimLogPageState<T> {
  if (requestId < state.requestId) return state;
  return { ...state, requestId, loading: true };
}

/**
 * Apply a response only when it belongs to the newest request. A reset replaces
 * the list; an append keeps it. A stale response is a complete no-op so it
 * cannot clear loading or install a cursor from another filter.
 */
export function finishScimLogPage<T>(
  state: ScimLogPageState<T>,
  requestId: number,
  result: ScimLogPageResult<T>,
): ScimLogPageState<T> {
  if (requestId !== state.requestId) return state;
  // A failed reset means the filter has already changed, so the old rows and
  // cursor belong to another list. Drop them so "load more" cannot append the
  // new filter's page to them; refresh starts over. A failed append keeps the
  // current list and cursor so it can be retried.
  if (!result.ok) {
    return result.reset
      ? { ...state, logs: [], nextCursor: null, loading: false }
      : { ...state, loading: false };
  }
  return {
    logs: result.reset ? result.rows : [...state.logs, ...result.rows],
    nextCursor: result.nextCursor,
    loading: false,
    requestId,
  };
}
