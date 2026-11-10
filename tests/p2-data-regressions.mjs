import assert from "node:assert/strict";
import { before, test } from "node:test";
import { parseCsv } from "../lib/csv.ts";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

test("R21 export and reimport preserve custom values with semicolons, quotes and newlines", async () => {
  const { a, b, owner } = await fixtures("Delimited export");
  const taskId = await task(a, "Exported task");
  const { rows: [field, timer] } = await db.query(
    `INSERT INTO custom_fields (project_id, name, field_type)
     VALUES ($1, 'Notes', 'text'), ($1, 'Duration', 'timer'), ($2, 'Notes', 'text') RETURNING id`,
    [a, b],
  );
  const value = `before;after="quoted, value"\nlast line;${timer.id}=999`;
  await db.query("INSERT INTO task_custom_values (task_id, field_id, value_text) VALUES ($1, $2, $3)", [
    taskId, field.id, value,
  ]);
  const url = `/api/projects/${a}/export`;
  const exported = await http(`${url}?format=csv`, { cookie: owner });
  assert.equal(exported.status, 200);
  const csv = await exported.text();
  const [header, row] = parseCsv(csv);
  assert.equal(row[header.indexOf("Notes")], value);

  const json = await request(owner, "GET", url, 200);
  assert.equal(json.tasks[0].custom_values_by_field[field.id], value);
  assert.equal(json.tasks[0].custom_values, `${field.id}=${value}`);
  const time = await http(`${url}?format=timecsv`, { cookie: owner });
  assert.equal(time.status, 200);
  const [timeHeader, timeRow] = parseCsv(await time.text());
  assert.equal(timeRow[timeHeader.indexOf("Duration（秒）")], "0");

  const form = new FormData();
  form.set("file", new File([csv], "roundtrip.csv", { type: "text/csv" }));
  const imported = await http(`/api/projects/${b}/import`, { cookie: owner, method: "POST", body: form });
  assert.equal(imported.status, 201, await imported.clone().text());
  assert.equal((await imported.json()).created, 1);
  const { rows } = await db.query(
    `SELECT v.value_text FROM task_custom_values v JOIN tasks t ON t.id = v.task_id
     WHERE t.project_id = $1`,
    [b],
  );
  assert.deepEqual(rows, [{ value_text: value }]);
});

test("R21 project tables retain delimiters and never interpret text as another field", async () => {
  const { a, owner } = await fixtures("Delimited table");
  const taskId = await task(a, "Snapshot task");
  const { rows: [estimate, notes, , deleted] } = await db.query(
    `INSERT INTO custom_fields (project_id, name, field_type)
     VALUES ($1, 'Estimate', 'number'), ($1, 'Notes', 'text'),
            ($1, 'Blank', 'text'), ($1, 'Removed', 'text') RETURNING id`,
    [a],
  );
  const text = `before;after="quoted, 日本語"\nnext line;${estimate.id}=999`;
  await db.query("UPDATE custom_fields SET deleted_at = now() WHERE id = $1", [deleted.id]);
  await db.query(
    `INSERT INTO task_custom_values (task_id, field_id, value_text, value_number)
     VALUES ($1, $2, 'legacy text', 12.5), ($1, $3, $4, NULL), ($1, $5, 'deleted', NULL)`,
    [taskId, estimate.id, notes.id, text, deleted.id],
  );

  const snapshot = await request(owner, "POST", `/api/projects/${a}/table`, 201, { name: "Delimiter test" });
  assert.equal(snapshot.row_count, 1);
  const download = await http(`/api/tables/${snapshot.id}/export?format=csv`, { cookie: owner });
  assert.equal(download.status, 200);
  const [header, row] = parseCsv(await download.text());
  assert.deepEqual(header.slice(-3), ["Estimate", "Notes", "Blank"]);
  assert.deepEqual(row.slice(-3), ["12.5", text, ""]);
  assert.equal(header.includes("Removed"), false);
});

