import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function legacyChild(projectId, parentId) {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    // Reproduce a link created before migration 0002 on this disposable DB.
    await connection.query("SET LOCAL session_replication_role = replica");
    const { rows: [child] } = await connection.query(
      "INSERT INTO tasks (project_id, parent_task_id, name, description) VALUES ($1, $2, $3, $4) RETURNING id",
      [projectId, parentId, "Private legacy child", "Private legacy description"],
    );
    await connection.query("COMMIT");
    return Number(child.id);
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

test("R02/R08 project copy and template exclude hidden legacy descendants and preserve shared subtrees", async () => {
  const { a, b, editor } = await fixtures("R02/R08 copy boundary");
  const sourceParent = await task(a, "Source parent");
  await task(a, "Source child", sourceParent);
  const hiddenChild = await legacyChild(b, sourceParent);
  await task(b, "Private grandchild", hiddenChild);
  await task(null, "Private projectless grandchild", hiddenChild);

  const sharedParent = await task(b, "Shared parent");
  await db.query("INSERT INTO task_project_memberships (task_id, project_id) VALUES ($1, $2)", [sharedParent, a]);
  await task(b, "Shared child", sharedParent);
  const projectless = await task(null, "Projectless child", sharedParent);
  await task(null, "Projectless grandchild", projectless);

  const duplicate = await request(editor, "POST", `/api/projects/${a}/duplicate`, 201, { name: "Copy with safe scope" });
  const template = await request(editor, "POST", `/api/projects/${a}/template`, 201, { name: "Template with safe scope" });
  const { rows: [snapshot] } = await db.query("SELECT payload FROM project_templates WHERE id = $1", [template.id]);
  assert.doesNotMatch(JSON.stringify(snapshot.payload), /Private (legacy|grandchild|projectless)/);
  const instance = await request(editor, "POST", `/api/project-templates/${template.id}`, 201, { name: "Scoped template instance" });

  for (const projectId of [duplicate.id, instance.id]) {
    const { rows } = await db.query(
      `SELECT child.name, parent.name AS parent
       FROM tasks child LEFT JOIN tasks parent ON parent.id = child.parent_task_id
       WHERE child.project_id = $1 ORDER BY child.name COLLATE "C"`,
      [projectId],
    );
    assert.deepEqual(rows, [
      { name: "Projectless child", parent: "Shared parent" },
      { name: "Projectless grandchild", parent: "Projectless child" },
      { name: "Shared child", parent: "Shared parent" },
      { name: "Shared parent", parent: null },
      { name: "Source child", parent: "Source parent" },
      { name: "Source parent", parent: null },
    ]);
  }
});
