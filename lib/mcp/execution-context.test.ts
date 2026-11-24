import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getRequestContext, type RequestContext } from "@/lib/request-context";
import { buildMcpServer, type McpBuildContext, type McpToolDefinition } from "./server";

function context(overrides: Partial<McpBuildContext> = {}): McpBuildContext {
  return {
    actor: { uid: 42, source: "mcp", tokenId: 7 },
    scopes: ["read"],
    endpoint: "default",
    era: "legacy",
    clientName: "Claude Code",
    ...overrides,
  };
}

function probeTool(onCall: (context: RequestContext | undefined) => void): McpToolDefinition {
  return {
    name: "context_probe",
    title: "Context probe",
    description: "Test-only tool that records the ambient request context.",
    requiredScope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({}),
    handler: async () => {
      onCall(getRequestContext());
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
}

async function withClient<T>(server: McpServer, fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "atlas-test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("tool handlers run inside the MCP request context", async () => {
  let seen: RequestContext | undefined;
  await withClient(buildMcpServer(context(), [probeTool((value) => { seen = value; })]), async (client) => {
    const result = await client.callTool({ name: "context_probe", arguments: {} });
    assert.equal(result.isError, undefined);
  });

  assert.deepEqual(seen, { via: "mcp", tokenId: 7, clientName: "Claude Code" });
  assert.equal(getRequestContext(), undefined);
});

test("the context falls back to the token's client name", async () => {
  let seen: RequestContext | undefined;
  await withClient(
    buildMcpServer(
      context({
        actor: { uid: 42, source: "mcp", tokenId: 9, clientName: "PAT client" },
        clientName: undefined,
      }),
      [probeTool((value) => { seen = value; })],
    ),
    async (client) => {
      await client.callTool({ name: "context_probe", arguments: {} });
    },
  );
  assert.deepEqual(seen, { via: "mcp", tokenId: 9, clientName: "PAT client" });
});
