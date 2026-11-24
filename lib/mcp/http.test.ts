import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { GET as readonlyGet } from "@/app/mcp/readonly/route";
import { GET as defaultGet } from "@/app/mcp/route";
import type { McpAuthResult, McpAuthSuccess, McpEndpoint } from "./auth";
import {
  handleMcpPost,
  MCP_MAX_REQUEST_BODY_BYTES,
  readRpcMetadata,
  type McpHttpDependencies,
} from "./http";
import type { McpRequestLogEntry } from "./request-log";
import {
  DEFAULT_MCP_QUERY_SERVICES,
  buildMcpServer,
  createReadTools,
  type McpQueryServices,
} from "./server";

process.env.APP_URL = "https://atlas.test";

const READ_TOOL_NAMES = [
  "whoami",
  "list_projects",
  "get_project",
  "list_sections",
  "list_tasks",
  "get_task",
  "list_comments",
  "list_my_tasks",
  "list_users",
  "list_project_members",
  "list_custom_fields",
];

const AUTH_SUCCESS: McpAuthSuccess = {
  ok: true,
  tokenId: 7,
  workspaceId: 1,
  userId: 42,
  kind: "pat",
  scopes: ["read", "write"],
  clientName: "PAT client",
  actor: { uid: 42, source: "mcp", tokenId: 7, clientName: "PAT client" },
};

const FAKE_SERVICES = {
  ...DEFAULT_MCP_QUERY_SERVICES,
  getSelf: async () => ({ id: 42, name: "Ada Lovelace", email: "ada@example.test" }),
} as McpQueryServices;

function buildTestServer(ctx: Parameters<typeof buildMcpServer>[0]) {
  return buildMcpServer(ctx, createReadTools(FAKE_SERVICES));
}

function request(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", "atlas.test");
  return new Request(`https://atlas.test${path}`, { ...init, headers });
}

function jsonRpcBody(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

function authenticatedDependencies(
  entries: McpRequestLogEntry[],
  authenticate?: McpHttpDependencies["authenticate"],
): Partial<McpHttpDependencies> {
  return {
    authenticate: authenticate ?? (async () => AUTH_SUCCESS),
    record: async (entry) => {
      entries.push(entry);
    },
    buildServer: buildTestServer,
  };
}

async function connectClient(options: {
  endpoint: McpEndpoint;
  pin?: string;
  deps: Partial<McpHttpDependencies>;
}): Promise<Client> {
  const path = options.endpoint === "readonly" ? "/mcp/readonly" : "/mcp";
  const client = new Client(
    { name: "atlas-test-client", version: "1.0.0" },
    options.pin ? { versionNegotiation: { mode: { pin: options.pin } } } : undefined,
  );
  const transport = new StreamableHTTPClientTransport(new URL(`https://atlas.test${path}`), {
    fetch: async (url, init = {}) => {
      const headers = new Headers(init.headers);
      // Route handlers receive Host from the real HTTP server; the direct
      // handler call in this test must provide it explicitly.
      headers.set("host", "atlas.test");
      const req = new Request(url, { ...init, headers });
      if (req.method !== "POST") {
        return new Response("Method not allowed.", { status: 405, headers: { allow: "POST" } });
      }
      return handleMcpPost(req, options.endpoint, options.deps);
    },
    requestInit: { headers: { authorization: "Bearer valid-token" } },
  });
  await client.connect(transport);
  return client;
}

test("2026-07-28 client lists tools and calls whoami through POST /mcp", async () => {
  const entries: McpRequestLogEntry[] = [];
  const client = await connectClient({
    endpoint: "default",
    pin: "2026-07-28",
    deps: authenticatedDependencies(entries),
  });
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), READ_TOOL_NAMES);
    const cacheFields = listed as { ttlMs?: number; cacheScope?: string };
    assert.equal(cacheFields.ttlMs, 0);
    assert.equal(cacheFields.cacheScope, "private");
    // The 2026 server/discover result must still advertise tools, but must
    // not declare tools.listChanged.
    assert.ok(client.getServerCapabilities()?.tools !== undefined);
    assert.equal(client.getServerCapabilities()?.tools?.listChanged, undefined);

    const result = await client.callTool({ name: "whoami", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      id: 42,
      name: "Ada Lovelace",
      email: "ada@example.test",
      scopes: ["read", "write"],
      endpoint: "default",
    });

    const toolLog = entries.find((entry) => entry.rpcMethod === "tools/call");
    assert.ok(toolLog, "the tools/call request is logged");
    assert.equal(toolLog.toolName, "whoami");
    assert.equal(toolLog.outcome, "ok");
    assert.equal(toolLog.endpoint, "default");
    assert.equal(toolLog.workspaceId, 1);
    assert.equal(toolLog.tokenId, 7);
    assert.equal(toolLog.userId, 42);
    assert.equal(toolLog.clientName, "atlas-test-client");
  } finally {
    await client.close();
  }
});

