import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult } from "pg";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { ApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/services/actor";
import type { ProjectSummary, TaskDetailView } from "@/lib/services/queries";
import { TaskMutationFailure } from "@/lib/services/task-mutation-failure";
import { withIdempotency, type IdempotencyInput } from "./idempotency";
import {
  buildMcpServer,
  createReadTools,
  createWriteTools,
  type McpBuildContext,
  type McpToolDefinition,
  type McpWriteServices,
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

const WRITE_TOOL_NAMES = [
  "save_task",
  "complete_task",
  "move_task",
  "add_comment",
  "save_section",
  "save_project",
  "trash_task",
];

type Call = { sql: string; params?: unknown[] };

type WriteCalls = {
  createTask: Array<{ actor: Actor; input: unknown }>;
  updateTaskForActor: Array<{ actor: Actor; taskId: number; input: Record<string, unknown> }>;
  trashTaskForActor: Array<{ actor: Actor; taskId: number }>;
  setTaskCustomValue: Array<{ actor: Actor; input: Record<string, unknown> }>;
  addComment: Array<{ actor: Actor; input: Record<string, unknown> }>;
  createSection: Array<{ actor: Actor; projectId: number; input: Record<string, unknown> }>;
  createProject: Array<{ actor: Actor; input: Record<string, unknown> }>;
  createProjectFromTemplate: Array<{ actor: Actor; templateId: number; input: Record<string, unknown> }>;
  updateProject: Array<{ actor: Actor; projectId: number; patch: Record<string, unknown> }>;
  getTaskDetail: number[];
  getProjectSummary: number[];
  idempotency: IdempotencyInput[];
  writeLimit: number[];
};

function context(overrides: Partial<McpBuildContext> = {}): McpBuildContext {
  return {
    actor: { uid: 42, source: "mcp", tokenId: 7 },
    scopes: ["read", "write"],
    endpoint: "default",
    era: "legacy",
    ...overrides,
  };
}

function fakeDetail(taskId: number): TaskDetailView {
  return {
    task: {
      id: taskId,
      name: `Task ${taskId}`,
      description: "",
      completed: false,
      status: "inbox",
    } as unknown as TaskDetailView["task"],
    project: { id: 1, name: "Project" },
    section: { id: 2, name: "Todo" },
    parent: null,
    customFieldValues: [],
  };
}

function fakeSummary(projectId: number): ProjectSummary {
  return {
    project: { id: projectId, name: `Project ${projectId}` } as unknown as ProjectSummary["project"],
    sections: [],
  };
}

function fakeServices(overrides: Partial<McpWriteServices> = {}) {
  const calls: WriteCalls = {
    createTask: [],
    updateTaskForActor: [],
    trashTaskForActor: [],
    setTaskCustomValue: [],
    addComment: [],
    createSection: [],
    createProject: [],
    createProjectFromTemplate: [],
    updateProject: [],
    getTaskDetail: [],
    getProjectSummary: [],
    idempotency: [],
    writeLimit: [],
  };

  const services: McpWriteServices = {
    createTask: async (actor, input) => {
      calls.createTask.push({ actor, input });
      return { id: 100, updated_at: "2026-01-01T00:00:00.000Z" };
    },
    updateTaskForActor: async (actor, taskId, input) => {
      calls.updateTaskForActor.push({ actor, taskId, input });
      return { id: taskId };
    },
    trashTaskForActor: async (actor, taskId) => {
      calls.trashTaskForActor.push({ actor, taskId });
      return { deleted: taskId };
    },
    setTaskCustomValue: async (actor, input) => {
      calls.setTaskCustomValue.push({ actor, input });
      return { cleared: input.value === null };
    },
    addComment: async (actor, input) => {
      calls.addComment.push({ actor, input });
      return { id: 500 };
    },
    createSection: async (actor, projectId, input) => {
      calls.createSection.push({ actor, projectId, input: input as Record<string, unknown> });
      return { id: 300, name: String((input as { name: string }).name), position: 1000 };
    },
    createProject: async (actor, input) => {
      calls.createProject.push({ actor, input: input as Record<string, unknown> });
      return { id: 200 };
    },
    createProjectFromTemplate: async (actor, templateId, input) => {
      calls.createProjectFromTemplate.push({
        actor,
        templateId,
        input: input as Record<string, unknown>,
      });
      return { id: 201 };
    },
    updateProject: async (actor, projectId, patch) => {
      calls.updateProject.push({ actor, projectId, patch: patch as Record<string, unknown> });
      return { id: projectId };
    },
    getTaskDetail: async (_actor, taskId) => {
      calls.getTaskDetail.push(taskId);
      return fakeDetail(taskId);
    },
    getProjectSummary: async (_actor, projectId) => {
      calls.getProjectSummary.push(projectId);
      return fakeSummary(projectId);
    },
    loadWorkspaceId: async () => 1,
    withIdempotency: async (input, run) => {
      calls.idempotency.push(input);
      return run();
    },
    enforceWriteLimit: async (tokenId) => {
      calls.writeLimit.push(tokenId);
    },
  };

  return { services: { ...services, ...overrides }, calls };
}

async function withClient<T>(server: McpServer, fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "atlas-write-test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function tool(
  name: string,
  args: Record<string, unknown>,
): { name: string; arguments: Record<string, unknown> } {
  return { name, arguments: args };
}

test("write tools are hidden without write scope or on the readonly endpoint", async () => {
  for (const ctx of [
    context({ scopes: ["read"] }),
    context({ scopes: ["read", "write"], endpoint: "readonly" }),
  ]) {
    await withClient(buildMcpServer(ctx), async (client) => {
      const names = (await client.listTools()).tools.map((item) => item.name);
      assert.deepEqual(names, READ_TOOL_NAMES);
    });
  }

  await withClient(buildMcpServer(context()), async (client) => {
    const names = (await client.listTools()).tools.map((item) => item.name);
    assert.deepEqual(names, [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES]);
  });
});

test("write tool annotations match the destructive and idempotent contract", async () => {
  await withClient(buildMcpServer(context()), async (client) => {
    const listed = await client.listTools();
    for (const name of WRITE_TOOL_NAMES) {
      const annotations = listed.tools.find((item) => item.name === name)?.annotations;
      assert.ok(annotations, `${name} annotations`);
      assert.equal(annotations.readOnlyHint, false, `${name} readOnlyHint`);
      assert.equal(annotations.openWorldHint, false, `${name} openWorldHint`);
      assert.equal(
        annotations.destructiveHint,
        name === "trash_task",
        `${name} destructiveHint`,
      );
      assert.equal(
        annotations.idempotentHint,
        name === "complete_task" || name === "move_task",
        `${name} idempotentHint`,
      );
    }
  });
});

test("save_task creation maps extra fields to the follow-up writes", async () => {
  const { services, calls } = fakeServices();

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const result = await client.callTool(tool("save_task", {
      project_id: 1,
      name: "New task",
      description: "Details",
      status: "Todo",
      assignee: "me",
      start_on: "2026-01-01",
      due_on: "2026-01-02",
      section_id: 2,
      parent_task_id: null,
      is_milestone: false,
      custom_fields: [
        { field_id: 5, value: "a" },
        { field_id: 6, value: null },
      ],
      idempotency_key: "create-1",
    }));

    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as { task: { id: number } };
    assert.equal(structured.task.id, 100);
    const content = result.content as Array<{ text: string }>;
    assert.match(content[0].text, /Created task 100/);
  });

  assert.equal(calls.createTask.length, 1);
  assert.deepEqual(calls.createTask[0].input, {
    project_id: 1,
    name: "New task",
    section_id: 2,
    parent_task_id: null,
    start_on: "2026-01-01",
    due_on: "2026-01-02",
    assignee_id: 42,
    is_milestone: false,
  });
  assert.deepEqual(calls.updateTaskForActor[0].input, {
    description: "Details",
    status: "Todo",
  });
  assert.deepEqual(calls.setTaskCustomValue.map((call) => call.input), [
    { task_id: 100, field_id: 5, value: "a" },
    { task_id: 100, field_id: 6, value: null },
  ]);
  assert.equal(calls.idempotency[0].toolName, "save_task");
  assert.equal(calls.idempotency[0].key, "create-1");
  assert.deepEqual(calls.getTaskDetail, [100]);
});

