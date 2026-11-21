import assert from "node:assert/strict";
import { test } from "node:test";
import { ScimApiError } from "./errors";
import { parseUserFilter } from "./filter";

function rejectsInvalid(raw: string) {
  assert.throws(() => parseUserFilter(raw), (error) => {
    assert.ok(error instanceof ScimApiError);
    assert.equal(error.status, 400);
    assert.equal(error.scimType, "invalidFilter");
    return true;
  });
}

test("parses the supported userName, externalId, id and email filters", () => {
  assert.deepEqual(parseUserFilter('userName eq "Alice@Example.com"'),
    { field: "userName", value: "Alice@Example.com" });
  assert.deepEqual(parseUserFilter('externalId eq "entra-42"'), { field: "externalId", value: "entra-42" });
  assert.deepEqual(parseUserFilter('id eq "17"'), { field: "id", value: "17" });
  assert.deepEqual(parseUserFilter('emails.value eq "alice@example.com"'),
    { field: "email", value: "alice@example.com" });
});

test("attribute names and operators are case-insensitive", () => {
  assert.deepEqual(parseUserFilter('USERNAME EQ "alice@example.com"'),
    { field: "userName", value: "alice@example.com" });
  assert.deepEqual(parseUserFilter('Emails[Type EQ "WORK"].Value Eq "alice@example.com"'),
    { field: "email", value: "alice@example.com" });
});

test("work email path tolerates spaces and escaped quotes", () => {
  assert.deepEqual(parseUserFilter('emails[ type eq "work" ].value eq "a\\"b@example.com"'),
    { field: "email", value: 'a"b@example.com' });
});

test("an absent filter is null but an empty filter is rejected", () => {
  assert.equal(parseUserFilter(null), null);
  assert.equal(parseUserFilter(undefined), null);
  rejectsInvalid("");
  rejectsInvalid("   ");
});

test("unsupported operators, attributes and shapes are invalidFilter", () => {
  for (const raw of [
    'userName ne "a@example.com"',
    'userName co "a"',
    'displayName eq "Alice"',
    'emails[type eq "home"].value eq "a@example.com"',
    'userName eq "a@example.com" and active eq true',
    'userName eq a@example.com',
    'userName eq "unterminated',
    "userName",
    '(userName eq "a@example.com")',
  ]) {
    rejectsInvalid(raw);
  }
});
