import type { InboxItem } from "./notification-feed";

/**
 * The feed's unread rule: an item is unread when it has no read marker and the
 * viewer did not write it. Kept next to the feed type so the row's dot, the
 * filter counts and the SQL stay on the same definition.
 */
export function isInboxItemUnread(
  item: Pick<InboxItem, "is_read" | "author_id">,
  viewerId: number | null,
): boolean {
  if (item.is_read) return false;
  if (viewerId === null) return true;
  return item.author_id === null || item.author_id !== viewerId;
}