test("save_task update sends only supplied fields and keeps expected_updated_at", async () => {
  const { services, calls } = fakeServices();

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const result = await client.callTool(tool("save_task", {
      id: 100,
      status: "Done",
      assignee: "me",
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    }));
    assert.equal(result.isError, undefined);
  });

  assert.equal(calls.createTask.length, 0);
  assert.deepEqual(calls.updateTaskForActor[0].input, {
    status: "Done",
    assignee_id: 42,
    expected_updated_at: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(calls.getTaskDetail, [100]);
});

test("TaskMutationFailure becomes an isError result with reason and conflict metadata", async () => {
  const { services } = fakeServices({
    updateTaskForActor: async () => {
      throw new TaskMutationFailure("conflict", "conflict", {
        updated_at: "2026-01-01T00:00:00.000Z",
        current: { id: 100, name: "Current" },
      });
    },
  });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const result = await client.callTool(tool("complete_task", { id: 100 }));
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      reason: "conflict",
      message: "conflict",
      updated_at: "2026-01-01T00:00:00.000Z",
      current: { id: 100, name: "Current" },
    });
    const content = result.content as Array<{ text: string }>;
    assert.equal(content[0].text, "conflict");
  });
});

test("custom-fields-only updates honor expected_updated_at before writing", async () => {
  const detail = fakeDetail(100);
  detail.task.updated_at = "2026-02-02T00:00:00.000Z";
  const { services, calls } = fakeServices({
    getTaskDetail: async (_actor, taskId) => {
      calls.getTaskDetail.push(taskId);
      return detail;
    },
  });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const result = await client.callTool(tool("save_task", {
      id: 100,
      custom_fields: [{ field_id: 5, value: "changed" }],
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    }));
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      reason: "conflict",
      message: "conflict",
      current_updated_at: "2026-02-02T00:00:00.000Z",
    });

    const success = await client.callTool(tool("save_task", {
      id: 100,
      custom_fields: [{ field_id: 6, value: "ok" }],
      expected_updated_at: "2026-02-02T00:00:00.000Z",
    }));
    assert.equal(success.isError, undefined);
  });

  assert.equal(calls.updateTaskForActor.length, 0);
  assert.equal(calls.setTaskCustomValue.length, 1);
  assert.deepEqual(calls.getTaskDetail, [100, 100, 100]);
});

