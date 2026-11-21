import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCIM_CONTENT_TYPE, SCIM_ERROR_SCHEMA, ScimApiError, invalidFilter, scimErrorResponse, scimJsonResponse,
} from "./errors";

test("SCIM errors use the message envelope and a string status", async () => {
  const response = scimErrorResponse(invalidFilter("unsupported filter"));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("content-type"), SCIM_CONTENT_TYPE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    schemas: [SCIM_ERROR_SCHEMA],
    status: "400",
    scimType: "invalidFilter",
    detail: "unsupported filter",
  });
});

test("errors without a scimType omit it and keep extra headers", async () => {
  const response = scimErrorResponse(new ScimApiError(401, "invalid token", undefined, {
    "WWW-Authenticate": "Bearer",
  }));
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, "401");
  assert.equal("scimType" in body, false);
});

test("SCIM resources use application/scim+json", () => {
  const response = scimJsonResponse({ schemas: [] }, { status: 201 });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), SCIM_CONTENT_TYPE);
});
