import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function projectHtml(cookie, projectId, query = "view=list") {
  const response = await http(`/projects/${projectId}?${query}`, { cookie });
  assert.equal(response.status, 200);
  return response.text();
}

test("R02/R08 an incompatible legacy parent grants neither task reads nor edits", async (t) => {
  const { a: secondaryProject, owner, ownerId, editor, editorId } = await fixtures("Legacy auth");
  const { rows: [legacy] } = await db.query(
    `SELECT p.id AS parent, c.id AS child, p.project_id AS parent_project,
            c.project_id AS child_project, c.name, c.description
     FROM tasks p JOIN tasks c ON c.parent_task_id = p.id
     WHERE p.name = 'Legacy parent' AND c.name = 'Legacy child'`,
  );
  assert.ok(legacy, "legacy mixed project fixture must predate the migration");
  const sentinel = "private-child-description-r02-r08";
  const fieldSentinel = "private-child-custom-value-r02-r08";
  await db.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor'), ($3, $4, 'admin')",
    [legacy.parent_project, editorId, legacy.child_project, ownerId],
  );
  await db.query(
    "INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)",
    [legacy.parent, secondaryProject],
  );
  await db.query("UPDATE tasks SET description = $2 WHERE id = $1", [legacy.child, sentinel]);
  const { rows: [field] } = await db.query(
    "INSERT INTO custom_fields (project_id, name, field_type) VALUES ($1, 'Legacy scoped field', 'text') RETURNING id",
    [secondaryProject],
  );
  await db.query(
    "INSERT INTO task_custom_values (task_id, field_id, value_text) VALUES ($1, $2, $3)",
    [legacy.child, field.id, fieldSentinel],
  );
  t.after(async () => {
    await db.query("DELETE FROM task_project_memberships WHERE project_id = $1 AND task_id = ANY($2::bigint[])",
      [secondaryProject, [legacy.parent, legacy.child]]);
    await db.query("UPDATE tasks SET name = $2, description = $3 WHERE id = $1",
      [legacy.child, legacy.name, legacy.description]);
    await db.query("DELETE FROM custom_fields WHERE id = $1", [field.id]);
  });

  for (const project of [legacy.parent_project, secondaryProject]) {
    const child = await projectHtml(editor, project, `task=${legacy.child}`);
    const parent = await projectHtml(editor, project, `task=${legacy.parent}`);
    const list = await projectHtml(editor, project);
    for (const html of [child, parent, list]) {
      assert.doesNotMatch(html, /Legacy child|private-child-(description|custom-value)-r02-r08/);
    }
    assert.match(parent.replaceAll('\\"', '"'), /"name":"Legacy parent"[^}]*"subtask_count":0/);
  }
  await request(editor, "PATCH", `/api/tasks/${legacy.child}`, 403, { name: "Forbidden legacy change" });
  assert.match(await projectHtml(owner, legacy.child_project, `task=${legacy.child}`), new RegExp(sentinel));
  await request(owner, "PATCH", `/api/tasks/${legacy.child}`, 200, { name: "Primary legacy edit" });

  await db.query(
    "INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)",
    [legacy.child, secondaryProject],
  );
  const shared = await projectHtml(editor, secondaryProject, `task=${legacy.child}`);
  assert.match(shared, new RegExp(sentinel));
  assert.match(shared, new RegExp(fieldSentinel));
  await request(editor, "PATCH", `/api/tasks/${legacy.child}`, 200, { name: "Explicit secondary legacy edit" });
  const { rows: [updated] } = await db.query("SELECT project_id, name FROM tasks WHERE id = $1", [legacy.child]);
  assert.deepEqual(updated, { project_id: legacy.child_project, name: "Explicit secondary legacy edit" });
});

test("R02/R08 compatible and projectless subtasks remain visible to legitimate project members", async () => {
  const { a, b, editor, editorId } = await fixtures("Compatible auth");
  const parent = await task(a, "compatible-parent-r02-r08");
  const primary = await task(a, "compatible-primary-child-r02-r08", parent);
  const projectless = await task(null, "compatible-projectless-child-r02-r08", parent);
  await db.query(
    "INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)",
    [parent, b],
  );
  await db.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')",
    [b, editorId],
  );
  for (const project of [a, b]) {
    const list = await projectHtml(editor, project);
    const pane = await projectHtml(editor, project, `task=${parent}`);
    for (const html of [list, pane]) {
      assert.match(html, /compatible-primary-child-r02-r08/);
      assert.match(html, /compatible-projectless-child-r02-r08/);
    }
    assert.match(await projectHtml(editor, project, `task=${primary}`), /compatible-primary-child-r02-r08/);
    assert.match(await projectHtml(editor, project, `task=${projectless}`), /compatible-projectless-child-r02-r08/);
  }
  await request(editor, "PATCH", `/api/tasks/${projectless}`, 200, { name: "Projectless legacy edit" });
});
