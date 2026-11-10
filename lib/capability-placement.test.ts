import assert from "node:assert/strict";
import { test } from "node:test";
import type { Queryable } from "./db";
import { executeCapability } from "./capabilities";

test("an eventless direct section action keeps its primary-project target and no-op behavior", async () => {
  const calls: string[] = [];
  const q: Queryable = { query: async (sql, params) => {
    calls.push(sql);
    let rows: Record<string, unknown>[];
    if (sql.includes("FROM tasks")) rows = [{ project_id: 20, section_id: 30 }];
    else if (sql.includes("FROM users")) {
      assert.equal(params?.[1], 20, "the direct call should authorize the primary project");
      rows = [{ is_admin: false, deactivated_at: null, role: "editor" }];
    } else if (sql.includes("FROM sections")) rows = [{ project_id: 20 }];
    else assert.fail(`unexpected write or lookup: ${sql}`);
    return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
  } };
  const notifications: number[] = [];
  const result = await executeCapability("task.move_section", { task_id: 10, section_id: 30 }, {
    actorId: 1, source: "manual", projectId: 99, chainDepth: 0, q,
    notifyAfterCommit: (id) => notifications.push(id),
  });
  assert.equal(result.data?.unchanged, true);
  assert.deepEqual(notifications, []);
  assert.equal(calls.some((sql) => /UPDATE|INSERT|DELETE/.test(sql.split("FOR UPDATE")[0])), false);
});
