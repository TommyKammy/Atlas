import assert from "node:assert/strict";
import { test } from "node:test";
import { isInboxItemUnread } from "./inbox-display";

test("isInboxItemUnread follows the feed rule: read marker or own post is not unread", () => {
  assert.equal(isInboxItemUnread({ is_read: false, author_id: 2 }, 1), true);
  assert.equal(isInboxItemUnread({ is_read: true, author_id: 2 }, 1), false);
  assert.equal(isInboxItemUnread({ is_read: false, author_id: 1 }, 1), false);
  assert.equal(isInboxItemUnread({ is_read: false, author_id: null }, 1), true);
});
