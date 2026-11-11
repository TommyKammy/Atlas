export type InboxFilter = "unread" | "read" | "all";
export type InboxCursor = { at: string; id: number; entry: "comment" | "event" };

export function inboxFilter(value: unknown): InboxFilter {
  return value === "read" || value === "all" ? value : "unread";
}

export function parseInboxCursor(value: unknown): InboxCursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid inbox cursor");
  let cursor: unknown;
  try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { throw new Error("invalid inbox cursor"); }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) throw new Error("invalid inbox cursor");
  const c = cursor as Record<string, unknown>;
  if (Object.keys(c).some((key) => !["at", "id", "entry"].includes(key)) ||
      typeof c.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.at) || c.at.startsWith("0000") ||
      !Number.isFinite(Date.parse(c.at)) || new Date(c.at).toISOString().slice(0, 10) !== c.at.slice(0, 10) ||
      typeof c.id !== "number" || !Number.isSafeInteger(c.id) || c.id <= 0 ||
      (c.entry !== "comment" && c.entry !== "event")) throw new Error("invalid inbox cursor");
  return { at: c.at, id: c.id, entry: c.entry };
}

export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