test("creation tools pass their key and arguments through withIdempotency", async () => {
  const { services, calls } = fakeServices();

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    await client.callTool(tool("save_task", {
      project_id: 1,
      name: "Task",
      idempotency_key: "task-key",
    }));
    await client.callTool(tool("add_comment", {
      task_id: 1,
      body: "hello",
      idempotency_key: "comment-key",
    }));
    await client.callTool(tool("save_section", {
      project_id: 1,
      name: "Section",
      idempotency_key: "section-key",
    }));
    await client.callTool(tool("save_project", {
      name: "Project",
      idempotency_key: "project-key",
    }));
  });

  assert.deepEqual(
    calls.idempotency.map((call) => [call.toolName, call.key]),
    [
      ["save_task", "task-key"],
      ["add_comment", "comment-key"],
      ["save_section", "section-key"],
      ["save_project", "project-key"],
    ],
  );
});

/** Minimal in-memory stand-in for the mcp_idempotency table. */
function idempotencyStore(calls: Call[]) {
  type StoredRow = { id: number; hash: string; response: unknown; key: string };
  const rows = new Map<string, StoredRow>();
  let nextId = 1;
  const mapKey = (tokenId: unknown, toolName: unknown, key: unknown) =>
    JSON.stringify([tokenId, toolName, key]);

  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const result = (resultRows: Record<string, unknown>[] = []): QueryResult => ({
      rows: resultRows,
      rowCount: resultRows.length,
      command: "SELECT",
      oid: 0,
      fields: [],
    });
    if (sql.includes("INSERT INTO mcp_idempotency")) {
      const [tokenId, toolName, key, hash] = params;
      const keyId = mapKey(tokenId, toolName, key);
      if (rows.has(keyId)) return result([]);
      const row: StoredRow = { id: nextId++, hash: String(hash), response: null, key: String(key) };
      rows.set(keyId, row);
      return result([{ id: row.id }]);
    }
    if (sql.includes("SELECT id, request_hash, response")) {
      const [tokenId, toolName, key] = params;
      const row = rows.get(mapKey(tokenId, toolName, key));
      return result(row
        ? [{
            id: row.id,
            request_hash: row.hash,
            response: row.response,
            in_flight: row.response === null,
          }]
        : []);
    }
    if (sql.includes("UPDATE mcp_idempotency SET response")) {
      const [id, payload] = params;
      for (const row of rows.values()) {
        if (row.id === Number(id)) row.response = JSON.parse(String(payload));
      }
      return result([]);
    }
    if (sql.includes("DELETE FROM mcp_idempotency")) {
      const [id] = params;
      for (const [key, row] of rows) {
        if (row.id === Number(id)) rows.delete(key);
      }
      return result([]);
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  return { rows, query };
}

test("a repeated idempotency key runs save_task creation exactly once", async (t) => {
  const dbCalls: Call[] = [];
  const store = idempotencyStore(dbCalls);
  t.mock.method(db, "query", store.query);
  const { services, calls } = fakeServices({ withIdempotency });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const args = { project_id: 1, name: "Only once", idempotency_key: "same-key" };
    const first = await client.callTool(tool("save_task", args));
    const second = await client.callTool(tool("save_task", args));
    assert.equal(first.isError, undefined);
    assert.equal(second.isError, undefined);
    assert.deepEqual(second.structuredContent, first.structuredContent);
  });

  assert.equal(calls.createTask.length, 1);
  assert.deepEqual(calls.getTaskDetail, [100]);
  assert.equal(store.rows.size, 1);
});

