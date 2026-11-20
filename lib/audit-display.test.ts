import assert from "node:assert/strict";
import { test } from "node:test";
import { auditTimestampISO, formatAuditTimestamp } from "./audit-display";

test("formatAuditTimestamp prints seconds on one line in JST", () => {
  assert.equal(formatAuditTimestamp("2026-11-20 00:39:53.295262+09"), "2026-11-20 00:39:53");
});

test("formatAuditTimestamp converts another offset to JST", () => {
  assert.equal(formatAuditTimestamp("2026-11-19 15:39:53.295262+00"), "2026-11-20 00:39:53");
  assert.equal(formatAuditTimestamp("2026-11-20T00:39:53+09:00"), "2026-11-20 00:39:53");
});

test("formatAuditTimestamp handles ISO strings and keeps unparseable values", () => {
  assert.equal(formatAuditTimestamp("2026-11-20T00:39:53.000Z"), "2026-11-20 09:39:53");
  assert.equal(formatAuditTimestamp("not-a-date"), "not-a-date");
  assert.equal(formatAuditTimestamp(""), "–");
});

test("auditTimestampISO keeps the exact instant for the time element", () => {
  assert.equal(auditTimestampISO("2026-11-20 00:39:53.295262+09"), "2026-11-19T15:39:53.295Z");
  assert.equal(auditTimestampISO("not-a-date"), "not-a-date");
});