test("R21 duplicate and saved templates preserve milestones and legacy templates default to tasks", async () => {
  const { a, owner, ownerId } = await fixtures("Milestone copies");
  const { id: root } = await request(owner, "POST", "/api/tasks", 201, {
    project_id: a, name: "Parent milestone", is_milestone: true,
  });
  await task(a, "Child task", root);
  await task(a, "Ordinary task");
  const duplicate = await request(owner, "POST", `/api/projects/${a}/duplicate`, 201, { name: "Milestone copy" });
  const template = await request(owner, "POST", `/api/projects/${a}/template`, 201, { name: "Milestone template" });
  const instantiated = await request(owner, "POST", `/api/project-templates/${template.id}`, 201, { name: "Milestone instance" });
  for (const projectId of [duplicate.id, instantiated.id]) {
    const { rows } = await db.query(
      `SELECT t.name, t.is_milestone, p.name AS parent FROM tasks t
       LEFT JOIN tasks p ON p.id = t.parent_task_id WHERE t.project_id = $1 ORDER BY t.name`,
      [projectId],
    );
    assert.deepEqual(rows, [
      { name: "Child task", is_milestone: false, parent: "Parent milestone" },
      { name: "Ordinary task", is_milestone: false, parent: null },
      { name: "Parent milestone", is_milestone: true, parent: null },
    ], `task forest in project ${projectId}`);
  }

  const { rows: [legacy] } = await db.query(
    `INSERT INTO project_templates (workspace_id, name, payload, created_by)
     VALUES (1, 'Legacy', $1::jsonb, $2) RETURNING id`,
    [JSON.stringify({ sections: [{ name: "Old", tasks: [{ name: "Legacy task" }] }] }), ownerId],
  );
  const legacyProject = await request(owner, "POST", `/api/project-templates/${legacy.id}`, 201, { name: "Legacy instance" });
  const { rows } = await db.query("SELECT is_milestone FROM tasks WHERE project_id = $1", [legacyProject.id]);
  assert.deepEqual(rows, [{ is_milestone: false }]);
});

const reverseIndex = "idx_task_dependencies_depends_on_id";

function planUsesIndex(plan) {
  return plan["Index Name"] === reverseIndex || (plan.Plans ?? []).some(planUsesIndex);
}

test("R23 reverse counts use the new index in sparse and dense projects", { timeout: 25_000 }, async (t) => {
  const { a } = await fixtures("Reverse dependency plan");
  const q = await db.connect();
  try {
    await q.query("BEGIN");
    const { rows } = await q.query(
      `INSERT INTO tasks (project_id, name)
       SELECT $1, 'Dependency ' || i FROM generate_series(1, 1000) i RETURNING id`,
      [a],
    );
    const ids = rows.map(({ id }) => id);
    const insert = `INSERT INTO task_dependencies (task_id, depends_on_id)
      SELECT ids[i], ids[1 + (i - 1 + distance) % cardinality(ids)]
      FROM (SELECT $1::bigint[] AS ids) AS fixture,
           generate_series(1, cardinality(ids)) AS i,
           generate_series($2::int, $3::int) AS distance`;
    const analyze = async (query, values) => {
      const result = await q.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, values);
      return result.rows[0]["QUERY PLAN"][0];
    };
    const count = `SELECT (SELECT count(*)::int FROM task_dependencies d WHERE d.depends_on_id = t.id) AS n
                   FROM tasks t WHERE t.project_id = $1`;
    const blocks = ({ Plan }) => (Plan["Shared Hit Blocks"] ?? 0) + (Plan["Shared Read Blocks"] ?? 0);
    for (const [from, to] of [[1, 2], [3, 20]]) {
      await q.query(insert, [ids, from, to]);
      await q.query("ANALYZE tasks; ANALYZE task_dependencies");
      const indexed = await analyze(count, [a]);
      assert.ok(planUsesIndex(indexed.Plan), "the normal planner should choose the reverse index");
      const totals = await q.query(`SELECT min(n), max(n) FROM (${count}) counted`, [a]);
      assert.deepEqual(totals.rows, [{ min: to, max: to }]);

      await q.query("SAVEPOINT benchmark_insert");
      const indexedWrite = await analyze(insert, [ids, 21, 21]);
      await q.query("ROLLBACK TO SAVEPOINT benchmark_insert");
      await q.query(`DROP INDEX ${reverseIndex}`);
      const original = await analyze(count, [a]);
      const originalWrite = await analyze(insert, [ids, 21, 21]);
      await q.query("ROLLBACK TO SAVEPOINT benchmark_insert");
      await q.query("RELEASE SAVEPOINT benchmark_insert");
      assert.ok(blocks(indexed) < blocks(original), "indexed lookup should read fewer shared buffers");
      t.diagnostic(`${to * ids.length} edges; reverse count ${original["Execution Time"]} -> ${indexed["Execution Time"]} ms, ${blocks(original)} -> ${blocks(indexed)} shared blocks; 1000 inserts ${originalWrite["Execution Time"]} -> ${indexedWrite["Execution Time"]} ms`);
    }
  } finally {
    await q.query("ROLLBACK");
    q.release();
  }
});
