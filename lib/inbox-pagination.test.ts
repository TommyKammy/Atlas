import assert from "node:assert/strict";
import test from "node:test";
import { encodeInboxCursor, inboxFilter, parseInboxCursor } from "./inbox-pagination";

test("inbox cursor preserves microseconds and entry identity", () => {
  for (const entry of ["comment", "event"] as const) {
    const value = { at: "2026-11-11T01:02:03.123456Z", id: 42, entry };
    assert.deepEqual(parseInboxCursor(encodeInboxCursor(value)), value);
  }
  assert.equal(parseInboxCursor(undefined), null);
  assert.equal(parseInboxCursor(""), null);
  assert.equal(inboxFilter("all"), "all");
  assert.equal(inboxFilter("read"), "read");
  assert.equal(inboxFilter("anything"), "unread");
});

test("inbox cursor rejects malformed, impossible and unsafe inputs", () => {
  const good = { at: "2026-11-11T01:02:03.123456Z", id: 42, entry: "comment" };
  for (const value of [null, [], {}, { ...good, extra: true }, { ...good, id: 0 },
    { ...good, id: Number.MAX_SAFE_INTEGER + 1 }, { ...good, entry: "task" },
    { ...good, at: "2026-02-30T01:02:03.123456Z" }, { ...good, at: "0000-11-11T01:02:03.123456Z" },
    { ...good, at: "2026-11-11T25:02:03.123456Z" }, { ...good, at: "2026-11-11" }]) {
    assert.throws(() => parseInboxCursor(Buffer.from(JSON.stringify(value)).toString("base64url")));
  }
  for (const value of ["!", "a".repeat(513), 1]) assert.throws(() => parseInboxCursor(value));
});
