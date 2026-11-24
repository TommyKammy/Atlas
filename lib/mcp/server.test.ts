import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  DEFAULT_MCP_QUERY_SERVICES,
  TASK_DESCRIPTION_LIMIT,
  buildMcpServer,
  createReadTools,
  type McpBuildContext,
  type McpQueryServices,
  type McpToolDefinition,
} from "./server";

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

const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true };
const READ_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function context(overrides: Partial<McpBuildContext> = {}): McpBuildContext {
  return {
    actor: { uid: 42, source: "mcp", tokenId: 7 },
    scopes: ["read"],
    endpoint: "default",
    era: "legacy",
    ...overrides,
  };
}

function writeTool(): McpToolDefinition {
  return {
    name: "save_task",
    title: "Save task",
    description: "Test-only write tool.",
    requiredScope: "write",
    annotations: WRITE_ANNOTATIONS,
    inputSchema: z.object({}),
    handler: async () => ({
      content: [{ type: "text", text: "saved" }],
      structuredContent: { saved: true },
    }),
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

test("read scope lists the fixed read tools in a stable order without write tools", async () => {
  await withClient(buildMcpServer(context()), async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), READ_TOOL_NAMES);
    for (const tool of listed.tools) {
      assert.deepEqual(tool.annotations, READ_ANNOTATIONS, tool.name);
    }
    // The SDK would default this bit to true on the first registerTool call;
    // the tools capability itself must still be advertised.
    assert.ok(client.getServerCapabilities()?.tools !== undefined);
    assert.equal(client.getServerCapabilities()?.tools?.listChanged, undefined);
  });
});

test("the builder filters by effective scope and by the readonly endpoint", async () => {
  const tools = [...createReadTools(DEFAULT_MCP_QUERY_SERVICES), writeTool()];

  await withClient(buildMcpServer(context({ scopes: ["read"] }), tools), async (client) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(!names.includes("save_task"));
    assert.deepEqual(names, READ_TOOL_NAMES);
  });

  await withClient(
    buildMcpServer(context({ scopes: ["read", "write"], endpoint: "readonly" }), tools),
    async (client) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.ok(!names.includes("save_task"), "readonly must hide write tools");
      assert.deepEqual(names, READ_TOOL_NAMES);
    },
  );

  await withClient(
    buildMcpServer(context({ scopes: ["read", "write"], endpoint: "default" }), tools),
    async (client) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.deepEqual(names, [...READ_TOOL_NAMES, "save_task"]);
    },
  );
});

test("whoami returns identity, effective scopes and the endpoint", async () => {
  const services = {
    ...DEFAULT_MCP_QUERY_SERVICES,
    getSelf: async () => ({ id: 42, name: "Ada Lovelace", email: "ada@example.test" }),
  } as McpQueryServices;

  await withClient(
    buildMcpServer(context({ endpoint: "readonly", scopes: ["read"] }), createReadTools(services)),
    async (client) => {
      const result = await client.callTool({ name: "whoami", arguments: {} });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent, {
        id: 42,
        name: "Ada Lovelace",
        email: "ada@example.test",
        scopes: ["read"],
        endpoint: "readonly",
      });
      const content = result.content as Array<{ type: string; text: string }>;
      assert.match(content[0].text, /Authenticated as Ada Lovelace/);
      assert.match(content[0].text, /Endpoint: readonly/);
    },
  );
});

test("get_task truncates long descriptions and reports it", async () => {
  const description = "x".repeat(TASK_DESCRIPTION_LIMIT + 25);
  const services = {
    ...DEFAULT_MCP_QUERY_SERVICES,
    getTaskDetail: async () => ({
      task: {
        id: 11,
        name: "Long task",
        description,
        completed: false,
        status: "Todo",
      },
      project: null,
      section: null,
      parent: null,
      customFieldValues: [],
    }),
  } as unknown as McpQueryServices;

  await withClient(buildMcpServer(context(), createReadTools(services)), async (client) => {
    const result = await client.callTool({ name: "get_task", arguments: { taskId: 11 } });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as {
      task: { description: string };
      description_truncated: boolean;
    };
    assert.equal(structured.task.description.length, TASK_DESCRIPTION_LIMIT);
    assert.equal(structured.description_truncated, true);
    const content = result.content as Array<{ text: string }>;
    assert.match(content[0].text, /truncated at 2000 characters/);
  });
});

test("ApiError becomes an isError tool result with the API message", async () => {
  const failing: McpToolDefinition = {
    name: "missing_task",
    title: "Missing task",
    description: "Test-only tool that fails with a domain error.",
    requiredScope: "read",
    annotations: READ_ANNOTATIONS,
    inputSchema: z.object({}),
    handler: async () => {
      throw new ApiError(404, "task not found", "not_found");
    },
  };

  await withClient(buildMcpServer(context(), [failing]), async (client) => {
    const result = await client.callTool({ name: "missing_task", arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content[0].text, "task not found");
    assert.equal(result.structuredContent, undefined);
  });
});

test("unexpected exceptions return a generic error and only log details server-side", async () => {
  const failing: McpToolDefinition = {
    name: "broken_task",
    title: "Broken task",
    description: "Test-only tool that throws an unexpected error.",
    requiredScope: "read",
    annotations: READ_ANNOTATIONS,
    inputSchema: z.object({}),
    handler: async () => {
      throw new Error("database password leaked");
    },
  };

  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await withClient(buildMcpServer(context(), [failing]), async (client) => {
      const result = await client.callTool({ name: "broken_task", arguments: {} });
      assert.equal(result.isError, true);
      const content = result.content as Array<{ type: string; text: string }>;
      assert.equal(content[0].text, "internal error");
      assert.ok(!JSON.stringify(result).includes("database password"));
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(
    logged.some((args) => String(args[0]).includes("broken_task")
      && String(args[1]).includes("database password leaked")),
    "the detailed error is written to the server log",
  );
});
