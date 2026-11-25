import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { ApiError, forbidden, notFound } from "@/lib/api/errors";
import { hidingAccess } from "@/lib/services/task-keys";
import {
  DEFAULT_MCP_QUERY_SERVICES,
  buildMcpServer,
  createReadTools,
  type McpBuildContext,
  type McpQueryServices,
} from "./server";

const ctx: McpBuildContext = {
  actor: { uid: 42, source: "mcp", tokenId: 7 },
  scopes: ["read"],
  endpoint: "default",
  era: "legacy",
};

async function call(services: Partial<McpQueryServices>, name: string, args: Record<string, unknown>) {
  const server: McpServer = buildMcpServer(
    ctx,
    createReadTools({ ...DEFAULT_MCP_QUERY_SERVICES, ...services } as McpQueryServices),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "atlas-test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ text: string }>;
    return { result, text: content[0]?.text ?? "" };
  } finally {
    await client.close();
    await server.close();
  }
}

function detail(id: number, key: string | null) {
  return {
    task: { id, key, name: "Task", description: "", completed: false, status: "inbox" },
    project: null,
    section: null,
    parent: null,
    customFieldValues: [],
  };
}

test("get_task resolves a key, reads the resolved id and names the key", async () => {
  const resolved: unknown[] = [];
  const read: number[] = [];
  const { result, text } = await call({
    resolveTaskRef: async (_actor, ref, access) => {
      resolved.push([ref, access]);
      return 501;
    },
    getTaskDetail: (async (_actor: unknown, id: number) => {
      read.push(id);
      return detail(id, "ATL-7");
    }) as unknown as McpQueryServices["getTaskDetail"],
  }, "get_task", { taskId: "atl-7" });
  assert.equal(result.isError, undefined);
  assert.deepEqual(resolved, [["atl-7", "view"]]);
  assert.deepEqual(read, [501]);
  assert.equal((result.structuredContent as { task: { key: string } }).task.key, "ATL-7");
  assert.match(text, /^Task ATL-7 \(id 501\)/);
});

test("with a key, a later 403 or archived-project 404 reads as task not found", async () => {
  for (const error of [forbidden("project access denied"), notFound("project not found")]) {
    const { result, text } = await call({
      resolveTaskRef: async () => 501,
      getTaskDetail: async () => {
        throw error;
      },
    }, "get_task", { taskId: "ATL-7" });
    assert.equal(result.isError, true);
    assert.equal(text, "task not found");
  }
});

test("a numeric task id keeps the existing 403 message", async () => {
  const { result, text } = await call({
    getTaskDetail: async () => {
      throw forbidden("project access denied");
    },
  }, "get_task", { taskId: 501 });
  assert.equal(result.isError, true);
  assert.equal(text, "project access denied");
});

test("list_comments resolves a key before listing", async () => {
  const listed: number[] = [];
  const { result } = await call({
    resolveTaskRef: async () => 9,
    listComments: async (_actor, taskId) => {
      listed.push(taskId);
      return { items: [], nextCursor: null };
    },
  }, "list_comments", { taskId: "ATL-1" });
  assert.equal(result.isError, undefined);
  assert.deepEqual(listed, [9]);
});

test("list_tasks resolves a project prefix and hides inaccessible prefixes", async () => {
  const searched: unknown[] = [];
  const services: Partial<McpQueryServices> = {
    resolveProjectRef: async (_actor, ref) => (ref === "ATL" ? 77 : ref as number),
    searchTasks: async (_actor, input) => {
      searched.push(input);
      return { items: [], nextCursor: null };
    },
  };
  await call(services, "list_tasks", { projectId: "ATL", query: "ATL-3" });
  await call(services, "list_tasks", { projectId: 5 });
  await call(services, "list_tasks", {});
  assert.deepEqual(searched, [{ projectId: 77, query: "ATL-3" }, { projectId: 5 }, {}]);

  const { result, text } = await call({
    resolveProjectRef: async () => 77,
    searchTasks: async () => {
      throw forbidden("project access denied");
    },
  }, "list_tasks", { projectId: "ATL" });
  assert.equal(result.isError, true);
  assert.equal(text, "project not found");
});

test("get_project accepts a prefix", async () => {
  const read: number[] = [];
  const { result } = await call({
    resolveProjectRef: async () => 77,
    getProjectSummary: (async (_actor: unknown, id: number) => {
      read.push(id);
      return { project: { id, name: "Atlas", dev: { prefix: "ATL", start_status: null } }, sections: [] };
    }) as unknown as McpQueryServices["getProjectSummary"],
  }, "get_project", { projectId: "ATL" });
  assert.equal(result.isError, undefined);
  assert.deepEqual(read, [77]);
});

test("hidingAccess only rewrites access errors, and only for key references", async () => {
  await assert.rejects(hidingAccess("ATL-1", "task not found", async () => {
    throw forbidden("x");
  }), { status: 404, message: "task not found" });
  await assert.rejects(hidingAccess(1, "task not found", async () => {
    throw forbidden("x");
  }), { status: 403 });
  await assert.rejects(hidingAccess("ATL-1", "task not found", async () => {
    throw new ApiError(409, "conflict", "conflict");
  }), { status: 409 });
});
