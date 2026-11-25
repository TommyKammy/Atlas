// Issue keys through real creation routes (docs/dev-projects-phase0.md §4.1).
// The trigger covers every INSERT; these check representative routes end to end.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, test } from "node:test";
import { db, fixtures, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function enableDev(projectId) {
  const prefix = `H${randomBytes(3).toString("hex").toUpperCase()}`;
  await db.query("SELECT atlas_enable_dev_project($1, $2, NULL, NULL, 20000)", [projectId, prefix]);
  return prefix;
}

async function keyOf(taskId) {
  const { rows: [row] } = await db.query(
    `SELECT p.prefix || '-' || k.number AS key FROM task_keys k
       JOIN dev_projects p ON p.id = k.namespace_id WHERE k.task_id = $1`,
    [taskId],
  );
  return row?.key ?? null;
}

test("tasks created, subtasked and duplicated through the API get keys", async () => {
  const { a, editor, owner } = await fixtures("Dev keys HTTP");
  const existing = await task(a, "Existing before enable");
  const prefix = await enableDev(a);
  assert.equal(await keyOf(existing), `${prefix}-1`);

  const { id: created } = await request(editor, "POST", "/api/tasks", 201, { project_id: a, name: "Created" });
  assert.equal(await keyOf(created), `${prefix}-2`);

  const { id: child } = await request(editor, "POST", "/api/tasks", 201, {
    project_id: a, name: "Child", parent_task_id: created,
  });
  assert.equal(await keyOf(child), `${prefix}-3`);

  const { id: copy } = await request(owner, "POST", `/api/tasks/${created}/duplicate`, 201);
  assert.equal(await keyOf(copy), `${prefix}-4`, "a duplicate gets a new number");
});

test("duplicating a development project does not make the copy a development project", async () => {
  const { a, editor } = await fixtures("Dev keys project copy");
  await task(a, "Original");
  await enableDev(a);
  const { id: copyProject } = await request(editor, "POST", `/api/projects/${a}/duplicate`, 201, { name: "Dev copy" });
  const { rows } = await db.query(
    `SELECT t.id FROM tasks t JOIN task_keys k ON k.task_id = t.id WHERE t.project_id = $1`,
    [copyProject],
  );
  assert.deepEqual(rows, []);
  const { rowCount } = await db.query("SELECT 1 FROM dev_projects WHERE project_id = $1", [copyProject]);
  assert.equal(rowCount, 0);
});
