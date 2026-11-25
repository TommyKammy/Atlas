import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTaskKey, normalizeDevPrefix, parseTaskKey, taskBranchName } from "./dev-project-keys";

test("normalizeDevPrefix upper-cases and accepts 2–10 letters or digits starting with a letter", () => {
  assert.equal(normalizeDevPrefix(" atl "), "ATL");
  assert.equal(normalizeDevPrefix("A1"), "A1");
  assert.equal(normalizeDevPrefix("ABCDEFGHIJ"), "ABCDEFGHIJ");
  for (const bad of ["A", "1AB", "ABCDEFGHIJK", "AT-L", "ＡＴＬ", "", null, 12]) {
    assert.equal(normalizeDevPrefix(bad), null, String(bad));
  }
});

test("parseTaskKey accepts any letter case and rejects malformed keys", () => {
  assert.deepEqual(parseTaskKey("ATL-123"), { prefix: "ATL", number: 123 });
  assert.deepEqual(parseTaskKey(" atl-7 "), { prefix: "ATL", number: 7 });
  for (const bad of ["ATL-0", "ATL-01", "ATL123", "A-1", "ATL-1234567890", "1TL-1", "ATL-1x", 123, null]) {
    assert.equal(parseTaskKey(bad), null, String(bad));
  }
});

test("display keys follow the current prefix while branch names keep the original one", () => {
  assert.equal(formatTaskKey("CORE", 123), "CORE-123");
  assert.equal(taskBranchName("atl", 123), "atl-123");
});
