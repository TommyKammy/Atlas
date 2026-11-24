import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as authorizationServerGet } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceBaseGet } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as protectedResourceGet } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { GET as readonlyProtectedResourceGet } from "@/app/.well-known/oauth-protected-resource/mcp/readonly/route";
import {
  authorizationServerMetadata,
  authorizationServerMetadataResponse,
  METADATA_CACHE_CONTROL,
  protectedResourceMetadata,
  protectedResourceMetadataResponse,
} from "./metadata";

process.env.APP_URL = "https://atlas.test";

function request(path: string): Request {
  return new Request(`https://atlas.test${path}`);
}

test("the default protected-resource metadata describes /mcp and the issuer", () => {
  assert.deepEqual(protectedResourceMetadata("https://atlas.example/", "default"), {
    resource: "https://atlas.example/mcp",
    authorization_servers: ["https://atlas.example"],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "Atlas",
  });
});

test("the readonly protected-resource metadata advertises only read", () => {
  assert.deepEqual(protectedResourceMetadata("https://atlas.example", "readonly"), {
    resource: "https://atlas.example/mcp/readonly",
    authorization_servers: ["https://atlas.example"],
    scopes_supported: ["read"],
    bearer_methods_supported: ["header"],
    resource_name: "Atlas",
  });
});

test("the authorization-server metadata lists every Atlas OAuth endpoint", () => {
  assert.deepEqual(authorizationServerMetadata("https://atlas.example/"), {
    issuer: "https://atlas.example",
    authorization_endpoint: "https://atlas.example/oauth/authorize",
    token_endpoint: "https://atlas.example/oauth/token",
    registration_endpoint: "https://atlas.example/oauth/register",
    revocation_endpoint: "https://atlas.example/oauth/revoke",
    client_id_metadata_document_supported: true,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
    authorization_response_iss_parameter_supported: true,
  });
});

test("metadata responses carry JSON, a 5 minute cache and permissive CORS", async () => {
  for (const response of [
    protectedResourceMetadataResponse(request("/mcp"), "default", { APP_URL: "https://atlas.test/" }),
    authorizationServerMetadataResponse(
      request("/.well-known/oauth-authorization-server"),
      { APP_URL: "https://atlas.test/" },
    ),
  ]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(response.headers.get("cache-control"), METADATA_CACHE_CONTROL);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  }
});

test("routes serve both path-inserted documents and the unprefixed /mcp document", async () => {
  const base = await protectedResourceBaseGet(request("/.well-known/oauth-protected-resource"))
    .json() as { resource: string; scopes_supported: string[] };
  assert.equal(base.resource, "https://atlas.test/mcp");
  assert.deepEqual(base.scopes_supported, ["read", "write"]);

  const mcp = await protectedResourceGet(request("/.well-known/oauth-protected-resource/mcp"))
    .json() as { resource: string };
  assert.equal(mcp.resource, "https://atlas.test/mcp");

  const readonly = await readonlyProtectedResourceGet(
    request("/.well-known/oauth-protected-resource/mcp/readonly"),
  ).json() as { resource: string; scopes_supported: string[] };
  assert.equal(readonly.resource, "https://atlas.test/mcp/readonly");
  assert.deepEqual(readonly.scopes_supported, ["read"]);

  const authorization = await authorizationServerGet(
    request("/.well-known/oauth-authorization-server"),
  ).json() as { issuer: string; token_endpoint: string };
  assert.equal(authorization.issuer, "https://atlas.test");
  assert.equal(authorization.token_endpoint, "https://atlas.test/oauth/token");
});

test("without APP_URL or APP_ORIGIN the request origin is the fallback", async () => {
  const response = protectedResourceMetadataResponse(
    new Request("http://127.0.0.1:3000/mcp"),
    "readonly",
    {},
  );
  const document = await response.json() as {
    resource: string;
    authorization_servers: string[];
  };
  assert.equal(document.resource, "http://127.0.0.1:3000/mcp/readonly");
  assert.deepEqual(document.authorization_servers, ["http://127.0.0.1:3000"]);

  const authorization = await authorizationServerMetadataResponse(
    new Request("http://127.0.0.1:3000/.well-known/oauth-authorization-server"),
    { APP_ORIGIN: "" },
  ).json() as { issuer: string };
  assert.equal(authorization.issuer, "http://127.0.0.1:3000");
});
