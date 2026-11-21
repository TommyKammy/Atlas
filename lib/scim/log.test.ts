import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCIM_DETAIL_MAX_LENGTH,
  SCIM_FILTER_MAX_LENGTH,
  redactScimSecrets,
  runScimLogWrite,
  scimCreatedUserId,
  scimFilterFromUrl,
  scimIdpLabel,
  scimLogRecord,
  scimOperationLabel,
  scimPathOnly,
  scimTargetUserId,
  shouldRecordScimRequest,
} from "./log";

test("operation labels describe SCIM create, update, deactivate and search", () => {
  assert.equal(scimOperationLabel("POST", "/scim/v2/Users"), "ユーザー作成");
  assert.equal(scimOperationLabel("PATCH", "/scim/v2/Users/12"), "ユーザー更新");
  assert.equal(scimOperationLabel("PUT", "/scim/v2/Users/12/"), "ユーザー更新");
  assert.equal(scimOperationLabel("DELETE", "/scim/v2/Users/12"), "ユーザー無効化");
  assert.equal(scimOperationLabel("GET", "/scim/v2/Users"), "ユーザー一覧");
  assert.equal(scimOperationLabel("GET", "/scim/v2/Users", 'userName eq "a@example.com"'), "ユーザー検索");
  assert.equal(scimOperationLabel("GET", "/scim/v2/Users/12"), "ユーザー取得");
  assert.equal(scimOperationLabel("GET", "/scim/v2/ServiceProviderConfig"), "対応機能の確認");
  assert.equal(scimOperationLabel("GET", "/scim/v2/Schemas"), "スキーマの確認");
  assert.equal(scimOperationLabel("POST", "/scim/v2/unknown"), "POST 要求");
});

test("paths keep no query string and target ids come from paths or Location", () => {
  assert.equal(scimPathOnly("/scim/v2/Users?filter=userName%20eq%20%22a%22"), "/scim/v2/Users");
  assert.equal(scimPathOnly("https://atlas.example/scim/v2/Users/7?count=0"), "/scim/v2/Users/7");
  assert.equal(scimFilterFromUrl("/scim/v2/Users?filter=userName%20eq%20%22a%22"), 'userName eq "a"');
  assert.equal(scimFilterFromUrl("/scim/v2/Users"), null);
  assert.equal(scimTargetUserId("/scim/v2/Users/42"), 42);
  assert.equal(scimTargetUserId("/scim/v2/Users/0"), null);
  assert.equal(scimTargetUserId("/scim/v2/Users/not-a-number"), null);
  assert.equal(scimCreatedUserId("https://atlas.example/scim/v2/Users/42"), 42);
  assert.equal(scimCreatedUserId(null), null);
  assert.equal(scimIdpLabel("entra"), "Entra ID");
  assert.equal(scimIdpLabel("okta"), "Okta");
  assert.equal(scimIdpLabel("generic"), "汎用");
  assert.equal(scimIdpLabel(null), "–");
});

test("log filters and details are truncated to the documented limits", () => {
  const filter = "f".repeat(SCIM_FILTER_MAX_LENGTH + 40);
  const detail = "d".repeat(SCIM_DETAIL_MAX_LENGTH + 80);
  const record = scimLogRecord({
    method: "get",
    path: "/scim/v2/Users",
    filter,
    status: 400,
    scimType: "invalidFilter",
    detail,
  });
  assert.equal(record.method, "GET");
  assert.equal(record.filter?.length, SCIM_FILTER_MAX_LENGTH);
  assert.equal(record.detail?.length, SCIM_DETAIL_MAX_LENGTH);
  assert.equal(record.status, 400);
  assert.equal(record.scim_type, "invalidFilter");
});

test("filters are redacted as well as details", () => {
  const secret = `atlas_scim_${"c".repeat(43)}`;
  const record = scimLogRecord({
    method: "GET",
    path: "/scim/v2/Users",
    filter: `userName eq "${secret}"`,
    status: 200,
  });
  assert.equal(record.filter?.includes(secret), false);
  assert.equal(record.filter?.includes("atlas_scim_[redacted]"), true);
});

test("429 responses are not recorded but 401 responses are", () => {
  assert.equal(shouldRecordScimRequest(429), false);
  assert.equal(shouldRecordScimRequest(401), true);
  assert.equal(shouldRecordScimRequest(200), true);
  assert.equal(shouldRecordScimRequest(503), true);
});

test("a failed log write is swallowed so it cannot fail a SCIM response", async () => {
  let captured: unknown = null;
  await assert.doesNotReject(runScimLogWrite(
    async () => {
      throw new Error("database is down");
    },
    (error) => {
      captured = error;
    },
  ));
  assert.equal(captured instanceof Error, true);
  assert.equal((captured as Error).message, "database is down");
});

test("log records never carry Authorization or token values", () => {
  const secret = `atlas_scim_${"a".repeat(43)}`;
  const input = {
    method: "POST",
    path: `/scim/v2/Users?access_token=${secret}`,
    filter: null,
    status: 401,
    detail: `rejected Bearer ${secret}`,
    authorization: `Bearer ${secret}`,
    userId: null,
  };
  const record = scimLogRecord(input as Parameters<typeof scimLogRecord>[0]);
  assert.equal("authorization" in record, false);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("Bearer atlas_scim_"), false);
  assert.equal(record.path, "/scim/v2/Users");
  assert.equal(record.detail?.includes("[redacted]"), true);
  assert.equal(redactScimSecrets("ok"), "ok");
});

test("redaction leaves ordinary bearer-token wording and only masks token-like values", () => {
  assert.equal(
    redactScimSecrets("invalid or expired bearer token"),
    "invalid or expired bearer token",
  );
  assert.equal(
    redactScimSecrets("Invalid or expired Bearer token"),
    "Invalid or expired Bearer token",
  );
  const atlas = `atlas_scim_${"b".repeat(43)}`;
  assert.equal(redactScimSecrets(`rejected Bearer ${atlas}`), "rejected Bearer [redacted]");
  assert.equal(redactScimSecrets(atlas), "atlas_scim_[redacted]");
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
  assert.equal(redactScimSecrets(`Authorization: Bearer ${jwt}`), "Authorization: Bearer [redacted]");
  assert.equal(redactScimSecrets("Bearer short"), "Bearer short");
});

test("log records ignore invalid user ids and keep optional fields null", () => {
  const record = scimLogRecord({
    method: "GET",
    path: "/scim/v2/Users",
    status: 200,
    userId: -1,
  });
  assert.equal(record.user_id, null);
  assert.equal(record.detail, null);
  assert.equal(record.scim_type, null);
  assert.equal(record.filter, null);
});