test("a failed save_task follow-up is cached as created with failed_updates", async (t) => {
  const dbCalls: Call[] = [];
  const store = idempotencyStore(dbCalls);
  t.mock.method(db, "query", store.query);
  let updateAttempts = 0;
  let customValueAttempts = 0;
  const { services, calls } = fakeServices({
    withIdempotency,
    updateTaskForActor: async () => {
      updateAttempts++;
      throw new TaskMutationFailure("invalid", "invalid description");
    },
    setTaskCustomValue: async () => {
      customValueAttempts++;
      throw new TaskMutationFailure("invalid", "invalid custom value");
    },
  });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const args = {
      project_id: 1,
      name: "Partially applied",
      description: "Details",
      status: "Todo",
      custom_fields: [{ field_id: 5, value: "bad" }],
      idempotency_key: "partial-task",
    };
    const first = await client.callTool(tool("save_task", args));
    const second = await client.callTool(tool("save_task", args));

    assert.equal(first.isError, true);
    assert.equal(second.isError, true);
    assert.deepEqual(second.structuredContent, first.structuredContent);
    const structured = first.structuredContent as {
      created: boolean;
      id: number;
      task: { id: number };
      failed_updates: Array<{ field: string; error: string }>;
    };
    assert.equal(structured.created, true);
    assert.equal(structured.id, 100);
    assert.equal(structured.task.id, 100);
    assert.deepEqual(structured.failed_updates, [
      { field: "description", error: "invalid description" },
      { field: "status", error: "invalid description" },
      { field: "custom_fields.5", error: "invalid custom value" },
    ]);
    const content = first.content as Array<{ text: string }>;
    assert.match(content[0].text, /Created task 100/);
    assert.match(content[0].text, /save_task using id 100/);
  });

  assert.equal(calls.createTask.length, 1);
  assert.equal(updateAttempts, 1);
  assert.equal(customValueAttempts, 1);
  assert.equal(store.rows.size, 1);
});

test("a failed save_project follow-up is cached as created with failed_updates", async (t) => {
  const dbCalls: Call[] = [];
  const store = idempotencyStore(dbCalls);
  t.mock.method(db, "query", store.query);
  let updateAttempts = 0;
  const { services, calls } = fakeServices({
    withIdempotency,
    updateProject: async () => {
      updateAttempts++;
      throw new TaskMutationFailure("invalid", "invalid project status");
    },
  });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const args = {
      name: "Partially applied project",
      description: "Details",
      status: "active",
      due_on: "2026-02-01",
      idempotency_key: "partial-project",
    };
    const first = await client.callTool(tool("save_project", args));
    const second = await client.callTool(tool("save_project", args));

    assert.equal(first.isError, true);
    assert.equal(second.isError, true);
    assert.deepEqual(second.structuredContent, first.structuredContent);
    const structured = first.structuredContent as {
      created: boolean;
      id: number;
      project: { project: { id: number } };
      failed_updates: Array<{ field: string; error: string }>;
    };
    assert.equal(structured.created, true);
    assert.equal(structured.id, 200);
    assert.equal(structured.project.project.id, 200);
    assert.deepEqual(structured.failed_updates, [
      { field: "description", error: "invalid project status" },
      { field: "status", error: "invalid project status" },
      { field: "due_on", error: "invalid project status" },
    ]);
    const content = first.content as Array<{ text: string }>;
    assert.match(content[0].text, /Created project 200/);
    assert.match(content[0].text, /save_project using id 200/);
  });

  assert.equal(calls.createProject.length, 1);
  assert.equal(updateAttempts, 1);
  assert.equal(store.rows.size, 1);
});

