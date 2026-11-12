export const SIDEBAR_WIDTH_COOKIE = "atlas_sidebar_width";
export const SIDEBAR_DEFAULT_WIDTH = 244;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_CONTENT_MIN_WIDTH = 480;

export function sidebarMaxWidth(viewportWidth: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - SIDEBAR_CONTENT_MIN_WIDTH));
}

export function clampSidebarWidth(width: number, maxWidth = SIDEBAR_MAX_WIDTH): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, Math.round(width)));
}

/** Treat the browser preference as untrusted input, including legacy cookies. */
export function parseSidebarWidth(value: string | undefined): number {
  if (!value || !/^\d{1,3}$/.test(value)) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(Number(value));
}
