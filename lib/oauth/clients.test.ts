import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import type { Queryable } from "@/lib/db";
import { resolveClient, registerClient, metadataResponseFromIncoming } from "./clients";
import { OAuthError } from "./errors";

type Call = { sql: string; params?: unknown[] };

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

function mockQueryable(
  options: { rows?: Record<string, unknown>[] } = {},
  calls: Call[] = [],
): Queryable {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM oauth_clients") && sql.includes("WHERE client_id = $1")) {
        return result(options.rows ?? []);
      }
      if (sql.includes("INSERT INTO oauth_clients")) return result();
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function publicResolve() {
  return async () => [{ address: "8.8.8.8", family: 4 }];
}

function jsonResponse(value: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

const CIMD_URL = "https://client.example/oauth/client.json";

function cimdMetadata(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CIMD_URL,
    client_name: "Example Client",
    redirect_uris: ["http://127.0.0.1/callback"],
    application_type: "native",
    ...overrides,
  };
}

test("CIMD responses are accepted only for HTTP 200", () => {
  const body = Buffer.from(JSON.stringify(cimdMetadata()));
  const response = metadataResponseFromIncoming(200, "application/json", body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");

  for (const status of [204, 205, 304, 301, 500, undefined]) {
    assert.throws(
      () => metadataResponseFromIncoming(status, "application/json", body),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          `client metadata document returned HTTP ${status ?? "unknown"}`,
        );
        return true;
      },
      String(status),
    );
  }
});

