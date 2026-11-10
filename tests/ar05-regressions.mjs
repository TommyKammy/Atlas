import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
beforeEach(() => db.query("UPDATE domain_events SET processed_at = now() WHERE processed_at IS NULL AND failed_at IS NULL"));

async function rejectOutbox(t, projectId, eventType) {
  await db.query(`
    CREATE FUNCTION ar05_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'AR05 injected outbox failure';
    END;
    $$;
    CREATE TRIGGER ar05_reject_event BEFORE INSERT ON domain_events
      FOR EACH ROW WHEN (NEW.project_id = ${projectId} AND NEW.type = '${eventType}')
      EXECUTE FUNCTION ar05_reject_event();
  `);
  const release = () => db.query("DROP TRIGGER IF EXISTS ar05_reject_event ON domain_events; DROP FUNCTION IF EXISTS ar05_reject_event()");
  t.after(release);
  return release;
}

async function processEvents() {
  const response = await http("/api/automation/process?limit=100", {
    method: "POST", timeout: 10_000, headers: { "x-automation-token": "atlas-regression-worker" },
  });
  assert.equal(response.status, 200, await response.text());
}

test("AR05 failed task-created outbox insertion rolls back the task and a retry runs its rule once", async (t) => {
  const { a, owner } = await fixtures("AR05 creation");
  const name = "AR05 atomic created task";
  await request(owner, "POST", `/api/projects/${a}/rules`, 201, {
    name: "AR05 creation marker", definition: {
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "task.add_comment", params: { body: "AR05 one creation" } }],
    },
  });
  const release = await rejectOutbox(t, a, "task.created");
  await request(owner, "POST", "/api/tasks", 500, { project_id: a, name });
  assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1 AND name = $2", [a, name])).rowCount, 0);
  assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1", [a])).rowCount, 0);

  await release();
  const { id } = await request(owner, "POST", "/api/tasks", 201, { project_id: a, name });
  assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1 AND type = 'task.created'", [a])).rowCount, 1);
  await processEvents();
  await processEvents();
  assert.equal((await db.query("SELECT id FROM comments WHERE task_id = $1 AND body = 'AR05 one creation'", [id])).rowCount, 1);
});

test("AR05 a failure after earlier patch events rolls back the whole patch and every event", async (t) => {
  const { a, owner, ownerId } = await fixtures("AR05 patch");
  const id = await task(a, "AR05 atomic patch task");
  const snapshot = () => db.query(
    `SELECT assignee_id, due_on::text AS due_on, status, is_milestone, updated_at::text AS updated_at
     FROM tasks WHERE id = $1`, [id],
  ).then(({ rows: [row] }) => row);
  const before = await snapshot();
  const patch = { expected_updated_at: before.updated_at, assignee_id: ownerId, due_on: "2027-01-15", is_milestone: true, status: "Done" };
  const release = await rejectOutbox(t, a, "task.status_changed");
  await request(owner, "PATCH", `/api/tasks/${id}`, 500, patch);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query("SELECT id FROM domain_events WHERE subject_type = 'task' AND subject_id = $1", [id])).rowCount, 0);

  await release();
  await request(owner, "PATCH", `/api/tasks/${id}`, 200, patch);
  const { rows } = await db.query("SELECT type FROM domain_events WHERE subject_type = 'task' AND subject_id = $1 ORDER BY type", [id]);
  assert.deepEqual(rows.map(({ type }) => type), ["task.assigned", "task.due_changed", "task.milestone_changed", "task.status_changed"]);
  await request(owner, "PATCH", `/api/tasks/${id}`, 409, { expected_updated_at: before.updated_at, status: "Other" });
  assert.equal((await db.query("SELECT id FROM domain_events WHERE subject_type = 'task' AND subject_id = $1", [id])).rowCount, 4);
});

test("AR05 an outbox failure during a primary move restores memberships and timeline placements", async (t) => {
  const { a, b, owner } = await fixtures("AR05 project move");
  const id = await task(a, "AR05 moving task");
  const { rows: [section] } = await db.query("INSERT INTO sections (project_id, name) VALUES ($1, 'AR05 destination') RETURNING id", [b]);
  await db.query("INSERT INTO task_project_memberships (task_id, project_id, section_id) VALUES ($1, $2, $3)", [id, b, section.id]);
  await db.query("INSERT INTO task_timeline_rows (task_id, project_id, row_index) VALUES ($1, $2, 2), ($1, $3, 3)", [id, a, b]);
  const release = await rejectOutbox(t, b, "task.added_to_project");
  const patch = { project_id: b, section_id: Number(section.id) };
  await request(owner, "PATCH", `/api/tasks/${id}`, 500, patch);
  assert.equal(Number((await db.query("SELECT project_id FROM tasks WHERE id = $1", [id])).rows[0].project_id), a);
  assert.equal((await db.query("SELECT task_id FROM task_project_memberships WHERE task_id = $1 AND project_id = $2", [id, b])).rowCount, 1);
  assert.equal((await db.query("SELECT task_id FROM task_timeline_rows WHERE task_id = $1", [id])).rowCount, 2);
  assert.equal((await db.query("SELECT id FROM domain_events WHERE subject_type = 'task' AND subject_id = $1", [id])).rowCount, 0);

  await release();
  await request(owner, "PATCH", `/api/tasks/${id}`, 200, patch);
  assert.equal(Number((await db.query("SELECT project_id FROM tasks WHERE id = $1", [id])).rows[0].project_id), b);
  assert.equal((await db.query("SELECT task_id FROM task_project_memberships WHERE task_id = $1 AND project_id = $2", [id, b])).rowCount, 0);
});

