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

/** Asana-style compact date range used by list/board rows. */
export function dueSegs(start: string | null, due: string | null): [string, string | null] {
  const curY = new Date().getFullYear();
  const p = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return { y, m, d: dd };
  };
  const one = (d: string) => {
    const { y, m, d: dd } = p(d);
    return `${y === curY ? "" : `${y}年`}${m}月${dd}日`;
  };
  if (start && due && start !== due) {
    const a = p(start);
    const b = p(due);
    if (a.y === b.y && a.m === b.m) return [`${a.m}月${a.d}日`, `${b.d}日`];
    if (a.y === b.y) return [`${a.m}月${a.d}日`, `${b.m}月${b.d}日`];
    return [`${a.y}年${a.m}月${a.d}日`, `${b.y}年${b.m}月${b.d}日`];
  }
  const d = due ?? start;
  return d ? [one(d), null] : ["", null];
}