test("a non-200 CIMD response becomes invalid_client instead of crashing", async () => {
  for (const status of [204, 205, 304, 301, 500]) {
    await assert.rejects(
      resolveClient(CIMD_URL, mockQueryable(), {
        resolve: publicResolve(),
        fetch: async () => new Response(null, { status }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof OAuthError);
        assert.equal(error.code, "invalid_client");
        assert.match(error.message, /error status/);
        return true;
      },
      String(status),
    );
  }
});

test("a CIMD client cached for less than 24 hours is used without fetching", async (t) => {
  const calls: Call[] = [];
  const cached = {
    client_id: CIMD_URL,
    source: "cimd",
    client_name: "Cached",
    redirect_uris: ["http://127.0.0.1/callback"],
    application_type: "native",
    metadata: { client_id: CIMD_URL },
    fetched_at: new Date(),
    revoked_at: null,
  };
  const fetch = t.mock.fn(async () => {
    throw new Error("must not fetch");
  });
  const resolve = t.mock.fn(publicResolve());
  const client = await resolveClient(CIMD_URL, mockQueryable({ rows: [cached] }, calls), {
    fetch,
    resolve,
  });
  assert.equal(client.clientId, CIMD_URL);
  assert.equal(client.clientName, "Cached");
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(resolve.mock.callCount(), 0);
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO oauth_clients")));
});

test("a stale CIMD cache entry is fetched, validated and upserted", async () => {
  const calls: Call[] = [];
  const stale = {
    client_id: CIMD_URL,
    source: "cimd",
    client_name: "Old",
    redirect_uris: ["http://127.0.0.1/callback"],
    application_type: "native",
    metadata: {},
    fetched_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
    revoked_at: null,
  };
  const client = await resolveClient(CIMD_URL, mockQueryable({ rows: [stale] }, calls), {
    resolve: publicResolve(),
    fetch: async () => jsonResponse(cimdMetadata()),
  });
  assert.equal(client.clientId, CIMD_URL);
  assert.equal(client.clientName, "Example Client");
  assert.deepEqual(client.redirectUris, ["http://127.0.0.1/callback"]);
  const upsert = calls.find((call) => call.sql.includes("INSERT INTO oauth_clients"));
  assert.ok(upsert);
  assert.match(upsert.sql, /ON CONFLICT/);
  assert.equal(upsert.params?.[0], CIMD_URL);
  assert.deepEqual(upsert.params?.[2], ["http://127.0.0.1/callback"]);
  assert.equal(upsert.params?.[3], "native");
});

test("a CIMD document whose client_id differs from the URL is rejected", async () => {
  await assert.rejects(
    resolveClient(CIMD_URL, mockQueryable(), {
      resolve: publicResolve(),
      fetch: async () => jsonResponse(cimdMetadata({ client_id: "https://other.example/client.json" })),
    }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      assert.match(error.message, /does not match/);
      return true;
    },
  );
});

test("a CIMD host resolving to a private address is rejected before fetch", async (t) => {
  const fetch = t.mock.fn(async () => jsonResponse(cimdMetadata()));
  await assert.rejects(
    resolveClient(CIMD_URL, mockQueryable(), {
      resolve: async () => [{ address: "10.0.0.7", family: 4 }],
      fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      assert.match(error.message, /public IP/);
      return true;
    },
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("a CIMD document over 64KB is rejected", async () => {
  const body = JSON.stringify({ ...cimdMetadata(), padding: "x".repeat(65 * 1024) });
  await assert.rejects(
    resolveClient(CIMD_URL, mockQueryable(), {
      resolve: publicResolve(),
      fetch: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      assert.match(error.message, /too large/);
      return true;
    },
  );
});

test("a CIMD document without a JSON content type is rejected", async () => {
  await assert.rejects(
    resolveClient(CIMD_URL, mockQueryable(), {
      resolve: publicResolve(),
      fetch: async () => new Response(JSON.stringify(cimdMetadata()), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      assert.match(error.message, /served as JSON/);
      return true;
    },
  );
});

test("a CIMD redirect_uri outside the redirect rules is rejected", async () => {
  await assert.rejects(
    resolveClient(CIMD_URL, mockQueryable(), {
      resolve: publicResolve(),
      fetch: async () => jsonResponse(cimdMetadata({
        redirect_uris: ["http://client.example/callback"],
      })),
    }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      assert.match(error.message, /redirect_uris/);
      return true;
    },
  );
});

test("a non-https client_id is resolved only from DCR rows", async () => {
  const dcr = {
    client_id: "atlas_oauth_random",
    source: "dcr",
    client_name: "DCR Client",
    redirect_uris: ["http://127.0.0.1/callback"],
    application_type: "native",
    metadata: {},
    fetched_at: null,
    revoked_at: null,
  };
  const fetch = async () => {
    throw new Error("must not fetch");
  };
  const client = await resolveClient("atlas_oauth_random", mockQueryable({ rows: [dcr] }), {
    fetch,
    resolve: publicResolve(),
  });
  assert.equal(client.source, "dcr");
  assert.equal(client.clientName, "DCR Client");

  await assert.rejects(
    resolveClient("atlas_oauth_unknown", mockQueryable(), {
      fetch,
      resolve: publicResolve(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      return true;
    },
  );
});

test("a revoked client is rejected even when cached", async () => {
  const cached = {
    client_id: CIMD_URL,
    source: "cimd",
    client_name: "Revoked",
    redirect_uris: ["http://127.0.0.1/callback"],
    application_type: "native",
    metadata: {},
    fetched_at: new Date(),
    revoked_at: new Date(),
  };
  await assert.rejects(
    resolveClient(CIMD_URL, mockQueryable({ rows: [cached] }), { resolve: publicResolve() }),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client");
      assert.match(error.message, /revoked/);
      return true;
    },
  );
});

test("DCR registers a public native client and returns the RFC 7591 response", async () => {
  const calls: Call[] = [];
  const response = await registerClient({
    redirect_uris: ["http://127.0.0.1:1234/callback"],
    application_type: "native",
    client_name: "  My CLI  ",
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
  }, mockQueryable({}, calls));
  assert.match(response.client_id, /^atlas_oauth_[A-Za-z0-9_-]{43}$/);
  assert.equal(response.client_name, "My CLI");
  assert.deepEqual(response.redirect_uris, ["http://127.0.0.1:1234/callback"]);
  assert.equal(response.application_type, "native");
  assert.equal(response.token_endpoint_auth_method, "none");
  assert.deepEqual(response.grant_types, ["authorization_code", "refresh_token"]);
  assert.ok(Number.isSafeInteger(response.client_id_issued_at));

  const insert = calls.find((call) => call.sql.includes("INSERT INTO oauth_clients"));
  assert.ok(insert);
  assert.equal(insert.params?.[0], response.client_id);
  assert.equal(insert.params?.[1], "My CLI");
  assert.deepEqual(insert.params?.[2], ["http://127.0.0.1:1234/callback"]);
  assert.equal(insert.params?.[3], "native");
});

test("DCR defaults to native and authorization_code", async () => {
  const response = await registerClient({
    redirect_uris: ["http://localhost:5555/callback"],
  }, mockQueryable());
  assert.equal(response.application_type, "native");
  assert.deepEqual(response.grant_types, ["authorization_code"]);
  assert.equal(response.token_endpoint_auth_method, "none");
});

test("DCR rejects redirects that do not fit application_type", async () => {
  const cases: Array<Record<string, unknown>> = [
    { redirect_uris: ["https://app.example/callback"], application_type: "native" },
    { redirect_uris: ["http://app.example/callback"], application_type: "native" },
    { redirect_uris: ["http://localhost:5555/callback"], application_type: "web" },
    { redirect_uris: ["https://app.example/callback#frag"], application_type: "web" },
    { redirect_uris: [], application_type: "web" },
    { redirect_uris: "https://app.example/callback", application_type: "web" },
  ];
  for (const input of cases) {
    await assert.rejects(
      registerClient(input, mockQueryable()),
      (error: unknown) => {
        assert.ok(error instanceof OAuthError);
        assert.equal(error.code, "invalid_redirect_uri");
        return true;
      },
      JSON.stringify(input),
    );
  }
  const web = await registerClient({
    redirect_uris: ["https://app.example/callback"],
    application_type: "web",
  }, mockQueryable());
  assert.equal(web.application_type, "web");
});

test("DCR rejects confidential auth methods and unsupported grant types", async () => {
  const cases: Array<Record<string, unknown>> = [
    { token_endpoint_auth_method: "client_secret_basic" },
    { grant_types: ["client_credentials"] },
    { grant_types: ["refresh_token"] },
    { grant_types: [] },
  ];
  for (const overrides of cases) {
    await assert.rejects(
      registerClient({
        redirect_uris: ["http://127.0.0.1:1234/callback"],
        ...overrides,
      }, mockQueryable()),
      (error: unknown) => {
        assert.ok(error instanceof OAuthError);
        assert.equal(error.code, "invalid_client_metadata");
        return true;
      },
      JSON.stringify(overrides),
    );
  }
});

test("DCR limits client_name to 100 characters", async () => {
  await assert.rejects(
    registerClient({
      redirect_uris: ["http://127.0.0.1:1234/callback"],
      client_name: "n".repeat(101),
    }, mockQueryable()),
    (error: unknown) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "invalid_client_metadata");
      return true;
    },
  );
});
