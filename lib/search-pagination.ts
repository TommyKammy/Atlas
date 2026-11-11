export const SEARCH_QUERY_LIMIT = 200;
export const SEARCH_PAGE_KEYS = ["tasks_page", "projects_page", "messages_page", "knowledge_page", "files_page"] as const;
export type SearchPageKey = (typeof SEARCH_PAGE_KEYS)[number];
export type SearchPageRequest = { page: number; pageSize: number };
export type SearchPage<T> = SearchPageRequest & { items: T[]; total: number; pageCount: number };
export type SearchParams = Record<string, string | string[] | undefined>;

/** Reject malformed/unsafe input rather than letting it reach SQL OFFSET arithmetic. */
export function parseSearchPage(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) return 1;
  const page = Number(value);
  return page <= 2_147_483_647 ? page : 1;
}

export function searchPageRequest(page: number, pageSize: number): SearchPageRequest {
  return {
    page: Number.isInteger(page) && page > 0 && page <= 2_147_483_647 ? page : 1,
    pageSize: Number.isInteger(pageSize) ? Math.min(100, Math.max(1, pageSize)) : 100,
  };
}

export function emptySearchPage<T>(pageSize: number): SearchPage<T> {
  return { items: [], total: 0, page: 1, pageSize, pageCount: 1 };
}

/** Keep every filter and other result section's position when paging one section. */
export function searchPageHref(params: SearchParams, key: SearchPageKey, page: number): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === key || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => query.append(name, item));
    else query.set(name, value);
  }
  if (page > 1) query.set(key, String(page));
  return `/search?${query.toString()}#search-${key.replace("_page", "")}`;
}

/** Saved searches represent criteria, not an incidental position in old results. */
export function searchCriteria(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !SEARCH_PAGE_KEYS.includes(key as SearchPageKey)));
}

export function searchDateParam(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
