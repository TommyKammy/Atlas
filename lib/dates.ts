/**
 * Calendar date (YYYY-MM-DD) in the app timezone (Asia/Tokyo).
 * Explicit so server, browser, and CI always agree around the JST boundary.
 */
const JST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayISO(now = new Date()): string {
  return JST_DATE.format(now);
}
