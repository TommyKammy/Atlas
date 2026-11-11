import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

function section(html, kind) {
  const start = html.indexOf(`data-search-section="${kind}"`);
  if (start < 0) return { ids: [], total: 0, html: "" };
  const end = html.indexOf('data-search-section="', start + 1);
  const body = html.slice(start, end < 0 ? undefined : end);
  return {
    ids: [...body.matchAll(/data-search-result-id="(\d+)"/g)].map((match) => Number(match[1])),
    total: Number(body.match(/data-search-section-total="(\d+)"/)?.[1]),
    html: body,
  };
}

async function search(cookie, params) {
  const response = await http(`/search?${new URLSearchParams(params)}`, { cookie, timeout: 15_000 });
  const html = (await response.text()).replace(/<!--.*?-->/gs, "");
  assert.equal(response.status, 200, html.slice(0, 1000));
  return html;
}

async function paginationFixture() {
  const prefix = `EV09-${randomUUID()}`;
  const f = await fixtures(prefix);
  const token = `${prefix}-task`;
  const { rows } = await db.query(`INSERT INTO tasks(project_id,name,description,status,due_on,updated_at)
    SELECT $1,$2 || ' ' || n,'Paging fixture','EV09_ACTIVE','2026-11-11','2026-11-01T00:00:00Z'
    FROM generate_series(1,205) n RETURNING id`, [f.a, token]);
  const ids = rows.map((row) => Number(row.id)).sort((a, b) => a - b);
  await db.query(`INSERT INTO task_project_memberships(task_id,project_id)
    SELECT unnest($1::bigint[]),$2`, [ids, f.b]);
  await db.query(`INSERT INTO tasks(project_id,name,updated_at)
    SELECT $1,$2 || ' private ' || n,'2026-11-01T00:00:00Z' FROM generate_series(1,7) n`, [f.a, token]);
  await db.query(`INSERT INTO tasks(project_id,name,updated_at)
    SELECT $1,$2 || ' local ' || n,'2026-11-01T00:00:00Z' FROM generate_series(1,4) n`, [f.b, token]);
  const removed = await task(f.a, `${token} deleted task`);
  await db.query("UPDATE tasks SET deleted_at=now() WHERE id=$1", [removed]);
  const { rows: [deletedProject] } = await db.query("INSERT INTO projects(workspace_id,name,deleted_at) VALUES(1,$1,now()) RETURNING id", [`${prefix} deleted`]);
  await task(deletedProject.id, `${token} deleted project`);
  const { rows: users } = await db.query("INSERT INTO users(name) VALUES($1),($2),($3) RETURNING id", [`${prefix} viewer`, `${prefix} commenter`, `${prefix} editor`]);
  for (let i = 0; i < users.length; i++) {
    await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3),($4,$2,$3)", [f.b, users[i].id, ["viewer", "commenter", "editor"][i], deletedProject.id]);
  }
  const { rows: [field] } = await db.query("INSERT INTO custom_fields(project_id,name,field_type,options) VALUES($1,'EV09 Field','select','[\"EV09 value\"]') RETURNING id", [f.b]);
  await db.query("INSERT INTO task_custom_values(task_id,field_id,value_text) SELECT unnest($1::bigint[]),$2,'EV09 value'", [ids, field.id]);
  const { rows: [admin] } = await db.query("INSERT INTO users(name,is_admin) VALUES($1,true) RETURNING id", [`${prefix} global admin`]);
  return { ...f, token, ids, field: field.id, readers: await Promise.all(users.map((user) => session(user.id))), admin: await session(admin.id) };
}

test("EV09 task counts/page traversal are complete, stable and deduplicated across authorized homes", { timeout: 60_000 }, async () => {
  const f = await paginationFixture();
  const filter = { q: f.token, project: String(f.b), assignee: "none", completed: "open", status: "EV09_ACTIVE", from: "2026-11-11", to: "2026-11-11", [`cf_${f.field}`]: "EV09 value" };
  for (const cookie of [...f.readers, f.owner, f.admin]) {
    const pages = [];
    for (const page of [1, 2, 3]) {
      const result = section(await search(cookie, { ...filter, tasks_page: String(page) }), "tasks");
      assert.equal(result.total, 205);
      assert.equal(result.ids.length, page === 3 ? 5 : 100);
      assert.match(result.html, /cf_\d+=EV09\+value/);
      pages.push(...result.ids);
    }
    assert.deepEqual(pages, f.ids);
    assert.equal(new Set(pages).size, 205);
  }
});

test("EV09 counts respect role/private/deleted scope and invalid/out-of-range pages remain usable", { timeout: 60_000 }, async () => {
  const f = await paginationFixture();
  for (const cookie of f.readers) {
    assert.equal(section(await search(cookie, { q: f.token }), "tasks").total, 209);
    const hidden = await search(cookie, { q: f.token, project: String(f.a) });
    assert.deepEqual(section(hidden, "tasks").ids, []);
    assert.match(hidden, /data-search-empty/);
  }
  assert.equal(section(await search(f.editor, { q: f.token }), "tasks").total, 212);
  assert.equal(section(await search(f.owner, { q: f.token }), "tasks").total, 216);
  assert.equal(section(await search(f.admin, { q: f.token }), "tasks").total, 216);
  const first = section(await search(f.readers[0], { q: f.token }), "tasks");
  for (const page of ["0", "-1", "NaN", "1.5", "999999999999999999999999999"]) {
    const result = section(await search(f.readers[0], { q: f.token, tasks_page: page }), "tasks");
    assert.deepEqual(result.ids, first.ids);
  }
  const last = section(await search(f.readers[0], { q: f.token, tasks_page: "2147483647" }), "tasks");
  assert.equal(last.total, 209);
  assert.equal(last.ids.length, 9);
  assert.match(last.html, /data-search-current-page[^>]*>3 \/ 3ページ/);
  assert.doesNotMatch(last.html, /data-search-page="next"/);
  const empty = await search(f.readers[0], { q: `${f.token} nonexistent`, tasks_page: "2147483647" });
  assert.match(empty, /data-search-total="0"/);
  assert.match(empty, /data-search-empty/);
});

