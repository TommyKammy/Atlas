/**
 * Audit rows arrive from Postgres as `timestamp::text`
 * ("2026-11-20 00:39:53.295262+09"). The screen shows seconds only, in the
 * app's Asia/Tokyo timezone, so the timestamp stays on one line. The raw value
 * is kept by the caller in the element's title for the full precision.
 */
const JST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function parseTimestamp(value: string): Date | null {
  const match = TIMESTAMP.exec(value.trim());
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, date, time, fraction, offset] = match;
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : "";
  let zone = "+09:00";
  if (offset === "Z") zone = "Z";
  else if (offset) {
    const minutes = offset.slice(3).replace(":", "") || "00";
    zone = `${offset.slice(0, 3)}:${minutes}`;
  }
  const parsed = new Date(`${date}T${time}${millis}${zone}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "2026-11-20 00:39:53" in JST, or the original value when it cannot parse. */
export function formatAuditTimestamp(value: string): string {
  if (value.trim() === "") return "–";
  const date = parseTimestamp(value);
  if (!date) return value;
  const parts = Object.fromEntries(JST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Machine-readable value for <time dateTime>, keeping the exact instant. */
export function auditTimestampISO(value: string): string {
  const date = parseTimestamp(value);
  return date ? date.toISOString() : value;
}

/**
 * SCIM writes have no human actor (actor_id is NULL). Make those entries
 * identifiable instead of showing an empty "–" in the audit table.
 */
export function auditActorLabel(actorName: string | null | undefined, action: string): string {
  const name = actorName?.trim();
  if (name) return name;
  return action.startsWith("scim.") ? "SCIM" : "–";
}

/** CSV export keeps the historical blank cell for non-SCIM system rows. */
export function auditActorCsvLabel(actorName: string | null | undefined, action: string): string {
  const name = actorName?.trim();
  if (name) return name;
  return action.startsWith("scim.") ? "SCIM" : "";
}
