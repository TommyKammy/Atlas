import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function legacyTask(projectId, parentId) {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    // Reproduce data predating migration 0002 only in the disposable fixture.
    await connection.query("SET LOCAL session_replication_role = replica");
    const { rows: [row] } = await connection.query(
      "INSERT INTO tasks (project_id,parent_task_id,name) VALUES ($1,$2,'Option private legacy child') RETURNING id",
      [projectId, parentId],
    );
    await connection.query("COMMIT");
    return Number(row.id);
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

test("rule-editor task search and selected-ID resolution enforce the same automation project scope", { timeout: 20_000 }, async () => {
  const f = await fixtures("No-code options");
  const own = await task(f.a, "Option own task");
  const privateTask = await task(f.b, "Option private task");
  const shared = await task(f.b, "Option shared task");
  await db.query("INSERT INTO task_project_memberships (task_id,project_id) VALUES ($1,$2)", [shared, f.a]);
  const child = await task(null, "Option inherited child", own);
  const legacy = await legacyTask(f.b, own);
  const deleted = await task(f.a, "Option deleted task");
  await db.query("UPDATE tasks SET deleted_at=now() WHERE id=$1", [deleted]);
  const base = `/api/projects/${f.a}/rules/options`;
  const listed = await request(f.editor, "GET", `${base}?kind=task&q=Option`, 200);
  assert.deepEqual(listed.options.map((option) => option.value).sort((a, b) => a - b), [own, shared, child].sort((a, b) => a - b));
  assert.ok(!JSON.stringify(listed).includes("private"));
  const selected = await request(f.editor, "GET", `${base}?kind=task&ids=${[own, privateTask, shared, legacy, deleted].join(",")}`, 200);
  assert.deepEqual(selected.options.map((option) => option.value).sort((a, b) => a - b), [own, shared].sort((a, b) => a - b));
  const cannotOverride = await request(f.editor, "GET", `${base}?kind=task&project_id=${f.b}&ids=${privateTask}`, 200);
  assert.deepEqual(cannotOverride.options, []);
  await request(f.editor, "GET", `/api/projects/${f.b}/rules/options?kind=task`, 403);
  const { rows: [viewer] } = await db.query("INSERT INTO users (name) VALUES ('Option viewer') RETURNING id");
  await db.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'viewer')", [f.a, viewer.id]);
  await request(await session(viewer.id), "GET", `${base}?kind=task`, 403);
  await request(f.editor, "GET", `${base}?kind=task&ids=1,2%20OR%201=1`, 400);
  await request(f.editor, "GET", `${base}?kind=unknown`, 400);
});

test("rule-editor entity options exclude foreign sections, view-only project destinations and inactive members", { timeout: 15_000 }, async () => {
  const f = await fixtures("No-code entities");
  const { rows: [aSection, bSection] } = await db.query("INSERT INTO sections (project_id,name) VALUES ($1,'Option A'),($2,'Option B') RETURNING id", [f.a, f.b]);
  const { rows: [inactive] } = await db.query("INSERT INTO users (name,deactivated_at) VALUES ('Option disabled member',now()) RETURNING id");
  await db.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'viewer')", [f.b, f.editorId]);
  const base = `/api/projects/${f.a}/rules/options`;
  const sections = await request(f.editor, "GET", `${base}?kind=section&ids=${aSection.id},${bSection.id}`, 200);
  assert.deepEqual(sections.options.map((option) => option.value), [Number(aSection.id)]);
  const projects = await request(f.editor, "GET", `${base}?kind=project&ids=${f.a},${f.b}`, 200);
  assert.deepEqual(projects.options.map((option) => option.value), [f.a]);
  const users = await request(f.editor, "GET", `${base}?kind=user&ids=${f.ownerId},${inactive.id}`, 200);
  assert.deepEqual(users.options.map((option) => option.value), [Number(f.ownerId)]);
  await db.query("INSERT INTO tasks (project_id,name) SELECT $1,'Option paged '||n FROM generate_series(1,35) n", [f.a]);
  const limited = await request(f.editor, "GET", `${base}?kind=task&q=Option%20paged`, 200);
  assert.equal(limited.options.length, 30);
  assert.equal(limited.hasMore, true);
  const percent = await task(f.a, "Literal % option");
  const literal = await request(f.editor, "GET", `${base}?kind=task&q=%25`, 200);
  assert.deepEqual(literal.options.map((option) => option.value), [percent]);
});

test("rule-editor reference search validates the source field and its complete source-project ACL", { timeout: 15_000 }, async () => {
  const f = await fixtures("No-code reference");
  const target = await task(f.b, "Option reference source");
  const { rows: [local, foreign, restricted] } = await db.query(
    `INSERT INTO custom_fields (project_id,name,field_type,config,access_level)
     VALUES ($1,'Local reference','reference',$3::jsonb,'everyone'),
       ($2,'Foreign reference','reference',$3::jsonb,'everyone'),
       ($1,'Restricted reference','reference',$3::jsonb,'admins') RETURNING id`,
    [f.a, f.b, JSON.stringify({ source_project_ids: [f.b] })],
  );
  const base = `/api/projects/${f.a}/rules/options`;
  await request(f.editor, "GET", `${base}?kind=reference&field_id=${local.id}`, 403);
  await request(f.owner, "GET", `${base}?kind=reference&field_id=${foreign.id}`, 404);
  await request(f.editor, "GET", `${base}?kind=reference&field_id=${restricted.id}`, 403);
  const allowed = await request(f.owner, "GET", `${base}?kind=reference&field_id=${local.id}&ids=${target}`, 200);
  assert.deepEqual(allowed.options.map((option) => option.value), [target]);
  await db.query("UPDATE custom_fields SET deleted_at=now() WHERE id=$1", [local.id]);
  await request(f.owner, "GET", `${base}?kind=reference&field_id=${local.id}&ids=${target}`, 404);
});
