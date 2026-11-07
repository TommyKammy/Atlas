export const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > 2048) return false;
  if (href.startsWith("#") || href.startsWith("/")) return true;
  try {
    const url = new URL(href);
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}