test("EV09 every non-task result kind reports full counts and a reachable final page without private/deleted leaks", { timeout: 60_000 }, async () => {
  const prefix = `EV09-other-${randomUUID()}`;
  const f = await fixtures(prefix);
  const token = `${prefix}-keyword`;
  await db.query(`WITH inserted AS (
    INSERT INTO projects(workspace_id,name,created_at)
    SELECT 1,$1 || ' ' || n,'2026-11-01T00:00:00Z' FROM generate_series(1,25) n RETURNING id
  ) INSERT INTO project_members(project_id,user_id,role) SELECT id,$2,'viewer' FROM inserted`, [token, f.editorId]);
  await db.query("INSERT INTO project_messages(project_id,title,body,created_at) SELECT $1,$2 || ' ' || n,'Body','2026-11-01T00:00:00Z' FROM generate_series(1,25) n", [f.a, token]);
  await db.query("INSERT INTO project_knowledge(project_id,title,body,updated_at) SELECT $1,$2 || ' ' || n,'Body','2026-11-01T00:00:00Z' FROM generate_series(1,25) n", [f.a, token]);
  const taskId = await task(f.a, "EV09 attachment host");
  await db.query("INSERT INTO task_attachments(task_id,file_name,stored_name,created_at) SELECT $1,$2 || ' ' || n,$2 || '-' || n,'2026-11-01T00:00:00Z' FROM generate_series(1,25) n", [taskId, token]);
  // The editor has no home in B. These matching records must not enter rows OR totals.
  await db.query("UPDATE projects SET name=$2 WHERE id=$1", [f.b, `${token} PRIVATE`]);
  await db.query("INSERT INTO project_messages(project_id,title,body) VALUES($1,$2,'PRIVATE')", [f.b, token]);
  await db.query("INSERT INTO project_knowledge(project_id,title,body) VALUES($1,$2,'PRIVATE')", [f.b, token]);
  const privateId = await task(f.b, "EV09 private attachment host");
  await db.query("INSERT INTO task_attachments(task_id,file_name,stored_name) VALUES($1,$2,$3)", [privateId, token, `${prefix}-private`]);
  const { rows: [deleted] } = await db.query("INSERT INTO projects(workspace_id,name,deleted_at) VALUES(1,$1,now()) RETURNING id", [`${token} DELETED`]);
  await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'viewer')", [deleted.id, f.editorId]);
  await db.query("INSERT INTO project_messages(project_id,title,body) VALUES($1,$2,'DELETED')", [deleted.id, token]);
  await db.query("INSERT INTO project_knowledge(project_id,title,body) VALUES($1,$2,'DELETED')", [deleted.id, token]);
  const deletedId = await task(deleted.id, "EV09 deleted attachment host");
  await db.query("INSERT INTO task_attachments(task_id,file_name,stored_name) VALUES($1,$2,$3)", [deletedId, token, `${prefix}-deleted`]);
  const first = await search(f.editor, { q: token });
  assert.match(first, /data-search-total="100"/);
  const last = await search(f.editor, { q: token, projects_page: "2", messages_page: "2", knowledge_page: "2", files_page: "2147483647" });
  for (const kind of ["projects", "messages", "knowledge", "files"]) {
    const a = section(first, kind), b = section(last, kind);
    assert.equal(a.total, 25, kind);
    assert.equal(b.total, 25, kind);
    assert.equal(a.ids.length, 20, kind);
    assert.equal(b.ids.length, 5, kind);
    assert.equal(new Set([...a.ids, ...b.ids]).size, 25, kind);
    assert.doesNotMatch(b.html, /data-search-page="next"/);
  }
  const suggest = await request(f.editor, "GET", `/api/search/suggest?q=${encodeURIComponent(token)}`, 200);
  for (const kind of ["projects", "messages", "knowledge", "files"]) assert.equal(suggest.groups[kind].length, 5, kind);
});

test("EV09 keyword/date/numeric boundaries do not produce server errors or bypass the bounded search", async () => {
  const f = await fixtures(`EV09-boundary-${randomUUID()}`);
  const q = "z".repeat(200);
  await task(f.a, q);
  const html = await search(f.editor, { q: `${q}TRUNCATED`, from: "2026-02-30" });
  assert.equal(section(html, "tasks").total, 1);
  assert.match(html, /先頭.*200.*文字で検索/);
  const { rows: [field] } = await db.query("INSERT INTO custom_fields(project_id,name,field_type) VALUES($1,'Numeric boundary','number') RETURNING id", [f.a]);
  const invalid = await search(f.editor, { q, [`cf_${field.id}`]: "not-a-number" });
  assert.match(invalid, /data-search-total="0"/);
});