test("a default 2025-era client still lists tools and calls whoami", async () => {
  const entries: McpRequestLogEntry[] = [];
  const client = await connectClient({
    endpoint: "default",
    deps: authenticatedDependencies(entries),
  });
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), READ_TOOL_NAMES);

    const result = await client.callTool({ name: "whoami", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { name: string }).name, "Ada Lovelace");

    const initialize = entries.find((entry) => entry.rpcMethod === "initialize");
    assert.ok(initialize, "the legacy initialize request is logged");
    assert.equal(initialize.clientName, "atlas-test-client");

    const toolLog = entries.find((entry) => entry.rpcMethod === "tools/call");
    assert.ok(toolLog);
    assert.equal(toolLog.toolName, "whoami");
    assert.equal(toolLog.outcome, "ok");
    // Stateless legacy calls carry no clientInfo; the token's name is used.
    assert.equal(toolLog.clientName, "PAT client");
  } finally {
    await client.close();
  }
});

test("the readonly endpoint lists and executes only read tools", async () => {
  const entries: McpRequestLogEntry[] = [];
  const client = await connectClient({
    endpoint: "readonly",
    pin: "2026-07-28",
    deps: authenticatedDependencies(entries),
  });
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), READ_TOOL_NAMES);
    const result = await client.callTool({ name: "whoami", arguments: {} });
    assert.equal((result.structuredContent as { endpoint: string }).endpoint, "readonly");
  } finally {
    await client.close();
  }
});

test("subscriptions/listen is acknowledged empty and closed when listChanged is not declared", async () => {
  const entries: McpRequestLogEntry[] = [];
  const client = await connectClient({
    endpoint: "default",
    pin: "2026-07-28",
    deps: authenticatedDependencies(entries),
  });
  try {
    const subscription = await client.listen({ toolsListChanged: true });
    assert.deepEqual(subscription.honoredFilter, {});
    const closed = await Promise.race([
      subscription.closed,
      new Promise<"timeout">((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), 2_000);
        timer.unref?.();
      }),
    ]);
    assert.equal(closed, "graceful");
    await subscription.close();
  } finally {
    await client.close();
  }
});

test("missing and invalid tokens return a generic 401 with WWW-Authenticate", async () => {
  for (const authorization of [undefined, "Bearer atlas_mcp_invalid"]) {
    const entries: McpRequestLogEntry[] = [];
    const response = await handleMcpPost(
      request("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: jsonRpcBody("tools/list"),
      }),
      "default",
      authenticatedDependencies(entries, async (req) => {
        assert.equal(req.headers.get("authorization"), authorization ?? null);
        const failure: McpAuthResult = { ok: false, reason: "invalid" };
        return failure;
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
    assert.deepEqual(await response.json(), { error: "invalid_token" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome, "unauthenticated");
    assert.equal(entries[0].errorCode, "invalid");
  }
});

test("authentication failures log header metadata without reading the body", async () => {
  const entries: McpRequestLogEntry[] = [];
  const req = request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": "whoami",
    },
    body: jsonRpcBody("tools/call", { name: "whoami" }),
  });
  const originalClone = req.clone.bind(req);
  let cloned = 0;
  req.clone = () => {
    cloned += 1;
    return originalClone();
  };
  const response = await handleMcpPost(
    req,
    "default",
    authenticatedDependencies(entries, async () => ({ ok: false, reason: "invalid" })),
  );
  assert.equal(response.status, 401);
  assert.equal(cloned, 0);
  assert.equal(req.bodyUsed, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rpcMethod, "tools/call");
  assert.equal(entries[0].toolName, "whoami");
  assert.equal(entries[0].clientName, null);
});

