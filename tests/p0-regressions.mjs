import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { base, db, fixtures, projectOf, request, task, waitForHttp } from "./regression-fixtures.mjs";

test("R03 Redis unavailable: HTTP starts and a task write succeeds", { timeout: 30_000 }, async () => {
  await waitForHttp();
  const { a, editor } = await fixtures("Outage");
  const { id } = await request(editor, "POST", "/api/tasks", 201, { project_id: a, name: "Written with Redis offline" });
  assert.equal(await projectOf(id), a);
});

test("R01 an editor cannot change what an owner's rule executes", { timeout: 25_000 }, async () => {
  await waitForHttp();
  const { a, b, owner, ownerId, editor } = await fixtures("Automation");
  const taskId = await task(a, "Manual trigger");
  const rules = `/api/projects/${a}/rules`;
  const definition = (projectId, name) => ({
    triggers: [{ event: "task.manual_rule" }],
    actions: [{ capability: "task.create", params: { project_id: projectId, name } }],
  });

  await request(editor, "GET", `/api/custom-fields?project_id=${b}`, 403);
  const { id } = await request(owner, "POST", rules, 201, {
    name: "Owner's rule", definition: definition(a, "Benign task"),
  });
  const rule = `${rules}/${id}`;
  const attemptedWrite = "Unauthorized write to B";
  await request(editor, "PATCH", rule, 403, { definition: definition(b, attemptedWrite) });
  await request(editor, "PATCH", rule, 403, { enabled: true });
  await request(editor, "POST", `${rule}/run`, 201, { task_id: taskId });
  const { rows: [{ n: unauthorized }] } = await db.query(
    "SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND name = $2", [b, attemptedWrite],
  );
  assert.equal(unauthorized, 0);

  const allowedWrite = "Owner authorized write to B";
  await request(owner, "PATCH", rule, 200, { definition: definition(b, allowedWrite) });
  await request(owner, "POST", `${rule}/run`, 201, { task_id: taskId });
  const { rows: [{ n: allowed }] } = await db.query(
    "SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND name = $2 AND created_by = $3",
    [b, allowedWrite, ownerId],
  );
  assert.equal(allowed, 1);

  await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [a, ownerId]);
  await request(editor, "POST", `${rule}/run`, 201, { task_id: taskId });
  const { rows: [{ n: afterRevocation }] } = await db.query(
    "SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND name = $2", [b, allowedWrite],
  );
  assert.equal(afterRevocation, 1);
});

test("R02 moving just a parent across projects is rejected", { timeout: 25_000 }, async () => {
  await waitForHttp();
  const { a, b, owner } = await fixtures("Task tree");
  const parent = await task(b, "Parent");
  const child = await task(b, "Child", parent);

  await request(owner, "PATCH", `/api/tasks/${parent}`, 409, { project_id: a });
  assert.equal(await projectOf(parent), b);
  assert.equal(await projectOf(child), b);

  const leaf = await task(b, "Leaf");
  await request(owner, "PATCH", `/api/tasks/${leaf}`, 200, { project_id: a });
  assert.equal(await projectOf(leaf), a);

  await db.query("INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)", [parent, a]);
  await request(owner, "DELETE", `/api/projects/${b}`, 200);
  assert.equal(await projectOf(parent), a);
  assert.equal(await projectOf(child), a);
});

test("R02 a legacy mixed tree cannot cascade across projects", { timeout: 25_000 }, async () => {
  await waitForHttp();
  const { a, owner, ownerId, editor, editorId } = await fixtures("Legacy tree actor");
  const { rows: [legacy] } = await db.query(
    `SELECT p.id AS parent, c.id AS child, p.project_id AS parent_project, c.project_id AS child_project
     FROM tasks p JOIN tasks c ON c.parent_task_id = p.id WHERE p.name = 'Legacy parent'`,
  );
  await db.query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, 'admin'), ($1, $3, 'editor')`,
    [legacy.parent_project, ownerId, editorId],
  );
  await request(editor, "DELETE", `/api/tasks/${legacy.parent}?force=1`, 409);
  await request(editor, "DELETE", `/api/tasks/${legacy.parent}`, 409);
  await request(editor, "POST", "/api/tasks/bulk", 409, { ids: [Number(legacy.parent)], op: "delete", force: true });
  await request(owner, "DELETE", `/api/projects/${legacy.parent_project}`, 409);
  assert.equal(await projectOf(legacy.parent), Number(legacy.parent_project));
  const { rows: [retained] } = await db.query(
    "SELECT project_id, parent_task_id, deleted_at FROM tasks WHERE id = $1", [legacy.child],
  );
  assert.deepEqual(retained, { project_id: legacy.child_project, parent_task_id: legacy.parent, deleted_at: null });

  const localParent = await task(a, "Same-project parent");
  const localChild = await task(a, "Same-project child", localParent);
  await request(editor, "DELETE", `/api/tasks/${localParent}?force=1`, 200);
  assert.equal(await projectOf(localParent), null);
  assert.equal(await projectOf(localChild), null);
});

test("R03 Redis recovery: a later mutation invalidates the WebSocket", { timeout: 25_000 }, async (t) => {
  await waitForHttp();
  const { a, editor } = await fixtures("Recovery");
  const ws = new WebSocket(`ws://127.0.0.1:3000/api/ws?project=${a}`, { origin: base, headers: { Cookie: editor } });
  t.after(() => ws.terminate());
  await once(ws, "open", { signal: AbortSignal.timeout(5_000) });
  let received = false;
  ws.on("message", (data) => { if (JSON.parse(String(data)).type === "invalidate") received = true; });

  const deadline = Date.now() + 10_000;
  while (!received && Date.now() < deadline) {
    await request(editor, "POST", "/api/tasks", 201, { project_id: a, name: "Write after Redis recovery" });
    if (!received) await delay(250);
  }
  assert.ok(received, "A mutation after Redis recovery should reach the already running app's WebSocket");
});