test("every write tool consumes the per-token write limit", async () => {
  const { services, calls } = fakeServices();

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const requests = [
      tool("save_task", { project_id: 1, name: "Task" }),
      tool("complete_task", { id: 1 }),
      tool("move_task", { id: 1, section_id: 2 }),
      tool("add_comment", { task_id: 1, body: "hello" }),
      tool("save_section", { project_id: 1, name: "Section" }),
      tool("save_project", { name: "Project" }),
      tool("trash_task", { id: 1 }),
    ];
    for (const request of requests) {
      const result = await client.callTool(request);
      assert.equal(result.isError, undefined, request.name);
    }
  });

  assert.deepEqual(calls.writeLimit, [7, 7, 7, 7, 7, 7, 7]);
});

test("an exceeded write limit becomes a tool error before the service runs", async () => {
  const { services, calls } = fakeServices({
    enforceWriteLimit: async () => {
      throw new ApiError(429, "MCP write rate limit exceeded; retry after 37 seconds", "rate_limited");
    },
  });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const result = await client.callTool(tool("save_task", { project_id: 1, name: "Task" }));
    assert.equal(result.isError, true);
    const content = result.content as Array<{ text: string }>;
    assert.match(content[0].text, /rate limit exceeded/);
  });

  assert.equal(calls.createTask.length, 0);
});

test("complete, move, comment, section, project and trash map their arguments", async () => {
  const { services, calls } = fakeServices({
    loadWorkspaceId: async () => 77,
  });

  await withClient(buildMcpServer(context(), createWriteTools(services)), async (client) => {
    const complete = await client.callTool(tool("complete_task", {
      id: 5,
      completed: false,
      expected_updated_at: "stamp",
    }));
    assert.equal(complete.isError, undefined);
    const move = await client.callTool(tool("move_task", {
      id: 5,
      section_id: 9,
      expected_updated_at: "stamp",
    }));
    assert.equal(move.isError, undefined);
    const comment = await client.callTool(tool("add_comment", {
      task_id: 5,
      body: "hello",
    }));
    assert.equal(comment.isError, undefined);
    const section = await client.callTool(tool("save_section", {
      project_id: 1,
      name: "Next",
      before_section_id: 2,
    }));
    assert.equal(section.isError, undefined);
    const project = await client.callTool(tool("save_project", {
      name: "Project",
      description: "Details",
      status: "active",
      due_on: "2026-02-01",
    }));
    assert.equal(project.isError, undefined);
    const templated = await client.callTool(tool("save_project", {
      name: "From template",
      template_id: 8,
    }));
    assert.equal(templated.isError, undefined);
    const trashed = await client.callTool(tool("trash_task", { id: 5 }));
    assert.equal(trashed.isError, undefined);
    assert.deepEqual(trashed.structuredContent, { id: 5, trashed: true });
  });

  assert.deepEqual(calls.updateTaskForActor.map((call) => call.input), [
    { completed: false, expected_updated_at: "stamp" },
    { section_id: 9, expected_updated_at: "stamp" },
  ]);
  assert.deepEqual(calls.addComment[0].input, { task_id: 5, body: "hello" });
  assert.deepEqual(calls.createSection[0], {
    actor: { uid: 42, source: "mcp", tokenId: 7 },
    projectId: 1,
    input: { name: "Next", before_section_id: 2, after_section_id: undefined },
  });
  assert.deepEqual(calls.createProject[0].input, { workspace_id: 77, name: "Project" });
  assert.deepEqual(calls.updateProject[0].patch, {
    description: "Details",
    status: "active",
    due_on: "2026-02-01",
  });
  assert.deepEqual(calls.createProjectFromTemplate[0], {
    actor: { uid: 42, source: "mcp", tokenId: 7 },
    templateId: 8,
    input: { name: "From template" },
  });
  assert.deepEqual(calls.trashTaskForActor, [
    { actor: { uid: 42, source: "mcp", tokenId: 7 }, taskId: 5 },
  ]);
  assert.deepEqual(calls.getProjectSummary, [200, 201]);
});

test("write tools expose a fixed registration order", () => {
  const names = createWriteTools().map((item: McpToolDefinition) => item.name);
  assert.deepEqual(names, WRITE_TOOL_NAMES);
  assert.deepEqual(createReadTools().map((item) => item.name), READ_TOOL_NAMES);
});