test("readRpcMetadata stops at the shared limit when Content-Length is absent", async () => {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "body-tool",
      clientInfo: { name: "body-client" },
      padding: "x".repeat(MCP_MAX_REQUEST_BODY_BYTES + 1_024),
    },
  });
  const req = request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": "header-tool",
    },
    body,
  });
  assert.equal(req.headers.get("content-length"), null);
  assert.deepEqual(await readRpcMetadata(req), {
    method: "tools/call",
    toolName: "header-tool",
    clientName: null,
    isToolCall: true,
  });
  // Reading the log clone never consumes the request the SDK still receives.
  assert.equal(req.bodyUsed, false);
});

test("an oversized body without Content-Length still gets the SDK's 413", async () => {
  const entries: McpRequestLogEntry[] = [];
  const response = await handleMcpPost(
    request("/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-method": "tools/call",
        "mcp-name": "whoami",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "whoami",
          arguments: {},
          padding: "x".repeat(MCP_MAX_REQUEST_BODY_BYTES + 1_024),
        },
      }),
    }),
    "default",
    authenticatedDependencies(entries),
  );
  assert.equal(response.status, 413);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rpcMethod, "tools/call");
  assert.equal(entries[0].toolName, "whoami");
  // The body's clientInfo was never read; the token's name is the fallback.
  assert.equal(entries[0].clientName, "PAT client");
  assert.equal(entries[0].outcome, "error");
  assert.equal(entries[0].errorCode, "http_413");
});

test("a disabled or guest failure reason is not exposed in the response body", async () => {
  const entries: McpRequestLogEntry[] = [];
  const response = await handleMcpPost(
    request("/mcp", { method: "POST", headers: { authorization: "Bearer valid-token" } }),
    "default",
    authenticatedDependencies(entries, async () => ({ ok: false, reason: "guest" })),
  );
  assert.equal(response.status, 401);
  const text = await response.text();
  assert.equal(text, JSON.stringify({ error: "invalid_token" }));
  assert.ok(!text.includes("guest"));
  assert.equal(entries[0].errorCode, "guest");
});

test("GET is 405 with Allow: POST on both endpoints", () => {
  for (const handler of [defaultGet, readonlyGet]) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  }
});

test("an invalid Origin is rejected with 403 before authentication", async () => {
  const entries: McpRequestLogEntry[] = [];
  let authenticated = false;
  const response = await handleMcpPost(
    request("/mcp", {
      method: "POST",
      headers: { origin: "https://evil.test", authorization: "Bearer valid-token" },
    }),
    "default",
    authenticatedDependencies(entries, async () => {
      authenticated = true;
      return AUTH_SUCCESS;
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(authenticated, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].outcome, "denied");
  assert.equal(entries[0].errorCode, "invalid_origin");
});

test("an invalid Host is rejected with 403 before the Origin and token checks", async () => {
  const entries: McpRequestLogEntry[] = [];
  let authenticated = false;
  const response = await handleMcpPost(
    request("/mcp", {
      method: "POST",
      headers: { host: "evil.test", origin: "https://evil.test", authorization: "Bearer valid-token" },
    }),
    "default",
    authenticatedDependencies(entries, async () => {
      authenticated = true;
      return AUTH_SUCCESS;
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(authenticated, false);
  assert.equal(entries[0].errorCode, "invalid_host");
});

test("a 429 from the authentication rate limiter keeps the existing response shape", async () => {
  const { AuthRateLimitError } = await import("@/lib/auth-rate-limit");
  const entries: McpRequestLogEntry[] = [];
  const response = await handleMcpPost(
    request("/mcp", { method: "POST", headers: { authorization: "Bearer valid-token" } }),
    "default",
    authenticatedDependencies(entries, async () => {
      throw new AuthRateLimitError(12);
    }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "12");
  assert.deepEqual(await response.json(), { error: "too_many_attempts", retry_after_seconds: 12 });
  assert.equal(entries[0].outcome, "unauthenticated");
  assert.equal(entries[0].errorCode, "rate_limited");
});

test("a logging failure never changes the response", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleMcpPost(
      request("/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: jsonRpcBody("tools/list"),
      }),
      "default",
      {
        authenticate: async () => AUTH_SUCCESS,
        record: async () => {
          throw new Error("log store unavailable");
        },
        buildServer: buildTestServer,
      },
    );
    assert.equal(response.status, 200);
    // A request without a 2026-07-28 envelope is served by the legacy
    // stateless transport, which may answer with an SSE frame.
    const body = await response.text();
    assert.match(body, /"tools"\s*:/);
  } finally {
    console.error = originalError;
  }
});