for (const operation of ["duplicate", "follow-up", "template", "form"]) {
  test(`AR05 ${operation} creation commits its rows and outbox together`, async (t) => {
    const { a, owner, ownerId } = await fixtures(`AR05 ${operation}`);
    const source = await task(a, `AR05 ${operation} source`);
    let path = `/api/tasks/${source}/${operation}`;
    let body = {};
    const eventType = operation === "form" ? "form.submitted" : "task.created";
    if (operation === "template") {
      const { rows: [template] } = await db.query(
        `INSERT INTO task_templates (project_id, name, title_template, subtasks)
         VALUES ($1, 'AR05 template', 'AR05 templated task', '[{"name":"AR05 child"}]') RETURNING id`, [a],
      );
      path = `/api/task-templates/${template.id}`;
    } else if (operation === "form") {
      const { rows: [form] } = await db.query(
        "INSERT INTO project_forms (project_id, name, published, created_by) VALUES ($1, 'AR05 form', TRUE, $2) RETURNING id",
        [a, ownerId],
      );
      path = `/api/forms/${form.id}/submit`;
      body = { answers: {} };
    }
    const release = await rejectOutbox(t, a, eventType);
    await request(owner, "POST", path, 500, body);
    assert.equal((await db.query("SELECT id FROM tasks WHERE project_id = $1", [a])).rowCount, 1);
    assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1", [a])).rowCount, 0);
    if (operation === "form") {
      assert.equal((await db.query("SELECT r.id FROM form_responses r JOIN project_forms f ON f.id = r.form_id WHERE f.project_id = $1", [a])).rowCount, 0);
    }
    await release();
    await request(owner, "POST", path, 201, body);
    assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1 AND type = $2", [a, eventType])).rowCount, 1);
  });
}

test("AR05 comment and status writes roll back when their events cannot be stored", async (t) => {
  const { a, owner } = await fixtures("AR05 comment and status");
  const id = await task(a, "AR05 commented task");
  let release = await rejectOutbox(t, a, "comment.created");
  await request(owner, "POST", "/api/comments", 500, { task_id: id, body: "AR05 created comment" });
  assert.equal((await db.query("SELECT id FROM comments WHERE task_id = $1", [id])).rowCount, 0);
  await release();
  const { id: comment } = await request(owner, "POST", "/api/comments", 201, { task_id: id, body: "AR05 original comment" });
  release = await rejectOutbox(t, a, "comment.updated");
  await request(owner, "PATCH", `/api/comments/${comment}`, 500, { body: "AR05 edited comment" });
  assert.equal((await db.query("SELECT body FROM comments WHERE id = $1", [comment])).rows[0].body, "AR05 original comment");
  await release();

  release = await rejectOutbox(t, a, "project.status_changed");
  await request(owner, "POST", `/api/projects/${a}/status-updates`, 500, { body: "AR05 update", status: "review" });
  assert.equal((await db.query("SELECT status FROM projects WHERE id = $1", [a])).rows[0].status, "active");
  assert.equal((await db.query("SELECT id FROM project_status_updates WHERE project_id = $1", [a])).rowCount, 0);
  await release();
});

test("AR05 membership and bulk writes preserve task data on an outbox failure", async (t) => {
  const { a, b, owner, ownerId } = await fixtures("AR05 membership and bulk");
  const first = await task(a, "AR05 first bulk task");
  const second = await task(a, "AR05 second bulk task");
  let release = await rejectOutbox(t, b, "task.added_to_project");
  await request(owner, "POST", "/api/memberships", 500, { task_id: first, project_id: b });
  assert.equal((await db.query("SELECT task_id FROM task_project_memberships WHERE task_id = $1", [first])).rowCount, 0);
  await release();

  release = await rejectOutbox(t, a, "task.assigned");
  await request(owner, "POST", "/api/tasks/bulk", 500, { ids: [first, second], op: "assign", assignee_id: ownerId });
  assert.equal((await db.query("SELECT id FROM tasks WHERE id = ANY($1::bigint[]) AND assignee_id IS NOT NULL", [[first, second]])).rowCount, 0);
  assert.equal((await db.query("SELECT id FROM task_events WHERE task_id = ANY($1::bigint[])", [[first, second]])).rowCount, 0);
  await release();

  const { rows: [section] } = await db.query("INSERT INTO sections (project_id, name) VALUES ($1, 'AR05 moved bulk section') RETURNING id", [a]);
  await db.query("INSERT INTO task_timeline_rows (task_id, project_id, row_index) VALUES ($1, $3, 1), ($2, $3, 2)", [first, second, a]);
  release = await rejectOutbox(t, a, "task.section_changed");
  await request(owner, "POST", "/api/tasks/bulk", 500, { ids: [first, second], op: "move", section_id: Number(section.id) });
  assert.equal((await db.query("SELECT id FROM tasks WHERE id = ANY($1::bigint[]) AND section_id IS NOT NULL", [[first, second]])).rowCount, 0);
  assert.equal((await db.query("SELECT task_id FROM task_timeline_rows WHERE task_id = ANY($1::bigint[])", [[first, second]])).rowCount, 2);
  assert.equal((await db.query("SELECT id FROM domain_events WHERE project_id = $1", [a])).rowCount, 0);
  await release();
});
