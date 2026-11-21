type HeaderReader = { get(name: string): string | null };

/**
 * True when Next's client router is only prefetching a route (link entering the
 * viewport, hover, router.prefetch) rather than navigating to it. Pages run
 * their server code for prefetches too, so writes that mean "the user opened
 * this" must skip these requests.
 *
 * Header values follow next/dist/server/route-modules/app-page/parse-request-headers:
 * `next-router-prefetch` 1 = static prefetch, 2 = runtime prefetch,
 * 3 = app-shell prefetch; `next-router-segment-prefetch` marks segment-cache
 * prefetches such as the `/_tree` route-tree request. Real navigations send
 * `rsc: 1` without either header, and full page loads send neither.
 */
export function isRouterPrefetch(headers: HeaderReader) {
  if (headers.get("rsc") !== "1") return false;
  return Boolean(headers.get("next-router-prefetch") || headers.get("next-router-segment-prefetch"));
}
